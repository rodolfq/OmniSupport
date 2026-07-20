'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { StyledSelect } from '@/components/styled-select';
import { useApp } from '@/app/app-context';
import { UserRole, Permission } from '@/lib/types';
import { getChatHistories } from '@/lib/services/chat-service';
import { fetchUsers, fetchQueues } from '@/lib/services/config-service';
import { CompanyService } from '@/lib/services/company-service';
import { parseTranscript } from '@/lib/transcript-format';
import {
  Search, Clock, User, MessageSquare, ThumbsUp, ThumbsDown, Minus, Filter,
  ChevronDown, X, FileText, FileDown, Archive, Ticket as TicketIcon, Building2,
  GripVertical, Columns3, CheckSquare, Square, Shield
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// "Cliente" = empresa contratante (companyName); "Funcionário" = a pessoa do
// lado do cliente que efetivamente conversou (customerName); "Equipe" = quem
// da nossa equipe interna atendeu (assigneeName). Não confundir os três.
interface HistoryColumnDef {
  id: string;
  label: string;
  defaultVisible: boolean;
}

const ALL_HISTORY_COLUMNS: HistoryColumnDef[] = [
  { id: 'chamado', label: 'Chamado', defaultVisible: true },
  { id: 'inicio', label: 'Início', defaultVisible: true },
  { id: 'fim', label: 'Fim', defaultVisible: true },
  { id: 'resposta', label: '1ª Resposta', defaultVisible: true },
  { id: 'avaliacao', label: 'Avaliação', defaultVisible: true },
  { id: 'cliente', label: 'Cliente', defaultVisible: true },
  { id: 'funcionario', label: 'Funcionário', defaultVisible: true },
  { id: 'equipe', label: 'Equipe', defaultVisible: true },
  { id: 'telefone', label: 'Telefone', defaultVisible: false },
  { id: 'duracao', label: 'Duração', defaultVisible: false },
  { id: 'fila', label: 'Fila', defaultVisible: false }
];
const DEFAULT_COLUMN_ORDER = ALL_HISTORY_COLUMNS.map(c => c.id);
const DEFAULT_HIDDEN_COLUMNS = ALL_HISTORY_COLUMNS.filter(c => !c.defaultVisible).map(c => c.id);
const COLUMN_PREFS_STORAGE_KEY = 'chat-history-columns-v1';

function loadColumnPrefs(): { order: string[]; hidden: string[] } {
  if (typeof window === 'undefined') return { order: DEFAULT_COLUMN_ORDER, hidden: DEFAULT_HIDDEN_COLUMNS };
  try {
    const raw = localStorage.getItem(COLUMN_PREFS_STORAGE_KEY);
    if (!raw) return { order: DEFAULT_COLUMN_ORDER, hidden: DEFAULT_HIDDEN_COLUMNS };
    const parsed = JSON.parse(raw);
    const knownIds = new Set(DEFAULT_COLUMN_ORDER);
    const savedOrder = Array.isArray(parsed.order) ? parsed.order.filter((id: string) => knownIds.has(id)) : [];
    // Colunas novas que não existiam quando a preferência foi salva entram no final.
    const missing = DEFAULT_COLUMN_ORDER.filter(id => !savedOrder.includes(id));
    const hidden = Array.isArray(parsed.hidden) ? parsed.hidden.filter((id: string) => knownIds.has(id)) : DEFAULT_HIDDEN_COLUMNS;
    return { order: [...savedOrder, ...missing], hidden };
  } catch {
    return { order: DEFAULT_COLUMN_ORDER, hidden: DEFAULT_HIDDEN_COLUMNS };
  }
}

function formatDuration(seconds?: number | null) {
  if (seconds === null || seconds === undefined) return '-';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function formatDateTime(iso?: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function ticketLabel(h: any) {
  return h.ticketNumber ? `#${String(h.ticketNumber).padStart(4, '0')}` : '-';
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function safeFileNamePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40);
}

function historyFileBaseName(h: any) {
  const ticket = h.ticketNumber ? `chamado_${String(h.ticketNumber).padStart(4, '0')}` : `conversa_${h.id.slice(0, 8)}`;
  const date = h.finishedAt ? new Date(h.finishedAt).toISOString().slice(0, 10) : 'sem_data';
  const employee = safeFileNamePart(h.customerName || 'contato');
  return `${ticket}_${date}_${employee}`;
}

function buildTxtContent(h: any): string {
  const header = [
    h.ticketNumber ? `Chamado: #${String(h.ticketNumber).padStart(4, '0')}` : 'Chamado: -',
    `Cliente: ${h.companyName || '-'}`,
    `Funcionário: ${h.customerName || '-'}`,
    `Equipe: ${h.assigneeName || '-'}`,
    `Início: ${formatDateTime(h.startedAt)}`,
    `Fim: ${formatDateTime(h.finishedAt)}`,
    `1ª resposta: ${formatDuration(h.firstResponseSeconds)}`,
    `Avaliação: ${h.rating === 1 ? 'Positiva' : h.rating === -1 ? 'Negativa' : 'Sem avaliação'}`,
    ''
  ].join('\n');
  return header + '\n' + (h.transcript || '');
}

// PDF gerado no navegador (jsPDF), sem depender de nada no servidor — os
// nomes de quem fala (funcionário do cliente x equipe interna) ficam em
// negrito/cores diferentes pra facilitar a leitura de quem está por fora da
// conversa.
async function buildHistoryPdfBlob(h: any): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 40;
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - marginX * 2;
  let y = 50;

  const ensureSpace = (lines: number, lineHeight = 13) => {
    if (y + lines * lineHeight > pageHeight - 40) {
      doc.addPage();
      y = 50;
    }
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('Histórico de Conversa', marginX, y);
  y += 24;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(60);
  const meta = [
    `Chamado: ${ticketLabel(h)}`,
    `Cliente: ${h.companyName || '-'}`,
    `Funcionário: ${h.customerName || '-'}`,
    `Equipe: ${h.assigneeName || '-'}`,
    `Início: ${formatDateTime(h.startedAt)}`,
    `Fim: ${formatDateTime(h.finishedAt)}`,
    `1ª resposta: ${formatDuration(h.firstResponseSeconds)}`,
    `Avaliação: ${h.rating === 1 ? 'Positiva' : h.rating === -1 ? 'Negativa' : 'Sem avaliação'}`
  ];
  meta.forEach(line => { doc.text(line, marginX, y); y += 13; });
  y += 8;

  doc.setDrawColor(210);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 20;

  const lines = parseTranscript(h.transcript, h.customerName);
  doc.setFontSize(10);
  for (const line of lines) {
    if (line.type === 'note') {
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(130);
      const wrapped = doc.splitTextToSize(line.text, maxWidth);
      ensureSpace(wrapped.length);
      doc.text(wrapped, marginX, y);
      y += wrapped.length * 13;
      continue;
    }

    const label = `${line.time ? '[' + line.time + '] ' : ''}${line.sender}:`;
    const color: [number, number, number] = line.isCustomer ? [13, 58, 105] : [16, 130, 110];
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...color);
    ensureSpace(1);
    doc.text(label, marginX, y);
    const labelWidth = doc.getTextWidth(label + ' ');

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40);
    const wrapped = doc.splitTextToSize(line.text, Math.max(maxWidth - labelWidth, 80));
    if (wrapped.length > 0) {
      doc.text(wrapped[0], marginX + labelWidth, y);
      y += 13;
      for (let i = 1; i < wrapped.length; i++) {
        ensureSpace(1);
        doc.text(wrapped[i], marginX + 12, y);
        y += 13;
      }
    }
    y += 5;
  }

  return doc.output('blob');
}

