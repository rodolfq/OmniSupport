'use client';

import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarRange, RefreshCw, AlertTriangle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { classifyWeekendRows } from '@/lib/weekend-schedule-utils';
import { useWeekendScheduleQuery, refreshWeekendSchedule } from '@/lib/query-hooks';

// Só leitura — a fonte é a planilha do Google, publicada na web (ver
// lib/services/weekend-schedule-service.ts). Nenhuma escrita acontece aqui;
// quem quiser mudar a escala edita a planilha, este componente só reflete.
//
// Cache via TanStack Query (mesmo client de lib/query-hooks.ts): a MESMA
// chave é usada pelo popover do Giro (components/giro-status-popover.tsx),
// então quem já abriu um dos dois vê o outro carregar na hora, sem esperar
// nova requisição.
export function WeekendScheduleContent() {
  const queryClient = useQueryClient();
  const { data, isLoading, error: queryError } = useWeekendScheduleQuery({ enabled: true });
  const [refreshing, setRefreshing] = useState(false);

  const error = queryError ? (queryError as any)?.message || 'Não foi possível carregar a escala.' : null;
  const availableTabs: string[] = queryError ? (queryError as any)?.availableTabs || [] : [];

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshWeekendSchedule(queryClient);
      toast.success('Escala atualizada.');
    } catch (err: any) {
      toast.error(err?.message || 'Não foi possível atualizar a escala.');
    } finally {
      setRefreshing(false);
    }
  };

  const classifiedRows = useMemo(
    () => data ? classifyWeekendRows(data.rows, data.todayIso) : [],
    [data]
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-3">
            <CalendarRange className="text-[var(--accent-text)]" size={28} />
            Escala Fim de Semana
          </h1>
          <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">
            {data ? `Aba "${data.tabName}" — só leitura, direto da planilha` : 'Só leitura, direto da planilha'}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isLoading || refreshing}
          className="flex items-center gap-2 bg-[var(--surface-pill)] text-[var(--text-secondary)] px-4 py-2.5 rounded-lg text-sm font-bold border border-[var(--border-default)] hover:bg-[var(--border-default)] transition-all disabled:opacity-50 self-start"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[1.75rem] shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-16 text-center text-sm text-[var(--text-tertiary)] font-medium">Carregando escala...</div>
        ) : error ? (
          <div className="p-10 text-center space-y-3">
            <AlertTriangle className="mx-auto text-[var(--text-warning-strong)]" size={32} />
            <p className="text-sm font-bold text-[var(--text-primary)]">{error}</p>
            {availableTabs.length > 0 && (
              <p className="text-xs text-[var(--text-tertiary)] font-medium">
                Abas encontradas na planilha: {availableTabs.join(', ')}
              </p>
            )}
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="p-16 text-center text-sm text-[var(--text-tertiary)] font-medium">
            Nenhuma linha de escala encontrada na aba do mês atual.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-default)] bg-[var(--surface-pill)]/40">
                  <th className="text-left px-6 py-3 text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">Data</th>
                  <th className="text-left px-6 py-3 text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">Dia</th>
                  <th className="text-left px-6 py-3 text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">Titular</th>
                  <th className="text-left px-6 py-3 text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">Substituto</th>
                  <th className="text-left px-6 py-3 text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">Responsável efetivo</th>
                  <th className="text-left px-6 py-3 text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">Horas</th>
                </tr>
              </thead>
              <tbody>
                {classifiedRows.map((row, i) => (
                  <tr
                    key={`${row.date}-${i}`}
                    className={cn(
                      'border-b border-[var(--border-default)] last:border-0 transition-colors',
                      row.status === 'past' && 'opacity-40 hover:opacity-70',
                      row.status === 'next' && 'bg-[var(--accent)]/10',
                      row.status === 'upcoming' && 'hover:bg-[var(--surface-pill)]/40'
                    )}
                  >
                    <td className="px-6 py-3 font-bold whitespace-nowrap">
                      <span className={cn('flex items-center gap-2', row.status === 'next' ? 'text-[var(--accent-text)]' : 'text-[var(--text-primary)]')}>
                        {row.date}
                        {row.status === 'next' && (
                          <span className="px-1.5 py-0.5 rounded-full bg-[var(--accent)] text-white text-[8px] font-black uppercase tracking-widest">
                            Próximo
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-[var(--text-secondary)] whitespace-nowrap">{row.weekday}</td>
                    <td className="px-6 py-3 font-bold text-[var(--text-primary)]">{row.titular || '—'}</td>
                    <td className="px-6 py-3 text-[var(--text-secondary)]">{row.substituto || '—'}</td>
                    <td className="px-6 py-3 text-[var(--text-secondary)]">{row.responsavelEfetivo || '—'}</td>
                    <td className="px-6 py-3 text-[var(--text-secondary)] whitespace-nowrap">{row.horas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && data.rows.length > 0 && (
        <div className="flex items-center gap-5 text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[var(--text-tertiary)] opacity-40" /> Passado</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[var(--accent)]" /> Próximo fim de semana</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[var(--text-tertiary)]" /> Restantes</span>
        </div>
      )}

      <p className="text-[10px] text-[var(--text-tertiary)] font-medium flex items-center gap-1.5">
        Fonte:{' '}
        <a
          href="https://docs.google.com/spreadsheets/d/e/2PACX-1vROzKHP1pCAm8nNSnYlEcb7ZSAax1Mnvlon5CPWlXv0uFRPIuDjKGbkmEwcpJ-XMmygyJnAzqRAFZpH/pubhtml"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent-text)] underline inline-flex items-center gap-1"
        >
          planilha no Google Sheets <ExternalLink size={11} />
        </a>
      </p>
    </div>
  );
}
