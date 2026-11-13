'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { StyledSelect } from '@/components/styled-select';
import { useRouter } from 'next/navigation';
import { useApp } from '@/app/app-context';
import { InternalTicket, Message, User, Hotfix, EffortConfig, OutcomeConfig, Permission } from '@/lib/types';
import { MessageService, InternalTicketService } from '@/lib/services/ticket-service';
import { getHotfixes, saveHotfix } from '@/lib/services/queue-service';
import { cn, selectableOptions, htmlHasContent } from '@/lib/utils';
import { ChatAttachmentList } from '@/components/chat-attachment-list';
import {
  Paperclip,
  Star,
  Loader2,
  Send,
  Clock,
  Link2,
  Search,
  X,
  History,
  Rocket,
  Copy,
  Maximize2,
  Minimize2,
  Layers,
  Trash2,
  Pencil
} from 'lucide-react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { RichEditor } from '@/components/rich-editor';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { ClientTime } from '@/components/client-time';
import { FieldChange, formatChangeMessage } from '@/lib/ticket-diff';
import { INTERNAL_PRIORITY_LABELS, computeInternalTicketSla } from '@/lib/sla';
import { useAnalystsQuery, useConfigEffortsQuery, useConfigOutcomesQuery, useInternalTeamsQuery, useConfigPrioritiesQuery, useConfigStatusesQuery } from '@/lib/query-hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { findStatusColor } from '@/lib/status-colors';
import { uploadAttachment } from '@/lib/attachment-upload';
import { splitAttachmentsByBudget, MAX_ATTACHMENT_TOTAL_LABEL } from '@/lib/attachment-limits';

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

// Fallback só pra quando internal_teams ainda não carregou (ou está vazia) —
// mesmo padrão de internal-tickets-view.tsx/new-internal-ticket-modal.tsx.
// Achado em 2026-10-23 (usuário perguntando por que "Suporte" não aparecia
// pra escolher): esta tela usava essa lista fixa como ÚNICA fonte, nunca
// lendo a tabela internal_teams de verdade — 4 nomes de placeholder (só
// "Desenvolvimento" coincide com uma equipe real) escondiam as outras 4
// equipes cadastradas (CRC - CS, Hardware, Suporte, Treinamento).
const DEFAULT_TEAM_OPTIONS = [
  { value: "Desenvolvimento", label: "Desenvolvimento", color: "bg-[var(--accent)]/20 text-[var(--accent-text)]" },
  { value: "Infraestrutura", label: "Infraestrutura", color: "bg-[var(--surface-success)] text-[var(--text-success)]" },
  { value: "QA / Testes", label: "QA / Testes", color: "bg-[var(--surface-warning)] text-[var(--text-warning)]" },
  { value: "Produto", label: "Produto", color: "bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300" },
];

interface KanbanStatusMeta {
  value: string;
  label: string;
  color: string;
  // Vem de config_statuses.is_closed. Necessário para saber quando cobrar a
  // classificação da solução — o rótulo que "conclui" é configurável, não dá
  // pra comparar com a string "Concluído" no código.
  isClosed?: boolean;
}

