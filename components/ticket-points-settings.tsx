'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Ticket, Check, RotateCcw, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DEFAULT_TICKET_CONFIG, TICKET_CONFIG_FIELDS, TicketConfigValues, normalizeTicketConfig,
} from '@/lib/ticket-points';

// Configurações > Pontuação de Chamados: metas da área e nota (pontos) de cada item avaliado.
// Fica ao lado da Pontuação do Ranking (chat), e usa a mesma permissão (reports:ranking_config).

type Draft = Record<string, string>;

interface HistoryEntry {
  id: string;
  quando: string;
  quem: string;
  primeiraConfiguracao: boolean;
  alteracoes: { campo: string; rotulo: string; de: number | null; para: number | null }[];
}

const chave = (grupo: string, campo: string) => `${grupo}.${campo}`;

function paraDraft(c: TicketConfigValues): Draft {
  const d: Draft = {};
  for (const f of TICKET_CONFIG_FIELDS) d[chave(f.grupo, f.campo)] = String((c[f.grupo] as unknown as Record<string, number>)[f.campo]).replace('.', ',');
  return d;
}

function deDraft(d: Draft): { config: TicketConfigValues; invalidos: Set<string> } {
  const invalidos = new Set<string>();
  const bruto: Record<string, Record<string, number>> = { metas: {}, regras: {}, pontos: {} };
  for (const f of TICKET_CONFIG_FIELDS) {
    const k = chave(f.grupo, f.campo);
    const n = Number((d[k] ?? '').replace(',', '.'));
    if (d[k] === undefined || d[k].trim() === '' || !Number.isFinite(n)) invalidos.add(k);
    bruto[f.grupo][f.campo] = Number.isFinite(n) ? n : 0;
  }
  return { config: normalizeTicketConfig(bruto), invalidos };
}

