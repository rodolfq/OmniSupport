import { ChatSession, ChatMessage, AnalystStatus, UserStatusHistory, AbsenceReason, User, InternalGroup } from '../types';
import { normalizePhone } from '../utils';

export class ChatService {
  static async getSessions(): Promise<ChatSession[]> {
    const res = await fetch('/api/chats?action=sessions');
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

  static async pushMessage(sessionId: string, message: ChatMessage): Promise<void> {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'push-message', sessionId, message })
    });
    if (!res.ok) throw new Error('Error pushing message via API');
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

  static async saveChat(chat: InternalGroup): Promise<void> {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save-internal-chat', chat })
    });
    if (!res.ok) throw new Error('Error saving internal chat via API');
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

export async function fetchChatSessions(signal?: AbortSignal): Promise<ChatSession[]> {
  try {
    const sessions = await ChatService.getSessions();
    return Array.isArray(sessions) ? sessions : [];
  } catch (err) {
    console.error("Error fetching chat sessions:", err);
    return [];
  }
}

export async function pushChatMessage(sessionId: string, message: ChatMessage): Promise<void> {
  await ChatService.pushMessage(sessionId, message);
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
