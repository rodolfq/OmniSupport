import { query } from '@/lib/db';

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
// da lista (na ordem salva em member_ids), pulando quem não está online.
// "Ausente" já entra como não-online aqui (ver updateUserStatus/log-status-
// change, que grava is_online=false para status 'away'): não é elegível pra
// receber, mas também não perde a posição — a ordem-base (member_ids) nunca
// muda, só quem está elegível agora entra ou sai do rodízio calculado.
// Sem ninguém online, devolve null e o atendimento cai como 'pending' para
// atribuição manual.
export async function pickNextQueueAssignee(queue: RoutingQueue): Promise<string | null> {
  const { memberIds, strategy } = queue;
  if (!memberIds.length) return null;

  const onlineRes = await query(
    `SELECT user_id FROM public.analyst_status WHERE user_id = ANY($1::uuid[]) AND is_online = true`,
    [memberIds]
  );
  const onlineIds = new Set(onlineRes.rows.map((r: any) => r.user_id));
  const rotation = memberIds.filter(id => onlineIds.has(id));
  if (!rotation.length) return null;

  if (strategy === 'daily_balance') {
    return pickByDailyLoad(rotation);
  }

  const lastRes = await query(
    `SELECT assignee_id FROM public.chat_sessions
     WHERE assignee_id = ANY($1::uuid[])
     ORDER BY created_at DESC LIMIT 1`,
    [memberIds]
  );
  const lastAssignee = lastRes.rows[0]?.assignee_id;
  const lastIndex = lastAssignee ? rotation.indexOf(lastAssignee) : -1;
  return rotation[(lastIndex + 1) % rotation.length];
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
