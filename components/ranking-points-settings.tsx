'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Award, Check, RotateCcw, AlertTriangle, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PointsWeights, DEFAULT_POINTS_WEIGHTS, normalizeWeights } from '@/lib/analyst-points';

// Configurações > Pontuação do Ranking. Quem tem a permissão reports:ranking_config (ou é
// Administrador) altera os pesos. A alteração vale para o ranking de todo o time depois de salvar.

const FIELDS: { key: 'volume' | 'volumeLimit' | 'good' | 'bad' | 'lt1' | 'lt3' | 'gt3'; label: string; hint: string }[] = [
  { key: 'volume', label: 'Volume (peso base por conversa)', hint: 'vale para conversas sem tag com peso. Simbólico, por design' },
  { key: 'volumeLimit', label: 'Limitador de pontos de volume', hint: '0 = sem limite' },
  { key: 'good', label: 'Good (avaliação positiva)', hint: 'por avaliação boa do cliente' },
  { key: 'bad', label: 'Bad (avaliação negativa)', hint: 'por avaliação ruim do cliente. Pesa mais que o good' },
  { key: 'lt1', label: 'Resposta < 1 min', hint: 'por conversa com 1ª resposta rápida' },
  { key: 'lt3', label: 'Resposta de 1 a 3 min', hint: 'por conversa' },
  { key: 'gt3', label: 'Resposta > 3 min', hint: 'por conversa' },
];

function toText(n: number): string {
  return String(n).replace('.', ',');
}

