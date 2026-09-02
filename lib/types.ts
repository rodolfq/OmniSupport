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
  SETTINGS_EMAIL = 'settings:email',
  QUEUES_MANAGE = 'queues:manage',
  DASHBOARD_VIEW = 'dashboard:view',
  REPORTS_READ = 'reports:read',
  HOTFIXES_MANAGE = 'hotfixes:manage',
  // Nível gerencial, separado do dashboard/relatórios de time acima —
  // roadmap "Time x Gerencial", etapa 1: só a fundação de acesso, as telas
  // que consomem essas permissões vêm nas etapas seguintes.
  DASHBOARD_MANAGEMENT = 'dashboard:management',
  // Dados nominais por analista (nome + números) — REPORTS_READ continua
  // liberando só o agregado/time; isto aqui é o que hoje some numa reforma
  // futura da granularidade de /reports.
  REPORTS_INDIVIDUAL = 'reports:individual',
  REPORTS_EXPORT = 'reports:export',
  // Widget flutuante do Agente de IA (busca em chat com cliente, chat de
  // grupo interno, chamados e tickets internos) — concedida por padrão aos
  // perfis de Equipe/Time Interno na migration que introduziu o agente (ver
  // migrations/ai_assistant.sql), não só a quem administra o sistema.
  AI_ASSISTANT_USE = 'ai:assistant',
  // Giro de Atendimento (rodízio diário da equipe). Duas permissões porque as
  // duas coisas são bem diferentes: VIEW é o uso do dia a dia — abrir a tela,
  // o botão de status, registrar e concluir o próprio atendimento; MANAGE é
  // quem entra no rodízio, posição fixa, ausência, ordem manual e reprocessar.
  // Quem não tem nenhuma das duas não vê nem o item de menu nem o botão.
  GIRO_VIEW = 'giro:view',
  GIRO_MANAGE = 'giro:manage'
}

