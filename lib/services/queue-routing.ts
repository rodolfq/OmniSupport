import { query } from '@/lib/db';
import { deriveLiveStatus } from '@/lib/presence';
import { runExclusive } from '@/lib/key-mutex';

// id === null representa o pool combinado usado por chats sem fila única
// (ver resolveCombinedQueuePool). O rodízio (pickNextQueueAssignee) sempre
// filtra só pelo conjunto de membros, nunca por queue_id — é assim que um
// chat de WhatsApp e um chat de login do funcionário da mesma equipe entram
// no mesmo rodízio em vez de dois ponteiros "último atendido" independentes.
export interface RoutingQueue {
  id: string | null;
  memberIds: string[];
  // 'round_robin' (padrão) ou 'daily_balance' (item 14) — ver
  // pickNextQueueAssignee. Pool combinado (resolveCombinedQueuePool) nunca
  // preenche isso — sempre round-robin, ver comentário lá.
  strategy?: string;
}

// Fila vinculada à instância de WhatsApp que recebeu a mensagem.
export async function resolveQueueForInstance(instanceId: string): Promise<RoutingQueue | null> {
  const res = await query('SELECT id, member_ids, routing_strategy FROM public.queues WHERE whatsapp_instance_id = $1 LIMIT 1', [instanceId]);
  const row = res.rows[0];
  if (!row) return null;
  return { id: row.id, memberIds: row.member_ids || [], strategy: row.routing_strategy || 'round_robin' };
}

export async function resolveQueueById(queueId: string): Promise<RoutingQueue | null> {
  const res = await query('SELECT id, member_ids, routing_strategy FROM public.queues WHERE id = $1', [queueId]);
  const row = res.rows[0];
  if (!row) return null;
  return { id: row.id, memberIds: row.member_ids || [], strategy: row.routing_strategy || 'round_robin' };
}

// Conversas de usuário logado (widget do portal) não chegam por nenhum número
// de WhatsApp, então não há uma fila única pra escolher — em vez de exigir
// configurar uma fila especial, junta os membros de TODAS as filas
// configuradas (que não tenham optado por ficar de fora, via
// include_internal_chats) num único pool e faz o mesmo rodízio, com o mesmo
// comportamento (só quem está online participa) das conversas de WhatsApp.
// Estratégia por fila (item 14) não se aplica aqui: o pool mistura membros de
// várias filas, então não há uma única estratégia "dona" pra seguir — fica
// sempre round-robin, deliberadamente.
export async function resolveCombinedQueuePool(): Promise<RoutingQueue | null> {
  const res = await query('SELECT member_ids FROM public.queues WHERE include_internal_chats = true');
  const memberIds = Array.from(new Set(res.rows.flatMap((r: any) => (r.member_ids || []) as string[])));
  if (!memberIds.length) return null;
  return { id: null, memberIds };
}

