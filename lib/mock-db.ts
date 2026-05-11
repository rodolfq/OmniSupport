import { supabase } from './supabase';
import { v4 as uuidv4 } from 'uuid';

export enum TicketStatus {
  NEW = 'Novo',
  IN_PROGRESS = 'Em Andamento',
  AWAITING_INTERNAL = 'Aguardando Equipe interna',
  AWAITING_CUSTOMER = 'Aguardando Cliente',
  CLOSED = 'Concluído'
}

export interface StatusConfig {
  id: string;
  label: string;
  color: string;
}

import { safeJsonStringify } from './utils';

export enum UserRole {
  ADMIN = 'Equipe',
  // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
  SUPPORT = 'Equipe',
  CUSTOMER = 'Funcionário',
  // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
  INTERNAL = 'Equipe'
}

export enum Permission {
  TICKETS_READ = 'tickets:read',
  TICKETS_WRITE = 'tickets:write',
  TICKETS_DELETE = 'tickets:delete',
  TICKETS_ASSIGN = 'tickets:assign',
  CUSTOMERS_READ = 'customers:read',
  CUSTOMERS_WRITE = 'customers:write',
  TEAM_READ = 'team:read',
  TEAM_WRITE = 'team:write',
  SETTINGS_READ = 'settings:read',
  SETTINGS_WRITE = 'settings:write',
  REPORTS_READ = 'reports:read',
  INTERNAL_TICKETS_VIEW = 'internal:view',
  OUTSIDE_QUEUE_VIEW = 'tickets:outside_queue',
  DASHBOARD_VIEW = 'dashboard:view',
  CHAT_INTERNAL_VIEW = 'chat:internal'
}

export interface RolePermission {
  id: string;
  name: string;
  permissions: Permission[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string; // Changed from UserRole to string for dynamic profiles
  companyId?: string;
  avatarUrl?: string;
  phone?: string;
  phones?: string[];
  password?: string;
  mustChangePassword?: boolean;
  viewAllCompanyTickets?: boolean;
  status?: 'online' | 'away' | 'offline';
  isAdmin?: boolean;
  chatPreferences?: {
    bubbleColor?: string;
    avatarSize?: 'xs' | 'sm' | 'md' | 'lg' | 'none';
    fontSize?: 'sm' | 'md' | 'lg';
    personalStickers?: string[];
  };
}

export interface Company {
  id: string;
  name: string;
  industry?: string;
  phone?: string;
}

export interface Attachment {
  id: string;
  name: string;
  type: string;
  url: string;
  size: number;
}

export interface PriorityConfig {
  id: string;
  label: string;
  sla_hours: number;
  color: string;
}

export interface CategoryConfig {
  id: string;
  label: string;
}

export interface TagConfig {
  id: string;
  label: string;
  color: string;
  domain: 'chat' | 'ticket';
}

export enum TicketPriority {
  LOW = 'Baixa',
  MEDIUM = 'Média',
  HIGH = 'Alta',
  URGENT = 'Urgente'
}

export interface InternalTicket {
  id: string;
  parentTicketId: string;
  title: string;
  teamId: string; // Equipe
  assigneeId?: string; // Responsável
  priority: number; // 0-3 stars
  tags: string[];
  creatorId: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  slaLimit?: string; // ISO string for expiration
}

export interface Ticket {
  id: string;
  ticketNumber?: number;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority | string;
  companyId?: string;
  customerId: string;
  customerName?: string;
  employeeIds?: string[]; // Access/Notification
  assigneeId?: string;
  createdAt: string;
  completedAt?: string;
  updatedAt: string;
  category: string;
  tags: string[];
  attachments?: Attachment[];
  relatedTickets?: string[];
  history?: any[];
  internalTicketId?: string;
  slaLimit?: string; // ISO string for expiration
}

export interface Message {
  id: string;
  ticketId?: string;
  senderId: string;
  text: string;
  timestamp: string;
  isVisibleToCustomer: boolean;
  type: 'text' | 'system' | 'internal';
  attachments?: Attachment[];
}

export interface WhatsappInstance {
  id: string;
  name: string;
  phone: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  qrCode?: string;
}

export interface Queue {
  id: string;
  name: string;
  description?: string;
  whatsappInstanceId?: string;
  memberIds: string[];
  createdAt: string;
}

const STORAGE_KEYS = {
  USERS: 'omnisupport_users',
  TICKETS: 'omnisupport_tickets',
  COMPANIES: 'omnisupport_companies',
  MESSAGES: 'omnisupport_messages',
  CONFIG_CATEGORIES: 'omnisupport_config_categories',
  CONFIG_PRIORITIES: 'omnisupport_config_priorities',
  CONFIG_TAGS: 'omnisupport_config_tags',
  CONFIG_STATUSES: 'omnisupport_config_statuses',
  SAVED_FILTERS: 'omnisupport_saved_filters',
  ROLE_PERMISSIONS: 'omnisupport_role_permissions',
  QUICK_NOTES: 'omnisupport_quick_notes',
  CHAT_SESSIONS: 'omnisupport_chat_sessions',
  INTERNAL_CHATS: 'omnisupport_internal_chats',
  ANALYST_STATUS: 'omnisupport_analyst_status',
  USER_STATUS_HISTORY: 'omnisupport_user_status_history',
  ABSENCE_REASONS: 'omnisupport_absence_reasons',
  INTERNAL_TICKETS: 'omnisupport_internal_tickets',
  QUEUES: 'omnisupport_queues',
  WHATSAPP_INSTANCES: 'omnisupport_whatsapp_instances'
};

export interface QuickNote {
  id: string;
  shortcut: string;
  content: string;
  category: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
  type: 'text' | 'system' | 'file' | 'gif' | 'sticker';
  isDeleted?: boolean;
  replyToId?: string; // ID of the message being replied to
  readBy?: string[]; // Array of user IDs who have read the message
  metadata?: {
    fileUrl?: string;
    fileName?: string;
    fileSize?: number;
    gifUrl?: string;
    stickerUrl?: string;
  };
}

export interface ChatSession {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  assigneeId?: string;
  queueId?: string; // ID of the queue this chat belongs to
  status: 'pending' | 'active' | 'closed';
  messages: ChatMessage[];
  startedAt: string;
  lastMessageAt: string;
}

export interface InternalGroup {
  id: string;
  name: string;
  imageUrl?: string;
  type: 'direct' | 'group';
  memberIds: string[];
  messages: ChatMessage[];
  lastMessageAt: string;
  pinnedBy?: string[]; // IDs of users who have pinned this chat in sidebar
  pinnedMessageIds?: string[]; // IDs of messages pinned within this chat
  mutedBy?: string[]; // IDs of users who have muted this chat
  readLaterBy?: string[]; // IDs of users who marked this as "read later"
  hiddenBy?: string[]; // IDs of users who hid this chat
}

export interface AnalystStatus {
  userId: string;
  isOnline: boolean;
  lastActive: string;
  currentLoad: number;
  currentReason?: string;
}

export interface UserStatusHistory {
  id: string;
  userId: string;
  status: 'online' | 'away' | 'offline';
  reason?: string;
  timestamp: string;
  duration?: number; // em segundos
}

export interface SavedFilter {
  id: string;
  name: string;
  filters: any;
}

export class MockDB {
  private static isBrowser = typeof window !== 'undefined';
  private static _cache: { [key: string]: any } = {};

