import { ChatSession, ChatMessage, AnalystStatus, UserStatusHistory, AbsenceReason, User, InternalGroup } from '../types';
import { closeChatSessionAfterTicket } from '@/app/actions';
import { normalizeBrazilianPhoneDigits } from '../utils';

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
  static async getAll(filters?: { userId?: string; from?: string; to?: string }): Promise<UserStatusHistory[]> {
    const params = new URLSearchParams({ action: 'status-history' });
    if (filters?.userId && filters.userId !== 'all') params.set('userId', filters.userId);
    if (filters?.from) params.set('from', filters.from);
    if (filters?.to) params.set('to', filters.to);
    const res = await fetch(`/api/chats?${params.toString()}`);
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

// Acha/retoma ou cria a sessão de WhatsApp pro número informado — usado
// tanto pelo modal manual "Novo WhatsApp" quanto pelo clique num número de
// telefone detectado dentro do texto de uma mensagem (ver
// components/linked-chat-text.tsx), em mais de uma tela (ChatWidget e o
// preview de conversa em chat-management/page.tsx), daí viver aqui em vez
// de dentro de um componente. Uma única chamada a create-session: achar
// sessão existente, casar telefone com funcionário/cliente cadastrado (pra
// nome/empresa corretos) e criar/atualizar tudo roda no servidor, dentro do
// mesmo lock (ver app/api/chats/route.ts) — nada disso é decidido aqui, só
// repassamos o telefone e lemos de volta o que o servidor resolveu
// (`reused`), em vez de fazer 2-3 requisições prévias (getSessions() sem
// filtro chega a trazer TODAS as sessões abertas com mensagens, pesado à
// toa) que ainda corriam risco de o widget ler o resultado antes de pronto.
export async function resolveChatSessionForPhone(
  rawNumber: string,
  displayName?: string
): Promise<{ sessionId: string; reopened: boolean } | { error: string }> {
  // normalizeBrazilianPhoneDigits já resolve "0" de tronco, DDD/prefixo
  // redundante colado antes do "55" e a adição do "55" quando falta — ver
  // lib/utils.ts. Checa o tamanho DEPOIS de normalizar (não antes): boa
  // parte do que corrigimos ali só parece "grande demais" antes de limpar.
  const phone = normalizeBrazilianPhoneDigits(rawNumber.replace(/\D/g, ''));
  if (phone.length > 13) {
    return { error: 'Use o número de telefone (ex: 21991778567), não o ID interno do WhatsApp.' };
  }

  try {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create-session',
        // customerName de propósito ausente quando não informado: deixa o
        // servidor tentar casar por telefone com um perfil cadastrado antes
        // de cair no fallback "nome = telefone" (ver app/api/chats/route.ts).
        session: {
          customerName: displayName || undefined,
          customerPhone: phone,
          status: 'active',
          startedAt: new Date().toISOString()
        }
      })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { error: body.error || 'Erro ao iniciar conversa.' };
    }
    return { sessionId: body.id, reopened: !!body.reused };
  } catch (err: any) {
    console.error('Error resolving chat session for phone:', err);
    return { error: 'Erro ao iniciar conversa.' };
  }
}

export interface PhoneMatchedProfile {
  id: string;
  name: string;
  role: string;
  companyId: string | null;
  companyName: string | null;
}

export interface ActiveSessionInfo {
  id: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  startedAt: string;
  lastMessageAt: string;
}

export interface ContactLookupResult {
  profile: PhoneMatchedProfile | null;
  activeSession: ActiveSessionInfo | null;
}

// Leitura pura pro painel de confirmação (ver components/phone-contact-panel.tsx)
// — não acha/cria sessão nenhuma, só diz o que existe pra esse telefone.
export async function getContactLookup(phone: string): Promise<ContactLookupResult> {
  try {
    const res = await fetch(`/api/chats?action=contact-lookup&phone=${encodeURIComponent(phone)}`);
    if (!res.ok) return { profile: null, activeSession: null };
    return await res.json();
  } catch (err) {
    console.error('Error looking up contact by phone:', err);
    return { profile: null, activeSession: null };
  }
}

// Encerra a sessão informada (salva transcript completo em chat_histories,
// mesmo formato de handleDuplicateChat em chat-widget.tsx) e abre uma nova
// pro mesmo contato — usado tanto por "Duplicar conversa" (dentro de um chat
// já aberto) quanto pelo botão "Encerrar e iniciar nova" do painel de
// contato, quando o telefone clicado já tem uma conversa em andamento.
export async function closeAndStartFreshSession(
  session: { id: string; customerId?: string | null; customerName?: string | null; customerPhone?: string | null; assigneeId?: string | null; startedAt: string },
  currentUserId: string
): Promise<string> {
  const { messages } = await fetchSessionMessages(session.id);

  const formattedChatLog = messages.map(m => {
    const time = new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `[${time}] ${m.senderName}: ${m.text}`;
  }).join('\n');
  const chatHistoryText = `===== HISTÓRICO DO CHAT =====\n${formattedChatLog}\n===== FIM DO HISTÓRICO =====\n\nConversa encerrada em: ${new Date().toLocaleString('pt-BR')} (novo atendimento aberto para o mesmo contato)`;

  const startedAt = session.startedAt ? new Date(session.startedAt) : new Date();
  const finishedAt = new Date();
  const durationSeconds = Math.floor((finishedAt.getTime() - startedAt.getTime()) / 1000);

  const firstAnalystMsg = messages.find(m =>
    m.senderId !== session.customerId &&
    m.type !== 'system' &&
    m.text &&
    !m.text.includes('criou o grupo')
  );
  const firstResponseSeconds = firstAnalystMsg?.timestamp
    ? Math.floor((new Date(firstAnalystMsg.timestamp).getTime() - startedAt.getTime()) / 1000)
    : undefined;

  await saveChatHistory({
    sessionId: session.id,
    customerId: session.customerId,
    customerName: session.customerName,
    customerPhone: session.customerPhone,
    assigneeId: session.assigneeId || currentUserId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationSeconds,
    firstResponseSeconds,
    transcript: chatHistoryText
  });

  await closeChatSessionAfterTicket(session.id, null);

  return createChatSession({
    customerId: session.customerId,
    customerName: session.customerName,
    customerPhone: session.customerPhone,
    status: 'active',
    startedAt: new Date().toISOString()
  } as any);
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

export interface ChatSummaryResult {
  summary: string;
  generatedAt: string;
  cached: boolean;
}

// "Chat Resumido" — gera (se ainda não existir) ou retorna o resumo por IA
// já salvo em chat_histories.summary. Usado pelo toggle "Chat completo /
// Chat Resumido" em app/(portal)/chat-history/page.tsx. Lança com a mensagem
// vinda da API (motivo claro da falha — ver app/api/chats/route.ts) em vez
// de um erro genérico.
export async function summarizeChatHistory(historyId: string): Promise<ChatSummaryResult> {
  const res = await fetch('/api/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'summarize-history', historyId })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Não foi possível gerar o resumo desta conversa.');
  return data;
}

export async function requeueDissatisfaction(historyId: string): Promise<void> {
  const res = await fetch('/api/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'requeue-dissatisfaction', historyId })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Não foi possível reprocessar esta conversa.');
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
