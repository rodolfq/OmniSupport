import { supabase } from '../supabase';
import { ChatSession, ChatMessage, AnalystStatus, UserStatusHistory, AbsenceReason, User, InternalGroup } from '../types';

export class ChatService {
  static async getSessions(): Promise<ChatSession[]> {
    const { data, error } = await supabase
      .from('chat_sessions')
      .select(`
        *,
        messages:chat_messages!chat_messages_session_id_fkey(
          id, sender_id, sender_name, text, type, metadata, created_at
        )
      `);

    if (error) throw error;

    return (data || []).map(s => ({
      id: s.id,
      customerId: s.customer_id,
      customerName: s.customer_name,
      customerPhone: s.customer_phone,
      assigneeId: s.assignee_id,
      queueId: s.queue_id,
      status: s.status,
      messages: (s.messages || []).map((m: any) => ({
        id: m.id,
        senderId: m.sender_id,
        senderName: m.sender_name,
        text: m.text,
        timestamp: m.created_at,
        type: m.type,
        metadata: m.metadata
      })),
      startedAt: s.created_at,
      lastMessageAt: s.last_message_at || s.created_at || new Date().toISOString()
    })) as ChatSession[];
  }

  static async save(session: ChatSession): Promise<void> {
    const { error } = await supabase.from('chat_sessions').upsert({
      id: session.id,
      customer_id: session.customerId,
      customer_name: session.customerName,
      customer_phone: session.customerPhone,
      assignee_id: session.assigneeId,
      queue_id: session.queueId,
      status: session.status,
      created_at: session.startedAt,
      last_message_at: session.lastMessageAt
    });

    if (error) throw error;
  }

  static async pushMessage(sessionId: string, message: ChatMessage): Promise<void> {
    const { error } = await supabase.from('chat_messages').upsert({
      id: message.id,
      session_id: sessionId,
      sender_id: message.senderId,
      sender_name: message.senderName,
      text: message.text,
      type: message.type,
      metadata: message.metadata,
      created_at: message.timestamp
    });

    if (error) throw error;

    // Update last_message_at on session
    const { error: sessionError } = await supabase
      .from('chat_sessions')
      .update({ last_message_at: message.timestamp })
      .eq('id', sessionId);

    if (sessionError) throw sessionError;
  }
}

export class AnalystService {
  static async getStatus(): Promise<AnalystStatus[]> {
    const { data, error } = await supabase
      .from('analyst_status')
      .select('*');

    if (error) throw error;
    return (data || []).map(s => ({
      userId: s.user_id,
      isOnline: s.is_online,
      lastActive: s.last_active,
      currentLoad: s.current_load,
      currentReason: s.current_reason
    })) as AnalystStatus[];
  }

  static async saveStatus(status: AnalystStatus): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || status.userId !== user.id) return;

    const { error } = await supabase.from('analyst_status').upsert({
      user_id: status.userId,
      is_online: status.isOnline,
      last_active: status.lastActive,
      current_load: status.currentLoad
    });

    if (error) throw error;
  }

  static async logStatusChange(userId: string, status: 'online' | 'away' | 'offline', reason?: string): Promise<void> {
    // Update current status
    const { error: statusError } = await supabase
      .from('analyst_status')
      .update({
        current_reason: reason || null,
        is_online: status === 'online',
        last_active: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (statusError) throw statusError;

    // Insert history
    const { error: historyError } = await supabase
      .from('user_status_history')
      .insert({
        user_id: userId,
        status: status,
        reason: reason || null,
        timestamp: new Date().toISOString()
      });

    if (historyError) throw historyError;
  }
}

export class UserStatusHistoryService {
  static async getAll(): Promise<UserStatusHistory[]> {
    const { data, error } = await supabase
      .from('user_status_history')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(500);

    if (error) throw error;
    return (data || []).map(h => ({
      id: h.id,
      userId: h.user_id,
      status: h.status,
      reason: h.reason,
      timestamp: h.timestamp,
      duration: h.duration
    })) as UserStatusHistory[];
  }
}

export class AbsenceReasonService {
  static async getAll(): Promise<AbsenceReason[]> {
    const { data, error } = await supabase
      .from('absence_reasons')
      .select('*');

    if (error) throw error;
    return (data || []).map(r => ({ id: r.id, label: r.label })) as AbsenceReason[];
  }

  static async save(reason: { label: string }): Promise<void> {
    const { error } = await supabase.from('absence_reasons').insert({
      label: reason.label
    });

    if (error) throw error;
  }

  static async delete(id: string): Promise<void> {
    const { error } = await supabase.from('absence_reasons').delete().eq('id', id);
    if (error) throw error;
  }
}

// Internal Chat Service - for internal team messaging
export class InternalChatService {
  static async getChats(): Promise<InternalGroup[]> {
    const { data, error } = await supabase
      .from('internal_chats')
      .select('*')
      .order('last_message_at', { ascending: false });

    if (error) throw error;
    return (data || []).map(c => ({
      id: c.id,
      name: c.name,
      imageUrl: c.image_url,
      type: c.type,
      memberIds: c.member_ids || [],
      messages: [],
      lastMessageAt: c.last_message_at || c.created_at
    })) as InternalGroup[];
  }

  static async getMessages(chatId: string): Promise<ChatMessage[]> {
    const { data, error } = await supabase
      .from('internal_chat_messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data || []).map(m => ({
      id: m.id,
      senderId: m.sender_id,
      senderName: m.sender_name,
      text: m.text,
      timestamp: m.created_at,
      type: m.type,
      metadata: m.metadata,
      readBy: [],
      attachments: m.metadata?.attachments || []
    })) as ChatMessage[];
  }

  static async saveChat(chat: InternalGroup): Promise<void> {
    const { error } = await supabase.from('internal_chats').upsert({
      id: chat.id,
      name: chat.name,
      image_url: chat.imageUrl,
      type: chat.type,
      member_ids: chat.memberIds || [],
      last_message_at: chat.lastMessageAt
    });

    if (error) throw error;
  }

  static async saveMessage(chatId: string, message: ChatMessage): Promise<void> {
    const { error } = await supabase.from('internal_chat_messages').insert({
      chat_id: chatId,
      sender_id: message.senderId,
      sender_name: message.senderName,
      text: message.text,
      type: message.type,
      metadata: { ...message.metadata, attachments: message.attachments || [] }
    });

    if (error) throw error;

    // Update chat last_message_at
    const { error: updateError } = await supabase
      .from('internal_chats')
      .update({ last_message_at: message.timestamp })
      .eq('id', chatId);

    if (updateError) throw updateError;
  }
}