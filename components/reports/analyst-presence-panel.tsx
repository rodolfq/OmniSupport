'use client';

import React, { useMemo, useState } from 'react';
import { AlertTriangle, Clock, Coffee, WifiOff, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useReportFetch } from '@/components/reports/use-report-fetch';
import { ReportSectionStatus } from '@/components/reports/report-section';
import { AnalystAvatar } from '@/components/reports/analyst-avatar';
import { formatDecimalBr } from '@/lib/report-format';

// Detalhe do "Tempo online × ausente": ao escolher um analista, mostra cada trecho de
// status do período, com início, fim, duração e motivo. A linha do tempo por dia e a
// tabela mostram o mesmo dado; a tabela é a alternativa textual.
//
// Horário: America/Sao_Paulo, UTC-3 fixo (o Brasil não usa horário de verão desde 2019).
// Formato: DD/MM/AAAA HH:mm, como manda o CLAUDE.md.

export interface PresenceAnalyst {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

interface Segment {
  status: 'online' | 'away' | 'offline' | 'sem_registro' | string;
  reason: string | null;
  startedAt: string;
  endedAt: string;
  seconds: number;
  rawRows: number;
}

const ENDPOINT = '/api/reports/analysts';
const BRASILIA_OFFSET_MS = 3 * 3600 * 1000;
// Um turno inteiro sem nenhuma mudança de status é normal por horas (manhã sem almoço).
// Só alerta para trechos longos demais para um turno, que indicam saída não registrada.
const LONG_ONLINE_HOURS = 10;
// Almoço e pausa duram minutos ou, no máximo, uma hora. Ausência de mais de 3 h quase
// sempre é um status que ficou marcado (ex.: "Almoço" das 17:45 às 08:48 do dia seguinte).
const LONG_AWAY_HOURS = 3;

// Cores por motivo de ausência, fixas: o mesmo motivo tem sempre a mesma cor.
const AWAY_COLORS: Record<string, string> = {
  'Almoço': '#f59e0b',
  'Pausa': '#0ea5e9',
  'Reunião': '#6366f1',
  'Pessoal': '#ec4899',
  'Treinamento': '#22c55e',
};
const AWAY_FALLBACK = '#a855f7';
const ONLINE_COLOR = '#0FA694';
const OFFLINE_COLOR = '#94a3b8';

const pad = (n: number) => String(n).padStart(2, '0');

// Data e hora de Brasília a partir de um instante em ms, sem depender do fuso do navegador.
function brasilia(ms: number): Date {
  return new Date(ms - BRASILIA_OFFSET_MS);
}

function formatDateTime(ms: number): string {
  const d = brasilia(ms);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function formatTime(ms: number): string {
  const d = brasilia(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function dayKeyOf(ms: number): string {
  const d = brasilia(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function dayLabelOf(ms: number): string {
  const d = brasilia(ms);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`;
}

function minuteOfDay(ms: number): number {
  const d = brasilia(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
}

// Meia-noite de Brasília do dia seguinte, em ms UTC.
function nextMidnightMs(ms: number): number {
  const d = brasilia(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 3, 0, 0);
}

function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${pad(m)} min`;
}

function statusLabel(seg: Segment): string {
  if (seg.status === 'online') return 'Online (disponível)';
  if (seg.status === 'offline') return 'Offline';
  if (seg.status === 'away') return seg.reason ? `Ausente · ${seg.reason}` : 'Ausente · sem motivo';
  if (seg.status === 'sem_registro') return 'Sem registro';
  return seg.status;
}

function colorOf(seg: Segment): string {
  if (seg.status === 'online') return ONLINE_COLOR;
  if (seg.status === 'offline') return OFFLINE_COLOR;
  if (seg.status === 'away') return AWAY_COLORS[seg.reason ?? ''] ?? AWAY_FALLBACK;
  return '';
}

function isLongOnline(seg: Segment): boolean {
  return seg.status === 'online' && seg.seconds >= LONG_ONLINE_HOURS * 3600;
}

function isLongAway(seg: Segment): boolean {
  return seg.status === 'away' && seg.seconds >= LONG_AWAY_HOURS * 3600;
}

// Trecho que pode ser um status não encerrado (saída ou volta não registradas).
function isSuspicious(seg: Segment): boolean {
  return isLongOnline(seg) || isLongAway(seg);
}

// Um trecho que atravessa a meia-noite vira um pedaço por dia, para a linha do tempo.
function splitByDay(seg: Segment, index: number) {
  const pieces: { day: string; startMin: number; endMin: number; seg: Segment; index: number; startMs: number }[] = [];
  let cursor = Date.parse(seg.startedAt);
  const end = Date.parse(seg.endedAt);
  while (cursor < end) {
    const next = Math.min(nextMidnightMs(cursor), end);
    const startMin = minuteOfDay(cursor);
    pieces.push({
      day: dayKeyOf(cursor),
      startMin,
      endMin: startMin + (next - cursor) / 60000,
      seg,
      index,
      startMs: cursor,
    });
    cursor = next;
  }
  return pieces;
}

type Filter = 'todos' | 'ausencias' | 'sem_registro';

export function AnalystPresencePanel({
  analysts,
  filterQs,
  ready,
}: {
  analysts: PresenceAnalyst[];
  filterQs: string;
  ready: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('todos');
  const effectiveId = selectedId ?? analysts[0]?.id ?? null;
  const selected = analysts.find(a => a.id === effectiveId) ?? null;

  const timeline = useReportFetch<{ segments: Segment[] }>(
    ENDPOINT,
    'presence-timeline',
    filterQs,
    ready && !!effectiveId,
    effectiveId ? `analystId=${effectiveId}` : ''
  );

  const segments = useMemo(() => timeline.data?.segments ?? [], [timeline.data]);

  const totals = useMemo(() => {
    const byReason = new Map<string, number>();
    let online = 0, offline = 0, away = 0, gap = 0;
    for (const s of segments) {
      if (s.status === 'online') online += s.seconds;
      else if (s.status === 'offline') offline += s.seconds;
      else if (s.status === 'away') {
        away += s.seconds;
        const key = s.reason ?? 'Sem motivo';
        byReason.set(key, (byReason.get(key) ?? 0) + s.seconds);
      } else if (s.status === 'sem_registro') gap += s.seconds;
    }
    return {
      online, offline, away, gap,
      byReason: Array.from(byReason.entries()).sort((a, b) => b[1] - a[1]),
      suspicious: segments.filter(isSuspicious).length,
    };
  }, [segments]);

  const dayRows = useMemo(() => {
    const map = new Map<string, { label: string; pieces: ReturnType<typeof splitByDay> }>();
    segments.forEach((s, i) => {
      for (const p of splitByDay(s, i)) {
        const entry = map.get(p.day) ?? { label: dayLabelOf(p.startMs), pieces: [] };
        entry.pieces.push(p);
        map.set(p.day, entry);
      }
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [segments]);

  const visibleSegments = useMemo(() => {
    return segments
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => {
        if (filter === 'ausencias') return s.status === 'away';
        if (filter === 'sem_registro') return s.status === 'sem_registro';
        return true;
      });
  }, [segments, filter]);

  const status: ReportSectionStatus = timeline.status;

  return (
    <section aria-labelledby="presence-title" className="rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] shadow-sm p-5 space-y-5">
      <header>
        <h3 id="presence-title" className="text-base font-bold text-[var(--text-primary)]">Detalhe por analista</h3>
        <p className="text-xs text-[var(--text-tertiary)]">Escolha um analista para ver cada período de status: de que horas até que horas, e o motivo.</p>
      </header>

      {/* Seleção de analista */}
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Analistas">
        {analysts.map(a => (
          <button
            key={a.id}
            type="button"
            aria-pressed={a.id === effectiveId}
            onClick={() => setSelectedId(a.id)}
            className={cn(
              'flex flex-shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
              a.id === effectiveId
                ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-text)]'
                : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-pill)]'
            )}
          >
            <AnalystAvatar name={a.name} src={a.avatarUrl} className="h-6 w-6 text-[9px]" />
            {a.name}
          </button>
        ))}
      </div>

      {status === 'loading' && (
        <div className="space-y-3" aria-busy="true">
          <div className="h-20 rounded-xl bg-[var(--surface-pill)] animate-pulse" />
          <div className="h-40 rounded-xl bg-[var(--surface-pill)] animate-pulse" />
        </div>
      )}

      {status === 'error' && (
        <p className="text-sm text-[var(--text-secondary)]">Não foi possível carregar o detalhe deste analista.</p>
      )}

      {status === 'ready' && segments.length === 0 && (
        <p className="text-sm text-[var(--text-tertiary)]">Nenhum registro de presença deste analista no período.</p>
      )}

      {status === 'ready' && segments.length > 0 && selected && (
        <>
          {/* Resumo */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <SummaryTile icon={Clock} tone="online" label="Online" value={formatDuration(totals.online)} hint="disponível para atender" />
            <SummaryTile icon={Coffee} tone="away" label="Ausente" value={formatDuration(totals.away)}
              hint={totals.byReason.length ? totals.byReason.map(([r, s]) => `${r} ${formatDuration(s)}`).join(' · ') : 'nenhum motivo'} />
            <SummaryTile icon={WifiOff} tone="offline" label="Offline" value={formatDuration(totals.offline)} hint="fora do sistema" />
            <SummaryTile icon={HelpCircle} tone="gap" label="Sem registro" value={formatDuration(totals.gap)} hint="sem dado no histórico" />
          </div>

          {/* Legenda */}
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-[var(--text-secondary)]" aria-label="Legenda">
            <LegendItem color={ONLINE_COLOR} label="Online" />
            {totals.byReason.map(([reason]) => (
              <LegendItem key={reason} color={AWAY_COLORS[reason] ?? AWAY_FALLBACK} label={`Ausente · ${reason}`} />
            ))}
            <LegendItem color={OFFLINE_COLOR} label="Offline" />
            <li className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: 'repeating-linear-gradient(45deg, var(--border-strong) 0 2px, transparent 2px 5px)' }} aria-hidden />
              Sem registro
            </li>
          </ul>

          {/* Linha do tempo por dia */}
          <div className="space-y-2">
            <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 text-[10px] text-[var(--text-tertiary)]">
              <span />
              <div className="flex justify-between tabular-nums"><span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>24h</span></div>
            </div>
            <div className="max-h-96 overflow-y-auto pr-1 space-y-1.5">
              {dayRows.map(([day, row]) => (
                <div key={day} className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3">
                  <span className="text-xs font-semibold tabular-nums text-[var(--text-secondary)]">{row.label}</span>
                  <div className="relative h-6 rounded-md bg-[var(--surface-pill)] overflow-hidden">
                    {row.pieces.map((p, k) => {
                      const left = (p.startMin / 1440) * 100;
                      const width = Math.max(((p.endMin - p.startMin) / 1440) * 100, 0.4);
                      const isGap = p.seg.status === 'sem_registro';
                      const label = `${formatDateTime(p.startMs)} · ${statusLabel(p.seg)} · ${formatDuration(p.seg.seconds)}`;
                      return (
                        <div
                          key={`${day}-${k}`}
                          title={label}
                          aria-label={label}
                          className="absolute top-0 bottom-0 cursor-default"
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            background: isGap
                              ? 'repeating-linear-gradient(45deg, var(--border-strong) 0 2px, transparent 2px 5px)'
                              : colorOf(p.seg),
                            boxShadow: isGap ? undefined : 'inset 0 0 0 1px var(--surface-card)',
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Avisos */}
          {totals.suspicious > 0 && (
            <div className="flex gap-3 rounded-xl border border-[var(--border-alert)] bg-[var(--surface-warning)] p-3 text-xs text-[var(--text-secondary)]">
              <AlertTriangle size={16} className="flex-shrink-0 text-[var(--accent-warning-hover)]" aria-hidden />
              <p>
                {totals.suspicious} trecho{totals.suspicious === 1 ? '' : 's'} com cara de <strong>status não encerrado</strong>: ausência de {LONG_AWAY_HOURS} h ou mais, ou online por {LONG_ONLINE_HOURS} h ou mais sem nenhuma mudança.
                Nesses casos a saída ou a volta provavelmente não foi registrada. O tempo ausente desses trechos está inflado. Confira na tabela (marcado com ⚠).
              </p>
            </div>
          )}

          {/* Tabela de trechos */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-[var(--text-primary)]">Trechos do período ({segments.length})</p>
              <div className="flex gap-1.5" role="group" aria-label="Filtrar trechos">
                {([['todos', 'Todos'], ['ausencias', 'Ausências'], ['sem_registro', 'Sem registro']] as [Filter, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-semibold',
                      filter === key ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-text)]' : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-pill)]'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[28rem] overflow-auto rounded-xl border border-[var(--border-default)]">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="sticky top-0 bg-[var(--surface-card)] z-10">
                  <tr className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
                    <th className="text-left py-2 px-3">Início</th>
                    <th className="text-left py-2 px-3">Fim</th>
                    <th className="text-right py-2 px-3">Duração</th>
                    <th className="text-left py-2 px-3">Status</th>
                    <th className="text-left py-2 px-3">Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSegments.map(({ s, i }) => (
                    <tr key={i} className={cn('border-b border-[var(--border-default)] last:border-0', s.status === 'sem_registro' && 'text-[var(--text-tertiary)]')}>
                      <td className="py-2 px-3 tabular-nums whitespace-nowrap">{formatDateTime(Date.parse(s.startedAt))}</td>
                      <td className="py-2 px-3 tabular-nums whitespace-nowrap">{formatTime(Date.parse(s.endedAt))}</td>
                      <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap font-semibold">{formatDuration(s.seconds)}</td>
                      <td className="py-2 px-3">
                        <span className="inline-flex items-center gap-2">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.status === 'sem_registro' ? 'var(--border-strong)' : colorOf(s) }} aria-hidden />
                          {statusLabel(s)}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-xs">
                        {isLongOnline(s) ? (
                          <span className="inline-flex items-center gap-1 text-[var(--text-warning-strong)]"><AlertTriangle size={12} aria-hidden /> online sem mudança por mais de {LONG_ONLINE_HOURS} h</span>
                        ) : isLongAway(s) ? (
                          <span className="inline-flex items-center gap-1 text-[var(--text-warning-strong)]"><AlertTriangle size={12} aria-hidden /> ausência de mais de {LONG_AWAY_HOURS} h: status possivelmente não encerrado</span>
                        ) : s.status === 'sem_registro' ? (
                          <span>sem linha no histórico</span>
                        ) : s.rawRows > 1 ? (
                          <span className="text-[var(--text-tertiary)]">{s.rawRows} registros unidos</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {visibleSegments.length === 0 && (
                    <tr><td colSpan={5} className="py-6 px-3 text-center text-[var(--text-tertiary)]">Nenhum trecho neste filtro.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-[var(--text-tertiary)]">
              Horários em Brasília. Trechos seguidos com o mesmo status foram unidos; o número de registros originais aparece na observação.
              Horas = {formatDecimalBr(totals.online / 3600, 1)} h online · {formatDecimalBr(totals.away / 3600, 1)} h ausente · {formatDecimalBr(totals.offline / 3600, 1)} h offline · {formatDecimalBr(totals.gap / 3600, 1)} h sem registro.
            </p>
          </div>
        </>
      )}
    </section>
  );
}

function SummaryTile({ icon: Icon, tone, label, value, hint }: {
  icon: React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>;
  tone: 'online' | 'away' | 'offline' | 'gap';
  label: string;
  value: string;
  hint: string;
}) {
  const toneClass = {
    online: 'text-[var(--accent-text)]',
    away: 'text-[var(--text-warning-strong)]',
    offline: 'text-[var(--text-secondary)]',
    gap: 'text-[var(--text-tertiary)]',
  }[tone];
  return (
    <div className="rounded-xl bg-[var(--surface-pill)] p-3 min-w-0">
      <div className={cn('flex items-center gap-1.5 text-xs font-semibold', toneClass)}>
        <Icon size={13} aria-hidden />
        {label}
      </div>
      <p className="mt-1 text-lg font-black tabular-nums text-[var(--text-primary)] truncate">{value}</p>
      <p className="text-[11px] text-[var(--text-tertiary)] truncate" title={hint}>{hint}</p>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-sm" style={{ background: color }} aria-hidden />
      {label}
    </li>
  );
}
