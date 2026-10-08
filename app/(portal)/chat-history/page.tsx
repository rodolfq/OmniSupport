'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useEscapeToClose } from '@/hooks/use-escape-to-close';
import { useSearchParams } from 'next/navigation';
import { StyledSelect } from '@/components/styled-select';
import { useApp } from '@/app/app-context';
import { UserRole, Permission, ChatMessage, Attachment } from '@/lib/types';
import { isImageAttachment, isAudioAttachment, isVideoAttachment } from '@/lib/attachment-kind';
import { getChatHistories, fetchSessionMessages, summarizeChatHistory, requeueDissatisfaction, ChatSummaryResult, SessionMessagesResult } from '@/lib/services/chat-service';
import { fetchQueues } from '@/lib/services/config-service';
import { CompanyService } from '@/lib/services/company-service';
import { useProfilesLiteQuery } from '@/lib/query-hooks';
import { parseTranscript } from '@/lib/transcript-format';
import { ChatAttachmentList } from '@/components/chat-attachment-list';
import { LinkContactModal, HistoryLinkResult } from '@/components/link-contact-modal';
import { StartWhatsAppConversationModal } from '@/components/start-whatsapp-conversation-modal';
import { useAutoTranscribeMissingAudio } from '@/hooks/use-auto-transcribe-missing-audio';
import {
  Search, Clock, User, MessageSquare, ThumbsUp, ThumbsDown, Minus, Filter,
  ChevronDown, X, FileText, FileDown, Archive, Ticket as TicketIcon, Building2,
  GripVertical, Columns3, CheckSquare, Square, Shield, Sparkles, RotateCcw, Link2, MessageCircle, RefreshCw, GraduationCap
} from 'lucide-react';
import { cn, normalizeBrazilianPhoneDigits } from '@/lib/utils';
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
  { id: 'chamado', label: 'Chat', defaultVisible: true },
  { id: 'inicio', label: 'Início', defaultVisible: true },
  { id: 'fim', label: 'Fim', defaultVisible: true },
  { id: 'resposta', label: '1ª Resposta', defaultVisible: true },
  { id: 'avaliacao', label: 'Avaliação', defaultVisible: true },
  { id: 'resumoProcessado', label: 'Resumo processado', defaultVisible: true },
  { id: 'insatisfacao', label: 'Insatisfação', defaultVisible: true },
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
  // Tempo negativo nunca é válido (era relógio de navegador atrasado gravado no histórico):
  // mostra "-" em vez de "-3m 20s" caso algum valor assim ainda apareça.
  if (seconds === null || seconds === undefined || seconds < 0) return '-';
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
  const ticket = h.ticketNumber ? `chat_${String(h.ticketNumber).padStart(4, '0')}` : `conversa_${h.id.slice(0, 8)}`;
  const date = h.finishedAt ? new Date(h.finishedAt).toISOString().slice(0, 10) : 'sem_data';
  const employee = safeFileNamePart(h.customerName || 'contato');
  return `${ticket}_${date}_${employee}`;
}

