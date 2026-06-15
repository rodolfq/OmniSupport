// mock-db.ts - APENAS EXPORTAÇÃO DE TIPOS para compatibilidade
// Lógica MOCK removida - sistema usa APENAS Supabase diretamente

import {
  TicketStatus, UserRole, Permission, TicketPriority,
  type User, type Company, type Ticket, type Message, type Attachment,
  type ChatSession, type ChatMessage, type AnalystStatus, type AbsenceReason,
  type InternalGroup, type SavedFilter, type UserStatusHistory,
  type PriorityConfig, type QuickNote, type Queue, type WhatsappInstance,
  type CategoryConfig, type TagConfig, type StatusConfig, type RolePermission, type InternalTicket
} from './types';
import { supabase } from './supabase';

// Exportar tipos apenas
export {
  TicketStatus, UserRole, Permission, TicketPriority,
  type User, type Company, type Ticket, type Message, type Attachment,
  type ChatSession, type ChatMessage, type AnalystStatus, type AbsenceReason,
  type InternalGroup, type SavedFilter, type UserStatusHistory,
  type PriorityConfig, type QuickNote, type Queue, type WhatsappInstance,
  type CategoryConfig, type TagConfig, type StatusConfig, type RolePermission, type InternalTicket
};

// MockDB class com métodos stub - TODO: migrar para usar Supabase diretamente
export class MockDB {
  // Methods that return empty data
  static getTickets(): Ticket[] { return []; }
  static getMessages(_ticketId?: string): Message[] { return []; }
  static getUsers(): User[] { return []; }
  static getChatSessions(): ChatSession[] { return []; }
  static init(): Promise<void> { return Promise.resolve(); }
  static getCompanies(): Company[] { return []; }
  static getPriorities(): PriorityConfig[] { return []; }
  static getCategories(): CategoryConfig[] { return []; }
  static getTags(): TagConfig[] { return []; }
  static getStatuses(): StatusConfig[] { return []; }
  static getAnalystStatuses(): AnalystStatus[] { return []; }
  static getAbsenceReasons(): AbsenceReason[] { return []; }
  static getQueues(): Queue[] { return []; }
  static calculateSLA(_ticketId?: any, _priority?: any): string | undefined { return undefined; }
  static async getInternalTickets(): Promise<InternalTicket[]> {
    const { data, error } = await supabase.from('internal_tickets').select('*');
    if (error) {
      console.error('getInternalTickets error:', error);
      return [];
    }
    
    const internalTickets = (data || []).map((it: any) => ({
      id: it.id,
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
    
    // Fetch N:N links
    const { data: links } = await supabase.from('ticket_internal_links').select('ticket_id, internal_ticket_id');
    const linksMap = new Map<string, string[]>();
    (links || []).forEach((link: any) => {
      const existing = linksMap.get(link.internal_ticket_id) || [];
      existing.push(link.ticket_id);
      linksMap.set(link.internal_ticket_id, existing);
    });
    
    // Add parentTicketIds to each internal ticket
    return internalTickets.map(t => ({
      ...t,
      parentTicketIds: linksMap.get(t.id) || []
    }));
  }
  static getWhatsappInstances(): WhatsappInstance[] { return []; }
  static getSavedFilters(): SavedFilter[] { return []; }
  static getAnalysts(): User[] { return []; }
  static getInternalChats(): InternalGroup[] { return []; }
  static getRolePermissions(): RolePermission[] { return []; }
  static getQuickNotes(): QuickNote[] { return []; }
  
  // Methods that accept data but do nothing (for compatibility)
  static saveTicket(_data?: any): void {}
  static saveMessage(_data?: any): void {}
  static async saveUser(data?: Partial<User>): Promise<void> {
    if (!data?.id) return;
    
    // Update profile in Supabase
    const { error } = await supabase
      .from('profiles')
      .update({
        name: data.name,
        email: data.email,
        role: data.role,
        company_id: data.companyId,
        phone: data.phone,
        must_change_password: data.mustChangePassword,
        view_all_company_tickets: data.viewAllCompanyTickets,
      })
      .eq('id', data.id);
    
    if (error) {
      console.error('saveUser error:', error);
      throw error;
    }
  }
  static saveChatSession(_data?: any): void {}
  static distributeChat(_id?: any): void {}
  static pushChatMessage(_chatId?: any, _message?: any): Promise<void> { return Promise.resolve(); }
  static syncFromSupabase(): Promise<void> { return Promise.resolve(); }
  static decrementAnalystLoad(): void {}
  static saveWhatsappInstance(_data?: any): void {}
  static saveTag(data?: any): TagConfig {
    // Return the tag data as-is for compatibility
    return data || {} as TagConfig;
  }
  static deleteTag(_data?: any): void {}
  static saveFilter(_data?: any): void {}
  static saveQuickNote(_data?: any): void {}
  static deleteQuickNote(_data?: any): void {}
  static saveInternalChat(_data?: any): void {}
  static saveCompany(data?: any): Company { return data || {} as Company; }
  static deleteCompany(_id?: any): void {}
  static inviteUser(_email?: any, _name?: any, _role?: any, _companyId?: any): User { 
    return { id: `user-${Math.random().toString(36).substr(2, 9)}`, name: _name || '', email: _email || '', role: _role || '' } as User; 
  }
  static updateAnalystStatus(_userId?: any, _isOnline?: any, _reason?: any): void {}
  static saveAnalystStatus(_data?: any): void {}
  static deleteUser(_id?: any): void {}
  static resetPassword(_data?: any): void {}
  static saveQueue(_data?: any): void {}
  static deleteQueue(_id?: any): void {}
  static uploadFile(_file?: File): Promise<Attachment> { return Promise.resolve({} as Attachment); }
}