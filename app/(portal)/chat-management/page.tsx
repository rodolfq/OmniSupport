'use client';

import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  ChatSession,
  AnalystStatus,
  User,
  UserRole,
  Company,
  QuickNote,
  Attachment,
  Permission
} from '@/lib/types';
import { isAudioAttachment } from '@/lib/attachment-kind';
import {
  MessageSquare,
  Users,
  Zap,
  Search,
  Plus,
  Trash2,
  Edit2,
  ArrowRightLeft,
  Power,
  CheckCircle2,
  XCircle,
  LayoutGrid,
  History,
  Calendar,
  Filter,
  User as UserIcon,
  X,
  Check,
  Building2,
  Phone,
  Ticket as TicketIcon,
  Lock
} from 'lucide-react';
import { cn, normalizeString, maskPhone, matchPhones } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '@/app/app-context';
import { LinkContactModal } from '@/components/link-contact-modal';
import { AssignChatMenu } from '@/components/assign-chat-menu';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { supabase } from '@/lib/supabase';
import { fetchChatSessions, saveChatHistory } from '@/lib/services/chat-service';
import { fetchUsers } from '@/lib/services/config-service';
import { getQuickNotes, saveQuickNote as saveQuickNoteAction, deleteQuickNote, getAnalysts, getCompanies, updateUserStatus, saveTicketFromChatSession, closeChatSessionAfterTicket, assignChatSession, returnChatSessionToQueue } from '@/app/actions';

export default function ChatManagementPage() {
  const { currentUser, setActiveOmniChatId, setIsOmniChatOpen, refreshTrigger, userStatus, getContactPhoto, ensureContactPhoto, hasPermission } = useApp();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [statuses, setStatuses] = useState<AnalystStatus[]>([]);
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [analysts, setAnalysts] = useState<User[]>([]);
  const [customers, setCustomers] = useState<User[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeTab, setActiveTab] = useState<'queue' | 'analysts' | 'notes' | 'history'>('queue');
  const [queueFilter, setQueueFilter] = useState<'all' | 'me' | 'queue'>('all');
  const [userQueues, setUserQueues] = useState<string[]>([]);
  const [allQueues, setAllQueues] = useState<any[]>([]);

  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [selectedSessionForLink, setSelectedSessionForLink] = useState<ChatSession | null>(null);

  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());

  const channelRef = useRef<any>(null);

  const handleOpenLinkModal = (session: ChatSession) => {
    setSelectedSessionForLink(session);
    setIsLinkModalOpen(true);
  };
// ... rest of the component


  // Filter states
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterAnalyst, setFilterAnalyst] = useState('');
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterText, setFilterText] = useState('');

  // Form states
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [selectedNote, setSelectedNote] = useState<QuickNote | null>(null);
  const [noteShortcut, setNoteShortcut] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteCategory, setNoteCategory] = useState('');
  const [disconnectingUser, setDisconnectingUser] = useState<User | null>(null);
  const [deletingNote, setDeletingNote] = useState<QuickNote | null>(null);

  const refreshData = React.useCallback(async (sync = false) => {
    // Mesma fonte de dados usada pelo widget de chat (/api/chats?action=sessions),
    // garantindo que as duas telas sempre mostrem exatamente as mesmas conversas.
    try {
      const chatData = await fetchChatSessions();
      setSessions(chatData);
    } catch (err) {
      console.error('Error fetching chat sessions:', err);
    }

    // Get analyst statuses
    const { data: statusData, error: statusError } = await supabase.from('analyst_status').select('*');
    if (statusError) {
      console.error('Error fetching analyst statuses:', statusError);
    }
    setStatuses(statusData || []);
    
    // Get quick notes via action
    const notesData = await getQuickNotes();
    setNotes(notesData);
    
    // Get analysts and customers
    const analystsData = await getAnalysts();
    setAnalysts(analystsData);
    
    // Get customers (users with role 'Cliente') via /api/users — o select cru
    // do shim do Supabase devolve as colunas em snake_case (avatar_url), sem
    // mapear pra avatarUrl como o resto do app espera; isso fazia a foto do
    // contato sempre cair no ícone genérico aqui, mesmo quando o perfil tinha
    // avatar_url cadastrado (o widget de chat, que já usa fetchUsers, mostrava
    // a foto certinho — a inconsistência era só nesta tela).
    const allUsersData = await fetchUsers();
    setCustomers((allUsersData || []).filter((u: any) => u.role === UserRole.CUSTOMER));
    
    // Get companies
    const companiesData = await getCompanies();
    setCompanies(companiesData);

    if (currentUser) {
      const { data: queuesData } = await supabase.from('queues').select('id, name, member_ids, whatsapp_instance_id');
      const myQueues = queuesData?.filter((q: any) => q.member_ids?.includes(currentUser.id)).map((q: any) => q.id) || [];
      setUserQueues(myQueues);
      setAllQueues(queuesData || []);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (currentUser?.role === UserRole.CUSTOMER) {
      window.location.href = '/my-tickets';
      return;
    }
    refreshData(true);
  }, [refreshTrigger, currentUser?.id, refreshData]);

  // Mantém a fila sincronizada com o widget de chat (mesmo intervalo/estratégia de polling).
  useEffect(() => {
    if (!currentUser || currentUser.role === UserRole.CUSTOMER) return;

    const loadWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshData();
    };
    const interval = setInterval(loadWhenVisible, 30000);
    document.addEventListener('visibilitychange', loadWhenVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', loadWhenVisible);
    };
  }, [currentUser, refreshData]);

  const getSessionInstanceId = React.useCallback((session?: { queueId?: string }) => {
    const queue = allQueues.find((q: any) => q.id === session?.queueId);
    return queue?.whatsapp_instance_id || queue?.whatsappInstanceId || 'default';
  }, [allQueues]);

  // Cache de foto de contato compartilhado com as demais telas (ex: widget de chat)
  useEffect(() => {
    sessions
      .filter(s => s.status !== 'closed' && s.customerPhone)
      .forEach(s => ensureContactPhoto(s.customerPhone, getSessionInstanceId(s)));
  }, [sessions, getSessionInstanceId, ensureContactPhoto]);

  const visibleQueueSessions = React.useMemo(() => {
    return sessions
      .filter(s => s?.status !== 'closed')
      .filter(s => {
        if (queueFilter === 'all') return true;
        if (queueFilter === 'me') return s.assigneeId === currentUser?.id;
        // "Minha Fila": todo chat (pendente ou já em atendimento, de qualquer
        // analista) que pertence a QUALQUER fila — não só as que o usuário
        // logado é formalmente membro (ex: um admin que acompanha tudo mas
        // não está cadastrado em nenhuma fila específica não pode ver a aba
        // inteira vazia). Inclui também os próprios chamados do usuário mesmo
        // sem queueId (ex: pool combinado).
        if (queueFilter === 'queue') return !!s.queueId || s.assigneeId === currentUser?.id;
        return true;
      });
  }, [sessions, queueFilter, currentUser?.id, userQueues]);

  useEffect(() => {
    setSelectedSessionIds(prev => {
      const validIds = new Set(sessions.map(s => s.id));
      const next = new Set([...prev].filter(id => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [sessions]);

  const isSubscribedRef = useRef(false);

  useEffect(() => {
    if (supabase && currentUser) {
      if (isSubscribedRef.current) return;
      
      // 1. Cleanup existing channel
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

      const channelName = `chat-management-sync-${Date.now()}`;
      console.log(`📡 Realtime ativo: ${channelName}`);
      isSubscribedRef.current = true;
      
      // 2. Define channel and event listeners BEFORE subscribe
      const channel = supabase.channel(channelName)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'chat_sessions' },
          async () => {
            console.log('📋 Atualizando fila via Realtime');
            refreshData();
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'analyst_status' },
          async () => {
            console.log('📋 Atualizando status via Realtime');
            refreshData();
          }
        );

      // 3. Subscribe
      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          console.log(`✅ Realtime Gerenciamento conectado: ${channelName}`);
        }
      });
      channelRef.current = channel;
    }

    return () => {
      if (channelRef.current && supabase) {
        console.log('🔌 Desconectando Realtime Gerenciamento');
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
        isSubscribedRef.current = false;
      }
    };
  }, [currentUser, refreshData]);

  const handleToggleOnline = async (userId: string, current: boolean) => {
    await updateUserStatus(userId, !current);
    refreshData();
  };

