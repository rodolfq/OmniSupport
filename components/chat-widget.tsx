'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { 
  MessageSquare, 
  X, 
  ChevronDown, 
  ChevronUp, 
  Send, 
  Users, 
  User, 
  Hash, 
  MessageSquareText,
  MoreVertical,
  ArrowRightLeft,
  Power,
  Search,
  Plus,
  Maximize2,
  Minimize2,
  MessageCircle,
  Phone,
  Ticket as TicketIcon,
  LayoutGrid,
  Paperclip,
  File,
  Image as ImageIcon,
  Mic,
  Square,
  Trash2,
  Captions,
  Loader2,
  Check,
  CheckCheck,
  Reply,
  History,
  ChevronRight,
  ThumbsUp,
  ThumbsDown,
  Copy,
  Link2,
  AlertCircle,
  RotateCw,
  CheckCircle2,
  Clock,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChatMessage,
  ChatReplyQuote,
  ChatSession,
  QuickNote,
  AnalystStatus,
  User as UserType,
  UserRole,
  Ticket,
  Company,
  Attachment,
  TagConfig,
  Permission
} from '@/lib/types';
import { MAX_ATTACHMENT_TOTAL_BYTES, MAX_ATTACHMENT_TOTAL_LABEL } from '@/lib/attachment-limits';
import { QuickRepliesPanel } from './quick-replies-panel';
import { ChatService, fetchChatSessions, pushChatMessage, createChatSession, saveChatHistory, submitSurveyResponse, transcribeChatAudio, getPreviousChatHistories, fetchSessionMessages, PreviousChatHistoriesResult, SessionMessagesResult } from '@/lib/services/chat-service';
import { fetchQuickNotes, fetchAnalystStatuses, fetchCompanies, fetchQueues, fetchSurveySettings, ConfigService } from '@/lib/services/config-service';
import { useProfilesWithAvatarQuery } from '@/lib/query-hooks';
import { TicketService } from '@/lib/services/ticket-service';
import { saveTicketFromChatSession, closeChatSessionAfterTicket, assignChatSession, returnChatSessionToQueue, setChatSessionTags } from '@/lib/services/chat-session-actions';
import { checkPyvonOutboundStatus, startPyvonConversation } from '@/lib/services/pyvon-template-service';
import { ChatTagPicker, tagAccentBgClass } from '@/components/chat-tag-picker';
import { cn, maskPhone, matchPhones, safeJsonStringify, normalizeString, normalizePhone } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { isEvaluationSnoozed } from '@/lib/evaluation-snooze';
import { deriveLiveStatus } from '@/lib/presence';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { LinkContactModal } from '@/components/link-contact-modal';
import { renderLinkedText } from '@/components/linked-chat-text';
import { PhoneContactPanel } from '@/components/phone-contact-panel';
import { ClientTime } from '@/components/client-time';
import { AssignChatMenu } from '@/components/assign-chat-menu';
import { AudioPlayer } from '@/components/audio-player';
import { AttachmentPreviewModal, openAttachmentInNewTab } from '@/components/attachment-gallery';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { LinkTicketModal } from '@/components/link-ticket-modal';
import { isImageAttachment, isAudioAttachment, isVideoAttachment } from '@/lib/attachment-kind';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';

// Mesmo teto das demais telas (lib/attachment-limits.ts, alinhado ao Nginx). Era
// 8MB só aqui — e o servidor também cortava o corpo em 10MB (ver
// middlewareClientMaxBodySize em next.config.ts), então nem 8MB de arquivo
// passavam de fato.
const MAX_CHAT_ATTACHMENT_SIZE = MAX_ATTACHMENT_TOTAL_BYTES;

// Botão flutuante arrastável (clicar e segurar pra mover, ver
// handleLauncherPointerDown mais abaixo) — tamanho real do botão (w-16 h-16)
// e margem mínima até a borda da tela, usados tanto pra travar o arrasto
// dentro da viewport quanto pra recalcular se ele ficaria fora da tela num
// resize/rotação. Posição fica em px absolutos (canto sup.-esquerdo do
// botão), persistida no localStorage — é preferência só deste navegador,
// não precisa ir pro banco.
const CHAT_LAUNCHER_SIZE = 64;
const CHAT_LAUNCHER_EDGE_MARGIN = 8;
const CHAT_LAUNCHER_POS_KEY = 'omni-chat-launcher-pos';

function clampChatLauncherPos(left: number, top: number) {
  if (typeof window === 'undefined') return { left, top };
  const maxLeft = Math.max(CHAT_LAUNCHER_EDGE_MARGIN, window.innerWidth - CHAT_LAUNCHER_SIZE - CHAT_LAUNCHER_EDGE_MARGIN);
  const maxTop = Math.max(CHAT_LAUNCHER_EDGE_MARGIN, window.innerHeight - CHAT_LAUNCHER_SIZE - CHAT_LAUNCHER_EDGE_MARGIN);
  return {
    left: Math.min(Math.max(left, CHAT_LAUNCHER_EDGE_MARGIN), maxLeft),
    top: Math.min(Math.max(top, CHAT_LAUNCHER_EDGE_MARGIN), maxTop),
  };
}

