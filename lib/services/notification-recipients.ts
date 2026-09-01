import { query } from '@/lib/db';
import { notifyUser } from '@/lib/services/push-service';
import { resolveQueueById } from '@/lib/services/queue-routing';

const TEAM_ROLES = ['Administrador', 'Equipe', 'Time Interno'];

export function isTeamRole(role: string | null | undefined): boolean {
  return !!role && TEAM_ROLES.includes(role);
}

export async function getTeamUserIds(): Promise<string[]> {
  const res = await query('SELECT id FROM public.profiles WHERE role = ANY($1::text[])', [TEAM_ROLES]);
  return res.rows.map((r: any) => r.id as string);
}

export interface TicketRecipientInput {
  assigneeId?: string | null;
  createdBy?: string | null;
  customerId?: string | null;
  employeeIds?: string[] | null;
  // false quando a mensagem/atualização não é visível ao cliente (ex: nota interna)
  includeCustomer?: boolean;
}

export interface TicketRecipients {
  // Responsável/criador do chamado — abrem a tela interna (/tickets)
  teamIds: string[];
  // Cliente/funcionários vinculados — abrem a tela do cliente (/my-tickets)
  customerIds: string[];
}

// Aproxima (não reproduz 1:1) a regra de relevância usada no polling de
// notificações (app/api/notifications/check/route.ts): responsável/criador do
// chamado sempre, cliente e funcionários vinculados quando a mudança é
// visível a eles. Separado em dois grupos porque cada um abre uma URL
// diferente ao clicar na notificação.
export function getTicketRecipients(input: TicketRecipientInput, excludeUserId?: string | null): TicketRecipients {
  const teamIds = new Set<string>();
  const customerIds = new Set<string>();

  if (input.assigneeId) teamIds.add(input.assigneeId);
  if (input.createdBy) teamIds.add(input.createdBy);
  if (input.includeCustomer !== false) {
    if (input.customerId) customerIds.add(input.customerId);
    (input.employeeIds || []).forEach(id => customerIds.add(id));
  }

  if (excludeUserId) {
    teamIds.delete(excludeUserId);
    customerIds.delete(excludeUserId);
  }

  return { teamIds: [...teamIds], customerIds: [...customerIds] };
}

export function ticketLabel(ticketNumber?: number | string | null, id?: string): string {
  return ticketNumber ? `#${String(ticketNumber).padStart(4, '0')}` : `#${String(id || '').slice(0, 8)}`;
}

// Único ponto de envio de push nativo pra chamado — antes existia uma cópia
// disso só em app/api/tickets/route.ts. A tela de detalhe do chamado
// (ticket-detail-modal.tsx) não passa por essa rota: ela grava direto via o
// shim Supabase (app/api/compat/supabase/route.ts), que disparava a
// automação (WhatsApp/e-mail) mas nunca chamava isso — resultado, responder
// ou reatribuir um chamado pela tela normal nunca gerava push nativo (o que
// funciona com o app fechado), só arrastar no Kanban ou ação em massa.
export async function pushToTicketRecipients(
  recipients: TicketRecipients,
  payload: { title: string; body: string; ticketId: string; tag: string }
): Promise<void> {
  try {
    await Promise.all([
      ...recipients.teamIds.map(id => notifyUser(id, {
        title: payload.title,
        body: payload.body,
        url: `/tickets?ticket=${payload.ticketId}`,
        tag: payload.tag
      })),
      ...recipients.customerIds.map(id => notifyUser(id, {
        title: payload.title,
        body: payload.body,
        url: `/my-tickets?ticket=${payload.ticketId}`,
        tag: payload.tag
      }))
    ]);
  } catch (err) {
    console.error('[push] Falha ao notificar chamado:', err);
  }
}

// Mensagem do cliente: uma vez que a conversa tem responsável, só ele precisa
// ser avisado — antes disso, notificar todo o time (Administrador+Equipe+
// Time Interno) fazia todo mundo tocar a cada mensagem, mesmo já atribuída.
// Sem responsável, cai no pool de quem atende a fila da conversa; só sem fila
// nenhuma (ou fila sem membros) é que soa pra equipe inteira.
async function getUnassignedChatRecipientIds(queueId?: string | null): Promise<string[]> {
  if (queueId) {
    const queue = await resolveQueueById(queueId);
    if (queue && queue.memberIds.length > 0) return queue.memberIds;
  }
  return getTeamUserIds();
}

// Mesma regra usada hoje no polling para chat: se quem mandou a mensagem é da
// equipe, só o cliente da conversa precisa ser avisado; se foi o cliente, só
// o responsável (quando já atribuído) ou o pool da fila/equipe.
export async function getChatRecipientIds(
  session: { customerId?: string | null; assigneeId?: string | null; queueId?: string | null },
  senderId: string | null,
  senderIsTeam: boolean
): Promise<string[]> {
  if (senderIsTeam) {
    return session.customerId ? [session.customerId] : [];
  }
  const recipientIds = session.assigneeId
    ? [session.assigneeId]
    : await getUnassignedChatRecipientIds(session.queueId);
  return senderId ? recipientIds.filter(id => id !== senderId) : recipientIds;
}