// Distribuição round-robin entre os analistas da fila (ou do pool combinado)
// que estão online agora: pega quem foi atribuído por último — em qualquer
// canal, WhatsApp ou chat de login do funcionário, olhando só pelo conjunto
// de membros (não por queue_id gravado na sessão) — e passa para o próximo
// da lista, pulando quem não está online.
// "Ausente" já entra como não-online aqui (ver updateUserStatus/log-status-
// change, que grava is_online=false para status 'away'): não é elegível pra
// receber, mas também não perde a posição — a ordem-base agora é
// queue_anchor_at (quem ficou online primeiro HOJE), não mais a ordem
// cadastrada em member_ids, e ausentar-se/reconectar no mesmo dia não
// regrava a âncora (ver migrations/queue_daily_anchor.sql), só quem está
// elegível agora entra ou sai do rodízio calculado.
// Sem ninguém online, devolve null e o atendimento cai como 'pending' para
// atribuição manual.
// lastAssigneeId: usado por quem atribui vários atendimentos em sequência
// (dispatchPendingChatSessions) — o "último atribuído" lido do banco é o da
// sessão mais RECENTE por data de criação, e reatribuir sessões antigas não
// muda esse ponteiro; sem passar quem acabou de receber, o laço entregaria
// todos os pendentes para a mesma pessoa.
// excludeUserIds: quem NÃO pode receber desta vez, mesmo online — usado ao
// devolver uma conversa pra fila (quem devolveu não pode ficar com ela de
// volta). A ordem do rodízio não muda: quem está excluído é só pulado. Se
// sobrar ninguém, devolve null e a conversa fica 'pending' na fila.
export async function pickNextQueueAssignee(
  queue: RoutingQueue,
  options?: { lastAssigneeId?: string | null; excludeUserIds?: string[] }
): Promise<string | null> {
  const { memberIds, strategy } = queue;
  if (!memberIds.length) return null;

  // TODOS os membros com registro de presença, não só os online: a ordem
  // completa (por âncora do dia) é o que mantém a posição de quem saiu do
  // rodízio — ver o laço round-robin mais abaixo.
  const statusRes = await query(
    `SELECT user_id, queue_anchor_at, last_active, status, is_online FROM public.analyst_status
     WHERE user_id = ANY($1::uuid[])`,
    [memberIds]
  );
  const fullOrder: string[] = statusRes.rows
    .slice()
    .sort((a: any, b: any) =>
      (new Date(a.queue_anchor_at ?? 0).getTime() - new Date(b.queue_anchor_at ?? 0).getTime())
      // Desempate estável: sem isso, âncoras iguais podem vir em ordem
      // diferente do banco a cada consulta e o ponteiro "pula" de lugar.
      || String(a.user_id).localeCompare(String(b.user_id))
    )
    .map((r: any) => r.user_id as string);
  const rotation: string[] = statusRes.rows
    // is_online=true sozinho não basta, por dois motivos:
    // 1) sem heartbeat de verdade, fechar a aba sem logout explícito deixa a
    //    linha "online" pra sempre no banco (mesmo problema documentado em
    //    chat-management/page.tsx pro badge de presença) — daí a regra de
    //    atualidade de 5min;
    // 2) is_online e status divergem no banco: a rota antiga
    //    action=save-analyst-status grava is_online cru vindo do client sem
    //    mexer em status (há linhas hoje com is_online=true e
    //    status='offline').
    // deriveLiveStatus cobre os dois e é a MESMA regra que a UI usa pra
    // bolinha de presença — quem o time vê como Ausente/Offline não pode
    // receber chat por aqui.
    .filter((r: any) => r.is_online === true && deriveLiveStatus({ status: r.status, isOnline: true, lastActive: r.last_active }) === 'online')
    .map((r: any) => r.user_id as string);
  if (!rotation.length) return null;
  const eligible = new Set(rotation);

  const excluded = new Set(options?.excludeUserIds ?? []);
  if (!rotation.some(id => !excluded.has(id))) return null;

  if (strategy === 'daily_balance') {
    // Mesma ordem de antes (âncora do dia) — fullOrder filtrado por quem está
    // elegível — pra o desempate por "primeiro da lista" não mudar.
    return pickByDailyLoad(fullOrder.filter(id => eligible.has(id) && !excluded.has(id)));
  }

  const queueKey = queue.id ?? 'combined';
  let lastAssignee = options?.lastAssigneeId ?? null;
  if (!lastAssignee) {
    lastAssignee = await resolveRotationPointer(queueKey, memberIds);
  }
  // O ponteiro anda pela ordem COMPLETA dos membros e só então pula quem não
  // está elegível. Antes andava só pela lista de quem estava online: se o
  // último atendido tinha acabado de ficar Ausente/Offline, indexOf dava -1 e a
  // vez caía SEMPRE no primeiro da lista (quem ficou online mais cedo no dia) —
  // era assim que um analista só juntava conversas em sequência enquanto os
  // outros online esperavam. Agora a vez continua de onde o último parou, mesmo
  // que ele tenha saído do rodízio.
  const lastIndex = lastAssignee ? fullOrder.indexOf(lastAssignee) : -1;
  for (let step = 1; step <= fullOrder.length; step++) {
    const candidate = fullOrder[(lastIndex + step) % fullOrder.length];
    if (eligible.has(candidate) && !excluded.has(candidate)) {
      await saveRotationCursor(queueKey, candidate);
      return candidate;
    }
  }
  return null;
}