function parse(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (normalized === '' || normalized === '-') return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

interface TagOption { id: string; label: string }

export function RankingPointsSettings() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [saved, setSaved] = useState<PointsWeights>(DEFAULT_POINTS_WEIGHTS);
  const [draft, setDraft] = useState<PointsWeights>(DEFAULT_POINTS_WEIGHTS);
  const [isDefault, setIsDefault] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [tagTexts, setTagTexts] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  function applyWeights(w: PointsWeights, tagList: TagOption[]) {
    setDraft(w);
    setSaved(w);
    setTexts(Object.fromEntries(FIELDS.map(f => [f.key, toText(w[f.key])])));
    setTagTexts(Object.fromEntries(tagList.map(t => [t.id, w.tagWeights[t.id] !== undefined ? toText(w.tagWeights[t.id]) : ''])));
    setInvalid({});
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/analyst-points-config', { cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Falha ao carregar (HTTP ${res.status}).`);
        if (cancelled) return;
        const tagList: TagOption[] = body.tags ?? [];
        setTags(tagList);
        setIsDefault(!!body.isDefault);
        setUpdatedAt(body.updatedAt ?? null);
        applyWeights(normalizeWeights(body.weights), tagList);
      } catch (err: any) {
        if (!cancelled) setLoadError(err?.message || 'Não foi possível carregar a configuração.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Histórico de alterações: recarrega sempre que a última alteração muda (inclui depois de salvar).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/analyst-points-config?history=1', { cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Falha ao carregar o histórico (HTTP ${res.status}).`);
        if (!cancelled) { setHistory(body.entries ?? []); setHistoryError(null); }
      } catch (err: any) {
        if (!cancelled) setHistoryError(err?.message || 'Não foi possível carregar o histórico.');
      }
    })();
    return () => { cancelled = true; };
  }, [updatedAt]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const hasInvalid = Object.values(invalid).some(Boolean);

  function changeField(key: keyof PointsWeights, text: string) {
    setTexts(prev => ({ ...prev, [key]: text }));
    const n = parse(text);
    const bad = n === null || (key === 'volumeLimit' && n < 0);
    setInvalid(prev => ({ ...prev, [key]: bad }));
    if (!bad && n !== null) setDraft(prev => ({ ...prev, [key]: n }));
  }

  function changeTag(tagId: string, text: string) {
    setTagTexts(prev => ({ ...prev, [tagId]: text }));
    if (text.trim() === '') {
      setInvalid(prev => ({ ...prev, [`tag:${tagId}`]: false }));
      setDraft(prev => {
        const next = { ...prev.tagWeights };
        delete next[tagId];
        return { ...prev, tagWeights: next };
      });
      return;
    }
    const n = parse(text);
    setInvalid(prev => ({ ...prev, [`tag:${tagId}`]: n === null }));
    if (n !== null) setDraft(prev => ({ ...prev, tagWeights: { ...prev.tagWeights, [tagId]: n } }));
  }

  function restoreDefault() {
    applyWeights(normalizeWeights(DEFAULT_POINTS_WEIGHTS), tags);
    setMessage(null);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/analyst-points-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weights: draft }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Não foi possível salvar (HTTP ${res.status}).`);
      setIsDefault(!!body.isDefault);
      setUpdatedAt(body.updatedAt ?? null);
      applyWeights(normalizeWeights(body.weights), tags);
      setMessage({ kind: 'ok', text: 'Pontuação salva. Vale para o ranking de todo o time.' });
    } catch (err: any) {
      setMessage({ kind: 'error', text: err?.message || 'Não foi possível salvar.' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="h-64 rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] animate-pulse" aria-busy="true" />;
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-[var(--border-alert)] bg-[var(--surface-warning)] p-5 text-sm text-[var(--text-secondary)]">
        {loadError}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="ranking-points-title" className="rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] shadow-sm p-5 space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent-text)]">
              <Award size={18} aria-hidden />
            </span>
            <div>
              <h2 id="ranking-points-title" className="text-base font-bold text-[var(--text-primary)]">Pontuação do ranking de analistas</h2>
              <p className="text-xs text-[var(--text-tertiary)]">
                Defina quanto cada item do atendimento vale. A alteração vale para o ranking de todo o time depois de salvar.
              </p>
            </div>
          </div>
          {isDefault && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-warning)] border border-[var(--border-alert)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)]">
              <AlertTriangle size={12} aria-hidden /> Valores padrão (sem alteração salva)
            </span>
          )}
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {FIELDS.map(f => (
            <label key={f.key} className="block rounded-xl bg-[var(--surface-pill)] border border-[var(--border-default)] p-3">
              <span className="block text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">{f.label}</span>
              <input
                type="text"
                inputMode="decimal"
                value={texts[f.key] ?? ''}
                onChange={e => changeField(f.key, e.target.value)}
                aria-invalid={!!invalid[f.key]}
                className={cn(
                  'mt-1.5 w-full rounded-lg border bg-[var(--surface-card)] px-3 py-2 font-mono text-sm font-semibold text-[var(--text-primary)] tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40',
                  invalid[f.key] ? 'border-[var(--text-danger)]' : 'border-[var(--border-strong)]'
                )}
              />
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">{f.hint}</span>
              {invalid[f.key] && <span className="mt-1 block text-[11px] text-[var(--text-danger)]">Valor inválido</span>}
            </label>
          ))}
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Tag size={15} className="text-[var(--text-tertiary)]" aria-hidden />
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Peso por tag da conversa</h3>
          </div>
          <p className="text-xs text-[var(--text-tertiary)]">
            Uma conversa com mais de uma tag vale o <strong>maior</strong> peso entre elas, sem somar. Tag sem peso (campo vazio) usa o peso base do volume.
          </p>
          {tags.length === 0 ? (
            <p className="text-xs text-[var(--text-tertiary)]">Nenhuma tag de conversa cadastrada.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {tags.map(t => (
                <label key={t.id} className="block rounded-xl bg-[var(--surface-pill)] border border-[var(--border-default)] p-3">
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">{t.label}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="usa o base"
                    value={tagTexts[t.id] ?? ''}
                    onChange={e => changeTag(t.id, e.target.value)}
                    aria-invalid={!!invalid[`tag:${t.id}`]}
                    className={cn(
                      'mt-1.5 w-full rounded-lg border bg-[var(--surface-card)] px-3 py-2 font-mono text-sm font-semibold text-[var(--text-primary)] tabular-nums placeholder:font-sans placeholder:font-normal placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40',
                      invalid[`tag:${t.id}`] ? 'border-[var(--text-danger)]' : 'border-[var(--border-strong)]'
                    )}
                  />
                  {invalid[`tag:${t.id}`] && <span className="mt-1 block text-[11px] text-[var(--text-danger)]">Valor inválido</span>}
                </label>
              ))}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="text-xs text-[var(--text-tertiary)]">
            {updatedAt ? `Última alteração: ${new Date(updatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : 'Sem alteração salva ainda.'}
            {dirty && <span className="ml-2 font-semibold text-[var(--accent-text)]">· alterações não salvas</span>}
          </p>
          {message && (
            <p className={cn('text-xs font-semibold', message.kind === 'ok' ? 'text-[var(--text-success)]' : 'text-[var(--text-danger)]')} role="status">
              {message.text}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={restoreDefault}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-card)] px-3 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-pill)]">
              <RotateCcw size={14} aria-hidden /> Restaurar padrão
            </button>
            <button type="button" onClick={save} disabled={!dirty || hasInvalid || saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50">
              <Check size={14} aria-hidden /> {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </footer>
      </section>

      <section aria-labelledby="ranking-history-title" className="rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] shadow-sm p-5">
        <h3 id="ranking-history-title" className="text-sm font-bold text-[var(--text-primary)]">Histórico de alterações</h3>
        <p className="text-xs text-[var(--text-tertiary)] mb-3">Quem mudou cada peso, quando, e o valor antes e depois. Cada mudança afeta o ranking de todo o time.</p>
        {historyError && <p className="text-xs text-[var(--text-danger)]" role="status">{historyError}</p>}
        {!historyError && history === null && <p className="text-xs text-[var(--text-tertiary)]">Carregando…</p>}
        {history && history.length === 0 && <p className="text-xs text-[var(--text-tertiary)]">Nenhuma alteração registrada ainda.</p>}
        {history && history.length > 0 && (
          <ol className="divide-y divide-[var(--border-default)]">
            {history.map(entry => (
              <li key={entry.id} className="py-3 text-sm">
                <p className="text-xs text-[var(--text-tertiary)]">
                  {new Date(entry.quando).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · <span className="font-semibold text-[var(--text-secondary)]">{entry.quem}</span>
                </p>
                {entry.primeiraConfiguracao && entry.alteracoes.length === 0 && (
                  <p className="text-[var(--text-secondary)]">Primeira configuração salva (valores padrão).</p>
                )}
                {entry.alteracoes.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {entry.alteracoes.map(c => (
                      <li key={c.campo} className="text-[var(--text-secondary)] tabular-nums">
                        <span className="font-semibold text-[var(--text-primary)]">{c.rotulo ?? labelOf(c.campo)}:</span>{' '}
                        {formatWeight(c.de)} → {formatWeight(c.para)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

interface HistoryEntry {
  id: string;
  quando: string;
  quem: string;
  acao: string;
  primeiraConfiguracao: boolean;
  alteracoes: { campo: string; rotulo?: string; de: number | null; para: number | null }[];
}

const FIELD_LABELS: Record<string, string> = {
  volume: 'Volume (por conversa)',
  volumeLimit: 'Limite do volume',
  good: 'Good',
  bad: 'Bad',
  lt1: 'Resposta < 1 min',
  lt3: 'Resposta 1 a 3 min',
  gt3: 'Resposta > 3 min',
};

function labelOf(campo: string): string {
  return FIELD_LABELS[campo] ?? campo;
}

// Peso sem valor (tag que não tinha peso, ou foi removido) aparece como "sem peso", nunca "null".
function formatWeight(v: number | null): string {
  if (v === null || v === undefined) return 'sem peso';
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}
