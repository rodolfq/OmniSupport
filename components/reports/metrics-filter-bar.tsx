'use client';

import React, { useEffect, useState } from 'react';
import { StyledSelect } from '@/components/styled-select';
import { fetchQueues } from '@/lib/services/config-service';
import { fetchCompanies } from '@/lib/services/config-service';
import { getWhatsappInstances } from '@/app/actions';

// Filtro compartilhado por todo relatório de métricas de chat e pelo
// Dashboard Gerencial (roadmap "Time x Gerencial" — padrão estabelecido no
// R1, "Atendimento — visão geral"). Um componente só, pra período/fila/
// instância/empresa nunca divergirem visualmente ou de comportamento entre
// as telas que os usam.

// 'year' e 'all' existem para relatórios de baixa cardinalidade (Hotfixes:
// dezenas de linhas por ano). NÃO entram na lista padrão de propósito — nos
// relatórios de chat, "todo o período" varre chat_messages inteiro e a tela
// trava sem avisar. Quem quiser esses dois passa `periods` explicitamente.
export type MetricsPeriodPreset = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';

export const DEFAULT_PERIOD_PRESETS: MetricsPeriodPreset[] = ['today', 'week', 'month', 'custom'];

export interface MetricsFilterState {
  period: MetricsPeriodPreset;
  customStart: string;
  customEnd: string;
  queueId: string;
  instanceId: string;
  companyId: string;
}

export const DEFAULT_METRICS_FILTER_STATE: MetricsFilterState = {
  period: 'month',
  customStart: '',
  customEnd: '',
  queueId: '',
  instanceId: '',
  companyId: ''
};

// true só quando o filtro tem tudo que precisa pra disparar uma consulta —
// intervalo customizado sem as duas datas ainda não está pronto.
export function isMetricsFilterReady(state: MetricsFilterState): boolean {
  return state.period !== 'custom' || (!!state.customStart && !!state.customEnd);
}

// Serialização única pra querystring — toda rota de API de relatório/
// dashboard gerencial espera exatamente essas chaves.
export function metricsFilterToQueryString(state: MetricsFilterState): string {
  const params = new URLSearchParams();
  params.set('period', state.period);
  if (state.period === 'custom') {
    if (state.customStart) params.set('startDate', state.customStart);
    if (state.customEnd) params.set('endDate', state.customEnd);
  }
  if (state.queueId) params.set('queueId', state.queueId);
  if (state.instanceId) params.set('instanceId', state.instanceId);
  if (state.companyId) params.set('companyId', state.companyId);
  return params.toString();
}

const PERIOD_LABELS: Record<MetricsPeriodPreset, string> = {
  today: 'Hoje',
  week: 'Semana',
  month: 'Mês',
  year: 'Ano',
  all: 'Todos',
  custom: 'Intervalo customizado'
};

// Etapa 9 (export) — resumo legível da seleção atual, pro cabeçalho do PDF
// (sem isso o PDF ficaria com UUIDs, inútil pra reunião). Só monta a
// string, não decide nada de layout.
function buildFilterSummary(
  state: MetricsFilterState,
  queues: any[],
  instances: any[],
  companies: any[],
  showScopeFilters: boolean
): string {
  const periodPart = state.period === 'custom'
    ? `Período: ${state.customStart || '?'} a ${state.customEnd || '?'}`
    : `Período: ${PERIOD_LABELS[state.period]}`;
  // Sem os seletores de escopo na tela, repetir "Fila: todas · Instância:
  // todas" no cabeçalho do PDF é ruído — o relatório nem tem essas dimensões.
  if (!showScopeFilters) return periodPart;
  const queueLabel = state.queueId ? (queues.find(q => q.id === state.queueId)?.name ?? state.queueId) : 'todas';
  const instanceLabel = state.instanceId ? (instances.find(i => i.id === state.instanceId)?.name ?? state.instanceId) : 'todas';
  const companyLabel = state.companyId ? (companies.find(c => c.id === state.companyId)?.name ?? state.companyId) : 'todas';
  return `${periodPart} · Fila: ${queueLabel} · Instância: ${instanceLabel} · Empresa: ${companyLabel}`;
}

