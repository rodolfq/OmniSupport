'use client';

import React, { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { Permission } from '@/lib/types';

// Etapa 9 do roadmap "Time x Gerencial" — componente único de exportação,
// reutilizado por toda seção de relatório e pelo Dashboard Gerencial.
// Substitui o DisabledExportButton que ReportSection carregava desde o R1.
//
// Um único modelo de dado alimenta os dois formatos: `rows` é sempre valor
// BRUTO (número puro, ISO date) — CSV serializa cru ("dado bruto agregado",
// pra continuar a conta no Excel); PDF aplica `column.format` (a versão
// "bonita" pra reunião). Ver plano da Etapa 9.

export interface ReportExportColumn<T> {
  key: keyof T;
  label: string;
  format?: (value: T[keyof T], row: T) => string; // só usado no PDF
}

export interface ReportExportConfig<T = any> {
  title: string;
  columns: ReportExportColumn<T>[];
  rows: T[];
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function buildCsv<T>(config: ReportExportConfig<T>): string {
  const header = config.columns.map(c => csvCell(c.label)).join(',');
  const lines = config.rows.map(row => config.columns.map(c => csvCell(row[c.key])).join(','));
  // BOM UTF-8 na frente — sem isso o Excel abre acento quebrado.
  return '﻿' + [header, ...lines].join('\r\n');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Fire-and-forget — nunca bloqueia nem falha o download por causa do log,
// mesma filosofia de lib/audit-log.ts (uma falha aqui não pode atrapalhar
// a ação principal).
function logExport(reportId: string, reportLabel: string, format: 'csv' | 'pdf', filterSummary: string) {
  fetch('/api/reports/export-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reportId, reportLabel, format, filter: filterSummary })
  }).catch(() => {});
}

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

interface SectionExportButtonProps<T> {
  config: ReportExportConfig<T> | null; // null enquanto a seção ainda carrega
  reportId: string;
  reportLabel: string;
  filterSummary: string;
}

export function SectionExportButton<T>({ config, reportId, reportLabel, filterSummary }: SectionExportButtonProps<T>) {
  const { hasPermission } = useApp();
  const allowed = hasPermission(Permission.REPORTS_EXPORT);

  if (!allowed) {
    return (
      <button
        disabled
        title="Sem permissão para exportar"
        className={cn(
          "inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest",
          "border border-[var(--border-default)] text-[var(--text-tertiary)] opacity-50 cursor-not-allowed"
        )}
      >
        Exportar <ArrowRight size={12} />
      </button>
    );
  }

  const handleExport = () => {
    if (!config || config.rows.length === 0) return;
    const csv = buildCsv(config);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${slugify(reportId)}_${slugify(config.title)}.csv`);
    logExport(reportId, reportLabel, 'csv', filterSummary);
  };

  return (
    <button
      onClick={handleExport}
      disabled={!config || config.rows.length === 0}
      title="Exportar CSV"
      className={cn(
        "inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors",
        "border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--accent)]/40 hover:text-[var(--accent-text)]",
        (!config || config.rows.length === 0) && "opacity-50 cursor-not-allowed"
      )}
    >
      Exportar <ArrowRight size={12} />
    </button>
  );
}

interface PageExportPdfButtonProps {
  sections: ReportExportConfig<any>[];
  reportId: string;
  reportLabel: string;
  filterSummary: string;
}

// Um por página (não por seção) — monta 1 PDF com cabeçalho (relatório,
// período/filtros, data/hora de geração) e uma tabela por seção. Mesmo
// estilo já usado em app/(portal)/chat-history/page.tsx
// (buildHistoryPdfBlob): A4/pt, marginX=40, helvetica, paginação via
// ensureSpace — sem depender de plugin autotable, que não é dependência do
// projeto.
export function PageExportPdfButton({ sections, reportId, reportLabel, filterSummary }: PageExportPdfButtonProps) {
  const { hasPermission } = useApp();
  const allowed = hasPermission(Permission.REPORTS_EXPORT);
  const [generating, setGenerating] = useState(false);

  if (!allowed) return null;

  const handleExport = async () => {
    const ready = sections.filter(s => s.rows.length > 0);
    if (ready.length === 0) return;
    setGenerating(true);
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const marginX = 40;
      const pageHeight = doc.internal.pageSize.getHeight();
      const pageWidth = doc.internal.pageSize.getWidth();
      let y = 50;

      const ensureSpace = (lines: number, lineHeight = 13) => {
        if (y + lines * lineHeight > pageHeight - 40) {
          doc.addPage();
          y = 50;
        }
      };

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(reportLabel, marginX, y);
      y += 22;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(90);
      doc.text(filterSummary || 'Sem filtros aplicados', marginX, y);
      y += 14;
      doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, marginX, y);
      y += 20;
      doc.setDrawColor(210);
      doc.line(marginX, y, pageWidth - marginX, y);
      y += 24;

      for (const section of ready) {
        ensureSpace(2);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(20);
        doc.text(section.title, marginX, y);
        y += 16;

        const colWidth = (pageWidth - marginX * 2) / section.columns.length;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(100);
        section.columns.forEach((col, i) => doc.text(col.label, marginX + i * colWidth, y, { maxWidth: colWidth - 4 }));
        y += 12;
        doc.setDrawColor(225);
        doc.line(marginX, y, pageWidth - marginX, y);
        y += 10;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(40);
        for (const row of section.rows) {
          ensureSpace(1);
          section.columns.forEach((col, i) => {
            const raw = row[col.key];
            const text = col.format ? col.format(raw, row) : (raw === null || raw === undefined ? '—' : String(raw));
            doc.text(text, marginX + i * colWidth, y, { maxWidth: colWidth - 4 });
          });
          y += 13;
        }
        y += 16;
      }

      doc.save(`${slugify(reportId)}.pdf`);
      logExport(reportId, reportLabel, 'pdf', filterSummary);
    } finally {
      setGenerating(false);
    }
  };

  const hasData = sections.some(s => s.rows.length > 0);

  return (
    <button
      onClick={handleExport}
      disabled={!hasData || generating}
      title="Exportar PDF — layout de reunião"
      className={cn(
        "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-colors",
        "border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--accent)]/40 hover:text-[var(--accent-text)]",
        (!hasData || generating) && "opacity-50 cursor-not-allowed"
      )}
    >
      {generating ? <Loader2 size={13} className="animate-spin" /> : null}
      Exportar PDF
    </button>
  );
}