  private static _initPromise: Promise<void> | null = null;

  static isUUID(id: string | undefined): boolean {
    if (!id) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  }

  private static get<T>(key: string): T[] {
    if (!this.isBrowser) return [];
    if (this._cache[key]) return [...this._cache[key]];
    
    try {
      const data = localStorage.getItem(key);
      if (!data) return [];
      const parsed = JSON.parse(data);
      const result = Array.isArray(parsed) ? parsed : [];
      this._cache[key] = [...result];
      return [...result];
    } catch (e) {
      console.error(`Error parsing MockDB key ${key}:`, e);
      return [];
    }
  }

  static set<T>(key: string, data: T[]): void {
    if (!this.isBrowser) return;

    try {
      const safeData = safeJsonStringify(data);
      localStorage.setItem(key, safeData);
      this._cache[key] = data; // Use original data for cache
    } catch (e) {
      console.error(`Fatal stringify error for key ${key}:`, e);
    }
  }

  private static _syncPromise: Promise<void> | null = null;

  static async syncFromSupabase() {
    if (!this.isBrowser || !supabase) return;
    
    // If a sync is already in progress, wait for it
    if (this._syncPromise) return this._syncPromise;

    this._syncPromise = (async () => {
      console.time('Supabase Sync');
      console.log('🔄 Sincronizando com Supabase...');
      try {
        // 1. Fetch data in parallel - Primary Source of Truth
        const [
          { data: remoteProfiles },
          { data: tickets },
          { data: chatSessionsRaw },
          { data: chatMessagesRaw },
          { data: messages },
          { data: companies },
          { data: analystStatusesRaw },
          { data: historyRaw },
          { data: absenceReasonsRaw },
          { data: tagsRaw },
          { data: prioritiesRaw }
        ] = await Promise.all([
          supabase.from('profiles').select('*'),
          supabase.from('tickets').select('*'),
          supabase.from('chat_sessions').select('*'),
          supabase.from('chat_messages').select('*').order('created_at', { ascending: true }),
          supabase.from('ticket_messages').select('*'),
          supabase.from('companies').select('*'),
          supabase.from('analyst_status').select('*'),
          supabase.from('user_status_history').select('*').order('timestamp', { ascending: false }).limit(2000),
          supabase.from('absence_reasons').select('*'),
          supabase.from('config_tags').select('*'),
          supabase.from('config_priorities').select('*')
        ]);

        // Process Tags
        if (tagsRaw) {
          const mappedTags: TagConfig[] = tagsRaw.map(t => ({
            id: t.id,
            label: t.label,
            color: t.color,
            domain: t.domain as 'chat' | 'ticket'
          }));
          this.set(STORAGE_KEYS.CONFIG_TAGS, mappedTags);
        }
        
        // Process Absence Reasons
        if (absenceReasonsRaw) {
          this.set(STORAGE_KEYS.ABSENCE_REASONS, absenceReasonsRaw.map((r: any) => ({ id: String(r.id), label: r.label })));
        } else {
          // Default reasons if table is empty or query fails
          const defaultReasons = [
            { id: uuidv4(), label: 'Almoço' },
            { id: uuidv4(), label: 'Reunião' },
            { id: uuidv4(), label: 'Pessoal' },
            { id: uuidv4(), label: 'Pausa' }
          ];
          this.set(STORAGE_KEYS.ABSENCE_REASONS, defaultReasons);
        }
        
        // Process Priorities
        if (prioritiesRaw) {
          const mappedPriorities: PriorityConfig[] = prioritiesRaw.map(p => ({
            id: p.id,
            label: p.label,
            sla_hours: p.sla_hours,
            slaDays: p.sla_hours / 24,
            color: p.color
          }));
          this.set(STORAGE_KEYS.CONFIG_PRIORITIES, mappedPriorities);
        }

        // Process Analyst Statuses
        if (analystStatusesRaw) {
          const mappedStatuses: AnalystStatus[] = analystStatusesRaw.map(s => ({
            userId: s.user_id,
            isOnline: s.is_online,
            lastActive: s.last_active,
            currentLoad: s.current_load,
            currentReason: s.current_reason
          }));
          this.set(STORAGE_KEYS.ANALYST_STATUS, mappedStatuses);
        }

        // Process Status History
        if (historyRaw) {
          const mappedHistory: UserStatusHistory[] = historyRaw.map((h: any) => ({
            id: h.id,
            userId: h.user_id,
            status: h.status,
            reason: h.reason,
            timestamp: h.timestamp,
            duration: h.duration
          }));
          this.set(STORAGE_KEYS.USER_STATUS_HISTORY, mappedHistory);
        }

        // Process Companies
        if (companies) {
          const mappedCompanies = companies.map(c => ({
            id: c.id,
            name: c.name,
            industry: c.industry || '',
            phone: c.phone || ''
          }));
          this.set(STORAGE_KEYS.COMPANIES, mappedCompanies);
        }

        // Process Profiles
        if (remoteProfiles) {
          const mappedUsers = remoteProfiles.map(p => ({
            id: p.id,
            name: p.name,
            email: p.email,
            role: p.role as any,
            phone: p.phone,
            password: p.password,
            companyId: p.company_id,
            viewAllCompanyTickets: p.view_all_company_tickets,
            status: 'online' as const,
            mustChangePassword: p.must_change_password ?? false
          }));
          this.set(STORAGE_KEYS.USERS, mappedUsers);
        }

        // Process Tickets
        if (tickets) {
          const mappedTickets = tickets.map(t => ({
            ...t,
            id: t.id,
            ticketNumber: t.public_ticket_number || t.ticket_number,
            companyId: t.company_id,
            customerId: t.customer_id,
            employeeIds: t.employee_ids || [],
            assigneeId: t.assignee_id,
            createdAt: t.created_at || t.updated_at,
            updatedAt: t.updated_at
          }));
          this.set(STORAGE_KEYS.TICKETS, mappedTickets);
        }

        // Process Chat Sessions and Messages efficiently
        if (chatSessionsRaw) {
          // Create a map for messages by session ID for O(M) lookup
          const messagesBySession = new Map<string, any[]>();
          (chatMessagesRaw || []).forEach(m => {
            const list = messagesBySession.get(m.session_id) || [];
            list.push({
              id: m.id,
              senderId: m.sender_id,
              senderName: m.sender_name,
              text: m.text,
              timestamp: m.created_at,
              type: m.type as any,
              metadata: m.metadata
            });
            messagesBySession.set(m.session_id, list);
          });

          const mappedSessions: ChatSession[] = chatSessionsRaw.map(s => ({
            id: s.id,
            customerId: s.customer_id,
            customerName: s.customer_name,
            customerPhone: s.customer_phone,
            assigneeId: s.assignee_id,
            queueId: s.queue_id,
            status: s.status,
            messages: messagesBySession.get(s.id) || [],
            startedAt: s.created_at || new Date().toISOString(),
            lastMessageAt: s.created_at || new Date().toISOString()
          }));
          this.set(STORAGE_KEYS.CHAT_SESSIONS, mappedSessions);
        }
        
        // Process Ticket Messages
        if (messages) {
          const mappedMessages: Message[] = messages.map(m => ({
            id: m.id,
            ticketId: m.ticket_id,
            senderId: m.author_id,
            text: m.content,
            timestamp: m.created_at || new Date().toISOString(),
            isVisibleToCustomer: m.is_visible_to_customer,
            type: m.type as any
          }));
          this.set(STORAGE_KEYS.MESSAGES, mappedMessages);
        }

        console.log('✅ Sincronização Supabase concluída.');
      } catch (e: any) {
        const isAbortError = 
          e?.message?.toLowerCase().includes('aborted') || 
          e?.message?.toLowerCase().includes('lock broken') ||
          e?.code === '20';
          
        if (!isAbortError) {
          console.error('❌ Erro no sync do Supabase:', e);
        }
      } finally {
        this._syncPromise = null;
        console.timeEnd('Supabase Sync');
      }
    })();

    return this._syncPromise;
  }

