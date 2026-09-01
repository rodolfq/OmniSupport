'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarRange, RefreshCw, AlertTriangle, ExternalLink, Link2, X, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { Permission } from '@/lib/types';
import { classifyWeekendRows } from '@/lib/weekend-schedule-utils';
import { useWeekendScheduleQuery, refreshWeekendSchedule } from '@/lib/query-hooks';
import { getWeekendScheduleConfig, saveWeekendScheduleConfig } from '@/lib/services/giro-client';

// Só leitura — a fonte é a planilha do Google, publicada na web (ver
// lib/services/weekend-schedule-service.ts). Nenhuma escrita acontece aqui;
// quem quiser mudar a escala edita a planilha, este componente só reflete.
//
// Cache via TanStack Query (mesmo client de lib/query-hooks.ts): a MESMA
// chave é usada pelo popover do Giro (components/giro-status-popover.tsx),
// então quem já abriu um dos dois vê o outro carregar na hora, sem esperar
// nova requisição.
export function WeekendScheduleContent() {
  const { hasPermission } = useApp();
  const canManage = hasPermission(Permission.GIRO_MANAGE);
  const queryClient = useQueryClient();
  // 0 = mês atual (o mesmo que o popover do Giro sempre mostra), 1 = próximo,
  // -1 = anterior etc. — a aba correspondente na planilha só existe se o
  // time já publicou aquele mês (fora do controle do código, ver
  // weekend-schedule-service.ts).
  const [monthOffset, setMonthOffset] = useState(0);
  const { data, isLoading, error: queryError } = useWeekendScheduleQuery({ enabled: true, monthOffset });
  const [refreshing, setRefreshing] = useState(false);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);

  const error = queryError ? (queryError as any)?.message || 'Não foi possível carregar a escala.' : null;
  const availableTabs: string[] = queryError ? (queryError as any)?.availableTabs || [] : [];

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshWeekendSchedule(queryClient, monthOffset);
      toast.success('Escala atualizada.');
    } catch (err: any) {
      toast.error(err?.message || 'Não foi possível atualizar a escala.');
    } finally {
      setRefreshing(false);
    }
  };

  const classifiedRows = useMemo(() => {
    if (!data) return [];
    const rows = classifyWeekendRows(data.rows, data.todayIso);
    // "Próximo fim de semana" só faz sentido no mês atual — num mês
    // navegado, a primeira linha ainda não passada sempre bateria como
    // "next" mesmo sendo só o início daquele mês, não o plantão mais
    // próximo de verdade.
    if (monthOffset === 0) return rows;
    return rows.map(r => (r.status === 'next' ? { ...r, status: 'upcoming' as const } : r));
  }, [data, monthOffset]);

  // Assim que a escala carrega, a data em verde (próximo plantão) já entra
  // centralizada na tela — só na primeira vez que os dados chegam, não a
  // cada refetch em segundo plano. scrollIntoView com block:'center' já
  // resolve sozinho o caso "não dá pra centralizar de verdade" (linha perto
  // do topo/fim da lista): ele rola só o necessário pra deixar visível.
  const nextRowRef = useRef<HTMLTableRowElement>(null);
  // Card <md equivalente à linha da tabela — as duas árvores (tabela/cards)
  // ficam sempre montadas, só uma delas visível por vez via hidden/md:hidden.
  const nextCardRef = useRef<HTMLDivElement>(null);
  const hasCenteredRef = useRef(false);
  useEffect(() => {
    if (hasCenteredRef.current) return;
    if (!classifiedRows.some(row => row.status === 'next')) return;
    hasCenteredRef.current = true;
    requestAnimationFrame(() => {
      nextRowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      nextCardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, [classifiedRows]);

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
        <div className="flex items-center gap-2 self-start">
          <div className="flex items-center gap-1 bg-[var(--surface-pill)] rounded-lg border border-[var(--border-default)] p-1">
            <button
              onClick={() => setMonthOffset(m => m - 1)}
              title="Mês anterior"
              className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:bg-[var(--border-default)] hover:text-[var(--text-primary)] transition-all"
            >
              <ChevronLeft size={16} />
            </button>
            {monthOffset !== 0 && (
              <button
                onClick={() => setMonthOffset(0)}
                className="px-2 text-[10px] font-black uppercase tracking-widest text-[var(--accent-text)] hover:underline"
              >
                Mês atual
              </button>
            )}
            <button
              onClick={() => setMonthOffset(m => m + 1)}
              title="Próximo mês"
              className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:bg-[var(--border-default)] hover:text-[var(--text-primary)] transition-all"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          {canManage && (
            <button
              onClick={() => setIsLinkModalOpen(true)}
              title="Trocar o link da planilha publicada"
              className="flex items-center gap-2 bg-[var(--surface-pill)] text-[var(--text-secondary)] px-4 py-2.5 rounded-lg text-sm font-bold border border-[var(--border-default)] hover:bg-[var(--border-default)] transition-all"
            >
              <Link2 size={16} /> Trocar link
            </button>
          )}
          <button
            onClick={handleRefresh}
            disabled={isLoading || refreshing}
            className="flex items-center gap-2 bg-[var(--surface-pill)] text-[var(--text-secondary)] px-4 py-2.5 rounded-lg text-sm font-bold border border-[var(--border-default)] hover:bg-[var(--border-default)] transition-all disabled:opacity-50"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>
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
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
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
                    ref={row.status === 'next' ? nextRowRef : undefined}
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
        {!isLoading && !error && data && data.rows.length > 0 && (
          <div className="md:hidden divide-y divide-[var(--border-default)]">
            {classifiedRows.map((row, i) => (
              <div
                key={`${row.date}-${i}`}
                ref={row.status === 'next' ? nextCardRef : undefined}
                className={cn(
                  'px-5 py-3 transition-colors',
                  row.status === 'past' && 'opacity-40',
                  row.status === 'next' && 'bg-[var(--accent)]/10'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn('flex items-center gap-2 font-bold text-sm', row.status === 'next' ? 'text-[var(--accent-text)]' : 'text-[var(--text-primary)]')}>
                    {row.date}
                    <span className="text-[10px] font-medium text-[var(--text-tertiary)]">{row.weekday}</span>
                  </span>
                  {row.status === 'next' && (
                    <span className="px-1.5 py-0.5 rounded-full bg-[var(--accent)] text-white text-[8px] font-black uppercase tracking-widest shrink-0">
                      Próximo
                    </span>
                  )}
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <span className="text-[var(--text-tertiary)]">Titular</span>
                  <span className="font-bold text-[var(--text-primary)] text-right">{row.titular || '—'}</span>
                  <span className="text-[var(--text-tertiary)]">Substituto</span>
                  <span className="text-[var(--text-secondary)] text-right">{row.substituto || '—'}</span>
                  <span className="text-[var(--text-tertiary)]">Responsável efetivo</span>
                  <span className="text-[var(--text-secondary)] text-right">{row.responsavelEfetivo || '—'}</span>
                  <span className="text-[var(--text-tertiary)]">Horas</span>
                  <span className="text-[var(--text-secondary)] text-right">{row.horas}</span>
                </div>
              </div>
            ))}
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

      {data?.sheetId && (
        <p className="text-[10px] text-[var(--text-tertiary)] font-medium flex items-center gap-1.5">
          Fonte:{' '}
          <a
            href={`https://docs.google.com/spreadsheets/d/e/${data.sheetId}/pubhtml`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent-text)] underline inline-flex items-center gap-1"
          >
            planilha no Google Sheets <ExternalLink size={11} />
          </a>
        </p>
      )}

      {canManage && (
        <SheetLinkModal
          isOpen={isLinkModalOpen}
          onClose={() => setIsLinkModalOpen(false)}
          onSaved={async () => {
            setIsLinkModalOpen(false);
            await queryClient.invalidateQueries({ queryKey: ['ref', 'weekend-schedule'] });
            toast.success('Link atualizado.');
          }}
        />
      )}
    </div>
  );
}

// Só monta (e só busca a config atual) quando alguém com giro:manage abre —
// ninguém mais precisa saber qual link está configurado.
function SheetLinkModal({ isOpen, onClose, onSaved }: { isOpen: boolean; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState('');
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoadingCurrent(true);
    getWeekendScheduleConfig().then(result => {
      if (!('error' in result)) setDraft(result.sheetId || '');
      setLoadingCurrent(false);
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  const handleSave = async () => {
    setSaving(true);
    const result = await saveWeekendScheduleConfig(draft || null);
    setSaving(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    onSaved();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative bg-[var(--surface-card)] w-full max-w-md rounded-3xl shadow-2xl border border-[var(--border-default)] overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-[var(--border-default)] flex items-center gap-2">
              <Link2 size={16} className="text-[var(--accent-text)]" />
              <h3 className="text-sm font-black text-[var(--text-primary)] tracking-tight">Link da planilha</h3>
              <button onClick={onClose} className="ml-auto p-1.5 rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] transition-all">
                <X size={16} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-3">
              <p className="text-xs text-[var(--text-tertiary)] font-medium leading-relaxed">
                Cole a URL de &quot;Publicar na web&quot; da planilha nova (termina em <span className="font-mono">/pubhtml</span>) ou só o ID.
                O formato do link não muda, só troca quando a planilha for republicada num endereço diferente.
              </p>
              <input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                disabled={loadingCurrent || saving}
                placeholder="https://docs.google.com/spreadsheets/d/e/.../pubhtml"
                autoFocus
                className="w-full bg-[var(--surface-page)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-xs font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-60"
              />
              <p className="text-[10px] text-[var(--text-tertiary)] font-medium">
                Deixe em branco para voltar a usar o link padrão do sistema.
              </p>
            </div>

            <div className="px-6 py-4 bg-[var(--surface-pill)]/30 border-t border-[var(--border-default)] flex gap-3">
              <button
                onClick={onClose}
                disabled={saving}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-default)] text-xs font-black uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] transition-all disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || loadingCurrent}
                className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-all text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Salvar
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
