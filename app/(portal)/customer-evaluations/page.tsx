'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ClipboardList, Star, AlertTriangle, Search, Lock, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { Permission, MIN_RELIABLE_EVALUATION_COUNT } from '@/lib/types';
import { StyledSelect } from '@/components/styled-select';

interface CustomerEvaluationRow {
  id: string;
  companyName: string;
  analystName: string;
  contactName: string | null;
  origin: 'chat_close' | 'manual';
  createdAt: string;
  knowledgeScore: number | null;
  autonomyScore: number | null;
  learningScore: number | null;
  engagementScore: number | null;
  organizationScore: number | null;
  communicationScore: number | null;
  profileTag: 'technical' | 'beginner' | 'challenging' | null;
}

interface CustomerEvaluationsReport {
  count: number;
  averages: Record<string, number | null>;
  overallAverage: number;
  tagDistribution: { technical: number; beginner: number; challenging: number };
  countByOrigin: { chatClose: number; manual: number };
  evaluations: CustomerEvaluationRow[];
}

const ORIGIN_LABELS: Record<'chat_close' | 'manual', string> = {
  chat_close: 'Atendimento',
  manual: 'Manual'
};

const TAG_LABELS: Record<'technical' | 'beginner' | 'challenging', string> = {
  technical: '👨‍💻 Técnico',
  beginner: '🙋‍♂️ Pouco Conhecimento',
  challenging: '😤 Desafiador'
};

const PAGE_SIZE = 15;

// Mesma regra usada no resumo do cadastro da empresa e no relatório: critério
// em branco (null) não entra na média dessa avaliação específica.
function evaluationAverage(e: CustomerEvaluationRow): number | null {
  const rated = [e.knowledgeScore, e.autonomyScore, e.learningScore, e.engagementScore, e.organizationScore, e.communicationScore]
    .filter((v): v is number => v !== null);
  return rated.length > 0 ? rated.reduce((a, b) => a + b, 0) / rated.length : null;
}

