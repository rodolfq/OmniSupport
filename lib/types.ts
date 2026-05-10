export enum TicketStatus {
  NEW = 'Novo',
  IN_PROGRESS = 'Em Andamento',
  AWAITING_INTERNAL = 'Aguardando Equipe interna',
  AWAITING_CUSTOMER = 'Aguardando Cliente',
  CLOSED = 'Concluído'
}

/* eslint-disable @typescript-eslint/no-duplicate-enum-values */
export enum UserRole {
  ADMIN = 'Equipe',
  SUPPORT = 'Equipe',
  CUSTOMER = 'Funcionário',
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

export interface StatusConfig {
  id: string;
  label: string;
  color: string;
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
  role: string;
  companyId?: string;
  avatarUrl?: string;
  phone?: string;
  phones?: string[];
  password?: string;
  mustChangePassword?: boolean;
  viewAllCompanyTickets?: boolean;
  status?: 'online' | 'away' | 'offline';
  statusReason?: string;
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

export interface PriorityConfig {
  id: string;
  label: string;
  slaHours: number;
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
  teamId: string;
  assigneeId?: string;
  priority: number;
  tags: string[];
  creatorId: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  slaLimit?: string;
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
  employeeIds?: string[];
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
  slaLimit?: string;
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

export interface Attachment {
  id: string;
  name: string;
  type: string;
  url: string;
  size: number;
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
  replyToId?: string;
  readBy?: string[];
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
  queueId?: string;
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
  pinnedBy?: string[];
  pinnedMessageIds?: string[];
  mutedBy?: string[];
  readLaterBy?: string[];
  hiddenBy?: string[];
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

export interface AbsenceReason {
  id: string;
  label: string;
}

export interface SavedFilter {
  id: string;
  name: string;
  filters: any;
}
