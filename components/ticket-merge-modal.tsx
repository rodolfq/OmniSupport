'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GitMerge, Search, X, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mergeTickets } from '@/lib/services/chat-session-actions';
import { toast } from 'sonner';

// Mesclar ESTE chamado dentro de outro escolhido. O chamado atual vira "Mesclado" e sai das
// métricas; o chamado de destino continua e recebe o registro da mesclagem. Mesma regra do servidor
// (rota merge-tickets). Só aceita destino da mesma empresa, para não juntar clientes diferentes.

interface MergeCandidate {
  id: string;
  ticketNumber: number | null;
  title: string;
  status: string;
  companyId: string | null;
}

interface TicketMergeModalProps {
  source: { id: string; ticketNumber: number | null; title: string; companyId: string | null };
  onClose: () => void;
  onMerged: (targetId: string) => void;
  beforeMerge?: () => Promise<void> | void;
}

const labelNumero = (n: number | null, id: string) => (n ? `#${String(n).padStart(4, '0')}` : id.slice(0, 8));

export function TicketMergeModal({ source, onClose, onMerged, beforeMerge }: TicketMergeModalProps) {
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<MergeCandidate[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState<string | null>(null);
  const [escolhido, setEscolhido] = useState<MergeCandidate | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [mesclando, setMesclando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [montado, setMontado] = useState(false);

  useEffect(() => { setMontado(true); inputRef.current?.focus(); }, []);

  // Esc fecha; quando há confirmação aberta, Esc só volta para a escolha.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || mesclando) return;
      e.stopPropagation();
      if (confirmando) setConfirmando(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [confirmando, mesclando, onClose]);

  // Busca com pequeno atraso, para não consultar a cada tecla.
  useEffect(() => {
    const t = termo.trim();
    if (t.length < 2) { setResultados([]); setErroBusca(null); return; }
    let cancelado = false;
    setBuscando(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ action: 'tickets', query: t, pageSize: '20' });
        if (source.companyId) params.set('companyId', source.companyId);
        params.set('includeClosed', 'true');
        const res = await fetch(`/api/search?${params.toString()}`, { cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Falha na busca.');
        if (cancelado) return;
        const lista: MergeCandidate[] = (body.tickets ?? [])
          .filter((x: any) => x.id !== source.id && x.status !== 'Mesclado' && !x.mergedIntoId)
          .map((x: any) => ({ id: x.id, ticketNumber: x.ticketNumber ?? null, title: x.title, status: x.status, companyId: x.companyId ?? null }));
        setResultados(lista);
        setErroBusca(null);
      } catch (err: any) {
        if (!cancelado) setErroBusca(err?.message || 'Não foi possível buscar.');
      } finally {
        if (!cancelado) setBuscando(false);
      }
    }, 300);
    return () => { cancelado = true; clearTimeout(timer); };
  }, [termo, source.id, source.companyId]);

  async function confirmarMesclagem() {
    if (!escolhido || mesclando) return;
    setMesclando(true);
    try {
      if (beforeMerge) await beforeMerge();
      const result = await mergeTickets([source.id], escolhido.id);
      if (result && 'error' in result) throw new Error(result.error);
      toast.success(`Chamado ${labelNumero(source.ticketNumber, source.id)} mesclado em ${labelNumero(escolhido.ticketNumber, escolhido.id)}.`);
      onMerged(escolhido.id);
    } catch (err: any) {
      toast.error('Erro ao mesclar: ' + (err?.message || 'tente de novo.'));
    } finally {
      setMesclando(false);
    }
  }

  if (!montado) return null;

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="merge-title">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => { if (!mesclando) onClose(); }} />
      <div className="relative w-full max-w-lg rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] shadow-2xl p-6 space-y-4">
        <header className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent-text)]"><GitMerge size={18} aria-hidden /></span>
            <div className="min-w-0">
              <h2 id="merge-title" className="text-base font-bold text-[var(--text-primary)]">Mesclar chamado {labelNumero(source.ticketNumber, source.id)}</h2>
              <p className="text-xs text-[var(--text-tertiary)] truncate">{source.title}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={mesclando} aria-label="Fechar" className="p-1.5 rounded-lg hover:bg-[var(--surface-pill)] text-[var(--text-tertiary)] disabled:opacity-50">
            <X size={16} aria-hidden />
          </button>
        </header>

        {!confirmando ? (
          <>
            <label className="block">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Mesclar no chamado de destino</span>
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2">
                <Search size={14} className="text-[var(--text-tertiary)]" aria-hidden />
                <input
                  ref={inputRef}
                  value={termo}
                  onChange={e => setTermo(e.target.value)}
                  placeholder="Número (ex.: 3394) ou parte do título"
                  className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                />
                {buscando && <Loader2 size={14} className="animate-spin text-[var(--text-tertiary)]" aria-hidden />}
              </div>
            </label>
            <p className="text-[11px] text-[var(--text-tertiary)]">Mostra só chamados da mesma empresa deste.</p>

            {erroBusca && <p className="text-xs text-[var(--text-danger)]" role="status">{erroBusca}</p>}

            <ul className="max-h-64 overflow-y-auto divide-y divide-[var(--border-default)] rounded-xl border border-[var(--border-default)]" aria-label="Chamados de destino">
              {termo.trim().length < 2 && <li className="p-3 text-xs text-[var(--text-tertiary)]">Digite pelo menos 2 caracteres.</li>}
              {termo.trim().length >= 2 && !buscando && resultados.length === 0 && !erroBusca && (
                <li className="p-3 text-xs text-[var(--text-tertiary)]">Nenhum chamado encontrado.</li>
              )}
              {resultados.map(r => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => { setEscolhido(r); setConfirmando(true); }}
                    className={cn('w-full text-left px-3 py-2.5 hover:bg-[var(--surface-pill)] transition-colors', escolhido?.id === r.id && 'bg-[var(--surface-pill)]')}
                  >
                    <span className="text-xs font-bold text-[var(--accent-text)] tabular-nums">{labelNumero(r.ticketNumber, r.id)}</span>
                    <span className="ml-2 text-sm text-[var(--text-primary)]">{r.title}</span>
                    <span className="block text-[11px] text-[var(--text-tertiary)]">{r.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--border-alert)] bg-[var(--surface-warning)] p-4 text-sm text-[var(--text-secondary)] space-y-2">
              <p className="flex items-center gap-2 font-bold text-[var(--text-primary)]"><AlertTriangle size={15} aria-hidden /> Confirmar a mesclagem?</p>
              <p>
                O chamado <strong>{labelNumero(source.ticketNumber, source.id)}</strong> vai para o status <strong>Mesclado</strong> e sai das métricas.
                As mensagens dele continuam no histórico. O chamado de destino <strong>{labelNumero(escolhido?.ticketNumber ?? null, escolhido?.id ?? '')}</strong> recebe a nota da mesclagem.
              </p>
              <p className="text-xs">Esta ação não é desfeita pela tela.</p>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmando(false)} disabled={mesclando}
                className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface-card)] px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] disabled:opacity-50">
                Voltar
              </button>
              <button type="button" onClick={confirmarMesclagem} disabled={mesclando}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--text-danger)] px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">
                {mesclando && <Loader2 size={14} className="animate-spin" aria-hidden />} Mesclar chamados
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
