'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { StyledSelect } from '@/components/styled-select';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/app/app-context';
import { InternalTicket, Message, User } from '@/lib/types';
import { MessageService, InternalTicketService } from '@/lib/services/ticket-service';
import { cn } from '@/lib/utils';
import {
  Paperclip,
  Star,
  Loader2,
  Send,
  Clock,
  Link2,
  Search,
  X,
  History
} from 'lucide-react';
import { RichEditor } from '@/components/rich-editor';
import { toast } from 'sonner';
import { ClientTime } from '@/components/client-time';
import { FieldChange, formatChangeMessage } from '@/lib/ticket-diff';
import { INTERNAL_PRIORITY_LABELS, computeInternalTicketSla } from '@/lib/sla';
import { fetchPriorities } from '@/lib/services/config-service';

interface Attachment {
  id: string;
  name: string;
  type: string;
  url: string;
  size: number;
}

interface LinkedTicket {
  id: string;
  title: string;
  ticketNumber?: number;
}

const TEAM_OPTIONS = [
  { value: "Desenvolvimento", label: "Desenvolvimento", color: "bg-[var(--accent)]/20 text-[var(--accent-text)]" },
  { value: "Infraestrutura", label: "Infraestrutura", color: "bg-[var(--surface-success)] text-[var(--text-success)]" },
  { value: "QA / Testes", label: "QA / Testes", color: "bg-[var(--surface-warning)] text-[var(--text-warning)]" },
  { value: "Produto", label: "Produto", color: "bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300" },
];

const KANBAN_STATUSES = [
  { value: "Novo", label: "Novo", color: "bg-[var(--surface-info)] text-[var(--text-info)]" },
  { value: "Em Andamento", label: "Em Andamento", color: "bg-[var(--surface-warning)] text-[var(--text-warning)]" },
  { value: "Em Espera", label: "Em Espera", color: "bg-[var(--surface-pill)] text-[var(--text-secondary)]" },
  { value: "Concluído", label: "Concluído", color: "bg-[var(--surface-success)] text-[var(--text-success)]" },
];

interface InternalTicketWithExtras extends InternalTicket {
  uuid: string;
  assigneeName?: string;
  creatorName?: string;
}