// "Quem recebeu por último" pro rodízio: o MAIS RECENTE entre (a) o responsável da
// conversa CRIADA mais recentemente — o critério de sempre, que já cobre criação
// e pega de conversa nova — e (b) o cursor gravado a cada escolha do rodízio
// (queue_rotation_cursor). Só (a) falhava numa devolução em sequência: devolver
// uma conversa ANTIGA não a torna a mais recente por criação, então todas as
// devoluções recalculavam o mesmo ponteiro e caíam no mesmo analista (17h de
// 2026-09-25: as 4 conversas do Mauro foram todas pra Bianca). O cursor faz cada
// escolha andar pra frente. Se a tabela não existir (deploy fora de ordem),
// cai no critério antigo.
async function resolveRotationPointer(queueKey: string, memberIds: string[]): Promise<string | null> {
  const lastRes = await query(
    `SELECT assignee_id, created_at FROM public.chat_sessions
     WHERE assignee_id = ANY($1::uuid[])
     ORDER BY created_at DESC LIMIT 1`,
    [memberIds]
  );
  const bySession = lastRes.rows[0] as { assignee_id: string; created_at: Date } | undefined;

  try {
    const cursorRes = await query(
      'SELECT assignee_id, updated_at FROM public.queue_rotation_cursor WHERE queue_key = $1',
      [queueKey]
    );
    const cursor = cursorRes.rows[0] as { assignee_id: string | null; updated_at: Date } | undefined;
    if (cursor?.assignee_id && memberIds.includes(cursor.assignee_id)
        && (!bySession || new Date(cursor.updated_at).getTime() > new Date(bySession.created_at).getTime())) {
      return cursor.assignee_id;
    }
  } catch (err) {
    console.error('[queue-routing] Cursor do rodízio indisponível — usando só a última conversa criada:', (err as Error)?.message);
  }
  return bySession?.assignee_id ?? null;
}

async function saveRotationCursor(queueKey: string, assigneeId: string): Promise<void> {
  try {
    await query(
      `INSERT INTO public.queue_rotation_cursor (queue_key, assignee_id, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (queue_key) DO UPDATE SET assignee_id = EXCLUDED.assignee_id, updated_at = NOW()`,
      [queueKey, assigneeId]
    );
  } catch (err) {
    // Nunca impede a distribuição: sem o cursor, volta ao critério antigo.
    console.error('[queue-routing] Falha ao gravar o cursor do rodízio:', (err as Error)?.message);
  }
}

// "Esta pessoa entraria no rodízio agora?" — mesma régua de pickNextQueueAssignee
// (membro da fila + presença viva, via deriveLiveStatus), só que pra UM usuário
// específico. Usada quando a conversa deve ir pra alguém em particular (autor
// da nota / de quem abriu o chamado) mas só se essa pessoa puder mesmo atender
// agora — se não puder, quem decide é o rodízio da fila.
// Sem fila (conversa sem queue_id), só a presença conta.
export async function isOnlineQueueMember(userId: string, queue: RoutingQueue | null): Promise<boolean> {
  if (queue && !queue.memberIds.includes(userId)) return false;
  // Só papel de equipe: analyst_status também guarda a presença de
  // Cliente/Funcionário logados no portal, e sem fila (nada de lista de
  // membros pra restringir) qualquer um deles contava como "online" — foi assim
  // que uma conversa acabou atribuída ao próprio cliente que escreveu a nota.
  const res = await query(
    `SELECT a.status, a.last_active
       FROM public.analyst_status a
       JOIN public.profiles p ON p.id = a.user_id
      WHERE a.user_id = $1 AND a.is_online = true
        AND p.role = ANY(ARRAY['Administrador', 'Equipe', 'Time Interno']::text[])`,
    [userId]
  );
  const row = res.rows[0];
  if (!row) return false;
  return deriveLiveStatus({ status: row.status, isOnline: true, lastActive: row.last_active }) === 'online';
}

export interface DispatchedSession {
  sessionId: string;
  assigneeId: string;
  customerName: string | null;
}

