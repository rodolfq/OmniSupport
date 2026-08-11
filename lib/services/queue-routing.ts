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
export async function pickNextQueueAssignee(
  queue: RoutingQueue,
  options?: { lastAssigneeId?: string | null }
): Promise<string | null> {
  const { memberIds, strategy } = queue;
  if (!memberIds.length) return null;

  const onlineRes = await query(
    `SELECT user_id, queue_anchor_at, last_active, status FROM public.analyst_status
     WHERE user_id = ANY($1::uuid[]) AND is_online = true`,
    [memberIds]
  );
  const rotation = onlineRes.rows
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
    .filter((r: any) => deriveLiveStatus({ status: r.status, isOnline: true, lastActive: r.last_active }) === 'online')
    .slice()
    .sort((a: any, b: any) => new Date(a.queue_anchor_at ?? 0).getTime() - new Date(b.queue_anchor_at ?? 0).getTime())
    .map((r: any) => r.user_id as string);
  if (!rotation.length) return null;

  if (strategy === 'daily_balance') {
    return pickByDailyLoad(rotation);
  }

  let lastAssignee = options?.lastAssigneeId ?? null;
  if (!lastAssignee) {
    const lastRes = await query(
      `SELECT assignee_id FROM public.chat_sessions
       WHERE assignee_id = ANY($1::uuid[])
       ORDER BY created_at DESC LIMIT 1`,
      [memberIds]
    );
    lastAssignee = lastRes.rows[0]?.assignee_id ?? null;
  }
  const lastIndex = lastAssignee ? rotation.indexOf(lastAssignee) : -1;
  return rotation[(lastIndex + 1) % rotation.length];
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

  const pendingRes = await query(
    `SELECT id, queue_id, customer_name FROM public.chat_sessions
     WHERE status = 'pending' AND assignee_id IS NULL${filter}
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
