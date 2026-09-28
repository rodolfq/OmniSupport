'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Link2, Loader2, Search, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn, maskPhone } from '@/lib/utils';

interface CandidateSession {
  id: string;
  customerName?: string;
  customerPhone?: string;
  channel?: 'whatsapp_baileys' | 'pyvon' | 'widget';
  status: 'pending' | 'active' | 'closed';
  startedAt: string;
  lastMessageAt: string;
  assigneeName?: string;
  messageCount: number;
  companyId: string | null;
  companyName: string | null;
  otherTicketNumber: number | null;
  linkedHere: boolean;
  differentCompany: boolean;
}

interface CandidatesResponse {
  ticket: { id: string; number: number; companyId: string | null; companyName: string | null };
  sessions: CandidateSession[];
}

const CHANNEL_LABEL: Record<string, string> = {
  pyvon: 'WhatsApp (Pyvon)',
  whatsapp_baileys: 'WhatsApp (não oficial)',
  widget: 'Portal (chat)'
};

function formatDateTime(iso?: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * "Vincular conversa" DENTRO do chamado (aba Conversa): associa ao chamado uma
 * conversa do chat que não o gerou — chamado aberto fora de uma conversa, mas
 * relacionado a uma. Sem busca, lista as conversas da empresa do chamado; com
 * busca, qualquer conversa (por nome, empresa, telefone ou nº do chamado).
 *
 * O vínculo é feito por 'link-ticket' (app/api/chat-sessions/route.ts), o mesmo
 * do "Vincular chamado existente" do chat: o servidor confere a permissão
 * (tickets:link_chat) e trava conversa de OUTRA empresa até haver confirmação.
 */
export function LinkSessionToTicketModal({
  isOpen,
  onClose,
  ticketId,
  onLinked
}: {
  isOpen: boolean;
  onClose: () => void;
  ticketId: string;
  onLinked: () => void;
}) {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<CandidatesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  // Conversa de outra empresa aguardando confirmação (in-app, não janela nativa).
  const [confirming, setConfirming] = useState<CandidateSession | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const seqRef = useRef(0);

  // Abertura: limpa o estado, guarda quem tinha o foco (volta pra ele ao fechar)
  // e foca a busca.
  useEffect(() => {
    if (!isOpen) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setData(null);
    setLoadError(null);
    setConfirming(null);
    setLinkingId(null);
    const timer = setTimeout(() => searchRef.current?.focus(), 50);
    return () => {
      clearTimeout(timer);
      openerRef.current?.focus?.();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const seq = ++seqRef.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ action: 'sessions-for-ticket-link', ticketId });
        if (query.trim()) qs.set('q', query.trim());
        const res = await fetch(`/api/chats?${qs.toString()}`);
        const body = await res.json().catch(() => null);
        if (seq !== seqRef.current) return; // resposta de uma busca já obsoleta
        if (!res.ok) throw new Error(body?.error || 'Não foi possível buscar as conversas.');
        setData(body as CandidatesResponse);
        setLoadError(null);
      } catch (e: any) {
        if (seq !== seqRef.current) return;
        setLoadError(e?.message || 'Não foi possível buscar as conversas.');
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [isOpen, ticketId, query]);

  const handleClose = useCallback(() => {
    if (linkingId) return;
    onClose();
  }, [linkingId, onClose]);

  // Esc fecha (com a confirmação aberta, só volta pra lista); Tab fica preso no painel.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        if (confirming && !linkingId) setConfirming(null);
        else handleClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !panelRef.current.contains(active))) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, confirming, linkingId, handleClose]);

  useEffect(() => {
    if (confirming) backRef.current?.focus();
  }, [confirming]);

  const link = async (session: CandidateSession, confirmDifferentCompany: boolean) => {
    setLinkingId(session.id);
    try {
      const res = await fetch('/api/chat-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'link-ticket', sessionId: session.id, ticketId, confirmDifferentCompany })
      });
      const body = await res.json().catch(() => null);
      if (res.status === 409 && body?.code === 'company_mismatch') {
        // O servidor achou empresa diferente mesmo sem a tela ter marcado (ex.: cadastro mudou).
        setConfirming(session);
        return;
      }
      if (!res.ok) throw new Error(body?.error || 'Erro ao vincular a conversa.');
      toast.success(body?.alreadyLinked ? 'Essa conversa já estava vinculada ao chamado.' : 'Conversa vinculada ao chamado.');
      onLinked();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao vincular a conversa.');
    } finally {
      setLinkingId(null);
    }
  };

  const handlePick = (session: CandidateSession) => {
    if (linkingId || session.linkedHere) return;
    if (session.differentCompany) { setConfirming(session); return; }
    link(session, false);
  };

  const sessions = data?.sessions ?? [];
  const ticketLabel = data ? `#${String(data.ticket.number).padStart(4, '0')}` : '';

  // Portal no body: este modal é montado dentro da aba do chamado, que está
  // dentro de elementos com transform (animação) — nesse caso `position: fixed`
  // passa a ser relativo ao ancestral, não à tela. Mesmo motivo do visualizador
  // de conversa do ticket-detail-modal.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="link-session-title"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-[var(--surface-card)] w-full max-w-xl max-h-[88vh] rounded-[2rem] shadow-2xl overflow-hidden border border-[var(--border-default)] flex flex-col"
          >
            <div className="bg-slate-900 px-8 py-6 text-white flex items-start justify-between gap-4 shrink-0">
              <div className="min-w-0">
                <h3 id="link-session-title" className="text-xl font-black tracking-tight">Vincular conversa</h3>
                <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1 truncate">
                  {data ? `Chamado ${ticketLabel} · ${data.ticket.companyName || 'Sem empresa'}` : 'Carregando…'}
                </p>
              </div>
              <button onClick={handleClose} aria-label="Fechar" className="p-2 hover:bg-white/10 rounded-xl transition-colors text-[var(--text-tertiary)] shrink-0">
                <X size={20} />
              </button>
            </div>

            {confirming ? (
              <div className="p-8 space-y-5 overflow-y-auto">
                <div className="flex items-start gap-3 p-4 bg-[var(--surface-warning)] border border-[var(--border-alert)] rounded-2xl">
                  <AlertTriangle size={18} className="text-[var(--text-warning-strong)] shrink-0 mt-0.5" />
                  <div className="space-y-1.5">
                    <p className="text-sm font-black text-[var(--text-warning)]">Conversa de outra empresa</p>
                    <p className="text-xs font-medium text-[var(--text-warning)] leading-relaxed">
                      A conversa com <strong>{confirming.customerName || confirming.customerPhone || 'o contato'}</strong> é de{' '}
                      <strong>{confirming.companyName || 'outra empresa'}</strong>, e este chamado é de{' '}
                      <strong>{data?.ticket.companyName || 'outra empresa'}</strong>. Quem acompanha o chamado passará a poder ler essa conversa.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    ref={backRef}
                    onClick={() => setConfirming(null)}
                    disabled={!!linkingId}
                    className="flex-1 py-3 bg-[var(--surface-card)] border-2 border-[var(--border-default)] text-[var(--text-primary)] rounded-2xl text-[10px] font-semibold uppercase tracking-widest hover:bg-[var(--surface-pill)] transition-all disabled:opacity-60"
                  >
                    Voltar
                  </button>
                  <button
                    onClick={() => link(confirming, true)}
                    disabled={!!linkingId}
                    className="flex-1 py-3 bg-[var(--text-danger)] text-white rounded-2xl text-[10px] font-semibold uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {linkingId === confirming.id && <Loader2 size={14} className="animate-spin" />}
                    Vincular mesmo assim
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-8 space-y-4 overflow-y-auto min-h-0">
                <p className="text-xs font-medium text-[var(--text-tertiary)] leading-relaxed">
                  Quem acompanha este chamado passa a poder ler a conversa (sem as notas internas).
                </p>
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={18} />
                  <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar por nome, empresa, telefone ou nº do chamado..."
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl pl-12 pr-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                  />
                </div>

                <div className="space-y-2">
                  {loading && !data ? (
                    <p className="text-xs text-[var(--text-tertiary)] font-medium text-center py-6 flex items-center justify-center gap-2">
                      <Loader2 size={14} className="animate-spin" /> Buscando conversas...
                    </p>
                  ) : loadError ? (
                    <p className="text-xs text-[var(--text-danger)] font-bold text-center py-6">{loadError}</p>
                  ) : sessions.length === 0 ? (
                    <p className="text-xs text-[var(--text-tertiary)] font-medium text-center py-6 leading-relaxed">
                      {query.trim()
                        ? 'Nenhuma conversa encontrada para essa busca.'
                        : 'Nenhuma conversa desta empresa ainda. Use a busca para achar por nome, telefone ou empresa.'}
                    </p>
                  ) : sessions.map(s => {
                    const disabled = !!linkingId || s.linkedHere;
                    return (
                      <button
                        key={s.id}
                        onClick={() => handlePick(s)}
                        disabled={disabled}
                        className={cn(
                          "w-full text-left p-4 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl transition-all flex items-start justify-between gap-3",
                          disabled ? "opacity-60" : "hover:border-[var(--accent)]/50 hover:bg-[var(--surface-pill)]"
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn(
                              "text-[9px] font-bold uppercase px-2 py-0.5 rounded-full",
                              s.status === 'closed' ? "bg-[var(--surface-pill)] text-[var(--text-tertiary)]" : "bg-[var(--surface-success)] text-[var(--text-success)]"
                            )}>
                              {s.status === 'closed' ? 'Encerrada' : 'Em andamento'}
                            </span>
                            {s.channel && <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">{CHANNEL_LABEL[s.channel] || s.channel}</span>}
                            {s.linkedHere && <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-[var(--surface-info)] text-[var(--text-info)]">Já vinculada a este chamado</span>}
                            {!s.linkedHere && s.otherTicketNumber ? <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-[var(--surface-pill)] text-[var(--text-secondary)]">Chamado #{String(s.otherTicketNumber).padStart(4, '0')}</span> : null}
                            {s.differentCompany && <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-[var(--surface-warning)] text-[var(--text-warning)]">Outra empresa</span>}
                          </div>
                          <p className="text-sm font-bold text-[var(--text-primary)] mt-1 truncate">{s.customerName || 'Contato'}</p>
                          <p className="text-[10px] text-[var(--text-tertiary)] font-medium mt-0.5 truncate">
                            {s.companyName || 'Contato sem empresa cadastrada'}
                            {s.customerPhone ? ` · ${maskPhone(s.customerPhone)}` : ''}
                          </p>
                          <p className="text-[10px] text-[var(--text-tertiary)] font-medium mt-0.5">
                            {formatDateTime(s.startedAt)} · {s.messageCount} mensagem{s.messageCount === 1 ? '' : 's'}{s.assigneeName ? ` · com ${s.assigneeName}` : ''}
                          </p>
                        </div>
                        {linkingId === s.id
                          ? <Loader2 size={16} className="animate-spin text-[var(--accent-text)] shrink-0 mt-1" />
                          : <Link2 size={16} className="text-[var(--accent-text)] shrink-0 mt-1" />}
                      </button>
                    );
                  })}
                </div>
                {loading && data && (
                  <p className="text-[10px] text-[var(--text-tertiary)] font-semibold text-center flex items-center justify-center gap-1.5">
                    <Loader2 size={11} className="animate-spin" /> Atualizando...
                  </p>
                )}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