  static async init() {
    if (!this.isBrowser) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      // 1. Sync from Supabase
      await this.syncFromSupabase();

      // 2. Initialize Defaults if local storage is empty
      if (this.get(STORAGE_KEYS.WHATSAPP_INSTANCES).length === 0) {
        const defaultInstances: WhatsappInstance[] = [
          { id: 'wa1', name: 'WhatsApp Central', phone: '5511988880000', status: 'connected' },
          { id: 'wa2', name: 'Suporte Técnico', phone: '5511988881111', status: 'disconnected' }
        ];
        this.set(STORAGE_KEYS.WHATSAPP_INSTANCES, defaultInstances);
      }

      if (this.get(STORAGE_KEYS.QUEUES).length === 0) {
        const defaultQueues: Queue[] = [
          { 
            id: 'q1', 
            name: 'Nível 1 - Triagem', 
            description: 'Primeiro atendimento e triagem de chamados',
            whatsappInstanceId: 'wa1',
            memberIds: [],
            createdAt: new Date().toISOString()
          },
          { 
            id: 'q2', 
            name: 'Nível 2 - Técnico', 
            description: 'Suporte avançado e infraestrutura',
            whatsappInstanceId: 'wa2',
            memberIds: [],
            createdAt: new Date().toISOString()
          }
        ];
        this.set(STORAGE_KEYS.QUEUES, defaultQueues);
      }

      if (this.get(STORAGE_KEYS.USERS).length === 0) {
        this.set(STORAGE_KEYS.USERS, []);
      }

      if (this.get(STORAGE_KEYS.COMPANIES).length === 0) {
        const defaultCompanies: Company[] = [
          { id: '11111111-1111-4111-8111-111111111111', name: 'Empresa Matriz Ltda', industry: 'Tecnologia', phone: '1140040000' },
          { id: '22222222-2222-4222-8222-222222222222', name: 'Logística Express', industry: 'Transporte', phone: '1140041111' }
        ];
        this.set(STORAGE_KEYS.COMPANIES, defaultCompanies);
      }


      if (this.get(STORAGE_KEYS.CONFIG_CATEGORIES).length === 0) {
        const defaultCategories: CategoryConfig[] = [
          { id: 'cat1', label: 'Suporte Técnico' },
          { id: 'cat2', label: 'Financeiro' },
          { id: 'cat3', label: 'Vendas' },
          { id: 'cat4', label: 'Mobile' },
          { id: 'cat5', label: 'Administrativo' }
        ];
        this.set(STORAGE_KEYS.CONFIG_CATEGORIES, defaultCategories);
      }

      if (this.get(STORAGE_KEYS.CONFIG_PRIORITIES).length === 0) {
        const defaultPriorities: PriorityConfig[] = [
          { id: 'p1', label: 'Baixa', sla_hours: 120, slaDays: 5, color: 'bg-slate-100 text-slate-600' },
          { id: 'p2', label: 'Média', sla_hours: 72, slaDays: 3, color: 'bg-blue-100 text-blue-700' },
          { id: 'p3', label: 'Alta', sla_hours: 24, slaDays: 1, color: 'bg-orange-100 text-orange-700' },
          { id: 'p4', label: 'Urgente', sla_hours: 12, slaDays: 0.5, color: 'bg-red-100 text-red-700' }
        ];
        this.set(STORAGE_KEYS.CONFIG_PRIORITIES, defaultPriorities);
      }

      if (this.get(STORAGE_KEYS.CONFIG_TAGS).length === 0) {
        const defaultTags: TagConfig[] = [
          { id: 't1', label: 'Bug', color: 'bg-red-100 text-red-700', domain: 'ticket' },
          { id: 't2', label: 'Melhoria', color: 'bg-indigo-100 text-indigo-700', domain: 'ticket' },
          { id: 't3', label: 'Dúvida', color: 'bg-amber-100 text-amber-700', domain: 'ticket' },
          { id: 't4', label: 'Urgente', color: 'bg-rose-100 text-rose-700', domain: 'chat' },
          { id: 't5', label: 'Comercial', color: 'bg-emerald-100 text-emerald-700', domain: 'chat' }
        ];
        this.set(STORAGE_KEYS.CONFIG_TAGS, defaultTags);
      }

      if (this.get(STORAGE_KEYS.CONFIG_STATUSES).length === 0) {
        const defaultStatuses: StatusConfig[] = [
          { id: 'new', label: 'Novo', color: 'bg-indigo-50 text-indigo-600' },
          { id: 'in_progress', label: 'Em Andamento', color: 'bg-amber-50 text-amber-600' },
          { id: 'waiting_internal', label: 'Aguardando Equipe interna', color: 'bg-blue-50 text-blue-600' },
          { id: 'waiting_customer', label: 'Aguardando Cliente', color: 'bg-slate-50 text-slate-600' },
          { id: 'closed', label: 'Concluído', color: 'bg-emerald-50 text-emerald-600' }
        ];
        this.set(STORAGE_KEYS.CONFIG_STATUSES, defaultStatuses);
      }

      const savedPermissions = this.get<RolePermission>(STORAGE_KEYS.ROLE_PERMISSIONS);
      if (savedPermissions.length === 0 || !savedPermissions.some(r => r.name === UserRole.SUPPORT && r.permissions.includes(Permission.INTERNAL_TICKETS_VIEW))) {
        const defaultRolePermissions: RolePermission[] = [
          { id: 'admin', name: UserRole.ADMIN, permissions: Object.values(Permission) },
          { id: 'customer', name: UserRole.CUSTOMER, permissions: [Permission.DASHBOARD_VIEW, Permission.TICKETS_READ, Permission.TICKETS_WRITE] }
        ];
        this.set(STORAGE_KEYS.ROLE_PERMISSIONS, defaultRolePermissions);
      }

      if (this.get(STORAGE_KEYS.QUICK_NOTES).length === 0) {
        const defaultNotes: QuickNote[] = [
          { id: '1', shortcut: 'oi', content: 'Olá! Sou o analista de suporte. Como posso te ajudar hoje?', category: 'Saudação' },
          { id: '2', shortcut: 'aguarde', content: 'Por favor, aguarde um momento enquanto verifico essa informação no sistema.', category: 'Padrão' },
          { id: '3', shortcut: 'encerrar', content: 'Foi um prazer te ajudar! Tem algo mais em que eu possa ser útil?', category: 'Encerramento' },
        ];
        this.set(STORAGE_KEYS.QUICK_NOTES, defaultNotes);
      }

      if (this.get(STORAGE_KEYS.ANALYST_STATUS).length === 0) {
        const analysts = this.getAnalysts();
        const defaultStatus: AnalystStatus[] = analysts.map(a => ({
          userId: a.id,
          isOnline: Math.random() > 0.3,
          lastActive: new Date().toISOString(),
          currentLoad: 0
        }));
        this.set(STORAGE_KEYS.ANALYST_STATUS, defaultStatus);
      }

      if (this.get(STORAGE_KEYS.INTERNAL_CHATS).length === 0) {
        const defaultGroups: InternalGroup[] = [
          { 
            id: 'g1', 
            name: 'Suporte Geral', 
            type: 'group', 
            memberIds: this.getAnalysts().map(a => a.id),
            messages: [],
            lastMessageAt: new Date().toISOString()
          }
        ];
        this.set(STORAGE_KEYS.INTERNAL_CHATS, defaultGroups);
      }
      if (this.get(STORAGE_KEYS.TICKETS).length === 0) {
        this.set(STORAGE_KEYS.TICKETS, []);
      }
    })();