const handleDisconnect = async (userId: string) => {
    await updateUserStatus(userId, false);
    refreshData();
  };

const handleDeleteNote = async () => {
    if (!deletingNote) return;
    await deleteQuickNote(deletingNote.id);
    setDeletingNote(null);
    refreshData();
  };

  const handleSaveNote = async () => {
    if (!noteShortcut || !noteContent) return;
    await saveQuickNoteAction(selectedNote?.id || null, noteShortcut.replace('/', ''), noteContent, noteCategory || 'Geral');
    setIsNoteModalOpen(false);
    refreshData();
  };

  const handleOpenNoteModal = (note?: QuickNote) => {
    if (note) {
      setSelectedNote(note);
      setNoteShortcut(note.shortcut);
      setNoteContent(note.content);
      setNoteCategory(note.category);
    } else {
      setSelectedNote(null);
      setNoteShortcut('');
      setNoteContent('');
      setNoteCategory('');
    }
    setIsNoteModalOpen(true);
  };

  const handleAssignAnalyst = async (sessionId: string, targetUserId?: string) => {
    if (!currentUser) return;
    const assigneeId = targetUserId || currentUser.id;
    if (!targetUserId && userStatus !== 'online') {
      toast.error('Você precisa estar Online para assumir atendimentos!');
      return;
    }
    const result = await assignChatSession(sessionId, assigneeId, currentUser.id);

    if (!('error' in result)) {
      refreshData();
      toast.success(targetUserId ? 'Atendimento transferido com sucesso!' : 'Atendimento assumido com sucesso!');
    } else {
      toast.error('Erro ao atualizar o atendimento.');
    }
  };

  const handleReturnToQueue = async (sessionId: string, queueId: string) => {
    if (!currentUser) return;
    const result = await returnChatSessionToQueue(sessionId, queueId, currentUser.id);

    if (!('error' in result)) {
      refreshData();
      toast.success('Atendimento devolvido para a fila!');
    } else {
      toast.error('Erro ao devolver o atendimento para a fila.');
    }
  };

  const handleBulkReturnToQueue = async (visibleSessions: ChatSession[], queueId: string) => {
    if (!currentUser) return;

    const idsToReturn = visibleSessions
      .filter(s => selectedSessionIds.has(s.id) && s.status !== 'closed')
      .map(s => s.id);

    if (idsToReturn.length === 0) {
      toast.info('Nenhum atendimento selecionado.');
      return;
    }

    const results = await Promise.all(idsToReturn.map(id => returnChatSessionToQueue(id, queueId, currentUser.id)));
    const failures = results.filter(r => 'error' in r).length;

    setSelectedSessionIds(new Set());
    refreshData();
    if (failures === 0) {
      toast.success(`${idsToReturn.length} atendimento(s) devolvido(s) para a fila!`);
    } else if (failures < idsToReturn.length) {
      toast.warning(`${idsToReturn.length - failures} de ${idsToReturn.length} atendimento(s) devolvido(s). Alguns falharam.`);
    } else {
      toast.error('Erro ao devolver os atendimentos selecionados.');
    }
  };

  const toggleSessionSelected = (sessionId: string) => {
    setSelectedSessionIds(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  const toggleSelectAllVisible = (visibleIds: string[]) => {
    setSelectedSessionIds(prev => {
      const allSelected = visibleIds.length > 0 && visibleIds.every(id => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        visibleIds.forEach(id => next.delete(id));
        return next;
      }
      return new Set([...prev, ...visibleIds]);
    });
  };

  const handleBulkAssign = async (visibleSessions: ChatSession[], targetUserId?: string) => {
    if (!currentUser) return;
    const assigneeId = targetUserId || currentUser.id;
    if (!targetUserId && userStatus !== 'online') {
      toast.error('Você precisa estar Online para assumir atendimentos!');
      return;
    }

    const idsToAssign = visibleSessions
      .filter(s => selectedSessionIds.has(s.id) && s.status !== 'closed')
      .map(s => s.id);

    if (idsToAssign.length === 0) {
      toast.info('Nenhum atendimento selecionado.');
      return;
    }

    const results = await Promise.all(idsToAssign.map(id => assignChatSession(id, assigneeId, currentUser.id)));
    const failures = results.filter(r => 'error' in r).length;

    setSelectedSessionIds(new Set());
    refreshData();
    if (failures === 0) {
      toast.success(`${idsToAssign.length} atendimento(s) ${targetUserId ? 'transferido(s)' : 'assumido(s)'} com sucesso!`);
    } else if (failures < idsToAssign.length) {
      toast.warning(`${idsToAssign.length - failures} de ${idsToAssign.length} atendimento(s) atualizado(s). Alguns falharam.`);
    } else {
      toast.error('Erro ao atualizar os atendimentos selecionados.');
    }
  };

  const onlineAssignTargets = React.useMemo(() => {
    return statuses
      .filter(s => s.isOnline)
      .map(s => analysts.find(a => a.id === s.userId))
      .filter((a): a is User => !!a)
      .map(a => ({ id: a.id, name: a.name }));
  }, [statuses, analysts]);

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

  const [isBulkFinishConfirmOpen, setIsBulkFinishConfirmOpen] = useState(false);
  const [isBulkFinishing, setIsBulkFinishing] = useState(false);

  const finishSession = async (session: ChatSession): Promise<boolean> => {
    try {
      // Histórico em texto puro só pro registro de métricas em chat_histories —
      // o chamado em si não recebe cópia da conversa (ver saveTicketFromChatSession
      // em app/actions.ts): ele só guarda a referência, e quem quiser ver a
      // conversa busca ao vivo em chat_messages pela sessão vinculada.
      const formattedChatLog = session.messages?.map(m => {
        const time = new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        // Mesmo tratamento de components/chat-widget.tsx: usa a transcrição
        // do áudio se ela já estiver pronta nesse instante.
        const attachments: Attachment[] = (m as any).attachments || (m as any).metadata?.attachments || [];
        const transcribedAudio = attachments.find(a => isAudioAttachment(a) && a.transcription);
        const text = transcribedAudio ? `[Áudio] "${transcribedAudio.transcription}"` : m.text;
        return `[${time}] ${m.senderName}: ${text}`;
      }).join('\n') || '';
      const chatHistoryText = `===== HISTÓRICO DO CHAT =====\n${formattedChatLog}\n===== FIM DO HISTÓRICO =====\n\nChat finalizado em: ${new Date().toLocaleString('pt-BR')}`;

      const now = new Date();
      const datePrefix = now.toLocaleDateString('pt-BR');
      const timePrefix = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const ticketTitle = `Atendimento ${datePrefix} ${timePrefix}: ${session.customerName || 'Cliente'}`;
      const assigneeId = session.assigneeId || currentUser?.id || null;

      const ticketResult = await saveTicketFromChatSession(session.id, ticketTitle, true);
      if ('error' in ticketResult) {
        console.error('Error creating ticket from session', session.id, ticketResult.error);
        return false;
      }

      const startedAt = session.startedAt ? new Date(session.startedAt) : new Date();
      const finishedAt = new Date();
      const durationSeconds = Math.floor((finishedAt.getTime() - startedAt.getTime()) / 1000);

      // Mensagens automáticas (type 'system': apresentação do operador, aviso
      // de chamado, encerramento/pesquisa) não contam como resposta real do
      // analista pra essa métrica.
      let firstResponseSeconds: number | undefined;
      if (session.messages && session.messages.length > 0) {
        const firstAnalystMsg = session.messages.find(m =>
          m.senderId !== session.customerId &&
          m.type !== 'system' &&
          m.text &&
          !m.text.includes('criou o grupo')
        );
        if (firstAnalystMsg?.timestamp) {
          firstResponseSeconds = Math.floor((new Date(firstAnalystMsg.timestamp).getTime() - startedAt.getTime()) / 1000);
        }
      }

      await saveChatHistory({
        sessionId: session.id,
        customerId: session.customerId,
        customerName: session.customerName,
        customerPhone: session.customerPhone,
        assigneeId,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationSeconds,
        firstResponseSeconds,
        transcript: chatHistoryText
      }).catch(err => console.error('Non-critical error saving chat history:', session.id, err));

      const closeResult = await closeChatSessionAfterTicket(session.id, null);
      if ('error' in closeResult) {
        console.error('Error closing session', session.id, closeResult.error);
        return false;
      }

      return true;
    } catch (e) {
      console.error('Unexpected error finishing session', session.id, e);
      return false;
    }
  };

  const handleBulkFinish = async (visibleSessions: ChatSession[]) => {
    const targets = visibleSessions.filter(s => selectedSessionIds.has(s.id) && s.status !== 'closed');
    if (targets.length === 0) {
      toast.info('Nenhum atendimento selecionado.');
      return;
    }

    setIsBulkFinishing(true);
    let successCount = 0;
    for (const session of targets) {
      const ok = await finishSession(session);
      if (ok) successCount++;
    }
    setIsBulkFinishing(false);

    setSelectedSessionIds(new Set());
    refreshData();

    if (successCount === targets.length) {
      toast.success(`${successCount} atendimento(s) encerrado(s) com sucesso!`);
    } else if (successCount > 0) {
      toast.warning(`${successCount} de ${targets.length} atendimento(s) encerrado(s). Alguns falharam — veja o console.`);
    } else {
      toast.error('Erro ao encerrar os atendimentos selecionados.');
    }
  };

  if (!hasPermission(Permission.OUTSIDE_QUEUE_VIEW)) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8 bg-[var(--surface-card)] rounded-2xl shadow-lg border border-[var(--border-default)]">
          <Lock size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-xl font-bold text-[var(--text-secondary)] mb-2">Acesso Negado</h2>
          <p className="text-[var(--text-tertiary)]">Você não tem permissão para acessar a central de atendimento.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-[var(--text-primary)] tracking-tight">Canais de Atendimento</h2>
          <p className="text-[var(--text-tertiary)] font-medium">Controle de atendimento via WhatsApp e notas rápidas</p>
        </div>
      </div>

      <div className="flex bg-[var(--border-default)]/50 p-1.5 rounded-3xl w-fit gap-1.5">
        <button 
          onClick={() => setActiveTab('queue')}
          className={cn(
            "px-8 py-3 rounded-2xl text-[10px] font-semibold uppercase tracking-widest transition-all gap-2 flex items-center relative",
            activeTab === 'queue' ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-lg" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          )}
        >
          <MessageSquare size={14} /> Fila de Espera
          {sessions.some(s => s.status === 'pending' && !s.assigneeId) && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-[var(--text-danger)] rounded-full border-2 border-[var(--border-default)] animate-pulse" />
          )}
        </button>
        <button 
          onClick={() => setActiveTab('analysts')}
          className={cn(
            "px-8 py-3 rounded-2xl text-[10px] font-semibold uppercase tracking-widest transition-all gap-2 flex items-center",
            activeTab === 'analysts' ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-lg" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          )}
        >
          <Users size={14} /> Analistas
        </button>
        <button 
          onClick={() => setActiveTab('notes')}
          className={cn(
            "px-8 py-3 rounded-2xl text-[10px] font-semibold uppercase tracking-widest transition-all gap-2 flex items-center",
            activeTab === 'notes' ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-lg" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          )}
        >
          <Zap size={14} /> Notas Rápidas
        </button>
        <button 
          onClick={() => setActiveTab('history')}
          className={cn(
            "px-8 py-3 rounded-2xl text-[10px] font-semibold uppercase tracking-widest transition-all gap-2 flex items-center",
            activeTab === 'history' ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-lg" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          )}
        >
          <History size={14} /> Histórico
        </button>
      </div>

      {activeTab === 'queue' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
              <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2.5rem] shadow-sm overflow-hidden">
                 <div className="p-8 border-b border-[var(--border-default)] flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                       <input
                         type="checkbox"
                         className="w-4 h-4 rounded border-[var(--border-default)] accent-[var(--accent)] cursor-pointer"
                         checked={visibleQueueSessions.length > 0 && visibleQueueSessions.every(s => selectedSessionIds.has(s.id))}
                         onChange={() => toggleSelectAllVisible(visibleQueueSessions.map(s => s.id))}
                         disabled={visibleQueueSessions.length === 0}
                         title="Selecionar todos"
                       />
                       <div>
                          <h3 className="text-sm font-black uppercase text-[var(--text-primary)] tracking-widest">Controle de Atendimentos</h3>
                          <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">Sessões pendentes e em curso</p>
                       </div>
                    </div>
                    <div className="flex bg-[var(--surface-pill)] p-1 rounded-2xl gap-1">
                       {[
                         { id: 'all', label: 'Todos' },
                         { id: 'queue', label: 'Minha Fila' },
                         { id: 'me', label: 'Comigo' }
                       ].map(f => (
                         <button
                           key={f.id}
                           onClick={() => setQueueFilter(f.id as any)}
                           className={cn(
                             "px-4 py-2 rounded-xl text-[10px] font-semibold uppercase tracking-widest transition-all",
                             queueFilter === f.id ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                           )}
                         >
                           {f.label}
                         </button>
                       ))}
                    </div>
                 </div>
                 {selectedSessionIds.size > 0 && (
                   <div className="px-8 py-3 bg-[var(--accent)]/10 border-b border-[var(--accent)]/20 flex items-center justify-between gap-4">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent-text)]">
                        {selectedSessionIds.size} selecionado(s)
                      </p>
                      <div className="flex items-center gap-2">
                         <AssignChatMenu
                           currentUserId={currentUser?.id}
                           isCurrentUserOnline={userStatus === 'online'}
                           onlineTargets={onlineAssignTargets}
                           onAssignToSelf={() => handleBulkAssign(visibleQueueSessions)}
                           onAssignToUser={(userId) => handleBulkAssign(visibleQueueSessions, userId)}
                           queues={queueMenuTargets}
                           onReturnToQueue={(queueId) => handleBulkReturnToQueue(visibleQueueSessions, queueId)}
                           selfLabel="Assumir selecionados"
                         />
                         <button
                           onClick={() => setIsBulkFinishConfirmOpen(true)}
                           disabled={isBulkFinishing}
                           className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-semibold uppercase tracking-widest hover:bg-slate-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                         >
                           <TicketIcon size={13} /> {isBulkFinishing ? 'Encerrando...' : 'Finalizar selecionados'}
                         </button>
                         <button
                           onClick={() => setSelectedSessionIds(new Set())}
                           className="px-4 py-2 bg-[var(--surface-card)] text-[var(--text-tertiary)] rounded-xl text-[10px] font-semibold uppercase tracking-widest hover:bg-[var(--surface-pill)] transition-all border border-[var(--border-default)]"
                         >
                           Limpar seleção
                         </button>
                      </div>
                   </div>
                 )}
                  <div className="divide-y divide-[var(--border-default)]">
                     {visibleQueueSessions.length === 0 ? (
                       <div className="p-20 text-center text-[var(--text-tertiary)]">
                          <MessageSquare size={48} className="mx-auto mb-4 opacity-20" />
                          <p className="text-sm font-bold">Nenhum atendimento corresponde aos filtros</p>
                       </div>
                     ) : (
                       visibleQueueSessions.map(s => (
                         (() => {
                           const contact = customers.find(c =>
                              c.id === s.customerId ||
                              matchPhones(c.phone, s.customerPhone) || (c.phones && c.phones.some(p => matchPhones(p, s.customerPhone)))
                            );
                           const company = contact ? companies.find(comp => comp.id === contact.companyId) : null;
                           const displayName = s.customerName || contact?.name || (s.customerPhone && maskPhone(s.customerPhone)) || 'Contato sem nome';
                           const photo = contact?.avatarUrl || getContactPhoto(s.customerPhone, getSessionInstanceId(s));
                           return (
                         <div key={s.id} className="p-6 flex items-center justify-between hover:bg-[var(--surface-card)] transition-all">
                            <div className="flex items-center gap-4">
                               <input
                                 type="checkbox"
                                 className="w-4 h-4 rounded border-[var(--border-default)] accent-[var(--accent)] cursor-pointer"
                                 checked={selectedSessionIds.has(s.id)}
                                 onChange={() => toggleSessionSelected(s.id)}
                               />
                               <div className={cn(
                                 "w-12 h-12 rounded-2xl flex items-center justify-center relative overflow-hidden",
                                 s.status === 'pending' ? "bg-[var(--surface-warning)] text-[var(--text-warning)] border-2 border-amber-300 animate-pulse" : "bg-[var(--surface-success)] text-[var(--text-success)]"
                               )}>
                                  {photo ? (
                                    <img src={photo} alt={displayName} className="w-full h-full object-cover" />
                                  ) : (
                                    <UserIcon size={24} />
                                  )}
                                  <div className={cn(
                                    "absolute -top-1 -right-1 w-4 h-4 rounded-full border-2 border-white shadow-sm",
                                    s.status === 'pending' ? "bg-[var(--text-warning-strong)]" : "bg-[var(--text-success)]"
                                  )} />
                               </div>
                               <div>
                                  <div className="flex items-center gap-2">
                                     <div className="flex flex-col">
                                        <p className="font-black text-[var(--text-primary)] leading-tight flex items-center gap-2">
                                          {displayName}
                                          {s.status === 'pending' && (
                                            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-[var(--surface-danger)] text-[var(--text-danger)] text-[8px] font-semibold rounded border border-[var(--text-danger)]/20">
                                              AGUARDANDO
                                            </span>
                                          )}
                                        </p>
                                        {company ? (
                                          <p className="text-[10px] text-[var(--accent-text)] font-bold uppercase tracking-widest">{company.name}</p>
                                        ) : (
                                          <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest italic">Sem Empresa</p>
                                        )}
                                     </div>
                                     <span className={cn(
                                       "text-[8px] font-semibold uppercase px-2 py-0.5 rounded self-start",
                                       s.status === 'pending' ? "bg-[var(--surface-warning)] text-[var(--text-warning)]" : "bg-[var(--surface-success)] text-[var(--text-success)]"
                                     )}>
                                       {s.status === 'pending' ? 'Pendente' : 'Em Curso'}
                                     </span>
                                  </div>
                                  <p className="text-xs text-[var(--text-tertiary)] mt-1">Iniciado em {s.startedAt ? new Date(s.startedAt).toLocaleTimeString() : '-'}</p>
                               </div>
                            </div>
                             <div className="flex items-center gap-2">
                                {s.assigneeId && (
                                   <div className="flex flex-col items-end mr-4">
                                      <p className="text-[9px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest leading-none mb-1">Analista</p>
                                      <p className="text-xs font-bold text-[var(--text-secondary)]">
                                         {analysts.find(a => a.id === s.assigneeId)?.name || 'Desconhecido'}
                                      </p>
                                   </div>
                                )}
                                 {!s.customerId && !customers.some(c => 
                                   matchPhones(c.phone, s.customerPhone) || 
                                   (c.phones && c.phones.some(p => matchPhones(p, s.customerPhone)))
                                 ) && (
                                   <button 
                                     onClick={() => handleOpenLinkModal(s)}
                                     className="flex items-center gap-2 px-4 py-2.5 bg-[var(--surface-pill)] text-[var(--text-secondary)] rounded-xl text-[10px] font-semibold uppercase tracking-widest hover:bg-[var(--border-default)] transition-all border border-[var(--border-default)]"
                                   >
                                      <ArrowRightLeft size={14} /> Vincular
                                   </button>
                                )}
                                {s.status === 'pending' ? (
                                  <AssignChatMenu
                                    currentUserId={currentUser?.id}
                                    isCurrentUserOnline={userStatus === 'online'}
                                    onlineTargets={getQueueOnlineTargets(s.queueId)}
                                    onAssignToSelf={() => handleAssignAnalyst(s.id)}
                                    onAssignToUser={(userId) => handleAssignAnalyst(s.id, userId)}
                                    queues={queueMenuTargets}
                                    currentQueueId={s.queueId}
                                    onReturnToQueue={(queueId) => handleReturnToQueue(s.id, queueId)}
                                  />
                                ) : (
                                  <>
                                    <button
                                      onClick={() => {
                                         setActiveOmniChatId(s.id);
                                         setIsOmniChatOpen(true);
                                      }}
                                      className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-semibold uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg"
                                    >
                                       <MessageSquare size={14} /> Abrir Chat
                                    </button>
                                    <AssignChatMenu
                                      currentUserId={currentUser?.id}
                                      isCurrentUserOnline={userStatus === 'online'}
                                      onlineTargets={getQueueOnlineTargets(s.queueId)}
                                      onAssignToUser={(userId) => handleAssignAnalyst(s.id, userId)}
                                      queues={queueMenuTargets}
                                      currentQueueId={s.queueId}
                                      onReturnToQueue={(queueId) => handleReturnToQueue(s.id, queueId)}
                                      showSelf={false}
                                    />
                                  </>
                                )}
                             </div>
                         </div>
                           );
                         })()
                       ))
                     )}
                  </div>
              </div>
          </div>
          
          <div className="space-y-6">
             <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2.5rem] shadow-sm p-8">
                <h3 className="text-sm font-black uppercase text-[var(--text-primary)] tracking-widest mb-6">Distribuição Automática</h3>
                <div className="space-y-4">
                   <div className="flex items-center justify-between p-4 bg-[var(--surface-success)] border border-[var(--text-success)]/20 rounded-2xl">
                      <div className="flex items-center gap-3">
                         <Power size={18} className="text-[var(--text-success)]" />
                         <span className="text-xs font-black uppercase text-[var(--text-success)]">Sistema Ativo</span>
                      </div>
                      <div className="w-10 h-5 bg-[var(--text-success)] rounded-full relative">
                         <div className="absolute right-1 top-1 w-3 h-3 bg-[var(--surface-card)] rounded-full shadow-sm" />
                      </div>
                   </div>
                   <p className="text-[10px] text-[var(--text-tertiary)] font-medium leading-relaxed">
                      A distribuição está ativa. Novos atendimentos que chegarem pelo WhatsApp de uma fila são atribuídos automaticamente em rodízio (round-robin) entre os analistas online dessa fila.
                   </p>
                </div>
             </div>
          </div>
        </div>
      )}

      {activeTab === 'analysts' && (
        <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2.5rem] shadow-sm overflow-hidden">
           <table className="w-full text-left">
              <thead className="bg-[var(--surface-card)]/50">
                 <tr>
                    <th className="px-8 py-5 text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Analista</th>
                    <th className="px-8 py-5 text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Carga Atual</th>
                    <th className="px-8 py-5 text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Status</th>
                    <th className="px-8 py-5 text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest text-right">Ação</th>
                 </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]">
                 {statuses.map(s => {
                   const analyst = analysts.find(a => a.id === s.userId);
                   if (!analyst) return null;
                   return (
                     <tr key={s.userId} className="hover:bg-[var(--surface-card)]/50 transition-all">
                        <td className="px-8 py-5 font-bold text-[var(--text-primary)]">{analyst.name}</td>
                        <td className="px-8 py-5 text-sm">
                           <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-[var(--surface-pill)] rounded-full overflow-hidden w-24">
                                 <div className="h-full bg-[var(--accent)]" style={{ width: `${s.currentLoad * 20}%` }} />
                              </div>
                              <span className="text-[10px] font-bold text-[var(--text-tertiary)]">{s.currentLoad} chats</span>
                           </div>
                        </td>
                        <td className="px-8 py-5">
                           <button 
                             onClick={() => handleToggleOnline(s.userId, s.isOnline)}
                             className={cn(
                               "px-4 py-1.5 rounded-full text-[10px] font-semibold uppercase tracking-widest border transition-all flex items-center gap-2",
                               s.isOnline ? "bg-[var(--surface-success)] text-[var(--text-success)] border-[var(--text-success)]/20" : "bg-[var(--surface-card)] text-[var(--text-tertiary)] border-[var(--border-default)]"
                             )}
                           >
                              {s.isOnline ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                              {s.isOnline ? 'Disponível' : 'Ausente'}
                           </button>
                        </td>
                        <td className="px-8 py-5 text-right">
                           <button 
                             onClick={() => setDisconnectingUser(analyst)}
                             className="p-2 text-[var(--text-tertiary)] hover:text-[var(--text-danger)] transition-all"
                             title="Desconectar Analista"
                           >
                              <Power size={18} />
                           </button>
                        </td>
                     </tr>
                   );
                 })}
              </tbody>
           </table>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-6">
          {/* Filters Bar */}
          <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2.5rem] p-8 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <Filter size={18} className="text-[var(--accent-text)]" />
              <h3 className="text-sm font-black uppercase text-[var(--text-primary)] tracking-widest">Filtros de Pesquisa</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="space-y-1.5">
                <label className="text-[9px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">De</label>
                <div className="relative">
                  <Calendar size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                  <input 
                    type="date" 
                    value={filterStartDate}
                    onChange={(e) => setFilterStartDate(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl pl-10 pr-4 py-2.5 text-xs font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                  />
                </div>
              </div>
              
              <div className="space-y-1.5">
                <label className="text-[9px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Até</label>
                <div className="relative">
                  <Calendar size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                  <input 
                    type="date" 
                    value={filterEndDate}
                    onChange={(e) => setFilterEndDate(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl pl-10 pr-4 py-2.5 text-xs font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[9px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Analista</label>
                <input 
                  type="text" 
                  placeholder="Nome do analista..."
                  value={filterAnalyst}
                  onChange={(e) => setFilterAnalyst(e.target.value)}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-xs font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[9px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Cliente/Empresa</label>
                <input 
                  type="text" 
                  placeholder="Nome do cliente..."
                  value={filterCustomer}
                  onChange={(e) => setFilterCustomer(e.target.value)}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-xs font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[9px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Funcionário</label>
                <input 
                  type="text" 
                  placeholder="Nome do funcionário..."
                  value={filterEmployee}
                  onChange={(e) => setFilterEmployee(e.target.value)}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-xs font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[9px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Trecho da Mensagem</label>
                <div className="relative">
                  <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                  <input 
                    type="text" 
                    placeholder="Buscar conteúdo..."
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl pl-10 pr-4 py-2.5 text-xs font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                  />
                </div>
              </div>
            </div>
            
            {(filterStartDate || filterEndDate || filterAnalyst || filterCustomer || filterText) && (
              <div className="mt-4 flex justify-end">
                <button 
                  onClick={() => {
                    setFilterStartDate(''); setFilterEndDate(''); setFilterAnalyst(''); setFilterCustomer(''); setFilterText('');
                  }}
                  className="text-[9px] font-semibold uppercase text-[var(--text-danger)] hover:text-[var(--text-danger)] transition-all"
                >
                  Limpar Todos os Filtros
                </button>
              </div>
            )}
          </div>

          {/* Sessions List */}
          <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2.5rem] shadow-sm overflow-hidden">
            <div className="p-8 border-b border-[var(--border-default)] flex items-center justify-between bg-[var(--surface-card)]/50">
              <h3 className="text-sm font-black uppercase text-[var(--text-primary)] tracking-widest">Conversas Encerradas</h3>
              <span className="bg-[var(--border-default)] text-[var(--text-secondary)] px-3 py-1 rounded-full text-[10px] font-black">
                {sessions.filter(s => s.status === 'closed').length} Registros
              </span>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--surface-card)]/30">
                    <th className="px-8 py-4 text-[9px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Data/Hora</th>
                    <th className="px-8 py-4 text-[9px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Cliente</th>
                    <th className="px-8 py-4 text-[9px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Analista</th>
                    <th className="px-8 py-4 text-[9px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Última Mensagem</th>
                    <th className="px-8 py-4 text-[9px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-default)]">
                  {sessions
                    .filter(s => s.status === 'closed')
                    .filter(s => {
                      if (filterStartDate && new Date(s.startedAt) < new Date(filterStartDate)) return false;
                      if (filterEndDate) {
                        const end = new Date(filterEndDate);
                        end.setHours(23, 59, 59);
                        if (new Date(s.startedAt) > end) return false;
                      }
                      if (filterAnalyst) {
                        const analyst = analysts.find(a => a.id === s.assigneeId);
                        if (!analyst || !normalizeString(analyst.name).includes(normalizeString(filterAnalyst))) return false;
                      }
                      if (filterCustomer && !normalizeString(s.customerName).includes(normalizeString(filterCustomer))) return false;
                      if (filterEmployee && !normalizeString(s.customerName).includes(normalizeString(filterEmployee))) return false;
                      if (filterText) {
                         const normalText = normalizeString(filterText);
                         const hasText = s.messages?.some(m => normalizeString(m.text).includes(normalText));
                         if (!hasText) return false;
                      }
                      return true;
                    })
                    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
                    .map(s => {
                      const analyst = analysts.find(a => a.id === s.assigneeId);
                      const lastMsg = s.messages?.[s.messages.length - 1];
                      
                      return (
                        <tr key={s.id} className="hover:bg-[var(--surface-card)]/50 transition-all group">
                          <td className="px-8 py-5">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-[var(--text-secondary)]">{new Date(s.startedAt).toLocaleDateString()}</span>
                              <span className="text-[10px] text-[var(--text-tertiary)] font-medium">{new Date(s.startedAt).toLocaleTimeString()}</span>
                            </div>
                          </td>
                          <td className="px-8 py-5">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-[var(--surface-pill)] rounded-xl flex items-center justify-center text-[var(--text-tertiary)] font-bold text-[10px]">
                                {s.customerName.charAt(0)}
                              </div>
                              <span className="text-xs font-bold text-[var(--text-secondary)]">{s.customerName}</span>
                            </div>
                          </td>
                          <td className="px-8 py-5">
                            {analyst ? (
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-[var(--text-tertiary)]" />
                                <span className="text-xs font-medium text-[var(--text-secondary)]">{analyst.name}</span>
                              </div>
                            ) : (
                              <span className="text-[10px] uppercase text-slate-300 font-semibold tracking-widest italic">Não Atribuído</span>
                            )}
                          </td>
                          <td className="px-8 py-5">
                            <div className="max-w-[200px]">
                              <p className="text-[11px] text-[var(--text-tertiary)] truncate font-medium">
                                {lastMsg?.text || <span className="italic opacity-50">Sem mensagens</span>}
                              </p>
                              <p className="text-[9px] text-[var(--text-tertiary)] mt-0.5">Enviada por {lastMsg?.senderName}</p>
                            </div>
                          </td>
                          <td className="px-8 py-5 text-right">
                             <button className="px-4 py-2 bg-[var(--surface-card)] text-[var(--text-tertiary)] text-[9px] font-semibold uppercase tracking-widest rounded-xl hover:bg-[var(--accent)] hover:text-white transition-all group-hover:bg-[var(--surface-pill)] group-hover:text-[var(--text-secondary)]">
                               Ver Detalhes
                             </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              {sessions.filter(s => s.status === 'closed').length === 0 && (
                <div className="p-20 text-center text-[var(--text-tertiary)]">
                  <History size={48} className="mx-auto mb-4 opacity-20" />
                  <p className="text-sm font-bold">Nenhum atendimento encerrado até o momento</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'notes' && (
        <div className="space-y-6">
           <div className="flex justify-end">
              <button 
                onClick={() => handleOpenNoteModal()}
                className="bg-[var(--accent)] text-white px-6 py-3 rounded-2xl text-[10px] font-semibold uppercase tracking-widest shadow-lg shadow-indigo-100 flex items-center gap-2 hover:bg-[var(--accent-hover)] transition-all"
              >
                 <Plus size={16} /> Nova Nota Rápida
              </button>
           </div>
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {notes.map(note => (
                <div key={note.id} className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-8 shadow-sm flex flex-col justify-between group hover:shadow-xl hover:shadow-slate-200/50 transition-all transition-duration-300">
                   <div>
                      <div className="flex items-center justify-between mb-4">
                         <span className="bg-[var(--accent)]/10 text-[var(--accent-text)] px-4 py-1.5 rounded-xl text-[10px] font-semibold uppercase tracking-widest border border-[var(--accent)]/20">
                            /{note.shortcut}
                         </span>
                         <span className="text-[8px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">{note.category}</span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] font-medium leading-relaxed italic border-l-4 border-[var(--accent)]/20 pl-4 py-1">
                         &quot;{note.content}&quot;
                      </p>
                   </div>
                   <div className="mt-8 flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all">
                      <button onClick={() => handleOpenNoteModal(note)} className="p-3 bg-[var(--surface-card)] text-[var(--text-tertiary)] rounded-xl hover:text-[var(--accent-text)] hover:bg-[var(--accent)]/10 transition-all"><Edit2 size={16} /></button>
                      <button onClick={() => setDeletingNote(note)} className="p-3 bg-[var(--surface-card)] text-[var(--text-tertiary)] rounded-xl hover:text-[var(--text-danger)] hover:bg-[var(--surface-danger)] transition-all"><Trash2 size={16} /></button>
                   </div>
                </div>
              ))}
           </div>
        </div>
      )}

      <AnimatePresence>
        {isNoteModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               onClick={() => setIsNoteModalOpen(false)}
               className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
               initial={{ scale: 0.95, opacity: 0 }}
               animate={{ scale: 1, opacity: 1 }}
               exit={{ scale: 0.95, opacity: 0 }}
               className="relative bg-[var(--surface-card)] w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
               <div className="p-8 border-b border-[var(--border-default)] bg-[var(--surface-card)]/50 flex items-center justify-between">
                  <div>
                    <h3 className="text-2xl font-black text-[var(--text-primary)] tracking-tight">Atalho de Resposta</h3>
                    <p className="text-sm text-[var(--text-tertiary)] font-medium tracking-tight">Agilize o suporte usando atalhos &quot;/&quot;</p>
                  </div>
                  <button onClick={() => setIsNoteModalOpen(false)} className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"><XCircle size={28} /></button>
               </div>
               <div className="p-8 space-y-6">
                  <div className="space-y-1.5">
                     <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Atalho (sem a barra)</label>
                     <input 
                       type="text" 
                       value={noteShortcut}
                       onChange={(e) => setNoteShortcut(e.target.value)}
                       placeholder="ex: saudacao"
                       className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                     />
                  </div>
                  <div className="space-y-1.5">
                     <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Categoria</label>
                     <input 
                       type="text" 
                       value={noteCategory}
                       onChange={(e) => setNoteCategory(e.target.value)}
                       placeholder="Geral, Saudação, Encerramento..."
                       className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                     />
                  </div>
                  <div className="space-y-1.5">
                     <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Conteúdo da Resposta</label>
                     <textarea 
                       value={noteContent}
                       onChange={(e) => setNoteContent(e.target.value)}
                       rows={4}
                       placeholder="Digite o texto que será inserido automaticamente..."
                       className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all resize-none"
                     />
                  </div>
               </div>
               <div className="p-8 bg-[var(--surface-card)]/50 flex gap-4">
                  <button onClick={() => setIsNoteModalOpen(false)} className="flex-1 py-4 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] rounded-2xl transition-all">Cancelar</button>
                  <button onClick={handleSaveNote} className="flex-2 py-4 bg-[var(--accent)] text-white text-[10px] font-semibold uppercase tracking-widest rounded-2xl shadow-xl shadow-indigo-100 hover:bg-[var(--accent-hover)] transition-all">Salvar Atalho</button>
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <LinkContactModal 
        isOpen={isLinkModalOpen}
        onClose={() => { setIsLinkModalOpen(false); setSelectedSessionForLink(null); }}
        session={selectedSessionForLink}
        onSuccess={refreshData}
      />

      <ConfirmDialog
        isOpen={!!disconnectingUser}
        onClose={() => setDisconnectingUser(null)}
        onConfirm={() => {
          if (disconnectingUser) {
            handleDisconnect(disconnectingUser.id);
          }
        }}
        title="Desconectar Analista"
        description={`Deseja desconectar ${disconnectingUser?.name || 'este analista'}? Ele será marcado como ausente.`}
        confirmLabel="Desconectar"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={!!deletingNote}
        onClose={() => setDeletingNote(null)}
        onConfirm={handleDeleteNote}
        title="Excluir Nota Rápida"
        description="Deseja excluir esta nota rápida? Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={isBulkFinishConfirmOpen}
        onClose={() => setIsBulkFinishConfirmOpen(false)}
        onConfirm={() => handleBulkFinish(visibleQueueSessions)}
        title="Encerrar atendimentos selecionados"
        description={`Deseja encerrar ${selectedSessionIds.size} atendimento(s)? Um chamado será criado automaticamente para cada um, com o histórico da conversa.`}
        confirmLabel="Encerrar"
        variant="danger"
      />
    </div>
  );
}
