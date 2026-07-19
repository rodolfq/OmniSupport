'use client';

import React, { useState, useEffect, useRef } from 'react';
import { StyledSelect } from '@/components/styled-select';
import { X, User, MessageCircle, Clock, Link2, Paperclip, Save, Maximize2, Minimize2, Send, Lock, History, Download, File, Image as ImageIcon, Film } from 'lucide-react';
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
import { ClientTime } from './client-time';
import { TicketService, MessageService, InternalTicketService } from '@/lib/services/ticket-service';
import { UserService } from '@/lib/services/user-service';
import { CompanyService } from '@/lib/services/company-service';
import { ConfigService } from '@/lib/services/config-service';
import { getDefaultClosedTicketStatus, isClosedTicketStatus } from '@/lib/ticket-status';

interface TicketDetailModalProps {
  ticket: Ticket | null;
  onClose: () => void;
}

export function TicketDetailModal({ ticket, onClose }: TicketDetailModalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { currentUser, hasPermission, triggerRefresh } = useApp();
  const isCustomer = currentUser?.role === UserRole.CUSTOMER;
  
  // States
  const [isFocused, setIsFocused] = useState(false);
  const [activeTab, setActiveTab] = useState<'description' | 'internal' | 'history' | 'attachments'>('description');
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

  // Internal Ticket States
  const [internalTicket, setInternalTicket] = useState<InternalTicket | null>(null);
  const [itTitle, setItTitle] = useState('');
  const [itTeam, setItTeam] = useState('Suporte');
  const [itAssignee, setItAssignee] = useState('');
  const [itPriority, setItPriority] = useState(1);
  const [itTags, setItTags] = useState<string[]>([]);
  const [itDescription, setItDescription] = useState('');
  const [itSla, setItSla] = useState('');
  const [showLinkModal, setShowLinkModal] = useState(false);

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
        setAllUsers(profiles.map(u => ({ 
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
          setAnalysts(profiles.filter(u => u.role === 'Equipe' || u.is_admin) as any);
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
    setEmployeeIds(ticket.employeeIds || []);
    loadMessages();
    loadInternalTicket();
    
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

   const loadInternalTicket = async () => {
     if (!ticket) return;
const it = await InternalTicketService.getByParent(ticket.id);
      if (it) {
        setInternalTicket(it);
        setItTitle(it.title);
        setItTeam(it.teamId || 'Desenvolvimento');
        setItAssignee(it.assigneeId || '');
       setItPriority(it.priority);
       setItTags(it.tags);
       setItDescription(it.description);
       setItSla(it.slaLimit || '');
     } else {
       setInternalTicket(null);
       setItTitle(`Interno: ${ticket.title}`);
       setItTeam('Desenvolvimento');
       setItAssignee('');
       setItPriority(1);
       setItTags([]);
       setItDescription('');
       setItSla('');
     }
   };

const handleCreateInternalTicket = async () => {
      if (!currentUser || !ticket) return;
      const team = internalTeams.find(t => t.name === itTeam);
      const ticketNumber = ticket?.ticketNumber;
      const newIT: InternalTicket = {
        id: undefined,
        parentTicketId: ticket.id,
        parentTicketIds: [ticket.id],
        title: itTitle,
        teamId: itTeam,
        internalTeamId: team ? team.id : undefined,
        assigneeId: itAssignee || undefined,
        priority: itPriority,
        tags: itTags,
        creatorId: currentUser.id,
        description: itDescription,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        slaLimit: itSla || undefined
      };
      const savedInternalTicketId = await InternalTicketService.save(newIT, ticket.id, ticketNumber);
      // Fetch the created ticket to get its UUID
      const created = await InternalTicketService.getByParent(ticket.id);
      setInternalTicket(created || { ...newIT, id: savedInternalTicketId });

      const msg: Message = {
        id: Math.random().toString(36).substr(2, 9),
        ticketId: ticket.id,
        senderId: currentUser.id,
        text: `Criou o ticket interno ${savedInternalTicketId}`,
        timestamp: new Date().toISOString(),
        isVisibleToCustomer: false,
        type: 'internal'
      };
      await MessageService.create(msg);
      loadMessages();
    };

const handleUpdateInternalTicket = async () => {
      if (!internalTicket) return;
      
      // Find internal team ID by name
      const team = internalTeams.find(t => t.name === itTeam);
      const internalTeamId = team ? team.id : internalTicket.internalTeamId;
      
      const updatedIT: InternalTicket = {
        ...internalTicket,
        uuid: internalTicket.uuid, // Keep UUID for update
        title: itTitle,
        teamId: itTeam,
        internalTeamId: internalTeamId,
        assigneeId: itAssignee,
        priority: itPriority,
        tags: itTags,
        description: itDescription,
        updatedAt: new Date().toISOString(),
        slaLimit: itSla || undefined
      };
      await InternalTicketService.save(updatedIT);
      setInternalTicket(updatedIT);
    };

    const handleLinkInternalTicket = async (internalTicketId: string) => {
      if (!ticket || !currentUser) return;

      const { error } = await supabase.from('ticket_internal_links').insert({
        ticket_id: ticket.id,
        internal_ticket_id: internalTicketId
      });

      if (error && !error.message?.includes('duplicate')) {
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
      loadInternalTicket();
      setShowLinkModal(false);
      toast.success('Ticket interno vinculado com sucesso');
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

  const handleUpdateMainTicket = async (overrides: Partial<Ticket> = {}) => {
    if (!ticket) return;

    // Use values from overrides if provided, otherwise fallback to local state
    // We prioritize overrides to handle immediate updates from onChange events
    const statusToSave = overrides.status || ticketStatus;
    const priorityToSave = overrides.priority || mainPriority;
    const categoryToSave = overrides.category || mainTeam;
    const assigneeToSave = 'assigneeId' in overrides ? overrides.assigneeId : assigneeId;
    const companyToSave = overrides.companyId || companyId;
    const customerToSave = overrides.customerId || customerId;
    const employeesToSave = overrides.employeeIds || employeeIds;
    const descriptionToSave = overrides.description !== undefined ? overrides.description : ticketDescription;

    // Detect changes for history
    const changes: string[] = [];
    if (ticket.status !== statusToSave) changes.push(`Status: ${ticket.status} âž” ${statusToSave}`);
    if (ticket.priority !== priorityToSave) changes.push(`Prioridade: ${ticket.priority} âž” ${priorityToSave}`);
    if (ticket.category !== categoryToSave) changes.push(`Categoria: ${ticket.category} âž” ${categoryToSave}`);
    
    const oldAssigneeId = ticket.assigneeId === '' ? undefined : ticket.assigneeId;
    const newAssigneeId = assigneeToSave === '' ? undefined : assigneeToSave;
    
    if (oldAssigneeId !== newAssigneeId) {
      const oldAnalyst = allUsers.find(u => u.id === oldAssigneeId)?.name || 'Ninguém';
      const newAnalyst = allUsers.find(u => u.id === newAssigneeId)?.name || 'Ninguém';
      changes.push(`Responsável: ${oldAnalyst} → ${newAnalyst}`);
    }
    
    if (ticket.description !== descriptionToSave) changes.push('Descrição alterada');

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

    const historyEntry = changes.length > 0 ? {
      action: 'update',
      description: changes.join(', '),
      author: currentUser?.name || 'Sistema'
    } : undefined;

    await TicketService.update(updated);
    triggerRefresh();
    toast.success('Ticket atualizado');
  };

  const saveMainTicketDescription = async () => {
    if (ticket.description === ticketDescription) {
      setIsEditingDescription(false);
      return;
    }

    const updated: Ticket = { ...ticket, description: ticketDescription, updatedAt: new Date().toISOString() };
    await TicketService.update(updated);
    triggerRefresh();
    setIsEditingDescription(false);
    toast.success('Descrição atualizada');
  };

  const itCreator = internalTicket ? allUsers.find(u => u.id === internalTicket.creatorId) : null;

  const handleTakeTicket = async () => {
    if (!currentUser || !ticket) return;
    const nextStatus = ticket.status === TicketStatus.NEW ? TicketStatus.IN_PROGRESS : ticket.status;
    setAssigneeId(currentUser.id);
    setTicketStatus(nextStatus);
    handleUpdateMainTicket({ 
      assigneeId: currentUser.id,
      status: nextStatus 
    });
  };

  const handleCompleteTicket = async () => {
    if (!ticket || !currentUser) return;
    const closedStatus = getDefaultClosedTicketStatus(statuses.map(s => s.label));
    setTicketStatus(closedStatus as any);
    handleUpdateMainTicket({ 
      status: closedStatus as any, 
      completedAt: new Date().toISOString() 
    });
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-[110] flex items-center justify-end">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
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
                      onClick={() => handleUpdateMainTicket()}
                      className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-indigo-100 transition-all"
                    >
                      <Save size={16} />
                      Salvar
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <button onClick={() => setIsFocused(!isFocused)} className="p-2 hover:bg-[var(--border-default)] rounded-xl transition-all text-[var(--text-tertiary)]">
                    {isFocused ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                  </button>
                  <button onClick={onClose} className="p-2 hover:bg-[var(--surface-danger)] rounded-xl transition-all text-[var(--text-tertiary)] hover:text-[var(--text-danger)]">
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
                          handleUpdateMainTicket({ status: s.label as any });
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
                              handleUpdateMainTicket({ category: val });
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
                             <StyledSelect 
                               value={assigneeId}
                               onChange={(e) => {
                                 const val = e.target.value;
                                 setAssigneeId(val);
                                 handleUpdateMainTicket({ assigneeId: val });
                               }}
                               className="text-sm font-bold text-[var(--text-secondary)] bg-transparent border-none outline-none focus:ring-2 focus:ring-[var(--accent)]/10 rounded px-1 -ml-1 cursor-pointer hover:bg-[var(--surface-card)] transition-all"
                             >
                               <option value="">Não atribuído</option>
                               {analysts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                             </StyledSelect>
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
                                    handleUpdateMainTicket({ priority: nextLabel as any });
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
                               handleUpdateMainTicket({ companyId: val, customerId: newCustomerId });
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
                               handleUpdateMainTicket({ customerId: val });
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
                                              setTimeout(() => handleUpdateMainTicket(), 0);
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
                                      setTimeout(() => handleUpdateMainTicket(), 0);
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
                              onBlur={() => handleUpdateMainTicket()}
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

                      {activeTab === 'internal' && (
                       <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                          {internalTicket ? (
                            <div className="space-y-8">
                               {/* SLA Indicator */}
                               {itSla && (
                                 <div className={cn(
                                   "p-4 rounded-xl flex items-center justify-between",
                                   new Date(itSla) < new Date() ? "bg-[var(--surface-danger)] border border-[var(--text-danger)]/20" : "bg-[var(--surface-success)] border border-[var(--text-success)]/20"
                                 )}>
                                   <div className="flex items-center gap-3">
                                      <Clock className={cn(new Date(itSla) < new Date() ? "text-[var(--text-danger)]" : "text-[var(--text-success)]")} size={20} />
                                      <div>
                                         <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">Tempo de SLA</p>
                                         <p className={cn("text-sm font-black", new Date(itSla) < new Date() ? "text-[var(--text-danger)]" : "text-[var(--text-success)]")}>
                                            {new Date(itSla) < new Date() ? "SLA VENCIDO" : `Expira em: ${new Date(itSla).toLocaleString()}`}
                                         </p>
                                      </div>
                                   </div>
                                 </div>
                               )}

                               {/* Internal Ticket Fields */}
                               <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-6 p-6 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-inner">
<div className="space-y-4">
                                      <div className="flex flex-col gap-1.5">
                                         <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Ticket Interno #</label>
                                         <div className="text-sm font-black text-[var(--text-warning)]">#{internalTicket?.internalTicketNumber?.toString().padStart(4, '0') || '----'}</div>
                                      </div>
                                      <div className="flex flex-col gap-1.5">
                                         <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Título Interno</label>
                                         <input
                                          value={itTitle}
                                          onChange={(e) => setItTitle(e.target.value)}
                                          onBlur={handleUpdateInternalTicket}
                                          className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-sm font-bold text-[var(--text-secondary)] focus:border-[var(--text-warning-strong)] outline-none"
                                        />
                                     </div>
<div className="flex flex-col gap-1.5">
                                         <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Equipe Responsável</label>
                                         <StyledSelect 
                                           value={itTeam}
                                           onChange={(e) => {
                                             setItTeam(e.target.value);
                                             setTimeout(handleUpdateInternalTicket, 0);
                                           }}
                                           className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-xs font-bold text-[var(--text-secondary)] focus:border-[var(--text-warning-strong)] outline-none"
                                         >
                                           {internalTeams.map(t => (
                                             <option key={t.id} value={t.name}>{t.name}</option>
                                           ))}
                                           <option value="">Sem equipe</option>
                                         </StyledSelect>
                                      </div>
                                      <div className="flex flex-col gap-1.5">
                                         <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Vencimento SLA</label>
                                         <input 
                                           type="datetime-local"
                                           value={itSla}
                                           onChange={(e) => {
                                             setItSla(e.target.value);
                                             setTimeout(handleUpdateInternalTicket, 0);
                                           }}
                                           className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-xs font-bold text-[var(--text-secondary)] focus:border-[var(--text-warning-strong)] outline-none"
                                         />
                                      </div>
                                   </div>

                                   <div className="space-y-4">
                                      <div className="flex flex-col gap-1.5">
                                         <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Criado por</label>
                                         <div className="flex items-center gap-2 py-2">
                                            <div className="w-5 h-5 rounded-full bg-[var(--text-tertiary)] text-[8px] flex items-center justify-center font-black text-white">{itCreator?.name.charAt(0)}</div>
                                            <span className="text-xs font-bold text-[var(--text-secondary)]">{itCreator?.name}</span>
                                         </div>
                                      </div>
                                      <div className="flex flex-col gap-1.5">
                                         <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Responsável Interno</label>
                                         <StyledSelect 
                                           value={itAssignee}
                                           onChange={(e) => {
                                             setItAssignee(e.target.value);
                                             setTimeout(handleUpdateInternalTicket, 0);
                                           }}
                                           className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-xs font-bold text-[var(--text-secondary)] focus:border-[var(--text-warning-strong)] outline-none"
                                         >
                                           <option value="">Nenhum</option>
{analysts
                                              .filter(a => !itTeam || (a as any).internal_team_ids?.includes(
                                                internalTeams.find(t => t.name === itTeam)?.id || ''
                                              ))
                                              .map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                         </StyledSelect>
                                      </div>
                                     <div className="flex flex-col gap-1.5 font-sans">
                                        <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Prioridade</label>
                                        <div className="flex items-center gap-1 py-1">
                                           {[1, 2, 3].map((star) => (
                                             <button 
                                               key={star} 
                                               onClick={() => {
                                                  const newPrio = star === itPriority && star === 1 ? 0 : star;
                                                  setItPriority(newPrio);
                                                  setTimeout(async () => {
                                                      if (internalTicket) {
                                                        const updatedIT = { ...internalTicket, priority: newPrio };
                                                        await InternalTicketService.save(updatedIT);
                                                        setInternalTicket(updatedIT);
                                                     }
                                                  }, 0);
                                               }}
                                               className="hover:scale-125 transition-all"
                                             >
                                               <Star size={18} className={cn(star <= itPriority ? "fill-amber-400 text-[var(--text-warning)]" : "text-slate-200")} />
                                             </button>
                                           ))}
                                        </div>
                                     </div>
                                  </div>

                                  <div className="col-span-2 space-y-2">
                                     <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Descrição Técnica / Notas do Desenvolvedor</label>
                                     <textarea 
                                       value={itDescription}
                                       onChange={(e) => setItDescription(e.target.value)}
                                       onBlur={handleUpdateInternalTicket}
                                       placeholder="Adicione detalhes técnicos, bugs reportados ou requisitos..."
                                       className="w-full min-h-[120px] bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl p-4 text-sm font-medium outline-none focus:border-[var(--text-warning-strong)] shadow-sm"
                                     />
                                  </div>
                               </div>
                            </div>
                          ) : (
                            <div className="text-center py-20 border-2 border-dashed border-[var(--border-default)] rounded-3xl group hover:border-amber-300 transition-all">
                               <Lock className="mx-auto text-slate-200 mb-4 group-hover:text-[var(--text-warning)] transition-all" size={48} />
                               <h3 className="text-lg font-black text-[var(--text-primary)] uppercase tracking-tight">Criar Ticket Interno</h3>
<p className="text-sm font-medium text-[var(--text-tertiary)] mt-2 mb-6 max-w-sm mx-auto uppercase">Vincule um ticket de desenvolvimento ou manutenção técnica a este chamado do cliente.</p>
                                <button 
                                  onClick={handleCreateInternalTicket}
                                  className="px-6 py-3 bg-[var(--text-warning-strong)] text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-[var(--accent-warning-hover)] transition-all shadow-lg shadow-amber-100"
                                >
                                  Iniciar Fluxo Interno
                                </button>
                                <button 
                                  onClick={() => setShowLinkModal(true)}
                                  className="px-6 py-3 bg-[var(--border-default)] text-[var(--text-secondary)] rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-[var(--text-tertiary)] transition-all shadow-lg ml-2"
                                >
                                  Vincular Existente
                                </button>
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
                           {ticket?.history && ticket.history.length > 0 ? (
                             [...ticket.history].reverse().map((entry: any, idx) => (
                               <div key={idx} className="flex gap-4 p-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)]/30">
                                 <div className="w-8 h-8 rounded-full bg-[var(--surface-pill)] flex items-center justify-center shrink-0">
                                   <History size={14} className="text-[var(--text-tertiary)]" />
                                 </div>
                                 <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-4 mb-1">
                                      <span className="text-xs font-bold text-[var(--text-primary)] truncate">{entry.author}</span>
                                      <span className="text-[10px] font-medium text-[var(--text-tertiary)] shrink-0"><ClientTime date={entry.timestamp} showDate={true} /></span>
                                    </div>
                                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{entry.description}</p>
                                 </div>
                               </div>
                             ))
                           ) : (
                             <div className="text-center py-12 bg-[var(--surface-card)]/50 rounded-2xl border border-dashed border-[var(--border-default)]">
                                <History size={24} className="mx-auto text-slate-300 mb-3" />
                                <p className="text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-widest">Nenhuma alteração registrada</p>
                             </div>
                           )}
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
                .filter(m => historyTab === 'customer' ? m.isVisibleToCustomer : !m.isVisibleToCustomer)
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
                ? messages.filter(m => m.isVisibleToCustomer).length 
                : messages.filter(m => !m.isVisibleToCustomer).length) === 0 && (
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
    />
    <AttachmentPreviewModal attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />
  </>
  );
}