// Formato de campo <input type="date"> (sem hora) a partir de um ISO string, e volta.
function toDateOnly(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function InternalTicketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { currentUser, triggerRefresh } = useApp();
  const [ticket, setTicket] = useState<InternalTicketWithExtras | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [linkedTickets, setLinkedTickets] = useState<LinkedTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [previewAttachments, setPreviewAttachments] = useState<Attachment[]>([]);
  const [activeTab, setActiveTab] = useState<'description' | 'linked' | 'attachments' | 'history'>('description');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formTeam, setFormTeam] = useState('Desenvolvimento');
  const [formPriority, setFormPriority] = useState(1);
  const [formAssignee, setFormAssignee] = useState('');
  const [formStatus, setFormStatus] = useState('Novo');
  const [formTags, setFormTags] = useState('');
  const [formExpectedPublish, setFormExpectedPublish] = useState('');
  const [analysts, setAnalysts] = useState<User[]>([]);
  const [priorities, setPriorities] = useState<any[]>([]);

  // Vincular chamado existente a este ticket interno
  const [showLinkTicketModal, setShowLinkTicketModal] = useState(false);
  const [ticketSearch, setTicketSearch] = useState('');
  const [ticketSearchResults, setTicketSearchResults] = useState<LinkedTicket[]>([]);
  const [searchingTickets, setSearchingTickets] = useState(false);

  const ticketId = params.id as string;

  const fetchTicket = useCallback(async () => {
    if (!ticketId || !currentUser) return;
    setLoading(true);
    try {
      let query;
      if (ticketId.startsWith('int-')) {
        const num = parseInt(ticketId.replace('int-', ''), 10);
        query = supabase.from('internal_tickets').select('*').eq('internal_ticket_number', num);
      } else {
        query = supabase.from('internal_tickets').select('*').eq('id', ticketId);
      }
      const { data, error } = await query.single();
      if (error) throw error;

      const { data: links } = await supabase.from('ticket_internal_links').select('ticket_id').eq('internal_ticket_id', data.id);
      const linkedIds = (links || []).map(l => l.ticket_id);
      const { data: regularTickets } = linkedIds.length
        ? await supabase.from('tickets').select('id, title, public_ticket_number').in('id', linkedIds)
        : { data: [] };
      setLinkedTickets((regularTickets || []).map((t: any) => ({ id: t.id, title: t.title, ticketNumber: t.public_ticket_number })));

      const profileIds = [...new Set([data.assignee_id, data.creator_id].filter(Boolean))];
      const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', profileIds);
      const profileMap = new Map((profiles || []).map(p => [p.id, p.name]));

      setTicket({
        ...data,
        uuid: data.id,
        id: `int-${data.internal_ticket_number?.toString().padStart(4, '0') || data.id.slice(0, 8)}`,
        internalTicketNumber: data.internal_ticket_number,
        title: data.title,
        teamId: data.team_id,
        assigneeId: data.assignee_id,
        priority: data.priority,
        tags: data.tags || [],
        description: data.description,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        slaLimit: data.sla_limit,
        expectedPublishDate: data.expected_publish_date,
        status: data.status || 'Novo',
        assigneeName: data.assignee_id ? profileMap.get(data.assignee_id) || null : null,
        creatorName: data.creator_id ? profileMap.get(data.creator_id) || null : null,
      });
      setFormTitle(data.title || '');
      setFormDescription(data.description || '');
      setFormTeam(data.team_id || 'Desenvolvimento');
      setFormPriority(data.priority || 1);
      setFormAssignee(data.assignee_id || '');
      setFormStatus(data.status || 'Novo');
      setFormTags((data.tags || []).join(', '));
      setFormExpectedPublish(toDateOnly(data.expected_publish_date));
    } catch (error) { console.error('Error loading ticket:', error); toast.error('Erro ao carregar ticket'); }
    finally { setLoading(false); }
  }, [ticketId, currentUser]);

  const fetchAnalysts = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('id, name, email, avatar_url, role').or('role.eq.Equipe,role.eq.Administrador,role.eq.Time Interno');
    if (!error) setAnalysts(data || []);
  }, []);

  const fetchPriorityConfig = useCallback(async () => {
    const data = await fetchPriorities();
    setPriorities(data || []);
  }, []);

  const loadMessages = useCallback(async () => {
    if (!ticket?.uuid) return;
    try { const msgs = await MessageService.getByInternalTicket(ticket.uuid); setMessages(msgs); }
    catch (error) { console.error('Error loading messages:', error); }
  }, [ticket?.uuid]);

  useEffect(() => { fetchTicket(); fetchAnalysts(); fetchPriorityConfig(); }, [fetchTicket, fetchAnalysts, fetchPriorityConfig]);
  useEffect(() => { if (ticket) loadMessages(); }, [ticket?.uuid]);

  useEffect(() => {
    if (!showLinkTicketModal) return;
    const handler = setTimeout(async () => {
      setSearchingTickets(true);
      try {
        const linkedIds = linkedTickets.map(t => t.id);
        let q = supabase.from('tickets').select('id, title, public_ticket_number').limit(20).order('created_at', { ascending: false });
        if (ticketSearch.trim()) q = q.ilike('title', `%${ticketSearch.trim()}%`);
        const { data } = await q;
        setTicketSearchResults((data || [])
          .filter((t: any) => !linkedIds.includes(t.id))
          .map((t: any) => ({ id: t.id, title: t.title, ticketNumber: t.public_ticket_number })));
      } finally {
        setSearchingTickets(false);
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [showLinkTicketModal, ticketSearch, linkedTickets]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setIsUploading(true);
    try {
      for (const file of files) {
        const fileId = Math.random().toString(36).substr(2, 9);
        const fileName = `${Date.now()}-${file.name}`;
        const { data: uploadData, error: uploadError } = await supabase.storage.from('attachments').upload(fileName, file);
        if (uploadError) { toast.error(`Erro ao fazer upload de ${file.name}`); continue; }
        const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(uploadData.path);
        setPreviewAttachments(prev => [...prev, { id: fileId, name: file.name, type: file.type, url: publicUrl, size: file.size }]);
      }
    } catch (error) { toast.error('Erro no upload'); }
    finally { setIsUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const handleSendMessage = async () => {
    if ((!input.trim() && previewAttachments.length === 0) || !ticket || !currentUser) return;
    const newMessage: Message = { id: Math.random().toString(36).substr(2, 9), ticketId: ticket.uuid, senderId: currentUser.id, text: input, timestamp: new Date().toISOString(), isVisibleToCustomer: false, type: 'internal', attachments: previewAttachments.length > 0 ? previewAttachments : undefined };
    try { await MessageService.createInternal(newMessage, ticket.uuid); setInput(''); setPreviewAttachments([]); loadMessages(); triggerRefresh(); }
    catch (error) { toast.error('Erro ao enviar mensagem'); }
  };

  // Overrides explícitos (em vez de depender só do state) evitam salvar um
  // valor antigo por causa do closure do React não ter visto o setState
  // anterior ainda — foi assim que o botão de status ficava "um clique
  // atrasado" antes desta correção.
  const handleUpdateTicket = async (overrides: Partial<{ status: string; assigneeId: string }> = {}) => {
    if (!ticket) return;
    const nextStatus = overrides.status ?? formStatus;
    const nextAssignee = 'assigneeId' in overrides ? (overrides.assigneeId || '') : formAssignee;
    const tags = formTags.split(',').map(s => s.trim()).filter(Boolean);
    // Vencimento nunca é digitado — reflete a prioridade atual, calculada a
    // partir do SLA (em horas) configurado em Configurações > Prioridades,
    // contado desde a criação do ticket.
    const slaIso = computeInternalTicketSla(formPriority, ticket.createdAt || new Date().toISOString(), priorities);
    const expectedPublishIso = formExpectedPublish ? new Date(`${formExpectedPublish}T00:00:00`).toISOString() : null;

    try {
      const { error } = await supabase.from('internal_tickets').update({
        title: formTitle,
        description: formDescription,
        team_id: formTeam,
        priority: formPriority,
        assignee_id: nextAssignee || null,
        status: nextStatus,
        tags,
        sla_limit: slaIso,
        expected_publish_date: expectedPublishIso,
        updated_at: new Date().toISOString()
      }).eq('id', ticket.uuid);
      if (error) throw error;

      // Mensagem única com todos os campos alterados nessa gravação (formato
      // "de → para (Campo)"), em vez de um evento por campo — assim uma
      // sequência de edições (status, depois responsável, depois prioridade)
      // que o debounce/blur juntou numa gravação só vira um post só também.
      const changes: FieldChange[] = [];
      if (nextStatus !== (ticket.status || 'Novo')) {
        changes.push({ label: 'Estágio', from: ticket.status || 'Novo', to: nextStatus });
      }
      if (nextAssignee !== (ticket.assigneeId || '')) {
        const fromName = ticket.assigneeId ? (analysts.find(a => a.id === ticket.assigneeId)?.name || 'alguém') : 'Não atribuído';
        const toName = nextAssignee ? (analysts.find(a => a.id === nextAssignee)?.name || 'alguém') : 'Não atribuído';
        changes.push({ label: 'Responsável', from: fromName, to: toName });
      }
      if (formTeam !== (ticket.teamId || '')) {
        changes.push({ label: 'Equipe', from: ticket.teamId || 'Sem equipe', to: formTeam || 'Sem equipe' });
      }
      if (formPriority !== ticket.priority) {
        changes.push({ label: 'Prioridade', from: INTERNAL_PRIORITY_LABELS[ticket.priority] || String(ticket.priority), to: INTERNAL_PRIORITY_LABELS[formPriority] || String(formPriority) });
      }
      if (formTitle !== ticket.title) {
        changes.push({ label: 'Título', from: ticket.title, to: formTitle });
      }
      const prevTags = (ticket.tags || []).join(', ');
      const nextTags = tags.join(', ');
      if (prevTags !== nextTags) {
        changes.push({ label: 'Marcadores', from: prevTags || 'Nenhum', to: nextTags || 'Nenhum' });
      }
      const fmtDateTime = (iso: string | null) => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Sem prazo';
      const prevSla = ticket.slaLimit || null;
      if (slaIso !== prevSla) {
        changes.push({ label: 'Vencimento', from: fmtDateTime(prevSla), to: fmtDateTime(slaIso) });
      }
      const prevExpectedPublish = ticket.expectedPublishDate || null;
      if (expectedPublishIso !== prevExpectedPublish) {
        const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Não definida';
        changes.push({ label: 'Publicação Prevista', from: fmtDate(prevExpectedPublish), to: fmtDate(expectedPublishIso) });
      }
      if (changes.length > 0) {
        await InternalTicketService.logEvent(ticket.uuid, currentUser?.id, formatChangeMessage(changes));
      }
      // Edição de descrição é registrada, mas não vira mensagem no feed —
      // só entra na aba Histórico ('system_log', filtrado do feed principal).
      const descriptionChanged = formDescription !== ticket.description;
      if (descriptionChanged) {
        await InternalTicketService.logEvent(ticket.uuid, currentUser?.id, 'Descrição atualizada', 'system_log');
      }

      setFormStatus(nextStatus);
      setFormAssignee(nextAssignee);
      setTicket(prev => prev ? { ...prev, status: nextStatus as InternalTicketWithExtras['status'], assigneeId: nextAssignee, tags, teamId: formTeam, priority: formPriority, title: formTitle, slaLimit: slaIso, expectedPublishDate: expectedPublishIso, description: formDescription } : prev);
      if (changes.length > 0 || descriptionChanged) loadMessages();
      toast.success('Ticket atualizado');
      triggerRefresh();
    } catch (error) {
      toast.error('Erro ao atualizar ticket');
    }
  };

  const handleLinkTicket = async (regularTicketId: string) => {
    if (!ticket) return;
    try {
      await InternalTicketService.linkExisting(regularTicketId, ticket.uuid);
      toast.success('Chamado vinculado');
      setShowLinkTicketModal(false);
      setTicketSearch('');
      fetchTicket();
    } catch (error) {
      toast.error('Erro ao vincular chamado');
    }
  };

  const handleUnlinkTicket = async (regularTicketId: string) => {
    if (!ticket) return;
    try {
      await InternalTicketService.unlink(regularTicketId, ticket.uuid);
      toast.success('Chamado desvinculado');
      setLinkedTickets(prev => prev.filter(t => t.id !== regularTicketId));
    } catch (error) {
      toast.error('Erro ao desvincular chamado');
    }
  };

  if (loading || !ticket) {
    return <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 text-[var(--text-warning-strong)] animate-spin" /></div>;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header superior */}
      <div className="h-15 bg-[var(--surface-card)] border-b border-[var(--border-default)] flex items-center justify-between px-6">
        <div className="text-sm font-bold text-[var(--text-primary)]">#{ticket.id} / <span className="text-[var(--text-warning)]">Chamado Interno</span></div>
        <div className="flex items-center gap-1">
          {KANBAN_STATUSES.map((status) => (
            <button key={status.value} onClick={() => { setFormStatus(status.value); handleUpdateTicket({ status: status.value }); }}
              className={cn("px-3 py-1 rounded-full text-[10px] font-bold uppercase transition-all", formStatus === status.value ? "bg-[var(--accent-warning-hover)] text-white" : "bg-[var(--surface-pill)] text-[var(--text-secondary)] hover:bg-[var(--border-default)]")}>
              {status.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { if (currentUser) { setFormAssignee(currentUser.id); handleUpdateTicket({ assigneeId: currentUser.id }); } }} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-[var(--border-default)] hover:bg-[var(--surface-card)]">ASSUMIR</button>
          <button onClick={() => { setFormStatus('Concluído'); handleUpdateTicket({ status: 'Concluído' }); }} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--text-success)] text-white hover:bg-emerald-700">FINALIZAR</button>
          <button onClick={() => handleUpdateTicket()} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--text-warning-strong)] text-white hover:bg-[var(--accent-warning-hover)]">SALVAR</button>
          <button onClick={() => router.push('/internal-tickets')} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      </div>

      {/* Título do ticket */}
      <div className="px-6 py-4">
        <input
          value={formTitle}
          onChange={(e) => setFormTitle(e.target.value)}
          onBlur={() => handleUpdateTicket()}
          className="text-2xl font-black text-[var(--text-primary)] bg-transparent border-none outline-none w-full focus:bg-[var(--surface-pill)] rounded-lg px-1 -ml-1"
        />
      </div>

      {/* Área principal */}
      <div className="flex-1 flex overflow-hidden">
        {/* Conteúdo principal */}
        <div className="flex-[0.73] bg-[var(--surface-card)] p-6 overflow-auto">
          <div className="grid grid-cols-2 gap-6 mb-4">
            <div className="space-y-3">
              <div><p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase mb-1">Equipe</p>
                <StyledSelect value={formTeam} onChange={(e) => { setFormTeam(e.target.value); setTimeout(() => handleUpdateTicket(), 0); }} className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-xs font-bold text-[var(--text-primary)]">
                  {TEAM_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </StyledSelect></div>
              <div><p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase mb-1">Responsável</p>
                <StyledSelect value={formAssignee} onChange={(e) => handleUpdateTicket({ assigneeId: e.target.value })} className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-xs font-bold text-[var(--text-primary)]">
                  <option value="">Não atribuído</option>
                  {analysts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </StyledSelect></div>
              <div><p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase mb-1">Vencimento</p>
                {(() => {
                  const computedSla = computeInternalTicketSla(formPriority, ticket.createdAt || new Date().toISOString(), priorities);
                  const overdue = computedSla && new Date(computedSla) < new Date();
                  return (
                    <p className={cn("text-xs font-bold px-1 py-2", overdue ? "text-[var(--text-danger)]" : "text-[var(--text-primary)]")} title="Calculado a partir da prioridade e do SLA configurado em Configurações">
                      {computedSla ? new Date(computedSla).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Sem SLA configurado'}
                    </p>
                  );
                })()}
              </div>
              <div><p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase mb-1">Prioridade</p>
                <div className="flex items-center gap-1">{[1, 2, 3, 4].map(star => (
                  <button key={star} onClick={() => { setFormPriority(star); setTimeout(() => handleUpdateTicket(), 0); }}>
                    <Star size={16} className={cn(star <= formPriority ? "fill-amber-400 text-[var(--text-warning)]" : "text-slate-300")} />
                  </button>
                ))}</div></div>
            </div>
            <div className="space-y-3">
              <div><p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase mb-1">Criado por</p>
                <p className="text-xs font-bold text-[var(--text-primary)]">{ticket.creatorName || '—'}</p></div>
              <div><p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase mb-1">Publicação Prevista</p>
                <input
                  type="date"
                  value={formExpectedPublish}
                  onChange={(e) => setFormExpectedPublish(e.target.value)}
                  onBlur={() => handleUpdateTicket()}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-xs font-bold text-[var(--text-primary)]"
                />
              </div>
              <div><p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase mb-1">Marcadores</p>
                <input
                  value={formTags}
                  onChange={(e) => setFormTags(e.target.value)}
                  onBlur={() => handleUpdateTicket()}
                  placeholder="separadas por vírgula..."
                  className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-xs font-bold text-[var(--text-primary)]"
                />
              </div>
              <div><p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase mb-1">Chamados vinculados</p>
                <button onClick={() => setActiveTab('linked')} className="text-xs font-bold text-[var(--text-warning)] hover:underline flex items-center gap-1">
                  <Link2 size={12} /> {linkedTickets.length > 0 ? `${linkedTickets.length} vinculado(s)` : 'Nenhum — vincular'}
                </button>
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--border-default)]"></div>

          <div className="flex items-center gap-6 px-6 py-3 border-b border-[var(--border-default)]">
            {[
              { key: 'description', label: 'DESCRIÇÃO' },
              { key: 'linked', label: 'CHAMADOS VINCULADOS', icon: Link2 },
              { key: 'attachments', label: 'ANEXOS', icon: Paperclip },
              { key: 'history', label: 'HISTÓRICO', icon: History }
            ].map(tab => {
              const TabIcon = tab.icon;
              return (<button key={tab.key} onClick={() => setActiveTab(tab.key as any)} className={cn("text-[10px] font-bold uppercase pb-2 border-b-2 transition-all flex items-center gap-1", activeTab === tab.key ? "text-[var(--text-warning)] border-[var(--text-warning-strong)]" : "text-[var(--text-tertiary)] border-transparent hover:text-[var(--text-secondary)]")}>
                {TabIcon && <TabIcon size={14} />}{tab.label}{tab.key === 'linked' && linkedTickets.length > 0 && ` (${linkedTickets.length})`}
              </button>);
            })}
          </div>

          <div className="p-6">
            {activeTab === 'description' && (
              <div onBlur={() => handleUpdateTicket()}>
                <h2 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase mb-4">DESCRIÇÃO DO CHAMADO</h2>
                <RichEditor content={formDescription} onChange={setFormDescription} minHeight="320px" placeholder="Detalhes técnicos, passos pra reproduzir, notas do desenvolvedor..." />
              </div>
            )}
            {activeTab === 'linked' && (
              <div className="min-h-96">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase">CHAMADOS QUE ESTE TICKET INTERNO ATENDE</h2>
                  <button
                    onClick={() => setShowLinkTicketModal(true)}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-[var(--text-warning-strong)] text-white hover:bg-[var(--accent-warning-hover)] transition-all"
                  >
                    + Vincular Chamado
                  </button>
                </div>
                {linkedTickets.length === 0 ? (
                  <div className="text-center py-12">
                    <Link2 size={32} className="mx-auto text-slate-300 mb-2" />
                    <p className="text-xs text-[var(--text-tertiary)]">Nenhum chamado vinculado — este ticket interno é independente.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {linkedTickets.map((t) => (
                      <div key={t.id} className="flex items-center justify-between bg-[var(--surface-card)] rounded-lg p-3 border border-[var(--border-default)]">
                        <a href={`/dashboard?ticket=${t.id}`} className="flex items-center gap-3 min-w-0 hover:underline">
                          <span className="text-[10px] font-black text-[var(--accent-text)] bg-[var(--accent)]/10 px-2 py-0.5 rounded shrink-0">#{t.ticketNumber ? String(t.ticketNumber).padStart(4, '0') : t.id.slice(0, 8)}</span>
                          <span className="text-sm font-bold text-[var(--text-primary)] truncate">{t.title}</span>
                        </a>
                        <button onClick={() => handleUnlinkTicket(t.id)} title="Desvincular" className="text-[var(--text-tertiary)] hover:text-[var(--text-danger)] shrink-0 ml-2">
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {activeTab === 'attachments' && (
              <div className="min-h-96">
                {(() => {
                  const allAttachments = messages.flatMap(m => m.attachments || []);
                  return allAttachments.length === 0 ? (
                    <div className="text-center py-12">
                      <Paperclip size={32} className="mx-auto text-slate-300 mb-2" />
                      <p className="text-xs text-[var(--text-tertiary)]">Nenhum anexo</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {allAttachments.map((att) => (
                        <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 bg-[var(--surface-card)] rounded-lg p-3 border border-[var(--border-default)] hover:border-[var(--text-warning-strong)]/40 transition-all">
                          <Paperclip size={14} className="text-[var(--text-tertiary)]" />
                          <span className="text-sm text-[var(--text-secondary)] truncate">{att.name}</span>
                          <span className="text-[10px] text-[var(--text-tertiary)] ml-auto">{(att.size / 1024).toFixed(1)}KB</span>
                        </a>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
            {activeTab === 'history' && (
              <div className="min-h-96">
                {(() => {
                  const changeLog = messages.filter(m => m.type === 'system' || m.type === 'system_log');
                  return changeLog.length === 0 ? (
                    <div className="text-center py-12">
                      <History size={32} className="mx-auto text-slate-300 mb-2" />
                      <p className="text-xs text-[var(--text-tertiary)]">Nenhuma alteração registrada</p>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[32rem] overflow-y-auto pr-1">
                      {[...changeLog].reverse().map((entry) => {
                        const author = analysts.find(a => a.id === entry.senderId)?.name || 'Sistema';
                        return (
                          <div key={entry.id} className="flex gap-3 p-3 rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--surface-pill)]/50">
                            <div className="w-8 h-8 rounded-full bg-[var(--surface-card)] flex items-center justify-center shrink-0">
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
                      })}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>

        {/* Painel lateral direito — histórico único (comentários + eventos de sistema) */}
        <div className="flex-1 border-l border-[var(--border-default)] flex flex-col h-full">
          <div className="px-4 py-3 border-b border-[var(--border-default)] flex items-center">
            <span className="text-xs font-bold uppercase text-[var(--text-warning)] border-b-2 border-[var(--text-warning-strong)] flex items-center gap-1">
              <Clock size={14} /> HISTÓRICO
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {(() => {
              // Edição de descrição ('system_log') não aparece aqui — só na
              // aba Histórico, junto com o resto.
              const visibleMessages = messages.filter(m => m.type !== 'system_log');
              return visibleMessages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="w-12 h-12 bg-[var(--surface-pill)] rounded-full flex items-center justify-center mx-auto mb-2">
                    <svg className="w-6 h-6 text-[var(--text-tertiary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l3 3"/></svg>
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)]">NENHUMA ATIVIDADE REGISTRADA</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {visibleMessages.map((msg) => {
                  const isSystem = msg.type === 'system';
                  const sender = analysts.find(a => a.id === msg.senderId);
                  return (
                    <div key={msg.id} className={cn(
                      "rounded-lg p-3 border",
                      isSystem ? "bg-[var(--surface-pill)] border-[var(--border-default)] border-dashed" : "bg-[var(--surface-card)] border-[var(--border-default)]"
                    )}>
                      <div className="flex items-center gap-2 mb-1">
                        {sender && <span className="text-[10px] font-bold text-[var(--text-primary)]">{sender.name}</span>}
                        <span className="text-[10px] font-bold text-[var(--text-warning)]">
                          <ClientTime date={msg.timestamp} showDate={true} />
                        </span>
                      </div>
                      <p className={cn("text-sm whitespace-pre-wrap", isSystem ? "text-[var(--text-tertiary)]" : "text-[var(--text-secondary)]")}>{msg.text}</p>
                    </div>
                  );
                })}
              </div>
            );
            })()}
          </div>
          <div className="p-4 border-t border-[var(--border-default)]">
            <RichEditor content={input} onChange={setInput} placeholder="Digite sua nota interna..." minHeight="80px" />
            <div className="flex justify-between items-center mt-3">
              <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="px-3 py-1 rounded-lg text-xs font-bold border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-card)] flex items-center gap-1 disabled:opacity-50">
                {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />} {isUploading ? 'ENVIANDO...' : 'ANEXAR'}
              </button>
              <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt,.zip,audio/*" onChange={handleFileSelect} className="hidden" />
              <button onClick={handleSendMessage} disabled={!input.trim() && previewAttachments.length === 0}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-[var(--accent-warning-hover)] text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-1">
                <Send size={14} /> ENVIAR
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal: vincular chamado existente */}
      {showLinkTicketModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4" onClick={() => setShowLinkTicketModal(false)}>
          <div className="bg-[var(--surface-card)] rounded-2xl p-6 max-w-lg w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black text-[var(--text-primary)] mb-4 uppercase">Vincular Chamado</h3>
            <div className="relative mb-4">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                autoFocus
                type="text"
                placeholder="Buscar chamado por título..."
                value={ticketSearch}
                onChange={(e) => setTicketSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border-default)] text-sm focus:border-[var(--text-warning-strong)] outline-none"
              />
            </div>
            <div className="flex-1 overflow-y-auto -mx-2 px-2">
              {searchingTickets ? (
                <p className="text-center py-8 text-[var(--text-tertiary)]">Buscando...</p>
              ) : ticketSearchResults.length === 0 ? (
                <p className="text-center py-8 text-[var(--text-tertiary)]">Nenhum chamado encontrado</p>
              ) : (
                <div className="space-y-2">
                  {ticketSearchResults.map((t) => (
                    <button key={t.id} onClick={() => handleLinkTicket(t.id)} className="w-full p-3 text-left border border-[var(--border-default)] rounded-lg hover:bg-[var(--surface-pill)] transition-all flex items-center gap-3">
                      <span className="text-[10px] font-black text-[var(--accent-text)] bg-[var(--accent)]/10 px-2 py-0.5 rounded shrink-0">#{t.ticketNumber ? String(t.ticketNumber).padStart(4, '0') : t.id.slice(0, 8)}</span>
                      <span className="text-sm font-bold text-[var(--text-primary)] truncate">{t.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end mt-4 pt-4 border-t border-[var(--border-default)]">
              <button onClick={() => setShowLinkTicketModal(false)} className="px-4 py-2 rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-card)] transition-all text-sm font-bold">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
