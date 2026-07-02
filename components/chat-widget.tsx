'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
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
  LayoutGrid
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
  MockDB
} from '@/lib/mock-db';
import { fetchChatSessions, pushChatMessage, createChatSession, saveChatHistory } from '@/lib/services/chat.service';
import { fetchQuickNotes, fetchAnalystStatuses, fetchCompanies, fetchUsers, fetchQueues } from '@/lib/services/config.service';
import { cn, maskPhone, matchPhones, safeJsonStringify } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { supabase } from '@/lib/supabase';
import { useSearchParams } from 'next/navigation';
import { LinkContactModal } from '@/components/link-contact-modal';
import { toast } from 'sonner';

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
    activeOmniChatId,
    setActiveOmniChatId,
    refreshTrigger,
    triggerRefresh
  } = useApp();
  const searchParams = useSearchParams();
  
  const [customerSessions, setCustomerSessions] = useState<ChatSession[]>([]);
  
  // Track expanded state locally
  const [isExpanded, setIsExpanded] = useState(false);

  // Use isOmniChatOpen directly instead of syncing with a local isMinimized state
  const isMinimized = !isOmniChatOpen;
  const setIsMinimized = (minimized: boolean) => setIsOmniChatOpen(!minimized);

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
  const unreadCount = notifications.filter(n => !n.read && n.type.startsWith('chat_')).length;
  const isCustomer = [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser?.role as UserRole);
  const [lastViewedAt, setLastViewedAt] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [quickNotes, setQuickNotes] = useState<QuickNote[]>([]);
  const [showQuickNoteSearch, setShowQuickNoteSearch] = useState(false);
  const [analystStatuses, setAnalystStatuses] = useState<AnalystStatus[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [allUsers, setAllUsers] = useState<UserType[]>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shouldAutoScroll && selectedChatId) {
      const scrollContainer = scrollRef.current;
      if (scrollContainer) {
        // Use requestAnimationFrame to ensure DOM is updated
        const performScroll = () => {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
          messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
        };
        
        requestAnimationFrame(() => {
          performScroll();
          // Secod attempt for dynamic content/images
          setTimeout(performScroll, 100);
        });
      }
    }
  }, [selectedChat?.messages?.length, shouldAutoScroll, selectedChatId]);
  
  // New Chat Modal
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false);
  const [newChatNumber, setNewChatNumber] = useState('');
  const [newChatName, setNewChatName] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [searchResults, setSearchResults] = useState<{id: string, name: string, phone?: string, type: 'company' | 'employee', companyName?: string}[]>([]);
  
  const [isFinishModalOpen, setIsFinishModalOpen] = useState(false);
  const [ticketTitle, setTicketTitle] = useState('');
  const [closeTicketImmediately, setCloseTicketImmediately] = useState(false);
  
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);

  const [chatFilter, setChatFilter] = useState<'all' | 'me' | 'queue'>('all');
  const [userQueues, setUserQueues] = useState<string[]>([]);
  const [allQueues, setAllQueues] = useState<any[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadData() {
      console.log('ChatWidget: Iniciando loadData');
      try {
        // Use individual try-catch for better error identification
        let sessions = await fetchChatSessions(controller.signal).catch(e => { console.error('sessions fetch error:', e); return [] as any; });
        let notes = await fetchQuickNotes(controller.signal).catch(e => { console.error('notes fetch error:', e); return [] as any; });
        let statuses = await fetchAnalystStatuses(controller.signal).catch(e => { console.error('statuses fetch error:', e); return [] as any; });
        let comp = await fetchCompanies(controller.signal).catch(e => { console.error('companies fetch error:', e); return [] as any; });
        let users = await fetchUsers(controller.signal).catch(e => { console.error('users fetch error:', e); return [] as any; });
        
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
        
        let queues = await fetchQueues(controller.signal).catch(e => { console.error('queues fetch error:', e); return [] as any; });
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
  }, [refreshTrigger, currentUser]);


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

  const isFetchingSessionsRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    async function loadSessions() {
      if (isFetchingSessionsRef.current) return;
      
      // Abort previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      
      const controller = new AbortController();
      abortControllerRef.current = controller;
      isFetchingSessionsRef.current = true;

      try {
        const sessions = await fetchChatSessions(controller.signal);
        setCustomerSessions(sessions);
      } catch (err: any) {
        const errMsg = String(err?.message ?? '');
        if (err?.name === 'AbortError' || errMsg.includes('aborted')) {
          // Ignore
        } else {
          console.error("Failed to load sessions in widget:", err);
        }
      } finally {
        isFetchingSessionsRef.current = false;
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    }
    loadSessions();
    
    const interval = setInterval(loadSessions, 15000); // Poll even less frequently
    
    return () => {
      clearInterval(interval);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [refreshTrigger]);

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
    if (selectedChatId) {
      notifications
        .filter(n => !n.read && n.type.startsWith('chat_') && n.targetId === selectedChatId)
        .forEach(n => markNotificationRead(n.id));
    }
  }, [selectedChatId, notifications, markNotificationRead]);


  useEffect(() => {
    if (!isMinimized) {
      setQuickNotes(MockDB.getQuickNotes());
      setAnalystStatuses(MockDB.getAnalystStatuses());
      setCompanies(MockDB.getCompanies());
      setAllUsers(MockDB.getUsers());
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
       // Ensure there's a session for this customer via Supabase
       const loadOrCreateSession = async () => {
         try {
           // Check existing session in Supabase
           const { data: existing } = await supabase
             .from('chat_sessions')
             .select('id')
             .eq('customer_id', currentUser.id)
             .neq('status', 'closed')
             .maybeSingle();
           
           if (existing?.id) {
             setSelectedChatId(existing.id);
             const sessions = await fetchChatSessions();
             setCustomerSessions(sessions);
           } else {
             // Create new session
             const newSession = {
               customerId: currentUser.id,
               customerName: currentUser.name,
               status: 'pending',
                startedAt: new Date().toISOString()
              };
              const sessionId = await createChatSession(newSession as any);
              setSelectedChatId(sessionId);
              const sessions = await fetchChatSessions();
              setCustomerSessions(sessions);
            }
          } catch (error) {
            console.error('Error creating customer chat session:', error);
          }
        };
        loadOrCreateSession();
    }
  }, [isCustomer, isMinimized, currentUser, setSelectedChatId]);

   const handleSendMessage = async () => {
    console.log('[DEBUG] handleSendMessage called', { message, selectedChatId, hasCurrentUser: !!currentUser });
    if (!message?.trim() || !selectedChatId || !currentUser) return;

    const newMessage: ChatMessage = {
      id: crypto.randomUUID(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      text: message,
      timestamp: new Date().toISOString(),
      type: 'text'
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

        // Save via Supabase first, then attempt WhatsApp delivery
        await pushChatMessage(selectedChatId, newMessage);

        if (session.customerPhone) {
          const queue = allQueues.find((q: any) => q.id === session.queueId);
          const instanceId = queue?.whatsapp_instance_id || queue?.whatsappInstanceId || 'default';
          const phone = session.customerPhone.replace(/\D/g, '');

          if (phone) {
            fetch('/api/whatsapp/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: safeJsonStringify({ instanceId, to: phone, message: newMessage.text }),
            })
              .then(async (res) => {
                if (!res.ok) {
                  const body = await res.json().catch(() => ({}));
                  console.error('WhatsApp send failed:', body.error || res.statusText);
                  toast.warning('Mensagem salva, mas não foi enviada no WhatsApp.');
                }
              })
              .catch(error => console.error('Failed to send real WhatsApp message:', error));
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
      const sessionId = await createChatSession({
        customerId: crypto.randomUUID(),
        customerName: newChatName || newChatNumber,
        customerPhone: newChatNumber,
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

      await supabase.from('tickets').insert({
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
        .update({ status: 'closed' })
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

  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col items-end">
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
            <div className="bg-indigo-600 p-6 flex justify-between items-center text-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md">
                  <MessageCircle size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-white">
                    {isCustomer ? 'Suporte Omni' : 'WhatsApp Omni'}
                  </h3>
                  <p className="text-[10px] text-indigo-100 font-bold uppercase tracking-widest">
                    {isCustomer ? 'Fale Conosco' : 'Central de Atendimento'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="p-2 hover:bg-white/10 rounded-xl transition-all"
                >
                  {isExpanded ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
                </button>
                <button 
                  onClick={() => setIsMinimized(true)}
                  className="p-2 hover:bg-white/10 rounded-xl transition-all"
                >
                  <ChevronDown size={20} />
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
                  <div className="p-4 border-b border-slate-100 space-y-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                      <input 
                        type="text" 
                        placeholder="Buscar conversas..." 
                        className="w-full bg-slate-50 border border-slate-100 rounded-xl pl-9 pr-4 py-2 text-xs font-bold outline-none"
                      />
                    </div>
                    <button 
                      onClick={() => setIsNewChatModalOpen(true)}
                      className="w-full py-2.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-indigo-100 transition-all"
                    >
                      <Plus size={14} /> Novo WhatsApp
                    </button>

                    <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
                      <button 
                        onClick={() => setChatFilter('all')}
                        className={cn(
                          "flex-1 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all",
                          chatFilter === 'all' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400"
                        )}
                      >
                        Todos
                      </button>
                      <button 
                        onClick={() => setChatFilter('queue')}
                        className={cn(
                          "flex-1 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all",
                          chatFilter === 'queue' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400"
                        )}
                      >
                        Fila
                      </button>
                      <button 
                        onClick={() => setChatFilter('me')}
                        className={cn(
                          "flex-1 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all",
                          chatFilter === 'me' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400"
                        )}
                      >
                        Meus
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-2">
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
                                "w-full text-left p-4 rounded-2xl transition-all group flex items-center justify-between border",
                                selectedChatId === s.id 
                                  ? "bg-indigo-50 border-indigo-100 shadow-sm" 
                                  : "bg-slate-50 border-slate-100 hover:border-indigo-100 shadow-none"
                              )}
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 relative">
                                  <User size={18} />
                                  {sessionUnread > 0 && (
                                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[8px] font-black flex items-center justify-center rounded-full border-2 border-white">
                                      {sessionUnread > 9 ? '9+' : sessionUnread}
                                    </span>
                                  )}
                                </div>
                                <div>
                                  <p className="text-xs font-black text-slate-800 uppercase tracking-tight">{s.customerName}</p>
                                  {company && (
                                    <p className="text-[9px] text-indigo-600 font-bold uppercase tracking-widest">{company.name}</p>
                                  )}
                                  <p className="text-[10px] text-slate-400 font-medium">{s.status === 'pending' ? 'Ÿ¡ Aguardando' : 'Ÿ¢ Em curso'}</p>
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
                  <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {!isExpanded && (
                        <button onClick={() => setSelectedChatId(null)} className="text-indigo-600 p-2 hover:bg-indigo-50 rounded-xl transition-all">
                          <ChevronDown size={20} className="rotate-90" />
                        </button>
                      )}
                      <div>
                        <p className="text-xs font-black uppercase text-slate-800 tracking-widest leading-none mb-0.5">
                          {isCustomer ? 'Time de Suporte' : (selectedChat && 'customerName' in selectedChat ? selectedChat.customerName : 'Canal')}
                        </p>
                        {(() => {
                           if (isCustomer) return (
                             <span className="text-[10px] text-emerald-500 font-black uppercase tracking-tighter">
                               Sempre disponível
                             </span>
                           );
                           
                           const contact = allUsers.find(u => 
                             u.id === selectedChat?.customerId || 
                             (selectedChat?.customerPhone && (u.phone === selectedChat.customerPhone || u.phone === selectedChat.customerPhone.replace(/\D/g, '') || u.phone?.replace(/\D/g, '') === selectedChat.customerPhone.replace(/\D/g, '')))
                           );
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
                    
                    {!isCustomer && (
                      <button 
                        onClick={() => {
                          const now = new Date();
                          const datePrefix = now.toLocaleDateString('pt-BR');
                          const timePrefix = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                          setTicketTitle(`Atendimento ${datePrefix} ${timePrefix}: ${selectedChat?.customerName}`);
                          setIsFinishModalOpen(true);
                        }}
                        className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center gap-2"
                      >
                        <TicketIcon size={14} /> Finalizar
                      </button>
                    )}
                  </div>

                  {/* Messages Area */}
                  <div 
                    ref={scrollRef} 
                    onScroll={handleScroll}
                    className="flex-1 overflow-y-auto p-8 space-y-6 bg-slate-50/30 scroll-smooth"
                  >
                    {selectedChat?.messages?.map((m) => (
                      <div key={m.id} className={cn("flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300", m.senderId === currentUser.id ? "items-end" : "items-start")}>
                        <div className={cn(
                          "max-w-[70%] p-4 rounded-[1.5rem] text-sm font-medium shadow-sm transition-all",
                          m.senderId === currentUser.id 
                            ? "bg-indigo-600 text-white rounded-tr-none" 
                            : "bg-white border border-slate-100 text-slate-800 rounded-tl-none"
                        )}>
                          {m.text}
                        </div>
                        <span className="text-[9px] text-slate-400 font-black uppercase mt-1.5 px-1 tracking-widest">
                          {m.senderId === currentUser.id ? 'Você' : m.senderName} • {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Input Area */}
                  <div className="p-6 bg-white border-t border-slate-100 relative">
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
<form onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }} className="flex items-center gap-3">
                      <input 
                        type="text" 
                        value={message}
                        onChange={handleInputChange}
                        placeholder="Resposta padrão '/' para atalhos..." 
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
                      />
                      <button 
                        type="submit"
                        className="w-14 h-14 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 flex items-center justify-center"
                      >
                        <Send size={20} />
                      </button>
                    </form>
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
                         <span className="text-[9px] text-slate-400 font-medium">O chamado será criado com status &quot;Concluído&quot;</span>
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
          setAllUsers(MockDB.getUsers());
          setCustomerSessions(MockDB.getChatSessions());
        }}
      />

      {/* Launcher Button */}
      <button 
        onClick={() => setIsMinimized(!isMinimized)}
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
    </div>
  );
}


