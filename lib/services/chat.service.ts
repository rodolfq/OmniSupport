import { supabase } from '../supabase';
import { ChatSession, ChatMessage } from '../types';

function mapChatSession(s: any): ChatSession {
    const messages = (s.messages || [])
        .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((m: any) => ({
            id: m.id,
            senderId: m.sender_id,
            senderName: m.sender_name,
            text: m.text,
            timestamp: m.created_at,
            type: m.type,
            metadata: m.metadata
        }));

    return {
        id: s.id,
        customerId: s.customer_id,
        customerName: s.customer_name,
        customerPhone: s.customer_phone,
        assigneeId: s.assignee_id,
        queueId: s.queue_id,
        status: s.status,
        messages,
        startedAt: s.created_at,
        lastMessageAt: s.last_message_at || s.created_at
    };
}

export async function fetchChatSessions(signal?: AbortSignal): Promise<ChatSession[]> {
    if (!supabase) {
        console.warn("Supabase not initialized");
        return [];
    }

    let query = supabase
        .from('chat_sessions')
        .select(`
            *,
            messages:chat_messages!chat_messages_session_id_fkey(
              id, sender_id, sender_name, text, type, metadata, created_at
            )
        `)
        .order('created_at', { ascending: false });

    if (signal) {
        query = query.abortSignal(signal as any);
    }

    const { data, error } = await query;

    if (error) {
        const isAbortError =
            error.message === 'FetchIsAborted' ||
            error.code === '20' ||
            error.message?.toLowerCase().includes('aborted') ||
            error.message?.toLowerCase().includes('lock broken');
        if (isAbortError) return [];
        console.error("Error fetching chat sessions:", error);
        return [];
    }

    return (data || []).map(mapChatSession) as ChatSession[];
}

export async function pushChatMessage(sessionId: string, message: ChatMessage): Promise<void> {
    if (!supabase) {
        throw new Error('Supabase not initialized');
    }
    
    const { error } = await supabase
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
    
    // Update last_message_at on session
    const { error: sessionError } = await supabase
        .from('chat_sessions')
        .update({ last_message_at: message.timestamp })
        .eq('id', sessionId);
        
    if (sessionError) {
        console.error("Error updating session last_message_at:", sessionError);
    }
}

export async function createChatSession(session: ChatSession): Promise<string> {
    if (!supabase) {
        throw new Error('Supabase not initialized');
    }
    
    const { data, error } = await supabase
        .from('chat_sessions')
        .insert({
          customer_id: session.customerId,
          customer_name: session.customerName,
          customer_phone: session.customerPhone,
          status: session.status,
          created_at: session.startedAt,
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();
        
    if (error) {
        console.error("Error creating chat session:", error);
        throw error;
    }
    
    return data?.id || session.id;
}

export async function saveChatHistory(history: {
   sessionId: string;
   customerId?: string;
   customerName?: string;
   customerPhone?: string;
   assigneeId?: string;
   startedAt: string;
   finishedAt: string;
   durationSeconds?: number;
   firstResponseSeconds?: number;
   rating?: number;
   transcript: string;
}): Promise<void> {
    if (!supabase) {
        throw new Error('Supabase not initialized');
    }
    
    const payload = {
      session_id: history.sessionId,
      customer_id: history.customerId,
      customer_name: history.customerName,
      customer_phone: history.customerPhone,
      assignee_id: history.assigneeId,
      started_at: history.startedAt,
      finished_at: history.finishedAt,
      duration_seconds: history.durationSeconds,
      first_response_seconds: history.firstResponseSeconds,
      rating: history.rating,
      transcript: history.transcript
    };
    
    console.log('saveChatHistory payload:', payload);
    
    const { error } = await supabase
        .from('chat_histories')
        .insert(payload);
        
    if (error) {
        console.error("Error saving chat history:", {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint
        });
        throw new Error(error.message || 'Unknown error saving chat history');
    }
}

export async function getChatHistories(signal?: AbortSignal): Promise<any[]> {
    if (!supabase) {
        console.warn("Supabase not initialized");
        return [];
    }
    
    const { data, error } = await supabase
        .from('chat_histories')
        .select(`
            *,
            customer:profiles!chat_histories_customer_id_fkey(name),
            assignee:profiles!chat_histories_assignee_id_fkey(name)
        `)
        .abortSignal(signal as any)
        .order('finished_at', { ascending: false });
        
    if (error) {
        const isAbortError = 
            error.message === 'FetchIsAborted' || 
            error.code === '20' || 
            error.message?.toLowerCase().includes('aborted') ||
            error.message?.toLowerCase().includes('lock broken');
        if (isAbortError) return [];
        console.error("Error fetching chat histories:", error);
        throw error;
    }
    
    return (data || []).map((h: any) => ({
        id: h.id,
        sessionId: h.session_id,
        customerId: h.customer_id,
        customerName: h.customer_name || h.customer?.name,
        customerPhone: h.customer_phone,
        assigneeId: h.assignee_id,
        assigneeName: h.assignee?.name,
        startedAt: h.started_at,
        finishedAt: h.finished_at,
        durationSeconds: h.duration_seconds,
        firstResponseSeconds: h.first_response_seconds,
        rating: h.rating,
        transcript: h.transcript
    }));
}