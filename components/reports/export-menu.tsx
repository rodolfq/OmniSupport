'use client';

import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { Permission } from '@/lib/types';
import {
  type ReportExportColumn,
  type ReportExportConfig,
  buildCsv,
  buildXlsx,
  buildPdf,
  downloadBlob,
  slugify,
} from '@/lib/export/table-export';

// Etapa 9 do roadmap "Time x Gerencial" — componente único de exportação,
// reutilizado por toda seção de relatório e pelo Dashboard Gerencial.
// Substitui o DisabledExportButton que ReportSection carregava desde o R1.
//
// Um único modelo de dado alimenta os dois formatos: `rows` é sempre valor
// BRUTO (número puro, ISO date) — CSV serializa cru ("dado bruto agregado",
// pra continuar a conta no Excel); PDF aplica `column.format` (a versão
// "bonita" pra reunião). Ver plano da Etapa 9.
//
// A geração de CSV/XLSX/PDF em si foi extraída para lib/export/table-export.ts
// (2026-11-18), pra o botão "Exportar" dos chamados (components/ticket-export-button.tsx)
// reaproveitar sem herdar a permissão reports:export/log abaixo, que é
// específica de Relatórios.

export type { ReportExportColumn, ReportExportConfig };

// Fire-and-forget — nunca bloqueia nem falha o download por causa do log,
// mesma filosofia de lib/audit-log.ts (uma falha aqui não pode atrapalhar
// a ação principal).
function logExport(reportId: string, reportLabel: string, format: 'csv' | 'pdf' | 'xls', filterSummary: string) {
  fetch('/api/reports/export-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reportId, reportLabel, format, filter: filterSummary })
  }).catch(() => {});
}

export type ExportFormat = 'pdf' | 'xls' | 'csv';

const FORMAT_LABEL: Record<ExportFormat, string> = { pdf: 'PDF', xls: 'XLS', csv: 'CSV' };
const FORMAT_HINT: Record<ExportFormat, string> = {
  pdf: 'PDF — layout de reunião',
  xls: 'XLS — planilha Excel, uma aba por seção',
  csv: 'CSV — dado bruto, para continuar a conta',
};

interface ExportAsMenuProps {
  sections: ReportExportConfig<any>[]; // uma seção (botão da tabela) ou a página inteira
  formats: ExportFormat[];
  reportId: string;
  reportLabel: string;
  filterSummary: string;
  fileBase?: string; // nome do arquivo sem extensão
}

// "Exportar como:" + um botão por formato. CSV só faz sentido para uma seção (um arquivo por tabela).
export function ExportAsMenu({ sections, formats, reportId, reportLabel, filterSummary, fileBase }: ExportAsMenuProps) {
  const { hasPermission } = useApp();
  const allowed = hasPermission(Permission.REPORTS_EXPORT);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const hasData = sections.some(s => s.rows.length > 0);
  const base = fileBase ?? slugify(reportId);

  const run = async (format: ExportFormat) => {
    if (!hasData) return;
    setBusy(format);
    try {
      if (format === 'csv') {
        const section = sections[0];
        downloadBlob(new Blob([buildCsv(section)], { type: 'text/csv;charset=utf-8' }), `${base}.csv`);
      } else if (format === 'xls') {
        downloadBlob(await buildXlsx(sections), `${base}.xlsx`);
      } else {
        const doc = await buildPdf(sections, reportLabel, filterSummary);
        if (!doc) return;
        doc.save(`${base}.pdf`);
      }
      logExport(reportId, reportLabel, format, filterSummary);
    } finally {
      setBusy(null);
    }
  };

  const label = <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Exportar como:</span>;

  if (!allowed) {
    return (
      <div className="inline-flex items-center gap-1.5">
        {label}
        {formats.map(f => (
          <button key={f} disabled title="Sem permissão para exportar"
            className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border border-[var(--border-default)] text-[var(--text-tertiary)] opacity-50 cursor-not-allowed">
            {FORMAT_LABEL[f]}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="inline-flex flex-wrap items-center gap-1.5" role="group" aria-label="Exportar como">
      {label}
      {formats.map(f => {
        const disabled = !hasData || busy !== null;
        return (
          <button key={f} type="button" onClick={() => run(f)} disabled={disabled} title={FORMAT_HINT[f]}
            className={cn(
              "inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors",
              "border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--accent)]/40 hover:text-[var(--accent-text)]",
              disabled && "opacity-50 cursor-not-allowed"
            )}>
            {busy === f ? <Loader2 size={12} className="animate-spin" /> : null}
            {FORMAT_LABEL[f]}
          </button>
        );
      })}
    </div>
  );
}

interface SectionExportButtonProps<T> {
  config: ReportExportConfig<T> | null; // null enquanto a seção ainda carrega
  reportId: string;
  reportLabel: string;
  filterSummary: string;
}

// Exportação de uma seção: CSV, XLS e PDF.
export function SectionExportButton<T>({ config, reportId, reportLabel, filterSummary }: SectionExportButtonProps<T>) {
  return (
    <ExportAsMenu
      sections={config ? [config as ReportExportConfig<any>] : []}
      formats={['pdf', 'xls', 'csv']}
      reportId={reportId}
      reportLabel={reportLabel}
      filterSummary={filterSummary}
      fileBase={config ? `${slugify(reportId)}_${slugify(config.title)}` : undefined}
    />
  );
}

interface PageExportPdfButtonProps {
  sections: ReportExportConfig<any>[];
  reportId: string;
  reportLabel: string;
  filterSummary: string;
}

// Exportação da página inteira: PDF e XLS (uma aba por seção). CSV fica por seção.
export function PageExportPdfButton({ sections, reportId, reportLabel, filterSummary }: PageExportPdfButtonProps) {
  return (
    <ExportAsMenu
      sections={sections}
      formats={['pdf', 'xls']}
      reportId={reportId}
      reportLabel={reportLabel}
      filterSummary={filterSummary}
    />
  );
}