export default function CustomerEvaluationsPage() {
  const { hasPermission } = useApp();
  const [report, setReport] = useState<CustomerEvaluationsReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [originFilter, setOriginFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/reports/customer-evaluations', { signal: controller.signal })
      .then(res => res.json())
      .then(data => setReport(data))
      .catch(() => {})
      .finally(() => setIsLoading(false));
    return () => controller.abort();
  }, []);

  const filtered = useMemo(() => {
    if (!report) return [];
    const q = search.trim().toLowerCase();
    return report.evaluations.filter(e => {
      if (originFilter && e.origin !== originFilter) return false;
      if (tagFilter && e.profileTag !== tagFilter) return false;
      if (q && !(
        e.companyName.toLowerCase().includes(q) ||
        e.analystName.toLowerCase().includes(q) ||
        (e.contactName || '').toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [report, search, originFilter, tagFilter]);

  useEffect(() => { setPage(1); }, [search, originFilter, tagFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (!hasPermission(Permission.REPORTS_READ)) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8 bg-[var(--surface-card)] rounded-2xl shadow-lg border border-[var(--border-default)]">
          <Lock size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-xl font-bold text-[var(--text-secondary)] mb-2">Acesso Negado</h2>
          <p className="text-[var(--text-tertiary)]">Você não tem permissão para visualizar avaliações de clientes.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <Link href="/reports" className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--text-tertiary)] hover:text-[var(--accent-text)] transition-colors mb-3">
          <ArrowLeft size={14} /> Relatórios
        </Link>
        <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tight">Avaliações de Clientes</h1>
        <p className="text-sm text-[var(--text-tertiary)] font-medium mt-1">Histórico completo das avaliações internas feitas pelos analistas — nunca visível ao cliente.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <MetricCard label="Avaliações" value={String(report?.count ?? 0)} icon={<ClipboardList className="text-[var(--accent-text)]" />} />
        <MetricCard label="Média Geral" value={report ? report.overallAverage.toFixed(1) : '0.0'} icon={<Star size={24} className="text-white" />} accent />
        <MetricCard label="De Atendimento" value={String(report?.countByOrigin.chatClose ?? 0)} icon={<ClipboardList className="text-[var(--accent-text)]" />} />
        <MetricCard label="Manuais" value={String(report?.countByOrigin.manual ?? 0)} icon={<ClipboardList className="text-[var(--accent-text)]" />} />
      </div>

      {report && report.count > 0 && report.count < MIN_RELIABLE_EVALUATION_COUNT && (
        <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-warning)] bg-[var(--surface-warning)] border border-[var(--text-warning)]/20 rounded-xl px-4 py-3">
          <AlertTriangle size={14} /> Amostra pequena — com poucas avaliações, a média geral ainda pode não ser representativa.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative group flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] group-focus-within:text-[var(--accent-text)] transition-colors" size={16} />
          <input
            type="text"
            placeholder="Buscar por empresa, contato ou analista..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl pl-10 pr-4 py-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-[var(--accent)]/10 focus:border-[var(--accent)] transition-all"
          />
        </div>
        <StyledSelect
          value={originFilter}
          onChange={(e) => setOriginFilter(e.target.value)}
          className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold outline-none min-w-[160px]"
        >
          <option value="">Todas as origens</option>
          <option value="chat_close">Atendimento</option>
          <option value="manual">Manual</option>
        </StyledSelect>
        <StyledSelect
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold outline-none min-w-[190px]"
        >
          <option value="">Todos os perfis</option>
          <option value="technical">{TAG_LABELS.technical}</option>
          <option value="beginner">{TAG_LABELS.beginner}</option>
          <option value="challenging">{TAG_LABELS.challenging}</option>
        </StyledSelect>
      </div>

      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-3xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-default)]">
                <th className="px-6 py-5 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Empresa</th>
                <th className="px-6 py-5 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Contato</th>
                <th className="px-6 py-5 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Analista</th>
                <th className="px-6 py-5 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Origem</th>
                <th className="px-6 py-5 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Perfil</th>
                <th className="px-6 py-5 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Média</th>
                <th className="px-6 py-5 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Data</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-[var(--text-tertiary)] font-medium">Carregando avaliações...</td></tr>
              ) : pageItems.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-[var(--text-tertiary)] font-medium">Nenhuma avaliação encontrada.</td></tr>
              ) : pageItems.map(e => {
                const avg = evaluationAverage(e);
                return (
                  <tr key={e.id} className="border-t border-[var(--border-default)] hover:bg-[var(--surface-card)]/80 transition-colors">
                    <td className="px-6 py-4 font-bold text-[var(--text-primary)]">{e.companyName}</td>
                    <td className="px-6 py-4 text-[var(--text-secondary)]">{e.contactName || '—'}</td>
                    <td className="px-6 py-4 text-[var(--text-secondary)]">{e.analystName}</td>
                    <td className="px-6 py-4 text-[var(--text-secondary)]">{ORIGIN_LABELS[e.origin]}</td>
                    <td className="px-6 py-4 text-[var(--text-secondary)]">{e.profileTag ? TAG_LABELS[e.profileTag] : '—'}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-amber-400">
                        <Star size={14} fill="currentColor" />
                        <span className="text-xs font-bold text-[var(--text-secondary)]">{avg !== null ? avg.toFixed(1) : '—'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-[var(--text-tertiary)] text-xs font-medium">{new Date(e.createdAt).toLocaleDateString('pt-BR')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-default)]">
            <p className="text-xs font-semibold text-[var(--text-tertiary)]">
              Exibindo {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filtered.length)} de {filtered.length}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-default)] text-[var(--text-tertiary)] transition-colors hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/10 hover:text-[var(--accent-text)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs font-bold text-[var(--text-secondary)] px-2">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-default)] text-[var(--text-tertiary)] transition-colors hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/10 hover:text-[var(--accent-text)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon, accent }: { label: string, value: string, icon: React.ReactNode, accent?: boolean }) {
  return (
    <div className={cn(
      "p-6 rounded-2xl flex flex-col items-center shadow-sm transition-all",
      accent ? "bg-[var(--accent)] text-white shadow-indigo-200" : "bg-[var(--surface-card)] border border-[var(--border-default)]"
    )}>
      <div className={cn("p-3 rounded-xl mb-4", accent ? "bg-white/20" : "bg-[var(--surface-card)]")}>{icon}</div>
      <p className={cn("text-[10px] font-semibold uppercase tracking-widest mb-1", accent ? "opacity-70" : "text-[var(--text-tertiary)]")}>{label}</p>
      <p className="text-2xl font-black">{value}</p>
    </div>
  );
}
