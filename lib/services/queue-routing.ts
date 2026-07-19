import { query } from '@/lib/db';

// id === null representa o pool combinado usado por chats sem fila única
// (ver resolveCombinedQueuePool) — não é uma fila real, então o rodízio não
// filtra por queue_id, só pelo conjunto de membros.
export interface RoutingQueue {
  id: string | null;
  memberIds: string[];
}

// Fila vinculada à instância de WhatsApp que recebeu a mensagem.
export async function resolveQueueForInstance(instanceId: string): Promise<RoutingQueue | null> {
  const res = await query('SELECT id, member_ids FROM public.queues WHERE whatsapp_instance_id = $1 LIMIT 1', [instanceId]);
  const row = res.rows[0];
  if (!row) return null;
  return { id: row.id, memberIds: row.member_ids || [] };
}

// Conversas de usuário logado (widget do portal) não chegam por nenhum número
// de WhatsApp, então não há uma fila única pra escolher — em vez de exigir
// configurar uma fila especial, junta os membros de TODAS as filas
// configuradas (que não tenham optado por ficar de fora, via
// include_internal_chats) num único pool e faz o mesmo rodízio, com o mesmo
// comportamento (só quem está online participa) das conversas de WhatsApp.
export async function resolveCombinedQueuePool(): Promise<RoutingQueue | null> {
  const res = await query('SELECT member_ids FROM public.queues WHERE include_internal_chats = true');
  const memberIds = Array.from(new Set(res.rows.flatMap((r: any) => (r.member_ids || []) as string[])));
  if (!memberIds.length) return null;
  return { id: null, memberIds };
}

// Distribuição round-robin entre os analistas da fila (ou do pool combinado)
// que estão online agora: pega quem foi atribuído por último e passa para o
// próximo da lista (na ordem salva em member_ids), pulando quem não está
// online. Sem alguém online, devolve null e o atendimento cai como 'pending'
// para atribuição manual.
export async function pickNextQueueAssignee(queue: RoutingQueue): Promise<string | null> {
  const { id: queueId, memberIds } = queue;
  if (!memberIds.length) return null;

  const onlineRes = await query(
    `SELECT user_id FROM public.analyst_status WHERE user_id = ANY($1::uuid[]) AND is_online = true`,
    [memberIds]
  );
  const onlineIds = new Set(onlineRes.rows.map((r: any) => r.user_id));
  const rotation = memberIds.filter(id => onlineIds.has(id));
  if (!rotation.length) return null;

  // Fila real: olha só o rodízio dela. Pool combinado (sem queue_id): olha o
  // último atendimento atribuído a qualquer um desses membros, em qualquer fila.
  const lastRes = queueId
    ? await query(
        `SELECT assignee_id FROM public.chat_sessions
         WHERE queue_id = $1 AND assignee_id IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
        [queueId]
      )
    : await query(
        `SELECT assignee_id FROM public.chat_sessions
         WHERE assignee_id = ANY($1::uuid[])
         ORDER BY created_at DESC LIMIT 1`,
        [memberIds]
      );
  const lastAssignee = lastRes.rows[0]?.assignee_id;
  const lastIndex = lastAssignee ? rotation.indexOf(lastAssignee) : -1;
  return rotation[(lastIndex + 1) % rotation.length];
}
