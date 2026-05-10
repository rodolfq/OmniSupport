import { supabase } from '../supabase';
import { ChatSession, ChatMessage } from '../types';

export async function fetchChatSessions(signal?: AbortSignal): Promise<ChatSession[]> {
    if (!supabase) {
        console.warn("Supabase not initialized");
        return [];
    }
    
    // Create a query and pass the abort signal via the browser's fetch options if possible
    // Supabase v2 uses Cross-Fetch which supports AbortSignal in headers/options
    const { data, error } = await supabase
        .from('chat_sessions')
        .select(`
            *,
            chat_messages (*)
        `)
        .abortSignal(signal as any)
        .order('created_at', { ascending: false });
        
    if (error) {
        const isAbortError = 
            error.message === 'FetchIsAborted' || 
            error.code === '20' || 
            error.message?.toLowerCase().includes('aborted') ||
            error.message?.toLowerCase().includes('lock broken') ||
            error.message?.toLowerCase().includes('request was aborted');

        if (isAbortError) {
            return []; // Silently handle aborted or lock-stealing requests
        }
        console.error("Error fetching chat sessions:", error.message, error.details, error.hint);
        throw error;
    }
    
    // Transform data to match ChatSession type
    return (data || []).map((s: any) => ({
      id: s.id,
      customerId: s.customer_id,
      customerName: s.customer_name,
      customerPhone: s.customer_phone,
      assigneeId: s.assignee_id,
      queueId: s.queue_id,
      status: s.status,
      messages: (s.chat_messages || []).map((m: any) => ({
        id: m.id,
        senderId: m.sender_id,
        senderName: m.sender_name,
        text: m.text,
        timestamp: m.created_at,
        type: m.type,
        metadata: m.metadata
      })),
      startedAt: s.created_at,
      lastMessageAt: s.created_at
    })) as ChatSession[];
}

export async function pushChatMessage(sessionId: string, message: ChatMessage): Promise<void> {
    const { error } = await supabase!
        .from('chat_messages')
        .insert({
          session_id: sessionId,
          sender_id: message.senderId,
          sender_name: message.senderName,
          text: message.text,
          created_at: message.timestamp,
          type: message.type,
          metadata: message.metadata
        });
        
    if (error) {
        console.error("Error creating chat message:", error);
        throw error;
    }
}
