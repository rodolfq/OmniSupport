'use client';

import React, { useEffect, useState } from 'react';
import { Check, AlertTriangle, Ticket, Flag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEFAULT_TICKET_CONFIG, TicketConfigValues, normalizeTicketConfig } from '@/lib/ticket-points';

// Configurações > Pontuação do Ranking > Ticket interno.
// Regra de 2 dias: ticket com estrelas (prioridade) a partir do mínimo que não virar "Resolvido" dentro
// dos dias úteis configurados é sinalizado no relatório de tickets internos. Sem pontuação.

interface HistoryEntry {
  id: string;
  quando: string;
  quem: string;
  alteracoes: { campo: string; rotulo: string; de: number | null; para: number | null }[];
}

const OPCOES_ESTRELAS = [
  { value: 1, label: '1 estrela ou mais' },
  { value: 2, label: '2 estrelas ou mais (padrão)' },
  { value: 3, label: '3 estrelas ou mais' },
  { value: 4, label: 'Somente 4 estrelas' },
];

const formatarQuando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export function InternalRuleSettings({ podeEditar }: { podeEditar: boolean }) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<TicketConfigValues>(DEFAULT_TICKET_CONFIG);
  const [estrelas, setEstrelas] = useState(DEFAULT_TICKET_CONFIG.interno.estrelasMinimas);
  const [dias, setDias] = useState(String(DEFAULT_TICKET_CONFIG.interno.diasUteis));
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [historico, setHistorico] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch('/api/ticket-points-config', { cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Falha ao carregar (HTTP ${res.status}).`);
        if (cancelado) return;
        const c = normalizeTicketConfig(body.config);
        setSalvo(c);
        setEstrelas(c.interno.estrelasMinimas);
        setDias(String(c.interno.diasUteis));
        const h = await fetch('/api/ticket-points-config?history=1', { cache: 'no-store' });
        const hb = await h.json().catch(() => ({}));
        if (!cancelado && h.ok) {
          setHistorico((hb.entries ?? []).filter((e: any) => e.alteracoes.some((a: any) => a.campo.startsWith('interno.'))));
        }
      } catch (err: any) {
        if (!cancelado) setErro(err?.message || 'Não foi possível carregar a regra.');
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();
    return () => { cancelado = true; };
  }, []);

  const diasNumero = Number(dias);
  const diasValido = dias.trim() !== '' && Number.isInteger(diasNumero) && diasNumero >= 0;
  const alterado = estrelas !== salvo.interno.estrelasMinimas || (diasValido && diasNumero !== salvo.interno.diasUteis);

  async function salvar() {
    if (!diasValido) return;
    setSalvando(true);
    setMensagem(null);
    try {
      // Só a regra do ticket interno é enviada. O servidor mantém o resto como está.
      const proposta = { ...salvo, interno: { estrelasMinimas: estrelas, diasUteis: diasNumero } };
      const res = await fetch('/api/ticket-points-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: proposta }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Não foi possível salvar (HTTP ${res.status}).`);
      const c = normalizeTicketConfig(body.config);
      setSalvo(c);
      setEstrelas(c.interno.estrelasMinimas);
      setDias(String(c.interno.diasUteis));
      setMensagem({ tipo: 'ok', texto: 'Regra salva. Vale para o relatório de tickets internos.' });
    } catch (err: any) {
      setMensagem({ tipo: 'erro', texto: err?.message || 'Não foi possível salvar.' });
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) {
    return <div className="h-48 animate-pulse rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)]" aria-busy="true" />;
  }
  if (erro) {
    return <div className="rounded-2xl border border-[var(--border-alert)] bg-[var(--surface-warning)] p-5 text-sm text-[var(--text-secondary)]">{erro}</div>;
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="internal-rule-title" className="rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] shadow-sm p-5 space-y-5">
        <header className="flex items-start gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent-text)]"><Ticket size={18} aria-hidden /></span>
          <div className="min-w-0">
            <h2 id="internal-rule-title" className="text-base font-bold text-[var(--text-primary)]">Regra de 2 dias do ticket interno</h2>
            <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
              Ticket com estrelas acima do mínimo que não vira <strong>Resolvido</strong> dentro do prazo entra na lista de atenção do relatório. Não gera pontos.
            </p>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">Estrelas mínimas</span>
            <span className="text-[11px] text-[var(--text-tertiary)]">Tickets com prioridade a partir deste valor entram na regra.</span>
            <select
              value={estrelas}
              onChange={e => setEstrelas(Number(e.target.value))}
              disabled={!podeEditar}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] disabled:opacity-60"
            >
              {OPCOES_ESTRELAS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">Dias úteis até Resolvido</span>
            <span className="text-[11px] text-[var(--text-tertiary)]">Contados em horário comercial (seg a sex, 8h às 18h).</span>
            <input
              type="text"
              inputMode="numeric"
              value={dias}
              onChange={e => setDias(e.target.value)}
              disabled={!podeEditar}
              aria-invalid={!diasValido}
              className={cn(
                'rounded-lg border bg-[var(--surface-card)] px-3 py-2 text-sm tabular-nums text-[var(--text-primary)] disabled:opacity-60',
                diasValido ? 'border-[var(--border-default)]' : 'border-[var(--border-alert)]'
              )}
            />
          </label>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="text-xs text-[var(--text-tertiary)]">
            {!podeEditar && 'Você pode ver esta regra, mas não alterá-la.'}
            {podeEditar && alterado && <span className="font-semibold text-[var(--accent-text)]">alterações não salvas</span>}
          </p>
          {mensagem && (
            <p className={cn('text-xs font-semibold flex items-center gap-1', mensagem.tipo === 'ok' ? 'text-[var(--text-success)]' : 'text-[var(--text-danger)]')} role="status">
              {mensagem.tipo === 'erro' && <AlertTriangle size={13} aria-hidden />}{mensagem.texto}
            </p>
          )}
          {podeEditar && (
            <button type="button" onClick={salvar} disabled={!alterado || !diasValido || salvando}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50">
              <Check size={14} aria-hidden /> {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          )}
        </footer>
      </section>

      <section aria-labelledby="internal-history-title" className="rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] shadow-sm p-5">
        <h3 id="internal-history-title" className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]"><Flag size={14} aria-hidden /> Histórico desta regra</h3>
        {historico.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--text-tertiary)]">Nenhuma alteração desta regra registrada ainda.</p>
        ) : (
          <ol className="mt-3 divide-y divide-[var(--border-default)]">
            {historico.map(e => (
              <li key={e.id} className="py-2 text-sm">
                <p className="text-xs text-[var(--text-tertiary)]">{formatarQuando(e.quando)} · <span className="font-semibold text-[var(--text-secondary)]">{e.quem}</span></p>
                {e.alteracoes.filter(a => a.campo.startsWith('interno.')).map(a => (
                  <p key={a.campo} className="text-[var(--text-secondary)] tabular-nums">
                    <span className="font-semibold text-[var(--text-primary)]">{a.rotulo}:</span> {a.de ?? 'sem valor'} → {a.para ?? 'sem valor'}
                  </p>
                ))}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