// Só formata o padrão BR mais comum (55 + DDD + 9 dígitos, com ou sem o "55");
// qualquer outro formato (número estrangeiro, grupo/broadcast antigo) cai no
// fallback e mostra os dígitos como vieram, em vez de arriscar um agrupamento errado.
function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const local = digits.startsWith('55') && digits.length === 13 ? digits.slice(2) : digits;
  if (local.length === 11) {
    return `+55 (${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  return phone;
}

// Origem visível da conversa — sessão sem `channel` (criada antes deste
// campo existir, ver migrations/chat_sessions_channel.sql) não mostra nada,
// em vez de arriscar um palpite errado.
function getChannelLabel(channel?: string): string | null {
  switch (channel) {
    case 'whatsapp_baileys': return 'WhatsApp (não-oficial)';
    case 'pyvon': return 'WhatsApp (Pyvon)';
    case 'widget': return 'Portal (chat)';
    default: return null;
  }
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Erro ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}

// Codifica um WAV PCM 16-bit mono a partir das amostras capturadas via Web Audio API.
// Construindo o arquivo byte a byte nós mesmos (em vez de depender de um encoder de
// codec do navegador), eliminamos qualquer ambiguidade de contêiner/codec na reprodução.
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample; // mono
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // tamanho do bloco fmt
  view.setUint16(20, 1, true); // formato PCM
  view.setUint16(22, 1, true); // 1 canal (mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits por amostra
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

// Largura da lista de conversas ("em andamento") no chat MAXIMIZADO — a divisória
// entre ela e a conversa aberta é arrastável. Preferência só deste navegador
// (localStorage), igual à posição do botão flutuante.
const CHAT_LIST_WIDTH_KEY = 'omni_chat_list_width';
const CHAT_LIST_WIDTH_DEFAULT = 350; // mesma largura da lista em /chat-internal
const CHAT_LIST_WIDTH_MIN = 260;
const CHAT_LIST_WIDTH_MAX = 640;
const CHAT_THREAD_MIN_WIDTH = 460; // a conversa aberta nunca é espremida abaixo disso

function clampChatListWidth(width: number): number {
  const viewport = typeof window !== 'undefined' ? window.innerWidth : 1600;
  const max = Math.max(CHAT_LIST_WIDTH_MIN, Math.min(CHAT_LIST_WIDTH_MAX, viewport - CHAT_THREAD_MIN_WIDTH));
  return Math.round(Math.min(Math.max(width, CHAT_LIST_WIDTH_MIN), max));
}

// Mensagem que o CLIENTE mandou (não a da equipe, nem mensagem automática do
// sistema): base do "não lida" da lista. Mensagem automática (template, resposta
// automática, Modo de Crise) tem sender_id nulo, então o remetente sozinho não
// distingue — daí olhar também o metadata.
function isIncomingCustomerMessage(m: ChatMessage, session: { customerId?: string | null }): boolean {
  if (m.isDeleted) return false;
  if (m.type === 'internal' || m.type === 'system' || (m.type as string) === 'system_log') return false;
  const md: any = m.metadata || {};
  if (md.template || md.auto_reply || md.systemEvent || md.source === 'crisis_mode') return false;
  if (m.senderId) return !!session.customerId && m.senderId === session.customerId;
  return md.source === 'pyvon' || md.source === 'whatsapp';
}

export function ChatWidget() {
  const [mounted, setMounted] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [showNewMessageIndicator, setShowNewMessageIndicator] = useState(false);
  const prevMessageCountRef = useRef(0);
  const messagesChannelRef = useRef<any>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const closeReactionPicker = () => setReactionPickerMessageId(null);
    window.addEventListener('click', closeReactionPicker);
    return () => window.removeEventListener('click', closeReactionPicker);
  }, []);

  useEffect(() => {
    const closeMoreActions = () => setIsMoreActionsOpen(false);
    window.addEventListener('click', closeMoreActions);
    return () => window.removeEventListener('click', closeMoreActions);
  }, []);

  const {
    currentUser,
    notificationSettings,
    notifications, 
    addNotification,
    markNotificationRead,
    markNotificationsAsReadByTarget,
    pruneStaleChatNotifications,
    isOmniChatOpen,
    setIsOmniChatOpen,
    isOmniChatExpanded,
    setIsOmniChatExpanded,
    activeOmniChatId,
    setActiveOmniChatId,
    triggerRefresh,
    getContactPhoto,
    ensureContactPhoto,
    userStatus,
    openEvaluationModal,
    hasPermission
  } = useApp();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const isMobileViewport = useIsMobile();

  const [customerSessions, setCustomerSessions] = useState<ChatSession[]>([]);
  // Telefone clicado dentro de uma mensagem (ver renderLinkedText abaixo) —
  // não abre mais a conversa direto, mostra o painel de confirmação
  // (components/phone-contact-panel.tsx) primeiro.
  const [phoneContactPanelPhone, setPhoneContactPanelPhone] = useState<string | null>(null);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  // "Fulano está digitando..." (SSE, ver useEffect do EventSource abaixo) —
  // só a conversa aberta importa, por isso um único nome basta (não um mapa
  // por sessão como no Chat Interno, que tem grupos).
  const [typingUserName, setTypingUserName] = useState<string | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentAtRef = useRef(0);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  // Mensagem que o analista está citando ("responder" do WhatsApp) — só canal Pyvon.
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraftText, setEditDraftText] = useState('');
  const [messageHistoryFor, setMessageHistoryFor] = useState<string | null>(null);
  const [messageHistoryEntries, setMessageHistoryEntries] = useState<{ previousText: string; editedAt: string; editedByName: string | null }[]>([]);
  const [revealedDeletedIds, setRevealedDeletedIds] = useState<Set<string>>(new Set());

  // Track expanded state locally
  const [isExpanded, setIsExpanded] = useState(false);
  const [chatListWidth, setChatListWidth] = useState(CHAT_LIST_WIDTH_DEFAULT);
  const [isResizingList, setIsResizingList] = useState(false);
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(CHAT_LIST_WIDTH_KEY));
      if (saved > 0) setChatListWidth(clampChatListWidth(saved));
    } catch {}
  }, []);
  // Janela redimensionada: a lista não pode passar do que sobra pra conversa.
  useEffect(() => {
    const onWindowResize = () => setChatListWidth(w => clampChatListWidth(w));
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, []);
  const saveChatListWidth = (width: number) => {
    try { window.localStorage.setItem(CHAT_LIST_WIDTH_KEY, String(width)); } catch {}
  };
  const startResizeList = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    const startX = e.clientX;
    const startWidth = chatListWidth;
    let latest = startWidth;
    handle.setPointerCapture(e.pointerId);
    setIsResizingList(true);
    const onMove = (ev: PointerEvent) => {
      latest = clampChatListWidth(startWidth + (ev.clientX - startX));
      setChatListWidth(latest);
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      setIsResizingList(false);
      saveChatListWidth(latest);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };

  // Use isOmniChatOpen directly instead of syncing with a local isMinimized state
  const isMinimized = !isOmniChatOpen;
  const setIsMinimized = (minimized: boolean) => setIsOmniChatOpen(!minimized);

  // Posição livre do botão flutuante (null = ainda no canto padrão,
  // inferior direito). Carregada uma vez do localStorage já com clamp pro
  // tamanho de tela atual, porque a tela pode ter mudado de tamanho desde a
  // última vez que a posição foi salva neste navegador.
  const [launcherPos, setLauncherPos] = useState<{ left: number; top: number } | null>(null);
  const [isDraggingLauncher, setIsDraggingLauncher] = useState(false);
  // Sobrevive ao pointerup/click sintético que o navegador dispara em
  // seguida — sem isso, soltar o botão depois de arrastar também contaria
  // como um clique e abriria/fecharia o chat sem o usuário pedir.
  const justDraggedLauncherRef = useRef(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CHAT_LAUNCHER_POS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed?.left === 'number' && typeof parsed?.top === 'number') {
          setLauncherPos(clampChatLauncherPos(parsed.left, parsed.top));
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    const onResize = () => {
      setLauncherPos(prev => (prev ? clampChatLauncherPos(prev.left, prev.top) : prev));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Clicar e segurar (350ms parado) entra em modo de arrasto; soltar antes
  // disso é só um clique normal (abre/fecha). Uma vez arrastando, o botão
  // segue o ponteiro livremente, travado dentro da tela (clampChatLauncherPos).
  const handleLauncherPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = e.currentTarget.getBoundingClientRect();
    const origLeft = rect.left;
    const origTop = rect.top;
    let dragActive = false;
    let finalPos: { left: number; top: number } | null = null;

    const activateDrag = () => {
      dragActive = true;
      justDraggedLauncherRef.current = true;
      setIsDraggingLauncher(true);
      document.body.style.userSelect = 'none';
    };
    const holdTimer = setTimeout(activateDrag, 350);

    const onMove = (moveEvent: PointerEvent) => {
      if (!dragActive) return;
      moveEvent.preventDefault();
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      finalPos = clampChatLauncherPos(origLeft + dx, origTop + dy);
      setLauncherPos(finalPos);
    };
    const onUp = () => {
      clearTimeout(holdTimer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (dragActive) {
        setIsDraggingLauncher(false);
        document.body.style.userSelect = '';
        if (finalPos) {
          try { window.localStorage.setItem(CHAT_LAUNCHER_POS_KEY, JSON.stringify(finalPos)); } catch {}
        }
        setTimeout(() => { justDraggedLauncherRef.current = false; }, 0);
      } else {
        justDraggedLauncherRef.current = false;
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  useEffect(() => {
    if (!isExpanded || isMinimized) return;

    return () => {
      setIsOmniChatExpanded(false);
    };
  }, [isExpanded, isMinimized, setIsOmniChatExpanded]);

  useEffect(() => {
    if (isExpanded && !isMinimized) {
      setIsOmniChatExpanded(true);
    }
  }, [isExpanded, isMinimized, setIsOmniChatExpanded]);

  useEffect(() => {
    // Só marca como lida quando o painel está de fato aberto — NÃO abre
    // sozinho. Selecionar uma conversa (setActiveOmniChatId) também acontece
    // em segundo plano, sem o cliente ter pedido (ver o efeito "cliente não
    // tem lista lateral" mais abaixo, que escolhe o atendimento em aberto
    // assim que ele chega do servidor, mesmo com o painel fechado) — marcar
    // como lida nesse momento apagaria o indicador de mensagem nova antes de
    // quem está usando ter visto qualquer coisa. Abrir de propósito é sempre
    // explícito: quem quer abrir chama setIsOmniChatOpen(true) junto no
    // próprio call site (clique no ícone, clique numa notificação, ?chat= na
    // URL) — nunca só por tabela aqui.
    if (activeOmniChatId && !isMinimized) {
      markNotificationsAsReadByTarget(activeOmniChatId);
    }
  }, [activeOmniChatId, isMinimized, markNotificationsAsReadByTarget]);

  // Rede de segurança pra quando OUTRO componente manda abrir uma conversa
  // por aqui sem passar pelo fluxo interno deste widget — ex.: clicar num
  // telefone dentro de uma mensagem em chat-management/page.tsx ou
  // chat-internal/page.tsx, que só sabe fazer setActiveOmniChatId +
  // setIsOmniChatOpen (não tem acesso ao setCustomerSessions local daqui).
  // Sem isso, uma sessão criada agora mesmo por outra tela não existe ainda
  // na lista local (só seria pega no próximo poll/SSE), e o painel abria
  // "vazio" — sem nome, empresa nem histórico, até a próxima atualização.
  useEffect(() => {
    if (!activeOmniChatId) return;
    if (customerSessions.some(s => s.id === activeOmniChatId)) return;
    fetchChatSessions().then(setCustomerSessions);
  }, [activeOmniChatId, customerSessions]);

  useEffect(() => {
    const chatId = searchParams?.get('chat');
    if (chatId) {
      setIsOmniChatOpen(true);
      setActiveOmniChatId(chatId);
      // Consome o parâmetro depois de abrir — sem isso, ?chat= fica preso na
      // barra de endereço (veio de um clique em notificação) e o chat volta
      // a abrir sozinho a cada F5, mesmo depois de quem está usando já ter
      // fechado o painel de propósito.
      const params = new URLSearchParams(searchParams?.toString());
      params.delete('chat');
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }
  }, [searchParams, setIsOmniChatOpen, setActiveOmniChatId, router, pathname]);

  const selectedChatId = activeOmniChatId;
  const setSelectedChatId = setActiveOmniChatId;
  const selectedChat = customerSessions.find(s => s.id === selectedChatId);
  const isCustomer = [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser?.role as UserRole);

  // Citar ("responder" do WhatsApp) só existe no canal Pyvon, pra equipe, e só
  // pra mensagem que o Pyvon conhece (pyvonQuotable) e não foi apagada.
  const canQuoteMessage = (m: ChatMessage) =>
    !isCustomer &&
    selectedChat?.channel === 'pyvon' &&
    !!m.pyvonQuotable &&
    !m.isDeleted &&
    m.type !== 'internal' &&
    m.type !== 'system';

  // A citação pertence à conversa em que foi escolhida: trocar de conversa a descarta.
  useEffect(() => { setReplyingTo(null); setIsQuickRepliesOpen(false); }, [selectedChatId]);

  // Estado de envio de uma mensagem NOSSA no canal Pyvon: 'sending' (1 tique) →
  // 'sent' (2 tiques) → ou 'failed' (mostrado à parte, com o erro). O Pyvon não
  // fornece "entregue/lida", então nunca há um 3º estado. 'sent' aqui quer dizer
  // "aceita pelo WhatsApp": a rota /api/whatsapp/send só responde sucesso quando
  // o Pyvon devolve delivery = sent.
  const pyvonTickState = (m: ChatMessage): 'sending' | 'sent' | 'failed' | null => {
    if (m.whatsappStatus === 'failed') return 'failed';
    if (m.whatsappStatus === 'sending') return 'sending';
    if (m.whatsappStatus === 'sent') return 'sent';
    // Sem status gravado: se o Pyvon já deu um id à mensagem, ela foi aceita.
    if (m.pyvonQuotable) return 'sent';
    // Acabou de sair e o status ainda não voltou (ex.: uma atualização da lista
    // chegou no meio do envio) — segue como "enviando" por um instante; mensagem
    // antiga sem nenhum registro fica sem tique em vez de afirmar algo sem base.
    return Date.now() - new Date(m.timestamp).getTime() < 20_000 ? 'sending' : null;
  };

  const selectedChatMessageRows = React.useMemo(() => {
    const rows: Array<
      | { type: 'date'; id: string; label: string }
      | { type: 'message'; id: string; message: ChatMessage }
    > = [];
    let lastDateKey = '';

    // type 'internal': aviso de bastidores (ex: transferência entre
    // analistas/fila) — nunca deve chegar pro lado do cliente.
    const messages = isCustomer
      ? (selectedChat?.messages || []).filter(m => m.type !== 'internal')
      : (selectedChat?.messages || []);

    messages.forEach((msg) => {
      const date = new Date(msg.timestamp);
      const dateKey = date.toLocaleDateString('pt-BR');
      if (dateKey !== lastDateKey) {
        rows.push({
          type: 'date',
          id: `date-${dateKey}`,
          label: date.toLocaleDateString('pt-BR', {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            year: 'numeric'
          })
        });
        lastDateKey = dateKey;
      }
      rows.push({ type: 'message', id: msg.id, message: msg });
    });

    return rows;
  }, [selectedChat?.messages, isCustomer]);

  // Troca de conversa: histórico de atendimentos anteriores é por contato,
  // não faz sentido carregar sobre o chat errado. Sair de "sem conversa" (null)
  // para a sessão recém-criada na primeira mensagem do cliente NÃO é troca de
  // contato — limpar ali faria o histórico que ele acabou de carregar sumir na
  // hora em que escreve.
  const previousHistoriesChatIdRef = useRef<string | null>(selectedChatId);
  useEffect(() => {
    const previousId = previousHistoriesChatIdRef.current;
    previousHistoriesChatIdRef.current = selectedChatId;
    if (previousId === null && selectedChatId) return;

    setPreviousHistories([]);
    setPreviousHistoriesOffset(0);
    setPreviousHistoriesTotal(0);
    setExpandedHistoryId(null);
    setHistoryMessagesById({});
  }, [selectedChatId]);

  // De quem é o histórico a carregar. Normalmente vem da conversa aberta, mas o
  // cliente pode estar com o widget aberto sem atendimento nenhum (a conversa só
  // nasce na primeira mensagem) — aí o contato é o próprio usuário logado, senão
  // o botão "Carregar histórico anterior" sumiria justamente pra quem ainda não
  // começou a conversar.
  const previousHistoriesContact = selectedChat
    ? { customerId: selectedChat.customerId, customerPhone: selectedChat.customerPhone, excludeSessionId: selectedChat.id }
    : (isCustomer && currentUser
        ? { customerId: currentUser.id, customerPhone: currentUser.phone, excludeSessionId: undefined }
        : null);

  const handleLoadPreviousHistories = async () => {
    if (!previousHistoriesContact || loadingPreviousHistories) return;
    if (!previousHistoriesContact.customerId && !previousHistoriesContact.customerPhone) return;

    setLoadingPreviousHistories(true);
    try {
      const result = await getPreviousChatHistories({
        customerId: previousHistoriesContact.customerId,
        customerPhone: previousHistoriesContact.customerPhone,
        excludeSessionId: previousHistoriesContact.excludeSessionId,
        limit: 2,
        offset: previousHistoriesOffset
      });
      setPreviousHistories(prev => [...prev, ...result.histories]);
      setPreviousHistoriesOffset(prev => prev + result.histories.length);
      setPreviousHistoriesTotal(result.total);
    } finally {
      setLoadingPreviousHistories(false);
    }
  };

  const handleToggleHistoryMessages = async (sessionId: string) => {
    if (expandedHistoryId === sessionId) {
      setExpandedHistoryId(null);
      return;
    }
    setExpandedHistoryId(sessionId);
    if (historyMessagesById[sessionId] || loadingHistoryMessagesId === sessionId) return;

    setLoadingHistoryMessagesId(sessionId);
    try {
      const result = await fetchSessionMessages(sessionId);
      setHistoryMessagesById(prev => ({ ...prev, [sessionId]: result }));
    } catch (err) {
      console.error('Erro ao carregar mensagens do atendimento anterior:', err);
      toast.error('Não foi possível carregar essa conversa anterior.');
      setExpandedHistoryId(null);
    } finally {
      setLoadingHistoryMessagesId(null);
    }
  };

  const unreadCount = notifications.filter(n => !n.read && n.type.startsWith('chat_')).length;
  // Quantas conversas de verdade estão sem resposta da equipe — diferente de
  // unreadCount (que conta NOTIFICAÇÕES não lidas, não chats: uma mesma
  // conversa pode gerar várias notificações, ou nenhuma se a notificação foi
  // suprimida por já estar aberta na hora, mesmo com a conversa ainda sem
  // resposta). Uma conversa conta como "sem resposta" quando a ÚLTIMA
  // mensagem foi do cliente (ninguém da equipe respondeu ainda) — cobre
  // tanto atendimentos pendentes (fila) quanto ativos que ficaram sem
  // resposta.
  const chatsAwaitingResponseCount = React.useMemo(() => {
    if (isCustomer) return 0;
    return customerSessions.filter(s => {
      if (s.status === 'closed') return false;
      // Só conversas ASSUMIDAS por quem está logado: o widget lista também as
      // da fila e as de outros analistas, e o número vermelho do botão não é
      // pra avisar de atendimento que não é dele.
      if (s.assigneeId !== currentUser?.id) return false;
      const msgs = s.messages || [];
      if (msgs.length === 0) return false;
      const last = msgs[msgs.length - 1];
      return !last.senderId || last.senderId === s.customerId;
    }).length;
  }, [customerSessions, isCustomer, currentUser?.id]);
  const [lastViewedAt, setLastViewedAt] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [quickNotes, setQuickNotes] = useState<QuickNote[]>([]);
  // Painel "Respostas prontas" (botão ao lado do anexo/microfone): lista todas
  // as respostas com o conteúdo e busca por texto.
  const [isQuickRepliesOpen, setIsQuickRepliesOpen] = useState(false);
  const [analystStatuses, setAnalystStatuses] = useState<AnalystStatus[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  // Usado pra resolver nome/foto de contato (avatar de verdade é renderizado
  // neste widget, ver contact.avatarUrl abaixo) — via hook compartilhado
  // (cache de 60s) em vez de /api/users?type=all buscado do zero toda vez
  // que o widget carrega E toda vez que é reaberto (desminimizado).
  const { data: allUsersData, refetch: refetchAllUsers } = useProfilesWithAvatarQuery();
  // useMemo é essencial aqui: `allUsersData || []` sem memo cria um array
  // novo a cada render enquanto a query não resolve, e como vários
  // useEffect/useMemo abaixo dependem de `allUsers`, isso causava "Maximum
  // update depth exceeded" (loop de render infinito antes dos dados
  // chegarem).
  const allUsers = React.useMemo(() => (allUsersData || []) as UserType[], [allUsersData]);

  // Chamados em aberto da empresa do contato — some ao lado do nome da empresa
  // no cabeçalho. Quem atende precisa saber, antes de responder, se a empresa
  // já tem coisa em andamento: muda o que se pergunta e evita abrir chamado
  // repetido do mesmo assunto.
  const [companyOpenTickets, setCompanyOpenTickets] = useState<number | null>(null);

  const selectedChatContact = React.useMemo(() => {
    if (!selectedChat) return undefined;
    return allUsers.find(u =>
      u.id === selectedChat.customerId ||
      matchPhones(u.phone, selectedChat.customerPhone) ||
      (u.phones && u.phones.some(p => matchPhones(p, selectedChat.customerPhone)))
    );
  }, [selectedChat, allUsers]);

  const selectedChatCompanyId = selectedChatContact?.companyId || null;
  useEffect(() => {
    // O próprio cliente não vê o contador (é informação de operação interna),
    // e sem empresa vinculada não há o que contar.
    if (isCustomer || !selectedChatCompanyId) {
      setCompanyOpenTickets(null);
      return;
    }
    let cancelado = false;
    // Zera antes de buscar: sem isso, trocar de conversa mostraria por um
    // instante a contagem da empresa anterior ao lado do nome da nova.
    setCompanyOpenTickets(null);
    TicketService.getOpenCountByCompany(selectedChatCompanyId)
      .then(total => { if (!cancelado) setCompanyOpenTickets(total); })
      .catch(() => { if (!cancelado) setCompanyOpenTickets(null); });
    return () => { cancelado = true; };
    // triggerRefresh entra para a contagem acompanhar chamado aberto/fechado
    // durante o próprio atendimento — inclusive o que nasce desta conversa.
  }, [selectedChatCompanyId, isCustomer, triggerRefresh]);

  const assignableTargets = React.useMemo(() => {
    // deriveLiveStatus, não `s.isOnline` cru: sem heartbeat de verdade,
    // fechar a aba sem trocar pra "Ausente" deixa is_online=true no banco
    // pra sempre — sem esse filtro, um analista sumido há dias continuava
    // aparecendo aqui como alvo válido pra transferir um chat.
    //
    // Só papel de equipe: analyst_status também guarda a presença de
    // Cliente/Funcionário logados no portal (é o que alimenta a bolinha de
    // "cliente online" no cabeçalho da conversa), e sem este filtro eles
    // apareciam em "Enviar para" como se fossem analistas — em conversa sem
    // fila, que não tem lista de membros pra restringir, era todo mundo online.
    //
    // Ausentes (away) também entram, marcados: dá pra transferir pra eles, mas
    // a tela pede confirmação antes (ver AssignChatMenu). Offline não entra.
    return analystStatuses
      .map(s => ({ live: deriveLiveStatus(s), user: allUsers.find(u => u.id === s.userId) }))
      .filter((x): x is { live: 'online' | 'away'; user: UserType } => (x.live === 'online' || x.live === 'away') && !!x.user)
      .filter(x => [UserRole.ADMIN, UserRole.SUPPORT, UserRole.INTERNAL].includes(x.user.role as UserRole))
      .map(x => ({ id: x.user.id, name: x.user.name, away: x.live === 'away' }));
  }, [analystStatuses, allUsers]);

  // Presença real no header da conversa — antes não existia nenhuma (nem
  // pro analista, nem pro cliente). Reaproveita analyst_status, que agora
  // também recebe presença de clientes logados no portal (ver
  // app/app-context.tsx) — cliente anônimo via WhatsApp nunca vai aparecer
  // aqui, não tem como rastrear presença de quem não tem sessão logada.
  const formatLastActive = (lastActive?: string) => {
    if (!lastActive) return 'visto por último há um tempo';
    const diffMin = Math.floor((Date.now() - new Date(lastActive).getTime()) / 60000);
    if (diffMin < 1) return 'visto agora';
    if (diffMin < 60) return `visto há ${diffMin} min`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `visto há ${diffHours}h`;
    return `visto há ${Math.floor(diffHours / 24)}d`;
  };

  const getPresence = (userId?: string | null) => userId ? analystStatuses.find(s => s.userId === userId) : undefined;

  const presenceLabel = (userId?: string | null) => {
    const presence = getPresence(userId);
    if (!presence) return null;
    const live = deriveLiveStatus(presence);
    if (live === 'online') return 'Online';
    if (live === 'away') return 'Ausente';
    return formatLastActive(presence.lastActive).replace(/^v/, 'V');
  };

  const handleAssignChat = async (sessionId: string, targetUserId?: string) => {
    if (!currentUser) return;
    // Assumir não exige estar Online (pedido do usuário, 2026-09-25): a rota
    // nunca checou presença, só o cliente bloqueava.
    const assigneeId = targetUserId || currentUser.id;
    const result = await assignChatSession(sessionId, assigneeId, currentUser.id);

    if (!('error' in result)) {
      toast.success(targetUserId ? 'Atendimento transferido com sucesso!' : 'Atendimento assumido com sucesso!');
      const refreshedSessions = await fetchChatSessions();
      setCustomerSessions(refreshedSessions);
    } else {
      toast.error('Erro ao atualizar o atendimento.');
    }
  };

  const handleReturnToQueue = async (sessionId: string, queueId: string) => {
    if (!currentUser) return;
    const result = await returnChatSessionToQueue(sessionId, queueId, currentUser.id);

    if (!('error' in result)) {
      toast.success('Atendimento devolvido para a fila!');
      const refreshedSessions = await fetchChatSessions();
      setCustomerSessions(refreshedSessions);
    } else {
      toast.error('Erro ao devolver o atendimento para a fila.');
    }
  };

  // Otimista: aplica local antes da resposta do servidor (popover fecha e o
  // chip reage na hora); o evento SSE 'tags-updated' mantém quem mais estiver
  // vendo a mesma conversa sincronizado. Em erro, desfaz reaplicando o estado
  // anterior.
  const handleChatTagsChange = async (sessionId: string, tagIds: string[]) => {
    const previous = customerSessions.find(s => s.id === sessionId)?.tags || [];
    setCustomerSessions(prev => prev.map(s => s.id === sessionId ? { ...s, tags: tagIds } : s));

    const result = await setChatSessionTags(sessionId, tagIds, currentUser?.id);
    if ('error' in result) {
      toast.error('Erro ao atualizar os marcadores da conversa.');
      setCustomerSessions(prev => prev.map(s => s.id === sessionId ? { ...s, tags: previous } : s));
    }
  };

  const [transcribingIds, setTranscribingIds] = useState<Set<string>>(new Set());
  // A transcrição em si roda sozinha em segundo plano assim que o áudio é
  // salvo (ver lib/services/transcription-service.ts) — mas no chat ao vivo
  // o texto só aparece quando o operador clicar, pra não poluir a tela com
  // texto que ninguém pediu pra ler ainda. O clique só "revela" o que já foi
  // transcrito (instantâneo); só chama a API de verdade se por algum motivo
  // ainda não houver transcrição pronta.
  const [revealedTranscriptions, setRevealedTranscriptions] = useState<Set<string>>(new Set());

  const handleTranscribeAudio = async (sessionId: string, messageId: string, attachmentId: string) => {
    const key = `${messageId}:${attachmentId}`;
    if (transcribingIds.has(key)) return;
    setTranscribingIds(prev => new Set(prev).add(key));
    try {
      const transcription = await transcribeChatAudio(sessionId, messageId, attachmentId);
      setCustomerSessions(prev => prev.map(s => {
        if (s.id !== sessionId) return s;
        return {
          ...s,
          messages: (s.messages || []).map(m => {
            if (m.id !== messageId) return m;
            return {
              ...m,
              attachments: (m.attachments || []).map(a =>
                a.id === attachmentId ? { ...a, transcription } : a
              )
            };
          })
        };
      }));
      setRevealedTranscriptions(prev => new Set(prev).add(key));
    } catch (err) {
      console.error('Erro ao transcrever áudio:', err);
      // err.message já traz a causa real devolvida pelo servidor (ffmpeg
      // ausente, timeout, arquivo sumido do volume) — mostrar a mensagem
      // genérica aqui escondia exatamente a informação que serve pra
      // diagnosticar o problema (ver transcribeMessageAudio, throwOnError).
      toast.error(err instanceof Error && err.message ? err.message : 'Não foi possível transcrever o áudio.');
    } finally {
      setTranscribingIds(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Captura de PCM bruto via Web Audio API. Optamos por isso em vez do MediaRecorder
  // (webm/opus) porque, neste ambiente, o MediaRecorder produzia contêineres que nem o
  // próprio navegador conseguia reabrir depois (DEMUXER_ERROR_COULD_NOT_OPEN). Gravando
  // PCM e montando o WAV nós mesmos, eliminamos essa categoria inteira de falha.
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const recordingSampleRateRef = useRef<number>(44100);

  const disconnectRecordingGraph = () => {
    try { scriptProcessorRef.current?.disconnect(); } catch { /* ignore */ }
    try { audioSourceNodeRef.current?.disconnect(); } catch { /* ignore */ }
    try { silentGainRef.current?.disconnect(); } catch { /* ignore */ }
    scriptProcessorRef.current = null;
    audioSourceNodeRef.current = null;
    silentGainRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
      disconnectRecordingGraph();
      mediaStreamRef.current?.getTracks().forEach(track => track.stop());
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  const jumpToLatestMessage = React.useCallback(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, []);

  useEffect(() => {
    if (shouldAutoScroll && selectedChatId) {
      const scrollContainer = scrollRef.current;
      if (scrollContainer) {
        // Use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(() => {
          jumpToLatestMessage();
          // Secod attempt for dynamic content/images
          setTimeout(jumpToLatestMessage, 100);
        });
      }
    }
  }, [jumpToLatestMessage, selectedChat?.messages?.length, shouldAutoScroll, selectedChatId]);

  useEffect(() => {
    if (isMinimized || !selectedChatId) return;

    setShouldAutoScroll(true);
    requestAnimationFrame(() => {
      jumpToLatestMessage();
      setTimeout(jumpToLatestMessage, 100);
      setTimeout(jumpToLatestMessage, 350);
    });
  }, [isExpanded, isMinimized, jumpToLatestMessage, selectedChatId, selectedChat?.messages?.length]);
  
  // New Chat Modal
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false);
  const [newChatNumber, setNewChatNumber] = useState('');
  const [newChatName, setNewChatName] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [searchResults, setSearchResults] = useState<{id: string, name: string, phone?: string, type: 'company' | 'employee', companyName?: string}[]>([]);

  // Transparência da janela de 24h (canal Pyvon) — mesma checagem/decisão de
  // components/start-whatsapp-conversation-modal.tsx (Empresas > Decisor),
  // só que embutida aqui pra não perder a busca de cliente/funcionário
  // cadastrado que só este modal tem. Quem decide de verdade é sempre o
  // servidor (startPyvonConversation), isto aqui é só preview.
  const [newChatWindowStatus, setNewChatWindowStatus] = useState<'unknown' | 'checking' | 'open' | 'closed'>('unknown');
  const [isStartingNewChat, setIsStartingNewChat] = useState(false);
  const newChatCheckSeqRef = useRef(0);
  useEffect(() => {
    const digits = newChatNumber.replace(/\D/g, '');
    if (digits.length < 10) {
      setNewChatWindowStatus('unknown');
      return;
    }
    setNewChatWindowStatus('checking');
    const seq = ++newChatCheckSeqRef.current;
    const timer = setTimeout(async () => {
      const result = await checkPyvonOutboundStatus(digits);
      if (seq !== newChatCheckSeqRef.current) return;
      if ('error' in result) { setNewChatWindowStatus('unknown'); return; }
      setNewChatWindowStatus(result.withinWindow ? 'open' : 'closed');
    }, 500);
    return () => clearTimeout(timer);
  }, [newChatNumber]);
  
  const [isFinishModalOpen, setIsFinishModalOpen] = useState(false);
  const [ticketTitle, setTicketTitle] = useState('');
  const [closeTicketImmediately, setCloseTicketImmediately] = useState(false);
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
  const [isDuplicatingChat, setIsDuplicatingChat] = useState(false);
  const [isConfirmNewTicketOpen, setIsConfirmNewTicketOpen] = useState(false);
  const [isLinkTicketModalOpen, setIsLinkTicketModalOpen] = useState(false);
  const [isMoreActionsOpen, setIsMoreActionsOpen] = useState(false);
  // Número, meio de contato e responsável saíram do cabeçalho da conversa
  // pro modal "Ver informações" (menu de três pontinhos) — o cabeçalho
  // estava sobrecarregado com informação que só interessa sob demanda, não
  // toda vez que a conversa está aberta. "Com {responsável}" continua na
  // LISTA de conversas (fora de uma conversa aberta), sem mudança.
  const [isChatInfoModalOpen, setIsChatInfoModalOpen] = useState(false);
  // Só domain==='chat' — cadastradas em Configurações > Gestão de Tags.
  const [chatTags, setChatTags] = useState<TagConfig[]>([]);
  const [chatAttachments, setChatAttachments] = useState<Attachment[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);

  // Histórico da conversa sob demanda: resumos dos atendimentos ANTERIORES do
  // mesmo contato (não a conversa atual), carregados +2 em +2 via botão no
  // topo da área de mensagens. Cache de mensagens por sessão evita recarregar
  // ao expandir/recolher o mesmo item mais de uma vez.
  const [previousHistories, setPreviousHistories] = useState<PreviousChatHistoriesResult['histories']>([]);
  const [previousHistoriesOffset, setPreviousHistoriesOffset] = useState(0);
  const [previousHistoriesTotal, setPreviousHistoriesTotal] = useState(0);
  const [loadingPreviousHistories, setLoadingPreviousHistories] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [historyMessagesById, setHistoryMessagesById] = useState<Record<string, SessionMessagesResult>>({});
  const [loadingHistoryMessagesId, setLoadingHistoryMessagesId] = useState<string | null>(null);

  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);

  const [chatFilter, setChatFilter] = useState<'all' | 'me'>('all');
  const [chatSearch, setChatSearch] = useState('');
  const [userQueues, setUserQueues] = useState<string[]>([]);
  const [allQueues, setAllQueues] = useState<any[]>([]);

  const queueMenuTargets = React.useMemo(() => {
    return allQueues.map((q: any) => ({ id: q.id, name: q.name }));
  }, [allQueues]);

  // Restringe a lista de "Enviar para" a quem está online ou ausente E é membro
  // da fila do próprio chat — sem fila (pool combinado) cai de volta pra todo
  // mundo disponível, já que aí não há uma fila única pra filtrar. O próprio
  // usuário sempre aparece, mesmo Offline e mesmo que não seja formalmente
  // membro dessa fila — "puxar" um chat pra si não depende de presença nem de
  // fila (e a si mesmo nunca pede confirmação de ausência).
  const getQueueOnlineTargets = React.useCallback((queueId?: string | null) => {
    const base = (() => {
      if (!queueId) return assignableTargets;
      const queue = allQueues.find((q: any) => q.id === queueId);
      if (!queue) return assignableTargets;
      const memberIds: string[] = queue.member_ids || [];
      return assignableTargets.filter(t => memberIds.includes(t.id));
    })();

    if (!currentUser) return base;
    const withoutSelf = base.filter(t => t.id !== currentUser.id);
    return [...withoutSelf, { id: currentUser.id, name: currentUser.name, away: false }];
  }, [assignableTargets, allQueues, currentUser]);

  const getSessionInstanceId = React.useCallback((session?: { queueId?: string }) => {
    const queue = allQueues.find((q: any) => q.id === session?.queueId);
    return queue?.whatsapp_instance_id || queue?.whatsappInstanceId || 'default';
  }, [allQueues]);

  // Cache de foto de contato compartilhado com as demais telas (ex: /chat-management)
  useEffect(() => {
    customerSessions
      .filter(s => s.status !== 'closed' && s.customerPhone)
      .forEach(s => ensureContactPhoto(s.customerPhone, getSessionInstanceId(s)));
  }, [customerSessions, getSessionInstanceId, ensureContactPhoto]);

  // Notificações de chat sobrevivem no localStorage; se a sessão de origem for
  // encerrada/apagada do banco, a notificação nunca some sozinha e o badge de
  // "não lidas" fica mostrando uma contagem que não existe mais. Reconcilia
  // sempre que a lista de sessões (fonte de verdade) mudar.
  useEffect(() => {
    if (!sessionsLoaded) return;
    pruneStaleChatNotifications(customerSessions.map(s => s.id));
  }, [customerSessions, sessionsLoaded, pruneStaleChatNotifications]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadData() {
      console.log('ChatWidget: Iniciando loadData');
      try {
        // Use individual try-catch for better error identification
        const sessions = await fetchChatSessions(controller.signal, currentUser?.id).catch(e => { console.error('sessions fetch error:', e); return [] as any; });
        const notes = await fetchQuickNotes(controller.signal).catch(e => { console.error('notes fetch error:', e); return [] as any; });
        const statuses = await fetchAnalystStatuses(controller.signal).catch(e => { console.error('statuses fetch error:', e); return [] as any; });
        const comp = await fetchCompanies(controller.signal).catch(e => { console.error('companies fetch error:', e); return [] as any; });
        const allTags = await ConfigService.getTags().catch(e => { console.error('tags fetch error:', e); return [] as TagConfig[]; });

        // Check if controller was aborted
        if (controller.signal.aborted) return;

        console.log('ChatWidget: Dados carregados com sucesso', {
            sessions: sessions.length,
            companies: comp.length
        });
        setCustomerSessions(sessions);
        setSessionsLoaded(true);
        setQuickNotes(notes);
        setAnalystStatuses(statuses);
        setCompanies(comp);
        setChatTags((allTags || []).filter(t => t.domain === 'chat'));

        const queues = await fetchQueues(controller.signal).catch(e => { console.error('queues fetch error:', e); return [] as any; });
        setAllQueues(queues || []);
        if (currentUser) {
            const myQueues = queues.filter((q: any) => q.member_ids?.includes?.(currentUser.id) || q.memberIds?.includes?.(currentUser.id)).map((q: any) => q.id);
            setUserQueues(myQueues || []);
        }
      } catch (err: any) {
        // Silently ignore abort errors
        const errMsg = String(err?.message ?? '');
        const errName = String(err?.name ?? '');
        if (errName.includes('AbortError') || errMsg.toLowerCase().includes('aborted')) return;
        console.error("Error in loadData (fallback catch):", err);
      }
    }
    loadData();

    return () => controller.abort();
  }, [currentUser?.id]);


  useEffect(() => {
    if (customerSearch.length > 1) {
      // Use existing state variables loaded in initial load
      const filteredCompanies = companies.filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase()));
      const filteredUsers = allUsers.filter(u => u.name.toLowerCase().includes(customerSearch.toLowerCase()));
      
      const results: any[] = [];

      filteredUsers.forEach(u => {
        const company = companies.find(c => c.id === u.companyId);
        results.push({
          id: u.id,
          name: u.name,
          phone: u.phone,
          type: 'employee',
          companyName: company?.name
        });
      });

      filteredCompanies.forEach(c => {
        const employees = allUsers.filter(u => u.companyId === c.id);
        employees.forEach(u => {
          if (!results.find(r => r.id === u.id)) {
            results.push({
              id: u.id,
              name: u.name,
              phone: u.phone,
              type: 'employee',
              companyName: c.name
            });
          }
        });
        if (c.phone) {
          results.push({ id: c.id, name: c.name, phone: c.phone, type: 'company' });
        }
      });
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
  }, [customerSearch, allUsers, companies]);


  const selectCustomer = (item: any) => {
    setNewChatName(item.name);
    setNewChatNumber(item.phone || '');
    setCustomerSearch('');
  };

  // Equipe: só conta nas conversas assumidas por quem está logado (mesma regra
  // do número do botão flutuante). Cliente só tem a própria conversa.
  //
  // Equipe: conta as mensagens do CLIENTE que este usuário ainda não leu
  // (read_by, gravado ao abrir a conversa) — direto dos dados da conversa, então
  // aparece na hora em que a mensagem chega e não depende de notificação ligada,
  // do polling do sino, nem de o toast ter sido suprimido. A conversa aberta na
  // tela (widget aberto e aba visível) nunca conta: o que chega nela já está sendo lido.
  const getSessionUnreadCount = (session: ChatSession) => {
    if (isCustomer) {
      return notifications.filter(n => !n.read && n.targetId === session.id).length;
    }
    if (!currentUser || session.assigneeId !== currentUser.id) return 0;
    if (session.id === selectedChatId && !isMinimized && isTabVisible) return 0;
    return (session.messages || []).filter(m =>
      isIncomingCustomerMessage(m, session) && !(m.readBy || []).includes(currentUser.id)
    ).length;
  };

  // Aba em primeiro plano? Só então a conversa aberta conta como "lendo".
  const [isTabVisible, setIsTabVisible] = useState(true);
  useEffect(() => {
    const onVisibility = () => setIsTabVisible(document.visibilityState === 'visible');
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Mensagem nova do cliente na conversa que está ABERTA e visível entra já
  // como lida (antes só era marcada ao abrir a conversa, então o que chegava
  // depois ficava "não lido" pra sempre e o número reaparecia ao fechar o chat).
  useEffect(() => {
    if (isCustomer || !currentUser || !selectedChatId || isMinimized || !isTabVisible) return;
    const s = customerSessions.find(x => x.id === selectedChatId);
    if (!s || s.assigneeId !== currentUser.id) return;
    const hasUnread = (s.messages || []).some(m => isIncomingCustomerMessage(m, s) && !(m.readBy || []).includes(currentUser.id));
    if (!hasUnread) return;
    ChatService.markMessagesRead(selectedChatId, currentUser.id);
    // Atualiza a lista local NA HORA: o aviso de leitura do servidor (evento
    // "receipt") chega antes de a conexão em tempo real da conversa existir e
    // se perde, então sem isto o número só sumia no próximo ciclo de 30s. Se o
    // servidor falhar, a próxima busca traz o read_by real e marca de novo.
    const uid = currentUser.id;
    setCustomerSessions(prev => prev.map(x => x.id !== selectedChatId ? x : {
      ...x,
      messages: (x.messages || []).map(m => (m.readBy || []).includes(uid) ? m : { ...m, readBy: [...(m.readBy || []), uid] })
    }));
  }, [customerSessions, selectedChatId, isMinimized, isTabVisible, isCustomer, currentUser?.id]);

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Sem gate em isOmniChatOpen de propósito: é este poll que alimenta
    // customerSessions/chatsAwaitingResponseCount, ou seja, o número no
    // badge do botão flutuante MINIMIZADO (ver "Launcher Button" mais
    // abaixo) — se só rodasse com o widget aberto, o badge nunca saberia de
    // um chat novo enquanto estivesse fechado, justamente o estado em que
    // ele existe pra avisar. O sino (app-context.tsx, /api/notifications/
    // check a cada 10s) já não tinha esse problema por ser independente
    // disso — daí soar sem o badge acompanhar.
    if (!currentUser?.id) return;

    async function loadSessions() {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const sessions = await fetchChatSessions(controller.signal, currentUser?.id);
        if (controller.signal.aborted || abortControllerRef.current !== controller) {
          return;
        }
        setCustomerSessions(sessions);
      } catch (err: any) {
        const errMsg = String(err?.message ?? '');
        if (err?.name === 'AbortError' || errMsg.includes('aborted')) {
          return;
        }
        console.error("Failed to load sessions in widget:", err);
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    }
    const loadWhenVisible = () => {
      if (document.visibilityState === 'visible') loadSessions();
    };
    loadWhenVisible();
    const interval = setInterval(loadWhenVisible, 30000);
    document.addEventListener('visibilitychange', loadWhenVisible);
    
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', loadWhenVisible);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [currentUser?.id]);

  // Tempo real da LISTA (sidebar) — sem isso, uma conversa nova só aparecia
  // no próximo tick do poll de 30s acima, mesmo com o som de notificação
  // (app-context.tsx, poll de 10s) já tendo tocado: o analista ouvia o aviso
  // e ficava até ~30s olhando pra uma lista que ainda não mostrava nada.
  // Canal global (não por sessão, ver /api/chats/sessions-stream) — dispara
  // sempre que qualquer sessão relevante muda em QUALQUER lugar do backend
  // (mensagem nova, atribuição, fila, tag, encerramento), mesmo numa
  // conversa que ainda não foi aberta por ninguém. Debounce curto porque uma
  // mesma mensagem pode disparar mais de um evento em sequência (ex.:
  // redistribuição de fila + a própria mensagem).
  useEffect(() => {
    if (isCustomer || !currentUser?.id) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        fetchChatSessions(undefined, currentUser.id).then(setCustomerSessions).catch(() => {});
      }, 150);
    };

    const eventSource = new EventSource('/api/chats/sessions-stream');
    eventSource.addEventListener('sessions-changed', refresh);

    return () => {
      eventSource.close();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [isCustomer, currentUser?.id]);

  // Tempo real de verdade via SSE para a conversa aberta (substitui o antigo
  // supabase.channel(...).on('postgres_changes', ...), que nunca funcionou de
  // fato — o shim em lib/supabase.ts não implementa pub/sub, só REST). O
  // poller de 30s logo acima continua rodando como rede de segurança (o
  // EventSource também reconecta sozinho em caso de queda de conexão).
  useEffect(() => {
    if (!selectedChatId || !currentUser) return;
    setTypingUserName(null);

    // Abrir a conversa = "lido" (3o check, colorido) — mesmo espírito do
    // internal-messages GET no Chat Interno, só que aqui via action
    // explícita porque a rota `sessions` é usada por todo mundo sem
    // identificar quem está pedindo (ver app/api/chats/route.ts).
    ChatService.markMessagesRead(selectedChatId, currentUser.id);

    const eventSource = new EventSource(`/api/chats/stream?sessionId=${selectedChatId}`);
    messagesChannelRef.current = eventSource;

    eventSource.addEventListener('chat-event', (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);

        if (payload?.type === 'transcription') {
          // Transcrição de um áudio chega depois, de forma assíncrona — só
          // preenche o campo no anexo já existente, sem criar mensagem nova
          // nem disparar som/notificação.
          setCustomerSessions(prev => prev.map(s => {
            if (s.id !== payload.sessionId) return s;
            return {
              ...s,
              messages: (s.messages || []).map(m => {
                if (m.id !== payload.messageId) return m;
                return {
                  ...m,
                  attachments: (m.attachments || []).map(a =>
                    a.id === payload.attachmentId ? { ...a, transcription: payload.transcription } : a
                  )
                };
              })
            };
          }));
          return;
        }

        if (payload?.type === 'transcription-error') {
          // Libera o botão de "Transcrevendo..." se essa transcrição tinha
          // sido pedida manualmente por essa aba — o aviso principal (pra
          // quem não está olhando essa conversa agora) é o push pro time,
          // disparado no servidor (ver transcription-service.ts).
          setTranscribingIds(prev => {
            const key = `${payload.messageId}:${payload.attachmentId}`;
            if (!prev.has(key)) return prev;
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
          toast.error('Não foi possível transcrever um áudio desta conversa.');
          return;
        }

        if (payload?.type === 'typing') {
          if (payload.userId === currentUser?.id) return;
          setTypingUserName(payload.userName || 'Alguém');
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => setTypingUserName(null), 4000);
          return;
        }

        if (payload?.type === 'receipt' || payload?.type === 'reaction') {
          // Não vem o payload completo — mais simples e sempre consistente
          // reconsultar as mensagens da sessão do que tentar reconstruir
          // read_by/reactions a partir de um evento parcial.
          ChatService.getSessions(currentUser?.id).then(sessions => {
            const updated = sessions.find(s => s.id === payload.sessionId);
            if (!updated) return;
            setCustomerSessions(prev => prev.map(s => s.id === payload.sessionId ? { ...s, messages: updated.messages } : s));
          }).catch(() => {});
          return;
        }

        if (payload?.type === 'tags-updated') {
          setCustomerSessions(prev => prev.map(s => s.id === payload.sessionId ? { ...s, tags: (payload.tags as string[]) || [] } : s));
          return;
        }

        if (payload?.type === 'edited') {
          setCustomerSessions(prev => prev.map(s => {
            if (s.id !== payload.sessionId) return s;
            return {
              ...s,
              messages: (s.messages || []).map(m => m.id === payload.messageId ? { ...m, text: payload.text as string, isEdited: true, editedAt: new Date().toISOString() } : m)
            };
          }));
          return;
        }

        if (payload?.type === 'deleted') {
          setCustomerSessions(prev => prev.map(s => {
            if (s.id !== payload.sessionId) return s;
            return {
              ...s,
              messages: (s.messages || []).map(m => m.id === payload.messageId ? { ...m, isDeleted: true, deletedAt: new Date().toISOString() } : m)
            };
          }));
          return;
        }

        const raw = payload?.message;
        if (!raw) return;

        const newMessage: ChatMessage = {
          id: raw.id,
          senderId: raw.senderId,
          senderName: raw.senderName,
          text: raw.text,
          timestamp: raw.timestamp,
          type: raw.type || 'text',
          metadata: raw.metadata,
          readBy: raw.readBy || [],
          deliveredBy: raw.deliveredBy || [],
          reactions: raw.reactions || [],
          attachments: raw.attachments || []
        };

        setCustomerSessions(prev => prev.map(s => {
          if (s.id !== payload.sessionId) return s;
          if (s.messages?.some(m => m.id === newMessage.id)) return s;
          return { ...s, messages: [...(s.messages || []), newMessage], lastMessageAt: newMessage.timestamp };
        }));

        if (newMessage.senderId !== currentUser?.id) {
          // addNotification já toca o som internamente (e decide sozinha se
          // deve notificar ou não, incluindo o caso desta própria conversa
          // estar aberta na tela agora) — nada de tocar som aqui também.
          const session = customerSessions.find(s => s.id === payload.sessionId);
          addNotification({
            sourceId: `chat_message:${newMessage.id}`,
            title: `Nova mensagem de ${session?.customerName || 'Cliente'}`,
            message: newMessage.text,
            type: 'chat_message',
            targetId: payload.sessionId
          }, currentUser!.id);
        }
      } catch (err) {
        console.error('Erro processando evento SSE do chat:', err);
      }
    });

    eventSource.onerror = () => {
      // O EventSource já tenta reconectar sozinho; o poller de 30s cobre o
      // intervalo até a reconexão (ou até o próximo ciclo, se ela falhar).
    };

    return () => {
      eventSource.close();
      if (messagesChannelRef.current === eventSource) {
        messagesChannelRef.current = null;
      }
    };
  }, [selectedChatId, currentUser?.id]);

  useEffect(() => {
    if (selectedChatId && !isMinimized) {
      notifications
        .filter(n => !n.read && n.type.startsWith('chat_') && n.targetId === selectedChatId)
        .forEach(n => markNotificationRead(n.id));
    }
  }, [selectedChatId, isMinimized, notifications, markNotificationRead]);


  useEffect(() => {
    if (!isMinimized) {
      async function loadData() {
        try {
          const [notes, statuses, comps] = await Promise.all([
            fetchQuickNotes(),
            fetchAnalystStatuses(),
            fetchCompanies()
          ]);
          setQuickNotes(notes);
          setAnalystStatuses(statuses);
          setCompanies(comps);
        } catch (e) {
          console.error("Error loading chat widget data:", e);
        }
      }
      loadData();
    }
  }, [isMinimized]);

  useEffect(() => {
    const currentCount = selectedChat?.messages?.length || 0;
    const hasNewMessage = currentCount > prevMessageCountRef.current;
    
    if (scrollRef.current) {
      if (shouldAutoScroll) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        setShowNewMessageIndicator(false);
      } else if (hasNewMessage && selectedChatId) {
        setShowNewMessageIndicator(true);
      }
    }
    prevMessageCountRef.current = currentCount;
  }, [selectedChat?.messages?.length, shouldAutoScroll, selectedChatId]);

useEffect(() => {
    if (isCustomer && !isMinimized && currentUser) {
       // Abrir o widget NÃO cria atendimento. Antes, este efeito chamava
       // createChatSession no primeiro render aberto, e o simples clique no
       // ícone do chat já fazia uma conversa 'pending' aparecer na fila dos
       // analistas (e entrar no rodízio de atribuição) mesmo sem o cliente ter
       // escrito nada. A sessão passa a nascer só na primeira mensagem, em
       // handleSendMessage — aqui só retomamos um atendimento que já exista.
       const loadSession = async () => {
         try {
            const sessions = await fetchChatSessions();
            setCustomerSessions(sessions);
            // action=sessions devolve as sessões de TODO mundo (o widget da
            // equipe depende disso) — filtrar pelo próprio usuário aqui é
            // obrigatório, senão o cliente cairia na conversa de outra pessoa.
            const mine = sessions.filter(s => s.customerId === currentUser.id);
            // Atendimento em andamento tem prioridade; senão, uma sessão
            // fechada ainda dentro da janela da pesquisa de satisfação precisa
            // continuar selecionada pro "1"/"0" do cliente virar avaliação em
            // vez de abrir conversa nova (ver isSurveyResponse).
            const ongoing = mine.find(s => s.status !== 'closed');
            const awaitingSurvey = mine.find(
              s => s.awaitingSurveyUntil && new Date(s.awaitingSurveyUntil) > new Date()
            );
            setSelectedChatId((ongoing || awaitingSurvey)?.id ?? null);
          } catch (error) {
            console.error('Error loading customer chat session:', error);
          }
        };
        loadSession();
    }
  }, [isCustomer, isMinimized, currentUser, setSelectedChatId]);

  // O cliente não tem lista lateral pra escolher conversa: se existir um
  // atendimento dele, é sempre esse que o widget mostra. Como o widget não cria
  // mais sessão ao abrir, isso também cobre o caso de um analista iniciar a
  // conversa enquanto o cliente está com o widget aberto — a sessão nova chega
  // pelo polling de 30s e é selecionada aqui.
  useEffect(() => {
    if (!isCustomer || !currentUser || selectedChatId) return;
    const mine = customerSessions.filter(s => s.customerId === currentUser.id);
    const next =
      mine.find(s => s.status !== 'closed') ||
      mine.find(s => s.awaitingSurveyUntil && new Date(s.awaitingSurveyUntil) > new Date());
    if (next) setSelectedChatId(next.id);
  }, [isCustomer, currentUser, selectedChatId, customerSessions, setSelectedChatId]);

  // Reflete o status de encaminhamento direto no estado local (feedback
  // imediato pra quem enviou, sem esperar o round-trip do SSE) — quem mais
  // estiver olhando a mesma conversa recebe a mesma informação pelo evento
  // 'receipt' que updateMessageWhatsAppStatus dispara no servidor.
  const patchMessageWhatsappStatus = (sessionId: string, messageId: string, status: 'sending' | 'sent' | 'failed', errorMsg?: string) => {
    setCustomerSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      return {
        ...s,
        messages: (s.messages || []).map(m => m.id === messageId ? { ...m, whatsappStatus: status, whatsappError: errorMsg } : m)
      };
    }));
  };

  // Encaminha uma mensagem já salva no chat pro WhatsApp de verdade — mesma
  // lógica que já existia duplicada em 3 pontos (resposta normal, aviso de
  // chamado criado, encerramento com pesquisa), agora compartilhada, e usada
  // também no caminho de "sessão ainda não carregada no estado local" de
  // handleSendMessage — que nunca teve isso e por isso deixava passar em
  // silêncio (sem toast, sem log) quando a sessão ainda não tinha chegado no
  // customerSessions local (ex.: responder uma conversa recém-criada antes
  // do próximo fetchChatSessions()).
  //
  // Grava o resultado (sent/failed) na própria mensagem — não só um toast
  // passageiro — pra ficar visível de novo mesmo se a pessoa reabrir a
  // conversa depois, com um motivo claro e um jeito de tentar de novo (ver
  // handleResendWhatsAppMessage e o ícone de status no balão da mensagem).
  const forwardMessageToWhatsApp = async (params: {
    sessionId: string;
    messageId: string;
    customerPhone?: string;
    queueId?: string | null;
    channel?: string;
    text: string;
    attachments?: Attachment[];
    // id (nosso) da mensagem que esta resposta cita — o servidor resolve o id do Pyvon
    replyToMessageId?: string;
  }): Promise<{ ok: boolean; error?: string }> => {
    const { sessionId, messageId, customerPhone, queueId, channel, text, attachments, replyToMessageId } = params;
    const hasAttachments = !!attachments?.length;
    if (!customerPhone) return { ok: true }; // sem telefone = não é canal WhatsApp, nada a fazer
    // channel === 'widget': conversa 100% pelo widget do portal — o cliente só
    // tem telefone cadastrado no PERFIL, isso nunca foi um canal de WhatsApp de
    // verdade. Sessão sem channel (criada antes deste campo existir) mantém o
    // comportamento antigo, baseado só na presença de telefone.
    if (channel === 'widget') return { ok: true };
    const phone = customerPhone.replace(/\D/g, '');
    if (!phone) return { ok: true };

    const queue = allQueues.find((q: any) => q.id === queueId);
    const instanceId = queue?.whatsapp_instance_id || queue?.whatsappInstanceId || 'default';

    // Nome do analista em negrito antes da mensagem — chegando neste ponto
    // (canal != 'widget') sempre foi um humano da equipe quem escreveu, nunca
    // o próprio cliente (a conversa dele é sempre channel='widget', tratada
    // no early-return acima). Sem isso, o cliente não sabia quem estava
    // respondendo pelo WhatsApp — pedido do usuário 2026-09-17. Fora do
    // escopo de propósito: templates (chamado_aberto/atualizacao_chamado/
    // contato_pos_vendas) têm texto fixo aprovado pela Meta, não passam por
    // aqui.
    const messageForWhatsApp = (!isCustomer && currentUser?.name)
      ? `*${currentUser.name}*\n\n${text}`
      : text;

    patchMessageWhatsappStatus(sessionId, messageId, 'sending');

    let outcome: { ok: boolean; error?: string };
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: safeJsonStringify({ instanceId, to: phone, message: messageForWhatsApp, sessionId, messageId, replyToMessageId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const errorMsg = body.error || `Erro ${res.status}`;
        // O motivo vai no TEXTO do log (não só dentro do objeto), pra aparecer
        // direto no console sem precisar expandir.
        console.error(`[WhatsApp] Mensagem ${messageId} NÃO enviada (${channel || 'canal desconhecido'}, HTTP ${res.status}): ${errorMsg}`, { status: res.status, statusText: res.statusText, error: body.error, instanceId, phone, hasAttachments });
        toast.warning('Mensagem salva, mas não foi enviada no WhatsApp.');
        outcome = { ok: false, error: errorMsg };
      } else {
        const body = await res.json().catch(() => ({}));
        // mediaSent === false: o canal é capaz de encaminhar mídia (Pyvon),
        // mas este anexo específico não pôde virar link público agora (ex.:
        // NEXT_PUBLIC_APP_URL não configurada, ou anexo em data: URL legado).
        // undefined: canal ainda não suporta mídia (Baileys/Meta) — mesmo
        // aviso de sempre.
        if (hasAttachments && body.mediaSent !== true) {
          console.warn('WhatsApp send: attachment present but media was not forwarded.', { instanceId, phone, mediaSent: body.mediaSent });
          toast.warning('Anexo salvo na conversa, mas o envio de mídia pelo WhatsApp ainda não está disponível neste canal.');
        }
        // A resposta chegou ao cliente, mas sem a citação (o Pyvon não pôde citar
        // aquela mensagem) — o balão continua mostrando a citação no nosso chat.
        if (body.quoteDropped) {
          toast.warning('Mensagem enviada, mas sem a citação: o Pyvon não conseguiu citar a mensagem original.');
        }
        outcome = { ok: true };
      }
    } catch (error: any) {
      const errorMsg = error?.message || 'Falha de rede';
      console.error(`[WhatsApp] Mensagem ${messageId} NÃO enviada (${channel || 'canal desconhecido'}, falha de rede): ${errorMsg}`, { message: error?.message, stack: error?.stack, instanceId, phone, hasAttachments });
      toast.warning('Mensagem salva, mas não foi enviada no WhatsApp.');
      outcome = { ok: false, error: errorMsg };
    }

    patchMessageWhatsappStatus(sessionId, messageId, outcome.ok ? 'sent' : 'failed', outcome.error);
    ChatService.updateMessageWhatsAppStatus(messageId, sessionId, outcome.ok ? 'sent' : 'failed', outcome.error);
    return outcome;
  };

  // Botão "Reenviar" no balão de uma mensagem que falhou — repete o mesmo
  // encaminhamento, usando os dados atuais da sessão selecionada (fila pode
  // ter mudado desde a tentativa original).
  const handleResendWhatsAppMessage = async (message: ChatMessage) => {
    if (!selectedChat) return;
    await forwardMessageToWhatsApp({
      sessionId: selectedChat.id,
      messageId: message.id,
      customerPhone: selectedChat.customerPhone,
      queueId: selectedChat.queueId,
      channel: selectedChat.channel,
      text: message.text,
      attachments: message.attachments,
      // reenviar preserva a citação da tentativa original
      replyToMessageId: message.metadata?.replyTo?.messageId
    });
  };

   const handleSendMessage = async () => {
    console.log('[DEBUG] handleSendMessage called', { message, selectedChatId, hasCurrentUser: !!currentUser, attachments: chatAttachments.length });
    if ((!message?.trim() && chatAttachments.length === 0) || !currentUser) return;
    // Cliente pode estar sem sessão: abrir o widget não cria mais atendimento
    // (ver efeito acima). A equipe continua precisando de uma conversa
    // selecionada — não há o que criar sem saber pra quem.
    if (!selectedChatId && !isCustomer) return;

    const trimmedText = message.trim();

    // Primeira mensagem do cliente: é AQUI que o atendimento nasce e entra na
    // fila/rodízio ('pending' faz o servidor rodar a distribuição automática,
    // ver action=create-session em app/api/chats/route.ts).
    let activeChatId = selectedChatId;
    if (!activeChatId) {
      try {
        activeChatId = await createChatSession({
          customerId: currentUser.id,
          customerName: currentUser.name,
          customerPhone: currentUser.phone,
          status: 'pending',
          startedAt: new Date().toISOString()
        } as any);
        setSelectedChatId(activeChatId);
      } catch (error) {
        console.error('Error creating customer chat session:', error);
        toast.error('Erro ao iniciar conversa.');
        return;
      }
    }

    // Citação: só canal Pyvon e só de mensagem que o Pyvon conhece. replyTo aqui
    // é só a prévia OTIMISTA (aparece já no balão); o servidor descarta o que
    // vem do navegador e grava a citação montada a partir do banco.
    const quotedMessage = replyingTo && canQuoteMessage(replyingTo) ? replyingTo : null;
    const quotedAttachment = quotedMessage?.attachments?.[0] || quotedMessage?.metadata?.attachments?.[0];
    const optimisticReplyTo: ChatReplyQuote | undefined = quotedMessage ? {
      messageId: quotedMessage.id,
      senderName: quotedMessage.senderName,
      text: (quotedMessage.text || '').trim().slice(0, 200),
      kind: quotedAttachment
        ? (quotedAttachment.type?.startsWith('image/') ? 'image' : quotedAttachment.type?.startsWith('audio/') ? 'audio' : quotedAttachment.type?.startsWith('video/') ? 'video' : 'file')
        : 'text'
    } : undefined;

    const newMessage: ChatMessage = {
      id: crypto.randomUUID(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      // Sem legenda digitada = sem legenda mostrada (pedido do usuário
      // 2026-09-17) — nada de "Anexo enviado" fabricado; forwardMessageToWhatsApp
      // decide sozinho o mínimo exigido pelo Pyvon quando for encaminhar.
      text: message.trim(),
      timestamp: new Date().toISOString(),
      type: 'text',
      attachments: chatAttachments.length > 0 ? chatAttachments : undefined,
      // Canal Pyvon: já nasce com o 1º tique ("enviando") — o status real
      // (2 tiques ou erro) chega quando o encaminhamento termina.
      whatsappStatus: customerSessions.find(s => s.id === activeChatId)?.channel === 'pyvon' ? 'sending' : undefined,
      metadata: (chatAttachments.length > 0 || quotedMessage) ? {
        ...(chatAttachments.length > 0 ? { attachments: chatAttachments } : {}),
        ...(quotedMessage ? { replyToMessageId: quotedMessage.id, replyTo: optimisticReplyTo } : {})
      } : undefined
    };
    setReplyingTo(null);

    const session = customerSessions.find(s => s.id === activeChatId);
    if (session) {
      try {
        // Optimistic UI update
        const updatedSessions = customerSessions.map(s => {
          if (s.id === activeChatId) {
            return {
              ...s,
              messages: [...(s.messages || []), newMessage],
              lastMessageAt: newMessage.timestamp
            };
          }
          return s;
        });
        setCustomerSessions(updatedSessions);
        setShouldAutoScroll(true);

        setMessage('');
        setChatAttachments([]);

        // Resposta à pesquisa de satisfação enviada ao encerrar a conversa: cliente
        // logado respondendo "1"/"0" direto pelo widget (equivalente ao que já é
        // tratado no lado do WhatsApp em lib/services/whatsapp-service.ts). Vai por
        // um caminho separado do push-message normal porque este último reabre
        // sessões fechadas (status closed -> pending) — responder a pesquisa não
        // deve fazer o atendimento parecer uma conversa nova para o analista.
        const isSurveyResponse =
          isCustomer &&
          session.status === 'closed' &&
          session.awaitingSurveyUntil &&
          new Date(session.awaitingSurveyUntil) > new Date() &&
          (trimmedText === '0' || trimmedText === '1');

        let effectiveSessionId = activeChatId;
        if (isSurveyResponse) {
          // -1 = negativo (não 0, que significa "neutro" em chat_histories.rating
          // e some das contagens de avaliação) — mesma conversão do canal
          // WhatsApp em lib/services/whatsapp-service.ts.
          await submitSurveyResponse(activeChatId, trimmedText === '1' ? 1 : -1, newMessage);
        } else {
          // Save via Supabase first, then attempt WhatsApp delivery. Se a sessão
          // já estava encerrada de verdade, o servidor cria um atendimento novo
          // e devolve o id dele — precisa acompanhar a conversa ativa pra lá.
          effectiveSessionId = await pushChatMessage(activeChatId, newMessage);
          if (effectiveSessionId !== activeChatId) {
            setSelectedChatId(effectiveSessionId);
          }
        }

        if (!isSurveyResponse && session.customerPhone) {
          await forwardMessageToWhatsApp({
            sessionId: effectiveSessionId,
            messageId: newMessage.id,
            customerPhone: session.customerPhone,
            queueId: session.queueId,
            channel: session.channel,
            text: newMessage.text,
            attachments: newMessage.attachments,
            replyToMessageId: quotedMessage?.id
          });
        }

        // Refresh sessions from Supabase
        const refreshedSessions = await fetchChatSessions();
        setCustomerSessions(refreshedSessions);

        // Clear notifications for this session on respond
        markNotificationsAsReadByTarget(effectiveSessionId);
      } catch (error) {
        console.error('Failed to send message:', error);
        toast.error('Erro ao enviar mensagem.');
      }
    } else {
      // Sessão ainda não está no estado local — é o caso normal da primeira
      // mensagem do cliente (acabou de ser criada acima) e também o de uma
      // sessão que ainda não terminou de carregar.
      console.log('[DEBUG] Session not in state, sending directly to Supabase');
      try {
        setShouldAutoScroll(true);

        // Optimistic update
        const optimisticSession: ChatSession = {
          id: activeChatId,
          customerId: currentUser.id,
          customerName: currentUser.name,
          status: 'pending',
          messages: [newMessage],
          startedAt: new Date().toISOString(),
          lastMessageAt: newMessage.timestamp
        };
        setCustomerSessions(prev => [optimisticSession, ...prev.filter(s => s.id !== activeChatId)]);
        setMessage('');
        setChatAttachments([]);

        const effectiveSessionId = await pushChatMessage(activeChatId, newMessage);
        if (effectiveSessionId !== activeChatId) {
          setSelectedChatId(effectiveSessionId);
        }
        const refreshedSessions = await fetchChatSessions();
        setCustomerSessions(refreshedSessions);

        // Mesmo encaminhamento pro WhatsApp que o ramo "session" acima faz —
        // faltava aqui. Sem isso, responder uma conversa que ainda não tinha
        // chegado no estado local (típico de uma conversa recém-criada, ex.:
        // primeira resposta a um atendimento que acabou de chegar via
        // WhatsApp/Pyvon) salvava a mensagem no chat só localmente e nunca
        // chegava no WhatsApp de verdade — sem erro nenhum visível, porque
        // este ramo nunca teve a chamada a /api/whatsapp/send.
        const freshSession: any = refreshedSessions.find((s: any) => s.id === effectiveSessionId);
        if (freshSession?.customerPhone) {
          await forwardMessageToWhatsApp({
            sessionId: effectiveSessionId,
            messageId: newMessage.id,
            customerPhone: freshSession.customerPhone,
            queueId: freshSession.queueId,
            channel: freshSession.channel,
            text: newMessage.text,
            attachments: newMessage.attachments,
            replyToMessageId: quotedMessage?.id
          });
        }
      } catch (error) {
        console.error('Failed to send message (no session fallback):', error);
        toast.error('Erro ao enviar mensagem.');
      }
    }
    
  };

  // Canal Pyvon: decide sozinho (servidor) se abre normal (dentro da janela
  // de 24h) ou se precisa do template contato_pos_vendas antes — mesma regra
  // de components/start-whatsapp-conversation-modal.tsx. Substituiu o
  // openChatForPhone direto, que abria sem checar nada.
  const handleStartNewChat = async () => {
    if (!newChatNumber || isStartingNewChat) return;
    setIsStartingNewChat(true);
    try {
      const result = await startPyvonConversation({ phone: newChatNumber, name: newChatName || undefined });
      if ('error' in result) {
        toast.error(result.error);
        return;
      }
      setSelectedChatId(result.sessionId);
      const sessions = await fetchChatSessions();
      setCustomerSessions(sessions);
      toast.success(result.usedTemplate
        ? 'Fora da janela de 24h — mensagem inicial enviada e conversa aberta.'
        : 'Conversa aberta — o contato já pode ser respondido normalmente.');
      setIsNewChatModalOpen(false);
      setNewChatNumber('');
      setNewChatName('');
      setNewChatWindowStatus('unknown');
    } catch (error) {
      console.error('Error starting chat:', error);
      toast.error('Erro ao iniciar conversa.');
    } finally {
      setIsStartingNewChat(false);
    }
  };

  // Arquiva a conversa ATUAL (grava snapshot em chat_histories, mesmo formato
  // de handleGenerateTicket) e abre um atendimento novo pro mesmo contato, sem
  // gerar chamado nem avisar o cliente — é uma reorganização interna pra
  // separar um segundo assunto, não uma despedida de verdade. Fecha a sessão
  // atual ANTES de criar a nova: create-session reaproveita sessão aberta do
  // mesmo contato se encontrar uma, então a ordem importa.
  const handleDuplicateChat = async () => {
    if (!selectedChat || !currentUser || isDuplicatingChat) return;

    setIsDuplicatingChat(true);
    try {
      const formattedChatLog = selectedChat.messages?.map(m => {
        const time = new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const attachments: Attachment[] = (m as any).attachments || (m as any).metadata?.attachments || [];
        const transcribedAudio = attachments.find(a => isAudioAttachment(a) && a.transcription);
        const text = transcribedAudio ? `[Áudio] "${transcribedAudio.transcription}"` : m.text;
        return `[${time}] ${m.senderName}: ${text}`;
      }).join('\n') || '';
      const chatHistoryText = `===== HISTÓRICO DO CHAT =====\n${formattedChatLog}\n===== FIM DO HISTÓRICO =====\n\nConversa duplicada em: ${new Date().toLocaleString('pt-BR')} (novo atendimento aberto para o mesmo contato)`;

      const startedAt = selectedChat.startedAt ? new Date(selectedChat.startedAt) : new Date();
      const finishedAt = new Date();
      const durationSeconds = Math.floor((finishedAt.getTime() - startedAt.getTime()) / 1000);

      let firstResponseSeconds: number | undefined;
      if (selectedChat.messages && selectedChat.messages.length > 0) {
        const firstAnalystMsg = selectedChat.messages.find(m =>
          m.senderId !== selectedChat.customerId &&
          m.type !== 'system' &&
          m.text &&
          !m.text.includes('criou o grupo')
        );
        if (firstAnalystMsg?.timestamp) {
          firstResponseSeconds = Math.floor((new Date(firstAnalystMsg.timestamp).getTime() - startedAt.getTime()) / 1000);
        }
      }

      await saveChatHistory({
        sessionId: selectedChat.id,
        customerId: selectedChat.customerId,
        customerName: selectedChat.customerName,
        customerPhone: selectedChat.customerPhone,
        assigneeId: selectedChat.assigneeId || currentUser.id,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationSeconds,
        firstResponseSeconds,
        transcript: chatHistoryText
      });

      await closeChatSessionAfterTicket(selectedChat.id, null);

      const newSessionId = await createChatSession({
        customerId: selectedChat.customerId,
        customerName: selectedChat.customerName,
        customerPhone: selectedChat.customerPhone,
        status: 'active',
        startedAt: new Date().toISOString()
      } as any);

      setSelectedChatId(newSessionId);
      const sessions = await fetchChatSessions();
      setCustomerSessions(sessions);
      setIsDuplicateModalOpen(false);
      toast.success('Conversa duplicada — novo atendimento aberto.');
    } catch (error) {
      console.error('Erro ao duplicar conversa:', error);
      toast.error('Erro ao duplicar conversa.');
    } finally {
      setIsDuplicatingChat(false);
    }
  };

  // Qual botão do modal de finalizar/gerar chamado está em andamento ('generate',
  // 'finish' ou 'spam'). Serve pra mostrar o spinner NO botão clicado e travar
  // os demais: a operação faz várias idas ao servidor e, sem sinal visual,
  // dava a impressão de que o clique não tinha pegado (e a pessoa clicava de novo).
  const [finishingAction, setFinishingAction] = useState<'generate' | 'finish' | 'spam' | null>(null);
  const finishingRef = useRef(false);

  const handleGenerateTicket = async (closeChat: boolean, closeAsSpam: boolean = false, forceNew: boolean = false) => {
    // Ref (não só o estado): dois cliques no mesmo tick passam pelo state antigo.
    if (finishingRef.current) return;
    // O título só é exigido quando vai nascer um chamado: finalizar uma conversa
    // que já tem chamado vinculado não usa (nem mostra) o campo de título.
    if (!selectedChat || !currentUser) return;
    if (!selectedChat.ticketId && !ticketTitle) return;

    // Já existe um chamado vinculado a esta conversa (gerado antes, sem
    // finalizar) — em vez de bloquear, confirma se o usuário quer mesmo abrir
    // um chamado separado (permite mais de um chamado por conversa, ver item
    // 10 do roadmap); para finalizar usando esse mesmo chamado, o fluxo
    // abaixo (closeChat === true) já reaproveita automaticamente, sem passar
    // por aqui.
    if (!closeChat && selectedChat.ticketId && !forceNew) {
      setIsConfirmNewTicketOpen(true);
      return;
    }

    finishingRef.current = true;
    setFinishingAction(closeAsSpam ? 'spam' : closeChat ? 'finish' : 'generate');
    try {
      const hadExistingTicket = !!selectedChat.ticketId;

      // Histórico em texto puro só pro registro de métricas em chat_histories
      // (saveChatHistory, mais abaixo) — o chamado em si NÃO recebe mais uma
      // cópia da conversa: ele só guarda a referência (ticket_id/ticket_number
      // em chat_sessions, definido por saveTicketFromChatSession), e quem
      // quiser ver a conversa busca ao vivo em chat_messages pela sessão
      // vinculada, evitando duplicar o dado (e ele ficar desatualizado).
      const formattedChatLog = selectedChat.messages?.map(m => {
        const time = new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        // Se o áudio já tiver transcrição nesse instante, usa o texto
        // transcrito em vez do placeholder "[Áudio]" cru — melhora o caso
        // comum, mas não é garantia: a versão "ao vivo" (Histórico de
        // Conversas, busca em chat_messages) sempre reflete a transcrição
        // mais atual, mesmo que ela termine depois deste snapshot.
        const attachments: Attachment[] = (m as any).attachments || (m as any).metadata?.attachments || [];
        const transcribedAudio = attachments.find(a => isAudioAttachment(a) && a.transcription);
        const text = transcribedAudio ? `[Áudio] "${transcribedAudio.transcription}"` : m.text;
        return `[${time}] ${m.senderName}: ${text}`;
      }).join('\n') || '';
      const chatHistoryText = `===== HISTÓRICO DO CHAT =====\n${formattedChatLog}\n===== FIM DO HISTÓRICO =====\n\n${closeChat ? `Chat finalizado em: ${new Date().toLocaleString('pt-BR')}` : `Chamado gerado em: ${new Date().toLocaleString('pt-BR')} (atendimento continua em aberto)`}`;

      // Um chamado por conversa (decisão do usuário, 2026-09-24): finalizar uma
      // conversa que JÁ tem chamado vinculado só encerra a conversa — não chama
      // a criação de chamado e não mexe no status do que já existe (antes o
      // servidor reaproveitava o chamado e ainda o marcava "Fechado" se o
      // "Fechar imediatamente" estivesse marcado). Conversa sem chamado segue
      // como sempre: gerar (e, se quiser, finalizar) cria o chamado.
      const skipTicketCreation = closeChat && hadExistingTicket && !forceNew;
      const ticketResult = skipTicketCreation
        ? { ticketId: selectedChat.ticketId as string, ticketNumber: selectedChat.ticketNumber as number }
        : await saveTicketFromChatSession(selectedChat.id, ticketTitle, closeTicketImmediately, forceNew);
      if ('error' in ticketResult) {
        console.error('Error saving ticket from chat session:', ticketResult.error);
        toast.error('Erro ao criar chamado.');
        return;
      }
      const createdTicketId = ticketResult.ticketId;
      const createdTicketNumber = ticketResult.ticketNumber;

      if (!closeChat) {
        // O vínculo com a conversa em andamento já foi feito dentro de
        // saveTicketFromChatSession — aqui só falta avisar o cliente, sem
        // mexer em status/histórico já que o atendimento continua aberto.
        //
        // Avisa dentro da própria conversa que um chamado foi aberto — sempre
        // registrado no chat e, adicionalmente, encaminhado pelo WhatsApp quando
        // há telefone. Leva o NÚMERO e o ASSUNTO do chamado. Sem link: o
        // usuário pediu a mensagem só com essas duas informações (2026-09-25;
        // a versão anterior mandava "Acompanhe o andamento pelo link abaixo").
        const ticketNoticeText = [
          `📄 Novo chamado gerado #${String(createdTicketNumber).padStart(4, '0')}`,
          ticketTitle.trim() ? `📌 Assunto:\n${ticketTitle.trim()}` : ''
        ].filter(Boolean).join('\n\n');
        const ticketNoticeMessage: ChatMessage = {
          id: crypto.randomUUID(),
          senderId: currentUser.id,
          senderName: 'SSX Desk',
          text: ticketNoticeText,
          timestamp: new Date().toISOString(),
          type: 'system'
        };
        try {
          await pushChatMessage(selectedChat.id, ticketNoticeMessage);
          // Não aguarda — ver comentário equivalente no fluxo de encerramento
          // mais abaixo: com o WhatsApp desconectado, essa chamada pode levar
          // quase 1min pra falhar e travava "Gerar Chamado" à toa.
          forwardMessageToWhatsApp({
            sessionId: selectedChat.id,
            messageId: ticketNoticeMessage.id,
            customerPhone: selectedChat.customerPhone,
            queueId: selectedChat.queueId,
            channel: selectedChat.channel,
            text: ticketNoticeMessage.text
          });
        } catch (msgError) {
          console.error('Failed to notify customer about ticket creation:', msgError);
        }

        setIsFinishModalOpen(false);
        const sessions = await fetchChatSessions();
        setCustomerSessions(sessions);
        setTicketTitle('');
        toast.success(`Chamado #${String(createdTicketNumber).padStart(4, '0')} criado com sucesso!`, {
          description: `${ticketTitle ? `${ticketTitle} — ` : ''}O atendimento continua em aberto.`
        });
        return;
      }

      // Calculate timing metrics
      const startedAt = selectedChat.startedAt ? new Date(selectedChat.startedAt) : new Date();
      const finishedAt = new Date();
      const durationSeconds = Math.floor((finishedAt.getTime() - startedAt.getTime()) / 1000);
      
      // Find first response time (first non-system, non-same-user message) —
      // mensagens automáticas (apresentação do operador, aviso de chamado,
      // encerramento/pesquisa) têm type 'system' e não contam como resposta
      // real do analista, senão o tempo de 1ª resposta ficaria artificialmente
      // baixo (ou zerado) sempre que essas mensagens automáticas dispararem
      // antes de o analista digitar algo de fato.
      let firstResponseSeconds: number | undefined;
      if (selectedChat.messages && selectedChat.messages.length > 0) {
        const firstAnalystMsg = selectedChat.messages.find(m =>
          m.senderId !== selectedChat.customerId &&
          m.type !== 'system' &&
          m.text &&
          !m.text.includes('criou o grupo')
        );
        if (firstAnalystMsg?.timestamp) {
          const firstMsgTime = new Date(firstAnalystMsg.timestamp);
          firstResponseSeconds = Math.floor((firstMsgTime.getTime() - startedAt.getTime()) / 1000);
        }
      }

