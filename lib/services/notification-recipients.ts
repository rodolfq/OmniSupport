import { query } from '@/lib/db';

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

// Mesma regra usada hoje no polling para chat: se quem mandou a mensagem é da
// equipe, só o cliente da conversa precisa ser avisado; se foi o cliente,
// qualquer membro da equipe (não há "dono" fixo de um chat pendente) deve
// saber que uma nova mensagem chegou.
export async function getChatRecipientIds(
  session: { customerId?: string | null },
  senderId: string | null,
  senderIsTeam: boolean
): Promise<string[]> {
  if (senderIsTeam) {
    return session.customerId ? [session.customerId] : [];
  }
  const teamIds = await getTeamUserIds();
  return senderId ? teamIds.filter(id => id !== senderId) : teamIds;
}
