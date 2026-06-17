import { supabase } from '../supabase';
import { Ticket, Message, InternalTicket, TicketStatus } from '../types';
import { Permission } from '../types';

export class TicketService {
  static async getAll(signal?: AbortSignal): Promise<Ticket[]> {
    const { data, error } = await supabase
      .from('tickets')
      .select(`
        *,
        customer:profiles!tickets_customer_id_fkey(name),
        assignee:profiles!tickets_assignee_id_fkey(name)
      `)
      .abortSignal(signal as any);

    if (error) throw error;

    return (data || []).map(t => ({
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

  static async getById(id: string, signal?: AbortSignal): Promise<Ticket | null> {
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
      throw error;
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

  static async create(ticket: Ticket): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id || ticket.customerId;

    if (!userId) {
      throw new Error('Usuário não autenticado');
    }

    const { error } = await supabase.from('tickets').insert({
      title: ticket.title,
      description: ticket.description,
      status: ticket.status || TicketStatus.NEW,
      priority: ticket.priority || 'Baixa',
      category: ticket.category || 'Geral',
      customer_id: userId,
      assignee_id: ticket.assigneeId || null,
      company_id: ticket.companyId || null
    });

    if (error) throw error;
  }

  static async update(ticket: Partial<Ticket> & { id: string }): Promise<void> {
    const { error } = await supabase
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

    if (error) throw error;
  }

  static async updateStatus(ticketId: string, status: TicketStatus): Promise<void> {
    const { error } = await supabase
      .from('tickets')
      .update({ status })
      .eq('id', ticketId);

    if (error) throw error;
  }

  static calculateSLA(createdAt: string, priorityLabel: string): string | undefined {
    const prioritySLA: Record<string, number> = {
      'Baixa': 120,
      'Média': 72,
      'Alta': 24,
      'Urgente': 12
    };
    
    const slaHours = prioritySLA[priorityLabel];
    if (!slaHours) return undefined;

    const date = new Date(createdAt);
    date.setHours(date.getHours() + slaHours);
    return date.toISOString();
  }
}

export class MessageService {
  static async getByTicket(ticketId: string, signal?: AbortSignal): Promise<Message[]> {
    const { data, error } = await supabase
      .from('ticket_messages')
      .select('*')
      .eq('ticket_id', ticketId)
      .abortSignal(signal as any)
      .order('created_at', { ascending: true });

    if (error) {
      if (error.message === 'FetchIsAborted' || error.code === '20' || error.message?.includes('aborted')) return [];
      throw error;
    }

    return (data || []).map(m => ({
      id: m.id,
      ticketId: m.ticket_id,
      senderId: m.author_id,
      text: m.content,
      timestamp: m.created_at,
      isVisibleToCustomer: m.is_visible_to_customer,
      type: m.type,
      attachments: m.attachments_data || []
    })) as Message[];
  }

  static async create(message: Message): Promise<void> {
    console.log("📝 MessageService.create:", { 
        ticketId: message.ticketId?.substring(0, 8), 
        senderId: message.senderId?.substring(0, 8),
        author_id: message.senderId
    });
    
    const { error } = await supabase.from('ticket_messages').insert({
      ticket_id: message.ticketId,
      author_id: message.senderId,
      content: message.text,
      type: message.type,
      is_visible_to_customer: message.isVisibleToCustomer,
      attachments_data: message.attachments || []
    });

    if (error) {
      console.error("🚫 MessageService.create error:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
  }

  static async getByInternalTicket(internalTicketId: string, signal?: AbortSignal): Promise<Message[]> {
    const { data, error } = await supabase
      .from('internal_ticket_messages')
      .select('*')
      .eq('internal_ticket_id', internalTicketId)
      .abortSignal(signal as any)
      .order('created_at', { ascending: true });

    if (error) {
      if (error.message === 'FetchIsAborted' || error.code === '20' || error.message?.includes('aborted')) return [];
      throw error;
    }

    return (data || []).map(m => ({
      id: m.id,
      ticketId: m.internal_ticket_id,
      senderId: m.author_id,
      text: m.content,
      timestamp: m.created_at,
      isVisibleToCustomer: false,
      type: m.type as 'text' | 'system' | 'internal',
      attachments: m.attachments_data || []
    })) as Message[];
  }

  static async createInternal(message: Message, internalTicketId: string): Promise<void> {
    const { error } = await supabase.from('internal_ticket_messages').insert({
      internal_ticket_id: internalTicketId,
      author_id: message.senderId,
      content: message.text,
      type: message.type,
      attachments_data: message.attachments || []
    });

    if (error) throw error;
  }
}

export class InternalTicketService {
  static async getByParent(parentTicketId: string): Promise<InternalTicket | null> {
    // Query N:N relationship
    const { data: linkData, error: linkError } = await supabase
      .from('ticket_internal_links')
      .select('internal_ticket_id')
      .eq('ticket_id', parentTicketId)
      .maybeSingle();

    if (linkError) {
      console.error('Error fetching link:', linkError);
      return null;
    }

    if (!linkData?.internal_ticket_id) return null;

    const { data, error } = await supabase
      .from('internal_tickets')
      .select('*')
      .eq('id', linkData.internal_ticket_id)
      .maybeSingle();

    if (error) {
      console.error('Error fetching internal ticket:', error);
      return null;
    }

    if (!data) return null;

    return {
      uuid: data.id,
      id: `int-${data.internal_ticket_number?.toString().padStart(4, '0') || data.id}`,
      internalTicketNumber: data.internal_ticket_number,
      parentTicketIds: [parentTicketId],
      title: data.title,
      teamId: data.team_id,
      assigneeId: data.assignee_id,
      priority: data.priority,
      tags: data.tags || [],
      creatorId: data.creator_id,
      description: data.description,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      slaLimit: data.sla_limit
    };
  }

  static async getByParentAll(parentTicketId: string): Promise<InternalTicket[]> {
    // Get ALL linked internal tickets for a ticket (N:N support)
    const { data: links, error: linksError } = await supabase
      .from('ticket_internal_links')
      .select('internal_ticket_id')
      .eq('ticket_id', parentTicketId);

    if (linksError) {
      console.error('Error fetching links:', linksError);
      return [];
    }

    const internalIds = (links || []).map(l => l.internal_ticket_id);
    if (internalIds.length === 0) return [];

    const { data, error } = await supabase
      .from('internal_tickets')
      .select('*')
      .in('id', internalIds);

    if (error) {
      console.error('Error fetching internal tickets:', error);
      return [];
    }

    return (data || []).map((it: any) => ({
      uuid: it.id,
      id: `int-${it.internal_ticket_number?.toString().padStart(4, '0') || it.id}`,
      internalTicketNumber: it.internal_ticket_number,
      title: it.title,
      teamId: it.team_id,
      assigneeId: it.assignee_id,
      priority: it.priority,
      tags: it.tags || [],
      creatorId: it.creator_id,
      description: it.description,
      createdAt: it.created_at,
      updatedAt: it.updated_at,
      slaLimit: it.sla_limit
    }));
  }

  static async save(ticket: InternalTicket, parentTicketId?: string, parentTicketNumber?: number): Promise<string> {
    // Internal method - delegates to saveWithDetails
    const result = await InternalTicketService.saveWithDetails(ticket, parentTicketId, parentTicketNumber);
    return result.id;
  }
  
  static async saveWithDetails(ticket: InternalTicket, parentTicketId?: string, parentTicketNumber?: number): Promise<{ uuid: string; id: string }> {
    console.log('InternalTicketService.saveWithDetails called with:', {
      uuid: ticket.uuid,
      parentTicketId: parentTicketId || ticket.parentTicketId,
      parentTicketNumber,
      title: ticket.title,
      creatorId: ticket.creatorId
    });
    
    if (!supabase) {
      throw new Error('Supabase client not available');
    }
    
    // Validate required fields
    if (!ticket.title) {
      throw new Error('title is required');
    }
    if (!ticket.creatorId) {
      throw new Error('creatorId is required');
    }
    
    const payload: any = {
      title: ticket.title,
      team_id: ticket.teamId || null,
      internal_team_id: ticket.internalTeamId || null,
      assignee_id: ticket.assigneeId || null,
      priority: ticket.priority || 1,
      tags: ticket.tags || [],
      creator_id: ticket.creatorId,
      description: ticket.description || '',
    };
    
    // If parent ticket number provided, use it as internal_ticket_number
    if (parentTicketNumber) {
      payload.internal_ticket_number = parentTicketNumber;
    }
    
    console.log('InternalTicketService.saveWithDetails payload:', payload);
    
    try {
      let savedUuid: string;
      let savedNumber: number;
      
      if (ticket.uuid) {
        // Update existing record
        console.log('Updating existing internal ticket with UUID:', ticket.uuid);
        const { data, error } = await supabase.from('internal_tickets')
          .update(payload)
          .eq('id', ticket.uuid)
          .select('id, internal_ticket_number')
          .single();
        
        if (error) {
          console.error('InternalTicketService.saveWithDetails update error:', error);
          throw new Error(JSON.stringify(error, Object.getOwnPropertyNames(error)));
        }
        savedUuid = data?.id;
        savedNumber = data?.internal_ticket_number;
      } else {
        // Get next internal ticket number if not provided
        if (!parentTicketNumber) {
          console.log('Getting next internal ticket number');
          const { data: existing } = await supabase
            .from('internal_tickets')
            .select('internal_ticket_number')
            .not('internal_ticket_number', 'is', null)
            .order('internal_ticket_number', { ascending: false })
            .limit(1);
          
          const maxUsed = existing?.[0]?.internal_ticket_number || 0;
          payload.internal_ticket_number = maxUsed + 1;
          console.log('Calculated next internal ticket number:', payload.internal_ticket_number);
        }
        
        // Insert new record
        console.log('Inserting new internal ticket');
        const { data, error } = await supabase.from('internal_tickets')
          .insert(payload)
          .select('id, internal_ticket_number')
          .single();
        
        if (error) {
          console.error('InternalTicketService.saveWithDetails insert error:', error);
          throw new Error(JSON.stringify(error, Object.getOwnPropertyNames(error)));
        }
        savedUuid = data?.id;
        savedNumber = data?.internal_ticket_number;
        
        // Create N:N link for new records
        if (parentTicketId && savedUuid) {
          const { error: linkError } = await supabase.from('ticket_internal_links').insert({
            ticket_id: parentTicketId,
            internal_ticket_id: savedUuid
          }).select();
          
          if (linkError) {
            // If duplicate key error, ignore (already linked)
            if (!linkError.message?.includes('duplicate')) {
              console.error('Error creating link:', JSON.stringify(linkError, Object.getOwnPropertyNames(linkError)));
            }
          } else {
            console.log('Link created successfully');
          }
        }
      }
      
      console.log('InternalTicketService.saveWithDetails created:', { savedUuid, savedNumber });
      
      // Return formatted internal ticket ID
      // If created from parent ticket, return just the number (no prefix)
      // If standalone, return "int-XXXX"
      const formattedId = parentTicketNumber 
        ? savedNumber?.toString().padStart(4, '0') || savedUuid
        : `int-${savedNumber?.toString().padStart(4, '0') || savedUuid}`;
      return { uuid: savedUuid, id: formattedId };
    } catch (e: any) {
      console.error('InternalTicketService.saveWithDetails exception:', e?.message || e);
      throw e;
    }
  }
}