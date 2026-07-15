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
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ChatMessage, 
  ChatSession, 
  QuickNote, 
  AnalystStatus,
  User as UserType,
  UserRole,
  TicketStatus,
  TicketPriority,
  Ticket,
  Company,
  Attachment
} from '@/lib/types';
import { fetchChatSessions, pushChatMessage, createChatSession, saveChatHistory, findExistingChatSessionByPhone } from '@/lib/services/chat-service';
import { fetchQuickNotes, fetchAnalystStatuses, fetchCompanies, fetchUsers, fetchQueues } from '@/lib/services/config-service';
import { cn, maskPhone, matchPhones, safeJsonStringify } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { supabase } from '@/lib/supabase';
import { useSearchParams } from 'next/navigation';
import { LinkContactModal } from '@/components/link-contact-modal';
import { ClientTime } from '@/components/client-time';
import { AssignChatMenu } from '@/components/assign-chat-menu';
import { AudioPlayer } from '@/components/audio-player';
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
          isOwnMessage ? "text-white decoration-white/70" : "text-indigo-600 decoration-indigo-300"
        )}
      >
        {part}
      </a>
    );
  });
}

function isImageAttachment(attachment: Attachment): boolean {
  return attachment.type?.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(attachment.name || attachment.url || '');
}