// Save chat history for internal team access (non-blocking - continue even if fails)
      saveChatHistory({
        sessionId: selectedChat.id,
        customerId: selectedChat.customerId,
        customerName: selectedChat.customerName,
        customerPhone: selectedChat.customerPhone,
        assigneeId: selectedChat.assigneeId || currentUser.id,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationSeconds,
        firstResponseSeconds,
        transcript: chatHistoryText
      }).catch(historyErr => {
        console.error('Non-critical error saving chat history:', historyErr);
        // Don't block the ticket creation
      });

      // Send closing notice + satisfaction survey. Always registered as a chat
      // message (visible in-app for a logged-in customer, and for anyone reading
      // the transcript) and, additionally, pushed via WhatsApp when a phone number
      // is available. Inserted BEFORE the session is marked 'closed' below, so it
      // doesn't trip the closed->pending auto-reopen side effect in push-message.
      //
      // "Fechar como Spam" pula esse bloco inteiro de propósito: alguns clientes
      // têm um bot que responde automaticamente a QUALQUER mensagem recebida
      // (inclusive a pesquisa de satisfação) — isso criava um loop, já que uma
      // resposta automática do bot (texto qualquer, não "0"/"1") sempre vira um
      // atendimento novo (ver push-message), que ao ser fechado de novo dispara
      // outra pesquisa, e por aí vai. Fechando como spam, o chamado é criado
      // normalmente, mas nada é enviado ao cliente — se ele mandar uma mensagem
      // de verdade depois, o fluxo normal (sessão nova) cuida disso sozinho.
      let awaitingSurveyUntil: string | null = null;
      if (!closeAsSpam) {
        try {
          const surveySettings = await fetchSurveySettings();
          if (surveySettings?.enabled && surveySettings.message) {
            const conversationNumber = String(createdTicketNumber ?? selectedChat.ticketNumber ?? '').padStart(4, '0');
            const closingMessage = `Sua conversa #${conversationNumber} foi finalizada.\n\n${surveySettings.message}`;

            const closingChatMessage: ChatMessage = {
              id: crypto.randomUUID(),
              senderId: currentUser.id,
              senderName: 'SSX Desk',
              text: closingMessage,
              timestamp: new Date().toISOString(),
              type: 'system'
            };
            await pushChatMessage(selectedChat.id, closingChatMessage);
            awaitingSurveyUntil = new Date(Date.now() + surveySettings.responseWindowHours * 3600_000).toISOString();

            // Não aguarda: quando o WhatsApp está desconectado, o envio faz
            // até 3 tentativas com espera de reconexão de ~20s cada
            // (WhatsAppService.sendMessage/waitUntilConnected) — chegando a
            // ~1min. Esperar isso aqui travava "Gerar chamado e finalizar"
            // inteiro (a sessão só fecha depois deste bloco), dando a
            // impressão de que o chat não fechava. O aviso de encerramento já
            // foi registrado no chat acima (pushChatMessage); o envio ao
            // WhatsApp é best-effort.
            forwardMessageToWhatsApp({
              sessionId: selectedChat.id,
              messageId: closingChatMessage.id,
              customerPhone: selectedChat.customerPhone,
              queueId: selectedChat.queueId,
              channel: selectedChat.channel,
              text: closingMessage
            });
          }
        } catch (surveyError) {
          console.error('Failed to send closing survey:', surveyError);
          toast.warning('Chamado finalizado, mas a mensagem de encerramento/pesquisa não foi registrada.');
        }
      }

      // ticket_id/ticket_number já foram vinculados por saveTicketFromChatSession —
      // aqui só falta marcar a sessão como encerrada.
      const closeResult = await closeChatSessionAfterTicket(selectedChat.id, awaitingSurveyUntil, closeAsSpam);
      if ('error' in closeResult) {
        console.error('Error closing session:', closeResult.error);
        toast.error('Erro ao fechar conversa.');
        return;
      }

      // Convite pra avaliar a empresa-cliente (perfil interno, nunca visível
      // a ela) — só faz sentido pra um atendimento de verdade, com o contato
      // vinculado a uma empresa conhecida (sem isso não há em qual cadastro
      // gravar a avaliação), que não foi encerrado como spam, e que não
      // esteja "silenciado" (ver botão Recusar por 1 semana no modal). Abre
      // o modal direto — antes só disparava uma notificação no sino, que
      // não deixava claro que dava pra agir ali mesmo.
      const evaluationCompany = selectedChatContact?.companyId
        ? companies.find(c => c.id === selectedChatContact.companyId)
        : null;
      if (!closeAsSpam && evaluationCompany && currentUser && !isEvaluationSnoozed(currentUser.id, evaluationCompany.id)) {
        openEvaluationModal({
          companyId: evaluationCompany.id,
          companyName: evaluationCompany.name,
          chatSessionId: selectedChat.id,
          contactId: selectedChatContact?.id,
          contactName: selectedChatContact?.name
        });
      }

      setIsFinishModalOpen(false);
      setSelectedChatId(null);
      const sessions = await fetchChatSessions();
      setCustomerSessions(sessions);
      setTicketTitle('');
      toast.success(
        hadExistingTicket
          ? `Atendimento finalizado! Chamado #${String(createdTicketNumber).padStart(4, '0')} mantido.`
          : `Chamado #${String(createdTicketNumber).padStart(4, '0')} criado com sucesso!`,
        hadExistingTicket || !ticketTitle ? undefined : { description: ticketTitle }
      );
    } catch (error) {
      console.error('Failed to finish chat:', error);
      toast.error('Erro ao criar chamado.');
    } finally {
      finishingRef.current = false;
      setFinishingAction(null);
    }
  };

  // Cresce junto com o texto (até um teto, depois rola por dentro) — via
  // efeito ligado a `message` em vez de só onInput, pra também encolher de
  // volta quando a mensagem é limpa no envio ou preenchida por fora (resposta
  // pronta colada pelo painel, ver insertQuickReply).
  //
  // Também reajusta quando a LARGURA do campo muda (maximizar/minimizar o chat,
  // redimensionar a janela): antes só reagia a mudança de texto, então digitar
  // no chat minimizado e maximizar (ou o contrário) deixava a altura velha — no
  // sentido maximizado→minimizado, o texto ficava cortado no campo. Maximizado
  // tem mais espaço, então o teto é maior (depois dele o campo rola por dentro).
  const composerMaxHeight = isExpanded ? 200 : 120;
  const fitComposer = React.useCallback(() => {
    const el = messageInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, composerMaxHeight)}px`;
  }, [composerMaxHeight]);

  useEffect(() => { fitComposer(); }, [message, fitComposer]);

  // Ref por CALLBACK (não useEffect): o campo é recriado ao maximizar/minimizar
  // (a conversa muda de lugar na árvore), e um observer preso ao elemento
  // antigo ficava olhando pra nada — o campo novo nascia sem ajuste. Aqui todo
  // elemento novo já entra medido e observado.
  const fitComposerRef = useRef(fitComposer);
  fitComposerRef.current = fitComposer;
  const composerObserverRef = useRef<ResizeObserver | null>(null);
  const setComposerRef = React.useCallback((el: HTMLTextAreaElement | null) => {
    composerObserverRef.current?.disconnect();
    composerObserverRef.current = null;
    messageInputRef.current = el;
    if (!el) return;
    fitComposerRef.current();
    if (typeof ResizeObserver === 'undefined') return;
    let lastWidth = el.clientWidth;
    // Só a largura interessa: mexer na altura aqui dispararia o observer de
    // novo em loop.
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      fitComposerRef.current();
    });
    observer.observe(el);
    composerObserverRef.current = observer;
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setMessage(val);
    if (selectedChatId && currentUser && val.trim()) {
      const now = Date.now();
      if (now - lastTypingSentAtRef.current > 3000) {
        lastTypingSentAtRef.current = now;
        ChatService.sendTyping(selectedChatId, currentUser.id, currentUser.name);
      }
    }
  };

  const QUICK_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

  const toggleMessageReaction = async (messageId: string, emoji: string) => {
    if (!currentUser || !selectedChatId) return;
    setReactionPickerMessageId(null);
    try {
      await ChatService.toggleReaction(messageId, currentUser.id, emoji);
      const sessions = await ChatService.getSessions(currentUser.id);
      const updated = sessions.find(s => s.id === selectedChatId);
      if (updated) setCustomerSessions(prev => prev.map(s => s.id === selectedChatId ? { ...s, messages: updated.messages } : s));
    } catch (error: any) {
      toast.error(error.message || 'Erro ao reagir à mensagem');
    }
  };

  const startEditMessage = (message: ChatMessage) => {
    setEditingMessageId(message.id);
    setEditDraftText(message.text);
  };

  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditDraftText('');
  };

  const saveEditMessage = async () => {
    if (!currentUser || !editingMessageId || !editDraftText.trim()) return;
    const messageId = editingMessageId;
    const text = editDraftText.trim();
    try {
      await ChatService.editMessage(messageId, currentUser.id, text);
      setCustomerSessions(prev => prev.map(s => ({
        ...s,
        messages: (s.messages || []).map(m => m.id === messageId ? { ...m, text, isEdited: true, editedAt: new Date().toISOString() } : m)
      })));
      cancelEditMessage();
    } catch (error: any) {
      toast.error(error.message || 'Erro ao editar mensagem');
    }
  };

  const deleteChatMessage = async (message: ChatMessage) => {
    if (!currentUser) return;
    try {
      await ChatService.deleteMessage(message.id, currentUser.id);
      setCustomerSessions(prev => prev.map(s => ({
        ...s,
        messages: (s.messages || []).map(m => m.id === message.id ? { ...m, isDeleted: true, deletedAt: new Date().toISOString() } : m)
      })));
      toast.success('Mensagem excluída');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao excluir mensagem');
    }
  };

  const openMessageHistory = async (messageId: string) => {
    setMessageHistoryFor(messageId);
    try {
      const history = await ChatService.getMessageHistory(messageId);
      setMessageHistoryEntries(history);
    } catch {
      setMessageHistoryEntries([]);
    }
  };

  // Compartilhado entre o seletor de arquivo (input) e o colar (Ctrl+V) de
  // print/arquivo — mesmas regras (limite compartilhado, conversão pra data URL)
  // pros dois caminhos, pra cliente e operador igual (é o mesmo componente).
  const addFilesAsChatAttachments = async (files: File[]) => {
    for (const file of files) {
      const fileId = crypto.randomUUID();

      if (file.size > MAX_CHAT_ATTACHMENT_SIZE) {
        toast.error(`${file.name || 'Arquivo'} excede o limite de ${MAX_ATTACHMENT_TOTAL_LABEL} por envio.`);
        continue;
      }

      let dataUrl = '';
      try {
        dataUrl = await fileToDataUrl(file);
      } catch (error) {
        console.error('Error reading chat attachment:', error);
        toast.error(`Erro ao anexar ${file.name || 'arquivo'}`);
        continue;
      }

      setChatAttachments(prev => [...prev, {
        id: fileId,
        name: file.name || `colado-${Date.now()}.png`,
        type: file.type || 'application/octet-stream',
        url: dataUrl,
        size: file.size
      }]);
    }
  };

  const handleChatFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    await addFilesAsChatAttachments(files);
    if (chatFileInputRef.current) {
      chatFileInputRef.current.value = '';
    }
  };

  // Cola direto do clipboard (print de tela, ou arquivo copiado no SO) sem
  // precisar abrir o seletor de arquivo — funciona tanto pro cliente quanto
  // pro operador, já que os dois usam este mesmo componente de chat. Só
  // intercepta quando há de fato um arquivo/imagem colado; colar texto
  // normal continua funcionando sem interferência.
  const handleChatPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;

    const files = Array.from(items)
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((f): f is File => !!f);

    if (files.length === 0) return;

    e.preventDefault();
    await addFilesAsChatAttachments(files);
  };

  const startRecording = async () => {
    if (isRecording) return;

    console.log('[AudioRecording] startRecording called');

    if (!navigator.mediaDevices?.getUserMedia) {
      console.error('[AudioRecording] navigator.mediaDevices.getUserMedia is unavailable (requires HTTPS or localhost).');
      toast.error('Gravação de áudio requer conexão segura (HTTPS) ou localhost.');
      return;
    }
    const AudioContextClass: typeof AudioContext | undefined =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      console.error('[AudioRecording] Web Audio API is unavailable in this browser.');
      toast.error('Gravação de áudio não é suportada neste navegador.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('[AudioRecording] Microphone stream acquired. Audio tracks:', stream.getAudioTracks().map(t => ({ label: t.label, readyState: t.readyState, enabled: t.enabled })));
      mediaStreamRef.current = stream;
      pcmChunksRef.current = [];

      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;
      recordingSampleRateRef.current = audioContext.sampleRate;

      const source = audioContext.createMediaStreamSource(stream);
      audioSourceNodeRef.current = source;

      const bufferSize = 4096;
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
      scriptProcessorRef.current = processor;

      processor.onaudioprocess = (e) => {
        // Copiamos o buffer: o AudioBuffer interno é reaproveitado pelo navegador entre chamadas.
        pcmChunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };

      // ScriptProcessorNode só dispara onaudioprocess quando conectado a um destino;
      // usamos um GainNode com volume 0 para não haver retorno audível do microfone.
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      silentGainRef.current = silentGain;

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);

      console.log(`[AudioRecording] Recording started via Web Audio API (PCM). sampleRate=${audioContext.sampleRate}`);
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingIntervalRef.current = setInterval(() => {
        setRecordingSeconds(prev => prev + 1);
      }, 1000);
    } catch (error: any) {
      console.error('[AudioRecording] Error starting audio recording:', {
        name: error?.name,
        message: error?.message,
        stack: error?.stack
      });
      if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
        toast.error('Permissão de microfone negada. Habilite o acesso ao microfone nas configurações do navegador.');
      } else if (error?.name === 'NotFoundError') {
        toast.error('Nenhum microfone encontrado neste dispositivo.');
      } else {
        toast.error('Não foi possível acessar o microfone.');
      }
    }
  };

  const releaseRecordingResources = () => {
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    disconnectRecordingGraph();
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
    }
    audioContextRef.current = null;
    pcmChunksRef.current = [];
    setIsRecording(false);
    setRecordingSeconds(0);
  };

  const cancelRecording = () => {
    releaseRecordingResources();
  };

  const stopRecordingAndAttach = async () => {
    if (!audioContextRef.current) {
      releaseRecordingResources();
      return;
    }

    console.log(`[AudioRecording] Stopping. PCM chunks collected: ${pcmChunksRef.current.length}`);
    const sampleRate = recordingSampleRateRef.current;
    const chunks = pcmChunksRef.current;
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    console.log(`[AudioRecording] Total samples captured: ${totalLength} (~${(totalLength / sampleRate).toFixed(1)}s at ${sampleRate}Hz)`);

    if (totalLength === 0) {
      console.error('[AudioRecording] No audio samples captured — check microphone permissions/input device.');
      toast.error('Nenhum áudio foi capturado. Verifique se o microfone está funcionando.');
      releaseRecordingResources();
      return;
    }

    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const wavBlob = encodeWav(merged, sampleRate);
    console.log(`[AudioRecording] WAV encoded: size=${wavBlob.size} bytes`);

    if (wavBlob.size > MAX_CHAT_ATTACHMENT_SIZE) {
      toast.error(`Áudio excede o limite de ${MAX_ATTACHMENT_TOTAL_LABEL}.`);
      releaseRecordingResources();
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(wavBlob);
      setChatAttachments(prev => [...prev, {
        id: crypto.randomUUID(),
        name: `audio-${Date.now()}.wav`,
        type: 'audio/wav',
        url: dataUrl,
        size: wavBlob.size
      }]);
      console.log('[AudioRecording] Audio attachment added to chatAttachments successfully.');
    } catch (error: any) {
      console.error('[AudioRecording] Error processing recorded audio:', { message: error?.message, stack: error?.stack });
      toast.error('Erro ao processar áudio gravado.');
    } finally {
      releaseRecordingResources();
    }
  };

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShouldAutoScroll(isAtBottom);
      if (isAtBottom) setShowNewMessageIndicator(false);
    }
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
      setShouldAutoScroll(true);
      setShowNewMessageIndicator(false);
    }
  };

  // Cola o texto da resposta pronta no campo de digitação (não envia: quem
  // atende revisa/edita e envia). Com texto já digitado, entra numa linha nova
  // no fim. (O antigo comando "/atalho" foi aposentado em 2026-09-25 — este
  // painel é o único caminho pras respostas prontas.)
  // Cadastra uma resposta pronta nova pelo painel (o título único já vem
  // resolvido pelo painel) e recarrega a lista.
  const createQuickReply = async ({ title, content }: { title: string; content: string }) => {
    try {
      await ConfigService.saveQuickNote({ shortcut: title, content } as QuickNote);
    } catch {
      throw new Error('Não foi possível salvar. Tente de novo em instantes.');
    }
    setQuickNotes(await fetchQuickNotes());
    toast.success('Resposta pronta cadastrada.');
  };

  const insertQuickReply = (note: QuickNote) => {
    setMessage(prev => {
      const base = prev.replace(/\s+$/, '');
      return base ? `${base}\n${note.content}` : note.content;
    });
    setIsQuickRepliesOpen(false);
    setTimeout(() => {
      const el = messageInputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
  };

  if (!mounted || !currentUser) return null;
  if (isOmniChatExpanded && (!isExpanded || isMinimized)) return null;

  const isMobileFullScreen = isMobileViewport && !isMinimized;
  // Modo foco (botão de maximizar): agora é tela cheia de verdade, igual à
  // página de Chat Interno mostrando os chats — não a caixa flutuante de
  // 90vw/85vh de antes. Mesmo tratamento do fullscreen mobile, só que também
  // disparado no desktop por isExpanded.
  const isFullScreen = isMobileFullScreen || isExpanded;

  // Com o botão arrastado (launcherPos preenchido, fora do fullscreen), o
  // painel abre sempre pro lado com mais espaço na tela em vez do canto fixo
  // de sempre — pra cima/direita por padrão (replica o comportamento
  // original quando launcherPos é null), vira pra baixo/esquerda conforme o
  // botão se aproxima do topo/da borda esquerda.
  const hasCustomLauncherPos = !!launcherPos && !isFullScreen;
  const openPanelUp = !hasCustomLauncherPos || (launcherPos!.top + CHAT_LAUNCHER_SIZE / 2) > window.innerHeight / 2;
  const anchorPanelRight = !hasCustomLauncherPos || (launcherPos!.left + CHAT_LAUNCHER_SIZE / 2) > window.innerWidth / 2;

  return (
    <div
      className={cn(
        "omni-chat-shell fixed flex flex-col",
        anchorPanelRight ? "items-end" : "items-start",
        // Em tela cheia no celular precisa ficar acima da bottom nav (z-[200]
        // em mobile-bottom-nav.tsx) — ela já se esconde sozinha enquanto o
        // chat está aberto, mas isso é reforço para não depender só disso.
        isFullScreen
          ? "inset-0 z-[250]"
          : cn("z-[200]", !hasCustomLauncherPos && "bottom-6 right-6")
      )}
      style={hasCustomLauncherPos ? { left: launcherPos!.left, top: launcherPos!.top } : undefined}
      data-expanded={isExpanded && !isMinimized ? 'true' : 'false'}
    >
      <AnimatePresence>
        {!isMinimized && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              width: isFullScreen ? '100vw' : 'min(480px, calc(100vw - 2rem))',
              height: isFullScreen ? '100dvh' : 'min(700px, calc(100vh - 4rem))',
              right: isFullScreen ? 0 : (anchorPanelRight ? '0' : 'auto'),
              left: isFullScreen ? 'auto' : (anchorPanelRight ? 'auto' : '0'),
              bottom: isFullScreen ? 0 : (openPanelUp ? '80px' : 'auto'),
              top: isFullScreen ? 'auto' : (openPanelUp ? 'auto' : '80px'),
            }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className={cn(
              "bg-[var(--surface-card)] border border-[var(--border-default)] shadow-2xl flex flex-col overflow-hidden absolute",
              isFullScreen ? "rounded-none z-[210] border-none" : "rounded-2xl z-[205]"
            )}
          >
            {/* Header */}
            <div
              className="bg-[var(--accent)] px-5 py-4 flex justify-between items-center text-white shrink-0"
              style={isMobileFullScreen ? { paddingTop: 'calc(1rem + env(safe-area-inset-top))' } : undefined}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-md">
                  <MessageCircle size={16} />
                </div>
                <div>
                  <h3 className="text-xs font-black uppercase tracking-widest text-white">
                    {isCustomer ? 'Suporte Omni' : 'WhatsApp Omni'}
                  </h3>
                  <p className="text-[9px] text-indigo-100 dark:text-[var(--accent-soft-text)] font-bold uppercase tracking-widest">
                    {isCustomer ? 'Fale Conosco' : 'Central de Atendimento'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="hidden md:block p-1.5 hover:bg-white/10 rounded-lg transition-all"
                >
                  {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                <button
                  onClick={() => {
                    if (isExpanded) {
                      setIsExpanded(false);
                      return;
                    }
                    setIsMinimized(true);
                  }}
                  className="p-1.5 hover:bg-white/10 rounded-lg transition-all"
                >
                  <ChevronDown size={16} />
                </button>
              </div>
            </div>

            <div className="flex-1 flex overflow-hidden bg-[var(--surface-card)]/30 min-w-0">
              {/* Sidebar (List) - Hide for customer */}
              {(!isCustomer && (!selectedChatId || isExpanded)) && (
                <div
                  className={cn(
                    "flex flex-col border-r border-[var(--border-default)] bg-[var(--surface-card)]",
                    // Maximizado: largura ajustável (padrão 350px, mesma da lista em
                    // /chat-internal) pela divisória logo abaixo desta coluna.
                    isExpanded ? "shrink-0" : "w-full"
                  )}
                  style={isExpanded ? { width: chatListWidth } : undefined}
                >
                  <div className="p-3 border-b border-[var(--border-default)] space-y-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={13} />
                      <input
                        type="text"
                        value={chatSearch}
                        onChange={(e) => setChatSearch(e.target.value)}
                        placeholder="Buscar conversas..."
                        className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl pl-8 pr-3 py-1.5 text-xs font-bold outline-none"
                      />
                    </div>
                    <button
                      onClick={() => {
                        setNewChatNumber('');
                        setNewChatName('');
                        setNewChatWindowStatus('unknown');
                        setIsNewChatModalOpen(true);
                      }}
                      className="w-full py-2 bg-[var(--accent)]/10 text-[var(--accent-text)] border border-[var(--accent)]/20 rounded-xl text-[10px] font-semibold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-[var(--accent)]/20 transition-all"
                    >
                      <Plus size={13} /> Novo WhatsApp
                    </button>

                    <div className="flex bg-[var(--surface-pill)] p-1 rounded-xl gap-1">
                      <button
                        onClick={() => setChatFilter('all')}
                        className={cn(
                          "flex-1 py-1 text-[9px] font-semibold uppercase tracking-widest rounded-lg transition-all",
                          chatFilter === 'all' ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-tertiary)]"
                        )}
                      >
                        Todos
                      </button>
                      <button
                        onClick={() => setChatFilter('me')}
                        className={cn(
                          "flex-1 py-1 text-[9px] font-semibold uppercase tracking-widest rounded-lg transition-all",
                          chatFilter === 'me' ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-tertiary)]"
                        )}
                      >
                        Meus
                      </button>
                    </div>
                  </div>
                  {/* Fundo da lista mais escuro que os cartões das conversas: cada
                      conversa é um cartão claro sobre o fundo (antes cartão e
                      fundo eram o mesmo branco e se misturavam). */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-1.5 bg-[var(--surface-page)]">
                    {(() => {
                      const findSessionContact = (s: ChatSession) => allUsers.find(u =>
                        u.id === s.customerId ||
                        matchPhones(u.phone, s.customerPhone) || (u.phones && u.phones.some(p => matchPhones(p, s.customerPhone)))
                      );

                      // Busca da caixa "Buscar conversas...": casa com o que a
                      // linha mostra — nome do contato, empresa, número da
                      // conversa (com ou sem "#") e telefone. Sem diferenciar
                      // maiúsculas/acentos. Vazia = não filtra nada.
                      const searchTerm = normalizeString(chatSearch.trim());
                      const searchDigits = normalizePhone(chatSearch);
                      const searchNumber = searchTerm.replace(/^#/, '');
                      const matchesSearch = (s: ChatSession) => {
                        if (!searchTerm) return true;
                        const contact = findSessionContact(s);
                        const company = contact ? companies.find(c => c.id === contact.companyId) : null;
                        const names = normalizeString([s.customerName, contact?.name, company?.name].filter(Boolean).join(' '));
                        if (names.includes(searchTerm)) return true;
                        if (s.ticketNumber && /^\d+$/.test(searchNumber) && String(s.ticketNumber).padStart(4, '0').includes(searchNumber)) return true;
                        return searchDigits.length >= 3 && normalizePhone(s.customerPhone || '').includes(searchDigits);
                      };

                      const filteredSessions = customerSessions
                        .filter(s => s.status !== 'closed')
                        .filter(matchesSearch)
                        .filter(s => {
                          if (chatFilter === 'all') return true;
                          return s.assigneeId === currentUser?.id;
                        });

                      // Quem mandou a mensagem mais recente decide a seção —
                      // mesma separação do Bitrix: cliente esperando resposta
                      // ("Em andamento") vs. equipe já respondeu ("Respondido").
                      // 'internal'/'system' não contam pra nenhum dos dois lados
                      // (são bastidor, não uma resposta de verdade).
                      const needsReply = (s: ChatSession) => {
                        const relevant = (s.messages || []).filter(m => m.type !== 'internal' && m.type !== 'system');
                        if (relevant.length === 0) return true;
                        return relevant[relevant.length - 1].senderId === s.customerId;
                      };

                      const awaitingReply = filteredSessions.filter(needsReply);
                      const answered = filteredSessions.filter(s => !needsReply(s));

                      const renderRow = (s: ChatSession) => {
                        const contact = findSessionContact(s);
                        const company = contact ? companies.find(c => c.id === contact.companyId) : null;
                        const sessionUnread = getSessionUnreadCount(s);
                        const rowTags = chatTags.filter(t => (s.tags || []).includes(t.id));
                        const lastMessage = s.messages?.[s.messages.length - 1];
                        const lastMessagePreview = lastMessage
                          ? (lastMessage.isDeleted ? 'Mensagem apagada' : (lastMessage.text?.trim() || 'Anexo enviado'))
                          : null;

                        return (
                          <button
                            key={s.id}
                            onClick={() => setSelectedChatId(s.id)}
                            className={cn(
                              "w-full text-left p-3 rounded-2xl transition-all group flex items-center justify-between border relative overflow-hidden",
                              // Conversa aberta agora: preenchimento de destaque +
                              // borda sólida + anel, bem diferente dos cartões das
                              // outras conversas em andamento (antes era só um
                              // tom 10% mais claro, quase igual aos demais).
                              selectedChatId === s.id
                                // [--text-tertiary:...] sobe as legendas pequenas deste
                                // cartão para o tom secundário: sobre o fundo de destaque
                                // o terciário do tema escuro ficava em 3,9:1.
                                // Fundo OPACO (destaque misturado ao cartão), não /15: sobre o
                                // fundo mais escuro da lista, o semitransparente ficava acinzentado.
                                ? "bg-[color-mix(in_srgb,var(--accent)_15%,var(--surface-card))] border-[var(--accent)] ring-1 ring-[var(--accent)]/50 shadow-sm [--text-tertiary:var(--text-secondary)]"
                                : "bg-[var(--surface-card)] border-[var(--border-default)] hover:border-[var(--accent)]/30 shadow-none"
                            )}
                          >
                            {/* Uma faixa fina por tag, empilhadas — evita ter que
                                escolher uma cor "vencedora" quando há mais de uma. */}
                            {rowTags.length > 0 && (
                              <div className="absolute left-0 top-0 bottom-0 w-1 flex flex-col">
                                {rowTags.map(tag => (
                                  <span key={tag.id} className={cn('flex-1', tagAccentBgClass(tag))} />
                                ))}
                              </div>
                            )}
                            <div className={cn("flex items-center gap-2.5", rowTags.length > 0 && "pl-1.5")}>
                              {/* O avatar tem overflow-hidden (arredonda a foto): o número
                                  precisa ficar FORA dele, senão o círculo era cortado. */}
                              <div className="relative shrink-0">
                                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-[var(--text-success)] overflow-hidden bg-[var(--surface-success)]">
                                  {(() => {
                                    const photo = contact?.avatarUrl || getContactPhoto(s.customerPhone, getSessionInstanceId(s));
                                    return photo ? (
                                      <img src={photo} alt={s.customerName} className="w-full h-full object-cover" />
                                    ) : (
                                      <User size={16} />
                                    );
                                  })()}
                                </div>
                                {sessionUnread > 0 && (
                                  <span
                                    className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-[var(--text-danger)] text-white text-[9px] font-black flex items-center justify-center rounded-full border-2 border-[var(--surface-card)] shadow-sm"
                                    title={`${sessionUnread} mensage${sessionUnread === 1 ? 'm nova' : 'ns novas'}`}
                                  >
                                    {sessionUnread > 9 ? '9+' : sessionUnread}
                                  </span>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className={cn("text-xs font-black uppercase tracking-tight", selectedChatId === s.id ? "text-[var(--accent-text)]" : "text-[var(--text-primary)]")}>{s.customerName}</p>
                                {s.ticketNumber && (
                                  <p className="text-[9px] text-[var(--text-tertiary)] font-semibold uppercase tracking-widest">Conversa #{String(s.ticketNumber).padStart(4, '0')}</p>
                                )}
                                {company && (
                                  <p className="text-[9px] text-[var(--accent-text)] font-bold uppercase tracking-widest">{company.name}</p>
                                )}
                                {s.assigneeId && (
                                  <p className="text-[9px] text-[var(--text-tertiary)] font-semibold uppercase tracking-widest truncate">
                                    Com {allUsers.find(u => u.id === s.assigneeId)?.name || 'analista atribuído'}
                                  </p>
                                )}
                                {lastMessagePreview && (
                                  <p className={cn("text-[10px] truncate", sessionUnread > 0 ? "text-[var(--text-primary)] font-bold" : "text-[var(--text-tertiary)] font-medium")}>{lastMessagePreview}</p>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      };

                      if (filteredSessions.length === 0) {
                        return (
                          <p className="text-center text-[10px] text-[var(--text-tertiary)] font-semibold uppercase tracking-widest py-6">
                            Nenhuma conversa encontrada.
                          </p>
                        );
                      }

                      return (
                        <>
                          {awaitingReply.length > 0 && (
                            <div className="space-y-1.5">
                              <p className="text-[9px] font-black uppercase tracking-widest text-[var(--accent-text)] px-1 pt-1 pb-1.5 border-b border-[var(--accent)]/20">
                                Em andamento
                              </p>
                              {awaitingReply.map(renderRow)}
                            </div>
                          )}
                          {answered.length > 0 && (
                            <div className={cn("space-y-1.5", awaitingReply.length > 0 && "mt-3")}>
                              <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)] px-1 pt-1 pb-1.5 border-b border-[var(--border-default)]">
                                Respondido
                              </p>
                              {answered.map(renderRow)}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Divisória arrastável (só maximizado): redimensiona a lista de
                  conversas em andamento x a conversa aberta. Duplo clique volta
                  ao padrão; setas do teclado também ajustam. */}
              {!isCustomer && isExpanded && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Redimensionar lista de conversas"
                  aria-valuenow={chatListWidth}
                  aria-valuemin={CHAT_LIST_WIDTH_MIN}
                  aria-valuemax={CHAT_LIST_WIDTH_MAX}
                  tabIndex={0}
                  title="Arraste para redimensionar (duplo clique restaura)"
                  onPointerDown={startResizeList}
                  onDoubleClick={() => { setChatListWidth(CHAT_LIST_WIDTH_DEFAULT); saveChatListWidth(CHAT_LIST_WIDTH_DEFAULT); }}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                    e.preventDefault();
                    const next = clampChatListWidth(chatListWidth + (e.key === 'ArrowRight' ? 24 : -24));
                    setChatListWidth(next);
                    saveChatListWidth(next);
                  }}
                  style={{ touchAction: 'none' }}
                  className={cn(
                    "w-1.5 shrink-0 -ml-px cursor-col-resize transition-colors outline-none",
                    "hover:bg-[var(--accent)]/30 focus-visible:bg-[var(--accent)]/40",
                    isResizingList ? "bg-[var(--accent)]/50" : "bg-transparent"
                  )}
                />
              )}

              {/* Chat Content */}
              {/* Cliente sempre vê a área de conversa, mesmo sem selectedChatId:
                  o atendimento só é criado na primeira mensagem, então até lá
                  ele precisa de um campo de digitação (e não do vazio
                  "selecione um chat", que só faz sentido pra equipe). */}
              {(selectedChatId || isCustomer) ? (
                <div className="flex-1 flex flex-col bg-[var(--surface-card)] min-w-0">
                  {/* Chat Header */}
                  {/* Sem flex-wrap: com nome de responsável muito longo, a linha
                      quebrava e o bloco de botões (2º item da row) ia parar
                      sozinho numa segunda linha, onde justify-between o empurra
                      pra esquerda em vez de manter à direita — o dropdown do
                      AssignChatMenu, ancorado nele, abria fora do lugar. Em vez
                      disso, o bloco da esquerda ocupa o espaço disponível e o
                      texto trunca (ver truncate abaixo); os botões continuam
                      shrink-0, sempre na mesma linha, colados à direita. */}
                  <div className="px-5 py-3 bg-[var(--surface-card)] border-b border-[var(--border-default)] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {!isCustomer && !isExpanded && (
                        <button onClick={() => setSelectedChatId(null)} className="text-[var(--accent-text)] p-1.5 hover:bg-[var(--accent)]/10 rounded-xl transition-all shrink-0">
                          <ChevronDown size={18} className="rotate-90" />
                        </button>
                      )}
                      {!isCustomer && (() => {
                        const photo = selectedChatContact?.avatarUrl || getContactPhoto(selectedChat?.customerPhone, getSessionInstanceId(selectedChat));
                        return photo ? (
                          <img
                            src={photo}
                            alt={selectedChat && 'customerName' in selectedChat ? selectedChat.customerName : 'Contato'}
                            className="w-9 h-9 rounded-xl object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 bg-[var(--surface-success)] rounded-xl flex items-center justify-center text-[var(--text-success)] shrink-0">
                            <User size={16} />
                          </div>
                        );
                      })()}
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase text-[var(--text-primary)] tracking-widest leading-none mb-0.5 truncate">
                          {isCustomer ? 'Time de Suporte' : (selectedChat && 'customerName' in selectedChat ? selectedChat.customerName : 'Canal')}
                        </p>
                        {(() => {
                          // Cliente vê a presença do analista responsável (sempre
                          // um perfil logado no portal, não depende de canal);
                          // equipe vê a presença do cliente, mas só faz sentido
                          // em conversa pelo widget do portal — numa conversa por
                          // WhatsApp/Pyvon, mesmo que o telefone esteja vinculado
                          // a um perfil com presença rastreada, esse "Visto há"
                          // reflete a última atividade dele NO PORTAL, não no
                          // WhatsApp (a API do WhatsApp não expõe isso), então
                          // mostrar aqui seria enganoso.
                          const label = isCustomer
                            ? presenceLabel(selectedChat?.assigneeId)
                            : (selectedChat?.channel === 'widget' ? presenceLabel(selectedChat?.customerId) : null);
                          if (!label) return null;
                          const isOnlineNow = deriveLiveStatus(getPresence(isCustomer ? selectedChat?.assigneeId : selectedChat?.customerId)) === 'online';
                          return (
                            <p className="text-[9px] font-semibold uppercase tracking-widest flex items-center gap-1 mt-0.5">
                              <span className={cn("w-1.5 h-1.5 rounded-full", isOnlineNow ? "bg-[var(--text-success)]" : "bg-[var(--text-tertiary)]")} />
                              <span className="text-[var(--text-tertiary)] normal-case">{label}</span>
                            </p>
                          );
                        })()}
                        {selectedChat?.ticketNumber && (
                          <p className="text-[9px] text-[var(--text-tertiary)] font-semibold uppercase tracking-widest">
                            Conversa #{String(selectedChat.ticketNumber).padStart(4, '0')}
                          </p>
                        )}
                        {/* Marcadores vinculados em tempo real pelo atendente — só
                            equipe vê/edita, cliente nunca (mesmo padrão do bloco
                            Responsável logo abaixo). */}
                        {!isCustomer && selectedChat && (
                          <div className="mt-1">
                            <ChatTagPicker
                              availableTags={chatTags}
                              selectedTagIds={selectedChat.tags || []}
                              onChange={(tagIds) => handleChatTagsChange(selectedChat.id, tagIds)}
                            />
                          </div>
                        )}
                        {(() => {
                           if (isCustomer) return (
                             <span className="text-[10px] text-[var(--text-success)] font-semibold uppercase tracking-tighter">
                               Sempre disponível
                             </span>
                           );

                           const contact = selectedChatContact;
                           const company = contact ? companies.find(c => c.id === contact.companyId) : null;
                           
                           if (company) {
                             return (
                               <div className="flex items-center gap-1.5 flex-wrap">
                                 <a
                                   href={`/customers/${company.id}`}
                                   target="_blank"
                                   rel="noopener noreferrer"
                                   title="Abrir tela dedicada da empresa"
                                   className="text-[9px] text-[var(--accent-text)] font-semibold uppercase tracking-widest hover:underline"
                                 >
                                   {company.name}
                                 </a>
                                 {/* Chamados em aberto da empresa. Só aparece
                                     quando existe algum: um "0" ao lado do nome
                                     ocuparia espaço no cabeçalho pra dizer que
                                     não há nada a saber. */}
                                 {companyOpenTickets !== null && companyOpenTickets > 0 && (
                                   <a
                                     href={`/customers/${company.id}`}
                                     target="_blank"
                                     rel="noopener noreferrer"
                                     title={`${companyOpenTickets} ${companyOpenTickets === 1 ? 'chamado em aberto' : 'chamados em aberto'} nesta empresa`}
                                     className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-[var(--surface-info)] text-[var(--text-info)] hover:opacity-80 transition-opacity"
                                   >
                                     {companyOpenTickets} em aberto
                                   </a>
                                 )}
                                 {/* Só a equipe interna vê (este bloco inteiro já só
                                     renderiza quando !isCustomer) — nunca aparece pro
                                     próprio cliente/funcionário da empresa. */}
                                 {company.isInTraining && (
                                   <span
                                     title="Cliente em treinamento — visível só pra equipe interna"
                                     className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-[var(--surface-warning)] text-[var(--text-warning)]"
                                   >
                                     Em treinamento
                                   </span>
                                 )}
                               </div>
                             );
                           }

                           return (
                             <div className="flex items-center gap-2 mt-1">
                               <span className="text-[9px] text-[var(--text-tertiary)] font-semibold uppercase tracking-widest leading-none">
                                 Sem Empresa
                               </span>
                               <button 
                                 onClick={() => {
                                   if (selectedChat) {
                                      // I need a way to trigger LinkContactModal or similar
                                      // Since LinkContactModal is in chat-management/page.tsx, 
                                      // I'll add a simplified version here or expose it.
                                      // For now, let's add a local state to open a link modal.
                                      setIsLinkModalOpen(true);
                                   }
                                 }}
                                 className="text-[9px] font-semibold uppercase text-[var(--accent-text)] hover:underline px-1.5 py-0.5 bg-[var(--accent)]/10 rounded"
                               >
                                 + Vincular
                               </button>
                             </div>
                           );
                        })()}
                      </div>
                    </div>
                    
                    {!isCustomer && selectedChat && (
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <AssignChatMenu
                          currentUserId={currentUser?.id}
                          onlineTargets={getQueueOnlineTargets(selectedChat.queueId)}
                          onAssignToSelf={() => handleAssignChat(selectedChat.id)}
                          onAssignToUser={(userId) => handleAssignChat(selectedChat.id, userId)}
                          queues={queueMenuTargets}
                          currentQueueId={selectedChat.queueId}
                          onReturnToQueue={(queueId) => handleReturnToQueue(selectedChat.id, queueId)}
                          selfLabel="Assumir"
                          showSelf={selectedChat.assigneeId !== currentUser?.id}
                          variant={isExpanded ? 'full' : 'icon'}
                        />
                        <div className="flex items-center gap-1.5">
                          <div className="relative shrink-0">
                            <button
                              onClick={(e) => { e.stopPropagation(); setIsMoreActionsOpen(prev => !prev); }}
                              className="border border-[var(--border-default)] text-[var(--text-secondary)] rounded-xl p-2.5 hover:bg-[var(--surface-pill)] transition-all flex items-center"
                              title="Mais ações"
                            >
                              <MoreVertical size={14} />
                            </button>
                            {isMoreActionsOpen && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 top-full mt-2 z-20 w-56 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-xl overflow-hidden py-1"
                              >
                                <button
                                  onClick={() => { setIsMoreActionsOpen(false); setIsChatInfoModalOpen(true); }}
                                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all"
                                >
                                  <Info size={14} /> Ver informações
                                </button>
                                <button
                                  onClick={() => { setIsMoreActionsOpen(false); setIsDuplicateModalOpen(true); }}
                                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all"
                                >
                                  <Copy size={14} /> Duplicar conversa
                                </button>
                                <button
                                  onClick={() => { setIsMoreActionsOpen(false); setIsLinkTicketModalOpen(true); }}
                                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all"
                                >
                                  <Link2 size={14} /> Vincular chamado existente
                                </button>
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => {
                              const now = new Date();
                              const datePrefix = now.toLocaleDateString('pt-BR');
                              const timePrefix = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                              setTicketTitle(`Atendimento ${datePrefix} ${timePrefix}: ${selectedChat?.customerName}`);
                              setIsFinishModalOpen(true);
                            }}
                            className={cn(
                              "bg-slate-900 text-white rounded-xl text-[10px] font-semibold uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center gap-2",
                              isExpanded ? "px-4 py-2" : "p-2.5"
                            )}
                            title="Finalizar"
                          >
                            <TicketIcon size={14} /> {isExpanded && 'Finalizar'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Messages Area */}
                  <div
                    ref={scrollRef}
                    onScroll={handleScroll}
                    className="flex-1 overflow-y-auto px-4 py-4 space-y-2 bg-[var(--surface-page)] scroll-smooth"
                  >
                    {(previousHistoriesContact?.customerId || previousHistoriesContact?.customerPhone) && !(previousHistoriesOffset > 0 && previousHistoriesOffset >= previousHistoriesTotal) && (
                      <div className="flex justify-center pb-2">
                        <button
                          type="button"
                          onClick={handleLoadPreviousHistories}
                          disabled={loadingPreviousHistories}
                          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:border-[var(--accent)]/30 transition-all disabled:opacity-50"
                        >
                          {loadingPreviousHistories ? <Loader2 size={12} className="animate-spin" /> : <History size={12} />}
                          Carregar histórico anterior
                        </button>
                      </div>
                    )}

                    {previousHistories.length > 0 && (
                      <div className="space-y-2 pb-4 mb-2 border-b border-dashed border-[var(--border-default)]">
                        {[...previousHistories].reverse().map((h) => {
                          const isExpanded = expandedHistoryId === h.sessionId;
                          const isLoadingThis = loadingHistoryMessagesId === h.sessionId;
                          const loadedMessages = historyMessagesById[h.sessionId]?.messages || [];
                          const durationLabel = h.durationSeconds != null
                            ? `${Math.floor(h.durationSeconds / 60)}m ${h.durationSeconds % 60}s`
                            : null;
                          return (
                            <div key={h.id} className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden">
                              <button
                                type="button"
                                onClick={() => handleToggleHistoryMessages(h.sessionId)}
                                className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-[var(--surface-pill)] transition-colors"
                              >
                                <div className="flex items-center gap-2 min-w-0 text-[11px] font-semibold text-[var(--text-secondary)]">
                                  <History size={13} className="text-[var(--text-tertiary)] shrink-0" />
                                  <span className="truncate">
                                    Atendimento <ClientTime date={h.finishedAt} showDate showTime />
                                    {h.assigneeName ? ` · ${h.assigneeName}` : ''}
                                    {durationLabel ? ` · ${durationLabel}` : ''}
                                  </span>
                                  {h.rating === 1 && (
                                    <ThumbsUp size={11} className="text-[var(--text-success)] shrink-0" />
                                  )}
                                  {h.rating === -1 && (
                                    <ThumbsDown size={11} className="text-[var(--text-danger)] shrink-0" />
                                  )}
                                </div>
                                <ChevronRight size={14} className={cn("shrink-0 text-[var(--text-tertiary)] transition-transform", isExpanded && "rotate-90")} />
                              </button>
                              {isExpanded && (
                                <div className="px-4 py-3 border-t border-[var(--border-default)] bg-[var(--surface-pill)]/40 space-y-2 max-h-64 overflow-y-auto">
                                  {isLoadingThis ? (
                                    <div className="flex items-center justify-center py-4 text-[var(--text-tertiary)]">
                                      <Loader2 size={16} className="animate-spin" />
                                    </div>
                                  ) : loadedMessages.length === 0 ? (
                                    <p className="text-[10px] text-[var(--text-tertiary)] text-center py-2">Sem mensagens registradas.</p>
                                  ) : (
                                    loadedMessages.map(m => (
                                      <div key={m.id} className="text-[11px] leading-relaxed">
                                        <span className="font-semibold text-[var(--text-tertiary)]">{m.senderName || 'Cliente'}: </span>
                                        <span className="text-[var(--text-secondary)]">{m.text}</span>
                                      </div>
                                    ))
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {selectedChatMessageRows.map((row) => {
                      if (row.type === 'date') {
                        return (
                          <div key={row.id} className="flex items-center gap-3 py-2">
                            <div className="h-px flex-1 bg-[var(--border-default)]" />
                            <span className="text-[9px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">
                              {row.label}
                            </span>
                            <div className="h-px flex-1 bg-[var(--border-default)]" />
                          </div>
                        );
                      }

                      const m = row.message;

                      // Aviso de bastidores (ex: transferência entre
                      // analistas/fila): não é uma mensagem de conversa de
                      // verdade, então não usa a bolha normal — só uma linha
                      // pequena e discreta, centralizada, pra não competir
                      // visualmente com o que o cliente de fato disse/leu.
                      if (m.type === 'internal') {
                        return (
                          <div key={m.id} className="flex justify-center py-1 animate-in fade-in duration-300">
                            <span className="max-w-[85%] text-center text-[10px] text-[var(--text-tertiary)]">
                              {m.text}
                            </span>
                          </div>
                        );
                      }

                      const isOwnMessage = m.senderId === currentUser.id;
                      const attachments = m.attachments || m.metadata?.attachments || [];
                      // Substitui o antigo aviso avulso "Você está falando
                      // com Fulano" (ficava desatualizado assim que a
                      // conversa era transferida de novo) — agora o nome do
                      // operador aparece em cada mensagem dele, pro cliente
                      // sempre saber quem está falando naquele momento.
                      // Mesma condição já usada em outros pontos do arquivo
                      // pra identificar mensagem de analista (não é o
                      // cliente, não é aviso de sistema).
                      const isStaffSender = !!m.senderId && m.senderId !== selectedChat?.customerId && m.type !== 'system';

                      // Soft-delete: texto original nunca é apagado no banco
                      // (ver migrations/chat_messages_realtime_features.sql)
                      // — some da visualização normal, mas o time de suporte
                      // pode revelar (auditoria), diferente do cliente, que
                      // só vê "mensagem apagada".
                      if (m.isDeleted) {
                        const isRevealed = revealedDeletedIds.has(m.id);
                        return (
                          <div key={m.id} className={cn("flex flex-col animate-in fade-in duration-300", isOwnMessage ? "items-end" : "items-start")}>
                            <div className={cn(
                              "max-w-[min(88%,34rem)] sm:max-w-[78%] p-3 rounded-2xl text-[13px] font-medium italic shadow-sm border border-dashed",
                              isOwnMessage ? "border-white/30 text-[var(--text-tertiary)]" : "border-[var(--border-default)] text-[var(--text-tertiary)]"
                            )}>
                              <span className="flex items-center gap-2">
                                <Trash2 size={13} /> {isRevealed ? m.text : 'Mensagem apagada'}
                              </span>
                            </div>
                            {!isCustomer && (
                              <button
                                onClick={() => setRevealedDeletedIds(prev => {
                                  const next = new Set(prev);
                                  next.has(m.id) ? next.delete(m.id) : next.add(m.id);
                                  return next;
                                })}
                                className="text-[9px] font-semibold uppercase text-[var(--text-tertiary)] hover:text-[var(--accent-text)] mt-1 px-1"
                              >
                                {isRevealed ? 'Ocultar conteúdo' : 'Ver conteúdo apagado'}
                              </button>
                            )}
                          </div>
                        );
                      }

                      if (editingMessageId === m.id) {
                        return (
                          <div key={m.id} className={cn("flex flex-col animate-in fade-in duration-300 w-full", isOwnMessage ? "items-end" : "items-start")}>
                            <div className="max-w-[min(88%,34rem)] sm:max-w-[78%] w-full p-2.5 rounded-2xl bg-[var(--surface-card)] border-2 border-[var(--accent)] shadow-sm">
                              <textarea
                                autoFocus
                                value={editDraftText}
                                onChange={(e) => setEditDraftText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEditMessage(); }
                                  if (e.key === 'Escape') cancelEditMessage();
                                }}
                                className="w-full bg-transparent border-none outline-none text-[13px] font-medium resize-none text-[var(--text-primary)]"
                                rows={2}
                              />
                              <div className="flex items-center justify-end gap-2 mt-2">
                                <button onClick={cancelEditMessage} className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] px-2 py-1">Cancelar</button>
                                <button onClick={saveEditMessage} className="text-[10px] font-semibold uppercase text-white bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg px-3 py-1.5">Salvar</button>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div key={m.id} id={`chat-msg-${m.id}`} className={cn("flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300 group rounded-2xl", isOwnMessage ? "items-end" : "items-start")}>
                          <div className={cn(
                            "relative max-w-[min(88%,34rem)] sm:max-w-[78%] p-3 rounded-2xl text-[13px] font-medium shadow-sm transition-all break-words whitespace-pre-wrap",
                            isOwnMessage
                              ? "bg-[var(--accent)] text-white rounded-tr-none"
                              : "bg-[var(--surface-card)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-tl-none"
                          )}>
                            {isStaffSender && !isOwnMessage && (
                              <p className="text-[10px] font-black uppercase tracking-wide mb-1 text-[var(--accent-text)]">
                                {m.senderName}:
                              </p>
                            )}
                            {/* Citação ("responder" do WhatsApp): trecho da mensagem
                                original acima do texto; clicar leva até ela. */}
                            {m.metadata?.replyTo && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Citação sem vínculo (o cliente citou algo que não está
                                  // no nosso banco, ex.: um template): só mostra o trecho.
                                  const quotedId = m.metadata?.replyTo?.messageId;
                                  if (!quotedId) return;
                                  const target = document.getElementById(`chat-msg-${quotedId}`);
                                  if (!target) {
                                    toast.info('A mensagem original não está carregada nesta conversa.');
                                    return;
                                  }
                                  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                  target.classList.add('bg-[var(--accent)]/15');
                                  setTimeout(() => target.classList.remove('bg-[var(--accent)]/15'), 1600);
                                }}
                                className={cn(
                                  "mb-2 block w-full whitespace-normal rounded-xl border-l-4 px-3 py-1.5 text-left",
                                  isOwnMessage ? "border-white/60 bg-black/15" : "border-[var(--accent)] bg-[var(--surface-pill)]"
                                )}
                              >
                                <span className={cn("block text-[10px] font-black uppercase tracking-wide truncate", isOwnMessage ? "text-white/90" : "text-[var(--accent-text)]")}>
                                  {m.metadata.replyTo.senderName || 'Mensagem'}
                                </span>
                                <span className={cn("block text-[11px] font-medium line-clamp-2 break-words", isOwnMessage ? "text-white/80" : "text-[var(--text-secondary)]")}>
                                  {m.metadata.replyTo.text
                                    || ({ image: 'Imagem', audio: 'Áudio', video: 'Vídeo', file: 'Arquivo', text: 'Mensagem' } as Record<string, string>)[m.metadata.replyTo.kind || 'text']}
                                </span>
                              </button>
                            )}
                            {renderLinkedText(m.text, isOwnMessage, isCustomer ? undefined : (phone) => setPhoneContactPanelPhone(phone))}
                            {attachments.length > 0 && (
                              <div className="mt-3 space-y-2 whitespace-normal">
                                {attachments.map((attachment: Attachment) => {
                                  const attachmentKey = attachment.id || attachment.url;
                                  const isImage = isImageAttachment(attachment);
                                  const attachmentClassName = cn(
                                    "block w-full overflow-hidden rounded-xl border text-left transition-all",
                                    isOwnMessage ? "border-white/20 bg-white/10 hover:bg-white/15" : "border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-pill)]"
                                  );

                                  if (isImage) {
                                    return (
                                      <button
                                        key={attachmentKey}
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setPreviewAttachment(attachment);
                                        }}
                                        className={attachmentClassName}
                                      >
                                        {/* Só a imagem: sem legenda com o nome do arquivo
                                            (pedido do usuário, 2026-09-24). */}
                                        <img
                                          src={attachment.url}
                                          alt={attachment.name}
                                          className="max-h-48 w-full object-cover"
                                        />
                                      </button>
                                    );
                                  }

                                  if (isAudioAttachment(attachment)) {
                                    const transcribeKey = `${m.id}:${attachment.id}`;
                                    const isTranscribing = transcribingIds.has(transcribeKey);
                                    const isRevealed = revealedTranscriptions.has(transcribeKey);
                                    return (
                                      <div key={attachmentKey} className="space-y-1.5">
                                        <AudioPlayer
                                          src={attachment.url}
                                          name={attachment.name}
                                          isOwnMessage={isOwnMessage}
                                        />
                                        {attachment.transcription && isRevealed ? (
                                          <p className={cn(
                                            "text-xs italic leading-snug px-1",
                                            isOwnMessage ? "text-white/70" : "text-[var(--text-tertiary)]"
                                          )}>
                                            &quot;{attachment.transcription}&quot;
                                          </p>
                                        ) : (
                                          process.env.NEXT_PUBLIC_ENABLE_AUDIO_TRANSCRIPTION === 'true' && attachment.id && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                if (attachment.transcription) {
                                                  // Já transcrito em segundo plano — só revela, sem chamar a API de novo.
                                                  setRevealedTranscriptions(prev => new Set(prev).add(transcribeKey));
                                                } else {
                                                  handleTranscribeAudio(selectedChat!.id, m.id, attachment.id!);
                                                }
                                              }}
                                              disabled={isTranscribing}
                                              className={cn(
                                                "flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest px-1 py-0.5 rounded transition-all disabled:opacity-60",
                                                isOwnMessage ? "text-white/70 hover:text-white" : "text-[var(--text-tertiary)] hover:text-[var(--accent-text)]"
                                              )}
                                            >
                                              {isTranscribing ? (
                                                <Loader2 size={12} className="animate-spin" />
                                              ) : (
                                                <Captions size={12} />
                                              )}
                                              {isTranscribing ? 'Transcrevendo...' : attachment.transcription ? 'Ver transcrição' : 'Transcrever'}
                                            </button>
                                          )
                                        )}
                                      </div>
                                    );
                                  }

                                  if (isVideoAttachment(attachment)) {
                                    return (
                                      <video
                                        key={attachmentKey}
                                        src={attachment.url}
                                        controls
                                        preload="metadata"
                                        className="max-h-64 w-full rounded-xl bg-black"
                                      />
                                    );
                                  }

                                  return (
                                    <a
                                      key={attachmentKey}
                                      href={attachment.url}
                                      download={attachment.name}
                                      onClick={(event) => event.stopPropagation()}
                                      className={attachmentClassName}
                                    >
                                      <div className="flex items-center gap-3 p-3">
                                        <File size={16} className="shrink-0" />
                                        <div className="min-w-0">
                                          <p className="truncate text-xs font-black">{attachment.name}</p>
                                          <p className={cn("text-[9px] font-bold uppercase", isOwnMessage ? "text-white/70" : "text-[var(--text-tertiary)]")}>
                                            {attachment.size ? `${Math.ceil(attachment.size / 1024)} KB` : 'Arquivo'}
                                          </p>
                                        </div>
                                      </div>
                                    </a>
                                  );
                                })}
                              </div>
                            )}

                            <div className={cn(
                              "absolute -top-4 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap bg-[var(--surface-card)] border border-[var(--border-default)] rounded-full px-2 py-1 shadow-sm",
                              isOwnMessage ? "right-2" : "left-2"
                            )}>
                              {canQuoteMessage(m) && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setReplyingTo(m); }}
                                  className="flex items-center gap-1 text-[9px] font-semibold uppercase text-[var(--accent-text)]"
                                  title="Citar esta mensagem na resposta"
                                >
                                  <Reply size={10} /> Responder
                                </button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); setReactionPickerMessageId(reactionPickerMessageId === m.id ? null : m.id); }}
                                className="text-[9px] font-semibold uppercase text-[var(--text-tertiary)] hover:text-[var(--accent-text)]"
                              >
                                Reagir
                              </button>
                              {isOwnMessage && m.type === 'text' && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); startEditMessage(m); }}
                                  className="text-[9px] font-semibold uppercase text-[var(--accent-text)]"
                                >
                                  Editar
                                </button>
                              )}
                              {isOwnMessage && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); deleteChatMessage(m); }}
                                  className="text-[9px] font-semibold uppercase text-[var(--text-danger)]"
                                >
                                  Excluir
                                </button>
                              )}
                            </div>

                            {reactionPickerMessageId === m.id && (
                              <div
                                className={cn(
                                  "absolute -top-14 z-20 flex items-center gap-1 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-full shadow-xl px-2 py-1.5",
                                  isOwnMessage ? "right-0" : "left-0"
                                )}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {QUICK_REACTION_EMOJIS.map(emoji => (
                                  <button key={emoji} onClick={() => toggleMessageReaction(m.id, emoji)} className="text-base hover:scale-125 transition-transform">
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <span className="flex items-center gap-1.5 text-[9px] text-[var(--text-tertiary)] font-semibold uppercase mt-1 px-1 tracking-widest">
                            <ClientTime date={m.timestamp} />
                            {m.isEdited && !isCustomer && (
                              <button onClick={() => openMessageHistory(m.id)} className="hover:text-[var(--accent-text)] lowercase italic">
                                (editado)
                              </button>
                            )}
                            {/* Canal Pyvon: o Pyvon não informa "lida", então o status
                                é só enviando (1 tique) → enviada (2 tiques) → ou erro
                                (ver abaixo). Os tiques de "entregue/lida" do portal só
                                fazem sentido pros outros canais (mais adiante). */}
                            {isOwnMessage && selectedChat?.channel === 'pyvon' && pyvonTickState(m) === 'sending' && (
                              <span className="flex items-center text-[var(--text-tertiary)]" title="Enviando pelo WhatsApp...">
                                <Check size={12} />
                              </span>
                            )}
                            {isOwnMessage && selectedChat?.channel === 'pyvon' && pyvonTickState(m) === 'sent' && (
                              <span className="flex items-center text-[var(--text-tertiary)]" title="Enviada pelo WhatsApp (o Pyvon não informa leitura)">
                                <CheckCheck size={12} />
                              </span>
                            )}
                            {isOwnMessage && selectedChat?.channel !== 'pyvon' && m.whatsappStatus === 'sending' && (
                              <span className="flex items-center gap-1 text-[var(--text-tertiary)]" title="Enviando pelo WhatsApp...">
                                <Loader2 size={11} className="animate-spin" /> enviando
                              </span>
                            )}
                            {isOwnMessage && m.whatsappStatus === 'failed' && (
                              <span className="flex items-center gap-1">
                                <span
                                  className="flex items-center gap-1 text-[var(--text-danger)] cursor-default"
                                  title={m.whatsappError ? `Não enviada pelo WhatsApp: ${m.whatsappError}` : 'Não enviada pelo WhatsApp'}
                                >
                                  <AlertCircle size={11} /> não enviada
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleResendWhatsAppMessage(m); }}
                                  className="flex items-center gap-0.5 text-[var(--accent-text)] hover:underline normal-case"
                                  title="Tentar enviar de novo"
                                >
                                  <RotateCw size={10} /> reenviar
                                </button>
                              </span>
                            )}
                            {isOwnMessage && selectedChat?.channel !== 'pyvon' && (!m.whatsappStatus || m.whatsappStatus === 'sent') && (() => {
                              // Sessão de chat com cliente é sempre 1:1 (cliente
                              // + analista responsável) — só esses dois contam
                              // como "destinatário" pro 2o/3o check.
                              const otherIds = [selectedChat?.customerId, selectedChat?.assigneeId]
                                .filter((id): id is string => !!id && id !== m.senderId);
                              const deliveredCount = otherIds.filter(id => m.deliveredBy?.includes(id)).length;
                              const readCount = otherIds.filter(id => m.readBy?.includes(id)).length;
                              if (otherIds.length > 0 && readCount > 0) {
                                return <CheckCheck size={12} className="text-[var(--text-info)]" />;
                              }
                              if (deliveredCount > 0) {
                                return <CheckCheck size={12} className="text-[var(--text-tertiary)]" />;
                              }
                              return <Check size={12} className="text-[var(--text-tertiary)]" />;
                            })()}
                          </span>

                          {!!m.reactions?.length && (
                            <div className={cn("flex flex-wrap gap-1 mt-1", isOwnMessage ? "justify-end" : "justify-start")}>
                              {Object.entries(
                                m.reactions.reduce<Record<string, number>>((acc, r) => {
                                  acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                                  return acc;
                                }, {})
                              ).map(([emoji, count]) => {
                                const reactedByMe = m.reactions!.some(r => r.emoji === emoji && r.userId === currentUser?.id);
                                return (
                                  <button
                                    key={emoji}
                                    onClick={() => toggleMessageReaction(m.id, emoji)}
                                    className={cn(
                                      "flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border transition-colors",
                                      reactedByMe
                                        ? "bg-[var(--accent)]/15 border-[var(--accent)]/40 text-[var(--accent-text)]"
                                        : "bg-[var(--surface-card)] border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--accent)]/30"
                                    )}
                                  >
                                    <span>{emoji}</span>
                                    {count > 1 && <span>{count}</span>}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {typingUserName && (
                      <div className="flex flex-col items-start animate-in fade-in duration-300">
                        <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl rounded-tl-none px-3.5 py-2.5 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-tertiary)] animate-bounce [animation-delay:-0.3s]" />
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-tertiary)] animate-bounce [animation-delay:-0.15s]" />
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-tertiary)] animate-bounce" />
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Input Area */}
                  <div
                    className="p-4 bg-[var(--surface-card)] border-t border-[var(--border-default)] relative shrink-0"
                    style={isMobileFullScreen ? { paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' } : undefined}
                  >
                    <AnimatePresence>
                      {showNewMessageIndicator && (
                        <motion.button 
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 20 }}
                          onClick={scrollToBottom}
                          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-10 bg-[var(--accent)] text-white px-5 py-2.5 rounded-full shadow-2xl shadow-indigo-200 text-[10px] font-semibold uppercase tracking-widest flex items-center gap-2 hover:bg-[var(--accent-hover)] transition-all z-20 group border-2 border-white"
                        >
                          <ChevronUp size={14} className="group-hover:-translate-y-0.5 transition-transform" />
                          Nova Mensagem
                          <div className="w-1.5 h-1.5 bg-[var(--surface-card)] rounded-full animate-ping" />
                        </motion.button>
                      )}

                    </AnimatePresence>
                    {isQuickRepliesOpen && !isCustomer && (
                      <QuickRepliesPanel
                        notes={quickNotes}
                        onSelect={insertQuickReply}
                        onCreate={createQuickReply}
                        onClose={() => { setIsQuickRepliesOpen(false); messageInputRef.current?.focus(); }}
                      />
                    )}
                    {replyingTo && canQuoteMessage(replyingTo) && (
                      <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-pill)] p-3 animate-in slide-in-from-bottom-2">
                        <div className="min-w-0 flex-1 border-l-4 border-[var(--accent)] pl-3">
                          <p className="truncate text-[10px] font-black uppercase tracking-wide text-[var(--accent-text)]">
                            Respondendo a {replyingTo.senderId === currentUser?.id ? 'você' : replyingTo.senderName}
                          </p>
                          <p className="mt-0.5 line-clamp-2 break-words text-xs font-medium text-[var(--text-secondary)]">
                            {(replyingTo.text || '').trim() || (
                              (replyingTo.attachments?.[0] || replyingTo.metadata?.attachments?.[0])
                                ? 'Anexo'
                                : 'Mensagem'
                            )}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setReplyingTo(null)}
                          className="shrink-0 rounded-xl p-2 text-[var(--text-tertiary)] transition-all hover:bg-[var(--border-default)]"
                          title="Cancelar resposta"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    )}
                    {chatAttachments.length > 0 && (
                      <div className="mb-3 flex flex-wrap gap-2">
                        {chatAttachments.map((attachment) => (
                          isAudioAttachment(attachment) ? (
                            <div key={attachment.id} className="flex w-full items-center gap-2">
                              <div className="flex-1 min-w-0">
                                <AudioPlayer src={attachment.url} name={attachment.name} />
                              </div>
                              <button
                                type="button"
                                onClick={() => setChatAttachments(prev => prev.filter(item => item.id !== attachment.id))}
                                className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-danger)] p-1"
                                title="Descartar áudio"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          ) : (
                            <div key={attachment.id} className="flex max-w-full items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-xs font-bold text-[var(--text-secondary)]">
                              {isImageAttachment(attachment) ? <ImageIcon size={14} className="text-[var(--accent-text)]" /> : <File size={14} className="text-[var(--text-tertiary)]" />}
                              <span className="max-w-[180px] truncate">{attachment.name}</span>
                              <button
                                type="button"
                                onClick={() => setChatAttachments(prev => prev.filter(item => item.id !== attachment.id))}
                                className="text-[var(--text-tertiary)] hover:text-[var(--text-danger)]"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          )
                        ))}
                      </div>
                    )}
                    {isRecording ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={cancelRecording}
                          className="w-11 h-11 shrink-0 bg-[var(--surface-pill)] text-[var(--text-tertiary)] rounded-2xl hover:bg-[var(--surface-danger)] hover:text-[var(--text-danger)] transition-all flex items-center justify-center"
                          title="Cancelar gravação"
                        >
                          <Trash2 size={17} />
                        </button>
                        <div className="flex-1 min-w-0 flex items-center gap-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-[var(--text-danger)] animate-pulse shrink-0" />
                          <span className="text-sm font-bold text-[var(--text-secondary)] tabular-nums shrink-0">
                            {Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, '0')}
                          </span>
                          <span className="text-xs text-[var(--text-tertiary)] font-medium truncate hidden sm:inline">Gravando áudio...</span>
                        </div>
                        <button
                          type="button"
                          onClick={stopRecordingAndAttach}
                          className="w-11 h-11 shrink-0 bg-[var(--accent)] text-white rounded-2xl hover:bg-[var(--accent-hover)] transition-all shadow-sm flex items-center justify-center"
                          title="Parar e anexar"
                        >
                          <Square size={16} fill="currentColor" />
                        </button>
                      </div>
                    ) : (
                    <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }} className="flex items-center gap-2">
                      <input
                        ref={chatFileInputRef}
                        type="file"
                        multiple
                        onChange={handleChatFileUpload}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => chatFileInputRef.current?.click()}
                        className="w-11 h-11 shrink-0 bg-[var(--surface-pill)] text-[var(--text-tertiary)] rounded-2xl hover:bg-[var(--border-default)] hover:text-[var(--accent-text)] transition-all flex items-center justify-center"
                        title="Anexar arquivo"
                      >
                        <Paperclip size={17} />
                      </button>
                      <button
                        type="button"
                        onClick={startRecording}
                        className="w-11 h-11 shrink-0 bg-[var(--surface-pill)] text-[var(--text-tertiary)] rounded-2xl hover:bg-[var(--border-default)] hover:text-[var(--accent-text)] transition-all flex items-center justify-center"
                        title="Gravar áudio"
                      >
                        <Mic size={17} />
                      </button>
                      {!isCustomer && (
                        <button
                          type="button"
                          onClick={() => setIsQuickRepliesOpen(open => !open)}
                          className={cn(
                            "w-11 h-11 shrink-0 rounded-2xl transition-all flex items-center justify-center",
                            isQuickRepliesOpen
                              ? "bg-[var(--accent)] text-white"
                              : "bg-[var(--surface-pill)] text-[var(--text-tertiary)] hover:bg-[var(--border-default)] hover:text-[var(--accent-text)]"
                          )}
                          title="Respostas prontas"
                          aria-expanded={isQuickRepliesOpen}
                        >
                          <MessageSquareText size={17} />
                        </button>
                      )}
                      <textarea
                        ref={setComposerRef}
                        rows={1}
                        value={message}
                        onChange={handleInputChange}
                        onPaste={handleChatPaste}
                        onKeyDown={(e) => {
                          // Enter sozinho envia (textarea não submete o form
                          // sozinho como <input> fazia); Shift+Enter quebra
                          // linha normalmente.
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        placeholder="Digite uma mensagem..."
                        className="flex-1 min-w-0 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3.5 text-sm font-medium focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all resize-none leading-relaxed placeholder:font-normal placeholder:text-[var(--text-tertiary)] placeholder:whitespace-nowrap"
                      />
                      <button
                        type="submit"
                        disabled={!message.trim() && chatAttachments.length === 0}
                        className="w-11 h-11 shrink-0 bg-[var(--accent)] text-white rounded-2xl hover:bg-[var(--accent-hover)] transition-all shadow-sm flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Send size={17} />
                      </button>
                    </form>
                    )}
                  </div>
                </div>
              ) : (!isMobileFullScreen && isExpanded) ? (
                // Mesmo raciocínio do mobile (ver comentário que existia
                // aqui): a Sidebar também ocupa 100% da largura no desktop
                // quando o widget não está expandido (w-full em vez de
                // w-[350px] — ver condição da Sidebar acima), então esse
                // placeholder só faz sentido quando `isExpanded` é o layout
                // de duas colunas de verdade. Sem o `isExpanded` aqui, este
                // bloco virava um segundo item flex ao lado da lista cheia e
                // era espremido a quase 0px — na prática nunca aparecia.
                <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-[var(--surface-card)]/50">
                   <div className="w-20 h-20 bg-[var(--accent)]/10 rounded-[2rem] flex items-center justify-center text-[var(--accent-text)] mb-6">
                      <MessageCircle size={40} />
                   </div>
                   <h4 className="text-lg font-black text-[var(--text-primary)] uppercase tracking-tight mb-2">Selecione um Chat</h4>
                   <p className="text-sm text-[var(--text-tertiary)] font-medium max-w-xs">Escolha uma conversa lateral ou inicie um novo atendimento via WhatsApp.</p>
                </div>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attachment Preview */}
      <AttachmentPreviewModal attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />

      {/* Histórico de edição de mensagem */}
      {createPortal(
        <AnimatePresence>
          {messageHistoryFor && (
            <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 2147483647 }}>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMessageHistoryFor(null)}
                className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
              />
              <motion.div
                initial={{ scale: 0.96, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.96, opacity: 0 }}
                className="relative w-full max-w-md max-h-[80vh] flex flex-col rounded-3xl bg-[var(--surface-card)] shadow-2xl overflow-hidden"
              >
                <div className="flex items-center justify-between gap-3 border-b border-[var(--border-default)] px-5 py-4">
                  <p className="text-sm font-black text-[var(--text-primary)] uppercase tracking-widest">Histórico de edições</p>
                  <button onClick={() => setMessageHistoryFor(null)} className="p-2 hover:bg-[var(--surface-pill)] rounded-xl">
                    <X size={16} className="text-[var(--text-tertiary)]" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                  {messageHistoryEntries.length === 0 ? (
                    <p className="text-xs text-[var(--text-tertiary)] font-medium text-center py-6">Sem versões anteriores registradas.</p>
                  ) : messageHistoryEntries.map((entry, idx) => (
                    <div key={idx} className="p-3 rounded-2xl border border-[var(--border-default)]">
                      <p className="text-sm text-[var(--text-secondary)] font-medium">{entry.previousText}</p>
                      <p className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] mt-2">
                        {entry.editedByName || 'Alguém'} · <ClientTime date={entry.editedAt} />
                      </p>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* New Chat Modal */}
      <AnimatePresence>
        {isNewChatModalOpen && (
          <div className="fixed inset-0 z-[250] flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsNewChatModalOpen(false)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative bg-[var(--surface-card)] w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 max-h-[80vh] overflow-y-auto">
                <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight mb-2">Novo WhatsApp</h3>
                <p className="text-xs text-[var(--text-tertiary)] font-medium mb-6">Inicie uma conversa manual ou busque um cliente cadastrado.</p>

                <div className="space-y-4">
                   <div className="space-y-1.5 relative">
                      <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Buscar Cliente ou Funcionário</label>
                      <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={16} />
                        <input 
                          type="text" 
                          value={customerSearch}
                          onChange={(e) => setCustomerSearch(e.target.value)}
                          placeholder="Digite nome da empresa ou contato..." 
                          className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl pl-12 pr-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all" 
                        />
                      </div>
                      
                      {searchResults.length > 0 && (
                        <div className="absolute top-full left-0 right-0 z-10 mt-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-xl overflow-hidden max-h-48 overflow-y-auto animate-in fade-in slide-in-from-top-2">
                          {searchResults.map(res => (
                            <button 
                              key={`${res.type}-${res.id}`}
                              onClick={() => selectCustomer(res)}
                              className="w-full px-4 py-3 flex items-center justify-between hover:bg-[var(--accent)]/10 transition-all border-b border-[var(--border-default)] last:border-0"
                            >
                              <div className="flex items-center gap-3">
                                <div className={cn(
                                  "w-8 h-8 rounded-lg flex items-center justify-center",
                                  res.type === 'company' ? "bg-[var(--surface-warning)] text-[var(--text-warning)]" : "bg-[var(--accent)]/20 text-[var(--accent-text)]"
                                )}>
                                  {res.type === 'company' ? <LayoutGrid size={14} /> : <User size={14} />}
                                </div>
                                <div className="text-left flex-1 min-w-0">
                                  <p className="text-[11px] font-semibold uppercase text-[var(--text-primary)] leading-none mb-1 truncate">{res.name}</p>
                                  <div className="flex items-center gap-2">
                                    <p className="text-[9px] text-[var(--text-tertiary)] font-bold uppercase whitespace-nowrap">
                                      {res.type === 'company' ? 'Empresa' : `Funcionário • ${res.companyName || 'S/ Empresa'}`}
                                    </p>
                                  </div>
                                </div>
                              </div>
                              {res.phone && (
                                <div className="text-right">
                                  <span className="text-[10px] font-black text-[var(--accent-text)] block">{res.phone}</span>
                                  <span className="text-[8px] text-[var(--text-tertiary)] font-semibold uppercase">WhatsApp</span>
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                   </div>

                   <div className="flex items-center gap-4 py-2">
                     <div className="flex-1 h-px bg-[var(--surface-pill)]" />
                     <span className="text-[10px] font-semibold text-slate-300 uppercase tracking-widest">ou manual</span>
                     <div className="flex-1 h-px bg-[var(--surface-pill)]" />
                   </div>

                   <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-1.5">
                        <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Número</label>
                        <input 
                          type="tel" 
                          value={newChatNumber} 
                          onChange={e => setNewChatNumber(e.target.value)} 
                          placeholder="Ex: 11999999999" 
                          className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none" 
                        />
                     </div>
                     <div className="space-y-1.5">
                        <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Nome</label>
                        <input 
                          type="text" 
                          value={newChatName} 
                          onChange={e => setNewChatName(e.target.value)} 
                          placeholder="Identificação" 
                          className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none" 
                        />
                     </div>
                   </div>

                   {/* Transparência da janela de 24h (canal Pyvon) — nunca
                       decide nada aqui, só antecipa o que o servidor vai
                       decidir ao clicar (ver handleStartNewChat). */}
                   {newChatWindowStatus !== 'unknown' && (
                     <div className={cn(
                       "flex items-start gap-2.5 p-3.5 rounded-2xl text-xs font-semibold leading-snug",
                       newChatWindowStatus === 'checking' && "bg-[var(--surface-pill)] text-[var(--text-tertiary)]",
                       newChatWindowStatus === 'open' && "bg-[var(--surface-success)] text-[var(--text-success)]",
                       newChatWindowStatus === 'closed' && "bg-[var(--surface-warning)] text-[var(--text-warning)]"
                     )}>
                       {newChatWindowStatus === 'checking' && <Loader2 size={15} className="shrink-0 mt-0.5 animate-spin" />}
                       {newChatWindowStatus === 'open' && <CheckCircle2 size={15} className="shrink-0 mt-0.5" />}
                       {newChatWindowStatus === 'closed' && <Clock size={15} className="shrink-0 mt-0.5" />}
                       <span>
                         {newChatWindowStatus === 'checking' && 'Verificando se este contato já respondeu nas últimas 24h...'}
                         {newChatWindowStatus === 'open' && 'Dentro da janela de 24h — a conversa abre normal, sem template.'}
                         {newChatWindowStatus === 'closed' && 'Fora da janela de 24h (ou contato novo) — vamos enviar a mensagem inicial do modelo aprovado ("contato_pos_vendas") pra poder falar com ele.'}
                       </span>
                     </div>
                   )}

                   <button
                     onClick={handleStartNewChat}
                     disabled={!newChatNumber || isStartingNewChat}
                     className="w-full mt-4 py-4 bg-[var(--accent)] text-white rounded-2xl text-[11px] font-semibold uppercase tracking-widest shadow-xl shadow-indigo-100 hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                   >
                     {isStartingNewChat && <Loader2 size={14} className="animate-spin" />}
                     {newChatWindowStatus === 'closed' ? 'Enviar Mensagem e Abrir Conversa' : 'Iniciar Conversa'}
                   </button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Finish Chat Modal */}
      <AnimatePresence>
        {isFinishModalOpen && (
          <div className="fixed inset-0 z-[250] flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !finishingAction && setIsFinishModalOpen(false)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative bg-[var(--surface-card)] w-full max-w-sm rounded-[2.5rem] shadow-2xl p-8">
                {selectedChat?.ticketId ? (
                  <>
                    {/* Já existe um chamado desta conversa: só ela é encerrada, sem
                        gerar outro. Quem ainda não gerou o chamado vê o modal de
                        sempre (abaixo) — e gerar pelo botão "Gerar Chamado", que
                        mantém o chat aberto, é o que libera este encerramento. */}
                    <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight mb-2">Finalizar Conversa</h3>
                    <p className="text-xs text-[var(--text-tertiary)] font-medium mb-6">
                      Esta conversa já possui o chamado{' '}
                      <span className="font-black text-[var(--text-primary)]">
                        {selectedChat.ticketNumber ? `#${String(selectedChat.ticketNumber).padStart(4, '0')}` : ''}
                      </span>{' '}
                      vinculado. Ela será encerrada sem gerar outro chamado.
                    </p>

                    <div className="space-y-4">
                      <button
                        onClick={() => handleGenerateTicket(true)}
                        disabled={!!finishingAction}
                        className="w-full py-4 bg-slate-900 text-white rounded-2xl text-[11px] font-semibold uppercase tracking-widest shadow-xl hover:bg-slate-800 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {finishingAction === 'finish' && <Loader2 size={14} className="animate-spin" />}
                        {finishingAction === 'finish' ? 'Finalizando...' : 'Finalizar Conversa'}
                      </button>
                      <p className="text-[9px] text-[var(--text-tertiary)] font-medium text-center -mt-2">Envia a mensagem de encerramento ao cliente. O chamado não é alterado.</p>

                      {hasPermission(Permission.CHAT_MARK_SPAM) && (
                        <>
                          <button
                            onClick={() => handleGenerateTicket(true, true)}
                            disabled={!!finishingAction}
                            className="w-full py-3.5 bg-[var(--surface-card)] border-2 border-[var(--text-danger)]/20 text-[var(--text-danger)] rounded-2xl text-[10px] font-semibold uppercase tracking-widest hover:bg-[var(--surface-danger)] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                          >
                            {finishingAction === 'spam' && <Loader2 size={14} className="animate-spin" />}
                            {finishingAction === 'spam' ? 'Fechando...' : 'Fechar como Spam'}
                          </button>
                          <p className="text-[9px] text-[var(--text-tertiary)] font-medium text-center -mt-2">Encerra sem enviar nenhuma mensagem ao cliente — use quando um bot dele responder automaticamente à pesquisa e reabrir o chat em loop.</p>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                <>
                <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight mb-2">Gerar Chamado</h3>
                <p className="text-xs text-[var(--text-tertiary)] font-medium mb-6">Transforme esta conversa em um chamado para Histórico.</p>

                <div className="space-y-4">
                   <div className="space-y-1.5">
                      <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Título do Chamado</label>
                      <input
                        type="text"
                        value={ticketTitle}
                        onChange={e => setTicketTitle(e.target.value)}
                        placeholder="Ex: Suporte técnico - Erro no login"
                        className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none"
                      />
                   </div>

                   <label className="flex items-center gap-3 p-4 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl cursor-pointer hover:bg-[var(--surface-pill)] transition-all">
                      <input
                        type="checkbox"
                        checked={closeTicketImmediately}
                        onChange={e => setCloseTicketImmediately(e.target.checked)}
                        className="w-5 h-5 rounded-lg border-[var(--border-default)] text-[var(--accent-text)] focus:ring-[var(--accent)]"
                      />
                      <div className="flex flex-col">
                         <span className="text-xs font-black uppercase text-[var(--text-secondary)] tracking-tight">Fechar Imediatamente</span>
                         <span className="text-[9px] text-[var(--text-tertiary)] font-medium">O chamado será criado com status &quot;Fechado&quot;</span>
                      </div>
                   </label>

                   <button
                     onClick={() => handleGenerateTicket(false)}
                     disabled={!!finishingAction}
                     className="w-full mt-2 py-4 bg-[var(--surface-card)] border-2 border-[var(--border-default)] text-[var(--text-primary)] rounded-2xl text-[11px] font-semibold uppercase tracking-widest hover:border-[var(--accent)]/40 hover:bg-[var(--surface-pill)] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                   >
                     {finishingAction === 'generate' && <Loader2 size={14} className="animate-spin" />}
                     {finishingAction === 'generate' ? 'Gerando chamado...' : 'Gerar Chamado'}
                   </button>
                   <p className="text-[9px] text-[var(--text-tertiary)] font-medium text-center -mt-2">O chat continua aberto, sem enviar mensagem de encerramento.</p>

                   <button
                     onClick={() => handleGenerateTicket(true)}
                     disabled={!!finishingAction}
                     className="w-full py-4 bg-slate-900 text-white rounded-2xl text-[11px] font-semibold uppercase tracking-widest shadow-xl hover:bg-slate-800 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                   >
                     {finishingAction === 'finish' && <Loader2 size={14} className="animate-spin" />}
                     {finishingAction === 'finish' ? 'Finalizando...' : 'Gerar Chamado & Finalizar'}
                   </button>

                   {hasPermission(Permission.CHAT_MARK_SPAM) && (
                     <>
                       <button
                         onClick={() => handleGenerateTicket(true, true)}
                         disabled={!!finishingAction}
                         className="w-full py-3.5 bg-[var(--surface-card)] border-2 border-[var(--text-danger)]/20 text-[var(--text-danger)] rounded-2xl text-[10px] font-semibold uppercase tracking-widest hover:bg-[var(--surface-danger)] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                       >
                         {finishingAction === 'spam' && <Loader2 size={14} className="animate-spin" />}
                         {finishingAction === 'spam' ? 'Fechando...' : 'Fechar como Spam'}
                       </button>
                       <p className="text-[9px] text-[var(--text-tertiary)] font-medium text-center -mt-2">Gera o chamado e encerra, mas não envia nenhuma mensagem ao cliente — use quando um bot dele responder automaticamente à pesquisa e reabrir o chat em loop.</p>
                     </>
                   )}
                </div>
                </>
                )}
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isChatInfoModalOpen && selectedChat && (
          <div className="fixed inset-0 z-[250] flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsChatInfoModalOpen(false)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative bg-[var(--surface-card)] w-full max-w-sm rounded-[2.5rem] shadow-2xl p-8">
                <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight mb-6">Informações da conversa</h3>
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] mb-1">Telefone</p>
                    <p className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                      <Phone size={13} className="text-[var(--text-tertiary)] shrink-0" />
                      {selectedChat.customerPhone ? formatPhoneDisplay(selectedChat.customerPhone) : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] mb-1">Meio de contato</p>
                    <p className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                      <MessageCircle size={13} className="text-[var(--text-tertiary)] shrink-0" />
                      {getChannelLabel(selectedChat.channel) || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] mb-1">Responsável</p>
                    <p className={cn(
                      "text-sm font-black flex items-center gap-2",
                      selectedChat.assigneeId ? "text-[var(--accent-text)]" : "text-[var(--text-warning-strong)]"
                    )}>
                      <User size={13} className="shrink-0" />
                      {selectedChat.assigneeId
                        ? (allUsers.find(u => u.id === selectedChat.assigneeId)?.name || 'Carregando...')
                        : 'Não atribuído'}
                    </p>
                  </div>
                  {/* Só faz sentido em conversa pelo widget do portal — a API
                      do WhatsApp não expõe "visto por último", e mesmo que o
                      telefone esteja vinculado a um perfil com presença
                      rastreada, mostrar aqui numa conversa por WhatsApp/Pyvon
                      seria enganoso (refletiria atividade no portal, não no
                      WhatsApp). */}
                  {selectedChat.channel === 'widget' && presenceLabel(selectedChat.customerId) && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] mb-1">Presença</p>
                      <p className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <span className={cn(
                          "w-2 h-2 rounded-full shrink-0",
                          deriveLiveStatus(getPresence(selectedChat.customerId)) === 'online' ? "bg-[var(--text-success)]" : "bg-[var(--text-tertiary)]"
                        )} />
                        {presenceLabel(selectedChat.customerId)}
                      </p>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setIsChatInfoModalOpen(false)}
                  className="w-full mt-8 py-3.5 bg-[var(--surface-card)] border-2 border-[var(--border-default)] text-[var(--text-secondary)] rounded-2xl text-[10px] font-semibold uppercase tracking-widest hover:bg-[var(--surface-pill)] transition-all"
                >
                  Fechar
                </button>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isDuplicateModalOpen && (
          <div className="fixed inset-0 z-[250] flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !isDuplicatingChat && setIsDuplicateModalOpen(false)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative bg-[var(--surface-card)] w-full max-w-sm rounded-[2.5rem] shadow-2xl p-8">
                <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight mb-2">Duplicar Conversa</h3>
                <p className="text-xs text-[var(--text-tertiary)] font-medium mb-6">
                   A conversa atual será arquivada (fica disponível em "Carregar histórico anterior") e um novo atendimento será aberto para o mesmo contato, para tratar um assunto separado. O cliente não recebe nenhum aviso — a conversa continua normalmente, só que numa sessão nova.
                </p>
                <div className="space-y-3">
                   <button
                     onClick={handleDuplicateChat}
                     disabled={isDuplicatingChat}
                     className="w-full py-4 bg-slate-900 text-white rounded-2xl text-[11px] font-semibold uppercase tracking-widest shadow-xl hover:bg-slate-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                   >
                     {isDuplicatingChat ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                     Duplicar Conversa
                   </button>
                   <button
                     onClick={() => setIsDuplicateModalOpen(false)}
                     disabled={isDuplicatingChat}
                     className="w-full py-3.5 bg-[var(--surface-card)] border-2 border-[var(--border-default)] text-[var(--text-secondary)] rounded-2xl text-[10px] font-semibold uppercase tracking-widest hover:bg-[var(--surface-pill)] transition-all disabled:opacity-50"
                   >
                     Cancelar
                   </button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        isOpen={isConfirmNewTicketOpen}
        onClose={() => setIsConfirmNewTicketOpen(false)}
        onConfirm={() => handleGenerateTicket(false, false, true)}
        title="Abrir outro chamado?"
        description={`Este atendimento já possui o chamado #${String(selectedChat?.ticketNumber ?? '').padStart(4, '0')} vinculado. Deseja mesmo criar um novo chamado separado para esta conversa?`}
        confirmLabel="Abrir outro chamado"
      />

      <LinkContactModal
        isOpen={isLinkModalOpen}
        onClose={() => setIsLinkModalOpen(false)}
        session={selectedChat || null}
        onSuccess={() => {
          refetchAllUsers();
          fetchChatSessions().then(setCustomerSessions);
        }}
      />

      <LinkTicketModal
        isOpen={isLinkTicketModalOpen}
        onClose={() => setIsLinkTicketModalOpen(false)}
        sessionId={selectedChat?.id || null}
        companyId={selectedChatContact?.companyId}
        onSuccess={() => {
          fetchChatSessions().then(setCustomerSessions);
        }}
      />

      {currentUser && (
        <PhoneContactPanel
          phone={phoneContactPanelPhone}
          onClose={() => setPhoneContactPanelPhone(null)}
          onOpenChat={(sessionId) => {
            setSelectedChatId(sessionId);
            fetchChatSessions().then(setCustomerSessions);
          }}
          currentUserId={currentUser.id}
        />
      )}

      {/* Launcher Button — escondido no mobile: a bolha pra abrir já é
          redundante com a aba "Chat" da bottom nav (mobile-bottom-nav.tsx,
          mesma permissão que libera este widget), e o "X" pra fechar
          quando aberto é redundante com o ChevronDown do próprio cabeçalho
          do chat (poucas linhas acima). */}
      {!isMobileViewport && (!isExpanded || isMinimized) && (
        <button
          onClick={() => {
            if (justDraggedLauncherRef.current) { justDraggedLauncherRef.current = false; return; }
            if (isMinimized) {
              setIsExpanded(false);
            }
            setIsMinimized(!isMinimized);
          }}
          onPointerDown={handleLauncherPointerDown}
          title={isMinimized ? 'Abrir chat (clique e segure para mover)' : 'Fechar chat (clique e segure para mover)'}
          style={{ touchAction: 'none', transition: isDraggingLauncher ? 'none' : undefined }}
          className={cn(
            "w-16 h-16 rounded-full flex items-center justify-center text-white shadow-2xl transition-all hover:scale-110 active:scale-95 relative group",
            isDraggingLauncher ? "cursor-grabbing scale-110" : "cursor-pointer",
            isMinimized ? "bg-[var(--accent)]" : "bg-slate-900 border-4 border-slate-800"
          )}
        >
          {isMinimized ? <MessageSquare size={28} /> : <X size={28} />}
          {isMinimized && (() => {
            // Pro operador, o número mostrado é chatsAwaitingResponseCount
            // (conversas de verdade sem resposta) — não unreadCount, que é a
            // contagem de notificações não lidas e pode divergir bastante
            // disso (várias notificações pra 1 chat só, ou nenhuma se a
            // notificação foi suprimida enquanto a conversa estava aberta).
            // Pro cliente (só 1 atendimento por vez, sem essa noção de fila),
            // continua sendo "tenho mensagem nova" via unreadCount.
            // Só entra chat ASSUMIDO por quem está logado — o "!" amarelo de
            // conversa pendente na fila foi retirado por isso (pendente não
            // tem responsável, não é de ninguém ainda).
            const badgeCount = isCustomer ? unreadCount : chatsAwaitingResponseCount;
            if (badgeCount <= 0) return null;
            return (
              <span className="absolute -top-1 -right-1 min-w-[24px] h-6 px-1 text-white text-[10px] font-black flex items-center justify-center rounded-full border-2 border-white bg-[var(--text-danger)]">
                {badgeCount > 9 ? '9+' : badgeCount}
              </span>
            );
          })()}
        </button>
      )}
    </div>
  );
}


