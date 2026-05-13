import { supabase } from './supabase';
import { Ticket, Message } from './types'; 

export async function fetchAllTickets(signal?: AbortSignal): Promise<Ticket[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('tickets')
        .select(`
            *,
            customer:profiles!tickets_customer_id_fkey(name),
            assignee:profiles!tickets_assignee_id_fkey(name)
        `)
        .abortSignal(signal as any);
        
    if (error) {
        if (error.message === 'FetchIsAborted' || error.code === '20' || error.message?.includes('aborted')) return [];
        console.error("Error fetching tickets:", error);
        throw error;
    }
    
    // Map to match Ticket type
    return (data || []).map((t: any) => ({
        ...t,
        ticketNumber: t.public_ticket_number,
        companyId: t.company_id,
        customerId: t.customer_id,
        customerName: t.customer?.name,
        assigneeId: t.assignee_id,
        assigneeName: t.assignee?.name,
        createdAt: t.created_at,
        updatedAt: t.updated_at
    })) as Ticket[];
}

export async function getTicketById(id: string, signal?: AbortSignal): Promise<Ticket | null> {
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('tickets')
        .select(`
            *,
            customer:profiles!tickets_customer_id_fkey(name),
            assignee:profiles!tickets_assignee_id_fkey(name)
        `)
        .eq('id', id)
        .abortSignal(signal as any)
        .single();
        
    if (error) {
        if (error.message === 'FetchIsAborted' || error.code === '20' || error.message?.includes('aborted')) return null;
        console.error("Error fetching ticket:", error);
        return null;
    }

    if (!data) return null;
    
    return {
        ...data,
        ticketNumber: data.public_ticket_number,
        companyId: data.company_id,
        customerId: data.customer_id,
        customerName: data.customer?.name,
        assigneeId: data.assignee_id,
        assigneeName: data.assignee?.name,
        createdAt: data.created_at,
        updatedAt: data.updated_at
    } as Ticket;
}

export async function createTicket(ticket: Ticket): Promise<void> {
    console.log("🎟️ createTicket: Iniciando criação...");
    
    if (!supabase) {
        throw new Error("Supabase client não inicializado.");
    }

    // 1. Obter sessão atual de forma robusta
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
        console.error("❌ Erro ao buscar sessão:", sessionError);
    }

    const authUser = session?.user || null;
    
    // 2. Definir UID do usuário (prioridade absoluta para o que vem da sessão)
    const userId = authUser?.id || ticket.customerId;
    
    if (!userId) {
      console.error("🚫 createTicket: NID não encontrado. Sessão inválida.");
      throw new Error("Sessão expirada. Por favor, faça login novamente.");
    }

    const payload = {
        title: ticket.title,
        description: ticket.description,
        status: ticket.status || 'Novo',
        priority: ticket.priority || 'Baixa',
        category: ticket.category || 'Geral',
        customer_id: userId,
        assignee_id: ticket.assigneeId || null,
        company_id: (ticket.companyId && ticket.companyId !== '') ? ticket.companyId : null,
    };

    console.log("📤 createTicket - Payload Simplificado:", payload);

    const { data, error } = await supabase
        .from('tickets')
        .insert(payload)
        .select()
        .single();
        
    if (error) {
        console.error("🚫 ERRO SUPABASE TICKETS:", {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint
        });
        throw error;
    }
    
    console.log("✅ Ticket criado com sucesso!", data);
}

export async function updateTicket(ticket: Partial<Ticket> & { id: string }): Promise<void> {
    const { error } = await supabase!
        .from('tickets')
        .update({
          title: ticket.title,
          description: ticket.description,
          status: ticket.status,
          priority: ticket.priority,
          category: ticket.category,
          company_id: ticket.companyId,
          customer_id: ticket.customerId,
          assignee_id: ticket.assigneeId,
          updated_at: new Date().toISOString()
        })
        .eq('id', ticket.id);
        
    if (error) {
        console.error("Error updating ticket:", error);
        throw error;
    }
}

export async function fetchMessages(ticketId: string, signal?: AbortSignal): Promise<Message[]> {
    const { data, error } = await supabase!
        .from('ticket_messages')
        .select('*')
        .eq('ticket_id', ticketId)
        .abortSignal(signal as any)
        .order('created_at', { ascending: true });
        
    if (error) {
        if (error.message === 'FetchIsAborted' || error.code === '20' || error.message?.includes('aborted')) return [];
        console.error("Error fetching messages:", error);
        throw error;
    }
    
    return (data || []).map((m: any) => ({
        id: m.id,
        ticketId: m.ticket_id,
        senderId: m.author_id,
        text: m.content,
        timestamp: m.created_at,
        isVisibleToCustomer: m.is_visible_to_customer,
        type: m.type
    })) as Message[];
}

export async function createMessage(message: Message): Promise<void> {
    const { error } = await supabase!
        .from('ticket_messages')
        .insert({
          ticket_id: message.ticketId,
          author_id: message.senderId,
          content: message.text,
          created_at: message.timestamp,
          is_visible_to_customer: message.isVisibleToCustomer,
          type: message.type
        });
        
    if (error) {
        console.error("Error creating message:", error);
        throw error;
    }
}
