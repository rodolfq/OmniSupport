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
  Zap,
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
  Download,
  Mic,
  Square,
  Trash2,
  Captions,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ChatMessage,
  ChatSession,
  QuickNote,
  AnalystStatus,
  User as UserType,
  UserRole,
  Ticket,
  Company,
  Attachment
} from '@/lib/types';
import { fetchChatSessions, pushChatMessage, createChatSession, saveChatHistory, findExistingChatSessionByPhone, submitSurveyResponse, transcribeChatAudio } from '@/lib/services/chat-service';
import { fetchQuickNotes, fetchAnalystStatuses, fetchCompanies, fetchUsers, fetchQueues, fetchSurveySettings } from '@/lib/services/config-service';
import { saveTicketFromChatSession, closeChatSessionAfterTicket, assignChatSession, returnChatSessionToQueue } from '@/app/actions';
import { cn, maskPhone, matchPhones, safeJsonStringify } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { supabase } from '@/lib/supabase';
import { useSearchParams } from 'next/navigation';
import { LinkContactModal } from '@/components/link-contact-modal';
import { ClientTime } from '@/components/client-time';
import { AssignChatMenu } from '@/components/assign-chat-menu';
import { AudioPlayer } from '@/components/audio-player';
import { isImageAttachment, isAudioAttachment, isVideoAttachment } from '@/lib/attachment-kind';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';

const URL_PATTERN = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
const MAX_CHAT_ATTACHMENT_SIZE = 8 * 1024 * 1024;

function renderLinkedText(text: string, isOwnMessage: boolean) {
  return text.split(URL_PATTERN).map((part, index) => {
    if (!part.match(URL_PATTERN)) return <React.Fragment key={index}>{part}</React.Fragment>;

    const href = part.startsWith('http') ? part : `https://${part}`;
    return (
      <a
        key={index}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "font-black underline underline-offset-4 break-all",
          isOwnMessage ? "text-white decoration-white/70" : "text-[var(--accent-text)] decoration-[var(--accent)]"
        )}
      >
        {part}
      </a>
    );
  });
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

