import { ChatSession, ChatMessage, AnalystStatus, UserStatusHistory, AbsenceReason, User, InternalGroup } from '../types';
import { normalizePhone } from '../utils';

export class ChatService {
  // userId opcional: quando informado, o servidor marca como "entregues" (2o
  // check, cinza) as mensagens das sessões desse usuário (cliente dono ou
  // analista responsável) só de sincronizar a lista — ver app/api/chats/route.ts.
  static async getSessions(userId?: string): Promise<ChatSession[]> {
    const url = userId ? `/api/chats?action=sessions&userId=${encodeURIComponent(userId)}` : '/api/chats?action=sessions';
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`Error fetching chat sessions via API (status ${res.status}): ${body.error || res.statusText}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  static async save(session: ChatSession): Promise<void> {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save-session', session })
    });
    if (!res.ok) throw new Error('Error saving chat session via API');
  }

  // Devolve o id da sessão que efetivamente recebeu a mensagem — normalmente o
  // mesmo sessionId enviado, mas pode ser um id NOVO quando a sessão original
  // já estava encerrada de verdade (fora da janela de pesquisa): nesse caso o
  // servidor cria um novo atendimento em vez de reabrir o antigo, e quem
  // chamou precisa atualizar a conversa ativa pra esse novo id.
  static async pushMessage(sessionId: string, message: ChatMessage): Promise<string> {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'push-message', sessionId, message })
    });
    if (!res.ok) throw new Error('Error pushing message via API');
    const data = await res.json().catch(() => ({}));
    return data.sessionId || sessionId;
  }

  static async sendTyping(sessionId: string, userId: string, userName: string): Promise<void> {
    await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'chat-typing', sessionId, userId, userName })
    }).catch(() => {});
  }

  static async markMessagesRead(sessionId: string, userId: string): Promise<void> {
    await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark-chat-messages-read', sessionId, userId })
    }).catch(() => {});
  }

  static async toggleReaction(messageId: string, userId: string, emoji: string): Promise<void> {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle-chat-message-reaction', messageId, userId, emoji })
    });
    if (!res.ok) throw new Error('Error toggling reaction via API');
  }

  static async editMessage(messageId: string, userId: string, text: string): Promise<void> {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'edit-chat-message', messageId, userId, text })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Error editing message via API');
    }
  }

  static async deleteMessage(messageId: string, userId: string): Promise<void> {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete-chat-message', messageId, userId })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Error deleting message via API');
    }
  }

  static async getMessageHistory(messageId: string): Promise<{ previousText: string; editedAt: string; editedByName: string | null }[]> {
    const res = await fetch(`/api/chats?action=chat-message-history&messageId=${encodeURIComponent(messageId)}`);
    if (!res.ok) throw new Error('Error fetching message history via API');
    return res.json();
  }
}

export class AnalystService {
  static async getStatus(): Promise<AnalystStatus[]> {
    const res = await fetch('/api/chats?action=analyst-status');
    return res.json();
  }

  static async saveStatus(status: AnalystStatus): Promise<void> {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save-status', status })
    });
    if (!res.ok) throw new Error('Error saving status via API');
  }

  static async logStatusChange(userId: string, status: 'online' | 'away' | 'offline', reason?: string): Promise<void> {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'log-status-change', userId, status, reason })
    });
    if (!res.ok) throw new Error('Error logging status change via API');
  }
}

export class UserStatusHistoryService {
  static async getAll(): Promise<UserStatusHistory[]> {
    const res = await fetch('/api/chats?action=status-history');
    return res.json();
  }
}

export class AbsenceReasonService {
  static async getAll(): Promise<AbsenceReason[]> {
    const res = await fetch('/api/chats?action=absence-reasons');
    return res.json();
  }

  static async save(reason: { label: string }): Promise<void> {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save-absence-reason', reason })
    });
    if (!res.ok) throw new Error('Error saving absence reason via API');
  }

  static async delete(id: string): Promise<void> {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete-absence-reason', id })
    });
    if (!res.ok) throw new Error('Error deleting absence reason via API');
  }
}

export class InternalChatService {
  static async getChats(): Promise<InternalGroup[]> {
    const res = await fetch('/api/chats?action=internal-chats');
    return res.json();
  }

  static async getMessages(chatId: string): Promise<ChatMessage[]> {
    const res = await fetch(`/api/chats?action=internal-messages&chatId=${chatId}`);
    return res.json();
  }

  // Devolve o id da conversa que efetivamente foi gravada — normalmente o
  // mesmo chat.id enviado, mas pode ser um id JÁ EXISTENTE quando o servidor
  // detecta que já existe uma conversa direct com esse mesmo par de membros
  // (dedupe em app/api/chats/route.ts): quem chamou precisa selecionar essa
  // conversa "trocada", não a que tentou criar. Mesmo padrão de
  // ChatService.pushMessage acima.
  static async saveChat(chat: InternalGroup): Promise<string> {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save-internal-chat', chat })
    });
    if (!res.ok) throw new Error('Error saving internal chat via API');
    const data = await res.json().catch(() => ({}));
    return data.chatId || chat.id;
  }

  static async saveMessage(chatId: string, message: ChatMessage): Promise<void> {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save-internal-message', chatId, message })
    });
    if (!res.ok) throw new Error('Error saving internal message via API');
  }

  static async deleteMessage(chatId: string, messageId: string, userId: string): Promise<void> {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete-internal-message', chatId, messageId, userId })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Error deleting internal message via API');
    }
  }

  static async sendTyping(chatId: string, userId: string, userName: string): Promise<void> {
    await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'internal-chat-typing', chatId, userId, userName })
    }).catch(() => {});
  }

  static async toggleReaction(messageId: string, userId: string, emoji: string): Promise<void> {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle-internal-message-reaction', messageId, userId, emoji })
    });
    if (!res.ok) throw new Error('Error toggling reaction via API');
  }
}

// Compatibility helper functions

function phoneSessionLookupVariants(phone: string): string[] {
  const digits = normalizePhone(phone);
  if (!digits) return [];
  const variants = new Set<string>([digits]);
  if (digits.startsWith('55') && digits.length > 11) {
    variants.add(digits.slice(2));
  } else if (digits.length <= 11) {
    variants.add(`55${digits}`);
  }
  return [...variants];
}

function isLikelyDialablePhone(digits: string): boolean {
  return digits.startsWith('55') && digits.length >= 12 && digits.length <= 13;
}

export async function findExistingChatSessionByPhone(phone: string): Promise<string | null> {
  const sessions = await ChatService.getSessions();
  const variants = phoneSessionLookupVariants(phone);
  if (!variants.length) return null;

  const match = sessions
    .filter(s => variants.includes(normalizePhone(s.customerPhone || '')))
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

  if (!match.length) return null;

  const dialable = match.find(s => isLikelyDialablePhone(normalizePhone(s.customerPhone || '')));
  return (dialable || match[0]).id;
}

export async function fetchChatSessions(signal?: AbortSignal, userId?: string): Promise<ChatSession[]> {
  try {
    const sessions = await ChatService.getSessions(userId);
    return Array.isArray(sessions) ? sessions : [];
  } catch (err) {
    console.error("Error fetching chat sessions:", err);
    return [];
  }
}

export async function pushChatMessage(sessionId: string, message: ChatMessage): Promise<string> {
  return ChatService.pushMessage(sessionId, message);
}

export async function submitSurveyResponse(sessionId: string, rating: 0 | 1, message: ChatMessage): Promise<void> {
  const res = await fetch('/api/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'submit-survey-response', sessionId, rating, message })
  });
  if (!res.ok) throw new Error('Error submitting survey response via API');
}

export async function createChatSession(session: ChatSession): Promise<string> {
  const res = await fetch('/api/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create-session', session })
  });
  if (!res.ok) throw new Error('Error creating session via API');
  const data = await res.json();
  return data.id;
}

export async function saveChatHistory(history: any): Promise<void> {
  const res = await fetch('/api/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'save-history', history })
  });
  if (!res.ok) throw new Error('Error saving chat history via API');
}

export async function getChatHistories(signal?: AbortSignal): Promise<any[]> {
  try {
    const res = await fetch('/api/chats?action=histories');
    return res.json();
  } catch (err) {
    console.error("Error fetching chat histories:", err);
    return [];
  }
}

export interface PreviousChatHistoriesResult {
  total: number;
  histories: Array<{
    id: string;
    sessionId: string;
    customerName?: string;
    assigneeName?: string;
    startedAt: string;
    finishedAt: string;
    durationSeconds?: number;
    rating?: number;
  }>;
}

// Resumo dos atendimentos ANTERIORES do mesmo contato (por customer_id ou
// customer_phone), pra exibir dentro do chat em andamento — ver "Carregar
// histórico anterior" em chat-widget.tsx. Paginado (+2 em +2 por padrão).
export async function getPreviousChatHistories(params: {
  customerId?: string;
  customerPhone?: string;
  excludeSessionId?: string;
  limit?: number;
  offset?: number;
}): Promise<PreviousChatHistoriesResult> {
  try {
    const qs = new URLSearchParams({ action: 'previous-histories' });
    if (params.customerId) qs.set('customerId', params.customerId);
    if (params.customerPhone) qs.set('customerPhone', params.customerPhone);
    if (params.excludeSessionId) qs.set('excludeSessionId', params.excludeSessionId);
    qs.set('limit', String(params.limit ?? 2));
    qs.set('offset', String(params.offset ?? 0));
    const res = await fetch(`/api/chats?${qs.toString()}`);
    if (!res.ok) return { total: 0, histories: [] };
    return res.json();
  } catch (err) {
    console.error("Error fetching previous chat histories:", err);
    return { total: 0, histories: [] };
  }
}

// Atendimentos finalizados de uma empresa — tela dedicada /customers/[id]
// (item 13 do roadmap). Mesmo formato de PreviousChatHistoriesResult.
export async function getChatHistoriesByCompany(companyId: string, limit = 10, offset = 0): Promise<PreviousChatHistoriesResult> {
  try {
    const qs = new URLSearchParams({ action: 'histories-by-company', companyId, limit: String(limit), offset: String(offset) });
    const res = await fetch(`/api/chats?${qs.toString()}`);
    if (!res.ok) return { total: 0, histories: [] };
    return res.json();
  } catch (err) {
    console.error("Error fetching chat histories by company:", err);
    return { total: 0, histories: [] };
  }
}

export interface CompanyActiveSession {
  id: string;
  customerName?: string;
  assigneeName?: string;
  status: string;
  startedAt: string;
  lastMessageAt: string;
  ticketId?: string;
  ticketNumber?: number;
}

// Atendimentos EM ANDAMENTO de uma empresa — tela dedicada /customers/[id]
// (item 13 do roadmap). Lista informativa, sem link pra abrir a sessão (não
// existe deep-link pronto pra isso no /chat ainda).
export async function getActiveSessionsByCompany(companyId: string): Promise<CompanyActiveSession[]> {
  try {
    const res = await fetch(`/api/chats?action=sessions-by-company&companyId=${companyId}`);
    if (!res.ok) return [];
    return res.json();
  } catch (err) {
    console.error("Error fetching active sessions by company:", err);
    return [];
  }
}

export interface SessionMessagesResult {
  session: {
    id: string;
    customerName?: string;
    customerPhone?: string;
    status: string;
    startedAt: string;
    lastMessageAt: string;
  };
  messages: ChatMessage[];
}

// Histórico ao vivo de uma sessão específica (inclusive fechada) — usado pela
// aba "Conversa" do chamado vinculado, em vez de duplicar o transcript em
// tickets.description (ver saveTicketFromChatSession em app/actions.ts).
export async function fetchSessionMessages(sessionId: string): Promise<SessionMessagesResult> {
  const res = await fetch(`/api/chats?action=session-messages&sessionId=${sessionId}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Error fetching session messages via API');
  }
  return res.json();
}

export async function transcribeChatAudio(sessionId: string, messageId: string, attachmentId: string): Promise<string> {
  const res = await fetch('/api/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'transcribe-audio', sessionId, messageId, attachmentId })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.transcription) throw new Error(data.error || 'Error transcribing audio via API');
  return data.transcription;
}