// Reprocessa atendimentos que ficaram parados em 'pending' — o caso clássico é
// o cliente escrever com TODO mundo offline: pickNextQueueAssignee devolve null
// na criação e, até aqui, ninguém nunca revisitava essa sessão. Ela só saía de
// 'pending' se um analista a pegasse na mão, mesmo que o time inteiro voltasse
// a ficar online logo depois.
//
// Chamado quando o cenário que causou o 'pending' pode ter mudado:
//  - alguém fica Online (app/actions.ts, updateUserStatus)
//  - chega mensagem nova numa conversa pendente (widget e WhatsApp)
//
// O UPDATE é condicional (`status = 'pending' AND assignee_id IS NULL`) porque
// entre a escolha e a gravação um analista pode ter assumido a conversa na mão
// — nesse caso a atribuição automática desiste em vez de roubar o atendimento.
export async function dispatchPendingChatSessions(options?: { sessionId?: string }): Promise<DispatchedSession[]> {
  const params: any[] = [];
  let filter = '';
  if (options?.sessionId) {
    params.push(options.sessionId);
    filter = ` AND id = $${params.length}`;
  }

  // Conversa do WhatsApp não oficial (Baileys) nunca é distribuída: o cliente
  // recebe o aviso de que o atendimento agora é pelo número novo (Pyvon) e a
  // conversa fica sem responsável (decisão do usuário, 2026-09-24 — ver
  // baileys-redirect.ts). Sem este filtro, qualquer analista ficando Online
  // (ou uma mensagem em outro canal) redistribuiria essas conversas.
  const pendingRes = await query(
    `SELECT id, queue_id, customer_name FROM public.chat_sessions
     WHERE status = 'pending' AND assignee_id IS NULL
       AND COALESCE(channel, '') <> 'whatsapp_baileys'${filter}
     ORDER BY COALESCE(last_message_at, created_at) ASC`,
    params
  );
  if (!pendingRes.rows.length) return [];

  // Cache por fila: várias conversas pendentes costumam ser da mesma fila, e
  // o pool combinado é o mesmo pra todas as conversas de widget.
  const queueCache = new Map<string, RoutingQueue | null>();
  const lastAssigneeByQueue = new Map<string, string>();
  const dispatched: DispatchedSession[] = [];

  for (const row of pendingRes.rows) {
    const cacheKey = row.queue_id || 'combined';
    if (!queueCache.has(cacheKey)) {
      queueCache.set(cacheKey, row.queue_id ? await resolveQueueById(row.queue_id) : await resolveCombinedQueuePool());
    }
    const queue = queueCache.get(cacheKey);
    if (!queue) continue;

    const assigneeId = await runExclusive(`queue-assign:${queue.id ?? 'combined'}`, async () => {
      const pick = await pickNextQueueAssignee(queue, { lastAssigneeId: lastAssigneeByQueue.get(cacheKey) ?? null });
      if (!pick) return null;
      const upd = await query(
        `UPDATE public.chat_sessions
         SET assignee_id = $1, status = 'active', updated_at = NOW()
         WHERE id = $2 AND status = 'pending' AND assignee_id IS NULL
         RETURNING id`,
        [pick, row.id]
      );
      return (upd.rowCount ?? 0) > 0 ? pick : null;
    });

    if (!assigneeId) continue;
    lastAssigneeByQueue.set(cacheKey, assigneeId);
    dispatched.push({ sessionId: row.id, assigneeId, customerName: row.customer_name ?? null });
  }

  return dispatched;
}

// Estratégia "Equilíbrio diário" (item 14): em vez de seguir a ordem fixa do
// rodízio, manda pra quem tem MENOS chats recebidos hoje (todos os canais,
// WhatsApp + chat interno juntos — mesma contagem unificada do item 6).
// Empate cai pra ordem de `rotation` (primeiro entre os empatados); se
// autocorrige na rodada seguinte porque quem acabou de receber sai do empate.
async function pickByDailyLoad(rotation: string[]): Promise<string> {
  const res = await query(
    `SELECT assignee_id, COUNT(*)::int AS count
     FROM public.chat_sessions
     WHERE assignee_id = ANY($1::uuid[]) AND created_at >= date_trunc('day', NOW())
     GROUP BY assignee_id`,
    [rotation]
  );
  const counts = new Map<string, number>(res.rows.map((r: any) => [r.assignee_id, r.count]));

  let best = rotation[0];
  let bestCount = counts.get(best) ?? 0;
  for (const id of rotation) {
    const count = counts.get(id) ?? 0;
    if (count < bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}
