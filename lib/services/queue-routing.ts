import { query } from '@/lib/db';

export interface RoutingQueue {
  id: string;
  memberIds: string[];
}

// Fila vinculada à origem do atendimento: uma instância de WhatsApp
// específica (mensagem real chegando por lá), ou — quando instanceId é null —
// a fila marcada como "Nenhuma (Chat Interno apenas)" nas Configurações de
// Filas, usada por conversas iniciadas dentro do próprio portal (usuário
// logado abrindo o widget), que não passam por nenhum número de WhatsApp.
export async function resolveQueueForInstance(instanceId: string | null): Promise<RoutingQueue | null> {
  const res = instanceId
    ? await query('SELECT id, member_ids FROM public.queues WHERE whatsapp_instance_id = $1 LIMIT 1', [instanceId])
    : await query('SELECT id, member_ids FROM public.queues WHERE whatsapp_instance_id IS NULL LIMIT 1');
  const row = res.rows[0];
  if (!row) return null;
  return { id: row.id, memberIds: row.member_ids || [] };
}

// Distribuição round-robin entre os analistas da fila que estão online agora:
// pega quem foi atribuído por último num atendimento dessa fila e passa para o
// próximo da lista (na ordem salva em member_ids), pulando quem não está online.
// Sem alguém online na fila, devolve null e o atendimento cai como 'pending'
// para atribuição manual.
export async function pickNextQueueAssignee(queueId: string, memberIds: string[]): Promise<string | null> {
  if (!memberIds.length) return null;

  const onlineRes = await query(
    `SELECT user_id FROM public.analyst_status WHERE user_id = ANY($1::uuid[]) AND is_online = true`,
    [memberIds]
  );
  const onlineIds = new Set(onlineRes.rows.map((r: any) => r.user_id));
  const rotation = memberIds.filter(id => onlineIds.has(id));
  if (!rotation.length) return null;

  const lastRes = await query(
    `SELECT assignee_id FROM public.chat_sessions
     WHERE queue_id = $1 AND assignee_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [queueId]
  );
  const lastAssignee = lastRes.rows[0]?.assignee_id;
  const lastIndex = lastAssignee ? rotation.indexOf(lastAssignee) : -1;
  return rotation[(lastIndex + 1) % rotation.length];
}
