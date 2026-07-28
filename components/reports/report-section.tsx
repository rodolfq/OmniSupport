'use client';

import React from 'react';
import { Loader2, AlertTriangle, Inbox, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SectionExportButton, ReportExportConfig } from './export-menu';

// Bloco padrão de relatório (R1 em diante): título + slot de ação (export)
// + os 3 estados que a Etapa 3 não tinha tratado explicitamente (loading/
// vazio/erro). Generaliza o SectionCard que nasceu local em
// dashboard/management/page.tsx.
//
// Export (Etapa 9): passar `exportConfig` (+ reportId/reportLabel/
// filterSummary) liga o botão de verdade (SectionExportButton). Sem esses
// props, cai no botão desabilitado de sempre — R2-R5 ainda não passam
// (Etapa 9 ficou restrita a R1 + Dashboard Gerencial), sem quebrar nada.

export type ReportSectionStatus = 'loading' | 'empty' | 'error' | 'ready';

interface ReportSectionProps {
  title: string;
  subtitle?: string;
  status: ReportSectionStatus;
  emptyMessage?: string;
  errorMessage?: string;
  onRetry?: () => void;
  children: React.ReactNode;
  exportConfig?: ReportExportConfig<any> | null;
  reportId?: string;
  reportLabel?: string;
  filterSummary?: string;
}

export function ReportSection({ title, subtitle, status, emptyMessage, errorMessage, onRetry, children, exportConfig, reportId, reportLabel, filterSummary }: ReportSectionProps) {
  return (
    <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-sm p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-[var(--text-primary)] tracking-tight uppercase">{title}</h2>
          {subtitle && <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">{subtitle}</p>}
        </div>
        {reportId && reportLabel ? (
          <SectionExportButton config={exportConfig ?? null} reportId={reportId} reportLabel={reportLabel} filterSummary={filterSummary ?? ''} />
        ) : (
          <DisabledExportButton />
        )}
      </div>

      {status === 'loading' && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--text-tertiary)]">
          <Loader2 size={16} className="animate-spin" /> Carregando...
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <AlertTriangle size={24} className="text-[var(--text-danger)]" />
          <p className="text-sm text-[var(--text-danger)]">{errorMessage || 'Não foi possível carregar estes dados.'}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-1 text-[10px] font-bold uppercase tracking-widest text-[var(--accent-text)] hover:underline"
            >
              Tentar de novo
            </button>
          )}
        </div>
      )}

      {status === 'empty' && (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <Inbox size={24} className="text-[var(--text-tertiary)]" />
          <p className="text-sm text-[var(--text-tertiary)]">{emptyMessage || 'Sem dados no período selecionado.'}</p>
        </div>
      )}

      {status === 'ready' && children}
    </div>
  );
}

// Fallback pra quem ainda não passa reportId/reportLabel (R2-R5) — vira
// SectionExportButton assim que a página passar esses props, sem mudar
// mais nada na tela.
function DisabledExportButton() {
  return (
    <button
      disabled
      title="Exportar — em breve"
      className={cn(
        "inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest",
        "border border-[var(--border-default)] text-[var(--text-tertiary)] opacity-50 cursor-not-allowed"
      )}
    >
      Exportar <ArrowRight size={12} />
    </button>
  );
}