    return this._initPromise;
  }

  static getStatusHistory() { return this.get<UserStatusHistory>(STORAGE_KEYS.USER_STATUS_HISTORY); }
  static getAbsenceReasons() { return this.get<AbsenceReason>(STORAGE_KEYS.ABSENCE_REASONS); }

  static async saveAbsenceReason(reason: { label: string }) {
    const reasons = this.getAbsenceReasons();
    const newReason: AbsenceReason = { id: uuidv4(), label: reason.label };
    reasons.push(newReason);
    this.set(STORAGE_KEYS.ABSENCE_REASONS, reasons);
    if (supabase) {
      try {
        await supabase.from('absence_reasons').insert(newReason);
      } catch (err) {
        console.error('Error inserting absence reason:', err);
      }
    }
    return newReason;
  }

  static async deleteAbsenceReason(id: string) {
    const reasons = this.getAbsenceReasons().filter(r => String(r.id) !== String(id));
    this.set(STORAGE_KEYS.ABSENCE_REASONS, reasons);
    if (supabase && id) {
      try {
        await supabase.from('absence_reasons').delete().eq('id', id);
      } catch (err) {
        console.error('Error deleting absence reason:', err);
      }
    }
  }

  static async logStatusChange(userId: string, status: 'online' | 'away' | 'offline', reason?: string) {
    const history = this.getStatusHistory();
    const userHistory = history.filter(h => h.userId === userId).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const lastEntry = userHistory[0];
    const now = new Date().toISOString();

    if (lastEntry) {
      const startTime = new Date(lastEntry.timestamp).getTime();
      const endTime = new Date(now).getTime();
      lastEntry.duration = Math.floor((endTime - startTime) / 1000);
      
      const idx = history.findIndex(h => h.id === lastEntry.id);
      if (idx >= 0) history[idx] = lastEntry;
    }

    const newEntry: UserStatusHistory = {
      id: uuidv4(),
      userId,
      status,
      reason,
      timestamp: now
    };

    history.push(newEntry);
    this.set(STORAGE_KEYS.USER_STATUS_HISTORY, history);

    // Sync to Supabase
    if (supabase && this.isUUID(userId)) {
      try {
        // Update current reason in analyst_status first
        await supabase.from('analyst_status').update({ 
           current_reason: reason || null,
           is_online: status === 'online',
           last_active: now
        }).eq('user_id', userId);

        // Update duration of previous entry if it exists in Supabase
        if (lastEntry && this.isUUID(lastEntry.id)) {
           await supabase.from('user_status_history').update({ duration: lastEntry.duration }).eq('id', lastEntry.id);
        }

        // Insert new history entry
        await supabase.from('user_status_history').insert({
          id: newEntry.id,
          user_id: userId,
          status: status,
          reason: reason || null,
          timestamp: now
        });
      } catch (err) {
        console.error('Error syncing status history to Supabase:', err);
      }
    }
  }

  static getTags() { return this.get<TagConfig>(STORAGE_KEYS.CONFIG_TAGS); }

  static async saveTag(tag: Omit<TagConfig, 'id'>) {
    const tags = this.getTags();
    const newTag: TagConfig = { ...tag, id: uuidv4() };
    tags.push(newTag);
    this.set(STORAGE_KEYS.CONFIG_TAGS, tags);
    if (supabase) {
      try {
        await supabase.from('config_tags').insert({
          id: newTag.id,
          label: newTag.label,
          color: newTag.color,
          domain: newTag.domain
        });
      } catch (err) {
        console.error('Error inserting config tag:', err);
      }
    }
    return newTag;
  }

  static async deleteTag(id: string) {
    const tags = this.getTags().filter(t => t.id !== id);
    this.set(STORAGE_KEYS.CONFIG_TAGS, tags);
    if (supabase && id) {
      try {
        await supabase.from('config_tags').delete().eq('id', id);
      } catch (err) {
        console.error('Error deleting tag:', err);
      }
    }
  }
  static getTickets() { return this.get<Ticket>(STORAGE_KEYS.TICKETS); }
  static getCompanies() { return this.get<Company>(STORAGE_KEYS.COMPANIES); }
  static getPriorities() { return this.get<PriorityConfig>(STORAGE_KEYS.CONFIG_PRIORITIES); }
  
  static calculateSLA(createdAt: string, priorityLabel: string): string | undefined {
    const priorities = this.getPriorities();
    const config = priorities.find(p => p.label === priorityLabel);
    if (!config || !config.sla_hours) return undefined;
    
    const date = new Date(createdAt);
    date.setHours(date.getHours() + config.sla_hours);
    return date.toISOString();
  }

  static saveTicket(ticket: Ticket, historyEntry?: any) {
    const tickets = this.getTickets();
    const index = tickets.findIndex(t => t.id === ticket.id);
    
    // Manage history
    if (historyEntry) {
      if (!ticket.history) ticket.history = [];
      ticket.history.push({
        ...historyEntry,
        timestamp: new Date().toISOString()
      });
    }
    
    // Update SLA limit if not set or if priority changed
    if (!ticket.slaLimit || (index >= 0 && tickets[index].priority !== ticket.priority)) {
      ticket.slaLimit = this.calculateSLA(ticket.createdAt, ticket.priority);
    }
    
    if (index >= 0) {
      tickets[index] = ticket;
    } else {
      // Find max ticket number
      const maxTicketNumber = tickets.reduce((max, t) => Math.max(max, t.ticketNumber || 0), 0);
      ticket.ticketNumber = maxTicketNumber + 1;
      tickets.push(ticket);
    }
    this.set(STORAGE_KEYS.TICKETS, tickets);

    // Sync to Supabase in background
    if (supabase) {
      const db = supabase;
      const sync = async () => {
        console.log(`📤 Sincronizando ticket ${ticket.id} para Supabase...`);
        
        try {
          // Verify authentication
          const { data: authData } = await db.auth.getUser();
          if (!authData.user) return;

          let error: any = null;

          const payload: any = {
            title: ticket.title,
            description: ticket.description,
            status: ticket.status,
            priority: ticket.priority,
            category: ticket.category,
            employee_ids: ticket.employeeIds || [],
            sla_limit: ticket.slaLimit,
            history: ticket.history || [],
            updated_at: new Date().toISOString()
          };

          if (this.isUUID(ticket.id)) payload.id = ticket.id;
          payload.company_id = (ticket.companyId && this.isUUID(ticket.companyId)) ? ticket.companyId : null;
          payload.customer_id = this.isUUID(ticket.customerId) ? ticket.customerId : null;
          payload.assignee_id = (ticket.assigneeId && this.isUUID(ticket.assigneeId)) ? ticket.assigneeId : null;
          
          // Mantém o número do ticket se disponível
          if (typeof ticket.ticketNumber === 'number') {
            payload.public_ticket_number = ticket.ticketNumber;
          } else {
            // Fallback para evitar erro de NOT NULL no banco
            // Se for novo, o ideal é que o número seja gerado corretamente no salvamento local acima
            console.warn(`⚠️ Ticket ${ticket.id} sem número. Atribuindo valor temporário.`);
            payload.public_ticket_number = Math.floor(Date.now() / 1000); 
          }

          if (this.isUUID(ticket.id)) {
            // Se temos um UUID, tentamos dar um upsert passando explicitamente o ID como critério de conflito
            const { error: upsertError } = await db.from('tickets').upsert([payload], { onConflict: 'id' });
            error = upsertError;
          } else {
            // Se não for UUID (local), apenas inserimos
            const { error: insertError } = await db.from('tickets').insert([payload]);
            error = insertError;
          }
          
          if (error && error.message.includes('column') && error.message.includes('not found')) {
            const missingColumnMatch = error.message.match(/column "(.*?)"/);
            const missingColumn = missingColumnMatch ? missingColumnMatch[1] : null;
            
            if (missingColumn) {
              console.warn(`⚠️ Coluna "${missingColumn}" não encontrada no Supabase. Tentando sem ela...`);
              const { [missingColumn]: _unused, ...limitedPayload } = payload;
              const retry = await db.from('tickets').upsert([limitedPayload]);
              error = retry.error;
            }
          }

          if (error) {
            console.error('❌ Erro Supabase Sync (tickets):', error.message);
          }
        } catch (e) {
          console.error('❌ Erro inesperado ao sincronizar ticket:', e);
        }
      };

      sync();
    }
  }

  static getMessages(ticketId?: string) {
    const all = this.get<Message>(STORAGE_KEYS.MESSAGES);
    return ticketId ? all.filter(m => m.ticketId === ticketId) : all;
  }

  static saveMessage(message: Message) {
    const messages = this.get<Message>(STORAGE_KEYS.MESSAGES);
    messages.push(message);
    this.set(STORAGE_KEYS.MESSAGES, messages);

    // Sync to Supabase in background
    if (supabase && message.ticketId) {
      const db = supabase;
      const syncMessage = async () => {
        try {
          // Verify authentication
          const { data: authData } = await db.auth.getUser();
          if (!authData.user) return;

          console.log(`📤 Sincronizando mensagem para ticket ${message.ticketId}...`);
          
          const payload: any = {
            content: message.text,
            type: message.type
          };

          if (this.isUUID(message.ticketId)) payload.ticket_id = message.ticketId;
          if (this.isUUID(message.senderId)) payload.author_id = message.senderId;

          // Only attempt insert if we have a valid ticket_id and author_id
          if (payload.ticket_id && payload.author_id) {
            const { error } = await db.from('ticket_messages').insert([payload]);
            if (error) {
              console.error('❌ Erro Supabase Sync (messages):', error.message);
            }
          }
        } catch (e) {
          console.error('❌ Erro inesperado ao sincronizar mensagem:', e);
        }
      };

      syncMessage();
    }
  }
  static getUsers() { return this.get<User>(STORAGE_KEYS.USERS); }
  static async saveUser(user: User) {
    const users = this.getUsers();
    const index = users.findIndex(u => u.id === user.id);
    if (index >= 0) {
      users[index] = user;
    } else {
      users.push(user);
    }
    this.set(STORAGE_KEYS.USERS, users);

    // Sync to Supabase - CRITICAL: Non-blocking to prevent UI hang
    if (supabase && this.isUUID(user.id)) {
      const db = supabase;
      // Run sync in background without awaiting to prevent UI lockup
      (async () => {
        try {
          const { data: authData } = await db.auth.getUser();
          if (!authData.user) return;

          // Check if user is Admin to allow syncing other profiles
          const { data: currentProfile } = await db.from('profiles').select('role, is_admin').eq('id', authData.user.id).maybeSingle();
          const isAdmin = currentProfile?.role === UserRole.ADMIN || currentProfile?.role === 'Administrador' || currentProfile?.is_admin === true;

          // If not admin and trying to sync someone else, skip
          if (user.id !== authData.user.id && !isAdmin) return;

          const payload: any = {
            id: user.id, // Current ID being saved
            name: user.name,
            email: user.email,
            role: user.role,
            company_id: user.companyId && this.isUUID(user.companyId) ? user.companyId : null,
            phone: user.phone || null,
            password: user.password || null,
            must_change_password: user.mustChangePassword
          };
          
          // Use upsert - if it fails (e.g. FK violation), we just log it and move on
          const { error: profileError } = await db.from('profiles').upsert(payload);
          
          if (!profileError && (user.role === UserRole.SUPPORT || user.role === UserRole.ADMIN || user.role === 'Equipe')) {
             // Also ensure analyst_status exists
             await db.from('analyst_status').upsert({
               user_id: user.id,
               is_online: false,
               last_active: new Date().toISOString(),
               current_load: 0
             });
          }
          
          if (profileError) {
            console.warn('⚠️ Supabase sync warning (profiles):', profileError.message);
          }
        } catch (e) {
          // Silent catch to prevent background crashes
        }
      })();
    }
  }
  static async deleteUser(id: string) {
    console.log(`🗑️ Tentando excluir usuário: ${id}`);
    
    // 2. Sync to Supabase directly
    if (supabase && this.isUUID(id)) {
      console.log(`📤 Removendo conta ${id} do Supabase...`);
      // Delete from auth.users via RPC
      const { error: authError } = await supabase.rpc('admin_delete_user', { p_user_id: id });
      if (authError) {
         throw new Error('Erro ao deletar conta: ' + authError.message);
      }
      // Also try to delete profile just in case cascade didn't catch it
      const { error } = await supabase.from('profiles').delete().eq('id', id);
      
      if (error) {
         throw new Error('Erro ao deletar perfil: ' + error.message);
      } else {
        console.log('✅ Conta deletada com sucesso do Supabase.');
      }
    } else {
      console.log('ℹ️ Registro local removido com sucesso.');
    }

    // 1. Update local storage after success
    const currentUsers = this.getUsers();
    const updatedUsers = currentUsers.filter(u => u.id !== id);
    this.set(STORAGE_KEYS.USERS, updatedUsers);
  }

  static getUsers() { return this.get<User>(STORAGE_KEYS.USERS); }
  static getTickets() { return this.get<Ticket>(STORAGE_KEYS.TICKETS); }
  static saveUser(user: User) {
    const users = this.getUsers();
    const index = users.findIndex(u => u.id === user.id);
    if (index >= 0) users[index] = user; else users.push(user);
    this.set(STORAGE_KEYS.USERS, users);
  }
  static saveTicket(ticket: Ticket) {
    const tickets = this.getTickets();
    const index = tickets.findIndex(t => t.id === ticket.id);
    if (index >= 0) tickets[index] = ticket;
    else tickets.push(ticket);
    this.set(STORAGE_KEYS.TICKETS, tickets);

    // Sync to Supabase - Atomic update/insert
    if (supabase) {
      const db = supabase;
      const syncTicket = async () => {
        try {
          const payload = {
            id: ticket.id,
            title: ticket.title,
            description: ticket.description,
            status: ticket.status,
            priority: ticket.priority,
            category: ticket.category,
            company_id: ticket.companyId || null,
            customer_id: ticket.customerId,
            assignee_id: ticket.assigneeId || null,
            created_at: ticket.createdAt,
            updated_at: new Date().toISOString(),
            tags: ticket.tags || []
          };
          
          const { error } = await db.from('tickets').upsert(payload);
          if (error) console.error('❌ Erro Supabase ao salvar ticket:', error.message);
        } catch (e) {
          console.error('❌ Erro inesperado ao sincronizar ticket:', e);
        }
      };
      syncTicket();
    }
  }

  static getCompanies() { return this.get<Company>(STORAGE_KEYS.COMPANIES); }
  static async saveCompany(company: Company) {
    const companies = this.getCompanies();
    if (!this.isUUID(company.id)) {
      company.id = uuidv4();
    }
    const index = companies.findIndex(c => c.id === company.id);
    if (index >= 0) companies[index] = company;
    else companies.push(company);
    this.set(STORAGE_KEYS.COMPANIES, companies);

    if (supabase) {
      const { error } = await supabase.from('companies').upsert({
        id: company.id,
        name: company.name,
        industry: company.industry || null,
        phone: company.phone || null
      });
      if (error) {
        console.error('Erro ao salvar empresa no Supabase:', error.message);
        if (error.message.includes('schema cache') || error.message.includes('Could not find')) {
           throw new Error('A estrutura do banco de dados está desatualizada. Por favor, acesse o editor de SQL no Supabase e rode: ALTER TABLE companies ADD COLUMN IF NOT EXISTS industry TEXT; seguido de: NOTIFY pgrst, \'reload schema\';');
        } else {
           throw new Error(error.message);
        }
      }
    }
  }

  static async deleteCompany(id: string) {
    if (supabase && this.isUUID(id)) {
      // Find all employees
      const employees = this.getUsers().filter(u => u.companyId === id);
      
      // Delete their auth accounts
      for (const emp of employees) {
        if (this.isUUID(emp.id)) {
           const { error: rpcError } = await supabase.rpc('admin_delete_user', { p_user_id: emp.id });
           if (rpcError) {
             throw new Error('Erro ao deletar usuário: ' + rpcError.message);
           }
        }
      }

      const { error } = await supabase.from('companies').delete().eq('id', id);
      if (error) {
         console.error('Erro ao excluir empresa no Supabase:', error.message);
         if (error.message.includes('schema cache')) {
            throw new Error('A estrutura do banco de dados está desatualizada. Por favor, recarregue schema ou contate admin.');
         } else {
            throw new Error(error.message);
         }
      }
    }
    
    // Update local users filtering out those who belong to this company
    const updatedUsers = this.getUsers().filter(u => u.companyId !== id);
    this.set(STORAGE_KEYS.USERS, updatedUsers);

    const companies = this.getCompanies().filter(c => c.id !== id);
    this.set(STORAGE_KEYS.COMPANIES, companies);
  }

  static async inviteUser(email: string, name: string, role: string, companyId?: string) {
    if (supabase) {
      try {
        // 1. Check if user already exists by email in profiles
        let targetUserId = null;
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id, email')
          .eq('email', email)
          .maybeSingle();

        if (existingProfile?.id) {
          targetUserId = existingProfile.id;
        } else {
          // Try to create in auth
          const { data, error } = await supabase.rpc('create_user_account', {
            p_email: email,
            p_password: 'password123',
            p_name: name,
            p_role: role || UserRole.CUSTOMER
          });
          
          if (error) {
            // Se erro for "Email already exists" ou similar, significa que o usuário
            // está no Auth mas não no profiles (algo inconsistente).
            // O fallback pra não quebrar tudo sem rpc seria retornar erro legível
            if (error.message.toLowerCase().includes('already exists') || error.message.toLowerCase().includes('duplicat')) {
                throw new Error('Usuário já existe no sistema Auth, mas não possui Perfil. Contate o suporte para limpeza.');
            }
            throw new Error('Erro Supabase: ' + error.message);
          } else if (data?.error) {
            if (data.error.toLowerCase().includes('already exists') || data.error.toLowerCase().includes('duplicat')) {
                throw new Error('Usuário já existe no sistema Auth, mas não possui Perfil. Contate o suporte para limpeza.');
            }
            throw new Error('Erro criação de usuário: ' + data.error);
          } else if (data?.id) {
            targetUserId = data.id;
          }
        }

        if (targetUserId) {
           const updates: any = {};
           if (companyId) updates.company_id = companyId;
           updates.name = name;
           updates.role = role || UserRole.CUSTOMER;
           updates.password = 'password123'; // stored temporarily as per original code

           // Updates existing or naturally propagates to the created one
           await supabase.from('profiles').update(updates).eq('id', targetUserId);

           return {
             id: targetUserId,
             email,
             name,
             role: role || UserRole.CUSTOMER,
             companyId: companyId,
             mustChangePassword: true
           };
        }
      } catch (e: any) {
        throw new Error(e.message || 'Erro ao criar conta de usuário no servidor');
      }
    }

    // Fallback Mock Logic only if NO supabase
    const newUser: User = {
      id: uuidv4(),
      email,
      name,
      role: role || UserRole.CUSTOMER,
      companyId,
      mustChangePassword: true
    };

    const users = this.getUsers();
    users.push(newUser);
    this.set(STORAGE_KEYS.USERS, users);

    return newUser;
  }

  // Config Methods
  static getCategories() { return this.get<CategoryConfig>(STORAGE_KEYS.CONFIG_CATEGORIES); }
  static setCategories(data: CategoryConfig[]) { this.set(STORAGE_KEYS.CONFIG_CATEGORIES, data); }
  static getPriorities() { return this.get<PriorityConfig>(STORAGE_KEYS.CONFIG_PRIORITIES); }
  static setPriorities(data: PriorityConfig[]) { this.set(STORAGE_KEYS.CONFIG_PRIORITIES, data); }
  static getTags() { return this.get<TagConfig>(STORAGE_KEYS.CONFIG_TAGS); }
  static setTags(data: TagConfig[]) { this.set(STORAGE_KEYS.CONFIG_TAGS, data); }
  static getStatuses() { return this.get<StatusConfig>(STORAGE_KEYS.CONFIG_STATUSES); }
  static setStatuses(data: StatusConfig[]) { this.set(STORAGE_KEYS.CONFIG_STATUSES, data); }

  static getAnalysts() {
    return this.getUsers().filter(u => u.role !== UserRole.CUSTOMER);
  }

  static getSavedFilters() { return this.get<SavedFilter>(STORAGE_KEYS.SAVED_FILTERS); }
  static saveFilter(filter: SavedFilter) {
    const filters = this.getSavedFilters();
    filters.push(filter);
    this.set(STORAGE_KEYS.SAVED_FILTERS, filters);
  }

  static getRolePermissions() { return this.get<RolePermission>(STORAGE_KEYS.ROLE_PERMISSIONS); }
  static saveRolePermissions(rolePermissions: RolePermission[]) {
    this.set(STORAGE_KEYS.ROLE_PERMISSIONS, rolePermissions);
  }
  static getPermissionsByRole(roleName: string): Permission[] {
    const roles = this.getRolePermissions();
    const role = roles.find(r => r.name === roleName);
    return role ? role.permissions : [];
  }

  static getQuickNotes() { return this.get<QuickNote>(STORAGE_KEYS.QUICK_NOTES); }
  static saveQuickNote(n: QuickNote) {
    const notes = this.getQuickNotes();
    const idx = notes.findIndex(item => item.id === n.id);
    if (idx >= 0) notes[idx] = n; else notes.push(n);
    this.set(STORAGE_KEYS.QUICK_NOTES, notes);
  }
  static deleteQuickNote(id: string) {
    const notes = this.getQuickNotes().filter(n => n.id !== id);
    this.set(STORAGE_KEYS.QUICK_NOTES, notes);
  }

  static getAnalystStatuses() { return this.get<AnalystStatus>(STORAGE_KEYS.ANALYST_STATUS); }
  static async saveAnalystStatus(status: AnalystStatus) {
    const statuses = this.getAnalystStatuses();
    const idx = statuses.findIndex(s => s.userId === status.userId);
    if (idx >= 0) statuses[idx] = status; else statuses.push(status);
    this.set(STORAGE_KEYS.ANALYST_STATUS, statuses);

    // Sync to Supabase - CRITICAL: Must use real auth.uid() for RLS
    if (supabase && this.isUUID(status.userId)) {
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (!authData.user || status.userId !== authData.user.id) {
          return; // Only sync current user's status
        }

        // Valida se profile existe antes de tentar atualizar status,
        // para evitar "violates foreign key constraint analyst_status_user_id_fkey"
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', authData.user.id)
          .maybeSingle();

        if (!profile) {
          console.warn('Profile ainda não criado no Supabase. Aguardando trigger de criação...');
          return;
        }

        const { error } = await supabase.from('analyst_status').upsert({
          user_id: authData.user.id,
          is_online: status.isOnline,
          last_active: status.lastActive,
          current_load: status.currentLoad
        });
        
        if (error) {
           if (error.message.includes('schema cache') || error.message.includes('Could not find the table')) {
             console.warn('⚠️ Tabela analyst_status não encontrada no Supabase. Execute o SQL de criação da tabela.');
           } else {
             console.error('❌ Erro ao sincronizar status do analista:', error.message, error.details);
           }
        }
      } catch (e) {
        console.error('❌ Erro inesperado ao sincronizar status:', e);
      }
    }
  }
  static async updateAnalystStatus(userId: string, isOnline: boolean) {
    const status = this.getAnalystStatuses().find(s => s.userId === userId);
    if (status) {
      await this.saveAnalystStatus({ ...status, isOnline, lastActive: new Date().toISOString() });
    } else {
      await this.saveAnalystStatus({ userId, isOnline, lastActive: new Date().toISOString(), currentLoad: 0 });
    }
  }

  static getChatSessions() { return this.get<ChatSession>(STORAGE_KEYS.CHAT_SESSIONS); }
  static saveChatSession(session: ChatSession) {
    const sessions = this.getChatSessions();
    const idx = sessions.findIndex(s => s.id === session.id);
    const oldSession = idx >= 0 ? sessions[idx] : null;

    if (idx >= 0) sessions[idx] = session; else sessions.push(session);
    this.set(STORAGE_KEYS.CHAT_SESSIONS, sessions);

    // Sync to Supabase
    if (supabase) {
      const db = supabase;
      const syncSession = async () => {
        try {
          const payload: any = {
            id: session.id,
            customer_id: session.customerId,
            customer_name: session.customerName,
            customer_phone: session.customerPhone || null,
            assignee_id: session.assigneeId || null,
            queue_id: session.queueId || null,
            status: session.status
          };
          if (session.startedAt) payload.created_at = session.startedAt;
          
          const { error: sessionError } = await db.from('chat_sessions').upsert(payload);
          if (sessionError) console.error('❌ Erro ao sincronizar sessão de chat:', sessionError.message);

          // Messages are now synced individually via pushChatMessage
        } catch (e) {
          console.error('❌ Erro inesperado na sincronização de chat:', e);
        }
      };
      syncSession();
    }

    // If status changed to closed and had an assignee, decrement load
    if (oldSession && oldSession.status !== 'closed' && session.status === 'closed' && session.assigneeId) {
      this.decrementAnalystLoad(session.assigneeId);
    }
  }

  static async pushChatMessage(sessionId: string, message: ChatMessage) {
    // 1. Update Local Storage first
    const sessions = this.getChatSessions();
    const idx = sessions.findIndex(s => s.id === sessionId);
    if (idx >= 0) {
      if (!sessions[idx].messages) sessions[idx].messages = [];
      const mIdx = sessions[idx].messages.findIndex(m => m.id === message.id);
      if (mIdx >= 0) sessions[idx].messages[mIdx] = message;
      else sessions[idx].messages.push(message);
      
      sessions[idx].lastMessageAt = message.timestamp;
      this.set(STORAGE_KEYS.CHAT_SESSIONS, sessions);
    }

    // 2. Sync to Supabase - Atomic message insert
    if (supabase) {
      const db = supabase;
      console.log(`📤 Enviando mensagem ${message.id} para Supabase...`);
      try {
        // 1. Insert message
        const { error: msgError } = await db.from('chat_messages').upsert({
          id: message.id,
          session_id: sessionId,
          sender_id: message.senderId,
          sender_name: message.senderName,
          text: message.text,
          type: message.type,
          metadata: message.metadata || null,
          created_at: message.timestamp
        });
        
        if (msgError) {
          console.error('❌ Erro Supabase (chat_messages):', msgError.message);
        } else {
          console.log('✅ Mensagem sincronizada no Supabase');
        }
      } catch (e) {
        console.error('❌ Erro inesperado ao enviar mensagem:', e);
      }
    }
  }

  static decrementAnalystLoad(userId: string) {
    const statuses = this.getAnalystStatuses();
    const idx = statuses.findIndex(s => s.userId === userId);
    if (idx >= 0) {
      statuses[idx] = { 
        ...statuses[idx], 
        currentLoad: Math.max(0, statuses[idx].currentLoad - 1) 
      };
      this.set(STORAGE_KEYS.ANALYST_STATUS, statuses);
    }
  }

  static distributeChat(sessionId: string) {
    const sessions = this.getChatSessions();
    const sIdx = sessions.findIndex(s => s.id === sessionId);
    if (sIdx < 0) return;
    
    const session = sessions[sIdx];
    if (session.assigneeId || session.status === 'closed') return;

    // Get online or away analysts
    const analystStatuses = this.getAnalystStatuses().filter(s => s.isOnline || true); // Allow all for distribution if we want it to be broad
    if (analystStatuses.length === 0) {
      console.log('⚠️ Nenhum analista encontrado para distribuição automática.');
      return;
    }

    // Filter those who are active or at least online
    const onlineAnalysts = analystStatuses.filter(s => s.isOnline);
    const targetGroup = onlineAnalysts.length > 0 ? onlineAnalysts : analystStatuses;

    // Sort by load (least busy first), then by lastActive (idle longest first)
    targetGroup.sort((a, b) => {
      if (a.currentLoad !== b.currentLoad) return a.currentLoad - b.currentLoad;
      return new Date(a.lastActive).getTime() - new Date(b.lastActive).getTime();
    });
    const chosen = targetGroup[0];

    // Assign
    session.assigneeId = chosen.userId;
    session.status = 'active';
    
    // Use saveChatSession to ensure it syncs correctly to Supabase
    this.saveChatSession(session);

    // Increment load
    const statuses = this.getAnalystStatuses();
    const aIdx = statuses.findIndex(s => s.userId === chosen.userId);
    if (aIdx >= 0) {
      statuses[aIdx].currentLoad += 1;
      this.set(STORAGE_KEYS.ANALYST_STATUS, statuses);
    }

    console.log(`✅ Chat ${sessionId} distribuído para analista ${chosen.userId} (Carga: ${chosen.currentLoad})`);
    return chosen.userId;
  }

  static getInternalChats() { return this.get<InternalGroup>(STORAGE_KEYS.INTERNAL_CHATS); }
  static saveInternalChat(group: InternalGroup) {
    const groups = this.getInternalChats();
    const idx = groups.findIndex(g => g.id === group.id);
    if (idx >= 0) groups[idx] = group; else groups.push(group);
    this.set(STORAGE_KEYS.INTERNAL_CHATS, groups);
  }

  static getInternalTickets() { return this.get<InternalTicket>(STORAGE_KEYS.INTERNAL_TICKETS); }
  static getInternalTicketByParent(parentId: string) {
    return this.getInternalTickets().find(it => it.parentTicketId === parentId);
  }
  static saveInternalTicket(it: InternalTicket) {
    const internalTickets = this.getInternalTickets();
    const idx = internalTickets.findIndex(t => t.id === it.id);
    if (idx >= 0) internalTickets[idx] = it; else internalTickets.push(it);
    this.set(STORAGE_KEYS.INTERNAL_TICKETS, internalTickets);

    // Also update parent ticket if needed
    const tickets = this.getTickets();
    const parentIdx = tickets.findIndex(t => t.id === it.parentTicketId);
    if (parentIdx >= 0 && !tickets[parentIdx].internalTicketId) {
      tickets[parentIdx].internalTicketId = it.id;
      this.set(STORAGE_KEYS.TICKETS, tickets);
    }
  }

  // Queue Management
  static getQueues() { return this.get<Queue>(STORAGE_KEYS.QUEUES); }
  static saveQueue(queue: Queue) {
    const queues = this.getQueues();
    const idx = queues.findIndex(q => q.id === queue.id);
    if (idx >= 0) queues[idx] = queue; else queues.push(queue);
    this.set(STORAGE_KEYS.QUEUES, queues);
  }
  static deleteQueue(id: string) {
    const queues = this.getQueues().filter(q => q.id !== id);
    this.set(STORAGE_KEYS.QUEUES, queues);
  }

  // WhatsApp Instances
  static getWhatsappInstances() { return this.get<WhatsappInstance>(STORAGE_KEYS.WHATSAPP_INSTANCES); }
  static saveWhatsappInstance(instance: WhatsappInstance) {
    const instances = this.getWhatsappInstances();
    const idx = instances.findIndex(i => i.id === instance.id);
    if (idx >= 0) instances[idx] = instance; else instances.push(instance);
    this.set(STORAGE_KEYS.WHATSAPP_INSTANCES, instances);
  }
}

