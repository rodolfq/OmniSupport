export enum TicketStatus {
  NEW = 'Novo',
  IN_PROGRESS = 'Em Atendimento',
  AWAITING_INTERNAL = 'Aguardando Equipe interna',
  AWAITING_CUSTOMER = 'Aguardando Cliente',
  CLOSED = 'Fechado'
}

/* eslint-disable @typescript-eslint/no-duplicate-enum-values */
export enum UserRole {
  ADMIN = 'Administrador',
  SUPPORT = 'Equipe', 
  CUSTOMER = 'Cliente',
  EMPLOYEE = 'Funcionário',
  INTERNAL = 'Time Interno'
}

export enum Permission {
  TICKETS_READ = 'tickets:read',
  TICKETS_WRITE = 'tickets:write',
  TICKETS_DELETE = 'tickets:delete',
  TICKETS_ASSIGN = 'tickets:assign',
  // "Central de Atendimento": fila de chats do WhatsApp (widget + /chat-management).
  OUTSIDE_QUEUE_VIEW = 'tickets:outside_queue',
  INTERNAL_TICKETS_VIEW = 'internal:view',
  INTERNAL_TICKETS_EDIT = 'internal:edit',
  // Sem isto, quem tem internal:view só enxerga tickets internos da(s)
  // própria(s) equipe(s) (internalTeamIds) — ver internal-tickets/page.tsx.
  INTERNAL_TICKETS_VIEW_ALL = 'internal:view_all',
  CUSTOMERS_READ = 'customers:read',
  CUSTOMERS_WRITE = 'customers:write',
  CHAT_INTERNAL_VIEW = 'chat:internal',
  // Conectar/desconectar canais (QR code, Meta API) — mais sensível que só
  // atender (OUTSIDE_QUEUE_VIEW), por isso é uma permissão separada.
  WHATSAPP_MANAGE = 'whatsapp:manage',
  TEAM_READ = 'team:read',
  TEAM_WRITE = 'team:write',
  // Ver/gerenciar status e histórico de ausência de OUTROS analistas
  // (Configurações > Ausência/Histórico) — não é o próprio status de cada um.
  TEAM_STATUS_MANAGE = 'team:status',
  SETTINGS_WRITE = 'settings:write',
  SETTINGS_SYSTEM = 'settings:system',
  // Mensagens Automáticas e Integrações eram cobertas pela mesma permissão
  // de SETTINGS_SYSTEM — separadas pra dar controle fino de verdade.
  SETTINGS_AUTOMATION = 'settings:automation',
  SETTINGS_INTEGRATIONS = 'settings:integrations',
  QUEUES_MANAGE = 'queues:manage',
  DASHBOARD_VIEW = 'dashboard:view',
  REPORTS_READ = 'reports:read',
  HOTFIXES_MANAGE = 'hotfixes:manage'
}

export interface StatusConfig {
  id: string;
  label: string;
  color: string;
}