function buildTxtContent(h: any): string {
  const header = [
    h.ticketNumber ? `Chat: #${String(h.ticketNumber).padStart(4, '0')}` : 'Chat: -',
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
// conversa. Quando `messages` (de fetchSessionMessages) é passado, usa a
// versão rica — imagem embutida, transcrição de áudio como texto, vídeo/
// arquivo como link elegante de download. Sem `messages`, cai no texto puro
// de sempre (h.transcript) — comportamento 100% preservado.
async function buildHistoryPdfBlob(h: any, messages?: ChatMessage[]): Promise<Blob> {
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
    `Chat: ${ticketLabel(h)}`,
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

  if (messages && messages.length > 0) {
    const addWrappedParagraph = (text: string, color: [number, number, number], italic = false) => {
      doc.setFont('helvetica', italic ? 'italic' : 'normal');
      doc.setTextColor(...color);
      const wrapped = doc.splitTextToSize(text, maxWidth - 12);
      ensureSpace(wrapped.length);
      doc.text(wrapped, marginX + 12, y);
      y += wrapped.length * 13;
    };

    const addElegantFileBox = (label: string, name: string, size: number | undefined, downloadUrl: string) => {
      const boxHeight = 46;
      ensureSpace(Math.ceil(boxHeight / 13) + 1, 13);
      doc.setDrawColor(220);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(marginX, y, maxWidth, boxHeight, 6, 6, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(30);
      doc.text(`${label} · ${name || 'arquivo'}`, marginX + 12, y + 17);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(size ? `${Math.ceil(size / 1024)} KB` : '', marginX + 12, y + 29);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(16, 130, 110);
      doc.textWithLink('Baixar arquivo →', marginX + 12, y + 41, { url: downloadUrl });
      doc.setFontSize(10);
      y += boxHeight + 10;
    };

    // jsPDF.addImage só aceita data: URL / base64 — anexo que hoje mora no
    // volume (/api/files/...) precisa ser baixado e convertido antes, senão a
    // imagem simplesmente não entra no PDF.
    const toDataUrl = async (url: string): Promise<string> => {
      if (url.startsWith('data:')) return url;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Falha ao baixar anexo');
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Falha ao ler anexo'));
        reader.readAsDataURL(blob);
      });
    };

    const addImageBlock = async (attachment: Attachment): Promise<boolean> => {
      try {
        const imageDataUrl = await toDataUrl(attachment.url);
        const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
          const img = new window.Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => reject(new Error('Falha ao carregar imagem'));
          img.src = imageDataUrl;
        });
        if (!dims.w || !dims.h) throw new Error('Dimensões inválidas');

        let drawWidth = Math.min(maxWidth, 260);
        let drawHeight = drawWidth * (dims.h / dims.w);
        if (drawHeight > 260) {
          drawHeight = 260;
          drawWidth = drawHeight * (dims.w / dims.h);
        }
        ensureSpace(Math.ceil(drawHeight / 13) + 2, 13);
        const format = (imageDataUrl.match(/^data:image\/(\w+)/)?.[1] || 'JPEG').toUpperCase().replace('JPG', 'JPEG');
        doc.addImage(imageDataUrl, format, marginX, y, drawWidth, drawHeight);
        y += drawHeight + 10;
        return true;
      } catch {
        return false;
      }
    };

    const attachmentDownloadUrl = (messageId: string, attachment: Attachment) =>
      `${window.location.origin}/api/chats/attachment?messageId=${encodeURIComponent(messageId)}&attachmentId=${encodeURIComponent(attachment.id || '')}`;

    const renderAttachment = async (messageId: string, attachment: Attachment) => {
      if (isImageAttachment(attachment) && (await addImageBlock(attachment))) return;

      if (isAudioAttachment(attachment)) {
        // Todo áudio no PDF sempre traz os dois: o texto da transcrição (ou
        // um aviso de que não há uma) e o link de download do arquivo
        // original — nunca só um ou outro.
        addWrappedParagraph(
          attachment.transcription ? `"${attachment.transcription}"` : '(transcrição indisponível)',
          [90, 90, 90],
          true
        );
        y += 4;
        addElegantFileBox('Áudio', attachment.name, attachment.size, attachmentDownloadUrl(messageId, attachment));
        return;
      }

      addElegantFileBox(isVideoAttachment(attachment) ? 'Vídeo' : 'Arquivo', attachment.name, attachment.size, attachmentDownloadUrl(messageId, attachment));
    };

    doc.setFontSize(10);
    for (const m of messages as any[]) {
      const senderName = m.senderName || 'Cliente';
      const isCustomer = !!h.customerName && senderName.trim().toLowerCase() === String(h.customerName).trim().toLowerCase();
      const color: [number, number, number] = isCustomer ? [13, 58, 105] : [16, 130, 110];
      const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

      ensureSpace(1);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...color);
      doc.text(`${time ? '[' + time + '] ' : ''}${senderName}:`, marginX, y);
      y += 15;

      if (m.text) {
        addWrappedParagraph(m.text, [40, 40, 40], false);
        y += 4;
      }

      const attachments: Attachment[] = m.attachments || m.metadata?.attachments || [];
      for (const attachment of attachments) {
        await renderAttachment(m.id, attachment);
      }
      y += 6;
    }

    return doc.output('blob');
  }

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