const formatarQuando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export function TicketPointsSettings() {
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<TicketConfigValues>(DEFAULT_TICKET_CONFIG);
  const [rascunho, setRascunho] = useState<Draft>(paraDraft(DEFAULT_TICKET_CONFIG));
  const [padrao, setPadrao] = useState(true);
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [historico, setHistorico] = useState<HistoryEntry[] | null>(null);
  const [erroHistorico, setErroHistorico] = useState<string | null>(null);

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
        setRascunho(paraDraft(c));
        setPadrao(!!body.isDefault);
        setAtualizadoEm(body.updatedAt ?? null);
      } catch (err: any) {
        if (!cancelado) setErroCarga(err?.message || 'Não foi possível carregar a configuração.');
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();
    return () => { cancelado = true; };
  }, []);

  // O histórico recarrega sempre que a última alteração muda (inclui depois de salvar).
  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch('/api/ticket-points-config?history=1', { cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Falha ao carregar o histórico (HTTP ${res.status}).`);
        if (!cancelado) { setHistorico(body.entries ?? []); setErroHistorico(null); }
      } catch (err: any) {
        if (!cancelado) setErroHistorico(err?.message || 'Não foi possível carregar o histórico.');
      }
    })();
    return () => { cancelado = true; };
  }, [atualizadoEm]);

  const { config: proposta, invalidos } = useMemo(() => deDraft(rascunho), [rascunho]);
  const alterado = useMemo(() => JSON.stringify(proposta) !== JSON.stringify(salvo), [proposta, salvo]);

  async function salvar() {
    setSalvando(true);
    setMensagem(null);
    try {
      const res = await fetch('/api/ticket-points-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: proposta }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Não foi possível salvar (HTTP ${res.status}).`);
      const c = normalizeTicketConfig(body.config);
      setSalvo(c);
      setRascunho(paraDraft(c));
      setPadrao(!!body.isDefault);
      setAtualizadoEm(body.updatedAt ?? null);
      setMensagem({ tipo: 'ok', texto: 'Configuração salva. Vale para a visão de chamados e para a geral.' });
    } catch (err: any) {
      setMensagem({ tipo: 'erro', texto: err?.message || 'Não foi possível salvar.' });
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) {
    return <div className="h-64 animate-pulse rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)]" aria-busy="true" />;
  }
  if (erroCarga) {
    return <div className="rounded-2xl border border-[var(--border-alert)] bg-[var(--surface-warning)] p-5 text-sm text-[var(--text-secondary)]">{erroCarga}</div>;
  }

  const grupos: { id: 'metas' | 'regras' | 'pontos'; titulo: string; descricao: string }[] = [
    { id: 'metas', titulo: 'Metas da área', descricao: 'Os valores que o painel compara com o resultado atual. Cada meta aparece na tabela de objetivos.' },
    { id: 'regras', titulo: 'Regras de cálculo', descricao: 'Quando um chamado vira backlog e quantos chamados um analista precisa ter para entrar no ranking.' },
    { id: 'pontos', titulo: 'Nota de cada item', descricao: 'Pontos por chamado ou por ocorrência. Use valor negativo para desconto.' },
  ];

  return (
    <div className="space-y-6">
      <section aria-labelledby="ticket-points-title" className="rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] shadow-sm p-5 space-y-6">
        <header className="flex flex-wrap items-start gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent-text)]"><Ticket size={18} aria-hidden /></span>
          <div className="min-w-0">
            <h2 id="ticket-points-title" className="text-base font-bold text-[var(--text-primary)]">Pontuação de chamados</h2>
            <p className="text-xs text-[var(--text-tertiary)] mt-0.5">Mudar uma nota altera o ranking de chamados de todo o time. Fica registrado no histórico abaixo.</p>
          </div>
          {padrao && <span className="ml-auto text-[11px] font-semibold text-[var(--text-tertiary)]">valores iniciais, ainda não salvos</span>}
        </header>

        {grupos.map(g => (
          <div key={g.id} className="space-y-3">
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)]">{g.titulo}</h3>
              <p className="text-xs text-[var(--text-tertiary)]">{g.descricao}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {TICKET_CONFIG_FIELDS.filter(f => f.grupo === g.id).map(f => {
                const k = chave(f.grupo, f.campo);
                const invalido = invalidos.has(k);
                return (
                  <label key={k} className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-[var(--text-secondary)]">{f.label}</span>
                    <span className="text-[11px] font-normal text-[var(--text-tertiary)]">{f.referencia}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={rascunho[k] ?? ''}
                      onChange={e => setRascunho(d => ({ ...d, [k]: e.target.value }))}
                      aria-invalid={invalido}
                      className={cn(
                        'rounded-lg border bg-[var(--surface-card)] px-3 py-2 text-sm tabular-nums text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40',
                        invalido ? 'border-[var(--border-alert)]' : 'border-[var(--border-default)]'
                      )}
                    />
                  </label>
                );
              })}
            </div>
          </div>
        ))}

        <footer className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="text-xs text-[var(--text-tertiary)]">
            {atualizadoEm ? `Última alteração: ${formatarQuando(atualizadoEm)}` : 'Sem alteração salva ainda.'}
            {alterado && <span className="ml-2 font-semibold text-[var(--accent-text)]">· alterações não salvas</span>}
          </p>
          {mensagem && (
            <p className={cn('text-xs font-semibold flex items-center gap-1', mensagem.tipo === 'ok' ? 'text-[var(--text-success)]' : 'text-[var(--text-danger)]')} role="status">
              {mensagem.tipo === 'erro' && <AlertTriangle size={13} aria-hidden />}{mensagem.texto}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => setRascunho(paraDraft(DEFAULT_TICKET_CONFIG))}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-card)] px-3 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-pill)]">
              <RotateCcw size={14} aria-hidden /> Restaurar padrão
            </button>
            <button type="button" onClick={salvar} disabled={!alterado || invalidos.size > 0 || salvando}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50">
              <Check size={14} aria-hidden /> {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </footer>
      </section>

      <section aria-labelledby="ticket-history-title" className="rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] shadow-sm p-5">
        <h3 id="ticket-history-title" className="text-sm font-bold text-[var(--text-primary)]">Histórico de alterações</h3>
        <p className="text-xs text-[var(--text-tertiary)] mb-3">Quem mudou cada meta ou nota, quando, e o valor antes e depois.</p>
        {erroHistorico && <p className="text-xs text-[var(--text-danger)]" role="status">{erroHistorico}</p>}
        {!erroHistorico && historico === null && <p className="text-xs text-[var(--text-tertiary)]">Carregando…</p>}
        {historico && historico.length === 0 && <p className="text-xs text-[var(--text-tertiary)]">Nenhuma alteração registrada ainda.</p>}
        {historico && historico.length > 0 && (
          <ol className="divide-y divide-[var(--border-default)]">
            {historico.map(e => (
              <li key={e.id} className="py-3 text-sm">
                <p className="text-xs text-[var(--text-tertiary)]">{formatarQuando(e.quando)} · <span className="font-semibold text-[var(--text-secondary)]">{e.quem}</span></p>
                {e.primeiraConfiguracao && e.alteracoes.length === 0 && <p className="text-[var(--text-secondary)]">Primeira configuração salva (valores iniciais).</p>}
                {e.alteracoes.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {e.alteracoes.map(c => (
                      <li key={c.campo} className="text-[var(--text-secondary)] tabular-nums">
                        <span className="font-semibold text-[var(--text-primary)]">{c.rotulo}:</span>{' '}
                        {c.de === null ? 'sem valor' : c.de.toLocaleString('pt-BR')} → {c.para === null ? 'sem valor' : c.para.toLocaleString('pt-BR')}
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