export interface StatusConfig {
  id: string;
  label: string;
  color: string;
  scope?: 'ticket' | 'internal_ticket';
  isClosed?: boolean;
  sortOrder?: number;
  parentStatusId?: string | null;
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
  // Opcional: contato criado a partir de uma conversa costuma ter só nome e
  // telefone. Ver migrations/profiles_email_opcional.sql — antes o código
  // inventava um endereço fictício para satisfazer a coluna obrigatória, e
  // como ele nunca se repetia, nunca avisava que a pessoa já existia.
  // Quem não tem e-mail não faz login (a consulta de login casa por e-mail) e
  // não recebe resposta de chamado por e-mail — a tela avisa nesse caso.
  email?: string | null;
  role: string;
  permissions?: Permission[];
  companyId?: string;
  avatarUrl?: string;
  // Miniatura de avatarUrl (ver lib/services/avatar-thumb-service.ts) —
  // usada em listas com muitos avatares ao mesmo tempo (Chamados, Tickets
  // Internos) pra não pagar o peso da foto original de cada um.
  avatarThumbUrl?: string;
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
  // Logo da empresa do usuário (Cliente/Funcionário) — só pra exibir na
  // sidebar/header do portal sem precisar buscar a empresa inteira à parte.
  // Ver Company.logoThumbUrl e migrations/companies_logo.sql.
  companyLogoThumbUrl?: string | null;
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
  // Perfil interno da empresa-cliente (nunca exposto a ela): marca cliente em
  // treinamento — mostra um indicador no chat visível só pra equipe interna
  // (ver components/chat-widget.tsx). Ver CustomerEvaluation acima para o
  // histórico de avaliações por trás da média mostrada no cadastro.
  isInTraining?: boolean;
  // CS e Comercial responsáveis pela empresa — hoje atribuídos manualmente a
  // um usuário da equipe interna (Administrador/Equipe/Time Interno);
  // pensados para vir de uma API externa no futuro.
  csResponsavelId?: string;
  comercialResponsavelId?: string;
  // Id do cliente no sistema "Central" (rastreamento/telemetria) — importado
  // da planilha de CS (ver lib/services/customer-sheet-service.ts), nunca
  // editado à mão aqui. Não é único: duas empresas podem compartilhar o
  // mesmo id_central quando são marcas/CNPJs na mesma conta central.
  idCentral?: string;
  // Empresa desativada continua existindo, com pessoas e histórico intactos —
  // só sai do uso corrente. Substitui a exclusão, que era destrutiva de um
  // jeito silencioso: apagar a empresa deixava as pessoas dela SEM empresa
  // (FK ON DELETE SET NULL) e, por consequência, invisíveis na tela, embora
  // com todos os chamados e conversas ainda no banco.
  // Ver migrations/companies_desativar.sql.
  isActive?: boolean;
  // Endereço de /api/companies/[id]/logo (não o base64) — mesmo padrão de
  // User.avatarUrl, pra não trafegar a imagem inteira em toda listagem de
  // empresas. Ver migrations/companies_logo.sql.
  logoUrl?: string;
  // Miniatura pequena o bastante pra ir embutida (data: URL) direto na
  // listagem/sidebar, sem outra requisição — mesmo padrão de
  // User.avatarThumbUrl.
  logoThumbUrl?: string;
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

// Campos comuns às listas de configuração referenciadas por id no chamado.
// Arquivar aposenta a opção sem apagá-la: ela some dos seletores de chamado
// NOVO, mas o chamado antigo continua apontando pra ela e exibindo o rótulo.
// Existe porque a FK dessas colunas é ON DELETE SET NULL — excluir um item em
// uso esvaziava o campo do chamado em silêncio, sem recuperação
// (ver migrations/config_lists_archive.sql).
export interface ArchivableConfig {
  isArchived?: boolean;
  archivedAt?: string | null;
  // Quantos registros usam este item. Só vem quando a tela pede (`usage=1`) —
  // é o que decide entre oferecer "arquivar" ou "excluir".
  usageCount?: number;
}

export interface CategoryConfig extends ArchivableConfig {
  id: string;
  label: string;
}

export interface RequestTypeConfig extends ArchivableConfig {
  id: string;
  label: string;
}

export interface ProductConfig extends ArchivableConfig {
  id: string;
  label: string;
}

// Classificação da solução do TICKET INTERNO, preenchida na conclusão. Duas
// listas editáveis em Configurações — ver
// migrations/internal_ticket_effort_outcome.sql para o porquê de serem dois
// campos e não um.
export interface EffortConfig extends ArchivableConfig {
  id: string;
  label: string;
  // Peso na carga ponderada dos relatórios (Imediato 1 … Crítico 8).
  weight: number;
  color: string;
  sortOrder: number;
}

export interface OutcomeConfig extends ArchivableConfig {
  id: string;
  label: string;
  // Desfecho que representa defeito de produto — base da taxa de "bug que
  // escapou ao cliente", independente do rótulo escolhido.
  countsAsDefect: boolean;
  color: string;
  sortOrder: number;
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
  // Classificação da solução, preenchida na conclusão (ver EffortConfig /
  // OutcomeConfig). Esforço alimenta a carga ponderada e Desfecho a taxa de
  // defeito no relatório de Carga e Complexidade.
  effortId?: string | null;
  outcomeId?: string | null;
  // Lista de valores possíveis passou a ser configurável (Configurações >
  // Geral > Status), não dá mais pra travar num union fixo de strings.
  status?: string;
}

export interface Ticket {
  id: string;
  ticketNumber?: number;
  title: string;
  description: string;
  status: TicketStatus;
  // Detalhe opcional dentro do status principal (ex.: "Aguardando Cliente" ->
  // "Feedback") — ver config_statuses.parent_status_id / StatusManager.
  subStatus?: string | null;
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
  // Preenchidos pela rota (JOIN com profiles) desde o hotfix 31/08/2026 — só
  // em GET ?action=messages. Existem pra que o nome/avatar de quem mandou a
  // mensagem não dependa de o client já ter uma lista separada de usuários
  // carregada (que Cliente/Funcionário não tem acesso, ver /api/users).
  senderName?: string | null;
  senderAvatarThumbUrl?: string | null;
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

export type WhatsappProvider = 'baileys' | 'meta';

export interface WhatsappInstance {
  id: string;
  name: string;
  phone: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  qrCode?: string;
  // 'baileys' (QR Code, WhatsApp Web não-oficial) ou 'meta' (Cloud API
  // oficial). Campos abaixo só fazem sentido para 'meta'.
  provider: WhatsappProvider;
  phoneNumberId?: string;
  // Nunca inclui o access_token de verdade pro client — só se já está
  // configurado ou não (ver getWhatsappInstances em app/actions.ts).
  hasAccessToken?: boolean;
  verifyToken?: string;
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
  productId?: string;
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
  // Ids de config_tags (domain='chat') vinculados pelo atendente em tempo real.
  tags?: string[];
}

export interface SurveySettings {
  enabled: boolean;
  message: string;
  responseWindowHours: number;
}

export interface EmailSettings {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number | null;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  fromName: string;
  fromEmail: string;
}

export interface AutomationSetting {
  event_key: string;
  enabled: boolean;
  message: string;
  delay_minutes: number;
  first_occurrence_only: boolean;
  trigger_status: string | null;
  // Canal de e-mail — independente do WhatsApp acima, mesmo evento/atraso.
  email_enabled: boolean;
  email_subject: string | null;
  updated_at: string;
}

export interface InternalGroup {
  id: string;
  name: string;
  imageUrl?: string;
  type: 'direct' | 'group';
  memberIds: string[];
  messages: ChatMessage[];
  lastMessage?: Pick<ChatMessage, 'id' | 'senderId' | 'senderName' | 'text' | 'timestamp' | 'type' | 'isDeleted'> | null;
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
  // Quantas trocas de status reais hoje (heartbeat repetido não conta) —
  // visibilidade admin pra sinalizar padrão estranho na fila, ver
  // app/(portal)/queues/page.tsx.
  statusChangesToday?: number;
  // Quando ficou online pela primeira vez hoje — define a posição no
  // rodízio (lib/services/queue-routing.ts). Sair/voltar no mesmo dia não
  // muda este valor, só a virada do dia.
  queueAnchorAt?: string;
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

// lib/services/metrics-service.ts — fonte única de cálculo das métricas de
// chat (dashboard/relatórios consomem daqui, nunca recalculam por conta
// própria). Ver comentário no topo daquele arquivo para as convenções de
// mediana/fuso/transferência/"resposta automática".
export interface MetricsFilter {
  startDate: string; // 'YYYY-MM-DD', calendário America/Sao_Paulo
  endDate: string;   // 'YYYY-MM-DD', inclusive, mesmo calendário
  queueId?: string;
  instanceId?: string; // resolvido via queues.whatsapp_instance_id — sessões sem fila ficam de fora
  companyId?: string;  // via profiles.company_id do customer_id — sessões só-por-telefone ficam de fora
  analystId?: string;  // chat_sessions.assignee_id (último respondente, ver convenção de transferência)
}

export interface MetricsPeriodInfo {
  // true quando endDate ainda não fechou (é hoje ou está no futuro, no
  // calendário America/Sao_Paulo) — UI deve marcar o número como parcial.
  parcial: boolean;
}

export interface CountResult extends MetricsPeriodInfo {
  count: number;
}

export interface MedianP90Result extends MetricsPeriodInfo {
  medianSeconds: number | null;
  p90Seconds: number | null;
  sampleSize: number;
}

export interface PercentageResult extends MetricsPeriodInfo {
  percentage: number | null;
  numerator: number;
  denominator: number;
}

export interface MedianMinutesResult extends MetricsPeriodInfo {
  medianMinutes: number | null;
  sampleSize: number;
}

export interface AverageResult extends MetricsPeriodInfo {
  average: number | null;
  sampleSize: number;
}

export interface HourlyBucket {
  bucketStart: string; // ISO, início da hora já em America/Sao_Paulo
  count: number;
  // Só preenchido por getCargaSimultanea/getAnalistasOnline (perfil por
  // hora do dia, 0-23) — usado como chave de join estável entre as duas
  // séries, já que bucketStart chega como objeto Date do driver `pg` e
  // comparar Dates por igualdade de referência nunca bate.
  hourOfDay?: number;
}

export interface SatisfactionResult extends MetricsPeriodInfo {
  positiveRate: number | null; // positivos / avaliados
  responseRate: number | null; // avaliados / fechados no período
  evaluated: number;
  totalClosed: number;
}

export interface AnalystPeak {
  analystId: string;
  analystName: string;
  peakConcurrent: number;
}

// Snapshot ao vivo — sem período, não faz parte das 11 métricas históricas
// acima (ver getChatsEmEsperaAgora/getCargaAtualPorAnalista em
// metrics-service.ts).
export interface AnalystLoadNow {
  analystId: string;
  analystName: string;
  activeChats: number;
}

// Dashboard Gerencial (Etapa 3 do roadmap "Time x Gerencial") — limites de
// faixa verde/âmbar/vermelho dos KPIs, configuráveis no banco
// (config_metric_thresholds), nunca hardcoded no componente.
export interface MetricThresholds {
  firstResponseGoodSeconds: number;
  firstResponseWarningSeconds: number;
  pct2minGoodPercentage: number;
  pct2minWarningPercentage: number;
  durationGoodMinutes: number;
  durationWarningMinutes: number;
  satisfactionGoodPercentage: number;
  satisfactionWarningPercentage: number;
  individualPeakGood: number;
  individualPeakWarning: number;
  waitingNowGood: number;
  waitingNowWarning: number;
  volumeMinExpected: number;
  // R3 "Carga e Capacidade" — chats simultâneos por analista online.
  capacityRatioGood: number;
  capacityRatioWarning: number;
  // R5 "Conta/Cliente" — sinal de risco: queda de satisfação (pontos
  // percentuais) combinada com recorrência de contato acima do limiar.
  riskSatisfactionDropPoints: number;
  riskRecurrenceRateWarning: number;
}

export type KpiStatus = 'good' | 'warning' | 'danger';

export interface ManagementAlert {
  id: string;
  severity: 'warning' | 'danger';
  message: string;
}

// Relatório "Atendimento — visão geral" (R1) e o padrão que os relatórios
// seguintes reaproveitam — ver lib/services/metrics-service.ts.
export interface HourOfDayBucket {
  hour: number; // 0-23, America/Sao_Paulo
  count: number;
}

export interface WeekdayBucket {
  weekday: number; // 0=domingo..6=sábado (EXTRACT(DOW), mesma convenção de getUTCDay() já usada no projeto)
  count: number;
}

export type ReportDimension = 'queue' | 'instance' | 'channel' | 'company' | 'analyst';

export interface DimensionBreakdownRow {
  segmentId: string | null; // null = sem esse dado (ex.: sessão sem fila/empresa)
  segmentLabel: string;
  volume: number;
  firstResponseMedianSeconds: number | null;
  firstResponseP90Seconds: number | null;
  pct2min: number | null;
  durationMedianMinutes: number | null;
  msgsPorChat: number | null;
  abandonoPercentage: number | null;
}

// Relatório "Desempenho por Analista" (R2) — abaixo de MIN_ANALYST_SAMPLE
// chats atendidos no período, a linha do analista marca amostraInsuficiente
// (a UI troca os números por aviso, mas o analista nunca some da lista).
export const MIN_ANALYST_SAMPLE = 10;

export interface AnalystPerformanceRow {
  analystId: string;
  analystName: string; // já vem anonimizado ("Analista N") pelo route quando o ator não tem reports:individual
  isSelf: boolean; // o próprio ator logado — sempre nome real, mesmo anonimizado pros outros
  amostraInsuficiente: boolean;
  chatsAtendidos: number;
  firstResponseMedianSeconds: number | null;
  durationMedianMinutes: number | null;
  msgsEnviadas: number | null;
  satisfactionPositiveRate: number | null;
  simultaneidadeMedia: number | null;
  simultaneidadePico: number | null;
  horasOnline: number | null;
  chatsPorHoraOnline: number | null; // indicador principal do relatório — null quando horasOnline = 0
}

export interface TeamMedians {
  chatsAtendidos: number | null;
  firstResponseMedianSeconds: number | null;
  durationMedianMinutes: number | null;
  msgsEnviadas: number | null;
  satisfactionPositiveRate: number | null;
  simultaneidadeMedia: number | null;
  simultaneidadePico: number | null;
  horasOnline: number | null;
  chatsPorHoraOnline: number | null;
}

export interface AnalystAbsenceBreakdown {
  analystId: string;
  analystName: string;
  reason: string;
  hours: number;
}

// Relatório "Carga e Capacidade" (R3) — 1 linha por hora-calendário do
// período (o "dado bruto", drill-down por faixa) e o resumo por hora-do-dia
// (0-23) que agrega essas linhas. Ver lib/services/metrics-service.ts.
export interface CapacityRawBucket {
  bucketStart: string;
  dateSp: string; // dia-calendário America/Sao_Paulo, 'YYYY-MM-DD'
  hour: number; // 0-23
  cargaSimultanea: number;
  analistasOnline: number;
  picoIndividual: number;
  cargaPorAnalista: number | null; // null quando analistasOnline = 0
  critico: boolean;
}

export interface CapacityHourSummary {
  hour: number;
  cargaSimultaneaMediana: number | null;
  analistasOnlineMediana: number | null;
  picoIndividualMediana: number | null;
  cargaPorAnalistaMediana: number | null;
  diasCriticos: number;
  diasAmostrados: number;
  status: KpiStatus;
}

// Relatório "Satisfação e Qualidade" (R4) — evolui app/api/reports/survey/
// route.ts. chat_histories.rating é -1/0/1 (nunca convertido pra escala
// 1-5 de fonte externa — decisão em aberto, fora deste relatório).
export interface SatisfactionTrendBucket {
  bucketStart: string;
  evaluated: number;
  positive: number;
  positiveRate: number | null;
}

export interface SatisfactionDimensionRow {
  segmentId: string | null;
  segmentLabel: string;
  evaluated: number;
  positive: number;
  negative: number;
  positiveRate: number | null;
  responseRate: number | null;
  amostraInsuficiente: boolean;
}

export interface SatisfactionTimeRangeRow {
  rangeLabel: string;
  evaluated: number;
  positive: number;
  positiveRate: number | null;
}

export interface NegativeEvaluationRow {
  historyId: string;
  sessionId: string | null;
  customerName: string;
  analystName: string | null;
  finishedAt: string;
  firstResponseSeconds: number | null;
  durationSeconds: number | null;
  ticketNumber: number | null;
}

// Relatório "Conta/Cliente" (R5) — único dos cinco que responde pergunta
// comercial (diretoria/CS), não operacional.
export interface AccountSummaryRow {
  companyId: string;
  companyName: string;
  volume: number;
  minutosConsumidos: number;
  recorrenciaRate: number | null; // % de chats que são recontato do mesmo cliente em até 72h
  positiveRate: number | null;
  responseRate: number | null;
  avaliacaoInternaMedia: number | null; // customer_evaluations, critério em branco não entra na média
  sinalRisco: boolean; // queda de satisfação vs. período anterior + recorrência alta — calculado na rota
}

export interface AccountTopContact {
  customerId: string;
  customerName: string;
  volume: number;
  minutosConsumidos: number;
}

export interface AccountMonthlyBucket {
  monthStart: string;
  volume: number;
  minutosConsumidos: number;
  positiveRate: number | null;
  recorrenciaRate: number | null;
}

// ==========================================================================
// GIRO DE ATENDIMENTO
// ==========================================================================
// Rodízio diário da equipe de suporte — não confundir com Fila (Queue), que
// distribui a conversa que chega. Aqui a pergunta respondida é "de quem é a
// vez de pegar o próximo atendimento hoje".

/** Tipos de atendimento de uma linha do Giro. Chamado é o padrão. */
export const GIRO_SERVICE_TYPES = ['Chamado', 'Telefone', 'Almoço', 'Ausente'] as const;
export type GiroServiceType = typeof GIRO_SERVICE_TYPES[number];

/**
 * Vagas de almoço do dia: cada horário tem um número fixo de vagas — 1 vaga
 * às 11:00 e 14:00, 4 vagas às 12:00 e 13:00 (10 vagas no total, pedido do
 * time). Zera sozinho todo dia porque é contado em cima de
 * `giro_day_rows.lunch_time`, que nasce vazio a cada novo dia de Giro — não
 * precisa de reset explícito em lugar nenhum.
 */
/**
 * Horário de almoço configurável em Configuração > Horários de almoço
 * (lib/services/giro-service.ts:listLunchCapacity, tabela
 * giro_lunch_slots — uma linha por vaga, `capacity` é quantas linhas
 * existem com aquele horário). Não é mais uma lista fixa em código.
 */
export interface GiroLunchCapacity {
  time: string;
  capacity: number;
}

/** Quantas pessoas já ocupam cada horário — conta só linhas com almoço
 * marcado; o resto (checklist, tipo de atendimento etc.) não entra aqui. */
export function countLunchOccupancy(rows: { lunchTime: string | null }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (!r.lunchTime) continue;
    counts[r.lunchTime] = (counts[r.lunchTime] ?? 0) + 1;
  }
  return counts;
}

/**
 * Vagas restantes num horário PARA QUEM ESTÁ EDITANDO — desconta a própria
 * linha da contagem, senão a pessoa ficaria travada no horário que ela mesma
 * já ocupa (a vaga dela não é "de outro", é dela).
 */
export function lunchSlotsRemaining(
  time: string,
  occupancy: Record<string, number>,
  ownCurrentLunchTime: string | null,
  capacity: GiroLunchCapacity[]
): number {
  const slot = capacity.find(s => s.time === time);
  if (!slot) return 0;
  const occupied = (occupancy[time] ?? 0) - (ownCurrentLunchTime === time ? 1 : 0);
  return Math.max(0, slot.capacity - occupied);
}

export interface GiroChecklistItem {
  id: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

export interface GiroParticipant {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  avatarThumbUrl?: string | null;
  workSchedule: string | null;
  positionType: 'free' | 'fixed';
  fixedPosition: number | null;
  /**
   * Ordem "programada" entre os livres — o que o admin define arrastando a
   * lista em Configuração. Base da rotação quando não há giro anterior pra
   * herdar (participante novo, ou giro sendo montado pela primeira vez).
   */
  baseOrder: number;
  outOfRotation: boolean;
  absentUntil: string | null;
  absenceNote: string | null;
  /** Derivado no servidor: absentUntil ainda no futuro. */
  isAbsent: boolean;
}

export interface GiroRow {
  id: string;
  userId: string;
  userName: string;
  avatarUrl?: string | null;
  avatarThumbUrl?: string | null;
  position: number;
  serviceType: GiroServiceType;
  serviceTime: string | null;
  note: string | null;
  lunchTime: string | null;
  /** Mapa itemId -> marcado. Item removido do cadastro simplesmente some da tela. */
  checklist: Record<string, boolean>;
  workSchedule: string | null;
  isFixed: boolean;
  isHandoff: boolean;
  /** Quantos atendimentos esta pessoa já concluiu hoje — quem tem menos vai na frente. */
  completedCount: number;
}

export interface GiroHistoryEntry {
  id: string;
  userId: string | null;
  userName: string;
  serviceType: GiroServiceType;
  serviceTime: string | null;
  note: string | null;
  createdAt: string;
}

export interface GiroDay {
  id: string;
  date: string; // AAAA-MM-DD — chave de ordenação/consulta, exibida como DD/MM/AAAA
  handoffMode: 'auto' | 'pinned' | 'none';
  handoffUserId: string | null;
  rows: GiroRow[];
  history: GiroHistoryEntry[];
  /** Data passada: abre somente leitura, nunca gera nem regera. */
  isReadOnly: boolean;
  /** `false` quando a data é passada e nunca teve giro — a tela mostra vazio. */
  exists: boolean;
}