// Versão rica da conversa (imagem/áudio com transcrição/vídeo/arquivo), a
// partir das mensagens ao vivo de chat_messages — ver useEffect de
// sessionMessages. TranscriptView (acima) continua sendo o fallback pra
// histórico sem sessionId ou quando a busca falha.
function RichHistoryMessages({ messages, customerName }: { messages: ChatMessage[]; customerName?: string }) {
  const normalizedCustomer = customerName?.trim().toLowerCase();

  return (
    <div className="space-y-3">
      {messages.map(m => {
        const isCustomer = !!normalizedCustomer && (m.senderName || '').trim().toLowerCase() === normalizedCustomer;
        return (
          <div key={m.id} className="p-4 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl">
            <div className="flex items-center justify-between mb-1 gap-3">
              <span className={cn(
                "text-[11px] font-black uppercase tracking-tight",
                isCustomer ? "text-[var(--accent-text)]" : "text-[var(--text-success)]"
              )}>
                {m.senderName || 'Cliente'}
              </span>
              <span className="text-[10px] text-[var(--text-tertiary)] font-mono shrink-0">
                {formatDateTime(m.timestamp)}
              </span>
            </div>
            {m.text && (
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap break-words">{m.text}</p>
            )}
            <ChatAttachmentList attachments={(m as any).attachments || (m as any).metadata?.attachments || []} />
          </div>
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
  const { currentUser, hasPermission, refreshTrigger, userStatus, setActiveOmniChatId, setIsOmniChatOpen } = useApp();
  const searchParams = useSearchParams();
  const [histories, setHistories] = useState<any[]>([]);
  // Botão "Atualizar": a tela só recarregava sozinha quando o app pedia
  // (refreshTrigger), então conversa que acabou de ser encerrada — ou uma nota
  // de satisfação que chegou depois — só aparecia recarregando a página inteira.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const historiesRef = useRef<any[]>([]);
  historiesRef.current = histories;
  // Só usado em <select> de filtro por nome/papel (sem avatar) — via hook
  // compartilhado "lite" em vez de /api/users?type=all buscado do zero.
  const { data: usersLiteData, refetch: refetchUsers } = useProfilesLiteQuery();
  const users = useMemo(() => (usersLiteData || []) as any[], [usersLiteData]);
  // "Equipe" = quem da equipe INTERNA atendeu: Administrador, Equipe e Time
  // Interno. Antes a lista trazia Funcionário (que é gente do lado do CLIENTE) e
  // deixava de fora o Time Interno — papel de quase todo o Suporte — então o
  // filtro nunca achava quem realmente atende. Em ordem alfabética.
  const teamMembers = useMemo(() => users
    .filter(u => [UserRole.ADMIN, UserRole.SUPPORT, UserRole.INTERNAL].includes(u.role as UserRole))
    .sort((a, b) => String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''), 'pt-BR')),
  [users]);
  const [queues, setQueues] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [ratingFilter, setRatingFilter] = useState<'all' | 'liked' | 'disliked' | 'unrated'>('all');
  const [dissatisfactionFilter, setDissatisfactionFilter] = useState<'all' | 'detected' | 'not_detected' | 'unprocessed'>('all');
  // Conversa com cliente em treinamento ou não (situação ATUAL da empresa).
  const [trainingFilter, setTrainingFilter] = useState<'all' | 'training' | 'not_training'>('all');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [queueFilter, setQueueFilter] = useState<string>('all');
  const [selectedHistory, setSelectedHistory] = useState<any | null>(null);
  useEscapeToClose(!!selectedHistory, () => setSelectedHistory(null));
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);
  // Mensagens "ao vivo" (com anexos e transcrição) da sessão da conversa
  // selecionada — busca em chat_messages, que nunca é apagado quando a
  // conversa fecha (ver fetchSessionMessages). Quando não tem sessionId ou a
  // busca falha, a tela/PDF caem pro texto achatado de sempre (transcript).
  const [sessionMessages, setSessionMessages] = useState<SessionMessagesResult | null>(null);
  const [loadingSessionMessages, setLoadingSessionMessages] = useState(false);

  // "Chat completo" x "Chat Resumido" (resumo por IA, ver
  // lib/services/chat-summary-service.ts). O resumo é permanente: uma vez
  // gerado, fica em chat_histories.summary e as próximas aberturas dessa
  // mesma conversa não geram de novo (nem aqui, nem via API).
  const [historyViewMode, setHistoryViewMode] = useState<'full' | 'summary'>('full');
  const [summaryData, setSummaryData] = useState<ChatSummaryResult | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isRequeuingDissatisfaction, setIsRequeuingDissatisfaction] = useState(false);

  const [columnOrder, setColumnOrder] = useState<string[]>(() => loadColumnPrefs().order);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(() => loadColumnPrefs().hidden);
  const [isColumnPickerOpen, setIsColumnPickerOpen] = useState(false);
  // De que lado o painel "Colunas" abre. Na tela larga o botão fica no canto
  // direito e o painel abre pra esquerda (right-0); em tela estreita a linha
  // quebra e o botão vai pra esquerda — o mesmo right-0 empurrava o painel pra
  // dentro da sidebar, e o <main> (overflow-y: auto, que também corta no eixo X)
  // cortava a metade dele. Decidido ao abrir, pelo espaço real dentro do <main>.
  const [columnPickerAlign, setColumnPickerAlign] = useState<'right' | 'left'>('right');
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [isStartModalOpen, setIsStartModalOpen] = useState(false);

  // Telefone sugerido pro "Iniciar conversa": só se parece um número de verdade
  // (10 a 13 dígitos, com ou sem 55). Conversa antiga do WhatsApp não oficial
  // guarda um identificador interno longo no lugar do telefone — sugerir isso
  // só levaria a um envio que o Pyvon recusa; nesse caso o campo vem em branco
  // e quem inicia digita o número (ou o cadastro do cliente).
  const startPhone = useMemo(() => {
    const digits = String(selectedHistory?.customerPhone || '').replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 13 ? digits : '';
  }, [selectedHistory?.customerPhone]);

  // Quem inicia vira o responsável pela conversa (atribuição no servidor, em
  // PyvonService.startConversation) — por isso a exigência de estar Online vem
  // ANTES de abrir o modal, igual ao "Iniciar conversa" de Empresas: barrar
  // depois deixaria uma conversa criada e atribuída a quem acabou de ser recusado.
  const handleOpenStartConversation = () => {
    if (userStatus !== 'online') {
      toast.error('Você precisa estar Online para assumir atendimentos!');
      return;
    }
    setIsStartModalOpen(true);
  };

  // Outras conversas do MESMO número, ainda sem cliente — alimenta a opção
  // "vincular todas" do modal. Compara o número já normalizado (55 + DDD +
  // assinante), então "85 9..." e "5585 9..." contam como o mesmo.
  const otherUnlinkedSamePhone = useMemo(() => {
    if (!selectedHistory?.customerPhone) return [] as any[];
    const target = normalizeBrazilianPhoneDigits(String(selectedHistory.customerPhone).replace(/\D/g, ''));
    if (!target) return [] as any[];
    return histories.filter(h =>
      h.id !== selectedHistory.id && !h.customerId && h.customerPhone &&
      normalizeBrazilianPhoneDigits(String(h.customerPhone).replace(/\D/g, '')) === target
    );
  }, [histories, selectedHistory]);

  // Depois de vincular no servidor: atualiza as linhas na hora (cliente, empresa
  // e nome do cadastro) sem recarregar a lista inteira.
  const handleHistoryLinked = useCallback((result: HistoryLinkResult) => {
    const ids = new Set(result.historyIds);
    const patch = {
      customerId: result.customerId,
      customerProfileName: result.customerProfileName,
      companyId: result.companyId,
      companyName: result.companyName
    };
    setHistories(prev => prev.map(h => (ids.has(h.id) ? { ...h, ...patch } : h)));
    setSelectedHistory((prev: any) => (prev && ids.has(prev.id) ? { ...prev, ...patch } : prev));
    const extra = result.historyIds.length - 1;
    toast.success(`Contato vinculado a ${result.customerProfileName}${result.companyName ? ` (${result.companyName})` : ''}${extra > 0 ? ` — mais ${extra} ${extra === 1 ? 'conversa' : 'conversas'} do mesmo número` : ''}.`);
  }, []);
  const columnPickerRef = useRef<HTMLDivElement>(null);
  const columnPanelRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Carrega (ou recarrega) a lista de conversas e o que alimenta os filtros
  // (filas, clientes, equipe). `manual` = veio do botão "Atualizar": mostra o
  // giro, avisa quantas conversas são novas e recarrega também a lista de equipe.
  const loadHistories = useCallback(async (manual: boolean) => {
    if (manual) setIsRefreshing(true);
    try {
      const [data] = await Promise.all([
        getChatHistories(),
        fetchQueues().then(setQueues).catch(() => {}),
        CompanyService.getAll().then(setCompanies).catch(() => {}),
        manual ? refetchUsers().catch(() => {}) : Promise.resolve()
      ]);
      // getChatHistories devolve o corpo do erro ({ error }) quando a sessão
      // expirou ou falta permissão — nunca trocar a lista por isso.
      if (!Array.isArray(data)) {
        if (manual) toast.error((data as any)?.error || 'Não foi possível atualizar o histórico.');
        return;
      }
      const knownIds = new Set(historiesRef.current.map(h => h.id));
      const novas = knownIds.size > 0 ? data.filter(h => !knownIds.has(h.id)).length : 0;
      setHistories(data);
      // Detalhe aberto: acompanha o que mudou (nota de satisfação, resumo...).
      setSelectedHistory((prev: any) => (prev ? (data.find(h => h.id === prev.id) || prev) : prev));
      setLastUpdatedAt(new Date());
      if (manual) {
        toast.success(novas > 0
          ? `${novas} ${novas === 1 ? 'nova conversa' : 'novas conversas'} no histórico.`
          : 'Histórico atualizado. Nenhuma conversa nova.');
      }
    } catch (err) {
      console.error('Error loading chat histories:', err);
      if (manual) toast.error('Não foi possível atualizar o histórico.');
    } finally {
      if (manual) setIsRefreshing(false);
    }
  }, [refetchUsers]);

  useEffect(() => {
    if (!currentUser || !hasPermission(Permission.CHAT_HISTORY_VIEW)) return;
    loadHistories(false);
  }, [currentUser?.id, refreshTrigger]);

  // Deep link vindo de outro relatório (ex.: lista de avaliações negativas
  // do R4) — ?historyId= abre a conversa direto, sem precisar buscar na
  // lista. Só age uma vez por navegação (guarda em selectedHistory === null)
  // pra não reabrir depois que o usuário fechar o painel manualmente.
  useEffect(() => {
    const historyId = searchParams.get('historyId');
    if (!historyId || selectedHistory || histories.length === 0) return;
    const match = histories.find(h => h.id === historyId);
    if (match) setSelectedHistory(match);
  }, [searchParams, histories, selectedHistory]);

  useEffect(() => {
    localStorage.setItem(COLUMN_PREFS_STORAGE_KEY, JSON.stringify({ order: columnOrder, hidden: hiddenColumns }));
  }, [columnOrder, hiddenColumns]);

  useEffect(() => {
    if (!selectedHistory?.sessionId) {
      setSessionMessages(null);
      return;
    }
    let cancelled = false;
    setLoadingSessionMessages(true);
    fetchSessionMessages(selectedHistory.sessionId)
      .then(data => { if (!cancelled) setSessionMessages(data); })
      .catch(err => {
        console.error('Error loading rich session messages for history:', err);
        if (!cancelled) setSessionMessages(null);
      })
      .finally(() => { if (!cancelled) setLoadingSessionMessages(false); });
    return () => { cancelled = true; };
  }, [selectedHistory?.sessionId]);

  // Ao trocar (ou fechar) a conversa selecionada, sempre volta pra "Chat
  // completo" — evita abrir a próxima conversa já em modo resumido sem o
  // usuário ter pedido. Se essa conversa já tinha um resumo salvo (veio do
  // fetch de getChatHistories), pré-popula sem precisar de nova chamada.
  useEffect(() => {
    setHistoryViewMode('full');
    setSummaryError(null);
    setSummaryLoading(false);
    setSummaryData(
      selectedHistory?.summary
        ? { summary: selectedHistory.summary, generatedAt: selectedHistory.summaryGeneratedAt, cached: true }
        : null
    );
  }, [selectedHistory?.id]);

  const loadSummary = useCallback(() => {
    if (!selectedHistory) return;
    setSummaryLoading(true);
    setSummaryError(null);
    summarizeChatHistory(selectedHistory.id)
      .then(result => {
        setSummaryData(result);
        // Atualiza a lista em memória — reabrir essa mesma conversa depois
        // (sem recarregar a página) já mostra o resumo salvo, sem gerar de novo.
        setHistories(prev => prev.map(h => (
          h.id === selectedHistory.id ? { ...h, summary: result.summary, summaryGeneratedAt: result.generatedAt } : h
        )));
      })
      .catch(err => setSummaryError(err?.message || 'Não foi possível gerar o resumo desta conversa.'))
      .finally(() => setSummaryLoading(false));
  }, [selectedHistory]);

  useEffect(() => {
    if (historyViewMode === 'summary' && !summaryData && !summaryLoading && !summaryError) {
      loadSummary();
    }
  }, [historyViewMode, summaryData, summaryLoading, summaryError, loadSummary]);

  const handleRequeueDissatisfaction = useCallback(() => {
    if (!selectedHistory) return;
    setIsRequeuingDissatisfaction(true);
    requeueDissatisfaction(selectedHistory.id)
      .then(() => {
        toast.success('Conversa marcada pra reprocessar — o detector de insatisfação roda em segundo plano em instantes.');
        const patch = { dissatisfactionProcessedAt: null, dissatisfactionDetected: null, dissatisfactionDepartment: null, dissatisfactionCategory: null, dissatisfactionReason: null };
        setHistories(prev => prev.map(h => (h.id === selectedHistory.id ? { ...h, ...patch } : h)));
        setSelectedHistory((prev: any) => (prev ? { ...prev, ...patch } : prev));
      })
      .catch(err => toast.error(err?.message || 'Não foi possível reprocessar esta conversa.'))
      .finally(() => setIsRequeuingDissatisfaction(false));
  }, [selectedHistory]);

  // Transcreve sozinho qualquer áudio dessa conversa que ainda não tenha
  // transcrição (mensagem antiga, ou uma tentativa automática que falhou) —
  // a tela (e um PDF gerado depois) já saem com o texto, sem precisar de
  // clique manual em lugar nenhum.
  useAutoTranscribeMissingAudio(
    selectedHistory?.sessionId,
    sessionMessages?.messages,
    (updater) => setSessionMessages(prev => prev ? { ...prev, messages: updater(prev.messages) } : prev)
  );

  // Ao abrir, traz o painel pra dentro da área visível: no celular o botão fica
  // perto do rodapé e o painel abria por trás da barra de navegação inferior
  // (scroll-mb-24 no painel reserva o espaço dessa barra).
  useEffect(() => {
    if (!isColumnPickerOpen) return;
    const frame = requestAnimationFrame(() => {
      columnPanelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [isColumnPickerOpen]);

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
        h.customerProfileName?.toLowerCase().includes(search.toLowerCase()) ||
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

      let matchesDissatisfaction = true;
      if (dissatisfactionFilter === 'detected') matchesDissatisfaction = h.dissatisfactionDetected === true;
      else if (dissatisfactionFilter === 'not_detected') matchesDissatisfaction = h.dissatisfactionProcessedAt != null && h.dissatisfactionDetected !== true;
      else if (dissatisfactionFilter === 'unprocessed') matchesDissatisfaction = h.dissatisfactionProcessedAt == null;

      const matchesTraining = trainingFilter === 'all'
        || (trainingFilter === 'training' ? h.companyIsInTraining === true : h.companyIsInTraining !== true);
      const matchesTeam = teamFilter === 'all' || h.assigneeId === teamFilter;
      const matchesEmployee = employeeFilter === 'all' || h.customerId === employeeFilter;
      const matchesCompany = companyFilter === 'all' || h.companyId === companyFilter;
      const matchesQueue = queueFilter === 'all' || h.queueId === queueFilter;

      return matchesSearch && matchesDate && matchesRating && matchesDissatisfaction && matchesTraining && matchesTeam && matchesEmployee && matchesCompany && matchesQueue;
    });
  }, [histories, search, dateFrom, dateTo, ratingFilter, dissatisfactionFilter, trainingFilter, teamFilter, employeeFilter, companyFilter, queueFilter]);

  const handleDownloadTxt = (h: any) => {
    downloadBlob(`${historyFileBaseName(h)}.txt`, new Blob([buildTxtContent(h)], { type: 'text/plain;charset=utf-8' }));
  };

  const handleDownloadPdf = async (h: any) => {
    try {
      // Reaproveita as mensagens já buscadas pro modal (ver useEffect de
      // sessionMessages); se o histórico não tiver sessionId ou a busca
      // ainda não tiver terminado, busca na hora antes de gerar o PDF.
      let messages = sessionMessages?.messages;
      if (!messages && h.sessionId) {
        try {
          messages = (await fetchSessionMessages(h.sessionId)).messages;
        } catch {
          messages = undefined;
        }
      }
      const blob = await buildHistoryPdfBlob(h, messages);
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
      case 'resumoProcessado':
        return (
          <td key="resumoProcessado" className="px-5 py-4 text-[10px] font-semibold uppercase tracking-widest whitespace-nowrap">
            {h.summary
              ? <span className="text-[var(--text-success)]">Sim</span>
              : <span className="text-[var(--text-tertiary)]">Não</span>}
          </td>
        );
      case 'insatisfacao':
        return (
          <td key="insatisfacao" className="px-5 py-4 whitespace-nowrap">
            {h.dissatisfactionProcessedAt == null ? (
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">Não processado</span>
            ) : h.dissatisfactionDetected ? (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-danger)]"
                title={h.dissatisfactionCategory ? `${h.dissatisfactionDepartment} · ${h.dissatisfactionCategory}` : undefined}
              >
                <ThumbsDown size={12} /> Sim
              </span>
            ) : (
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-success)]">Não</span>
            )}
          </td>
        );
      case 'cliente':
        return (
          <td key="cliente" className="px-5 py-4 text-sm font-bold text-[var(--text-primary)] max-w-[220px]">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="truncate" title={h.companyName || undefined}>{h.companyName || (h.customerId ? '-' :<span className="text-[var(--text-tertiary)] font-medium italic">Sem vínculo</span>)}</span>
              {h.companyIsInTraining && (
                <span
                  title="Cliente em treinamento"
                  className="inline-flex items-center gap-1 shrink-0 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-[var(--surface-info)] text-[var(--text-info)]"
                >
                  <GraduationCap size={10} /> Treinamento
                </span>
              )}
            </div>
          </td>
        );
      case 'funcionario':
        return <td key="funcionario" className="px-5 py-4 text-xs font-bold text-[var(--text-secondary)] truncate max-w-[160px]">{h.customerProfileName || h.customerName || '-'}</td>;
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

  if (!currentUser || !hasPermission(Permission.CHAT_HISTORY_VIEW)) {
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
        <div className="flex flex-wrap items-center gap-3">
        {lastUpdatedAt && (
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">
            Atualizado às {lastUpdatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        <button
          onClick={() => loadHistories(true)}
          disabled={isRefreshing}
          title="Recarrega as conversas, os filtros (clientes, equipe, filas) e o que estiver aberto"
          className="flex items-center gap-2 px-5 py-3 bg-[var(--surface-card)] border-2 border-[var(--border-default)] text-[var(--text-primary)] rounded-2xl text-[11px] font-semibold uppercase tracking-widest hover:border-[var(--accent)]/40 hover:bg-[var(--surface-pill)] transition-all disabled:opacity-60"
        >
          <RefreshCw size={16} className={cn(isRefreshing && 'animate-spin')} /> {isRefreshing ? 'Atualizando...' : 'Atualizar'}
        </button>
        <button
          onClick={handleBulkDownloadZip}
          disabled={isBulkDownloading || filteredHistories.length === 0}
          className="flex items-center gap-2 px-5 py-3 bg-slate-900 text-white rounded-2xl text-[11px] font-semibold uppercase tracking-widest hover:bg-slate-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          <Archive size={16} /> {isBulkDownloading ? 'Gerando .zip...' : `Baixar Filtradas (${filteredHistories.length})`}
        </button>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={18} />
            <input
              type="text"
              placeholder="Buscar por cliente, funcionário, equipe, nº do chat ou conteúdo..."
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
              {teamMembers.map(u => (
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

            <div className="flex items-center gap-2">
              <Filter size={16} className="text-[var(--text-tertiary)]" />
              {[
                { value: 'all', label: 'Todos' },
                { value: 'detected', label: 'Insatisfeitos' },
                { value: 'not_detected', label: 'Sem insatisfação' },
                { value: 'unprocessed', label: 'Não processado' }
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setDissatisfactionFilter(opt.value as any)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-widest transition-all",
                    dissatisfactionFilter === opt.value ? "bg-[var(--text-danger)] text-white" : "bg-[var(--surface-pill)] text-[var(--text-secondary)] hover:bg-[var(--border-default)]"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2" title="Situação atual da empresa do cliente">
              <GraduationCap size={16} className="text-[var(--text-tertiary)]" />
              {[
                { value: 'all', label: 'Todos' },
                { value: 'training', label: 'Em treinamento' },
                { value: 'not_training', label: 'Fora de treinamento' }
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setTrainingFilter(opt.value as any)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-widest transition-all",
                    trainingFilter === opt.value ? "bg-[var(--text-info)] text-white" : "bg-[var(--surface-pill)] text-[var(--text-secondary)] hover:bg-[var(--border-default)]"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative" ref={columnPickerRef}>
            <button
              onClick={() => {
                const wrapper = columnPickerRef.current;
                if (wrapper && !isColumnPickerOpen) {
                  const PANEL_WIDTH = 224; // w-56
                  const button = wrapper.getBoundingClientRect();
                  const content = (wrapper.closest('main') as HTMLElement | null)?.getBoundingClientRect();
                  const contentLeft = content?.left ?? 0;
                  setColumnPickerAlign(button.right - PANEL_WIDTH < contentLeft + 4 ? 'left' : 'right');
                }
                setIsColumnPickerOpen(o => !o);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all"
            >
              <Columns3 size={14} /> Colunas
            </button>
            {isColumnPickerOpen && (
              <div ref={columnPanelRef} className={cn(
                "absolute mt-2 w-56 max-w-[calc(100vw-2rem)] scroll-mb-24 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-xl p-3 z-20 space-y-0.5",
                columnPickerAlign === 'left' ? "left-0" : "right-0"
              )}>
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
                  <h3 className="text-xl font-black text-[var(--text-primary)] tracking-tight uppercase">{selectedHistory.customerProfileName || selectedHistory.customerName || 'Contato'}</h3>
                  <p className="text-[10px] text-[var(--text-tertiary)] font-semibold uppercase tracking-widest mt-1">
                    Chat {ticketLabel(selectedHistory)} · {selectedHistory.companyName || 'Sem empresa'}{selectedHistory.companyIsInTraining ? ' (em treinamento)' : ''} · Equipe: {selectedHistory.assigneeName || 'Sem responsável'}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest">
                    <span className="flex items-center gap-1"><Clock size={11} /> Início: {formatDateTime(selectedHistory.startedAt)}</span>
                    <span className="flex items-center gap-1"><Clock size={11} /> Fim: {formatDateTime(selectedHistory.finishedAt)}</span>
                    <span className="flex items-center gap-1"><MessageSquare size={11} /> 1ª resposta: {formatDuration(selectedHistory.firstResponseSeconds)}</span>
                  </div>
                  {(hasPermission(Permission.CHAT_HISTORY_LINK_CONTACT) || hasPermission(Permission.OUTSIDE_QUEUE_VIEW)) && (
                    <div className="flex flex-wrap items-center gap-2 mt-4">
                      {hasPermission(Permission.CHAT_HISTORY_LINK_CONTACT) && (
                        <button
                          onClick={() => setIsLinkModalOpen(true)}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--surface-card)] border-2 border-[var(--border-default)] text-[var(--text-primary)] rounded-xl text-[10px] font-semibold uppercase tracking-widest hover:border-[var(--accent)]/40 hover:bg-[var(--surface-pill)] transition-all"
                        >
                          <Link2 size={13} /> {selectedHistory.customerId ? 'Alterar vínculo' : 'Vincular contato'}
                        </button>
                      )}
                      {hasPermission(Permission.OUTSIDE_QUEUE_VIEW) && (
                        <button
                          onClick={handleOpenStartConversation}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--surface-card)] border-2 border-[var(--border-default)] text-[var(--text-primary)] rounded-xl text-[10px] font-semibold uppercase tracking-widest hover:border-[var(--accent)]/40 hover:bg-[var(--surface-pill)] transition-all"
                        >
                          <MessageCircle size={13} /> Iniciar conversa
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <button onClick={() => setSelectedHistory(null)} className="p-2 text-[var(--text-tertiary)] hover:text-[var(--text-danger)] hover:bg-[var(--surface-danger)] rounded-xl transition-all shrink-0">
                  <X size={20} />
                </button>
              </div>

              <div className="px-8 pt-5 shrink-0">
                <div className="inline-flex items-center bg-[var(--surface-pill)] rounded-xl p-1">
                  <button
                    onClick={() => setHistoryViewMode('full')}
                    className={cn(
                      "px-4 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-widest transition-all",
                      historyViewMode === 'full' ? "bg-[var(--surface-card)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                    )}
                  >
                    Chat completo
                  </button>
                  <button
                    onClick={() => setHistoryViewMode('summary')}
                    className={cn(
                      "flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-widest transition-all",
                      historyViewMode === 'summary' ? "bg-[var(--surface-card)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                    )}
                  >
                    <Sparkles size={12} /> Chat Resumido
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-8 bg-[var(--surface-card)]/30">
                {historyViewMode === 'summary' ? (
                  summaryLoading ? (
                    <p className="text-xs text-[var(--text-tertiary)] font-medium flex items-center gap-2">
                      <Sparkles size={14} className="animate-pulse text-[var(--accent-text)]" /> Gerando resumo com IA...
                    </p>
                  ) : summaryError ? (
                    <div className="space-y-3">
                      <p className="text-xs text-[var(--text-danger)] font-semibold leading-relaxed">{summaryError}</p>
                      <button
                        onClick={loadSummary}
                        className="flex items-center gap-2 px-4 py-2 bg-[var(--surface-card)] border-2 border-[var(--border-default)] rounded-xl text-[10px] font-semibold uppercase tracking-widest hover:border-[var(--accent)]/40 transition-all"
                      >
                        <RotateCcw size={12} /> Tentar novamente
                      </button>
                    </div>
                  ) : summaryData ? (
                    <div className="space-y-3">
                      <p className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">{summaryData.summary}</p>
                      <p className="text-[10px] text-[var(--text-tertiary)] font-semibold uppercase tracking-widest">
                        Resumo por IA{summaryData.generatedAt ? ` · gerado em ${formatDateTime(summaryData.generatedAt)}` : ''}
                      </p>

                      {selectedHistory.dissatisfactionDetected && (
                        <div className="p-4 rounded-2xl border border-[var(--text-danger)]/30 bg-[var(--surface-danger)]/40 space-y-1">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-danger)] flex items-center gap-1.5">
                            <ThumbsDown size={12} /> Insatisfação identificada
                          </p>
                          <p className="text-xs font-bold text-[var(--text-primary)]">
                            {selectedHistory.dissatisfactionDepartment || 'Departamento não classificado'}
                            {selectedHistory.dissatisfactionCategory ? ` · ${selectedHistory.dissatisfactionCategory}` : ''}
                          </p>
                          {selectedHistory.dissatisfactionReason && (
                            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">&ldquo;{selectedHistory.dissatisfactionReason}&rdquo;</p>
                          )}
                        </div>
                      )}

                      <button
                        onClick={handleRequeueDissatisfaction}
                        disabled={isRequeuingDissatisfaction}
                        className="flex items-center gap-2 px-4 py-2 bg-[var(--surface-card)] border-2 border-[var(--border-default)] rounded-xl text-[10px] font-semibold uppercase tracking-widest hover:border-[var(--accent)]/40 transition-all disabled:opacity-60"
                      >
                        <RotateCcw size={12} className={isRequeuingDissatisfaction ? 'animate-spin' : ''} />
                        {selectedHistory.dissatisfactionProcessedAt == null ? 'Detector de insatisfação: não processado ainda' : 'Reprocessar detector de insatisfação'}
                      </button>
                    </div>
                  ) : null
                ) : loadingSessionMessages ? (
                  <p className="text-xs text-[var(--text-tertiary)] font-medium">Carregando conversa...</p>
                ) : sessionMessages && sessionMessages.messages.length > 0 ? (
                  <RichHistoryMessages messages={sessionMessages.messages} customerName={selectedHistory.customerName} />
                ) : (
                  <TranscriptView transcript={selectedHistory.transcript} customerName={selectedHistory.customerName} />
                )}
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

      {selectedHistory && (
        <LinkContactModal
          isOpen={isLinkModalOpen}
          onClose={() => setIsLinkModalOpen(false)}
          session={{
            id: selectedHistory.sessionId,
            customerId: selectedHistory.customerId || '',
            customerName: selectedHistory.customerName || '',
            customerPhone: selectedHistory.customerPhone || undefined,
            queueId: selectedHistory.queueId || undefined,
            status: 'closed',
            messages: [],
            startedAt: selectedHistory.startedAt,
            lastMessageAt: selectedHistory.finishedAt
          }}
          historyId={selectedHistory.id}
          otherUnlinkedCount={otherUnlinkedSamePhone.length}
          onSuccess={() => {}}
          onHistoryLinked={handleHistoryLinked}
        />
      )}

      {selectedHistory && (
        <StartWhatsAppConversationModal
          isOpen={isStartModalOpen}
          onClose={() => setIsStartModalOpen(false)}
          defaultPhone={startPhone}
          defaultName={selectedHistory.customerProfileName || selectedHistory.customerName || ''}
          onSuccess={(sessionId) => {
            // Abre a conversa no chat flutuante (mesmo caminho do "Iniciar
            // conversa" de Empresas) e fecha o detalhe do histórico pra ela
            // não ficar atrás do painel.
            setActiveOmniChatId(sessionId);
            setIsOmniChatOpen(true);
            setSelectedHistory(null);
          }}
        />
      )}
    </div>
  );
}