function TranscriptView({ transcript, customerName }: { transcript: string; customerName?: string }) {
  const lines = useMemo(() => parseTranscript(transcript, customerName), [transcript, customerName]);
  if (!lines.length) return <p className="text-xs text-[var(--text-tertiary)] font-medium">Sem mensagens registradas.</p>;

  return (
    <div className="space-y-2">
      {lines.map((line, idx) => {
        if (line.type === 'note') {
          return <p key={idx} className="text-[11px] italic text-[var(--text-tertiary)]">{line.text}</p>;
        }
        return (
          <p key={idx} className="text-xs leading-relaxed">
            {line.time && <span className="text-[var(--text-tertiary)] font-mono mr-1.5">[{line.time}]</span>}
            <span className={cn(
              "font-black uppercase tracking-tight mr-1.5",
              line.isCustomer ? "text-[var(--accent-text)]" : "text-[var(--text-success)]"
            )}>
              {line.sender}:
            </span>
            <span className="text-[var(--text-secondary)] font-medium">{line.text}</span>
          </p>
        );
      })}
    </div>
  );
}

function SortableColumnHeader({ id, label }: { id: string; label: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 0,
    position: 'relative' as const
  };

  return (
    <th
      ref={setNodeRef}
      style={style}
      className={cn(
        "px-5 py-4 text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest select-none whitespace-nowrap",
        isDragging && "bg-[var(--surface-card)] shadow-lg opacity-80"
      )}
    >
      <div className="flex items-center gap-1.5">
        <span {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-[var(--text-tertiary)] -ml-1">
          <GripVertical size={12} />
        </span>
        {label}
      </div>
    </th>
  );
}

export default function ChatHistoryPage() {
  const { currentUser, hasPermission, refreshTrigger } = useApp();
  const [histories, setHistories] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [queues, setQueues] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [ratingFilter, setRatingFilter] = useState<'all' | 'liked' | 'disliked' | 'unrated'>('all');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [queueFilter, setQueueFilter] = useState<string>('all');
  const [selectedHistory, setSelectedHistory] = useState<any | null>(null);
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);

  const [columnOrder, setColumnOrder] = useState<string[]>(() => loadColumnPrefs().order);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(() => loadColumnPrefs().hidden);
  const [isColumnPickerOpen, setIsColumnPickerOpen] = useState(false);
  const columnPickerRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (!currentUser || !hasPermission(Permission.TICKETS_READ)) return;

    getChatHistories()
      .then(setHistories)
      .catch(err => console.error('Error loading chat histories:', err));

    fetchUsers().then(setUsers).catch(() => {});
    fetchQueues().then(setQueues).catch(() => {});
    CompanyService.getAll().then(setCompanies).catch(() => {});
  }, [currentUser?.id, refreshTrigger]);

  useEffect(() => {
    localStorage.setItem(COLUMN_PREFS_STORAGE_KEY, JSON.stringify({ order: columnOrder, hidden: hiddenColumns }));
  }, [columnOrder, hiddenColumns]);

  useEffect(() => {
    if (!isColumnPickerOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (columnPickerRef.current && !columnPickerRef.current.contains(e.target as Node)) {
        setIsColumnPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isColumnPickerOpen]);

  const visibleColumnIds = useMemo(() => columnOrder.filter(id => !hiddenColumns.includes(id)), [columnOrder, hiddenColumns]);

  const handleColumnDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setColumnOrder(items => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const toggleColumn = (id: string) => {
    setHiddenColumns(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const applyDatePreset = (preset: 'all' | 'today' | 'week' | 'month') => {
    if (preset === 'all') {
      setDateFrom('');
      setDateTo('');
      return;
    }
    const today = new Date();
    const from = new Date(today);
    if (preset === 'week') from.setDate(from.getDate() - 6);
    if (preset === 'month') from.setDate(from.getDate() - 29);
    setDateFrom(from.toISOString().slice(0, 10));
    setDateTo(today.toISOString().slice(0, 10));
  };

  const activeDatePreset = useMemo(() => {
    if (!dateFrom && !dateTo) return 'all';
    const today = new Date().toISOString().slice(0, 10);
    if (dateFrom === today && dateTo === today) return 'today';
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
    if (dateFrom === weekAgo.toISOString().slice(0, 10) && dateTo === today) return 'week';
    const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 29);
    if (dateFrom === monthAgo.toISOString().slice(0, 10) && dateTo === today) return 'month';
    return 'custom';
  }, [dateFrom, dateTo]);

  const filteredHistories = useMemo(() => {
    return histories.filter(h => {
      const ticketDigits = h.ticketNumber ? String(h.ticketNumber) : '';
      const searchDigits = search.replace(/\D/g, '');
      const matchesSearch = search === '' ||
        h.customerName?.toLowerCase().includes(search.toLowerCase()) ||
        h.companyName?.toLowerCase().includes(search.toLowerCase()) ||
        h.transcript?.toLowerCase().includes(search.toLowerCase()) ||
        h.assigneeName?.toLowerCase().includes(search.toLowerCase()) ||
        (searchDigits !== '' && ticketDigits.includes(searchDigits));

      let matchesDate = true;
      if (dateFrom || dateTo) {
        const started = h.startedAt ? new Date(h.startedAt) : null;
        if (!started) matchesDate = false;
        else {
          if (dateFrom && started < new Date(dateFrom + 'T00:00:00')) matchesDate = false;
          if (dateTo && started > new Date(dateTo + 'T23:59:59')) matchesDate = false;
        }
      }

      let matchesRating = true;
      if (ratingFilter === 'liked') matchesRating = h.rating === 1;
      else if (ratingFilter === 'disliked') matchesRating = h.rating === -1;
      else if (ratingFilter === 'unrated') matchesRating = h.rating !== 1 && h.rating !== -1;

      const matchesTeam = teamFilter === 'all' || h.assigneeId === teamFilter;
      const matchesEmployee = employeeFilter === 'all' || h.customerId === employeeFilter;
      const matchesCompany = companyFilter === 'all' || h.companyId === companyFilter;
      const matchesQueue = queueFilter === 'all' || h.queueId === queueFilter;

      return matchesSearch && matchesDate && matchesRating && matchesTeam && matchesEmployee && matchesCompany && matchesQueue;
    });
  }, [histories, search, dateFrom, dateTo, ratingFilter, teamFilter, employeeFilter, companyFilter, queueFilter]);

  const handleDownloadTxt = (h: any) => {
    downloadBlob(`${historyFileBaseName(h)}.txt`, new Blob([buildTxtContent(h)], { type: 'text/plain;charset=utf-8' }));
  };

  const handleDownloadPdf = async (h: any) => {
    try {
      const blob = await buildHistoryPdfBlob(h);
      downloadBlob(`${historyFileBaseName(h)}.pdf`, blob);
    } catch (err) {
      console.error('Error generating PDF:', err);
      toast.error('Erro ao gerar o PDF.');
    }
  };

  const handleBulkDownloadZip = async () => {
    if (filteredHistories.length === 0) {
      toast.info('Nenhuma conversa para baixar com os filtros atuais.');
      return;
    }
    setIsBulkDownloading(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const usedNames = new Set<string>();
      filteredHistories.forEach(h => {
        let name = `${historyFileBaseName(h)}.txt`;
        let suffix = 2;
        while (usedNames.has(name)) {
          name = `${historyFileBaseName(h)}_${suffix}.txt`;
          suffix++;
        }
        usedNames.add(name);
        zip.file(name, buildTxtContent(h));
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(`conversas_${new Date().toISOString().slice(0, 10)}.zip`, blob);
      toast.success(`${filteredHistories.length} conversa(s) baixada(s) em .zip.`);
    } catch (err) {
      console.error('Error building bulk zip:', err);
      toast.error('Erro ao gerar o arquivo .zip.');
    } finally {
      setIsBulkDownloading(false);
    }
  };

  const renderCell = (columnId: string, h: any) => {
    switch (columnId) {
      case 'chamado':
        return <td key="chamado" className="px-5 py-4 text-sm font-black text-[var(--accent-text)] whitespace-nowrap">{ticketLabel(h)}</td>;
      case 'inicio':
        return <td key="inicio" className="px-5 py-4 text-xs font-bold text-[var(--text-secondary)] whitespace-nowrap">{formatDateTime(h.startedAt)}</td>;
      case 'fim':
        return <td key="fim" className="px-5 py-4 text-xs font-bold text-[var(--text-secondary)] whitespace-nowrap">{formatDateTime(h.finishedAt)}</td>;
      case 'resposta':
        return <td key="resposta" className="px-5 py-4 text-xs font-medium text-[var(--text-tertiary)] whitespace-nowrap">{formatDuration(h.firstResponseSeconds)}</td>;
      case 'avaliacao':
        return (
          <td key="avaliacao" className="px-5 py-4">
            {h.rating === 1 && <ThumbsUp className="text-[var(--text-success)]" size={16} />}
            {h.rating === -1 && <ThumbsDown className="text-[var(--text-danger)]" size={16} />}
            {h.rating !== 1 && h.rating !== -1 && <Minus className="text-[var(--text-tertiary)]" size={16} />}
          </td>
        );
      case 'cliente':
        return <td key="cliente" className="px-5 py-4 text-sm font-bold text-[var(--text-primary)] truncate max-w-[180px]">{h.companyName || '-'}</td>;
      case 'funcionario':
        return <td key="funcionario" className="px-5 py-4 text-xs font-bold text-[var(--text-secondary)] truncate max-w-[160px]">{h.customerName || '-'}</td>;
      case 'equipe':
        return <td key="equipe" className="px-5 py-4 text-xs font-bold text-[var(--text-secondary)] truncate max-w-[160px]">{h.assigneeName || '-'}</td>;
      case 'telefone':
        return <td key="telefone" className="px-5 py-4 text-xs font-medium text-[var(--text-tertiary)] whitespace-nowrap">{h.customerPhone || '-'}</td>;
      case 'duracao':
        return <td key="duracao" className="px-5 py-4 text-xs font-medium text-[var(--text-tertiary)] whitespace-nowrap">{formatDuration(h.durationSeconds)}</td>;
      case 'fila':
        return <td key="fila" className="px-5 py-4 text-xs font-medium text-[var(--text-tertiary)] truncate max-w-[140px]">{h.queueName || '-'}</td>;
      default:
        return null;
    }
  };

  if (!currentUser || ![UserRole.ADMIN, UserRole.SUPPORT].includes(currentUser.role as UserRole)) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[var(--text-tertiary)]">Acesso negado</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-[var(--text-primary)] uppercase tracking-tight">Histórico de Conversas</h2>
          <p className="text-[var(--text-tertiary)] font-medium mt-1">Acesse todas as conversas finalizadas</p>
        </div>
        <button
          onClick={handleBulkDownloadZip}
          disabled={isBulkDownloading || filteredHistories.length === 0}
          className="flex items-center gap-2 px-5 py-3 bg-slate-900 text-white rounded-2xl text-[11px] font-semibold uppercase tracking-widest hover:bg-slate-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          <Archive size={16} /> {isBulkDownloading ? 'Gerando .zip...' : `Baixar Filtradas (${filteredHistories.length})`}
        </button>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={18} />
            <input
              type="text"
              placeholder="Buscar por cliente, funcionário, equipe, nº do chamado ou conteúdo..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl py-3 pl-12 pr-4 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none"
            />
          </div>

          <div className="relative">
            <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <StyledSelect
              value={companyFilter}
              onChange={e => setCompanyFilter(e.target.value)}
              className="pl-9 pr-8 py-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl text-xs font-bold outline-none focus:ring-4 focus:ring-[var(--accent)]/10 appearance-none cursor-pointer"
            >
              <option value="all">Todos os Clientes</option>
              {companies.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </StyledSelect>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] pointer-events-none" />
          </div>

          <div className="relative">
            <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <StyledSelect
              value={employeeFilter}
              onChange={e => setEmployeeFilter(e.target.value)}
              className="pl-9 pr-8 py-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl text-xs font-bold outline-none focus:ring-4 focus:ring-[var(--accent)]/10 appearance-none cursor-pointer"
            >
              <option value="all">Todos os Funcionários</option>
              {users.filter(u => [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(u.role as UserRole)).map(u => (
                <option key={u.id} value={u.id}>{u.name || u.email}</option>
              ))}
            </StyledSelect>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] pointer-events-none" />
          </div>

          <div className="relative">
            <Shield size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <StyledSelect
              value={teamFilter}
              onChange={e => setTeamFilter(e.target.value)}
              className="pl-9 pr-8 py-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl text-xs font-bold outline-none focus:ring-4 focus:ring-[var(--accent)]/10 appearance-none cursor-pointer"
            >
              <option value="all">Toda a Equipe</option>
              {users.filter(u => [UserRole.ADMIN, UserRole.SUPPORT, UserRole.EMPLOYEE].includes(u.role as UserRole)).map(u => (
                <option key={u.id} value={u.id}>{u.name || u.email}</option>
              ))}
            </StyledSelect>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] pointer-events-none" />
          </div>

          <div className="relative">
            <TicketIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <StyledSelect
              value={queueFilter}
              onChange={e => setQueueFilter(e.target.value)}
              className="pl-9 pr-8 py-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl text-xs font-bold outline-none focus:ring-4 focus:ring-[var(--accent)]/10 appearance-none cursor-pointer"
            >
              <option value="all">Todas Filas</option>
              {queues.map((q: any) => (
                <option key={q.id} value={q.id}>{q.name}</option>
              ))}
            </StyledSelect>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] pointer-events-none" />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              {[
                { value: 'all', label: 'Tudo' },
                { value: 'today', label: 'Hoje' },
                { value: 'week', label: '7 dias' },
                { value: 'month', label: '30 dias' }
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => applyDatePreset(opt.value as any)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-widest transition-all",
                    activeDatePreset === opt.value ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-pill)] text-[var(--text-secondary)] hover:bg-[var(--border-default)]"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg px-2.5 py-1.5 text-[11px] font-bold outline-none focus:ring-4 focus:ring-[var(--accent)]/10"
              />
              <span className="text-[10px] text-[var(--text-tertiary)] font-semibold uppercase">até</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg px-2.5 py-1.5 text-[11px] font-bold outline-none focus:ring-4 focus:ring-[var(--accent)]/10"
              />
              {(dateFrom || dateTo) && (
                <button onClick={() => applyDatePreset('all')} className="p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-danger)]" title="Limpar datas">
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Filter size={16} className="text-[var(--text-tertiary)]" />
              {[
                { value: 'all', label: 'Todos' },
                { value: 'liked', label: 'Curtidos' },
                { value: 'disliked', label: 'Não curtidos' },
                { value: 'unrated', label: 'Sem avaliação' }
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setRatingFilter(opt.value as any)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-widest transition-all",
                    ratingFilter === opt.value ? "bg-[var(--text-success)] text-white" : "bg-[var(--surface-pill)] text-[var(--text-secondary)] hover:bg-[var(--border-default)]"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative" ref={columnPickerRef}>
            <button
              onClick={() => setIsColumnPickerOpen(o => !o)}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all"
            >
              <Columns3 size={14} /> Colunas
            </button>
            {isColumnPickerOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-xl p-3 z-20 space-y-0.5">
                <p className="text-[9px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest px-2 pb-1">Mostrar colunas</p>
                {columnOrder.map(id => {
                  const col = ALL_HISTORY_COLUMNS.find(c => c.id === id);
                  if (!col) return null;
                  const isVisible = !hiddenColumns.includes(id);
                  return (
                    <button
                      key={id}
                      onClick={() => toggleColumn(id)}
                      className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--surface-pill)] text-left transition-colors"
                    >
                      <span className="text-xs font-bold text-[var(--text-secondary)]">{col.label}</span>
                      {isVisible ? <CheckSquare size={14} className="text-[var(--accent-text)]" /> : <Square size={14} className="text-slate-300" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Results table */}
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] shadow-sm overflow-hidden">
        {filteredHistories.length === 0 ? (
          <div className="text-center py-20">
            <MessageSquare className="mx-auto text-slate-300 mb-4" size={48} />
            <p className="text-[var(--text-tertiary)] font-medium">Nenhuma conversa encontrada</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleColumnDragEnd}>
              <table className="w-full text-left min-w-[900px]">
                <thead className="bg-[var(--surface-card)]/50 border-b border-[var(--border-default)]">
                  <tr>
                    <SortableContext items={visibleColumnIds} strategy={horizontalListSortingStrategy}>
                      {visibleColumnIds.map(id => {
                        const col = ALL_HISTORY_COLUMNS.find(c => c.id === id)!;
                        return <SortableColumnHeader key={id} id={id} label={col.label} />;
                      })}
                    </SortableContext>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-default)]">
                  {filteredHistories.map(h => (
                    <tr
                      key={h.id}
                      onClick={() => setSelectedHistory(h)}
                      className="hover:bg-[var(--surface-card)]/70 cursor-pointer transition-colors"
                    >
                      {visibleColumnIds.map(id => renderCell(id, h))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </DndContext>
          </div>
        )}
      </div>

      {/* Detail modal */}
      <AnimatePresence>
        {selectedHistory && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelectedHistory(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
              className="relative bg-[var(--surface-card)] w-full max-w-2xl max-h-[85vh] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="p-8 border-b border-[var(--border-default)] flex items-start justify-between gap-4 shrink-0">
                <div>
                  <h3 className="text-xl font-black text-[var(--text-primary)] tracking-tight uppercase">{selectedHistory.customerName || 'Contato'}</h3>
                  <p className="text-[10px] text-[var(--text-tertiary)] font-semibold uppercase tracking-widest mt-1">
                    Chamado {ticketLabel(selectedHistory)} · {selectedHistory.companyName || 'Sem empresa'} · Equipe: {selectedHistory.assigneeName || 'Sem responsável'}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest">
                    <span className="flex items-center gap-1"><Clock size={11} /> Início: {formatDateTime(selectedHistory.startedAt)}</span>
                    <span className="flex items-center gap-1"><Clock size={11} /> Fim: {formatDateTime(selectedHistory.finishedAt)}</span>
                    <span className="flex items-center gap-1"><MessageSquare size={11} /> 1ª resposta: {formatDuration(selectedHistory.firstResponseSeconds)}</span>
                  </div>
                </div>
                <button onClick={() => setSelectedHistory(null)} className="p-2 text-[var(--text-tertiary)] hover:text-[var(--text-danger)] hover:bg-[var(--surface-danger)] rounded-xl transition-all shrink-0">
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 bg-[var(--surface-card)]/30">
                <TranscriptView transcript={selectedHistory.transcript} customerName={selectedHistory.customerName} />
              </div>

              <div className="p-6 border-t border-[var(--border-default)] flex items-center gap-3 shrink-0">
                <button
                  onClick={() => handleDownloadTxt(selectedHistory)}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-[var(--surface-card)] border-2 border-[var(--border-default)] text-[var(--text-primary)] rounded-2xl text-[10px] font-semibold uppercase tracking-widest hover:border-[var(--accent)]/40 hover:bg-[var(--surface-pill)] transition-all"
                >
                  <FileText size={14} /> Baixar .TXT
                </button>
                <button
                  onClick={() => handleDownloadPdf(selectedHistory)}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-900 text-white rounded-2xl text-[10px] font-semibold uppercase tracking-widest hover:bg-slate-800 transition-all"
                >
                  <FileDown size={14} /> Baixar .PDF
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