interface MetricsFilterBarProps {
  value: MetricsFilterState;
  onChange: (next: MetricsFilterState) => void;
  onFilterSummaryChange?: (summary: string) => void;
  /**
   * Fila, instância e empresa. Desligar em relatório que não tem essas
   * dimensões (Hotfixes é sobre janela de release, não sobre atendimento) —
   * seletor que não filtra nada só confunde quem lê.
   */
  showScopeFilters?: boolean;
  /** Presets de período oferecidos. Ver DEFAULT_PERIOD_PRESETS. */
  periods?: MetricsPeriodPreset[];
  /** Conteúdo extra à direita (ex.: filtro de situação no relatório de Hotfixes). */
  children?: React.ReactNode;
}

export function MetricsFilterBar({
  value,
  onChange,
  onFilterSummaryChange,
  showScopeFilters = true,
  periods = DEFAULT_PERIOD_PRESETS,
  children
}: MetricsFilterBarProps) {
  const [queues, setQueues] = useState<any[]>([]);
  const [instances, setInstances] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);

  useEffect(() => {
    // Sem os seletores de escopo não há por que buscar filas, instâncias e
    // empresas — eram três requisições por carga de tela sem uso nenhum.
    if (!showScopeFilters) return;
    fetchQueues().then(setQueues);
    getWhatsappInstances().then(setInstances).catch(() => setInstances([]));
    fetchCompanies().then(setCompanies).catch(() => setCompanies([]));
  }, [showScopeFilters]);

  useEffect(() => {
    onFilterSummaryChange?.(buildFilterSummary(value, queues, instances, companies, showScopeFilters));
  }, [value, queues, instances, companies, onFilterSummaryChange, showScopeFilters]);

  const set = <K extends keyof MetricsFilterState>(key: K, val: MetricsFilterState[K]) => {
    onChange({ ...value, [key]: val });
  };

  return (
    <div className="flex flex-wrap items-end gap-4 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-5 shadow-sm">
      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Período</label>
        <StyledSelect
          value={value.period}
          onChange={(e) => set('period', e.target.value as MetricsPeriodPreset)}
          className="min-w-[160px] bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-[var(--accent)]/20 outline-none"
        >
          {periods.map(p => (
            <option key={p} value={p}>{PERIOD_LABELS[p]}</option>
          ))}
        </StyledSelect>
      </div>

      {value.period === 'custom' && (
        <>
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">De</label>
            <input
              type="date"
              value={value.customStart}
              onChange={(e) => set('customStart', e.target.value)}
              className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-[var(--accent)]/20 outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Até</label>
            <input
              type="date"
              value={value.customEnd}
              onChange={(e) => set('customEnd', e.target.value)}
              className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-[var(--accent)]/20 outline-none"
            />
          </div>
        </>
      )}

      {showScopeFilters && (
      <>
      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Fila</label>
        <StyledSelect
          value={value.queueId}
          onChange={(e) => set('queueId', e.target.value)}
          className="min-w-[180px] bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-[var(--accent)]/20 outline-none"
        >
          <option value="">Todas as filas</option>
          {queues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
        </StyledSelect>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Instância WhatsApp</label>
        <StyledSelect
          value={value.instanceId}
          onChange={(e) => set('instanceId', e.target.value)}
          className="min-w-[180px] bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-[var(--accent)]/20 outline-none"
        >
          <option value="">Todas as instâncias</option>
          {instances.map((i) => <option key={i.id} value={i.id}>{i.name || i.phone || i.id}</option>)}
        </StyledSelect>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Empresa</label>
        <StyledSelect
          value={value.companyId}
          onChange={(e) => set('companyId', e.target.value)}
          className="min-w-[180px] bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-[var(--accent)]/20 outline-none"
        >
          <option value="">Todas as empresas</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </StyledSelect>
      </div>
      </>
      )}

      {children}
    </div>
  );
}