function isAudioAttachment(attachment: Attachment): boolean {
  return attachment.type?.startsWith('audio/') || /\.(webm|ogg|opus|mp3|m4a|wav|aac)$/i.test(attachment.name || attachment.url || '');
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
    playSound, 
    notificationSettings, 
    notifications, 
    addNotification,
    markNotificationRead,
    markNotificationsAsReadByTarget,
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
  
  const [customerSessions, setCustomerSessions] = useState<ChatSession[]>([]);
  
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
  const selectedChatMessageRows = React.useMemo(() => {
    const rows: Array<
      | { type: 'date'; id: string; label: string }
      | { type: 'message'; id: string; message: ChatMessage }
    > = [];
    let lastDateKey = '';

    (selectedChat?.messages || []).forEach((msg) => {
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
  }, [selectedChat?.messages]);
  const unreadCount = notifications.filter(n => !n.read && n.type.startsWith('chat_')).length;
  const isCustomer = [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser?.role as UserRole);
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
    const { error } = await supabase.from('chat_sessions').update({
      assignee_id: assigneeId,
      status: 'active'
    }).eq('id', sessionId);

    if (!error) {
      toast.success(targetUserId ? 'Atendimento transferido com sucesso!' : 'Atendimento assumido com sucesso!');
      const refreshedSessions = await fetchChatSessions();
      setCustomerSessions(refreshedSessions);
    } else {
      toast.error('Erro ao atualizar o atendimento.');
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

  const isSubscribedRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedChatId && supabase) {
      // 1. Prevent duplicate subscription for the SAME sessionId
      if (isSubscribedRef.current === selectedChatId) return;

      // 2. Clear previous subscription if switching sessions
      if (messagesChannelRef.current) {
        console.log(`§¹ Limpando canal anterior: ${isSubscribedRef.current}`);
        supabase.removeChannel(messagesChannelRef.current);
        messagesChannelRef.current = null;
      }

      console.log(`“¡ Inscrição realtime p/ sessão: ${selectedChatId}`);
      isSubscribedRef.current = selectedChatId;
      
      // 3. Define channel and event listeners BEFORE subscribe
      // We use a timestamp to ensure the channel name is unique and prevent reusing a channel that might already be subscribed
      const channelName = `chat-session-${selectedChatId}-${Date.now()}`;
      const channel = supabase.channel(channelName)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
            filter: `session_id=eq.${selectedChatId}`
          },
          async (payload) => {
            console.log('“© Nova mensagem detectada via realtime:', payload.new.id);
            const newMessage = payload.new;
            
            // Play sound and add notification if message is NOT from current user
            if (newMessage.sender_id !== currentUser?.id) {
              playSound('chat');
              
              const session = customerSessions.find(s => s.id === selectedChatId);
              addNotification({
                sourceId: `chat_message:${newMessage.id}`,
                title: `Nova mensagem de ${session?.customerName || 'Cliente'}`,
                message: newMessage.text,
                type: 'chat_message',
                targetId: selectedChatId
              }, currentUser!.id);
            }

            // Refresh sessions from Supabase
            await triggerRefresh();
            const refreshedSessions = await fetchChatSessions();
            setCustomerSessions(refreshedSessions);
          }
        );

      // 4. Finally subscribe
      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          console.log(`✅ Conectado ao chat realtime: ${channelName}`);
        }
      });

      messagesChannelRef.current = channel;
    }

    return () => {
      if (messagesChannelRef.current && supabase) {
        console.log(`š« Desconectando realtime sessão: ${isSubscribedRef.current}`);
        supabase.removeChannel(messagesChannelRef.current);
        messagesChannelRef.current = null;
        isSubscribedRef.current = null;
      }
    };
  }, [selectedChatId]);

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

        // Save via Supabase first, then attempt WhatsApp delivery
        await pushChatMessage(selectedChatId, newMessage);

        if (session.customerPhone) {
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
        markNotificationsAsReadByTarget(selectedChatId);
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
        
        await pushChatMessage(selectedChatId, newMessage);
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

  const handleFinishChat = async () => {
    if (!selectedChat || !ticketTitle || !currentUser) return;

    try {
      // Create Ticket via Supabase - format chat history
      const formattedChatLog = selectedChat.messages?.map(m => {
        const time = new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return `[${time}] ${m.senderName}: ${m.text}`;
      }).join('\n') || '';
      
      // Convert newlines to <br> for HTML display, while keeping plain text readable
      const chatHistoryText = `===== HISTÓRICO DO CHAT =====\n${formattedChatLog}\n===== FIM DO HISTÓRICO =====\n\nChat finalizado em: ${new Date().toLocaleString('pt-BR')}`;
      
      // Create HTML version for display (with <br> tags)
      const chatHistoryHtml = chatHistoryText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');

      const { data: createdTicket, error: ticketError } = await supabase.from('tickets').insert({
        title: ticketTitle,
        description: chatHistoryHtml,
        status: closeTicketImmediately ? TicketStatus.CLOSED : TicketStatus.NEW,
        priority: TicketPriority.MEDIUM,
        category: 'Atendimento Chat',
        customer_id: selectedChat.customerId,
        assignee_id: currentUser.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      if (ticketError) {
        console.error('Error creating ticket from chat:', ticketError);
        toast.error('Erro ao criar chamado.');
        return;
      }

      const createdTicketData = Array.isArray(createdTicket) ? createdTicket[0] : createdTicket;
      const createdTicketId = createdTicketData?.id || null;
      const createdTicketNumber = createdTicketData?.public_ticket_number || null;

      // Calculate timing metrics
      const startedAt = selectedChat.startedAt ? new Date(selectedChat.startedAt) : new Date();
      const finishedAt = new Date();
      const durationSeconds = Math.floor((finishedAt.getTime() - startedAt.getTime()) / 1000);
      
      // Find first response time (first non-system, non-same-user message)
      let firstResponseSeconds: number | undefined;
      if (selectedChat.messages && selectedChat.messages.length > 0) {
        const firstAnalystMsg = selectedChat.messages.find(m => 
          m.senderId !== selectedChat.customerId && 
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
        assigneeId: currentUser.id,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationSeconds,
        firstResponseSeconds,
        transcript: chatHistoryText
      }).catch(historyErr => {
        console.error('Non-critical error saving chat history:', historyErr);
        // Don't block the ticket creation
      });

      // Close Session via Supabase
      const { error: closeError } = await supabase
        .from('chat_sessions')
        .update({
          status: 'closed',
          ticket_id: createdTicketId,
          ticket_number: createdTicketNumber
        })
        .eq('id', selectedChat.id);

      if (closeError) {
        console.error('Error closing session:', closeError);
        toast.error('Erro ao fechar conversa.');
        return;
      }

      setIsFinishModalOpen(false);
      setSelectedChatId(null);
      const sessions = await fetchChatSessions();
      setCustomerSessions(sessions);
      setTicketTitle('');
      toast.success('Chamado criado com sucesso!');
    } catch (error) {
      console.error('Failed to finish chat:', error);
      toast.error('Erro ao criar chamado.');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setMessage(val);
    if (val.startsWith('/')) {
      setShowQuickNoteSearch(true);
    } else {
      setShowQuickNoteSearch(false);
    }
  };

  const handleChatFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    for (const file of files) {
      const fileId = crypto.randomUUID();

      if (file.size > MAX_CHAT_ATTACHMENT_SIZE) {
        toast.error(`${file.name} excede o limite de 8 MB.`);
        continue;
      }

      let dataUrl = '';
      try {
        dataUrl = await fileToDataUrl(file);
      } catch (error) {
        console.error('Error reading chat attachment:', error);
        toast.error(`Erro ao anexar ${file.name}`);
        continue;
      }

      setChatAttachments(prev => [...prev, {
        id: fileId,
        name: file.name,
        type: file.type || 'application/octet-stream',
        url: dataUrl,
        size: file.size
      }]);
    }

    if (chatFileInputRef.current) {
      chatFileInputRef.current.value = '';
    }
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

  return (
    <div
      className="omni-chat-shell fixed bottom-6 right-6 z-[200] flex flex-col items-end"
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
              width: isExpanded ? '90vw' : '400px',
              height: isExpanded ? '85vh' : '600px',
              right: isExpanded ? 'calc(5vw - 24px)' : '0',
              bottom: isExpanded ? 'calc(7.5vh - 24px)' : '80px',
            }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className={cn(
              "bg-white border border-slate-200 shadow-2xl flex flex-col overflow-hidden absolute",
              isExpanded ? "rounded-[3rem] z-[210]" : "rounded-[2.5rem] z-[205]"
            )}
          >
            {/* Header */}
            <div className="bg-indigo-600 px-5 py-4 flex justify-between items-center text-white">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-md">
                  <MessageCircle size={16} />
                </div>
                <div>
                  <h3 className="text-xs font-black uppercase tracking-widest text-white">
                    {isCustomer ? 'Suporte Omni' : 'WhatsApp Omni'}
                  </h3>
                  <p className="text-[9px] text-indigo-100 font-bold uppercase tracking-widest">
                    {isCustomer ? 'Fale Conosco' : 'Central de Atendimento'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="p-1.5 hover:bg-white/10 rounded-lg transition-all"
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

            <div className="flex-1 flex overflow-hidden bg-slate-50/30">
              {/* Sidebar (List) - Hide for customer */}
              {(!isCustomer && (!selectedChatId || isExpanded)) && (
                <div className={cn(
                  "flex flex-col border-r border-slate-100 bg-white",
                  isExpanded ? "w-80" : "w-full"
                )}>
                  <div className="p-3 border-b border-slate-100 space-y-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
                      <input
                        type="text"
                        placeholder="Buscar conversas..."
                        className="w-full bg-slate-50 border border-slate-100 rounded-xl pl-8 pr-3 py-1.5 text-xs font-bold outline-none"
                      />
                    </div>
                    <button
                      onClick={() => setIsNewChatModalOpen(true)}
                      className="w-full py-2 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-indigo-100 transition-all"
                    >
                      <Plus size={13} /> Novo WhatsApp
                    </button>

                    <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
                      <button
                        onClick={() => setChatFilter('all')}
                        className={cn(
                          "flex-1 py-1 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all",
                          chatFilter === 'all' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400"
                        )}
                      >
                        Todos
                      </button>
                      <button
                        onClick={() => setChatFilter('queue')}
                        className={cn(
                          "flex-1 py-1 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all",
                          chatFilter === 'queue' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400"
                        )}
                      >
                        Fila
                      </button>
                      <button
                        onClick={() => setChatFilter('me')}
                        className={cn(
                          "flex-1 py-1 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all",
                          chatFilter === 'me' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400"
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
                        if (chatFilter === 'queue') return s.queueId && userQueues.includes(s.queueId);
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
                                  ? "bg-indigo-50 border-indigo-100 shadow-sm"
                                  : "bg-slate-50 border-slate-100 hover:border-indigo-100 shadow-none"
                              )}
                            >
                              <div className="flex items-center gap-2.5">
                                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-emerald-600 relative shrink-0 overflow-hidden bg-emerald-100">
                                  {(() => {
                                    const photo = contact?.avatarUrl || getContactPhoto(s.customerPhone, getSessionInstanceId(s));
                                    return photo ? (
                                      <img src={photo} alt={s.customerName} className="w-full h-full object-cover" />
                                    ) : (
                                      <User size={16} />
                                    );
                                  })()}
                                  {sessionUnread > 0 && (
                                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[8px] font-black flex items-center justify-center rounded-full border-2 border-white">
                                      {sessionUnread > 9 ? '9+' : sessionUnread}
                                    </span>
                                  )}
                                </div>
                                <div>
                                  <p className="text-xs font-black text-slate-800 uppercase tracking-tight">{s.customerName}</p>
                                  {s.ticketNumber && (
                                    <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest">Conversa #{String(s.ticketNumber).padStart(4, '0')}</p>
                                  )}
                                  {company && (
                                    <p className="text-[9px] text-indigo-600 font-bold uppercase tracking-widest">{company.name}</p>
                                  )}
                                  <p className="text-[10px] text-slate-400 font-medium">{s.status === 'pending' ? '🟡 Aguardando' : '🟢 Em curso'}</p>
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
                <div className="flex-1 flex flex-col bg-white">
                  {/* Chat Header */}
                  <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-y-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {!isCustomer && !isExpanded && (
                        <button onClick={() => setSelectedChatId(null)} className="text-indigo-600 p-1.5 hover:bg-indigo-50 rounded-xl transition-all shrink-0">
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
                          <div className="w-9 h-9 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 shrink-0">
                            <User size={16} />
                          </div>
                        );
                      })()}
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase text-slate-800 tracking-widest leading-none mb-0.5 truncate">
                          {isCustomer ? 'Time de Suporte' : (selectedChat && 'customerName' in selectedChat ? selectedChat.customerName : 'Canal')}
                        </p>
                        {selectedChat?.ticketNumber && (
                          <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest">
                            Conversa #{String(selectedChat.ticketNumber).padStart(4, '0')}
                          </p>
                        )}
                        {(() => {
                           if (isCustomer) return (
                             <span className="text-[10px] text-emerald-500 font-black uppercase tracking-tighter">
                               Sempre disponível
                             </span>
                           );

                           const contact = selectedChatContact;
                           const company = contact ? companies.find(c => c.id === contact.companyId) : null;
                           
                           if (company) {
                             return (
                               <p className="text-[9px] text-indigo-600 font-black uppercase tracking-widest">
                                 {company.name}
                               </p>
                             );
                           }

                           return (
                             <div className="flex items-center gap-2 mt-1">
                               <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest leading-none">
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
                                 className="text-[9px] font-black uppercase text-indigo-600 hover:underline px-1.5 py-0.5 bg-indigo-50 rounded"
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
                          onlineTargets={onlineAssignTargets}
                          onAssignToSelf={() => handleAssignChat(selectedChat.id)}
                          onAssignToUser={(userId) => handleAssignChat(selectedChat.id, userId)}
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
                            "bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center gap-2",
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
                    className="flex-1 overflow-y-auto px-8 py-6 space-y-3 bg-slate-50/30 scroll-smooth"
                  >
                    {selectedChatMessageRows.map((row) => {
                      if (row.type === 'date') {
                        return (
                          <div key={row.id} className="flex items-center gap-3 py-2">
                            <div className="h-px flex-1 bg-slate-200" />
                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                              {row.label}
                            </span>
                            <div className="h-px flex-1 bg-slate-200" />
                          </div>
                        );
                      }

                      const m = row.message;
                      const isOwnMessage = m.senderId === currentUser.id;
                      const attachments = m.attachments || m.metadata?.attachments || [];
                      return (
                        <div key={m.id} className={cn("flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300", isOwnMessage ? "items-end" : "items-start")}>
                          <div className={cn(
                            "max-w-[min(88%,34rem)] sm:max-w-[78%] p-4 rounded-[1.5rem] text-sm font-medium shadow-sm transition-all break-words whitespace-pre-wrap",
                            isOwnMessage
                              ? "bg-indigo-600 text-white rounded-tr-none"
                              : "bg-white border border-slate-100 text-slate-800 rounded-tl-none"
                          )}>
                            {renderLinkedText(m.text, isOwnMessage)}
                            {attachments.length > 0 && (
                              <div className="mt-3 space-y-2 whitespace-normal">
                                {attachments.map((attachment: Attachment) => {
                                  const attachmentKey = attachment.id || attachment.url;
                                  const isImage = isImageAttachment(attachment);
                                  const attachmentClassName = cn(
                                    "block w-full overflow-hidden rounded-xl border text-left transition-all",
                                    isOwnMessage ? "border-white/20 bg-white/10 hover:bg-white/15" : "border-slate-200 bg-slate-50 hover:bg-slate-100"
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
                                        <div className="flex items-center gap-2 px-3 pb-3 text-[10px] font-black uppercase tracking-widest">
                                          <ImageIcon size={13} />
                                          <span className="truncate">{attachment.name}</span>
                                        </div>
                                      </div>
                                      </button>
                                    );
                                  }

                                  if (isAudioAttachment(attachment)) {
                                    return (
                                      <AudioPlayer
                                        key={attachmentKey}
                                        src={attachment.url}
                                        name={attachment.name}
                                        isOwnMessage={isOwnMessage}
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
                                          <p className={cn("text-[9px] font-bold uppercase", isOwnMessage ? "text-white/70" : "text-slate-400")}>
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
                          <span className="text-[9px] text-slate-400 font-black uppercase mt-1 px-1 tracking-widest">
                            <ClientTime date={m.timestamp} />
                          </span>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Input Area */}
                  <div className="p-4 bg-white border-t border-slate-100 relative">
                    <AnimatePresence>
                      {showNewMessageIndicator && (
                        <motion.button 
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 20 }}
                          onClick={scrollToBottom}
                          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-10 bg-indigo-600 text-white px-5 py-2.5 rounded-full shadow-2xl shadow-indigo-200 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-indigo-700 transition-all z-20 group border-2 border-white"
                        >
                          <ChevronUp size={14} className="group-hover:-translate-y-0.5 transition-transform" />
                          Nova Mensagem
                          <div className="w-1.5 h-1.5 bg-white rounded-full animate-ping" />
                        </motion.button>
                      )}

                      {showQuickNoteSearch && message.startsWith('/') && (
                        <motion.div 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 10 }}
                          className="absolute bottom-full left-6 right-6 mb-4 bg-white border border-slate-200 rounded-[2rem] shadow-2xl p-3 max-h-64 overflow-y-auto z-10"
                        >
                          <p className="p-3 text-[10px] font-black uppercase text-slate-400 tracking-widest border-b border-slate-50 mb-2">Comandos Rápidos</p>
                          {quickNotes.filter(n => n.shortcut.includes(message.slice(1))).map(note => (
                            <button 
                              key={note.id}
                              onClick={() => selectQuickNote(note)}
                              className="w-full text-left p-4 hover:bg-indigo-50 rounded-2xl transition-all flex items-center justify-between group"
                            >
                              <div className="flex flex-col">
                                <span className="text-[11px] font-black text-indigo-600 uppercase mb-0.5">/{note.shortcut}</span>
                                <span className="text-[10px] text-slate-500 font-medium truncate w-64">{note.content}</span>
                              </div>
                              <Zap size={14} className="text-amber-400 opacity-0 group-hover:opacity-100" />
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
                                className="shrink-0 text-slate-400 hover:text-red-500 p-1"
                                title="Descartar áudio"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          ) : (
                            <div key={attachment.id} className="flex max-w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
                              {isImageAttachment(attachment) ? <ImageIcon size={14} className="text-indigo-500" /> : <File size={14} className="text-slate-400" />}
                              <span className="max-w-[180px] truncate">{attachment.name}</span>
                              <button
                                type="button"
                                onClick={() => setChatAttachments(prev => prev.filter(item => item.id !== attachment.id))}
                                className="text-slate-400 hover:text-red-500"
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
                          className="w-11 h-11 shrink-0 bg-slate-100 text-slate-500 rounded-2xl hover:bg-red-100 hover:text-red-600 transition-all flex items-center justify-center"
                          title="Cancelar gravação"
                        >
                          <Trash2 size={17} />
                        </button>
                        <div className="flex-1 min-w-0 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                          <span className="text-sm font-bold text-slate-700 tabular-nums shrink-0">
                            {Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, '0')}
                          </span>
                          <span className="text-xs text-slate-400 font-medium truncate hidden sm:inline">Gravando áudio...</span>
                        </div>
                        <button
                          type="button"
                          onClick={stopRecordingAndAttach}
                          className="w-12 h-12 shrink-0 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 flex items-center justify-center"
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
                        className="w-11 h-11 shrink-0 bg-slate-100 text-slate-500 rounded-2xl hover:bg-slate-200 hover:text-indigo-600 transition-all flex items-center justify-center"
                        title="Anexar arquivo"
                      >
                        <Paperclip size={17} />
                      </button>
                      <button
                        type="button"
                        onClick={startRecording}
                        className="w-11 h-11 shrink-0 bg-slate-100 text-slate-500 rounded-2xl hover:bg-slate-200 hover:text-indigo-600 transition-all flex items-center justify-center"
                        title="Gravar áudio"
                      >
                        <Mic size={17} />
                      </button>
                      <input
                        type="text"
                        value={message}
                        onChange={handleInputChange}
                        placeholder="Resposta padrão '/' para atalhos..."
                        className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
                      />
                      <button
                        type="submit"
                        disabled={!message.trim() && chatAttachments.length === 0}
                        className="w-12 h-12 shrink-0 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Send size={18} />
                      </button>
                    </form>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-white/50">
                   <div className="w-20 h-20 bg-indigo-50 rounded-[2rem] flex items-center justify-center text-indigo-400 mb-6">
                      <MessageCircle size={40} />
                   </div>
                   <h4 className="text-lg font-black text-slate-800 uppercase tracking-tight mb-2">Selecione um Chat</h4>
                   <p className="text-sm text-slate-400 font-medium max-w-xs">Escolha uma conversa lateral ou inicie um novo atendimento via WhatsApp.</p>
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
                className="relative flex h-full max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
                style={{ zIndex: 2147483647 }}
              >
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                      <ImageIcon size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-800">{previewAttachment.name}</p>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        {previewAttachment.size ? `${Math.ceil(previewAttachment.size / 1024)} KB` : 'Imagem'}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openAttachmentInNewTab(previewAttachment)}
                      className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 transition-all hover:bg-slate-50 hover:text-indigo-600"
                      title="Abrir em nova aba"
                    >
                      <Maximize2 size={17} />
                    </button>
                    <a
                      href={previewAttachment.url}
                      download={previewAttachment.name}
                      className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 transition-all hover:bg-slate-50 hover:text-indigo-600"
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
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 max-h-[80vh] overflow-y-auto">
                <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight mb-2">Novo WhatsApp</h3>
                <p className="text-xs text-slate-400 font-medium mb-6">Inicie uma conversa manual ou busque um cliente cadastrado.</p>

                <div className="space-y-4">
                   <div className="space-y-1.5 relative">
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Buscar Cliente ou Funcionário</label>
                      <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input 
                          type="text" 
                          value={customerSearch}
                          onChange={(e) => setCustomerSearch(e.target.value)}
                          placeholder="Digite nome da empresa ou contato..." 
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all" 
                        />
                      </div>
                      
                      {searchResults.length > 0 && (
                        <div className="absolute top-full left-0 right-0 z-10 mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden max-h-48 overflow-y-auto animate-in fade-in slide-in-from-top-2">
                          {searchResults.map(res => (
                            <button 
                              key={`${res.type}-${res.id}`}
                              onClick={() => selectCustomer(res)}
                              className="w-full px-4 py-3 flex items-center justify-between hover:bg-indigo-50 transition-all border-b border-slate-50 last:border-0"
                            >
                              <div className="flex items-center gap-3">
                                <div className={cn(
                                  "w-8 h-8 rounded-lg flex items-center justify-center",
                                  res.type === 'company' ? "bg-amber-100 text-amber-600" : "bg-indigo-100 text-indigo-600"
                                )}>
                                  {res.type === 'company' ? <LayoutGrid size={14} /> : <User size={14} />}
                                </div>
                                <div className="text-left flex-1 min-w-0">
                                  <p className="text-[11px] font-black uppercase text-slate-800 leading-none mb-1 truncate">{res.name}</p>
                                  <div className="flex items-center gap-2">
                                    <p className="text-[9px] text-slate-400 font-bold uppercase whitespace-nowrap">
                                      {res.type === 'company' ? 'Empresa' : `Funcionário • ${res.companyName || 'S/ Empresa'}`}
                                    </p>
                                  </div>
                                </div>
                              </div>
                              {res.phone && (
                                <div className="text-right">
                                  <span className="text-[10px] font-black text-indigo-600 block">{res.phone}</span>
                                  <span className="text-[8px] text-slate-400 font-black uppercase">WhatsApp</span>
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                   </div>

                   <div className="flex items-center gap-4 py-2">
                     <div className="flex-1 h-px bg-slate-100" />
                     <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">ou manual</span>
                     <div className="flex-1 h-px bg-slate-100" />
                   </div>

                   <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Número</label>
                        <input 
                          type="tel" 
                          value={newChatNumber} 
                          onChange={e => setNewChatNumber(e.target.value)} 
                          placeholder="Ex: 11999999999" 
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none" 
                        />
                     </div>
                     <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Nome</label>
                        <input 
                          type="text" 
                          value={newChatName} 
                          onChange={e => setNewChatName(e.target.value)} 
                          placeholder="Identificação" 
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none" 
                        />
                     </div>
                   </div>
                   <button 
                     onClick={handleStartNewChat} 
                     disabled={!newChatNumber}
                     className="w-full mt-4 py-4 bg-indigo-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-xl shadow-indigo-100 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl p-8">
                <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight mb-2">Finalizar Chat</h3>
                <p className="text-xs text-slate-400 font-medium mb-6">Transforme esta conversa em um chamado para Histórico.</p>
                
                <div className="space-y-4">
                   <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Título do Chamado</label>
                      <input 
                        type="text" 
                        value={ticketTitle} 
                        onChange={e => setTicketTitle(e.target.value)} 
                        placeholder="Ex: Suporte técnico - Erro no login" 
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none" 
                      />
                   </div>
                   
                   <label className="flex items-center gap-3 p-4 bg-slate-50 border border-slate-100 rounded-2xl cursor-pointer hover:bg-slate-100 transition-all">
                      <input 
                        type="checkbox" 
                        checked={closeTicketImmediately} 
                        onChange={e => setCloseTicketImmediately(e.target.checked)}
                        className="w-5 h-5 rounded-lg border-slate-300 text-indigo-600 focus:ring-indigo-500" 
                      />
                      <div className="flex flex-col">
                         <span className="text-xs font-black uppercase text-slate-700 tracking-tight">Fechar Imediatamente</span>
                         <span className="text-[9px] text-slate-400 font-medium">O chamado será criado com status &quot;Fechado&quot;</span>
                      </div>
                   </label>

                   <button 
                     onClick={handleFinishChat} 
                     className="w-full mt-4 py-4 bg-slate-900 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-xl hover:bg-slate-800 transition-all font-bold"
                   >
                     Gerar Chamado & Finalizar
                   </button>
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
            isMinimized ? "bg-indigo-600" : "bg-slate-900 border-4 border-slate-800"
          )}
        >
          {isMinimized ? <MessageSquare size={28} /> : <X size={28} />}
          {isMinimized && (unreadCount > 0 || (!isCustomer && customerSessions.some(s => s.status === 'pending'))) && (
            <span className={cn(
              "absolute -top-1 -right-1 min-w-[24px] h-6 px-1 text-white text-[10px] font-black flex items-center justify-center rounded-full border-2 border-white",
              unreadCount > 0 ? "bg-red-500" : "bg-amber-500 animate-pulse"
            )}>
              {unreadCount > 0 ? (unreadCount > 9 ? '9+' : unreadCount) : '!'}
            </span>
          )}
        </button>
      )}
    </div>
  );
}


