import { apiJson } from '../api-client';

/**
 * Operações de atendimento e de chamado ligadas à conversa, do lado do cliente
 * — substitui assignChatSession / returnChatSessionToQueue /
 * saveTicketFromChatSession / linkChatSessionToTicket / mergeTickets /
 * duplicateTicket / closeChatSessionAfterTicket na separação front/back.
 *
 * Assinaturas idênticas às das Server Actions: as telas trocam só o import.
 */

/**
 * Uniões discriminadas, e não um objeto de campos opcionais: as telas fazem
 * `if ('error' in result) return;` e, logo depois, leem `result.ticketId` sem
 * checar de novo. Com campos opcionais o TypeScript não estreita o tipo e essa
 * leitura vira `string | undefined` — os mesmos formatos das Server Actions
 * originais estão preservados aqui de propósito.
 */
type Falha = { error: string };
type SucessoSimples = { success: true };
type ChamadoResultado = { ticketId: string; ticketNumber: number };

async function post<T>(body: Record<string, unknown>, fallback: string): Promise<T | Falha> {
  try {
    return await apiJson<T>('/api/chat-sessions', { method: 'POST', body: JSON.stringify(body) });
  } catch (err: any) {
    return { error: err?.message || fallback };
  }
}

export async function assignChatSession(
  sessionId: string,
  assigneeId: string,
  actingUserId?: string
): Promise<SucessoSimples | Falha> {
  return post({ action: 'assign', sessionId, assigneeId, actingUserId }, 'Erro ao atualizar o atendimento.');
}

export async function returnChatSessionToQueue(
  sessionId: string,
  queueId: string,
  actingUserId: string
): Promise<SucessoSimples | Falha> {
  return post(
    { action: 'return-to-queue', sessionId, queueId, actingUserId },
    'Erro ao devolver o atendimento para a fila.'
  );
}

export async function closeChatSessionAfterTicket(
  sessionId: string,
  awaitingSurveyUntil: string | null
): Promise<SucessoSimples | Falha> {
  return post({ action: 'close', sessionId, awaitingSurveyUntil }, 'Erro ao fechar o atendimento.');
}

export async function saveTicketFromChatSession(
  sessionId: string,
  ticketTitle: string,
  closeTicketImmediately: boolean,
  forceNew: boolean = false
): Promise<ChamadoResultado | Falha> {
  return post(
    { action: 'create-ticket', sessionId, ticketTitle, closeTicketImmediately, forceNew },
    'Erro ao gerar chamado a partir do atendimento.'
  );
}

export async function linkChatSessionToTicket(sessionId: string, ticketId: string): Promise<ChamadoResultado | Falha> {
  return post({ action: 'link-ticket', sessionId, ticketId }, 'Erro ao vincular chamado.');
}

export async function mergeTickets(sourceTicketIds: string[], targetTicketId: string): Promise<(SucessoSimples & ChamadoResultado) | Falha> {
  return post({ action: 'merge-tickets', sourceTicketIds, targetTicketId }, 'Erro ao mesclar chamados.');
}

export async function duplicateTicket(ticketId: string): Promise<ChamadoResultado | Falha> {
  return post({ action: 'duplicate-ticket', ticketId }, 'Erro ao duplicar chamado.');
}