export interface RolePermission {
  id: string;
  name: string;
  role: string;
  permissions: Permission[];
  // NULL/undefined = perfil global (do sistema); preenchido = perfil criado
  // por/para uma equipe interna específica (ver internal_teams.admin_ids).
  internalTeamId?: string | null;
  isSystem?: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions?: Permission[];
  companyId?: string;
  avatarUrl?: string;
  phone?: string;
  phones?: string[];
  password?: string;
  mustChangePassword?: boolean;
  viewAllCompanyTickets?: boolean;
  livesInSquad?: boolean;
  isActive?: boolean;
  internalTeamIds?: string[];
  accessProfileId?: string;
  // Equipes que este usuário administra (internal_teams.admin_ids contém o
  // id dele) — pode criar/editar usuários e perfis de acesso escopados a
  // elas. Vazio/undefined para quem não administra nenhuma equipe.
  adminOfTeamIds?: string[];
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

// Classificação rápida e opcional atribuída pelo analista numa avaliação —
// mostrada no cadastro como a mais recente registrada para o cliente.
export type CustomerProfileTag = 'technical' | 'beginner' | 'challenging';

// null = "não se aplica" nesse critério — não entra na média (nem da
// avaliação em si, nem no cálculo agregado por empresa).
export interface CustomerEvaluationScores {
  knowledgeScore: number | null;
  autonomyScore: number | null;
  learningScore: number | null;
  engagementScore: number | null;
  organizationScore: number | null;
  communicationScore: number | null;
}

// 'chat_close': gerada pela pesquisa automática ao encerrar um chat.
// 'manual': preenchida direto no cadastro da empresa, sem atendimento associado.
export type CustomerEvaluationOrigin = 'chat_close' | 'manual';

// Abaixo desse número de avaliações, a média não é confiável o bastante pra
// guiar decisão — usado só pra decidir quando mostrar o aviso de amostra
// pequena (não trava nada, é sempre visual/informativo).
export const MIN_RELIABLE_EVALUATION_COUNT = 3;

// Uma avaliação pontual da empresa-cliente feita por um analista (ex: ao
// encerrar um chat) — nunca visível para o cliente. Vinculada à empresa
// (companies), não a um contato/funcionário específico, já que descreve o
// relacionamento com a conta como um todo. O cadastro da empresa mostra a
// média de todas as avaliações; o relatório lista o histórico completo.
export interface CustomerEvaluation extends CustomerEvaluationScores {
  id: string;
  companyId: string;
  analystId?: string;
  analystName?: string;
  chatSessionId?: string;
  // Contato (profiles.id) que gerou o atendimento por trás da avaliação —
  // opcional, só pra contexto/rastreabilidade; não entra na média da empresa.
  contactId?: string | null;
  contactName?: string | null;
  origin: CustomerEvaluationOrigin;
  profileTag?: CustomerProfileTag | null;
  createdAt: string;
}

export interface CustomerEvaluationSummary {
  count: number;
  averages: CustomerEvaluationScores;
  overallAverage: number;
  latestTag: CustomerProfileTag | null;
  // Notas da avaliação mais recente (não a média) — usado como ponto de
  // partida quando o cadastro do cliente permite editar direto por cima da
  // última avaliação em vez de partir do zero.
  latestScores: CustomerEvaluationScores | null;
  // Quantas avaliações vieram de atendimento real (chat_close) vs. ajuste
  // manual no cadastro — dá pra ver de cara se a média reflete interações
  // de verdade ou é maioria edição manual.
  countByOrigin: { chatClose: number; manual: number };
}

export interface Company {
  id: string;
  name: string;
  industry?: string;
  phone?: string;
  // Perfil interno da empresa-cliente (nunca exposto a ela): sincronismo com
  // o Radar, usado numa integração futura. Ver CustomerEvaluation acima para
  // o histórico de avaliações por trás da média mostrada no cadastro.
  radarSync?: boolean;
}

export interface PriorityConfig {
  id: string;
  label: string;
  slaHours: number;
  // A API/compat layer do Supabase retorna a coluna do Postgres sem
  // transformação (sla_hours); alguns consumidores leem esse nome direto.
  sla_hours?: number;
  slaDays?: number;
  color: string;
}

export interface CategoryConfig {
  id: string;
  label: string;
}

export interface RequestTypeConfig {
  id: string;
  label: string;
}

export interface ProductConfig {
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
  id?: string; // Formatted ID like "int-0001"
  uuid?: string; // Real UUID from database
  parentTicketId?: string;
  parentTicketIds?: string[];
  internalTicketNumber?: number;
  title: string;
  teamId?: string;
  internalTeamId?: string;
  assigneeId?: string;
  priority: number;
  tags: string[];
  creatorId?: string;
  description: string;
  createdAt?: string;
  updatedAt?: string;
  slaLimit?: string | null;
  expectedPublishDate?: string | null;
  // Marcador informativo: hotfix cadastrado ao qual este ticket se refere —
  // ver app/(portal)/hotfixes/page.tsx.
  hotfixId?: string | null;
  status?: "Novo" | "Em Andamento" | "Em Atendimento" | "Em Espera" | "Pendente" | "Resolvido" | "Concluído" | "Fechado" | "Encerrado" | "Cancelado";
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
  assigneeName?: string;
  employeeIds?: string[];
  assigneeId?: string;
  createdAt: string;
  completedAt?: string;
  updatedAt: string;
  category?: string; // legado: pré-split Fila/Categoria/Tipo de Solicitação, mantido só para compat com integrações externas — código novo não precisa mais preenchê-lo
  queueId?: string;
  categoryId?: string;
  requestTypeId?: string;
  productId?: string;
  tags: string[];
  attachments?: Attachment[];
  relatedTickets?: string[];
  history?: any[];
  internalTicketId?: string;
  slaLimit?: string;
  // Sessão de chat que originou este chamado (ver saveTicketFromChatSession em
  // app/actions.ts) — usada pra buscar o histórico da conversa ao vivo em vez
  // de duplicá-lo em `description`.
  chatSessionId?: string;
  // Preenchido só quando este chamado foi absorvido numa mesclagem (item 12
  // do roadmap) — aponta pro chamado sobrevivente. Ver mergeTickets em
  // app/actions.ts.
  mergedIntoId?: string;
}

export interface Message {
  id: string;
  ticketId?: string;
  senderId: string;
  text: string;
  timestamp: string;
  isVisibleToCustomer: boolean;
  // 'system_log' é igual a 'system' (evento automático, não digitado por
  // ninguém) mas nunca aparece na conversa/feed visível — só na aba
  // Histórico. Usado pra edição de descrição, que é "gravada" mas não vira
  // mensagem (ver ticket-diff / handleUpdateTicket / saveMainTicketDescription).
  type: 'text' | 'system' | 'internal' | 'system_log';
  attachments?: Attachment[];
}

export interface Attachment {
  id: string;
  name: string;
  type: string;
  url: string;
  size: number;
  // Preenchido de forma assíncrona depois do envio, quando a transcrição
  // local de áudio está habilitada (ver lib/services/transcription-service.ts).
  transcription?: string;
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
  includeInternalChats: boolean;
  // 'round_robin' (padrão) ou 'daily_balance' — item 14 do roadmap.
  routingStrategy: string;
  createdAt: string;
}

// Item 17 do roadmap — cadastro de hotfix / janela de release.
export interface Hotfix {
  id: string;
  name: string;
  description?: string;
  responsibleId?: string;
  expectedDate: string; // YYYY-MM-DD
  publishedAt?: string;
  createdAt: string;
}

export interface QuickNote {
  id: string;
  shortcut: string;
  content: string;
  category: string;
}

export interface MessageReaction {
  userId: string;
  emoji: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
  // 'internal': aviso de bastidores (ex: transferência entre analistas/fila)
  // que nunca deve aparecer pra quem está do lado do cliente (role Cliente/
  // Funcionário) — ver filtro em chat-widget.tsx (selectedChatMessageRows).
  // 'image': preview inline no Chat Interno (chat com cliente já detecta
  // imagem por mime-type mesmo com type: 'file', ver lib/attachment-kind.ts).
  type: 'text' | 'system' | 'internal' | 'file' | 'image' | 'gif' | 'sticker';
  // Soft-delete: texto original nunca é apagado da linha (ver deletedAt),
  // isDeleted só controla a exibição ("mensagem apagada").
  isDeleted?: boolean;
  deletedAt?: string | null;
  isEdited?: boolean;
  editedAt?: string | null;
  replyToId?: string;
  // 2o check (cinza, "entregue"): cliente do destinatário sincronizou.
  deliveredBy?: string[];
  // 3o check (colorido, "lido"): destinatário abriu essa conversa de fato —
  // sempre subconjunto de deliveredBy.
  readBy?: string[];
  reactions?: MessageReaction[];
  metadata?: {
    fileUrl?: string;
    fileName?: string;
    fileSize?: number;
    gifUrl?: string;
    stickerUrl?: string;
    attachments?: Attachment[];
    // Citações @nome no chat interno em grupo (components/(portal)/chat-internal).
    // Nome vem "congelado" no momento do envio pra destacar certo mesmo se o
    // usuário for renomeado depois.
    mentions?: { id: string; name: string }[];
  };
  attachments?: Attachment[];
}

export interface ChatSession {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  assigneeId?: string;
  queueId?: string;
  status: 'pending' | 'active' | 'closed';
  ticketId?: string;
  ticketNumber?: number;
  messages: ChatMessage[];
  startedAt: string;
  lastMessageAt: string;
  awaitingSurveyUntil?: string;
}

export interface SurveySettings {
  enabled: boolean;
  message: string;
  responseWindowHours: number;
}

export interface AutomationSetting {
  event_key: string;
  enabled: boolean;
  message: string;
  delay_minutes: number;
  first_occurrence_only: boolean;
  trigger_status: string | null;
  updated_at: string;
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
  // 'online' | 'away' | 'offline' — granularidade extra sobre isOnline,
  // usado pra distinguir "Ausente" (away, mas tecnicamente is_online=true
  // em alguns fluxos) de "Online" de fato na presença exibida no chat.
  status?: string;
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
