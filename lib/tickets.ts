import { supabase } from './supabase';
import { Ticket, Message } from './types'; 

export async function fetchAllTickets(signal?: AbortSignal): Promise<Ticket[]> {
    const { data, error } = await supabase!
        .from('tickets')
        .select(`
            *,
            companies (name),
            profiles!fk_tickets_customer(name)
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
        customerName: t.profiles?.name,
        assigneeId: t.assignee_id,
        createdAt: t.created_at,
        updatedAt: t.updated_at
    })) as Ticket[];
}

export async function getTicketById(id: string, signal?: AbortSignal): Promise<Ticket | null> {
    const { data, error } = await supabase!
        .from('tickets')
        .select('*')
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
        assigneeId: data.assignee_id,
        createdAt: data.created_at,
        updatedAt: data.updated_at
    } as Ticket;
}

export async function createTicket(ticket: Ticket): Promise<void> {
    // Get max public_ticket_number for sequential numbering
    const { data: maxTicket } = await supabase!
        .from('tickets')
        .select('public_ticket_number')
        .order('public_ticket_number', { ascending: false })
        .limit(1)
        .maybeSingle();
    
    const nextNumber = maxTicket?.public_ticket_number ? maxTicket.public_ticket_number + 1 : 1;

    const { error } = await supabase!
        .from('tickets')
        .insert({
          id: ticket.id,
          public_ticket_number: nextNumber,
          title: ticket.title,
          description: ticket.description,
          status: ticket.status,
          priority: ticket.priority,
          category: ticket.category,
          company_id: ticket.companyId,
          customer_id: ticket.customerId,
          assignee_id: ticket.assigneeId,
          created_at: ticket.createdAt,
          updated_at: ticket.updatedAt
        });
        
    if (error) {
        console.error("Error creating ticket:", error);
        throw error;
    }
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
