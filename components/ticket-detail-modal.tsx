'use client';

import React, { useState, useEffect, useRef } from 'react';
import { StyledSelect } from '@/components/styled-select';
import { X, User, MessageCircle, Clock, Link2, Paperclip, Save, Maximize2, Minimize2, Send, Lock, History, Download, File, Image as ImageIcon, Film, Loader2, Check } from 'lucide-react';
import { motion } from 'motion/react';
import { Ticket, TicketStatus, User as UserType, Message, UserRole, StatusConfig, Company, Attachment, PriorityConfig, CategoryConfig, InternalTicket, Permission } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { Star } from 'lucide-react';
import { toast } from 'sonner';
import { RichEditor } from './rich-editor';
import { AttachmentGallery, AttachmentPreviewModal, isImageAttachment, openAttachmentInNewTab } from './attachment-gallery';
import { LinkInternalTicketModal } from './link-internal-ticket-modal';
import { ChatAttachmentList } from './chat-attachment-list';
import { ClientTime } from './client-time';
import { TicketService, MessageService, InternalTicketService } from '@/lib/services/ticket-service';
import { fetchSessionMessages, SessionMessagesResult } from '@/lib/services/chat-service';
import { useAutoTranscribeMissingAudio } from '@/hooks/use-auto-transcribe-missing-audio';
import { UserService } from '@/lib/services/user-service';
import { CompanyService } from '@/lib/services/company-service';
import { ConfigService } from '@/lib/services/config-service';
import { getDefaultClosedTicketStatus, isClosedTicketStatus } from '@/lib/ticket-status';
import { FieldChange, formatChangeMessage } from '@/lib/ticket-diff';

interface TicketDetailModalProps {
  ticket: Ticket | null;
  onClose: () => void;
}

// Mesmo vocabulário de cor do Kanban em /internal-tickets — não inventa
// paleta nova pro mesmo conceito de status.
function internalStatusMeta(status?: string | null) {
  switch (status) {
    case 'Em Andamento':
    case 'Em Atendimento':
      return { label: 'Andamento', color: 'bg-[var(--surface-warning)] text-[var(--text-warning)]' };
    case 'Em Espera':
    case 'Pendente':
      return { label: status, color: 'bg-[var(--surface-pill)] text-[var(--text-secondary)]' };
    case 'Concluído':
    case 'Resolvido':
    case 'Fechado':
    case 'Encerrado':
      return { label: status, color: 'bg-[var(--surface-success)] text-[var(--text-success)]' };
    case 'Cancelado':
      return { label: status, color: 'bg-[var(--surface-danger)] text-[var(--text-danger)]' };
    default:
      return { label: status || 'Novo', color: 'bg-[var(--surface-info)] text-[var(--text-info)]' };
  }
}

