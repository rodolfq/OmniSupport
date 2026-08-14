'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Mail, CheckCircle2, ArrowRight, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { UserAvatar } from '@/components/user-avatar';
import { StyledSelect } from '@/components/styled-select';
import { GIRO_SERVICE_TYPES, GiroRow, GiroServiceType } from '@/lib/types';
import { getGiroSummary, updateGiroRow, completeGiroService, GiroSummary } from '@/lib/services/giro-client';

/**
 * Status do Giro em um painel flutuante, no mesmo formato das mensagens
 * fixadas do chat interno: o ref envolve o botão E o painel, para o clique no
 * próprio botão não contar como "clique fora" e fechar no mesmo evento em que
 * abriria.
 *
 * A carga é sob demanda, ao abrir — de propósito. Um polling de fundo em duas
 * telas que já atualizam sozinhas (Chamados e Dashboard) custaria uma consulta
 * por usuário a cada intervalo para uma informação que só interessa enquanto o
 * painel está aberto.
 */
export function GiroStatusPopover() {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<GiroSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Concluir não é mais um clique só: o botão de check abre este painel pra
  // definir tipo + observação ANTES de gravar no histórico e pular a vez —
  // clicar "Concluir" direto gravava com o que já estivesse na linha (quase
  // sempre em branco), sem chance de anotar o que de fato aconteceu.
  const [completingRow, setCompletingRow] = useState<GiroRow | null>(null);
  const [draftType, setDraftType] = useState<GiroServiceType>('Chamado');
  const [draftNote, setDraftNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getGiroSummary();
    if ('error' in result) {
      toast.error(result.error);
      setLoading(false);
      return;
    }
    setSummary(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    load();

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open, load]);

  // Fechar o popover encerra qualquer conclusão em andamento — reabrir depois
  // não deve ressuscitar um rascunho de observação de uma sessão anterior.
  useEffect(() => {
    if (!open) setCompletingRow(null);
  }, [open]);

  const openCompleteFor = (row: GiroRow) => {
    setCompletingRow(row);
    setDraftType(row.serviceType);
    setDraftNote(row.note ?? '');
  };

  const confirmComplete = async () => {
    if (!completingRow) return;
    setBusy(true);
    // Só grava a linha de novo se algo mudou — evita um PATCH à toa quando o
    // usuário só confere o que já estava lá e confirma direto.
    if (draftType !== completingRow.serviceType || draftNote !== (completingRow.note ?? '')) {
      const saved = await updateGiroRow(completingRow.id, { serviceType: draftType, note: draftNote || null });
      if (saved.error) {
        toast.error(saved.error);
        setBusy(false);
        return;
      }
    }
    const result = await completeGiroService(completingRow.id);
    if (result.error) {
      toast.error(result.error);
      setBusy(false);
      return;
    }
    toast.success(`Atendimento de ${completingRow.userName} concluído.`);
    setCompletingRow(null);
    await load();
    setBusy(false);
  };

  const current = summary?.current ?? null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all',
          open
            ? 'bg-[var(--accent)]/10 border-[var(--accent)]/30 text-[var(--accent-text)]'
            : 'bg-[var(--surface-pill)] border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:border-[var(--accent)]/30'
        )}
        title="Giro de Atendimento — quem está na vez"
      >
        <RefreshCw size={14} className={cn(open && 'text-[var(--accent-text)]')} />
        <span className="hidden lg:inline">Giro</span>
        {current && (
          <span className="hidden xl:inline text-[var(--text-primary)] normal-case tracking-tight font-bold max-w-[120px] truncate">
            {current.userName}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -8 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-3 w-[420px] max-w-[calc(100vw-3rem)] bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-2xl z-[200] overflow-hidden origin-top-right"
          >
            <div className="px-5 py-4 border-b border-[var(--border-default)] flex items-center gap-2">
              <RefreshCw size={15} className="text-[var(--accent-text)]" />
              <h3 className="text-sm font-black text-[var(--text-primary)] tracking-tight">Giro de Atendimento</h3>
              {summary?.handoffName && (
                <span className="ml-auto flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-[var(--accent-text)]" title="Responsável pela passagem de turno por e-mail">
                  <Mail size={10} />
                  {summary.handoffName}
                </span>
              )}
            </div>

            {loading && !summary ? (
              <div className="flex items-center justify-center py-12 text-[var(--text-tertiary)]">
                <Loader2 className="animate-spin mr-2" size={16} /> Carregando...
              </div>
            ) : !summary?.exists || summary.rows.length === 0 ? (
              <div className="px-6 py-10 text-center space-y-2">
                <p className="text-xs font-black uppercase tracking-tight text-[var(--text-secondary)]">Nenhum Giro hoje</p>
                <p className="text-[11px] font-medium text-[var(--text-tertiary)]">
                  Ainda não há participantes cadastrados no rodízio.
                </p>
              </div>
            ) : (
              <>
                {/* na vez — o check abre o painel de observação (abaixo) em vez
                    de concluir na hora: o quadro é compartilhado, qualquer um
                    pode marcar o atendimento de qualquer analista. */}
                <div className="px-5 py-4 bg-[var(--accent)]/5 border-b border-[var(--border-default)] flex items-center gap-3">
                  <span className="w-9 h-9 rounded-xl bg-[var(--accent)] text-white flex items-center justify-center text-sm font-black shrink-0">
                    1
                  </span>
                  <UserAvatar name={current?.userName} thumbUrl={current?.avatarThumbUrl} url={current?.avatarUrl} size={32} />
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)] flex items-center gap-1.5">
                      Na vez agora
                      {current?.id === summary?.myRowId && <span className="text-[var(--accent-text)]">· você</span>}
                    </p>
                    <p className="text-sm font-black text-[var(--text-primary)] truncate">{current?.userName}</p>
                  </div>
                  {current && current.serviceType !== 'Chamado' && (
                    <span className="px-2.5 py-1 rounded-lg bg-[var(--surface-warning)] text-[var(--text-warning)] text-[9px] font-black uppercase tracking-widest shrink-0">
                      {current.serviceType}
                    </span>
                  )}
                  {current && (
                    <button
                      onClick={() => openCompleteFor(current)}
                      disabled={busy}
                      className={cn(
                        'ml-auto p-2 rounded-xl transition-all disabled:opacity-50 shrink-0',
                        completingRow?.id === current.id
                          ? 'bg-[var(--text-success)]/20 text-[var(--text-success)]'
                          : 'bg-[var(--text-success)]/10 text-[var(--text-success)] hover:bg-[var(--text-success)]/20'
                      )}
                      title="Concluir este atendimento"
                    >
                      <CheckCircle2 size={16} />
                    </button>
                  )}
                </div>

                {/* fila do dia */}
                <div className="max-h-[220px] overflow-y-auto p-2.5 space-y-1.5">
                  {summary.rows.slice(1).map(row => (
                    <div key={row.id} className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[var(--surface-pill)]/60 transition-colors group">
                      <span className="w-6 text-center text-[10px] font-black tabular-nums text-[var(--text-tertiary)] shrink-0">
                        {row.position}
                      </span>
                      <UserAvatar name={row.userName} thumbUrl={row.avatarThumbUrl} url={row.avatarUrl} size={22} />
                      <span className="text-xs font-bold text-[var(--text-secondary)] truncate">{row.userName}</span>
                      {row.id === summary?.myRowId && (
                        <span className="text-[8px] font-black uppercase tracking-widest text-[var(--accent-text)] shrink-0">você</span>
                      )}
                      {row.isHandoff && (
                        <span title="Responsável pela passagem de turno por e-mail" className="shrink-0">
                          <Mail size={11} className="text-[var(--accent-text)]" />
                        </span>
                      )}
                      {row.serviceType !== 'Chamado' && (
                        <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)] shrink-0">
                          {row.serviceType}
                        </span>
                      )}
                      <button
                        onClick={() => openCompleteFor(row)}
                        disabled={busy}
                        className={cn(
                          'ml-auto p-1.5 rounded-lg transition-all disabled:opacity-50 shrink-0',
                          completingRow?.id === row.id
                            ? 'opacity-100 text-[var(--text-success)] bg-[var(--text-success)]/10'
                            : 'opacity-50 group-hover:opacity-100 text-[var(--text-tertiary)] hover:text-[var(--text-success)] hover:bg-[var(--text-success)]/10'
                        )}
                        title="Concluir este atendimento"
                      >
                        <CheckCircle2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>

                {/* já atenderam */}
                {summary.history.length > 0 && (
                  <div className="px-5 py-3 border-t border-[var(--border-default)] bg-[var(--surface-pill)]/30">
                    <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)] mb-2">
                      Já atenderam hoje · {summary.history.length}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {summary.history.slice(-8).map(entry => (
                        <span
                          key={entry.id}
                          className="px-2 py-1 rounded-lg bg-[var(--surface-card)] border border-[var(--border-default)] text-[9px] font-bold text-[var(--text-secondary)]"
                          title={entry.note || undefined}
                        >
                          <span className="tabular-nums text-[var(--text-tertiary)]">{entry.serviceTime || '--:--'}</span> {entry.userName}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* painel de conclusão — só aparece com uma linha selecionada
                    pelo check acima. É aqui que a observação é definida
                    ANTES do sistema gravar o histórico e pular a vez. */}
                {completingRow && (
                  <div className="px-5 py-4 border-t border-[var(--border-default)] bg-[var(--text-success)]/5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)] flex items-center gap-1.5">
                        <CheckCircle2 size={11} className="text-[var(--text-success)]" />
                        Concluindo atendimento de <span className="text-[var(--text-primary)] normal-case">{completingRow.userName}</span>
                      </p>
                      <button
                        onClick={() => setCompletingRow(null)}
                        disabled={busy}
                        className="p-1 rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] transition-all disabled:opacity-50 shrink-0"
                        title="Cancelar"
                      >
                        <X size={13} />
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <div className="w-[130px] shrink-0">
                        <StyledSelect
                          value={draftType}
                          disabled={busy}
                          onChange={e => setDraftType(e.target.value as GiroServiceType)}
                          className="text-[10px] font-black uppercase tracking-widest"
                        >
                          {GIRO_SERVICE_TYPES.map(type => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </StyledSelect>
                      </div>
                      <input
                        value={draftNote}
                        disabled={busy}
                        onChange={e => setDraftNote(e.target.value)}
                        placeholder="Observação..."
                        autoFocus
                        onKeyDown={e => { if (e.key === 'Enter') confirmComplete(); }}
                        className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-page)] text-xs font-medium text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-60"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setCompletingRow(null)}
                        disabled={busy}
                        className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-default)] text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] transition-all disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={confirmComplete}
                        disabled={busy}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--text-success)]/10 text-[var(--text-success)] hover:bg-[var(--text-success)]/20 transition-all text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Concluir
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            <Link
              href="/giro"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1.5 px-5 py-3 border-t border-[var(--border-default)] text-[10px] font-black uppercase tracking-widest text-[var(--accent-text)] hover:bg-[var(--accent)]/5 transition-colors"
            >
              Abrir o Giro completo <ArrowRight size={12} />
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