const DEFAULT_KANBAN_STATUSES: KanbanStatusMeta[] = [
  { value: "Novo", label: "Novo", color: "bg-[var(--surface-info)] text-[var(--text-info)]" },
  { value: "Em Andamento", label: "Em Andamento", color: "bg-[var(--surface-warning)] text-[var(--text-warning)]" },
  { value: "Em Espera", label: "Em Espera", color: "bg-[var(--surface-pill)] text-[var(--text-secondary)]" },
  { value: "Concluído", label: "Concluído", color: "bg-[var(--surface-success)] text-[var(--text-success)]", isClosed: true },
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

// Detalhe do ticket interno como MODAL sobre a tela atual (2026-11-11, pedido
// do usuário: "ao abrir um ticket interno, desaparece o conteúdo ao fundo").
// Antes era a página /internal-tickets/[id]: abrir NAVEGAVA pra outra rota, e
// o overlay aparecia sobre um fundo vazio. Agora é montado pelo
// InternalTicketModalHost (portal layout) a partir de ?internalTicket=<ref>
// na URL — a tela de trás (lista, Dashboard, Meus Chamados...) continua lá,
// igual ao chamado do cliente (ticket-detail-modal.tsx). A rota
// /internal-tickets/[id] virou só um redirecionador, pros links diretos.
// Título com estado PRÓPRIO (2026-11-12, performance): digitar mexe só neste
// campo — o ticket inteiro (1.600+ linhas, 3 editores, histórico, grade de
// campos) não se redesenha mais a cada tecla, que era a causa do atraso ao
// digitar. Entrega o valor ao pai só no blur (onCommit); onDraft mantém o
// rascunho num ref do pai, pra "Criar ticket" ler o texto mesmo sem blur.
const TitleField = React.memo(function TitleField({ value, placeholder, autoFocus, onDraft, onCommit }: {
  value: string;
  placeholder?: string;
  autoFocus?: boolean;
  onDraft: (v: string) => void;
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const focusedRef = React.useRef(false);
  // Valor vindo de fora (ticket recarregado) só entra se a pessoa não estiver
  // digitando nele agora.
  useEffect(() => { if (!focusedRef.current) setLocal(value); }, [value]);
  return (
    <input
      value={local}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onFocus={() => { focusedRef.current = true; }}
      onChange={(e) => { setLocal(e.target.value); onDraft(e.target.value); }}
      onBlur={() => { focusedRef.current = false; onCommit(local); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      title={local}
      className="flex-1 min-w-[16rem] text-2xl font-black text-[var(--text-primary)] tracking-tight leading-tight bg-transparent border border-transparent rounded-lg -mx-2 px-2 py-0.5 hover:border-[var(--border-default)] focus:border-[var(--accent)] focus:outline-none transition-colors truncate"
    />
  );
});

// MODO CRIAÇÃO (2026-11-12, pedido do usuário): "Novo Ticket" abre ESTA
// tela, já com a cara de ticket aberto, em vez do formulário em modal.
// `creating` traz título/descrição iniciais; nada é gravado ao mexer nos
// campos — o botão "Criar ticket" cria. Abas e painel que só existem para um
// ticket de verdade (chamados vinculados, anexos das notas, histórico, notas)
// ficam ocultos. Ver NewInternalTicketModal, que é quem abre assim.
export interface InternalTicketCreateDraft { title?: string; description?: string }

export function InternalTicketDetailModal({ ticketRef, onClose, creating, onCreated }: {
  ticketRef: string;
  onClose: () => void;
  creating?: InternalTicketCreateDraft | null;
  // Ticket criado: recebe o id formatado (int-0001) — quem abriu decide o que
  // mostrar em seguida.
  onCreated?: (id: string) => void;
}) {
  const isCreating = !!creating;
  const router = useRouter();
  const { currentUser, triggerRefresh, setPendingTicketDraft, hasPermission, markInternalTicketNotificationsRead } = useApp();
  // Desmarcar (true → false) exige permissão extra — ver nota em
  // app/api/internal-tickets/route.ts (action=update). Marcar continua
  // liberado pra quem edita o ticket.
  const canOverrideQaRejection = hasPermission(Permission.INTERNAL_QA_OVERRIDE);
  // Apagar/editar mensagem do histórico (2026-11-12): sem permissão própria
  // (decisão do usuário: "permissões gerais") — vale pra quem já pode
  // escrever nota no ticket interno (internal:edit, exigido em todo POST da
  // rota). Apagar vale pra qualquer mensagem; editar, só pra nota — registro
  // automático de alteração não se edita. A regra de verdade é no servidor
  // (delete-message / edit-message em app/api/internal-tickets/route.ts).
  const canManageMessages = hasPermission(Permission.INTERNAL_TICKETS_EDIT);
  const canEditMessage = (m: Message) => canManageMessages && m.type !== 'system' && m.type !== 'system_log';
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [messageToDelete, setMessageToDelete] = useState<Message | null>(null);
  const [isDeletingMessage, setIsDeletingMessage] = useState(false);
  const [ticket, setTicket] = useState<InternalTicketWithExtras | null>(() => creating ? ({
    uuid: '',
    id: '',
    title: creating.title || '',
    description: creating.description || '',
    teamId: 'Desenvolvimento',
    priority: 1,
    tags: [],
    status: 'Novo',
    createdAt: new Date().toISOString(),
  } as unknown as InternalTicketWithExtras) : null);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [linkedTickets, setLinkedTickets] = useState<LinkedTicket[]>([]);
  const [loading, setLoading] = useState(!creating);
  // Rascunhos do que está sendo DIGITADO ficam em ref, não em estado
  // (2026-11-12, performance): estado no componente raiz redesenhava a tela
  // toda a cada tecla. O valor só vira estado quando é entregue (blur/enviar).
  const titleDraftRef = React.useRef(creating?.title || '');
  const descriptionDraftRef = React.useRef(creating?.description || '');
  const noteDraftRef = React.useRef('');
  const editingTextRef = React.useRef('');
  // Só muda quando a nota passa de vazia pra preenchida (e vice-versa) — é o
  // que habilita o botão Enviar, sem redesenhar a cada tecla.
  const [noteHasText, setNoteHasText] = useState(false);
  // Trocar a key recria o editor da nota vazio depois do envio.
  const [composerKey, setComposerKey] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [previewAttachments, setPreviewAttachments] = useState<Attachment[]>([]);
  const [activeTab, setActiveTab] = useState<'description' | 'linked' | 'attachments' | 'history'>('description');
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  // Mesmo painel e mesmo botão do chamado do cliente (ticket-detail-modal.tsx):
  // abre em ~90vw e o botão expande para tela cheia.
  const [isFocused, setIsFocused] = useState(false);

  const [formTitle, setFormTitle] = useState(creating?.title || '');
  const [formDescription, setFormDescription] = useState(creating?.description || '');
  const [formTeam, setFormTeam] = useState('Desenvolvimento');
  // Equipes de verdade (internal_teams), não a lista fixa de placeholder —
  // ver comentário de DEFAULT_TEAM_OPTIONS acima.
  const { data: internalTeamsData } = useInternalTeamsQuery();
  const teamOptions = useMemo(() => {
    const sorted = [...(internalTeamsData || [])].sort((a: any, b: any) => a.name.localeCompare(b.name, 'pt-BR'));
    return sorted.length > 0
      ? sorted.map((t: any) => ({ value: t.name, label: t.name }))
      : DEFAULT_TEAM_OPTIONS;
  }, [internalTeamsData]);
  const [formPriority, setFormPriority] = useState(1);
  const [formAssignee, setFormAssignee] = useState('');
  const [formStatus, setFormStatus] = useState('Novo');
  const [formSubStatus, setFormSubStatus] = useState<string | null>(null);
  const [formQaRejected, setFormQaRejected] = useState(false);
  const [formEnvironmentRejected, setFormEnvironmentRejected] = useState(false);
  const [formTags, setFormTags] = useState('');
  const [formExpectedPublish, setFormExpectedPublish] = useState('');
  const [formHotfixId, setFormHotfixId] = useState('');
  // Mão dupla do ciclo de publicação (reestruturado em 2026-10-19: Ciclo é
  // o intervalo com timeline compartilhada; Hotfix/Publicação são ITENS
  // dentro dele) — quando este ticket está vinculado a um ITEM (via
  // internal_tickets.release_item_id, independente do hotfix_id/formHotfixId
  // acima, que é só o fluxo achatado legado), mostra o item e, se ele já
  // tem posição, a etapa — ver app/api/internal-tickets/route.ts (action=detail).
  const [hotfixStageSummary, setHotfixStageSummary] = useState<{ itemId: string; itemName: string; itemType: string; cycleId: string; cycleName: string; stageName: string | null; stageOrder: number | null; totalStages: number } | null>(null);
  // Classificação da solução (ver EffortConfig/OutcomeConfig). Esforço
  // alimenta a carga ponderada e Desfecho a taxa de defeito no relatório de
  // Carga e Complexidade.
  const [formEffortId, setFormEffortId] = useState('');
  const [formOutcomeId, setFormOutcomeId] = useState('');
  const { data: effortsData } = useConfigEffortsQuery();
  const { data: outcomesData } = useConfigOutcomesQuery();
  const efforts = useMemo(() => (effortsData || []) as EffortConfig[], [effortsData]);
  const outcomes = useMemo(() => (outcomesData || []) as OutcomeConfig[], [outcomesData]);
  // Papéis de equipe (Administrador/Equipe/Time Interno) — via hook
  // compartilhado, mesmo filtro que o fetch direto tinha.
  const { data: analystsData } = useAnalystsQuery();
  const analysts = useMemo(() => (analystsData || []) as User[], [analystsData]);
  // Pedido do usuário, 2026-11-08: "Responsável" só pode mostrar quem é da
  // equipe ATUAL do ticket (formTeam) — mesma correção já feita na criação
  // (components/new-internal-ticket-modal.tsx) e na lista/kanban/tabela
  // (internal-tickets-view.tsx). `analysts` continua intocado pros outros
  // usos (resolver nome de autor/remetente em notas e histórico) — só esta
  // lista derivada é escopada, e só pro <select> de Responsável.
  const scopedAnalysts = useMemo(() => {
    const teamId = (internalTeamsData || []).find((t: any) => t.name === formTeam)?.id;
    if (!teamId) return analysts;
    return analysts.filter((a) => (a.internalTeamIds || []).includes(teamId));
  }, [analysts, internalTeamsData, formTeam]);
  // Prioridades, status e hotfixes vêm do cache compartilhado (React Query,
  // lib/query-hooks.ts) — antes eram buscados do zero a cada abertura de
  // ticket (2026-11-12, performance).
  const queryClient = useQueryClient();
  const { data: prioritiesData } = useConfigPrioritiesQuery();
  const priorities = useMemo(
    () => ((prioritiesData || []) as any[]).map((p: any) => ({ ...p, slaHours: p.slaHours ?? p.sla_hours, sla_hours: p.sla_hours ?? p.slaHours })),
    [prioritiesData]
  );
  const { data: hotfixesData } = useQuery({ queryKey: ['ref', 'hotfixes'], queryFn: () => getHotfixes() });
  const hotfixes = useMemo(() => (hotfixesData || []) as Hotfix[], [hotfixesData]);
  const { data: statusesData } = useConfigStatusesQuery('internal_ticket');
  const { statuses, subStatusMap } = useMemo(() => {
    const data = ((statusesData || []) as any[]).map((st: any) => ({
      ...st,
      parentStatusId: st.parentStatusId ?? st.parent_status_id ?? null,
      isClosed: !!(st.isClosed ?? st.is_closed),
    }));
    const topLevel = data.filter(st => !st.parentStatusId);
    const porId = new Map(data.map(st => [st.id, st]));
    const mapa: Record<string, string[]> = {};
    for (const st of data) {
      if (!st.parentStatusId) continue;
      const pai = porId.get(st.parentStatusId);
      if (pai) (mapa[pai.label] ??= []).push(st.label);
    }
    const lista: KanbanStatusMeta[] = topLevel.length > 0
      ? topLevel.map(st => {
          const c = findStatusColor(st.color);
          return { value: st.label, label: st.label, color: `${c.bg} ${c.text}`, isClosed: !!st.isClosed };
        })
      : DEFAULT_KANBAN_STATUSES;
    return { statuses: lista, subStatusMap: mapa };
  }, [statusesData]);
  // B: nome do autor por id, montado uma vez — o histórico fazia uma busca na
  // lista de analistas por mensagem, a cada redesenho.
  const analystsById = useMemo(() => new Map(analysts.map(a => [a.id, a])), [analysts]);
  // "Concluído" é configurável (config_statuses, scope internal_ticket), então
  // a checagem usa a lista carregada em vez de comparar com rótulo fixo.
  const needsClassification = useMemo(
    () => statuses.some(s => s.value === formStatus && s.isClosed),
    [statuses, formStatus]
  );

  // Criar hotfix na hora, sem sair do ticket interno — pedido do usuário
  // (2026-09-30): antes só dava pra escolher um hotfix já cadastrado em
  // Configurações/Hotfixes; quando o hotfix certo ainda não existia, o
  // analista tinha que abrir outra tela, cadastrar lá e voltar.
  const [showCreateHotfixModal, setShowCreateHotfixModal] = useState(false);
  const [newHotfixName, setNewHotfixName] = useState('');
  const [newHotfixDate, setNewHotfixDate] = useState('');
  const [isCreatingHotfix, setIsCreatingHotfix] = useState(false);

  // Vincular chamado existente a este ticket interno
  const [showLinkTicketModal, setShowLinkTicketModal] = useState(false);
  const [ticketSearch, setTicketSearch] = useState('');
  const [ticketSearchResults, setTicketSearchResults] = useState<LinkedTicket[]>([]);
  const [searchingTickets, setSearchingTickets] = useState(false);

  // "Copiar para Chamado" — quando há mais de um chamado vinculado, mostra
  // esse picker antes de navegar; quando não há nenhum, guarda a mensagem
  // aqui e abre o fluxo de vincular (aplicado assim que handleLinkTicket
  // terminar, ver useEffect/handler abaixo).
  const [copyPickerFor, setCopyPickerFor] = useState<Message | null>(null);
  const pendingCopyMsgRef = React.useRef<Message | null>(null);

  const ticketId = ticketRef;

  const fetchTicket = useCallback(async () => {
    if (!ticketId || !currentUser) return;
    setLoading(true);
    try {
      // Uma ida só: ticket + chamados vinculados + nomes de responsável e
      // criador. Antes eram quatro consultas encadeadas saindo do navegador.
      const detailRes = await fetch(`/api/internal-tickets?action=detail&ref=${encodeURIComponent(ticketId)}`);
      if (!detailRes.ok) throw new Error('Ticket interno não encontrado.');
      const detail = await detailRes.json();
      const data = detail.ticket;

      setLinkedTickets(detail.linkedTickets || []);
      setHotfixStageSummary(detail.hotfixStageSummary || null);
      // Zera a contagem de "novas notas" deste ticket pra este usuário —
      // mesmo gatilho do chamado de cliente (ticket-detail-modal.tsx),
      // generalizado pro ticket interno (2026-10-21).
      markInternalTicketNotificationsRead(data.id).catch(() => {});

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
        hotfixId: data.hotfix_id,
        effortId: data.effort_id,
        outcomeId: data.outcome_id,
        status: data.status || 'Novo',
        subStatus: data.sub_status ?? null,
        resolvedAt: data.resolved_at ?? null,
        qaRejected: !!data.qa_rejected,
        environmentRejected: !!data.environment_rejected,
        devDeadline: detail.devDeadline ?? null,
        lateDelivery: !!data.late_delivery,
        assigneeName: detail.assigneeName,
        creatorName: detail.creatorName,
      });
      setFormTitle(data.title || '');
      setFormDescription(data.description || '');
      titleDraftRef.current = data.title || '';
      descriptionDraftRef.current = data.description || '';
      setFormTeam(data.team_id || 'Desenvolvimento');
      setFormPriority(data.priority || 1);
      setFormAssignee(data.assignee_id || '');
      setFormStatus(data.status || 'Novo');
      setFormSubStatus(data.sub_status || null);
      setFormQaRejected(!!data.qa_rejected);
      setFormEnvironmentRejected(!!data.environment_rejected);
      setFormTags((data.tags || []).join(', '));
      setFormExpectedPublish(toDateOnly(data.expected_publish_date));
      setFormHotfixId(data.hotfix_id || '');
      setFormEffortId(data.effort_id || '');
      setFormOutcomeId(data.outcome_id || '');
    } catch (error) { console.error('Error loading ticket:', error); toast.error('Erro ao carregar ticket'); }
    finally { setLoading(false); }
  }, [ticketId, currentUser]);

  const loadMessages = useCallback(async () => {
    if (!ticket?.uuid) return;
    try { const msgs = await MessageService.getByInternalTicket(ticket.uuid); setMessages(msgs); }
    catch (error) { console.error('Error loading messages:', error); }
  }, [ticket?.uuid]);

  useEffect(() => { fetchTicket(); }, [fetchTicket]);
  useEffect(() => { if (ticket) loadMessages(); }, [ticket?.uuid]);

  useEffect(() => {
    if (!showLinkTicketModal) return;
    const handler = setTimeout(async () => {
      setSearchingTickets(true);
      try {
        const linkedIds = linkedTickets.map(t => t.id);
        const params = new URLSearchParams({ action: 'lookup', limit: '20' });
        if (ticketSearch.trim()) params.set('search', ticketSearch.trim());
        const res = await fetch(`/api/tickets?${params}`);
        const data = res.ok ? await res.json() : [];
        setTicketSearchResults((data || []).filter((t: any) => !linkedIds.includes(t.id)));
      } finally {
        setSearchingTickets(false);
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [showLinkTicketModal, ticketSearch, linkedTickets]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) return;

    // Barra ANTES de ler o arquivo — sem isso, o erro (413 do proxy pra
    // payload grande, ver guia-implementacao-servidor.html) só aparecia no
    // console na hora de ENVIAR a nota, sem nenhum aviso em tela.
    const existingBytes = previewAttachments.reduce((sum, a) => sum + (a.size || 0), 0);
    const { accepted: files, rejected } = splitAttachmentsByBudget(selected, existingBytes);
    if (rejected.length > 0) {
      rejected.forEach(file => {
        toast.error(`${file.name} excede o limite de ${MAX_ATTACHMENT_TOTAL_LABEL} por envio.`);
      });
    }
    if (files.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsUploading(true);
    try {
      for (const file of files) {
        try {
          const attachment = await uploadAttachment(file);
          setPreviewAttachments(prev => [...prev, attachment]);
        } catch { toast.error(`Erro ao fazer upload de ${file.name}`); }
      }
    } catch (error) { toast.error('Erro no upload'); }
    finally { setIsUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const handleSendMessage = async () => {
    // Nota só com anexo vai com texto vazio (o editor devolve "<p></p>").
    const text = noteHasText ? noteDraftRef.current : '';
    if ((!noteHasText && previewAttachments.length === 0) || !ticket || !currentUser) return;
    const newMessage: Message = { id: Math.random().toString(36).substr(2, 9), ticketId: ticket.uuid, senderId: currentUser.id, text, timestamp: new Date().toISOString(), isVisibleToCustomer: false, type: 'internal', attachments: previewAttachments.length > 0 ? previewAttachments : undefined };
    try {
      const created = await MessageService.createInternal(newMessage, ticket.uuid);
      noteDraftRef.current = '';
      setNoteHasText(false);
      setComposerKey(k => k + 1);
      setPreviewAttachments([]);
      // Lista vem em ordem DESC (mais nova primeiro).
      if (created?.id) setMessages(prev => [created, ...prev]);
      else loadMessages();
      markChanged();
    }
    catch (error: any) { console.error('Erro ao enviar mensagem do ticket interno:', error); toast.error(error?.message || 'Erro ao enviar mensagem'); }
  };

  // Overrides explícitos (em vez de depender só do state) evitam salvar um
  // valor antigo por causa do closure do React não ter visto o setState
  // anterior ainda — foi assim que o botão de status ficava "um clique
  // atrasado" antes desta correção.
  // Todo campo que grava na hora passa o valor NOVO por aqui (2026-11-12): o
  // padrão antigo `setX(v); setTimeout(() => handleUpdateTicket(), 0)` lia o
  // valor ANTIGO (closure do render anterior) — trocar Equipe/Esforço/
  // Desfecho/Hotfix/estrelas não gravava até o próximo Salvar, e fechar o
  // ticket antes perdia a troca.
  const handleUpdateTicket = async (overrides: Partial<{
    status: string; assigneeId: string; subStatus: string | null; qaRejected: boolean; environmentRejected: boolean;
    title: string; description: string; teamId: string; priority: number; hotfixId: string; expectedPublish: string;
    effortId: string; outcomeId: string;
  }> = {}) => {
    if (!ticket) return;
    if (isCreating) {
      // Ticket ainda não existe: só aplica na tela o que veio por override
      // (alguns controles passam o valor só por aqui, sem setX antes).
      if ('status' in overrides && overrides.status !== undefined) setFormStatus(overrides.status);
      if ('subStatus' in overrides) setFormSubStatus(overrides.subStatus ?? null);
      if ('assigneeId' in overrides) setFormAssignee(overrides.assigneeId || '');
      if ('qaRejected' in overrides) setFormQaRejected(!!overrides.qaRejected);
      if ('environmentRejected' in overrides) setFormEnvironmentRejected(!!overrides.environmentRejected);
      if ('title' in overrides) setFormTitle(overrides.title ?? '');
      if ('description' in overrides) setFormDescription(overrides.description ?? '');
      if ('teamId' in overrides) setFormTeam(overrides.teamId ?? '');
      if ('priority' in overrides && overrides.priority !== undefined) setFormPriority(overrides.priority);
      if ('hotfixId' in overrides) setFormHotfixId(overrides.hotfixId ?? '');
      if ('expectedPublish' in overrides) setFormExpectedPublish(overrides.expectedPublish ?? '');
      if ('effortId' in overrides) setFormEffortId(overrides.effortId ?? '');
      if ('outcomeId' in overrides) setFormOutcomeId(overrides.outcomeId ?? '');
      return;
    }
    const nextStatus = overrides.status ?? formStatus;
    const nextSubStatus = 'subStatus' in overrides ? (overrides.subStatus ?? null) : formSubStatus;
    const nextQaRejected = 'qaRejected' in overrides ? !!overrides.qaRejected : formQaRejected;
    const nextEnvironmentRejected = 'environmentRejected' in overrides ? !!overrides.environmentRejected : formEnvironmentRejected;
    const nextAssignee = 'assigneeId' in overrides ? (overrides.assigneeId || '') : formAssignee;
    const fTitle = 'title' in overrides ? (overrides.title ?? '') : formTitle;
    const fDescription = 'description' in overrides ? (overrides.description ?? '') : formDescription;
    const fTeam = 'teamId' in overrides ? (overrides.teamId ?? '') : formTeam;
    const fPriority = 'priority' in overrides && overrides.priority !== undefined ? overrides.priority : formPriority;
    const fHotfixId = 'hotfixId' in overrides ? (overrides.hotfixId ?? '') : formHotfixId;
    const fExpectedPublish = 'expectedPublish' in overrides ? (overrides.expectedPublish ?? '') : formExpectedPublish;
    const fEffortId = 'effortId' in overrides ? (overrides.effortId ?? '') : formEffortId;
    const fOutcomeId = 'outcomeId' in overrides ? (overrides.outcomeId ?? '') : formOutcomeId;
    const tags = formTags.split(',').map(s => s.trim()).filter(Boolean);
    // Vencimento nunca é digitado — reflete a prioridade atual, calculada a
    // partir do SLA (em horas) configurado em Configurações > Prioridades,
    // contado desde a criação do ticket.
    const slaIso = computeInternalTicketSla(fPriority, ticket.createdAt || new Date().toISOString(), priorities);
    const expectedPublishIso = fExpectedPublish ? new Date(`${fExpectedPublish}T00:00:00`).toISOString() : null;

    // Nada mudou em relação ao que está salvo: não grava nem avisa (achado do
    // usuário, 2026-11-12). Este handler roda no blur de título, descrição e
    // demais campos — antes, só clicar numa caixa de texto e sair já gravava o
    // ticket inteiro e mostrava "Ticket atualizado". O vencimento (slaIso)
    // fica de fora da comparação de propósito: ele é RECALCULADO a cada
    // chamada a partir da prioridade e pode diferir do valor guardado (regra
    // de SLA mudou depois, arredondamento) sem ninguém ter mexido em nada —
    // só conta como mudança quando a prioridade muda.
    const semMudanca =
      nextStatus === (ticket.status || 'Novo') &&
      (nextSubStatus ?? null) === (ticket.subStatus ?? null) &&
      nextQaRejected === !!ticket.qaRejected &&
      nextEnvironmentRejected === !!ticket.environmentRejected &&
      nextAssignee === (ticket.assigneeId || '') &&
      fTeam === (ticket.teamId || '') &&
      fPriority === ticket.priority &&
      fTitle === (ticket.title || '') &&
      tags.join(', ') === (ticket.tags || []).join(', ') &&
      fExpectedPublish === toDateOnly(ticket.expectedPublishDate) &&
      fHotfixId === (ticket.hotfixId || '') &&
      fEffortId === (ticket.effortId || '') &&
      fOutcomeId === (ticket.outcomeId || '') &&
      fDescription === (ticket.description || '');
    if (semMudanca) return;

    // Mensagem única com todos os campos alterados nessa gravação (formato
    // "de → para (Campo)"), em vez de um evento por campo — assim uma
    // sequência de edições (status, depois responsável, depois prioridade)
    // que o debounce/blur juntou numa gravação só vira um post só também.
    const changes: FieldChange[] = [];
    if (nextStatus !== (ticket.status || 'Novo')) {
      changes.push({ label: 'Estágio', from: ticket.status || 'Novo', to: nextStatus });
    }
    if (nextAssignee !== (ticket.assigneeId || '')) {
      const fromName = ticket.assigneeId ? (analystsById.get(ticket.assigneeId)?.name || 'alguém') : 'Não atribuído';
      const toName = nextAssignee ? (analystsById.get(nextAssignee)?.name || 'alguém') : 'Não atribuído';
      changes.push({ label: 'Responsável', from: fromName, to: toName });
    }
    if (fTeam !== (ticket.teamId || '')) {
      changes.push({ label: 'Equipe', from: ticket.teamId || 'Sem equipe', to: fTeam || 'Sem equipe' });
    }
    if (fPriority !== ticket.priority) {
      changes.push({ label: 'Prioridade', from: INTERNAL_PRIORITY_LABELS[ticket.priority] || String(ticket.priority), to: INTERNAL_PRIORITY_LABELS[fPriority] || String(fPriority) });
    }
    if (fTitle !== ticket.title) {
      changes.push({ label: 'Título', from: ticket.title, to: fTitle });
    }
    const prevTags = (ticket.tags || []).join(', ');
    const nextTags = tags.join(', ');
    if (prevTags !== nextTags) {
      changes.push({ label: 'Marcadores', from: prevTags || 'Nenhum', to: nextTags || 'Nenhum' });
    }
    const fmtDateTime = (iso: string | null) => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Sem prazo';
    const prevSla = ticket.slaLimit || null;
    if (fPriority !== ticket.priority && slaIso !== prevSla) {
      changes.push({ label: 'Vencimento', from: fmtDateTime(prevSla), to: fmtDateTime(slaIso) });
    }
    const prevExpectedPublish = ticket.expectedPublishDate || null;
    if (expectedPublishIso !== prevExpectedPublish) {
      const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Não definida';
      changes.push({ label: 'Publicação Prevista', from: fmtDate(prevExpectedPublish), to: fmtDate(expectedPublishIso) });
    }
    const prevHotfixId = ticket.hotfixId || '';
    if (fHotfixId !== prevHotfixId) {
      const hotfixName = (id: string) => id ? (hotfixes.find(h => h.id === id)?.name || 'hotfix removido') : 'Nenhum';
      changes.push({ label: 'Hotfix', from: hotfixName(prevHotfixId), to: hotfixName(fHotfixId) });
    }
    if (fEffortId !== (ticket.effortId || '')) {
      const effortName = (id: string) => id ? (efforts.find(e => e.id === id)?.label || 'removido') : 'Não classificado';
      changes.push({ label: 'Esforço', from: effortName(ticket.effortId || ''), to: effortName(fEffortId) });
    }
    if (fOutcomeId !== (ticket.outcomeId || '')) {
      const outcomeName = (id: string) => id ? (outcomes.find(o => o.id === id)?.label || 'removido') : 'Não classificado';
      changes.push({ label: 'Desfecho', from: outcomeName(ticket.outcomeId || ''), to: outcomeName(fOutcomeId) });
    }
    // Edição de descrição é registrada, mas não vira mensagem no feed —
    // só entra na aba Histórico ('system_log', filtrado do feed principal).
    const descriptionChanged = fDescription !== ticket.description;
    // Vão junto com a gravação (uma ida só, 2026-11-12) — o servidor grava os
    // registros e devolve as notas já atualizadas.
    const logEntries: { text: string; type: 'system' | 'system_log' }[] = [];
    if (changes.length > 0) logEntries.push({ text: formatChangeMessage(changes), type: 'system' });
    if (descriptionChanged) logEntries.push({ text: 'Descrição atualizada', type: 'system_log' });

    try {
      const updateRes = await fetch('/api/internal-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          id: ticket.uuid,
          fields: {
            title: fTitle,
            description: fDescription,
            teamId: fTeam,
            priority: fPriority,
            assigneeId: nextAssignee || null,
            status: nextStatus,
            subStatus: nextSubStatus,
            qaRejected: nextQaRejected,
            environmentRejected: nextEnvironmentRejected,
            tags,
            slaLimit: slaIso,
            expectedPublishDate: expectedPublishIso,
            hotfixId: fHotfixId || null,
            effortId: fEffortId || null,
            outcomeId: fOutcomeId || null
          },
          logEntries,
          returnMessages: logEntries.length > 0
        })
      });
      if (!updateRes.ok) {
        const errBody = await updateRes.json().catch(() => null);
        throw new Error(errBody?.error || 'Erro ao salvar o ticket interno.');
      }

      const updateBody = await updateRes.json().catch(() => null);

      setFormStatus(nextStatus);
      setFormAssignee(nextAssignee);
      setFormTitle(fTitle);
      setFormDescription(fDescription);
      setFormTeam(fTeam);
      setFormPriority(fPriority);
      setFormHotfixId(fHotfixId);
      setFormExpectedPublish(fExpectedPublish);
      setFormEffortId(fEffortId);
      setFormOutcomeId(fOutcomeId);
      setTicket(prev => prev ? { ...prev, status: nextStatus as InternalTicketWithExtras['status'], assigneeId: nextAssignee, tags, teamId: fTeam, priority: fPriority, title: fTitle, slaLimit: slaIso, expectedPublishDate: expectedPublishIso, hotfixId: fHotfixId || null, effortId: fEffortId || null, outcomeId: fOutcomeId || null, description: fDescription, subStatus: nextSubStatus, qaRejected: nextQaRejected, environmentRejected: nextEnvironmentRejected } : prev);
      if (Array.isArray(updateBody?.messages)) setMessages(updateBody.messages);
      else if (logEntries.length > 0) loadMessages();
      toast.success('Ticket atualizado');
      markChanged();
    } catch (error) {
      toast.error('Erro ao atualizar ticket');
    }
  };

  // Sempre a versão mais nova de handleUpdateTicket, pros callbacks estáveis
  // abaixo (o título e os editores são memoizados / guardam o callback da
  // criação — com a função direta eles chamariam uma versão velha).
  const handleUpdateTicketRef = React.useRef(handleUpdateTicket);
  handleUpdateTicketRef.current = handleUpdateTicket;
  const onTitleDraft = useCallback((v: string) => { titleDraftRef.current = v; }, []);
  const onTitleCommit = useCallback((v: string) => {
    titleDraftRef.current = v;
    handleUpdateTicketRef.current({ title: v });
  }, []);
  const onDescriptionDraft = useCallback((html: string) => { descriptionDraftRef.current = html; }, []);
  const onDescriptionCommit = useCallback(() => {
    handleUpdateTicketRef.current({ description: descriptionDraftRef.current });
  }, []);
  const onNoteDraft = useCallback((html: string) => {
    noteDraftRef.current = html;
    const has = /<img\b/i.test(html) || html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;
    setNoteHasText(prev => (prev === has ? prev : has));
  }, []);
  const onEditDraft = useCallback((html: string) => { editingTextRef.current = html; }, []);

  // "Criar ticket": a action=save cria com os campos básicos (título, equipe,
  // responsável, prioridade, marcadores, descrição); o resto (status,
  // sub-status, hotfix, esforço, desfecho, publicação prevista, QA/ambiente)
  // só é aceito pela action=update, então vai numa 2ª chamada — e só quando
  // algum deles foi preenchido.
  const handleCreateTicket = async () => {
    if (!currentUser || isSubmittingCreate) return;
    const createTitle = titleDraftRef.current.trim();
    const createDescription = descriptionDraftRef.current;
    if (!createTitle) {
      toast.error('Preencha o título antes de criar.');
      return;
    }
    setIsSubmittingCreate(true);
    try {
      const tags = formTags.split(',').map(t => t.trim()).filter(Boolean);
      const internalTeam = (internalTeamsData || []).find((t: any) => t.name === formTeam) as any;
      const saved = await InternalTicketService.saveWithDetails({
        title: createTitle,
        description: createDescription,
        teamId: formTeam,
        internalTeamId: internalTeam?.id,
        priority: formPriority,
        assigneeId: formAssignee || undefined,
        creatorId: currentUser.id,
        tags,
      } as InternalTicket);

      const extras: Record<string, any> = {};
      if (formStatus && formStatus !== 'Novo') extras.status = formStatus;
      if (formSubStatus) { extras.status = formStatus; extras.subStatus = formSubStatus; }
      if (formHotfixId) extras.hotfixId = formHotfixId;
      if (formEffortId) extras.effortId = formEffortId;
      if (formOutcomeId) extras.outcomeId = formOutcomeId;
      if (formExpectedPublish) extras.expectedPublishDate = new Date(`${formExpectedPublish}T00:00:00`).toISOString();
      if (formQaRejected) extras.qaRejected = true;
      if (formEnvironmentRejected) extras.environmentRejected = true;
      if (Object.keys(extras).length > 0) {
        const res = await fetch('/api/internal-tickets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update', id: saved.uuid, fields: extras })
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          toast.warning(`Ticket criado, mas alguns campos não foram gravados: ${body?.error || 'erro ao atualizar'}`);
        }
      }

      toast.success(`Ticket interno ${String(saved.id || '').toUpperCase()} criado com sucesso!`, { description: createTitle });
      markChanged();
      if (onCreated) onCreated(saved.id);
      else onClose();
    } catch (error: any) {
      console.error('Erro ao criar ticket interno:', error);
      toast.error(error?.message || 'Erro ao criar o ticket interno.');
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  const startEditMessage = (m: Message) => {
    setEditingMessageId(m.id);
    setEditingText(m.text || '');
    editingTextRef.current = m.text || '';
  };

  const handleSaveEdit = async () => {
    if (!editingMessageId || isSavingEdit) return;
    setIsSavingEdit(true);
    try {
      const res = await fetch('/api/internal-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit-message', messageId: editingMessageId, text: editingTextRef.current })
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Erro ao editar a nota.');
      setMessages(prev => prev.map(m => (m.id === editingMessageId ? { ...m, text: body?.text ?? editingTextRef.current } : m)));
      setEditingMessageId(null);
      setEditingText('');
      if (!body?.unchanged) toast.success('Nota editada');
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao editar a nota.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteMessage = async () => {
    if (!messageToDelete || isDeletingMessage) return;
    setIsDeletingMessage(true);
    try {
      const res = await fetch('/api/internal-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-message', messageId: messageToDelete.id })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'Erro ao apagar a mensagem.');
      }
      setMessages(prev => prev.filter(m => m.id !== messageToDelete.id));
      setMessageToDelete(null);
      toast.success('Mensagem apagada');
      markChanged();
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao apagar a mensagem.');
    } finally {
      setIsDeletingMessage(false);
    }
  };

  const handleLinkTicket = async (regularTicketId: string) => {
    if (!ticket) return;
    try {
      const { prioritySync } = await InternalTicketService.linkExisting(regularTicketId, ticket.uuid);
      if (prioritySync?.synced) {
        const quem = prioritySync.winner === 'ticket' ? 'do chamado (aberto primeiro)' : 'deste ticket interno (aberto primeiro)';
        toast.warning(`Prioridades diferentes — sincronizado para ${prioritySync.starsAfter} estrela(s), ${quem}.`);
      }
      toast.success('Chamado vinculado');
      setShowLinkTicketModal(false);
      setTicketSearch('');
      fetchTicket();
      // Se o vínculo veio do fluxo "Copiar para Chamado" sem nenhum chamado
      // ainda vinculado, segue direto pra cópia agora que já existe destino.
      if (pendingCopyMsgRef.current) {
        const pending = pendingCopyMsgRef.current;
        pendingCopyMsgRef.current = null;
        proceedCopyToTicket(regularTicketId, pending);
      }
    } catch (error) {
      toast.error('Erro ao vincular chamado');
    }
  };

  // Leva o texto/anexos de uma nota do ticket interno pro composer de
  // resposta do chamado destino (via pendingTicketDraft + /tickets?open=) —
  // o analista revisa e envia de lá, não é enviado automaticamente.
  const proceedCopyToTicket = (ticketId: string, msg: Message) => {
    setPendingTicketDraft({ ticketId, text: msg.text, attachments: msg.attachments || [], visibleToCustomer: true });
    setCopyPickerFor(null);
    router.push(`/tickets?open=${ticketId}`);
  };

  const handleCopyMessageToTicket = (msg: Message) => {
    if (linkedTickets.length === 0) {
      toast.info('Vincule um chamado para copiar esta nota.');
      pendingCopyMsgRef.current = msg;
      setShowLinkTicketModal(true);
      return;
    }
    if (linkedTickets.length === 1) {
      proceedCopyToTicket(linkedTickets[0].id, msg);
      return;
    }
    setCopyPickerFor(msg);
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

  // Fecha igual ao chamado do cliente (ticket-detail-modal.tsx): backdrop,
  // Esc e X chamam o mesmo caminho — quem decide o que acontece (tirar o
  // ?internalTicket= da URL, deixando a tela de trás como estava) é o host.
  // Atualização das listas por trás (Tickets Internos, Dashboard, Meus
  // Chamados, outras abas): uma vez só, quando o ticket fecha — não a cada
  // gravação/nota (2026-11-12, performance: cada triggerRefresh mandava a
  // lista ao fundo baixar tudo de novo, várias vezes por edição). O cleanup
  // cobre o caso de sair do ticket sem passar pelo fechar (link pra outra tela).
  const changedRef = React.useRef(false);
  const triggerRefreshRef = React.useRef(triggerRefresh);
  triggerRefreshRef.current = triggerRefresh;
  const markChanged = () => { changedRef.current = true; };
  // Ao sair do ticket, marca de novo como lido: o que chegou ENQUANTO ele
  // estava aberto (nota de outra pessoa) já foi visto — sem isto o contador
  // do card voltava a acender ao fechar (2026-11-12).
  const markReadRef = React.useRef(markInternalTicketNotificationsRead);
  markReadRef.current = markInternalTicketNotificationsRead;
  const openTicketUuidRef = React.useRef<string | null>(null);
  openTicketUuidRef.current = ticket?.uuid || null;
  useEffect(() => () => {
    if (changedRef.current) { changedRef.current = false; triggerRefreshRef.current(); }
    if (openTicketUuidRef.current) markReadRef.current(openTicketUuidRef.current).catch(() => {});
  }, []);
  const handleRequestClose = useCallback(() => {
    if (changedRef.current) { changedRef.current = false; triggerRefresh(); }
    onClose();
  }, [onClose, triggerRefresh]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Um sub-modal aberto por cima (criar hotfix, vincular chamado, picker
      // de cópia) consome o Esc só pra ele — sem esta guarda, apertar Esc com
      // um deles aberto fechava o TICKET INTEIRO por baixo, em vez de só o
      // modal de cima (achado ao testar o "+ Criar novo hotfix" na lista).
      if (showCreateHotfixModal) { setShowCreateHotfixModal(false); return; }
      if (showLinkTicketModal) { setShowLinkTicketModal(false); return; }
      if (copyPickerFor) { setCopyPickerFor(null); return; }
      if (messageToDelete) { setMessageToDelete(null); return; }
      if (editingMessageId) { setEditingMessageId(null); setEditingText(''); return; }
      handleRequestClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleRequestClose, showCreateHotfixModal, showLinkTicketModal, copyPickerFor, messageToDelete, editingMessageId]);

  // Link direto pro ticket interno, mesmo padrão do "Copiar link" do chamado
  // do cliente (handleCopyTicketLink, ticket-detail-modal.tsx) — número
  // simples (ex.: /internal-tickets/40), igual a /tickets/4940 do chamado,
  // em vez do id interno (UUID) — pedido do usuário, 2026-10-21. A rota
  // aceita os dois formatos (ver app/api/internal-tickets/route.ts).
  const handleCopyTicketLink = async () => {
    if (!ticket) return;
    const link = `${window.location.origin}/internal-tickets/${ticket.internalTicketNumber}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link do ticket interno copiado!');
    } catch (err) {
      console.error('Erro ao copiar link:', err);
      toast.error('Não foi possível copiar o link.');
    }
  };

  const handleCreateHotfix = async () => {
    if (!newHotfixName.trim() || !newHotfixDate) {
      toast.error('Preencha nome e data prevista do hotfix.');
      return;
    }
    setIsCreatingHotfix(true);
    try {
      const result = await saveHotfix(null, newHotfixName.trim(), null, null, newHotfixDate);
      if ('error' in result) {
        toast.error(result.error);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['ref', 'hotfixes'] });
      // saveHotfix não devolve o id do novo registro — busca pelo nome+data
      // recém-criados na lista atualizada pra já deixar selecionado.
      const created = (await getHotfixes()).find(h => h.name === newHotfixName.trim() && h.expectedDate === newHotfixDate);
      if (created) {
        setFormHotfixId(created.id);
        setFormExpectedPublish(created.expectedDate);
        handleUpdateTicket({ hotfixId: created.id, expectedPublish: created.expectedDate });
      }
      toast.success('Hotfix criado.');
      setShowCreateHotfixModal(false);
      setNewHotfixName('');
      setNewHotfixDate('');
    } catch (error) {
      toast.error('Erro ao criar hotfix.');
    } finally {
      setIsCreatingHotfix(false);
    }
  };

  if (loading || !ticket) {
    return (
      <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/50">
        <Loader2 className="w-8 h-8 text-[var(--text-warning-strong)] animate-spin" />
      </div>
    );
  }

  return (
    // Mesmo "modo de abertura" do chamado do cliente (ticket-detail-modal.tsx):
    // overlay fixo cobrindo a tela inteira (inclusive a sidebar), com backdrop
    // que fecha ao clicar fora e painel deslizando da direita — não mais uma
    // página normal dentro do shell do portal. Design copiado, não os campos.
    // z-[160]: acima do painel de item de publicação (release-item-drawer,
    // z-[150]), de onde também se abre um ticket interno; os sub-modais deste
    // aqui (hotfix, vincular, copiar) estão em z-[200].
    <div className="fixed inset-0 z-[160] flex items-center justify-end">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleRequestClose}
        className="absolute inset-0 bg-slate-900/50"
      />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative bg-[var(--surface-card)] h-full shadow-2xl border-l border-[var(--border-default)] flex flex-col transition-all duration-500 ease-in-out",
          isFocused ? "w-full" : "w-full md:max-w-[90vw]"
        )}
      >
      {/* Header superior — chrome derivado do chamado do cliente
          (ticket-detail-modal.tsx, 2026-09-30), compactado em 2026-11-12. */}
      <div className="border-b border-[var(--border-default)] bg-[var(--surface-card)]/50">
        {/* Layout compacto (2026-11-12, pedido do usuário: "tudo muito grande").
            Linha 1: identidade (número + criado em) à esquerda, ações à
            direita. Linha 2: título à esquerda e status à direita, nas
            extremidades — o título saiu da área rolável e o status deixou de
            ocupar uma linha só pra ele, liberando altura pro conteúdo. */}
        <div className="px-6 pt-3 pb-1 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="text-[11px] font-black text-[var(--text-danger)] bg-[var(--surface-danger)] px-2 py-0.5 rounded tracking-widest shrink-0">{isCreating ? 'NOVO TICKET INTERNO' : <>#{ticket.id}</>}</span>
            <span className="text-[10px] font-medium text-[var(--text-tertiary)] truncate min-w-0">
              {isCreating ? (
                <>Preencha os dados e clique em <strong>Criar ticket</strong>. Nada é gravado antes disso.</>
              ) : (
                <>Criado em <ClientTime date={ticket.createdAt} showDate showTime />{ticket.creatorName && <> · por {ticket.creatorName}</>}</>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isCreating ? (
            <div className="flex items-center gap-2 pr-2 border-r border-[var(--border-default)]">
              <button
                onClick={handleCreateTicket}
                disabled={isSubmittingCreate}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--text-warning-strong)] hover:bg-[var(--accent-warning-hover)] text-white rounded-lg text-[11px] font-black uppercase tracking-widest shadow-sm transition-all disabled:opacity-60"
              >
                {isSubmittingCreate && <Loader2 size={13} className="animate-spin" />}
                Criar ticket
              </button>
            </div>
            ) : (
            <div className="flex items-center gap-2 pr-2 border-r border-[var(--border-default)]">
              {!formAssignee && (
                <button
                  onClick={() => { if (currentUser) { setFormAssignee(currentUser.id); handleUpdateTicket({ assigneeId: currentUser.id }); } }}
                  className="px-3 py-1.5 bg-[var(--text-warning-strong)] hover:bg-[var(--accent-warning-hover)] text-white rounded-lg text-[11px] font-black uppercase tracking-widest shadow-sm transition-all"
                >
                  Assumir
                </button>
              )}
              <button
                onClick={() => { setFormStatus('Concluído'); handleUpdateTicket({ status: 'Concluído' }); }}
                className="px-3 py-1.5 bg-[var(--text-success)] hover:bg-emerald-700 text-white rounded-lg text-[11px] font-black uppercase tracking-widest shadow-sm transition-all"
              >
                Finalizar
              </button>
              <button
                onClick={() => handleUpdateTicket()}
                className="flex items-center gap-2 px-3 py-1.5 bg-[var(--text-warning-strong)] hover:bg-[var(--accent-warning-hover)] text-white rounded-lg text-[11px] font-black uppercase tracking-widest shadow-sm transition-all"
              >
                Salvar
              </button>
            </div>
            )}
            <div className="flex items-center">
              <button
                hidden={isCreating}
                onClick={handleCopyTicketLink}
                title="Copiar link do ticket interno"
                className="p-1.5 hover:bg-[var(--border-default)] rounded-lg transition-all text-[var(--text-tertiary)]"
              >
                <Link2 size={16} />
              </button>
              <button onClick={() => setIsFocused(!isFocused)} title={isFocused ? 'Reduzir' : 'Tela cheia'} className="p-1.5 hover:bg-[var(--border-default)] rounded-lg transition-all text-[var(--text-tertiary)]">
                {isFocused ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <button onClick={handleRequestClose} title="Fechar (Esc)" className="p-1.5 hover:bg-[var(--surface-danger)] rounded-lg transition-all text-[var(--text-tertiary)] hover:text-[var(--text-danger)]">
                <X size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Os status terminam exatamente onde começa o painel de histórico:
            à direita fica um espaço da mesma largura do painel (md:w-[340px]
            xl:w-[400px], as MESMAS classes do painel lá embaixo — mudar uma
            exige mudar a outra). Sem o painel (criação), não há espaço. */}
        <div className="flex">
        <div className="flex-1 min-w-0 px-6 pb-3 flex items-center justify-between gap-x-6 gap-y-2 flex-wrap">
          <TitleField
            value={formTitle}
            autoFocus={isCreating && !formTitle}
            placeholder={isCreating ? 'Título do ticket interno' : 'Título'}
            onDraft={onTitleDraft}
            onCommit={onTitleCommit}
          />
          <div className="flex flex-col items-end gap-1.5 shrink-0 max-w-full">
            {statuses.length > 0 ? (
              <div className="inline-flex flex-wrap justify-end bg-[var(--surface-pill)] p-0.5 rounded-lg max-w-full">
                {statuses.map((status) => (
                  <button
                    key={status.value}
                    onClick={() => { setFormStatus(status.value); setFormSubStatus(null); handleUpdateTicket({ status: status.value, subStatus: null }); }}
                    className={cn(
                      "px-2.5 py-1 text-[10px] font-semibold uppercase rounded-md transition-all whitespace-nowrap",
                      formStatus === status.value ? "bg-[var(--surface-card)] text-[var(--text-warning)] shadow-sm" : "text-[var(--text-tertiary)] hover:bg-[var(--border-default)]/50"
                    )}
                  >
                    {status.label}
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

            {/* Sub-status do status escolhido (ex.: Resolvido > Aguardando Publicação) */}
            {(subStatusMap[formStatus] ?? []).length > 0 && (
              <div className="flex flex-wrap items-center justify-end gap-1">
                <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mr-0.5">{formStatus} &gt;</span>
                {(subStatusMap[formStatus] ?? []).map(sub => (
                  <button
                    key={sub}
                    type="button"
                    onClick={() => { setFormSubStatus(sub); handleUpdateTicket({ status: formStatus, subStatus: sub }); }}
                    className={cn(
                      "px-2 py-0.5 text-[10px] font-semibold rounded-md transition-all",
                      formSubStatus === sub ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-pill)] text-[var(--text-secondary)] hover:bg-[var(--border-default)]/50"
                    )}
                  >
                    {sub}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div aria-hidden className={cn("hidden md:block md:w-[340px] xl:w-[400px] shrink-0", isCreating && "md:hidden")} />
        </div>
      </div>

      {/* Área principal */}
      <div className="flex-1 flex overflow-hidden">
        {/* Conteúdo principal */}
        <div className="flex-1 min-w-0 bg-[var(--surface-card)] overflow-y-auto flex flex-col">
          <div className="px-6 pt-4 pb-6 space-y-4 flex-1 flex flex-col">
            {/* Controle de entrega, logo abaixo do titulo. Prazo e entrega sao automaticos;
                Reprovacao de QA e Ambiente reprovado sao marcacoes manuais, sem pontuacao. */}
            {(() => {
              const prazo = ticket.devDeadline;
              const prazoAt = prazo?.at ? new Date(prazo.at) : null;
              const entregaAt = ticket.resolvedAt ? new Date(ticket.resolvedAt) : null;
              let situacaoPrazo: { texto: string; perigo: boolean } | null = null;
              if (prazo?.applies && prazoAt) {
                if (entregaAt) {
                  situacaoPrazo = entregaAt.getTime() <= prazoAt.getTime()
                    ? { texto: 'Resolvido no prazo', perigo: false }
                    : { texto: 'Resolvido após o prazo', perigo: true };
                } else {
                  situacaoPrazo = Date.now() > prazoAt.getTime()
                    ? { texto: 'Passou do prazo', perigo: true }
                    : { texto: 'Dentro do prazo', perigo: false };
                }
              }
              const fmt = (d: Date) => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
              return (
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-pill)]/40 px-4 py-3 space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">Controle de entrega</p>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-8 gap-y-3 text-xs">
                    <div className="flex items-start gap-3">
                      <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-40 shrink-0 pt-0.5">Prazo do desenvolvimento</span>
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="font-bold tabular-nums text-[var(--text-primary)]">
                          {!prazo
                            ? '—'
                            : !prazo.applies
                              ? 'Não se aplica'
                              : prazoAt ? fmt(prazoAt) : '—'}
                        </span>
                        {situacaoPrazo && (
                          <span className={cn('text-[10px] font-bold', situacaoPrazo.perigo ? 'text-[var(--text-danger)]' : 'text-[var(--text-success)]')}>
                            {situacaoPrazo.texto}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-40 shrink-0 pt-0.5">Entrega real</span>
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="font-bold tabular-nums text-[var(--text-primary)]">{entregaAt ? fmt(entregaAt) : '—'}</span>
                        {entregaAt && (
                          <span className={cn('text-[10px] font-bold', ticket.lateDelivery ? 'text-[var(--text-danger)]' : 'text-[var(--text-tertiary)]')}>
                            {ticket.lateDelivery ? 'Entregue com atraso' : 'Entregue no prazo'}
                          </span>
                        )}
                      </div>
                    </div>
                    <label className="inline-flex items-center gap-2 cursor-pointer select-none font-semibold text-[var(--text-secondary)]">
                      <input
                        type="checkbox"
                        checked={formQaRejected}
                        onChange={e => {
                          const next = e.target.checked;
                          if (!next && formQaRejected && !canOverrideQaRejection) {
                            toast.error('Você não pode desmarcar "Reprovação de QA".', {
                              description: 'Só quem tem a permissão de desmarcar Reprovação de QA/Ambiente pode desfazer essa marcação — fale com o responsável da equipe.'
                            });
                            return;
                          }
                          setFormQaRejected(next);
                          handleUpdateTicket({ qaRejected: next });
                        }}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                      Reprovação de QA
                    </label>
                    <label className="inline-flex items-center gap-2 cursor-pointer select-none font-semibold text-[var(--text-secondary)]">
                      <input
                        type="checkbox"
                        checked={formEnvironmentRejected}
                        onChange={e => {
                          const next = e.target.checked;
                          if (!next && formEnvironmentRejected && !canOverrideQaRejection) {
                            toast.error('Você não pode desmarcar "Ambiente reprovado".', {
                              description: 'Só quem tem a permissão de desmarcar Reprovação de QA/Ambiente pode desfazer essa marcação — fale com o responsável da equipe.'
                            });
                            return;
                          }
                          setFormEnvironmentRejected(next);
                          handleUpdateTicket({ environmentRejected: next });
                        }}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                      Ambiente reprovado
                    </label>
                  </div>
                </div>
              );
            })()}

            {/* Grade de identificação (Odoo style) — mesmas classes do chamado
                do cliente (grid-cols-1 sm:grid-cols-2, label w-24), com os
                campos PRÓPRIOS de ticket interno no lugar dos de chamado
                (Equipe em vez de Fila, Hotfix/Esforço/Desfecho em vez de
                Categoria/Tipo/Produto, sem Cliente/Contato/Colaboradores). */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-8 gap-y-2.5">
              <div className="space-y-2">
                <div className="flex items-start gap-4">
                  <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5">Equipe</span>
                  <StyledSelect value={formTeam} onChange={(e) => { const v = e.target.value; setFormTeam(v); handleUpdateTicket({ teamId: v }); }} className="flex-1 bg-transparent border-none outline-none text-sm font-bold text-[var(--text-primary)] cursor-pointer hover:underline">
                    {teamOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </StyledSelect>
                </div>
                <div className="flex items-start gap-4">
                  <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5">Responsável</span>
                  <StyledSelect value={formAssignee} onChange={(e) => handleUpdateTicket({ assigneeId: e.target.value })} className="flex-1 bg-transparent border-none outline-none text-sm font-bold text-[var(--text-primary)] cursor-pointer hover:underline">
                    <option value="">Não atribuído</option>
                    {scopedAnalysts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </StyledSelect>
                </div>
                <div className="flex items-start gap-4">
                  <span className="text-[11px] font-semibold uppercase text-[var(--text-danger)] w-24 pt-0.5 flex items-center gap-1"><Rocket size={11} /> Hotfix</span>
                  <div className="flex-1 min-w-0">
                    {/* "Criar novo hotfix" vive DENTRO da própria lista (pedido
                        do usuário, 2026-09-30) — antes era um botão separado
                        ao lado do <select>. Sentinela "__new__" nunca colide
                        com um id de hotfix de verdade (uuid); escolhida, abre
                        o modal de criar em vez de gravar no ticket. */}
                    <StyledSelect
                      value={formHotfixId}
                      onChange={(e) => {
                        const nextHotfixId = e.target.value;
                        if (nextHotfixId === '__new__') {
                          setShowCreateHotfixModal(true);
                          return;
                        }
                        setFormHotfixId(nextHotfixId);
                        const selected = hotfixes.find(h => h.id === nextHotfixId);
                        if (selected) setFormExpectedPublish(selected.expectedDate);
                        handleUpdateTicket({ hotfixId: nextHotfixId, ...(selected ? { expectedPublish: selected.expectedDate } : {}) });
                      }}
                      className="w-full bg-transparent border-none outline-none text-sm font-bold text-[var(--text-primary)] cursor-pointer hover:underline"
                    >
                      <option value="">Nenhum</option>
                      {/* Hotfix já publicado não aparece mais aqui, nem o que
                          este chamado já usa — uma vez sincronizado, sai da lista. */}
                      {hotfixes.filter(h => !h.publishedAt).map(h => (
                        <option key={h.id} value={h.id}>
                          {new Date(`${h.expectedDate}T00:00:00`).toLocaleDateString('pt-BR')} — {h.name}
                        </option>
                      ))}
                      <option value="__new__">+ Criar novo hotfix...</option>
                    </StyledSelect>
                    {formHotfixId && hotfixes.find(h => h.id === formHotfixId) && (
                      <p className="text-[10px] font-black text-[var(--text-danger)] mt-0.5">
                        📅 Previsto: {new Date(`${hotfixes.find(h => h.id === formHotfixId)!.expectedDate}T00:00:00`).toLocaleDateString('pt-BR')}
                      </p>
                    )}
                  </div>
                </div>
                {/* Mão dupla do ciclo de publicação (reestruturado em
                    2026-10-19) — independente do campo "Hotfix" acima (fluxo
                    achatado legado): este ticket foi vinculado a um ITEM de
                    um ciclo pelo lado do item (Publicações > ciclo > item >
                    chamados vinculados), não por aqui. */}
                {hotfixStageSummary && (
                  <div className="flex items-start gap-4">
                    <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5 flex items-center gap-1"><Layers size={11} /> Ciclo</span>
                    <button
                      type="button"
                      onClick={() => router.push('/settings?tab=hotfixes')}
                      className="flex-1 text-left text-sm font-bold text-[var(--accent-text)] hover:underline"
                    >
                      {hotfixStageSummary.cycleName} — {hotfixStageSummary.itemName}
                      {hotfixStageSummary.stageName && (
                        <span className="block text-[10px] font-bold text-[var(--text-tertiary)] mt-0.5">
                          Etapa {(hotfixStageSummary.stageOrder ?? 0) + 1} de {hotfixStageSummary.totalStages} — {hotfixStageSummary.stageName}
                        </span>
                      )}
                    </button>
                  </div>
                )}
                <div className="flex items-start gap-4">
                  <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5">Marcadores</span>
                  <input
                    value={formTags}
                    onChange={(e) => setFormTags(e.target.value)}
                    onBlur={() => handleUpdateTicket()}
                    placeholder="separadas por vírgula..."
                    className="flex-1 bg-transparent border-b border-transparent hover:border-[var(--border-default)] focus:border-[var(--accent)] outline-none text-sm font-bold text-[var(--text-primary)] transition-colors"
                  />
                </div>
              </div>
              <div className="space-y-2">
                {/* Classificação da solução. Fica visível o tempo todo (e não
                    só ao concluir) porque quem está resolvendo às vezes já
                    sabe o desfecho no meio do caminho; o selo "falta" só
                    aparece quando o ticket já está concluído sem preencher —
                    cobrar desde a abertura viraria ruído e o campo acabaria
                    preenchido no automático, que é pior do que vazio. */}
                <div className="flex items-start gap-4">
                  <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5 flex items-center gap-1">
                    Esforço
                    {needsClassification && !formEffortId && (
                      <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full bg-[var(--surface-warning)] text-[var(--text-warning-strong)]">falta</span>
                    )}
                  </span>
                  <StyledSelect
                    value={formEffortId}
                    onChange={(e) => { const v = e.target.value; setFormEffortId(v); handleUpdateTicket({ effortId: v }); }}
                    className="flex-1 bg-transparent border-none outline-none text-sm font-bold text-[var(--text-primary)] cursor-pointer hover:underline"
                  >
                    <option value="">Não classificado</option>
                    {/* Nível arquivado sai da lista, exceto o que este ticket já
                        usa — senão o <select> cairia em "Não classificado" e a
                        próxima gravação apagaria a classificação. */}
                    {selectableOptions(efforts, formEffortId).map(e => (
                      <option key={e.id} value={e.id}>{e.label}{e.isArchived ? ' (arquivado)' : ''}</option>
                    ))}
                  </StyledSelect>
                </div>
                <div className="flex items-start gap-4">
                  <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5 flex items-center gap-1">
                    Desfecho
                    {needsClassification && !formOutcomeId && (
                      <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full bg-[var(--surface-warning)] text-[var(--text-warning-strong)]">falta</span>
                    )}
                  </span>
                  <StyledSelect
                    value={formOutcomeId}
                    onChange={(e) => { const v = e.target.value; setFormOutcomeId(v); handleUpdateTicket({ outcomeId: v }); }}
                    className="flex-1 bg-transparent border-none outline-none text-sm font-bold text-[var(--text-primary)] cursor-pointer hover:underline"
                  >
                    <option value="">Não classificado</option>
                    {selectableOptions(outcomes, formOutcomeId).map(o => (
                      <option key={o.id} value={o.id}>{o.label}{o.isArchived ? ' (arquivado)' : ''}</option>
                    ))}
                  </StyledSelect>
                </div>
                {/* Prioridade / Vencimento são só CONSULTA — não têm um
                    <select>/<input> de edição direta (Prioridade muda por
                    estrela, não por campo; Vencimento é calculado). */}
                <div className="flex items-start gap-4">
                  <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5">Prioridade</span>
                  <div className="flex items-center gap-1">{[1, 2, 3, 4].map(star => (
                    <button key={star} onClick={() => { setFormPriority(star); handleUpdateTicket({ priority: star }); }}>
                      <Star size={16} className={cn(star <= formPriority ? "fill-amber-400 text-[var(--text-warning)]" : "text-slate-300")} />
                    </button>
                  ))}</div>
                </div>
                <div className="flex items-start gap-4">
                  <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)] w-24 pt-0.5">Vencimento</span>
                  {(() => {
                    const computedSla = computeInternalTicketSla(formPriority, ticket.createdAt || new Date().toISOString(), priorities);
                    const overdue = computedSla && new Date(computedSla) < new Date();
                    return (
                      <span className={cn("text-sm font-medium", overdue ? "text-[var(--text-danger)]" : "text-[var(--text-tertiary)]")} title="Calculado a partir da prioridade e do SLA configurado em Configurações">
                        {computedSla ? new Date(computedSla).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Sem SLA configurado'}
                      </span>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Abas — mesmo padrão visual do chamado do cliente (underline,
                Histórico só com ícone, Anexos com badge de ponto). */}
            <div className="mt-2 border-t border-[var(--border-default)] flex-1 flex flex-col">
              <div className="flex border-b border-[var(--border-default)]">
                <button
                  onClick={() => setActiveTab('description')}
                  className={cn(
                    "px-4 py-2 text-[11px] font-semibold uppercase tracking-widest border-b-2 transition-all",
                    activeTab === 'description' ? "border-[var(--text-warning-strong)] text-[var(--text-warning)]" : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  )}
                >
                  Descrição
                </button>
                <button
                  hidden={isCreating}
                  onClick={() => setActiveTab('linked')}
                  className={cn(
                    "px-4 py-2 text-[11px] font-semibold uppercase tracking-widest border-b-2 transition-all flex items-center gap-2",
                    activeTab === 'linked' ? "border-[var(--text-warning-strong)] text-[var(--text-warning)]" : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  )}
                >
                  <Link2 size={12} /> Chamados Vinculados {linkedTickets.length > 0 && `(${linkedTickets.length})`}
                </button>
                <button
                  hidden={isCreating}
                  onClick={() => setActiveTab('attachments')}
                  className={cn(
                    "px-4 py-2 text-[11px] font-semibold uppercase tracking-widest border-b-2 transition-all flex items-center gap-2",
                    activeTab === 'attachments' ? "border-[var(--text-warning-strong)] text-[var(--text-warning)]" : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  )}
                >
                  <Paperclip size={12} /> {messages.some(m => (m.attachments || []).length > 0) && <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-warning-strong)] animate-pulse" />} Anexos
                </button>
                <button
                  hidden={isCreating}
                  onClick={() => setActiveTab('history')}
                  className={cn(
                    "relative px-4 py-3 border-b-2 transition-all flex items-center justify-center",
                    activeTab === 'history' ? "border-slate-500 text-[var(--text-secondary)] bg-[var(--surface-card)]/50" : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  )}
                  title="Histórico de alterações"
                >
                  <History size={16} />
                </button>
              </div>

              <div className="pt-4 flex-1 flex flex-col">
            {activeTab === 'description' && (
              <div onBlur={onDescriptionCommit} className="flex-1 flex flex-col">
                <h2 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase mb-2">Descrição</h2>
                <RichEditor fill toolbar="basic" content={formDescription} onChange={onDescriptionDraft} minHeight="200px" placeholder="Detalhes técnicos, passos pra reproduzir, notas do desenvolvedor..." />
              </div>
            )}
            {activeTab === 'linked' && (
              <div className="min-h-48">
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
                  <div className="text-center py-8">
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
              <div className="min-h-48">
                {(() => {
                  const allAttachments = messages.flatMap(m => m.attachments || []);
                  return allAttachments.length === 0 ? (
                    <div className="text-center py-8">
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
              <div className="min-h-48">
                {(() => {
                  const changeLog = messages.filter(m => m.type === 'system' || m.type === 'system_log');
                  return changeLog.length === 0 ? (
                    <div className="text-center py-8">
                      <History size={32} className="mx-auto text-slate-300 mb-2" />
                      <p className="text-xs text-[var(--text-tertiary)]">Nenhuma alteração registrada</p>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[32rem] overflow-y-auto pr-1">
                      {[...changeLog].reverse().map((entry) => {
                        const author = analystsById.get(entry.senderId || '')?.name || 'Sistema';
                        return (
                          <div key={entry.id} className="group flex gap-3 p-3 rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--surface-pill)]/50">
                            <div className="w-8 h-8 rounded-full bg-[var(--surface-card)] flex items-center justify-center shrink-0">
                              <History size={14} className="text-[var(--text-tertiary)]" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-4 mb-1">
                                <span className="text-xs font-bold text-[var(--text-primary)] truncate">{author}</span>
                                <span className="flex items-center gap-1 shrink-0">
                                  <span className="text-[10px] font-medium text-[var(--text-tertiary)]"><ClientTime date={entry.timestamp} showDate={true} /></span>
                                  {canManageMessages && (
                                    <button
                                      type="button"
                                      onClick={() => setMessageToDelete(entry)}
                                      title="Apagar registro"
                                      aria-label="Apagar registro"
                                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-danger)] hover:bg-[var(--surface-danger)]"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  )}
                                </span>
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
          </div>
        </div>

        {/* Painel lateral direito — histórico único (comentários + eventos de sistema) —
            largura 450px/padding p-6 só em tela grande (2026-11-12: em resolução menor encolhe pra 320-380px e p-3 — pedido do usuário, "tudo muito grande"). Antes era igual ao painel direito do chamado do
            cliente (ticket-detail-modal.tsx), que antes disputava espaço via flex-[1]
            contra o flex-[0.73] do conteúdo principal e acabava bem mais largo. */}
        <div hidden={isCreating} className="w-full md:w-[340px] xl:w-[400px] border-l border-[var(--border-default)] flex flex-col h-full shrink-0">
          <div className="px-4 py-3 border-b border-[var(--border-default)] flex items-center">
            <span className="text-xs font-bold uppercase text-[var(--text-warning)] flex items-center gap-1">
              <Clock size={14} /> HISTÓRICO
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
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
                  const sender = analystsById.get(msg.senderId || '');
                  return (
                    <div key={msg.id} className={cn(
                      "group rounded-lg p-3 border",
                      isSystem ? "bg-[var(--surface-pill)] border-[var(--border-default)] border-dashed" : "bg-[var(--surface-card)] border-[var(--border-default)]"
                    )}>
                      <div className="flex items-center gap-2 mb-1">
                        {sender && <span className="text-[10px] font-bold text-[var(--text-primary)]">{sender.name}</span>}
                        <span className="text-[10px] font-bold text-[var(--text-warning)]">
                          <ClientTime date={msg.timestamp} showDate={true} />
                        </span>
                        <div className="ml-auto flex items-center gap-0.5 shrink-0">
                          {!isSystem && (
                            <button
                              type="button"
                              onClick={() => handleCopyMessageToTicket(msg)}
                              title="Copiar para Chamado"
                              className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:bg-[var(--surface-pill)]"
                            >
                              <Copy size={12} />
                            </button>
                          )}
                          {canEditMessage(msg) && editingMessageId !== msg.id && (
                            <button
                              type="button"
                              onClick={() => startEditMessage(msg)}
                              title="Editar nota"
                              aria-label="Editar nota"
                              className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-warning)] hover:bg-[var(--surface-pill)]"
                            >
                              <Pencil size={12} />
                            </button>
                          )}
                          {canManageMessages && (
                            <button
                              type="button"
                              onClick={() => setMessageToDelete(msg)}
                              title="Apagar mensagem"
                              aria-label="Apagar mensagem"
                              className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-danger)] hover:bg-[var(--surface-danger)]"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                      {editingMessageId === msg.id ? (
                        <div className="space-y-2">
                          <RichEditor toolbar="basic" content={editingText} onChange={onEditDraft} minHeight="80px" maxHeight="35vh" />
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => { setEditingMessageId(null); setEditingText(''); }}
                              disabled={isSavingEdit}
                              className="px-3 py-1 rounded-lg text-xs font-bold border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] disabled:opacity-50"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={handleSaveEdit}
                              disabled={isSavingEdit}
                              className="px-3 py-1 rounded-lg text-xs font-bold bg-[var(--accent-warning-hover)] text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
                            >
                              {isSavingEdit && <Loader2 size={12} className="animate-spin" />} Salvar
                            </button>
                          </div>
                        </div>
                      ) : (
                      <>
                        {htmlHasContent(msg.text) && (
                          <p
                            className={cn("text-sm whitespace-pre-wrap", isSystem ? "text-[var(--text-tertiary)]" : "text-[var(--text-secondary)]")}
                            dangerouslySetInnerHTML={{ __html: msg.text }}
                          />
                        )}
                        {/* Anexos da nota — antes só apareciam na aba Anexos, e a nota
                            só com arquivo ficava como um balão em branco. */}
                        <ChatAttachmentList attachments={msg.attachments || []} />
                      </>
                      )}
                    </div>
                  );
                })}
              </div>
            );
            })()}
          </div>
          <div className="p-4 border-t border-[var(--border-default)]">
            {previewAttachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {previewAttachments.map(att => (
                  <div key={att.id} className="flex items-center gap-1 px-2 py-1 bg-[var(--surface-pill)] rounded-lg text-[10px] text-[var(--text-secondary)]">
                    <Paperclip size={10} />
                    <span className="truncate max-w-[160px]">{att.name}</span>
                    <button type="button" onClick={() => setPreviewAttachments(prev => prev.filter(a => a.id !== att.id))} title="Remover anexo" aria-label={`Remover ${att.name}`} className="text-[var(--text-danger)]">
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <RichEditor key={composerKey} toolbar="basic" content="" onChange={onNoteDraft} placeholder="Digite sua nota interna..." minHeight="80px" maxHeight="35vh" />
            <div className="flex justify-between items-center mt-3">
              <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="px-3 py-1 rounded-lg text-xs font-bold border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-card)] flex items-center gap-1 disabled:opacity-50">
                {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />} {isUploading ? 'ENVIANDO...' : 'ANEXAR'}
              </button>
              <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} className="hidden" />
              <button onClick={handleSendMessage} disabled={(!noteHasText && previewAttachments.length === 0) || isUploading}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-[var(--accent-warning-hover)] text-white hover:opacity-90 disabled:bg-[var(--surface-pill)] disabled:text-[var(--text-tertiary)] disabled:cursor-not-allowed disabled:hover:opacity-100 flex items-center gap-1">
                <Send size={14} /> ENVIAR
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal: criar hotfix na hora */}
      {showCreateHotfixModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4" onClick={() => setShowCreateHotfixModal(false)}>
          <div className="bg-[var(--surface-card)] rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black text-[var(--text-primary)] mb-4 uppercase flex items-center gap-2">
              <Rocket size={18} className="text-[var(--text-danger)]" /> Criar Hotfix
            </h3>
            <div className="space-y-3">
              <div>
                <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase mb-1">Nome</p>
                <input
                  autoFocus
                  value={newHotfixName}
                  onChange={(e) => setNewHotfixName(e.target.value)}
                  placeholder="Ex: Correção do relatório de vendas"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] text-sm focus:border-[var(--text-warning-strong)] outline-none"
                />
              </div>
              <div>
                <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase mb-1">Data prevista</p>
                <input
                  type="date"
                  value={newHotfixDate}
                  onChange={(e) => setNewHotfixDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] text-sm focus:border-[var(--text-warning-strong)] outline-none"
                />
              </div>
              <p className="text-[10px] text-[var(--text-tertiary)]">
                Responsável e produto ficam em branco por aqui — dá pra completar depois em Hotfixes.
              </p>
            </div>
            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-[var(--border-default)]">
              <button onClick={() => setShowCreateHotfixModal(false)} className="px-4 py-2 rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all text-sm font-bold">
                Cancelar
              </button>
              <button
                onClick={handleCreateHotfix}
                disabled={isCreatingHotfix}
                className="px-4 py-2 rounded-lg bg-[var(--text-danger)] text-white hover:opacity-90 transition-all text-sm font-bold disabled:opacity-50 flex items-center gap-2"
              >
                {isCreatingHotfix && <Loader2 size={14} className="animate-spin" />} Criar
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Picker: escolher entre os chamados já vinculados ao copiar uma nota */}
      <ConfirmDialog
        isOpen={!!messageToDelete}
        onClose={() => { if (!isDeletingMessage) setMessageToDelete(null); }}
        onConfirm={handleDeleteMessage}
        title="Apagar mensagem?"
        description="A mensagem some do histórico deste ticket para todo mundo e não pode ser recuperada pela tela. O conteúdo fica guardado no Log de Alterações."
        confirmLabel="Apagar"
        variant="danger"
      />

      {copyPickerFor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4" onClick={() => setCopyPickerFor(null)}>
          <div className="bg-[var(--surface-card)] rounded-2xl p-6 max-w-lg w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black text-[var(--text-primary)] mb-4 uppercase">Copiar para qual chamado?</h3>
            <div className="flex-1 overflow-y-auto -mx-2 px-2 space-y-2">
              {linkedTickets.map((t) => (
                <button key={t.id} onClick={() => proceedCopyToTicket(t.id, copyPickerFor)} className="w-full p-3 text-left border border-[var(--border-default)] rounded-lg hover:bg-[var(--surface-pill)] transition-all flex items-center gap-3">
                  <span className="text-[10px] font-black text-[var(--accent-text)] bg-[var(--accent)]/10 px-2 py-0.5 rounded shrink-0">#{t.ticketNumber ? String(t.ticketNumber).padStart(4, '0') : t.id.slice(0, 8)}</span>
                  <span className="text-sm font-bold text-[var(--text-primary)] truncate">{t.title}</span>
                </button>
              ))}
            </div>
            <div className="flex justify-end mt-4 pt-4 border-t border-[var(--border-default)]">
              <button onClick={() => setCopyPickerFor(null)} className="px-4 py-2 rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-card)] transition-all text-sm font-bold">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      </motion.div>
    </div>
  );
}