function openAttachmentInNewTab(attachment: Attachment) {
  if (!attachment.url) return;

  if (!attachment.url.startsWith('data:')) {
    window.open(attachment.url, '_blank', 'noopener,noreferrer');
    return;
  }

  try {
    const [header, payload = ''] = attachment.url.split(',');
    const isBase64 = /;base64/i.test(header);
    const mime = header.match(/^data:([^;,]+)/)?.[1] || attachment.type || 'application/octet-stream';
    const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
    window.open(blobUrl, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } catch {
    window.open(attachment.url, '_blank', 'noopener,noreferrer');
  }
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
    userStatus
  } = useApp();
  const searchParams = useSearchParams();
  const isMobileViewport = useIsMobile();

  const [customerSessions, setCustomerSessions] = useState<ChatSession[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);

  // Track expanded state locally
  const [isExpanded, setIsExpanded] = useState(false);

  // Use isOmniChatOpen directly instead of syncing with a local isMinimized state
  const isMinimized = !isOmniChatOpen;
  const setIsMinimized = (minimized: boolean) => setIsOmniChatOpen(!minimized);

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
    if (activeOmniChatId) {
      setIsOmniChatOpen(true);
      markNotificationsAsReadByTarget(activeOmniChatId);
    }
  }, [activeOmniChatId, setIsOmniChatOpen, markNotificationsAsReadByTarget]);

  useEffect(() => {
    const chatId = searchParams?.get('chat');
    if (chatId) {
      setIsOmniChatOpen(true);
      setActiveOmniChatId(chatId);
    }
  }, [searchParams, setIsOmniChatOpen, setActiveOmniChatId]);

  const selectedChatId = activeOmniChatId;
  const setSelectedChatId = setActiveOmniChatId;
  const selectedChat = customerSessions.find(s => s.id === selectedChatId);
  const isCustomer = [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser?.role as UserRole);
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
      const msgs = s.messages || [];
      if (msgs.length === 0) return false;
      const last = msgs[msgs.length - 1];
      return !last.senderId || last.senderId === s.customerId;
    }).length;
  }, [customerSessions, isCustomer]);
  const [lastViewedAt, setLastViewedAt] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [quickNotes, setQuickNotes] = useState<QuickNote[]>([]);
  const [showQuickNoteSearch, setShowQuickNoteSearch] = useState(false);
  const [analystStatuses, setAnalystStatuses] = useState<AnalystStatus[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [allUsers, setAllUsers] = useState<UserType[]>([]);

  const selectedChatContact = React.useMemo(() => {
    if (!selectedChat) return undefined;
    return allUsers.find(u =>
      u.id === selectedChat.customerId ||
      matchPhones(u.phone, selectedChat.customerPhone) ||
      (u.phones && u.phones.some(p => matchPhones(p, selectedChat.customerPhone)))
    );
  }, [selectedChat, allUsers]);

  const onlineAssignTargets = React.useMemo(() => {
    return analystStatuses
      .filter(s => s.isOnline)
      .map(s => allUsers.find(u => u.id === s.userId))
      .filter((u): u is UserType => !!u)
      .map(u => ({ id: u.id, name: u.name }));
  }, [analystStatuses, allUsers]);

  const handleAssignChat = async (sessionId: string, targetUserId?: string) => {
    if (!currentUser) return;
    const assigneeId = targetUserId || currentUser.id;
    if (!targetUserId && userStatus !== 'online') {
      toast.error('Você precisa estar Online para assumir atendimentos!');
      return;
    }
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
      toast.error('Não foi possível transcrever o áudio.');
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
  
  const [isFinishModalOpen, setIsFinishModalOpen] = useState(false);
  const [ticketTitle, setTicketTitle] = useState('');
  const [closeTicketImmediately, setCloseTicketImmediately] = useState(false);
  const [chatAttachments, setChatAttachments] = useState<Attachment[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);

  const [chatFilter, setChatFilter] = useState<'all' | 'me' | 'queue'>('all');
  const [userQueues, setUserQueues] = useState<string[]>([]);
  const [allQueues, setAllQueues] = useState<any[]>([]);

  const queueMenuTargets = React.useMemo(() => {
    return allQueues.map((q: any) => ({ id: q.id, name: q.name }));
  }, [allQueues]);

  // Restringe a lista de "Enviar para" a quem está online E é membro da fila
  // do próprio chat — sem fila (pool combinado) cai de volta pra todo mundo
  // online, já que aí não há uma fila única pra filtrar. O próprio usuário
  // (se online) sempre aparece, mesmo que não seja formalmente membro dessa
  // fila específica — "puxar" um chat pra si não deveria depender disso.
  const getQueueOnlineTargets = React.useCallback((queueId?: string | null) => {
    const base = (() => {
      if (!queueId) return onlineAssignTargets;
      const queue = allQueues.find((q: any) => q.id === queueId);
      if (!queue) return onlineAssignTargets;
      const memberIds: string[] = queue.member_ids || [];
      return onlineAssignTargets.filter(t => memberIds.includes(t.id));
    })();

    if (currentUser && userStatus === 'online' && !base.some(t => t.id === currentUser.id)) {
      return [...base, { id: currentUser.id, name: currentUser.name }];
    }
    return base;
  }, [onlineAssignTargets, allQueues, currentUser, userStatus]);

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
        const sessions = await fetchChatSessions(controller.signal).catch(e => { console.error('sessions fetch error:', e); return [] as any; });
        const notes = await fetchQuickNotes(controller.signal).catch(e => { console.error('notes fetch error:', e); return [] as any; });
        const statuses = await fetchAnalystStatuses(controller.signal).catch(e => { console.error('statuses fetch error:', e); return [] as any; });
        const comp = await fetchCompanies(controller.signal).catch(e => { console.error('companies fetch error:', e); return [] as any; });
        const users = await fetchUsers(controller.signal).catch(e => { console.error('users fetch error:', e); return [] as any; });
        
        // Check if controller was aborted
        if (controller.signal.aborted) return;

        console.log('ChatWidget: Dados carregados com sucesso', { 
            sessions: sessions.length, 
            companies: comp.length, 
            users: users.length 
        });
        setCustomerSessions(sessions);
        setSessionsLoaded(true);
        setQuickNotes(notes);
        setAnalystStatuses(statuses);
        setCompanies(comp);
        setAllUsers(users);
        
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

  const getSessionUnreadCount = (sessionId: string) => {
    return notifications.filter(n => !n.read && n.targetId === sessionId).length;
  };

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!currentUser?.id || !isOmniChatOpen) return;

    async function loadSessions() {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const sessions = await fetchChatSessions(controller.signal);
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
  }, [currentUser?.id, isOmniChatOpen]);

  // Tempo real de verdade via SSE para a conversa aberta (substitui o antigo
  // supabase.channel(...).on('postgres_changes', ...), que nunca funcionou de
  // fato — o shim em lib/supabase.ts não implementa pub/sub, só REST). O
  // poller de 30s logo acima continua rodando como rede de segurança (o
  // EventSource também reconecta sozinho em caso de queda de conexão).
  useEffect(() => {
    if (!selectedChatId) return;

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
          const [notes, statuses, comps, usrs] = await Promise.all([
            fetchQuickNotes(),
            fetchAnalystStatuses(),
            fetchCompanies(),
            fetchUsers()
          ]);
          setQuickNotes(notes);
          setAnalystStatuses(statuses);
          setCompanies(comps);
          setAllUsers(usrs);
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
       // Ensure one historical session exists for this customer.
       const loadOrCreateSession = async () => {
         try {
            const sessionId = await createChatSession({
              customerId: currentUser.id,
              customerName: currentUser.name,
              customerPhone: currentUser.phone,
              status: 'pending',
              startedAt: new Date().toISOString()
            } as any);
            setSelectedChatId(sessionId);
            const sessions = await fetchChatSessions();
            setCustomerSessions(sessions);
          } catch (error) {
            console.error('Error creating customer chat session:', error);
          }
        };
        loadOrCreateSession();
    }
  }, [isCustomer, isMinimized, currentUser, setSelectedChatId]);

   const handleSendMessage = async () => {
    console.log('[DEBUG] handleSendMessage called', { message, selectedChatId, hasCurrentUser: !!currentUser, attachments: chatAttachments.length });
    if ((!message?.trim() && chatAttachments.length === 0) || !selectedChatId || !currentUser) return;

    const trimmedText = message.trim();

    const newMessage: ChatMessage = {
      id: crypto.randomUUID(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      text: message.trim() || 'Anexo enviado',
      timestamp: new Date().toISOString(),
      type: 'text',
      attachments: chatAttachments.length > 0 ? chatAttachments : undefined,
      metadata: chatAttachments.length > 0 ? { attachments: chatAttachments } : undefined
    };

    const session = customerSessions.find(s => s.id === selectedChatId);
    if (session) {
      try {
        // Optimistic UI update
        const updatedSessions = customerSessions.map(s => {
          if (s.id === selectedChatId) {
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

        let effectiveSessionId = selectedChatId;
        if (isSurveyResponse) {
          await submitSurveyResponse(selectedChatId, trimmedText === '1' ? 1 : 0, newMessage);
        } else {
          // Save via Supabase first, then attempt WhatsApp delivery. Se a sessão
          // já estava encerrada de verdade, o servidor cria um atendimento novo
          // e devolve o id dele — precisa acompanhar a conversa ativa pra lá.
          effectiveSessionId = await pushChatMessage(selectedChatId, newMessage);
          if (effectiveSessionId !== selectedChatId) {
            setSelectedChatId(effectiveSessionId);
          }
        }

        if (!isSurveyResponse && session.customerPhone) {
          const queue = allQueues.find((q: any) => q.id === session.queueId);
          const instanceId = queue?.whatsapp_instance_id || queue?.whatsappInstanceId || 'default';
          const phone = session.customerPhone.replace(/\D/g, '');

          if (phone) {
            const hasAttachments = !!newMessage.attachments && newMessage.attachments.length > 0;
            try {
              const res = await fetch('/api/whatsapp/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: safeJsonStringify({ instanceId, to: phone, message: newMessage.text }),
              });
              if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                console.error('WhatsApp send failed:', {
                  status: res.status,
                  statusText: res.statusText,
                  error: body.error,
                  instanceId,
                  phone,
                  hasAttachments
                });
                toast.warning('Mensagem salva, mas não foi enviada no WhatsApp.');
              } else if (hasAttachments) {
                // Envio de mídia pelo WhatsApp ainda não é suportado (só o texto é transmitido).
                console.warn('WhatsApp send: attachment present but media sending is not yet implemented; only text was transmitted.', { instanceId, phone });
                toast.warning('Anexo salvo na conversa, mas o envio de mídia (áudio/arquivo) pelo WhatsApp ainda não está disponível.');
              }
            } catch (error: any) {
              console.error('Failed to send real WhatsApp message:', {
                message: error?.message,
                stack: error?.stack,
                instanceId,
                phone,
                hasAttachments
              });
              toast.warning('Mensagem salva, mas não foi enviada no WhatsApp.');
            }
          }
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
      // Session might not be loaded yet - try to save anyway
      console.log('[DEBUG] Session not in state, sending directly to Supabase');
      try {
        setShouldAutoScroll(true);
        
        // Optimistic update
        const optimisticSession: ChatSession = {
          id: selectedChatId,
          customerId: currentUser.id,
          customerName: currentUser.name,
          status: 'pending',
          messages: [newMessage],
          startedAt: new Date().toISOString(),
          lastMessageAt: newMessage.timestamp
        };
        setCustomerSessions(prev => [optimisticSession, ...prev.filter(s => s.id !== selectedChatId)]);
        setMessage('');
        setChatAttachments([]);

        const effectiveSessionId = await pushChatMessage(selectedChatId, newMessage);
        if (effectiveSessionId !== selectedChatId) {
          setSelectedChatId(effectiveSessionId);
        }
        const refreshedSessions = await fetchChatSessions();
        setCustomerSessions(refreshedSessions);
      } catch (error) {
        console.error('Failed to send message (no session fallback):', error);
        toast.error('Erro ao enviar mensagem.');
      }
    }
    
    setShowQuickNoteSearch(false);
  };

  const handleStartNewChat = async () => {
    if (!newChatNumber) return;
    
    try {
      const digits = newChatNumber.replace(/\D/g, '');
      if (digits.length >= 14) {
        toast.error('Use o número de telefone (ex: 21991778567), não o ID interno do WhatsApp.');
        return;
      }
      const phone = digits.length <= 11 && !digits.startsWith('55') ? `55${digits}` : digits;

      const existingSessionId = await findExistingChatSessionByPhone(phone);
      if (existingSessionId) {
        const sessionId = await createChatSession({
          id: existingSessionId,
          customerName: newChatName || phone,
          customerPhone: phone,
          status: 'active',
          startedAt: new Date().toISOString()
        } as any);
        setSelectedChatId(sessionId);
        const sessions = await fetchChatSessions();
        setCustomerSessions(sessions);
        setIsNewChatModalOpen(false);
        setNewChatNumber('');
        setNewChatName('');
        toast.info('Conversa existente reaberta.');
        return;
      }

      const sessionId = await createChatSession({
        customerName: newChatName || phone,
        customerPhone: phone,
        status: 'active',
        startedAt: new Date().toISOString()
      } as any);
      
      setSelectedChatId(sessionId);
      const sessions = await fetchChatSessions();
      setCustomerSessions(sessions);
      setIsNewChatModalOpen(false);
      setNewChatNumber('');
      setNewChatName('');
      toast.success('Conversa WhatsApp iniciada!');
    } catch (error) {
      console.error('Error starting chat:', error);
      toast.error('Erro ao iniciar conversa.');
    }
  };

  const handleGenerateTicket = async (closeChat: boolean, closeAsSpam: boolean = false) => {
    if (!selectedChat || !ticketTitle || !currentUser) return;

    // Já existe um chamado vinculado a esta conversa (gerado antes, sem
    // finalizar) — "Gerar Chamado" de novo criaria um duplicado, então só
    // avisa e não faz nada; para finalizar usando esse mesmo chamado, o
    // fluxo abaixo (closeChat === true) já reaproveita automaticamente.
    if (!closeChat && selectedChat.ticketId) {
      toast.warning(`Este atendimento já possui o chamado #${String(selectedChat.ticketNumber ?? '').padStart(4, '0')} vinculado.`);
      return;
    }

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

      const ticketResult = await saveTicketFromChatSession(selectedChat.id, ticketTitle, closeTicketImmediately);
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

        // Avisa o cliente, dentro da própria conversa, que um chamado foi
        // aberto — sempre registrado no chat (visível pro cliente logado ou
        // via WhatsApp) e, adicionalmente, encaminhado pelo WhatsApp quando
        // há telefone.
        const ticketNoticeMessage: ChatMessage = {
          id: crypto.randomUUID(),
          senderId: currentUser.id,
          senderName: 'SSX Resolve',
          text: `📄 Novo chamado gerado #${String(createdTicketNumber).padStart(4, '0')}`,
          timestamp: new Date().toISOString(),
          type: 'system'
        };
        try {
          await pushChatMessage(selectedChat.id, ticketNoticeMessage);
          if (selectedChat.customerPhone) {
            const phone = selectedChat.customerPhone.replace(/\D/g, '');
            if (phone) {
              const queue = allQueues.find((q: any) => q.id === selectedChat.queueId);
              const instanceId = queue?.whatsapp_instance_id || queue?.whatsappInstanceId || 'default';
              const sendRes = await fetch('/api/whatsapp/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: safeJsonStringify({ instanceId, to: phone, message: ticketNoticeMessage.text }),
              });
              if (!sendRes.ok) {
                toast.warning('Chamado avisado no chat, mas não foi enviado via WhatsApp.');
              }
            }
          }
        } catch (msgError) {
          console.error('Failed to notify customer about ticket creation:', msgError);
        }

        setIsFinishModalOpen(false);
        const sessions = await fetchChatSessions();
        setCustomerSessions(sessions);
        setTicketTitle('');
        toast.success('Chamado criado com sucesso! O atendimento continua em aberto.');
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
              senderName: 'SSX Resolve',
              text: closingMessage,
              timestamp: new Date().toISOString(),
              type: 'system'
            };
            await pushChatMessage(selectedChat.id, closingChatMessage);
            awaitingSurveyUntil = new Date(Date.now() + surveySettings.responseWindowHours * 3600_000).toISOString();

            if (selectedChat.customerPhone) {
              const phone = selectedChat.customerPhone.replace(/\D/g, '');
              if (phone) {
                const queue = allQueues.find((q: any) => q.id === selectedChat.queueId);
                const instanceId = queue?.whatsapp_instance_id || queue?.whatsappInstanceId || 'default';
                const sendRes = await fetch('/api/whatsapp/send', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: safeJsonStringify({ instanceId, to: phone, message: closingMessage }),
                });
                if (!sendRes.ok) {
                  toast.warning('Mensagem de encerramento registrada no chat, mas não foi enviada via WhatsApp.');
                }
              }
            }
          }
        } catch (surveyError) {
          console.error('Failed to send closing survey:', surveyError);
          toast.warning('Chamado finalizado, mas a mensagem de encerramento/pesquisa não foi registrada.');
        }
      }

      // ticket_id/ticket_number já foram vinculados por saveTicketFromChatSession —
      // aqui só falta marcar a sessão como encerrada.
      const closeResult = await closeChatSessionAfterTicket(selectedChat.id, awaitingSurveyUntil);
      if ('error' in closeResult) {
        console.error('Error closing session:', closeResult.error);
        toast.error('Erro ao fechar conversa.');
        return;
      }

      setIsFinishModalOpen(false);
      setSelectedChatId(null);
      const sessions = await fetchChatSessions();
      setCustomerSessions(sessions);
      setTicketTitle('');
      toast.success(hadExistingTicket ? `Atendimento finalizado! Chamado #${String(createdTicketNumber).padStart(4, '0')} mantido.` : 'Chamado criado com sucesso!');
    } catch (error) {
      console.error('Failed to finish chat:', error);
      toast.error('Erro ao criar chamado.');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setMessage(val);
    if (val.startsWith('/') && currentUser?.role !== UserRole.EMPLOYEE) {
      setShowQuickNoteSearch(true);
    } else {
      setShowQuickNoteSearch(false);
    }
  };

  // Compartilhado entre o seletor de arquivo (input) e o colar (Ctrl+V) de
  // print/arquivo — mesmas regras (limite de 8MB, conversão pra data URL)
  // pros dois caminhos, pra cliente e operador igual (é o mesmo componente).
  const addFilesAsChatAttachments = async (files: File[]) => {
    for (const file of files) {
      const fileId = crypto.randomUUID();

      if (file.size > MAX_CHAT_ATTACHMENT_SIZE) {
        toast.error(`${file.name || 'Arquivo'} excede o limite de 8 MB.`);
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
  const handleChatPaste = async (e: React.ClipboardEvent<HTMLInputElement>) => {
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
      toast.error('Áudio excede o limite de 8 MB.');
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

  const selectQuickNote = (note: QuickNote) => {
    setMessage(note.content);
    setShowQuickNoteSearch(false);
  };

  if (!mounted || !currentUser) return null;
  if (isOmniChatExpanded && (!isExpanded || isMinimized)) return null;

  const isMobileFullScreen = isMobileViewport && !isMinimized;

  return (
    <div
      className={cn(
        "omni-chat-shell fixed flex flex-col items-end",
        // Em tela cheia no celular precisa ficar acima da bottom nav (z-[200]
        // em mobile-bottom-nav.tsx) — ela já se esconde sozinha enquanto o
        // chat está aberto, mas isso é reforço para não depender só disso.
        isMobileFullScreen ? "inset-0 z-[250]" : "bottom-6 right-6 z-[200]"
      )}
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
              width: isMobileFullScreen ? '100vw' : (isExpanded ? '90vw' : 'min(400px, calc(100vw - 2rem))'),
              height: isMobileFullScreen ? '100dvh' : (isExpanded ? '85vh' : 'min(600px, calc(100vh - 6rem))'),
              right: isMobileFullScreen ? 0 : (isExpanded ? 'calc(5vw - 24px)' : '0'),
              bottom: isMobileFullScreen ? 0 : (isExpanded ? 'calc(7.5vh - 24px)' : '80px'),
            }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className={cn(
              "bg-[var(--surface-card)] border border-[var(--border-default)] shadow-2xl flex flex-col overflow-hidden absolute",
              isMobileFullScreen ? "rounded-none z-[210] border-none" : isExpanded ? "rounded-3xl z-[210]" : "rounded-2xl z-[205]"
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
                <div className={cn(
                  "flex flex-col border-r border-[var(--border-default)] bg-[var(--surface-card)]",
                  isExpanded ? "w-80" : "w-full"
                )}>
                  <div className="p-3 border-b border-[var(--border-default)] space-y-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={13} />
                      <input
                        type="text"
                        placeholder="Buscar conversas..."
                        className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl pl-8 pr-3 py-1.5 text-xs font-bold outline-none"
                      />
                    </div>
                    <button
                      onClick={() => setIsNewChatModalOpen(true)}
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
                        onClick={() => setChatFilter('queue')}
                        className={cn(
                          "flex-1 py-1 text-[9px] font-semibold uppercase tracking-widest rounded-lg transition-all",
                          chatFilter === 'queue' ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-tertiary)]"
                        )}
                      >
                        Fila
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
                  <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                    {customerSessions
                      .filter(s => s.status !== 'closed')
                      .filter(s => {
                        if (chatFilter === 'all') return true;
                        if (chatFilter === 'me') return s.assigneeId === currentUser?.id;
                        // "Fila": todo chat (pendente ou já em atendimento, de
                        // qualquer analista) que pertence a QUALQUER fila — não
                        // só as que o usuário logado é formalmente membro
                        // (ex: um admin que acompanha tudo mas não está
                        // cadastrado em nenhuma fila específica não pode ver a
                        // aba inteira vazia). Inclui também os próprios
                        // chamados do usuário mesmo sem queueId (ex: pool
                        // combinado).
                        if (chatFilter === 'queue') return !!s.queueId || s.assigneeId === currentUser?.id;
                        return true;
                      })
                        .map(s => {
                          const contact = allUsers.find(u => 
                            u.id === s.customerId || 
                            matchPhones(u.phone, s.customerPhone) || (u.phones && u.phones.some(p => matchPhones(p, s.customerPhone)))
                          );
                          const company = contact ? companies.find(c => c.id === contact.companyId) : null;
                          const sessionUnread = getSessionUnreadCount(s.id);
                          
                          return (
                            <button 
                              key={s.id} 
                              onClick={() => setSelectedChatId(s.id)}
                              className={cn(
                                "w-full text-left p-3 rounded-2xl transition-all group flex items-center justify-between border",
                                selectedChatId === s.id
                                  ? "bg-[var(--accent)]/10 border-[var(--accent)]/20 shadow-sm"
                                  : "bg-[var(--surface-card)] border-[var(--border-default)] hover:border-[var(--accent)]/20 shadow-none"
                              )}
                            >
                              <div className="flex items-center gap-2.5">
                                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-[var(--text-success)] relative shrink-0 overflow-hidden bg-[var(--surface-success)]">
                                  {(() => {
                                    const photo = contact?.avatarUrl || getContactPhoto(s.customerPhone, getSessionInstanceId(s));
                                    return photo ? (
                                      <img src={photo} alt={s.customerName} className="w-full h-full object-cover" />
                                    ) : (
                                      <User size={16} />
                                    );
                                  })()}
                                  {sessionUnread > 0 && (
                                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-[var(--text-danger)] text-white text-[8px] font-black flex items-center justify-center rounded-full border-2 border-white">
                                      {sessionUnread > 9 ? '9+' : sessionUnread}
                                    </span>
                                  )}
                                </div>
                                <div>
                                  <p className="text-xs font-black text-[var(--text-primary)] uppercase tracking-tight">{s.customerName}</p>
                                  {s.ticketNumber && (
                                    <p className="text-[9px] text-[var(--text-tertiary)] font-semibold uppercase tracking-widest">Conversa #{String(s.ticketNumber).padStart(4, '0')}</p>
                                  )}
                                  {company && (
                                    <p className="text-[9px] text-[var(--accent-text)] font-bold uppercase tracking-widest">{company.name}</p>
                                  )}
                                  <p className="text-[10px] text-[var(--text-tertiary)] font-medium">{s.status === 'pending' ? '🟡 Aguardando' : '🟢 Em curso'}</p>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                  </div>
                </div>
              )}

              {/* Chat Content */}
              {selectedChatId ? (
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
                        {selectedChat?.ticketNumber && (
                          <p className="text-[9px] text-[var(--text-tertiary)] font-semibold uppercase tracking-widest">
                            Conversa #{String(selectedChat.ticketNumber).padStart(4, '0')}
                          </p>
                        )}
                        {/* Visível só pra equipe — pra qualquer analista que abrir essa
                            conversa saber de cara quem é o responsável, sem precisar
                            checar a fila. Nome resolvido contra allUsers (já carregado
                            pra o AssignChatMenu), sem precisar de rota nova. */}
                        {!isCustomer && selectedChat && 'assigneeId' in selectedChat && (
                          <p className="text-[9px] font-semibold uppercase tracking-widest mt-0.5 truncate">
                            <span className="text-[var(--text-tertiary)]">Responsável: </span>
                            <span className={cn(
                              "font-black",
                              selectedChat.assigneeId ? "text-[var(--accent-text)]" : "text-[var(--text-warning-strong)]"
                            )}>
                              {selectedChat.assigneeId
                                ? (allUsers.find(u => u.id === selectedChat.assigneeId)?.name || 'Carregando...')
                                : 'Não atribuído'}
                            </span>
                          </p>
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
                               <p className="text-[9px] text-[var(--accent-text)] font-semibold uppercase tracking-widest">
                                 {company.name}
                               </p>
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
                      <div className="flex items-center gap-1.5 shrink-0">
                        <AssignChatMenu
                          currentUserId={currentUser?.id}
                          isCurrentUserOnline={userStatus === 'online'}
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
                    )}
                  </div>

                  {/* Messages Area */}
                  <div 
                    ref={scrollRef} 
                    onScroll={handleScroll}
                    className="flex-1 overflow-y-auto px-8 py-6 space-y-3 bg-[var(--surface-card)]/30 scroll-smooth"
                  >
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
                      return (
                        <div key={m.id} className={cn("flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300", isOwnMessage ? "items-end" : "items-start")}>
                          <div className={cn(
                            "max-w-[min(88%,34rem)] sm:max-w-[78%] p-4 rounded-[1.5rem] text-sm font-medium shadow-sm transition-all break-words whitespace-pre-wrap",
                            isOwnMessage
                              ? "bg-[var(--accent)] text-white rounded-tr-none"
                              : "bg-[var(--surface-card)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-tl-none"
                          )}>
                            {renderLinkedText(m.text, isOwnMessage)}
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
                                      <div className="space-y-2">
                                        <img
                                          src={attachment.url}
                                          alt={attachment.name}
                                          className="max-h-48 w-full object-cover"
                                        />
                                        <div className="flex items-center gap-2 px-3 pb-3 text-[10px] font-semibold uppercase tracking-widest">
                                          <ImageIcon size={13} />
                                          <span className="truncate">{attachment.name}</span>
                                        </div>
                                      </div>
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
                          </div>
                          <span className="text-[9px] text-[var(--text-tertiary)] font-semibold uppercase mt-1 px-1 tracking-widest">
                            <ClientTime date={m.timestamp} />
                          </span>
                        </div>
                      );
                    })}
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

                      {showQuickNoteSearch && message.startsWith('/') && (
                        <motion.div 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 10 }}
                          className="absolute bottom-full left-6 right-6 mb-4 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] shadow-2xl p-3 max-h-64 overflow-y-auto z-10"
                        >
                          <p className="p-3 text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest border-b border-[var(--border-default)] mb-2">Comandos Rápidos</p>
                          {quickNotes.filter(n => n.shortcut.includes(message.slice(1))).map(note => (
                            <button 
                              key={note.id}
                              onClick={() => selectQuickNote(note)}
                              className="w-full text-left p-4 hover:bg-[var(--accent)]/10 rounded-2xl transition-all flex items-center justify-between group"
                            >
                              <div className="flex flex-col">
                                <span className="text-[11px] font-semibold text-[var(--accent-text)] uppercase mb-0.5">/{note.shortcut}</span>
                                <span className="text-[10px] text-[var(--text-tertiary)] font-medium truncate w-64">{note.content}</span>
                              </div>
                              <Zap size={14} className="text-[var(--text-warning)] opacity-0 group-hover:opacity-100" />
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
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
                        accept="image/*,video/*,application/pdf,.doc,.docx"
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
                      <input
                        type="text"
                        value={message}
                        onChange={handleInputChange}
                        onPaste={handleChatPaste}
                        placeholder="Resposta padrão '/' para atalhos... (Ctrl+V cola prints e arquivos)"
                        className="flex-1 min-w-0 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3.5 text-base font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
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
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-[var(--surface-card)]/50">
                   <div className="w-20 h-20 bg-[var(--accent)]/10 rounded-[2rem] flex items-center justify-center text-[var(--accent-text)] mb-6">
                      <MessageCircle size={40} />
                   </div>
                   <h4 className="text-lg font-black text-[var(--text-primary)] uppercase tracking-tight mb-2">Selecione um Chat</h4>
                   <p className="text-sm text-[var(--text-tertiary)] font-medium max-w-xs">Escolha uma conversa lateral ou inicie um novo atendimento via WhatsApp.</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attachment Preview */}
      {createPortal(
        <AnimatePresence>
          {previewAttachment && (
            <div
              className="fixed inset-0 flex items-center justify-center p-4"
              style={{ zIndex: 2147483647, isolation: 'isolate' }}
            >
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setPreviewAttachment(null)}
                className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm"
                style={{ zIndex: 2147483646 }}
              />
              <motion.div
                initial={{ scale: 0.96, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.96, opacity: 0 }}
                className="relative flex h-full max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-[var(--surface-card)] shadow-2xl"
                style={{ zIndex: 2147483647 }}
              >
                <div className="flex items-center justify-between gap-3 border-b border-[var(--border-default)] px-4 py-3 sm:px-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent-text)]">
                      <ImageIcon size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-[var(--text-primary)]">{previewAttachment.name}</p>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">
                        {previewAttachment.size ? `${Math.ceil(previewAttachment.size / 1024)} KB` : 'Imagem'}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openAttachmentInNewTab(previewAttachment)}
                      className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border-default)] text-[var(--text-tertiary)] transition-all hover:bg-[var(--surface-card)] hover:text-[var(--accent-text)]"
                      title="Abrir em nova aba"
                    >
                      <Maximize2 size={17} />
                    </button>
                    <a
                      href={previewAttachment.url}
                      download={previewAttachment.name}
                      className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border-default)] text-[var(--text-tertiary)] transition-all hover:bg-[var(--surface-card)] hover:text-[var(--accent-text)]"
                      title="Baixar imagem"
                    >
                      <Download size={17} />
                    </a>
                    <button
                      type="button"
                      onClick={() => setPreviewAttachment(null)}
                      className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white transition-all hover:bg-slate-800"
                      title="Fechar preview"
                    >
                      <X size={17} />
                    </button>
                  </div>
                </div>
                <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-3 sm:p-6">
                  <img
                    src={previewAttachment.url}
                    alt={previewAttachment.name}
                    className="max-h-full max-w-full rounded-xl object-contain"
                  />
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
                   <button 
                     onClick={handleStartNewChat} 
                     disabled={!newChatNumber}
                     className="w-full mt-4 py-4 bg-[var(--accent)] text-white rounded-2xl text-[11px] font-semibold uppercase tracking-widest shadow-xl shadow-indigo-100 hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                   >
                     Iniciar Conversa
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
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsFinishModalOpen(false)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative bg-[var(--surface-card)] w-full max-w-sm rounded-[2.5rem] shadow-2xl p-8">
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
                     className="w-full mt-2 py-4 bg-[var(--surface-card)] border-2 border-[var(--border-default)] text-[var(--text-primary)] rounded-2xl text-[11px] font-semibold uppercase tracking-widest hover:border-[var(--accent)]/40 hover:bg-[var(--surface-pill)] transition-all"
                   >
                     Gerar Chamado
                   </button>
                   <p className="text-[9px] text-[var(--text-tertiary)] font-medium text-center -mt-2">O chat continua aberto, sem enviar mensagem de encerramento.</p>

                   <button
                     onClick={() => handleGenerateTicket(true)}
                     className="w-full py-4 bg-slate-900 text-white rounded-2xl text-[11px] font-semibold uppercase tracking-widest shadow-xl hover:bg-slate-800 transition-all"
                   >
                     Gerar Chamado & Finalizar
                   </button>

                   <button
                     onClick={() => handleGenerateTicket(true, true)}
                     className="w-full py-3.5 bg-[var(--surface-card)] border-2 border-[var(--text-danger)]/20 text-[var(--text-danger)] rounded-2xl text-[10px] font-semibold uppercase tracking-widest hover:bg-[var(--surface-danger)] transition-all"
                   >
                     Fechar como Spam
                   </button>
                   <p className="text-[9px] text-[var(--text-tertiary)] font-medium text-center -mt-2">Gera o chamado e encerra, mas não envia nenhuma mensagem ao cliente — use quando um bot dele responder automaticamente à pesquisa e reabrir o chat em loop.</p>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <LinkContactModal 
        isOpen={isLinkModalOpen} 
        onClose={() => setIsLinkModalOpen(false)} 
        session={selectedChat || null} 
        onSuccess={() => {
          fetchUsers().then(setAllUsers);
          fetchChatSessions().then(setCustomerSessions);
        }}
      />

      {/* Launcher Button */}
      {(!isExpanded || isMinimized) && (
        <button 
          onClick={() => {
            if (isMinimized) {
              setIsExpanded(false);
            }
            setIsMinimized(!isMinimized);
          }}
          className={cn(
            "w-16 h-16 rounded-full flex items-center justify-center text-white shadow-2xl transition-all hover:scale-110 active:scale-95 relative group",
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
            const badgeCount = isCustomer ? unreadCount : chatsAwaitingResponseCount;
            if (!(badgeCount > 0 || (!isCustomer && customerSessions.some(s => s.status === 'pending')))) return null;
            return (
              <span className={cn(
                "absolute -top-1 -right-1 min-w-[24px] h-6 px-1 text-white text-[10px] font-black flex items-center justify-center rounded-full border-2 border-white",
                badgeCount > 0 ? "bg-[var(--text-danger)]" : "bg-[var(--text-warning-strong)] animate-pulse"
              )}>
                {badgeCount > 0 ? (badgeCount > 9 ? '9+' : badgeCount) : '!'}
              </span>
            );
          })()}
        </button>
      )}
    </div>
  );
}


