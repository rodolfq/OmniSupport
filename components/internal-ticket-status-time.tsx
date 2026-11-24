'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Timer, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Aba "Tempo por status" do ticket interno (2026-11-23). Os trechos vêm de
// internal_ticket_status_periods (gravados por gatilho, ver a migration
// internal_ticket_status_periods.sql) via GET /api/internal-tickets?action=status-time.
// Mostra os dois relógios pedidos pelo usuário: corrido (24h/dia) e útil
// (08h–18h, seg a sex, mesma regra do SLA). Busca ao abrir a aba, então
// reabrir já traz o trecho atual em dia.

interface StatusPeriod {
  status: string;
  subStatus: string | null;
  queueName: string | null;
  startedAt: string;
  endedAt: string | null;
  sinceDeploy: boolean;
  seconds: number;
  businessMinutes: number;
}

export function formatDuration(seconds: number): string {
  const totalMin = Math.floor(seconds / 60);
  if (totalMin < 1) return 'menos de 1min';
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}min` : `${h}h`;
  return `${m}min`;
}

// Tempo útil fica em horas (não em "dias úteis"), para não confundir com dia corrido.
export function formatBusinessMinutes(minutes: number): string {
  if (minutes < 1) return '0min';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}min`;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function statusLabel(p: { status: string; subStatus: string | null }) {
  return p.subStatus ? `${p.status} › ${p.subStatus}` : p.status;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

export function InternalTicketStatusTime({ internalTicketId }: { internalTicketId: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [periods, setPeriods] = useState<StatusPeriod[]>([]);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    fetch(`/api/internal-tickets?action=status-time&internalTicketId=${encodeURIComponent(internalTicketId)}`)
      .then(async res => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !body) { setState('error'); return; }
        if (body.available === false) { setState('unavailable'); return; }
        setPeriods(Array.isArray(body.periods) ? body.periods : []);
        setState('ready');
      })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [internalTicketId]);

  // Soma por status › sub-status (um status pode ter várias passagens).
  const totals = useMemo(() => {
    const map = new Map<string, { label: string; seconds: number; businessMinutes: number; passagens: number; atual: boolean; parcial: boolean }>();
    for (const p of periods) {
      const label = statusLabel(p);
      const cur = map.get(label) ?? { label, seconds: 0, businessMinutes: 0, passagens: 0, atual: false, parcial: false };
      cur.seconds += p.seconds;
      cur.businessMinutes += p.businessMinutes;
      cur.passagens += 1;
      if (!p.endedAt) cur.atual = true;
      if (p.sinceDeploy) cur.parcial = true;
      map.set(label, cur);
    }
    return [...map.values()].sort((a, b) => b.seconds - a.seconds);
  }, [periods]);

  if (state === 'loading') {
    return <div className="flex items-center gap-2 py-8 justify-center text-xs text-[var(--text-tertiary)]"><Loader2 size={14} className="animate-spin" /> Carregando...</div>;
  }
  if (state === 'unavailable') {
    return <p className="text-xs text-[var(--text-tertiary)] py-8 text-center">O registro de tempo por status ainda não foi ativado neste ambiente.</p>;
  }
  if (state === 'error') {
    return <p className="text-xs text-[var(--text-danger)] py-8 text-center">Não foi possível carregar o tempo por status.</p>;
  }
  if (periods.length === 0) {
    return (
      <div className="text-center py-8">
        <Timer size={32} className="mx-auto text-slate-300 mb-2" />
        <p className="text-xs text-[var(--text-tertiary)]">Nenhum registro de status ainda.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-[11px] text-[var(--text-tertiary)]">
        <strong className="text-[var(--text-secondary)]">Corrido</strong>: 24h por dia, inclusive noite e fim de semana.{' '}
        <strong className="text-[var(--text-secondary)]">Útil</strong>: só das 08h às 18h, de segunda a sexta. O status atual conta até agora.
      </p>

      <div>
        <h2 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase mb-2">Total por status</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
                <th className="text-left py-2 pr-3">Status</th>
                <th className="text-right py-2 pr-3">Corrido</th>
                <th className="text-right py-2 pr-3">Útil</th>
                <th className="text-right py-2">Passagens</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-default)]">
              {totals.map(t => (
                <tr key={t.label}>
                  <td className="py-2 pr-3">
                    <span className="font-bold text-[var(--text-primary)]">{t.label}</span>
                    {t.atual && <span className="ml-2 text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-widest bg-[var(--accent)]/10 text-[var(--accent-text)]">Atual</span>}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-[var(--text-secondary)]">{t.parcial ? '≥ ' : ''}{formatDuration(t.seconds)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-[var(--text-secondary)]">{t.parcial ? '≥ ' : ''}{formatBusinessMinutes(t.businessMinutes)}</td>
                  <td className="py-2 text-right tabular-nums text-[var(--text-secondary)]">{t.passagens}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totals.some(t => t.parcial) && (
          <p className="text-[10px] text-[var(--text-tertiary)] mt-2">
            ≥ : o ticket já estava neste status quando o registro começou; o tempo antes disso não foi medido.
          </p>
        )}
      </div>

      <div>
        <h2 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase mb-2">Linha do tempo</h2>
        <ol className="space-y-2 max-h-[24rem] overflow-y-auto pr-1">
          {[...periods].reverse().map((p, i) => (
            <li
              key={`${p.startedAt}-${i}`}
              className={cn(
                'flex flex-wrap items-center gap-x-4 gap-y-1 p-3 rounded-xl border bg-[var(--surface-card)]',
                p.endedAt ? 'border-[var(--border-default)]' : 'border-[var(--accent)]/40'
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-[var(--text-primary)] truncate">{statusLabel(p)}</p>
                <p className="text-[10px] text-[var(--text-tertiary)]">
                  {p.sinceDeploy ? `Desde a implantação (${formatDateTime(p.startedAt)})` : formatDateTime(p.startedAt)}
                  {' → '}
                  {p.endedAt ? formatDateTime(p.endedAt) : 'agora'}
                  {p.queueName && ` · Fila: ${p.queueName}`}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-bold tabular-nums text-[var(--text-secondary)]">{formatDuration(p.seconds)} <span className="font-medium text-[var(--text-tertiary)]">corrido</span></p>
                <p className="text-[10px] tabular-nums text-[var(--text-tertiary)]">{formatBusinessMinutes(p.businessMinutes)} útil</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