export function TicketDetailModal({ ticket, onClose }: TicketDetailModalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { currentUser, hasPermission, triggerRefresh, suppressTicketAssignedNotification, notifications } = useApp();
  const isCustomer = currentUser?.role === UserRole.CUSTOMER;
  
  // States
  const [isFocused, setIsFocused] = useState(false);
  const [activeTab, setActiveTab] = useState<'description' | 'internal' | 'history' | 'attachments' | 'chat'>('description');
  const [chatSessionData, setChatSessionData] = useState<SessionMessagesResult | null>(null);
  const [isLoadingChatSession, setIsLoadingChatSession] = useState(false);
  const [historyTab, setHistoryTab] = useState<'customer' | 'internal'>('customer');
  // Só usado <md: os dois painéis (dados/conversa) não cabem lado a lado numa
  // tela de celular — alterna entre eles em vez de espremer os dois.
  const [mobilePanel, setMobilePanel] = useState<'details' | 'chat'>('details');
  const [message, setMessage] = useState('');
   const [messageAttachments, setMessageAttachments] = useState<Attachment[]>([]);
   const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
   const messageFileInputRef = useRef<HTMLInputElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [analysts, setAnalysts] = useState<UserType[]>([]);
  const [allUsers, setAllUsers] = useState<UserType[]>([]);
  const [statuses, setStatuses] = useState<StatusConfig[]>([]);
  const [categories, setCategories] = useState<CategoryConfig[]>([]);
  const [priorities, setPriorities] = useState<PriorityConfig[]>([]);
  const [employeeIds, setEmployeeIds] = useState<string[]>(ticket?.employeeIds || []);

  // ... (rest of memos)
  const allAttachments = React.useMemo(() => {
    if (!ticket) return [];
    const fromTicket = Array.isArray(ticket.attachments) ? ticket.attachments : [];
    const fromMessages = messages.flatMap(m => Array.isArray(m.attachments) ? m.attachments : []);
    
    // De-duplicate by ID or URL and skip empty objects
    const seen = new Set();
    return [...fromTicket, ...fromMessages].filter(att => {
      if (!att || typeof att !== 'object' || (!att.id && !att.url)) return false;
      const key = att.id || att.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [ticket, messages]);

  const [assigneeId, setAssigneeId] = useState(ticket?.assigneeId || '');
  const [ticketStatus, setTicketStatus] = useState(ticket?.status || TicketStatus.NEW);
  const [ticketDescription, setTicketDescription] = useState(ticket?.description || '');
  const [mainTeam, setMainTeam] = useState(ticket?.category || 'Suporte');
  const [mainPriority, setMainPriority] = useState(ticket?.priority || 'Média');
  const [mainTags, setMainTags] = useState(ticket?.tags || []);
  const [customerId, setCustomerId] = useState(ticket?.customerId || '');
  const [companyId, setCompanyId] = useState(ticket?.companyId || '');
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [companies, setCompanies] = useState<any[]>([]);
  const [internalTeams, setInternalTeams] = useState<Array<{id: string, name: string}>>([]);

  // Autosave do chamado principal: edições de campo (status, prioridade,
  // categoria, responsável, empresa, contato, colaboradores, tags) são
  // agrupadas por DEBOUNCE_MS antes de gravar, em vez de uma gravação (e uma
  // mensagem automática de WhatsApp pro cliente) por campo alterado.
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const pendingOverridesRef = useRef<Partial<Ticket>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // "De onde" o diff do histórico compara — começa no ticket recebido e
  // avança a cada gravação bem-sucedida, pra uma sequência de edições na
  // mesma sessão (A→B, depois B→A) gerar os dois registros corretos em vez
  // de comparar sempre contra o valor de quando o modal abriu.
  const lastSavedRef = useRef<Ticket | null>(ticket);
  const savedBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const DEBOUNCE_MS = 1200;

  // Internal Ticket States — um chamado pode ter vários tickets internos
  // vinculados (N:N via ticket_internal_links), então isso é sempre uma
  // lista, nunca um registro único.
  const [internalTickets, setInternalTickets] = useState<InternalTicket[]>([]);
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [itTitle, setItTitle] = useState('');
  const [itTeam, setItTeam] = useState('Desenvolvimento');
  const [itAssignee, setItAssignee] = useState('');
  const [itPriority, setItPriority] = useState(1);
  const [showLinkModal, setShowLinkModal] = useState(false);

  // Evita vazar os timers do autosave se o componente desmontar com uma
  // gravação agendada ainda não disparada.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (savedBadgeTimerRef.current) clearTimeout(savedBadgeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!ticket) return;

    async function fetchConfigs() {
      const { data: profiles } = await supabase.from('profiles').select('*, internal_team_ids');
      const { data: statusList } = await supabase.from('config_statuses').select('*');
      const { data: categoryList } = await supabase.from('config_categories').select('*');
      const { data: priorityList } = await supabase.from('config_priorities').select('*');
      const { data: compList } = await supabase.from('companies').select('*');
      const { data: teamList } = await supabase.from('internal_teams').select('*');

      if (profiles) {
        setAllUsers(profiles.map((u: any) => ({
          ...u, 
          companyId: u.company_id, 
          internalTeamIds: u.internal_team_ids,
          avatarUrl: u.avatar_url 
        })) as any);
        // Equipe: show all support team
        // Time Interno: show only members of their internal teams
        if (currentUser?.role === 'Time Interno' && currentUser?.internalTeamIds) {
          const userTeams = currentUser.internalTeamIds;
          setAnalysts(profiles.filter((u: any) => 
            u.role === 'Equipe' || u.is_admin || (userTeams && u.internal_team_ids?.some((t: string) => userTeams.includes(t)))
          ) as any);
        } else {
          setAnalysts(profiles.filter((u: any) => u.role === 'Equipe' || u.is_admin) as any);
        }
      }
      if (statusList) setStatuses(statusList as any);
      if (categoryList) setCategories(categoryList as any);
      if (priorityList) setPriorities(priorityList as any);
      if (compList) setCompanies(compList as any);
      if (teamList) setInternalTeams(teamList as any);
    }

    fetchConfigs();
    
    setAssigneeId(ticket.assigneeId || '');
    setTicketStatus(ticket.status);
    setTicketDescription(ticket.description);
    setMainTeam(ticket.category);
    setMainPriority(ticket.priority);
    setMainTags(ticket.tags || []);
    setCustomerId(ticket.customerId);
    setCompanyId(ticket.companyId || '');
    lastSavedRef.current = ticket;
    setEmployeeIds(ticket.employeeIds || []);
    loadMessages();
    loadInternalTickets();
    setChatSessionData(null);
    
    // Set default history tab based on role and permissions
    if (currentUser?.role === UserRole.EMPLOYEE) {
      setHistoryTab('customer');
    } else if (hasPermission(Permission.INTERNAL_TICKETS_VIEW) && !hasPermission(Permission.TICKETS_READ)) {
      setHistoryTab('internal');
    } else {
      setHistoryTab('customer');
    }

    // Revise default active tab based on permissions
    if (!hasPermission(Permission.TICKETS_READ) && hasPermission(Permission.INTERNAL_TICKETS_VIEW)) {
      setActiveTab('internal');
    } else {
      setActiveTab('description');
    }
  }, [ticket, currentUser, hasPermission]);

  useEffect(() => {
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current;
      requestAnimationFrame(() => {
        scrollContainer.scrollTo({
          top: scrollContainer.scrollHeight,
          behavior: 'smooth'
        });
      });
      setTimeout(() => {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }, 100);
    }
  }, [messages, historyTab]);

  if (!ticket) return null;

const loadMessages = async () => {
     if (ticket) {
       const msgs = await MessageService.getByTicket(ticket.id);
       setMessages(msgs);
     }
   };

   // Busca sob demanda (só quando a aba "Conversa" é aberta) — a maioria dos
   // chamados nunca chega a ter essa aba clicada, então não faz sentido buscar
   // o histórico do chat vinculado em todo carregamento do modal.
   const loadChatSessionMessages = async () => {
     if (!ticket?.chatSessionId || chatSessionData || isLoadingChatSession) return;
     setIsLoadingChatSession(true);
     try {
       const data = await fetchSessionMessages(ticket.chatSessionId);
       setChatSessionData(data);
     } catch (err) {
       console.error('Error loading linked chat session messages:', err);
       toast.error('Erro ao carregar o histórico da conversa.');
     } finally {
       setIsLoadingChatSession(false);
     }
   };

   // Mesma ideia do Histórico de Conversas: qualquer áudio dessa conversa
   // ainda sem transcrição é transcrito sozinho assim que a aba "Conversa" é
   // carregada, sem depender de clique manual.
   useAutoTranscribeMissingAudio(
     ticket?.chatSessionId,
     chatSessionData?.messages,
     (updater) => setChatSessionData(prev => prev ? { ...prev, messages: updater(prev.messages) } : prev)
   );

   const loadInternalTickets = async () => {
     if (!ticket) return;
     const list = await InternalTicketService.getByParentAll(ticket.id);
     setInternalTickets(list);
   };

   const resetCreateForm = () => {
     setItTitle(`Interno: ${ticket?.title || ''}`);
     setItTeam('Desenvolvimento');
     setItAssignee('');
     setItPriority(1);
   };

   const handleCreateInternalTicket = async () => {
      if (!currentUser || !ticket || !itTitle.trim()) return;
      const team = internalTeams.find(t => t.name === itTeam);
      const newIT: InternalTicket = {
        id: undefined,
        parentTicketId: ticket.id,
        parentTicketIds: [ticket.id],
        title: itTitle,
        teamId: itTeam,
        internalTeamId: team ? team.id : undefined,
        assigneeId: itAssignee || undefined,
        priority: itPriority,
        tags: [],
        creatorId: currentUser.id,
        description: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const savedId = await InternalTicketService.save(newIT, ticket.id);

      const msg: Message = {
        id: Math.random().toString(36).substr(2, 9),
        ticketId: ticket.id,
        senderId: currentUser.id,
        text: `Criou o ticket interno ${savedId}`,
        timestamp: new Date().toISOString(),
        isVisibleToCustomer: false,
        type: 'internal'
      };
      await MessageService.create(msg);
      loadMessages();
      await loadInternalTickets();
      setShowCreatePanel(false);
      toast.success('Ticket interno criado');
    };

    const handleLinkInternalTicket = async (internalTicketId: string) => {
      if (!ticket || !currentUser) return;

      try {
        await InternalTicketService.linkExisting(ticket.id, internalTicketId);
      } catch (error) {
        toast.error('Erro ao vincular ticket interno');
        return;
      }

      const msg: Message = {
        id: Math.random().toString(36).substr(2, 9),
        ticketId: ticket.id,
        senderId: currentUser.id,
        text: `Vinculou ao ticket interno ${internalTicketId}`,
        timestamp: new Date().toISOString(),
        isVisibleToCustomer: false,
        type: 'internal'
      };
      await MessageService.create(msg);
      loadMessages();
      await loadInternalTickets();
      setShowLinkModal(false);
      toast.success('Ticket interno vinculado com sucesso');
    };

    const handleUnlinkInternalTicket = async (internalTicketId: string, label: string) => {
      if (!ticket || !currentUser) return;
      try {
        await InternalTicketService.unlink(ticket.id, internalTicketId);
      } catch (error) {
        toast.error('Erro ao desvincular ticket interno');
        return;
      }

      const msg: Message = {
        id: Math.random().toString(36).substr(2, 9),
        ticketId: ticket.id,
        senderId: currentUser.id,
        text: `Desvinculou o ticket interno ${label}`,
        timestamp: new Date().toISOString(),
        isVisibleToCustomer: false,
        type: 'internal'
      };
      await MessageService.create(msg);
      loadMessages();
      await loadInternalTickets();
      toast.success('Ticket interno desvinculado');
    };

const handleSendMessage = async (isInternal: boolean) => {
      if (!message.trim() || !currentUser || !ticket) return;

      const newMessage: Message = {
        id: Math.random().toString(36).substr(2, 9),
        ticketId: ticket.id,
        senderId: currentUser.id,
        text: message,
        timestamp: new Date().toISOString(),
        isVisibleToCustomer: !isInternal,
        type: isInternal ? 'internal' : 'text',
        attachments: messageAttachments.length > 0 ? messageAttachments : undefined
      };

      await MessageService.create(newMessage);

      const updatedTicket: Ticket = {
        ...ticket,
        updatedAt: new Date().toISOString()
      };
      await TicketService.update(updatedTicket);

      setMessage('');
      setMessageAttachments([]);
      loadMessages();
      triggerRefresh();
    };

    const handleMessageFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      for (const file of files) {
        const fileId = Math.random().toString(36).substr(2, 9);
        const fileName = `${Date.now()}-${file.name}`;
        
        // Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase
          .storage
          .from('attachments')
          .upload(fileName, file);

        if (uploadError) {
          toast.error(`Erro ao fazer upload de ${file.name}`);
          continue;
        }

        const { data: { publicUrl } } = supabase
          .storage
          .from('attachments')
          .getPublicUrl(uploadData.path);

        setMessageAttachments(prev => [...prev, {
          id: fileId,
          name: file.name,
          type: file.type,
          url: publicUrl,
          size: file.size
        }]);
      }
      
      // Reset input
      if (messageFileInputRef.current) {
        messageFileInputRef.current.value = '';
      }
    };

  const flashSaved = () => {
    setSaveStatus('saved');
    if (savedBadgeTimerRef.current) clearTimeout(savedBadgeTimerRef.current);
    savedBadgeTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2500);
  };

  // Grava de fato no banco, usando os overrides acumulados em pendingOverridesRef
  // (mesclados com qualquer override passado na hora, para chamadas explícitas
  // que precisam garantir um valor específico mesmo que o debounce não tenha
  // capturado o evento ainda).
  const commitTicketSave = async (overrides: Partial<Ticket> = {}) => {
    if (!ticket) return;

    const merged = { ...pendingOverridesRef.current, ...overrides };
    pendingOverridesRef.current = {};
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    // Use values from overrides if provided, otherwise fallback to local state
    // We prioritize overrides to handle immediate updates from onChange events
    const statusToSave = merged.status || ticketStatus;
    const priorityToSave = merged.priority || mainPriority;
    const categoryToSave = merged.category || mainTeam;
    const assigneeToSave = 'assigneeId' in merged ? merged.assigneeId : assigneeId;
    const companyToSave = merged.companyId || companyId;
    const customerToSave = merged.customerId || customerId;
    const employeesToSave = merged.employeeIds || employeeIds;
    const descriptionToSave = merged.description !== undefined ? merged.description : ticketDescription;

    const updated: Ticket = {
      ...ticket,
      category: categoryToSave as string,
      priority: priorityToSave as any,
      assigneeId: assigneeToSave || undefined,
      customerId: customerToSave,
      companyId: companyToSave,
      employeeIds: employeesToSave,
      status: statusToSave as any,
      description: descriptionToSave,
      tags: mainTags,
      updatedAt: new Date().toISOString()
    };

    // Diff contra o último estado salvo nesta sessão (não contra o ticket de
    // quando o modal abriu) — vira uma mensagem de sistema na aba Histórico
    // (não aparece na Conversa, só registra pra consulta).
    const prev = lastSavedRef.current || ticket;
    const changes: FieldChange[] = [];
    if (statusToSave !== prev.status) {
      changes.push({ label: 'Estágio', from: prev.status, to: statusToSave as string });
    }
    if (priorityToSave !== prev.priority) {
      changes.push({ label: 'Prioridade', from: prev.priority, to: priorityToSave as string });
    }
    if (categoryToSave !== prev.category) {
      changes.push({ label: 'Equipe', from: prev.category || 'Sem equipe', to: categoryToSave || 'Sem equipe' });
    }
    if ((assigneeToSave || '') !== (prev.assigneeId || '')) {
      const fromName = prev.assigneeId ? (analysts.find(a => a.id === prev.assigneeId)?.name || 'alguém') : 'Não atribuído';
      const toName = assigneeToSave ? (analysts.find(a => a.id === assigneeToSave)?.name || 'alguém') : 'Não atribuído';
      changes.push({ label: 'Responsável', from: fromName, to: toName });
    }
    if ((companyToSave || '') !== (prev.companyId || '')) {
      const fromName = prev.companyId ? (companies.find(c => c.id === prev.companyId)?.name || 'alguém') : 'Nenhuma';
      const toName = companyToSave ? (companies.find(c => c.id === companyToSave)?.name || 'alguém') : 'Nenhuma';
      changes.push({ label: 'Cliente', from: fromName, to: toName });
    }
    if ((customerToSave || '') !== (prev.customerId || '')) {
      const fromName = prev.customerId ? (allUsers.find(u => u.id === prev.customerId)?.name || 'alguém') : 'Nenhum';
      const toName = customerToSave ? (allUsers.find(u => u.id === customerToSave)?.name || 'alguém') : 'Nenhum';
      changes.push({ label: 'Contato', from: fromName, to: toName });
    }

    setSaveStatus('saving');
    try {
      await TicketService.update(updated);
      lastSavedRef.current = updated;
      if (changes.length > 0 && currentUser) {
        await MessageService.create({
          id: Math.random().toString(36).substr(2, 9),
          ticketId: ticket.id,
          senderId: currentUser.id,
          text: formatChangeMessage(changes),
          timestamp: new Date().toISOString(),
          isVisibleToCustomer: false,
          type: 'system'
        });
        loadMessages();
      }
      triggerRefresh();
      flashSaved();
    } catch (err) {
      console.error('Erro ao salvar chamado:', err);
      setSaveStatus('error');
      toast.error('Erro ao salvar chamado. Tente novamente.');
    }
  };

  // Edições "silenciosas" (troca de campo em selects/botões): acumula e
  // espera DEBOUNCE_MS de inatividade antes de gravar, pra várias trocas em
  // sequência (ex.: categoria, depois responsável, depois prioridade) virarem
  // uma gravação só — e um evento de automação só, não um por campo.
  const scheduleTicketSave = (overrides: Partial<Ticket>) => {
    pendingOverridesRef.current = { ...pendingOverridesRef.current, ...overrides };
    setSaveStatus('saving');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { commitTicketSave(); }, DEBOUNCE_MS);
  };

  // Ações explícitas (botão Salvar, Assumir, Finalizar, fechar com edição
  // pendente): grava imediatamente, incorporando qualquer alteração ainda
  // não commitada pelo debounce.
  const flushTicketSave = (overrides: Partial<Ticket> = {}) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    return commitTicketSave(overrides);
  };

  const saveMainTicketDescription = async () => {
    if (ticket.description === ticketDescription) {
      setIsEditingDescription(false);
      return;
    }

    setSaveStatus('saving');
    try {
      const updated: Ticket = { ...ticket, description: ticketDescription, updatedAt: new Date().toISOString() };
      await TicketService.update(updated);
      lastSavedRef.current = updated;
      // Fica registrado, mas não vira mensagem visível — só entra na aba
      // Histórico ('system_log', igual ao ticket interno).
      if (currentUser) {
        await MessageService.create({
          id: Math.random().toString(36).substr(2, 9),
          ticketId: ticket.id,
          senderId: currentUser.id,
          text: 'Descrição atualizada',
          timestamp: new Date().toISOString(),
          isVisibleToCustomer: false,
          type: 'system_log'
        });
        loadMessages();
      }
      triggerRefresh();
      setIsEditingDescription(false);
      flashSaved();
    } catch (err) {
      console.error('Erro ao salvar descrição:', err);
      setSaveStatus('error');
      toast.error('Erro ao salvar descrição. Tente novamente.');
    }
  };

  const handleTakeTicket = async () => {
    if (!currentUser || !ticket) return;
    const nextStatus = ticket.status === TicketStatus.NEW ? TicketStatus.IN_PROGRESS : ticket.status;
    setAssigneeId(currentUser.id);
    setTicketStatus(nextStatus);
    suppressTicketAssignedNotification(ticket.id);
    flushTicketSave({
      assigneeId: currentUser.id,
      status: nextStatus
    });
  };

  const handleCompleteTicket = async () => {
    if (!ticket || !currentUser) return;
    const closedStatus = getDefaultClosedTicketStatus(statuses.map(s => s.label));
    setTicketStatus(closedStatus as any);
    await flushTicketSave({
      status: closedStatus as any,
      completedAt: new Date().toISOString()
    });
    onClose();
  };

  // Se houver uma edição agendada pelo debounce ainda não gravada, garante
  // que ela seja enviada antes de fechar o modal (em vez de perdê-la).
  const handleRequestClose = () => {
    if (saveTimerRef.current || Object.keys(pendingOverridesRef.current).length > 0) {
      flushTicketSave();
    }
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-[110] flex items-center justify-end">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleRequestClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
      />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className={cn(
          "relative bg-[var(--surface-card)] h-full shadow-2xl border-l border-[var(--border-default)] flex flex-col md:flex-row transition-all duration-500 ease-in-out",
          isFocused ? "w-full" : "w-full md:max-w-[90vw]"
        )}
      >
        {/* Alternador Detalhes/Conversa — só em telas <md, onde os dois
            painéis não cabem lado a lado */}
        <div className="md:hidden flex bg-[var(--surface-pill)] p-1 gap-1 border-b border-[var(--border-default)] shrink-0">
          <button
            onClick={() => setMobilePanel('details')}
            className={cn(
              "flex-1 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
              mobilePanel === 'details' ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-tertiary)]"
            )}
          >
            Detalhes
          </button>
          <button
            onClick={() => setMobilePanel('chat')}
            className={cn(
              "flex-1 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
              mobilePanel === 'chat' ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-tertiary)]"
            )}
          >
            Conversa
          </button>
        </div>

        {/* Left Side: Ticket Info */}
        <div className={cn(
          "flex-1 flex-col min-w-0 bg-[var(--surface-card)] overflow-y-auto md:overflow-visible",
          mobilePanel === 'details' ? "flex" : "hidden md:flex"
        )}>
          {/* Header Bar */}
          <div className="border-b border-[var(--border-default)] bg-[var(--surface-card)]/50">
            {/* Linha 1: identidade do chamado + ações */}
            <div className="px-8 pt-4 pb-2 flex items-center justify-between gap-6">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="text-xs font-black text-[var(--accent-text)] bg-[var(--accent)]/10 px-2 py-0.5 rounded tracking-widest shrink-0">#{ticket.ticketNumber ? String(ticket.ticketNumber).padStart(4, '0') : ticket.id.slice(0, 8)}</span>
                <span className="text-[var(--text-tertiary)] font-bold shrink-0">/</span>
                <span className="text-sm font-bold text-[var(--text-primary)] truncate min-w-0">{ticket.title}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {!isCustomer && (
                  <div className="flex items-center gap-2 pr-3 border-r border-[var(--border-default)]">
                    {!assigneeId && (
                      <button
                        onClick={handleTakeTicket}
                        className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-amber-100 transition-all"
                      >
                        Assumir
                      </button>
                    )}
                    {!isClosedTicketStatus(ticketStatus) && (
                      <button
                        onClick={handleCompleteTicket}
                        className="px-4 py-2 bg-[var(--text-success)] hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-emerald-100 transition-all"
                      >
                        Finalizar
                      </button>
                    )}
                    <button
                      onClick={() => flushTicketSave()}
                      className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-indigo-100 transition-all"
                    >
                      <Save size={16} />
                      Salvar
                    </button>
                    {saveStatus === 'saving' && (
                      <span className="flex items-center gap-1.5 text-[10px] font-bold text-[var(--text-tertiary)]">
                        <Loader2 size={12} className="animate-spin" /> Salvando...
                      </span>
                    )}
                    {saveStatus === 'saved' && (
                      <span className="flex items-center gap-1.5 text-[10px] font-bold text-[var(--text-success)] animate-in fade-in">
                        <Check size={12} /> Salvo
                      </span>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <button onClick={() => setIsFocused(!isFocused)} className="p-2 hover:bg-[var(--border-default)] rounded-xl transition-all text-[var(--text-tertiary)]">
                    {isFocused ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                  </button>
                  <button onClick={handleRequestClose} className="p-2 hover:bg-[var(--surface-danger)] rounded-xl transition-all text-[var(--text-tertiary)] hover:text-[var(--text-danger)]">
                    <X size={18} />
                  </button>
                </div>
              </div>
            </div>

            {/* Linha 2: status do chamado (linha própria, sem disputar espaço com os botões) */}
            {!isCustomer && (
              <div className="px-8 pb-3">
                {statuses.length > 0 ? (
                  <div className="inline-flex bg-[var(--surface-pill)] p-0.5 rounded-lg">
                    {statuses.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          setTicketStatus(s.label as any);
                          scheduleTicketSave({ status: s.label as any });
                        }}
                        className={cn(
                          "px-3 py-1 text-[10px] font-semibold uppercase rounded-md transition-all whitespace-nowrap",
                          ticketStatus === s.label ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-tertiary)] hover:bg-[var(--border-default)]/50"
                        )}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[var(--surface-pill)] animate-pulse">
                    <div className="w-9 h-3 rounded bg-[var(--border-default)]" />
                    <div className="w-9 h-3 rounded bg-[var(--border-default)]" />
                    <div className="w-9 h-3 rounded bg-[var(--border-default)]" />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Title Large */}
            <div className="px-8 py-8 space-y-6">
               <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tight leading-tight">{ticket.title}</h1>

               {/* Grid Info (Odoo style) */}
               {!isCustomer && hasPermission(Permission.TICKETS_READ) && (
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-4">
                    {/* Column 1 */}
                    <div className="space-y-3">
                       <div className="flex items-start gap-4">
                          <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5">Equipe</span>
                          <StyledSelect 
                            value={mainTeam}
                            onChange={(e) => {
                              const val = e.target.value;
                              setMainTeam(val);
                              scheduleTicketSave({ category: val });
                            }}
                            className="text-sm font-bold text-[var(--text-secondary)] bg-transparent border-none outline-none focus:ring-2 focus:ring-[var(--accent)]/10 rounded px-1 -ml-1 cursor-pointer hover:bg-[var(--surface-card)] transition-all"
                          >
                            {categories.map(cat => (
                              <option key={cat.id} value={cat.label}>{cat.label}</option>
                            ))}
                          </StyledSelect>
                       </div>
                       <div className="flex items-start gap-4">
                          <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5">Responsável</span>
                          <div className="flex items-center gap-2">
                             {hasPermission(Permission.TICKETS_ASSIGN) ? (
                               <StyledSelect
                                 value={assigneeId}
                                 onChange={(e) => {
                                   const val = e.target.value;
                                   setAssigneeId(val);
                                   if (val && val === currentUser?.id) suppressTicketAssignedNotification(ticket.id);
                                   scheduleTicketSave({ assigneeId: val });
                                 }}
                                 className="text-sm font-bold text-[var(--text-secondary)] bg-transparent border-none outline-none focus:ring-2 focus:ring-[var(--accent)]/10 rounded px-1 -ml-1 cursor-pointer hover:bg-[var(--surface-card)] transition-all"
                               >
                                 <option value="">Não atribuído</option>
                                 {analysts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                               </StyledSelect>
                             ) : (
                               <span className="text-sm font-bold text-[var(--text-secondary)]">
                                 {analysts.find(a => a.id === assigneeId)?.name || 'Não atribuído'}
                               </span>
                             )}
                          </div>
                       </div>
<div className="flex items-start gap-4">
                           <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5">Vencimento</span>
                           <div className="flex flex-col">
                             <span className={cn(
                               "text-sm font-bold",
                               (() => {
                                   const config = priorities.find(p => p.label === mainPriority);
                                   if (!config || !(config.sla_hours ?? config.slaHours)) return false;
                                   const limit = new Date(new Date(ticket.createdAt).getTime() + (config.sla_hours ?? config.slaHours) * 60 * 60 * 1000);
                                   return limit < new Date() && !isClosedTicketStatus(ticketStatus);
                                 })() ? "text-[var(--text-danger)]" : "text-[var(--text-secondary)]"
                             )}>
                               {(() => {
                                 const config = priorities.find(p => p.label === mainPriority);
                                 if (!config || !(config.sla_hours ?? config.slaHours)) return '---';
                                 const limit = new Date(new Date(ticket.createdAt).getTime() + (config.sla_hours ?? config.slaHours) * 60 * 60 * 1000);
                                 return limit.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                               })()}
                             </span>
                             {(() => {
                               const config = priorities.find(p => p.label === mainPriority);
                               if (!config || !(config.sla_hours ?? config.slaHours)) return false;
                               const limit = new Date(new Date(ticket.createdAt).getTime() + (config.sla_hours ?? config.slaHours) * 60 * 60 * 1000);
                               return limit < new Date() && !isClosedTicketStatus(ticketStatus);
                             })() && (
                               <span className="text-[10px] font-semibold text-[var(--text-danger)] uppercase tracking-tight">Prazo ultrapassado</span>
                             )}
                           </div>
                        </div>
                       <div className="flex items-start gap-4">
                          <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5">Prioridade</span>
                          <div className="flex items-center gap-0.5 pt-0.5">
                             {[1, 2, 3, 4].map((star) => {
                               // Priority mapping
                               const priorityLabels = ['Baixa', 'Média', 'Alta', 'Urgente'];
                               const currentStars = priorityLabels.indexOf(mainPriority) + 1;
                               
                               return (
                                <button 
                                  key={star}
                                  onClick={() => {
                                    const nextLabel = priorityLabels[star - 1];
                                    if (nextLabel === mainPriority) return;

                                    setMainPriority(nextLabel);
                                    scheduleTicketSave({ priority: nextLabel as any });
                                  }}
                                  className="hover:scale-110 transition-all focus:outline-none"
                                >
                                  <Star 
                                    size={14} 
                                    className={cn(
                                      "transition-colors",
                                      star <= currentStars ? "fill-amber-400 text-[var(--text-warning)]" : "text-slate-200"
                                    )} 
                                  />
                                </button>
                               );
                             })}
                          </div>
                       </div>
                    </div>

                    {/* Column 2 */}
                    <div className="space-y-3">
                       <div className="flex items-start gap-4">
                          <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5">Cliente</span>
                          <StyledSelect 
                             value={companyId}
                             onChange={(e) => {
                               const val = e.target.value;
                               setCompanyId(val);
                               let newCustomerId = customerId;
                               const currentCustomer = allUsers.find(u => u.id === customerId);
                               if (val && currentCustomer && currentCustomer.companyId !== val) {
                                 newCustomerId = '';
                                 setCustomerId('');
                               }
                               scheduleTicketSave({ companyId: val, customerId: newCustomerId });
                             }}
                             className="text-sm font-bold text-[var(--text-secondary)] bg-transparent border-none outline-none focus:ring-2 focus:ring-[var(--accent)]/10 rounded px-1 -ml-1 cursor-pointer hover:bg-[var(--surface-card)] transition-all"
                          >
                             <option value="">Selecione uma empresa</option>
                             {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </StyledSelect>
                       </div>
                       <div className="flex items-start gap-4">
                          <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5">Contato</span>
<StyledSelect 
                              value={customerId || ''}
                              onChange={(e) => {
                               const val = e.target.value;
                               setCustomerId(val);
                               scheduleTicketSave({ customerId: val });
                             }}
                             className="text-sm font-bold text-[var(--text-secondary)] bg-transparent border-none outline-none focus:ring-2 focus:ring-[var(--accent)]/10 rounded px-1 -ml-1 cursor-pointer hover:bg-[var(--surface-card)] transition-all"
                          >
                             <option value="">Selecione um contato</option>
                             {allUsers
                               .filter(u => (u.role === UserRole.EMPLOYEE) && (!companyId || u.companyId === companyId))
                               .map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </StyledSelect>
                       </div>
                       <div className="flex items-start gap-4">
                          <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5">Telefone</span>
                          <span className="text-sm font-medium text-[var(--text-tertiary)]">{allUsers.find(u => u.id === customerId)?.phone || 'Não informado'}</span>
                       </div>
                       <div className="flex items-start gap-4">
                          <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5">Colaboradores</span>
                          <div className="flex flex-col gap-2 flex-1">
                             <div className="flex flex-wrap gap-1">
                                {employeeIds.map(empId => {
                                   const emp = allUsers.find(u => u.id === empId);
                                   return (
                                      <span key={empId} className="inline-flex items-center gap-1 px-2 py-0.5 bg-[var(--surface-pill)] text-[var(--text-secondary)] rounded text-[10px] font-bold">
                                         {emp?.name}
                                         <button 
                                           onClick={() => {
                                              const next = employeeIds.filter(id => id !== empId);
                                              setEmployeeIds(next);
                                              scheduleTicketSave({ employeeIds: next });
                                           }}
                                           className="hover:text-[var(--text-danger)]"
                                         >
                                            <X size={10} />
                                         </button>
                                      </span>
                                   );
                                })}
                             </div>
                             <StyledSelect 
                                onChange={(e) => {
                                   if (!e.target.value) return;
                                   if (!employeeIds.includes(e.target.value)) {
                                      const next = [...employeeIds, e.target.value];
                                      setEmployeeIds(next);
                                      scheduleTicketSave({ employeeIds: next });
                                   }
                                   e.target.value = "";
                                }}
                                className="text-[10px] font-semibold uppercase text-[var(--accent-text)] bg-transparent border-none outline-none cursor-pointer hover:underline"
                             >
                                <option value="">+ Adicionar</option>
                                {allUsers
                                  .filter(u => (u.role === UserRole.EMPLOYEE) && !employeeIds.includes(u.id))
                                  .map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                             </StyledSelect>
                          </div>
                       </div>
                       <div className="flex items-start gap-4 pt-1">
                          <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5">Marcadores</span>
<input 
                              value={mainTags.join(', ')}
                              onChange={(e) => setMainTags(e.target.value.split(',').map(s => s.trim()).filter(s => !!s))}
                              onBlur={() => scheduleTicketSave({})}
                              placeholder="tags..."
                              className="text-sm font-bold text-[var(--text-secondary)] bg-transparent border-none outline-none focus:ring-2 focus:ring-[var(--accent)]/10 rounded px-1 -ml-1 flex-1 hover:bg-[var(--surface-card)] transition-all"
                           />
                       </div>
                    </div>
                 </div>
               )}

               {isCustomer && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-4">
                     <div className="space-y-3">
                        <div className="flex items-start gap-4">
                           <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5">Status</span>
                           <span className="text-sm font-bold text-[var(--accent-text)] bg-[var(--accent)]/10 px-2 py-0.5 rounded uppercase tracking-tighter">{ticket.status}</span>
                        </div>
                        <div className="flex items-start gap-4">
                           <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5">Prioridade</span>
                           <span className="text-sm font-bold text-[var(--text-secondary)]">{ticket.priority}</span>
                        </div>
                        <div className="flex items-start gap-4">
                           <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5">Identificado</span>
                           <span className="text-sm font-bold text-[var(--text-secondary)]">#{ticket.ticketNumber ? String(ticket.ticketNumber).padStart(4, '0') : ticket.id.slice(0, 8)}</span>
                        </div>
                     </div>
                     <div className="space-y-3">
                        <div className="flex items-start gap-4">
                           <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5">Categoria</span>
                           <span className="text-sm font-bold text-[var(--text-secondary)]">{ticket.category}</span>
                        </div>
                        <div className="flex items-start gap-4">
                           <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5">Abertura</span>
                           <span className="text-sm font-bold text-[var(--text-secondary)]">{new Date(ticket.createdAt).toLocaleDateString()}</span>
                        </div>
                     </div>
                  </div>
               )}

               {/* Tabs Layout */}
               <div className="mt-12 border-t border-[var(--border-default)]">
                  <div className="flex border-b border-[var(--border-default)]">
                     {hasPermission(Permission.TICKETS_READ) && (
                       <button 
                         onClick={() => setActiveTab('description')}
                         className={cn(
                           "px-6 py-3 text-[11px] font-semibold uppercase tracking-widest border-b-2 transition-all",
                           activeTab === 'description' ? "border-[var(--accent)] text-[var(--accent-text)]" : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                         )}
                       >
                         Descrição
                       </button>
                     )}
{currentUser?.role !== UserRole.EMPLOYEE && hasPermission(Permission.INTERNAL_TICKETS_VIEW) && (
                       <button 
                         onClick={() => setActiveTab('internal')}
                         className={cn(
                           "px-6 py-3 text-[11px] font-semibold uppercase tracking-widest border-b-2 transition-all flex items-center gap-2",
                           activeTab === 'internal' ? "border-[var(--text-warning-strong)] text-[var(--text-warning)]" : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                         )}
                       >
                         <Lock size={12} /> Ticket Interno
                       </button>
                     )}
                      <button 
                        onClick={() => setActiveTab('history')}
                        className={cn(
                          "px-4 py-3 border-b-2 transition-all flex items-center justify-center",
                          activeTab === 'history' ? "border-slate-500 text-[var(--text-secondary)] bg-[var(--surface-card)]/50" : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                        )}
                        title="Histórico de alterações"
                      >
                        <History size={16} />
                      </button>
                      <button 
                        onClick={() => setActiveTab('attachments')}
                        className={cn(
                          "px-6 py-3 text-[11px] font-semibold uppercase tracking-widest border-b-2 transition-all flex items-center gap-2",
                          activeTab === 'attachments' ? "border-[var(--accent)] text-[var(--accent-text)]" : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                        )}
                      >
                        <Paperclip size={12} /> {allAttachments.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />} Anexos
                      </button>
                      {ticket.chatSessionId && (
                        <button
                          onClick={() => { setActiveTab('chat'); loadChatSessionMessages(); }}
                          className={cn(
                            "px-6 py-3 text-[11px] font-semibold uppercase tracking-widest border-b-2 transition-all flex items-center gap-2",
                            activeTab === 'chat' ? "border-[var(--accent)] text-[var(--accent-text)]" : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                          )}
                        >
                          <MessageCircle size={12} /> Conversa
                        </button>
                      )}
                  </div>

                  {/* Tab Content */}
                  <div className="py-8">
                     {activeTab === 'description' && (
                       <div className="space-y-4">
<div className="flex items-center justify-between">
                              <h3 className="text-xs font-black uppercase text-[var(--text-tertiary)] tracking-widest">Descrição do Chamado</h3>
                              {currentUser?.role !== UserRole.EMPLOYEE && (
                                <button
                                  onClick={() => isEditingDescription ? saveMainTicketDescription() : setIsEditingDescription(true)}
                                  className="text-xs font-black text-[var(--accent-text)] uppercase hover:underline"
                                >
                                  {isEditingDescription ? 'Salvar' : 'Editar'}
                                </button>
                              )}
                           </div>
                           {isEditingDescription ? (
                             <RichEditor content={ticketDescription} onChange={setTicketDescription} minHeight="300px" />
                           ) : (
                             <div className="text-sm font-medium text-[var(--text-secondary)] leading-relaxed prose prose-sm max-w-none prose-p:my-2 prose-img:rounded-xl prose-img:border" dangerouslySetInnerHTML={{ __html: ticket.description }} />
                           )}
                       </div>
                     )}

                     {activeTab === 'attachments' && (
                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                           <AttachmentGallery attachments={allAttachments} />
                        </div>
                      )}

                      {activeTab === 'chat' && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                          <h3 className="text-xs font-black uppercase text-[var(--text-tertiary)] tracking-widest">Histórico da Conversa</h3>
                          {isLoadingChatSession ? (
                            <p className="text-sm text-[var(--text-tertiary)] font-medium">Carregando...</p>
                          ) : !chatSessionData ? (
                            <p className="text-sm text-[var(--text-tertiary)] font-medium">Não foi possível carregar a conversa vinculada.</p>
                          ) : chatSessionData.messages.length === 0 ? (
                            <p className="text-sm text-[var(--text-tertiary)] font-medium">Esse atendimento não tem mensagens registradas.</p>
                          ) : (
                            <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
                              {chatSessionData.messages.map(m => (
                                <div key={m.id} className="p-4 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[11px] font-black uppercase text-[var(--text-secondary)]">{m.senderName || 'Cliente'}</span>
                                    <span className="text-[10px] text-[var(--text-tertiary)] font-semibold">
                                      <ClientTime date={m.timestamp} />
                                    </span>
                                  </div>
                                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap break-words">{m.text}</p>
                                  <ChatAttachmentList attachments={m.attachments || []} />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {activeTab === 'internal' && (
                       <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                          <div className="flex items-center justify-between">
                             <h3 className="text-xs font-black uppercase text-[var(--text-tertiary)] tracking-widest">
                                {internalTickets.length > 0 ? `${internalTickets.length} Ticket${internalTickets.length > 1 ? 's' : ''} Interno${internalTickets.length > 1 ? 's' : ''} Vinculado${internalTickets.length > 1 ? 's' : ''}` : 'Nenhum Ticket Interno Vinculado'}
                             </h3>
                             <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setShowLinkModal(true)}
                                  className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all"
                                >
                                  Vincular Existente
                                </button>
                                <button
                                  onClick={() => { resetCreateForm(); setShowCreatePanel(true); }}
                                  className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-[var(--text-warning-strong)] text-white hover:bg-[var(--accent-warning-hover)] transition-all"
                                >
                                  + Criar Novo
                                </button>
                             </div>
                          </div>

                          {internalTickets.length === 0 && !showCreatePanel && (
                            <div className="text-center py-16 border-2 border-dashed border-[var(--border-default)] rounded-3xl">
                               <Lock className="mx-auto text-slate-200 mb-3" size={40} />
                               <p className="text-sm font-medium text-[var(--text-tertiary)] max-w-sm mx-auto">Nenhum ticket interno vinculado ainda. Crie um para acionar o time técnico ou vincule um já existente.</p>
                            </div>
                          )}

                          {internalTickets.map((it) => {
                            const meta = internalStatusMeta(it.status);
                            const assignee = allUsers.find(u => u.id === it.assigneeId);
                            const creator = allUsers.find(u => u.id === it.creatorId);
                            const unread = it.uuid ? notifications.some(n => n.targetId === it.uuid && !n.read) : false;
                            return (
                              <div key={it.uuid} className="relative p-4 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:border-[var(--text-warning-strong)]/40 transition-all">
                                {unread && <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-[var(--text-danger)]" />}
                                <div className="flex items-start justify-between gap-3 mb-2 pr-4">
                                   <div className="flex items-center gap-2 min-w-0">
                                      <span className="text-[10px] font-black text-[var(--text-warning)] shrink-0">INT-{it.internalTicketNumber?.toString().padStart(4, '0') || '----'}</span>
                                      <span className={cn("text-[9px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0", meta.color)}>{meta.label}</span>
                                   </div>
                                   <button
                                     onClick={() => it.uuid && handleUnlinkInternalTicket(it.uuid, `INT-${it.internalTicketNumber?.toString().padStart(4, '0') || ''}`)}
                                     title="Desvincular deste chamado"
                                     className="text-[var(--text-tertiary)] hover:text-[var(--text-danger)] transition-colors shrink-0"
                                   >
                                     <X size={14} />
                                   </button>
                                </div>
                                <p className="text-sm font-bold text-[var(--text-primary)] mb-2 line-clamp-2">{it.title}</p>
                                <div className="flex items-center justify-between text-[10px] text-[var(--text-tertiary)] font-medium">
                                   <span>{it.teamId || 'Sem equipe'} {assignee ? `· ${assignee.name}` : ''}</span>
                                   <span>{creator ? `por ${creator.name}` : ''}</span>
                                </div>
                                <a
                                  href={`/internal-tickets/${it.uuid}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-3 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-[var(--accent-text)] hover:underline"
                                >
                                  Abrir ticket completo →
                                </a>
                              </div>
                            );
                          })}

                          {showCreatePanel && (
                            <div className="p-5 rounded-2xl border border-[var(--border-alert)] bg-[var(--surface-warning)]/40 space-y-4">
                               <div className="flex flex-col gap-1.5">
                                  <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Título</label>
                                  <input
                                    autoFocus
                                    value={itTitle}
                                    onChange={(e) => setItTitle(e.target.value)}
                                    className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-sm font-bold text-[var(--text-secondary)] focus:border-[var(--text-warning-strong)] outline-none"
                                  />
                               </div>
                               <div className="grid grid-cols-2 gap-4">
                                  <div className="flex flex-col gap-1.5">
                                     <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Equipe</label>
                                     <StyledSelect
                                       value={itTeam}
                                       onChange={(e) => setItTeam(e.target.value)}
                                       className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-xs font-bold text-[var(--text-secondary)] focus:border-[var(--text-warning-strong)] outline-none"
                                     >
                                       {internalTeams.map(t => (
                                         <option key={t.id} value={t.name}>{t.name}</option>
                                       ))}
                                       <option value="">Sem equipe</option>
                                     </StyledSelect>
                                  </div>
                                  <div className="flex flex-col gap-1.5">
                                     <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Responsável</label>
                                     <StyledSelect
                                       value={itAssignee}
                                       onChange={(e) => setItAssignee(e.target.value)}
                                       className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-xs font-bold text-[var(--text-secondary)] focus:border-[var(--text-warning-strong)] outline-none"
                                     >
                                       <option value="">Não atribuído</option>
                                       {analysts
                                          .filter(a => !itTeam || (a as any).internal_team_ids?.includes(internalTeams.find(t => t.name === itTeam)?.id || ''))
                                          .map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                     </StyledSelect>
                                  </div>
                               </div>
                               <div className="flex flex-col gap-1.5">
                                  <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Prioridade</label>
                                  <div className="flex items-center gap-1">
                                     {[1, 2, 3].map((star) => (
                                       <button key={star} onClick={() => setItPriority(star === itPriority && star === 1 ? 0 : star)} className="hover:scale-125 transition-all">
                                         <Star size={18} className={cn(star <= itPriority ? "fill-amber-400 text-[var(--text-warning)]" : "text-slate-200")} />
                                       </button>
                                     ))}
                                  </div>
                               </div>
                               <div className="flex justify-end gap-2">
                                  <button onClick={() => setShowCreatePanel(false)} className="px-4 py-2 rounded-lg text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--surface-card)]">Cancelar</button>
                                  <button
                                    onClick={handleCreateInternalTicket}
                                    disabled={!itTitle.trim()}
                                    className="px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest bg-[var(--text-warning-strong)] text-white hover:bg-[var(--accent-warning-hover)] disabled:opacity-50"
                                  >
                                    Criar Ticket Interno
                                  </button>
                               </div>
                            </div>
                          )}
                       </div>
                     )}

                     {activeTab === 'history' && (
                       <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300 px-2 lg:px-0">
                         <div className="flex items-center justify-between">
                            <h3 className="text-xs font-black uppercase text-[var(--text-tertiary)] tracking-widest">Logs de Alteração</h3>
                         </div>
                         <div className="space-y-4">
                           {(() => {
                             const changeLog = messages.filter(m => m.type === 'system' || m.type === 'system_log');
                             if (changeLog.length === 0) {
                               return (
                                 <div className="text-center py-12 bg-[var(--surface-card)]/50 rounded-2xl border border-dashed border-[var(--border-default)]">
                                    <History size={24} className="mx-auto text-slate-300 mb-3" />
                                    <p className="text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-widest">Nenhuma alteração registrada</p>
                                 </div>
                               );
                             }
                             return [...changeLog].reverse().map((entry) => {
                               const author = allUsers.find(u => u.id === entry.senderId)?.name || 'Sistema';
                               return (
                                 <div key={entry.id} className="flex gap-4 p-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)]/30">
                                   <div className="w-8 h-8 rounded-full bg-[var(--surface-pill)] flex items-center justify-center shrink-0">
                                     <History size={14} className="text-[var(--text-tertiary)]" />
                                   </div>
                                   <div className="flex-1 min-w-0">
                                      <div className="flex items-center justify-between gap-4 mb-1">
                                        <span className="text-xs font-bold text-[var(--text-primary)] truncate">{author}</span>
                                        <span className="text-[10px] font-medium text-[var(--text-tertiary)] shrink-0"><ClientTime date={entry.timestamp} showDate={true} /></span>
                                      </div>
                                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">{entry.text}</p>
                                   </div>
                                 </div>
                               );
                             });
                           })()}
                         </div>
                       </div>
                     )}
                  </div>
               </div>
            </div>
          </div>
        </div>

        {/* Right Side: Activity/Chat Panel */}
        <div className={cn(
          "w-full md:w-[450px] border-l border-[var(--border-default)] flex-col bg-[var(--surface-card)]/50 min-h-0",
          mobilePanel === 'chat' ? "flex" : "hidden md:flex"
        )}>
           {/* Top Tabs */}
           <div className="px-6 py-4 border-b border-[var(--border-default)] bg-[var(--surface-card)] flex items-center justify-between">
              <div className="flex gap-4">
                 {hasPermission(Permission.TICKETS_READ) && (
                   <button 
                     onClick={() => setHistoryTab('customer')}
                     className={cn(
                       "text-[10px] font-semibold uppercase tracking-widest transition-all",
                       historyTab === 'customer' ? "text-[var(--accent-text)]" : "text-[var(--text-tertiary)]"
                     )}
                   >
                     Histórico Cliente
                   </button>
                 )}
                 {currentUser?.role !== UserRole.CUSTOMER && hasPermission(Permission.INTERNAL_TICKETS_VIEW) && (
                    <button 
                      onClick={() => setHistoryTab('internal')}
                      className={cn(
                        "text-[10px] font-semibold uppercase tracking-widest transition-all",
                        historyTab === 'internal' ? "text-[var(--text-warning)]" : "text-[var(--text-tertiary)]"
                       )}
                    >
                      Ticket Interno
                    </button>
                 )}
              </div>
           </div>

           {/* Messages Scroll Area */}
           <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6">
              {messages
                .filter(m => m.type !== 'system' && m.type !== 'system_log' && (historyTab === 'customer' ? m.isVisibleToCustomer : !m.isVisibleToCustomer))
                .map((m) => {
                  const isInternal = m.type === 'internal' || !m.isVisibleToCustomer;
                  const sender = allUsers.find(u => u.id === m.senderId);
                  
                  return (
                    <div key={m.id} className="group animate-in fade-in slide-in-from-right-2 duration-300">
                      <div className="flex gap-3">
                        <div className={cn(
                          "w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-black text-white shadow-sm mt-1",
                          isInternal ? "bg-[var(--text-warning-strong)]" : "bg-[var(--accent)]"
                        )}>
                          {sender?.name.charAt(0) || 'U'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-black text-[var(--text-primary)]">{sender?.name}</span>
                            <span className="text-[9px] font-bold text-[var(--text-tertiary)]"><ClientTime date={m.timestamp} /></span>
                            {isInternal && (
                              <span className="text-[8px] font-semibold px-1 py-0.5 bg-[var(--surface-warning)] text-[var(--text-warning)] rounded uppercase tracking-tighter">Interno</span>
                            )}
                          </div>
<div className={cn(
                             "p-3 rounded-2xl text-sm leading-relaxed shadow-sm prose prose-sm max-w-none",
                             isInternal 
                               ? "bg-[var(--surface-warning)] border border-[var(--border-alert)] text-[var(--text-warning)] border-l-4 border-l-amber-400 prose-amber" 
                               : "bg-[var(--surface-card)] border border-[var(--border-default)] text-[var(--text-secondary)]"
                           )}
                           dangerouslySetInnerHTML={{ __html: m.text }}
                           />
                           {/* Render attachments inline */}
                           {m.attachments && m.attachments.length > 0 && (
                             <div className="mt-3 pt-3 border-t border-[var(--border-default)]">
                               <div className="flex flex-wrap gap-2">
                                 {m.attachments.map(att => {
                                   const isImage = isImageAttachment(att);

                                   return (
                                     <button
                                       key={att.id}
                                       type="button"
                                       onClick={() => isImage ? setPreviewAttachment(att) : openAttachmentInNewTab(att)}
                                       className="flex items-center gap-1 px-2 py-1 bg-[var(--surface-pill)] rounded text-[10px] hover:bg-[var(--border-default)] transition-colors"
                                     >
                                       {isImage ? <ImageIcon size={12} /> : <File size={12} />}
                                       <span className="truncate max-w-[120px]">{att.name}</span>
                                     </button>
                                   );
                                 })}
                               </div>
                             </div>
                           )}
                         </div>
                      </div>
                    </div>
                  );
              })}
              {(historyTab === 'customer'
                ? messages.filter(m => m.type !== 'system' && m.type !== 'system_log' && m.isVisibleToCustomer).length
                : messages.filter(m => m.type !== 'system' && m.type !== 'system_log' && !m.isVisibleToCustomer).length) === 0 && (
                <div className="text-center py-20">
                   <Clock className="mx-auto text-slate-200 mb-2" size={32} />
                   <p className="text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-widest">Nenhuma atividade registrada</p>
                </div>
              )}
           </div>

{/* Input Tool area */}
             <div className="p-6 bg-[var(--surface-card)] border-t border-[var(--border-default)]">
                <div className="space-y-4">
                   {/* Attachment preview */}
                   {messageAttachments.length > 0 && (
                     <div className="flex flex-wrap gap-2">
                       {messageAttachments.map(att => (
                         <div key={att.id} className="flex items-center gap-1 px-2 py-1 bg-[var(--surface-pill)] rounded-lg text-[10px]">
                           <File size={12} />
                           <span className="truncate max-w-[120px]">{att.name}</span>
                           <button
                             onClick={() => setMessageAttachments(prev => prev.filter(a => a.id !== att.id))}
                             className="text-[var(--text-danger)] hover:text-[var(--text-danger)]"
                           >
                             <X size={10} />
                           </button>
                         </div>
                       ))}
                     </div>
                   )}
                   
                   <RichEditor 
                     content={message}
                     onChange={setMessage}
                     placeholder={historyTab === 'internal' ? "Nota interna..." : "Escreva sua resposta..."}
                     minHeight="100px"
                   />
                   <div className="flex items-center justify-between">
                      <div>
                         <input
                           type="file"
                           ref={messageFileInputRef}
                           onChange={handleMessageFileUpload}
                           multiple
                           accept="image/*,.pdf,.doc,.docx,.txt,.zip,audio/*"
                           className="hidden"
                         />
                         <button
                           type="button"
                           onClick={() => messageFileInputRef.current?.click()}
                           className="px-3 py-1.5 rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-card)] transition-colors text-[10px] font-semibold uppercase tracking-widest flex items-center gap-1"
                         >
                           <Paperclip size={12} />
                           Anexar
                         </button>
                      </div>
                      <button 
                        onClick={() => handleSendMessage(historyTab === 'internal')}
                        disabled={!message.trim() || message === '<p></p>'}
                        className={cn(
                          "px-6 py-2 rounded-xl transition-all disabled:opacity-50 shadow-lg text-xs font-black uppercase tracking-widest flex items-center gap-2",
                          historyTab === 'internal' ? "bg-[var(--text-warning-strong)] hover:bg-[var(--accent-warning-hover)] text-white shadow-amber-100" : "bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white shadow-indigo-100"
                        )}
                      >
                         <Send size={16} />
                         Enviar {historyTab === 'internal' ? 'Nota' : 'Resposta'}
                      </button>
                   </div>
                </div>
             </div>
        </div>
      </motion.div>
    </div>
    <LinkInternalTicketModal
      isOpen={showLinkModal}
      onClose={() => setShowLinkModal(false)}
      onLink={handleLinkInternalTicket}
      excludeIds={internalTickets.map(it => it.uuid).filter(Boolean) as string[]}
    />
    <AttachmentPreviewModal attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />
  </>
  );
}






