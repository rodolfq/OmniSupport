'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Download, FileText, FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useEscapeToClose } from '@/hooks/use-escape-to-close';
import { cn } from '@/lib/utils';
import {
  type ReportExportColumn,
  type ReportExportConfig,
  buildXlsx,
  buildPdf,
  downloadBlob,
  slugify,
} from '@/lib/export/table-export';

// Botão "Exportar" (PDF/XLS) para as listas de chamados — pedido do usuário
// (2026-11-18): nenhuma das telas de chamado tinha exportação. Reaproveita a
// MESMA geração de PDF/XLSX do módulo de Relatórios (lib/export/table-export.ts,
// extraído de components/reports/export-menu.tsx), mas sem a permissão
// reports:export daquele componente — exportar os chamados que a própria
// tela já mostra não é mais sensível do que ver a lista, então não cria
// permissão nova (checklist da seção 16 do CLAUDE.md: "função já coberta por
// uma permissão existente do mesmo domínio" — aqui, a própria visibilidade
// da lista). Sem CSV de propósito: o pedido foi só "PDF / XLS".
//
// `getRows` é lido só no clique, não a cada render — em "Todos os Chamados"
// isso dispara uma busca própria (até o teto de 500 do servidor, mesmo
// limite já usado pelo Kanban) com os filtros atuais, independente do que
// está paginado na tela; em "Meus Chamados"/"Tickets Internos" a lista
// filtrada já inteira está em memória, então é só devolver o array.

export type TicketExportFormat = 'pdf' | 'xls';

// Deliberadamente SEM genérico de tipo: cada tela monta linhas já formatadas
// em texto (ver comentário no topo), com formatos de coluna diferentes entre
// si (Chamados, Meus Chamados, Tickets Internos) — e todas escolhem entre
// seu próprio `getRows`/`columns` por um `ticketMode`/condição na MESMA
// expressão (ternário), o que travaria a inferência de um T único. Como o
// dado exportado aqui é sempre texto de exibição (nunca precisa recalcular
// no Excel), `Record<string, any>` é suficiente.
type ExportRow = Record<string, any>;

interface TicketExportButtonProps {
  getRows: () => ExportRow[] | Promise<ExportRow[]>;
  columns: ReportExportColumn<ExportRow>[];
  /** Título exibido no PDF e usado como nome da aba do XLSX, ex. "Chamados". */
  title: string;
  /** Texto do filtro ativo, mostrado no cabeçalho do PDF (ex. "Status: Novo · Busca: "servidor""). */
  filterSummary: string;
  /** Nome do arquivo sem extensão. */
  fileBase: string;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}

const MENU_WIDTH = 176;

export function TicketExportButton({
  getRows,
  columns,
  title,
  filterSummary,
  fileBase,
  disabled,
  disabledReason,
  className,
}: TicketExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState<TicketExportFormat | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEscapeToClose(open, () => setOpen(false));
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        top: rect.bottom + 6,
        left: Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8),
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  const run = async (format: TicketExportFormat) => {
    setOpen(false);
    setBusy(format);
    try {
      const rows = await getRows();
      if (!rows || rows.length === 0) {
        toast.info('Nenhum chamado para exportar com os filtros atuais.');
        return;
      }
      const section: ReportExportConfig<ExportRow> = { title, columns, rows };
      if (format === 'xls') {
        downloadBlob(await buildXlsx([section]), `${fileBase}.xlsx`);
      } else {
        const doc = await buildPdf([section], title, filterSummary);
        if (!doc) {
          toast.info('Nenhum chamado para exportar com os filtros atuais.');
          return;
        }
        doc.save(`${fileBase}.pdf`);
      }
    } catch (err: any) {
      console.error('Erro ao exportar chamados:', err);
      toast.error(err?.message || 'Erro ao gerar o arquivo de exportação.');
    } finally {
      setBusy(null);
    }
  };

  const isDisabled = !!disabled || busy !== null;

  return (
    <div ref={containerRef} className={cn('relative inline-block', className)}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={isDisabled}
        title={disabled ? disabledReason : 'Exportar os chamados filtrados'}
        className={cn(
          'flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-[10px] font-semibold uppercase tracking-widest transition-all',
          'border border-[var(--border-default)] text-[var(--text-secondary)] bg-[var(--surface-card)]',
          'hover:border-[var(--accent)]/40 hover:text-[var(--accent-text)]',
          isDisabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        Exportar
      </button>

      {mounted && createPortal(
        <AnimatePresence>
          {open && (
            <>
              <div className="fixed inset-0" style={{ zIndex: 2147483000 }} onMouseDown={() => setOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                className="fixed w-44 flex flex-col bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-2xl overflow-hidden"
                style={{ top: position.top, left: position.left, zIndex: 2147483001 }}
              >
                <p className="px-4 py-2 text-[9px] font-semibold text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
                  Exportar como
                </p>
                <button
                  type="button"
                  onClick={() => run('pdf')}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--accent)]/10 transition-all text-left"
                >
                  <FileText size={14} className="text-[var(--accent-text)] shrink-0" /> PDF
                </button>
                <button
                  type="button"
                  onClick={() => run('xls')}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--accent)]/10 transition-all text-left"
                >
                  <FileSpreadsheet size={14} className="text-[var(--accent-text)] shrink-0" /> XLS
                </button>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

export type { ReportExportColumn };
export { slugify };
