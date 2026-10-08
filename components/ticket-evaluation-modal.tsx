'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ThumbsUp, ThumbsDown, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useEscapeToClose } from '@/hooks/use-escape-to-close';

// Avaliação do CHAMADO pelo cliente (Bom/Ruim + comentário opcional), depois
// de Concluído — distinta da pesquisa de satisfação da conversa de WhatsApp
// (essa é por fora, pelo próprio canal). Pedido do usuário, 2026-10-07.
// Uma por chamado, somente-inserção: uma vez enviada, não tem como editar
// nem excluir (nem esta tela oferece isso — é regra do banco também).

interface TicketEvaluationModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticket: { id: string; ticketNumber?: number; title: string } | null;
  onSubmitted: () => void;
}

export function TicketEvaluationModal({ isOpen, onClose, ticket, onSubmitted }: TicketEvaluationModalProps) {
  const [rating, setRating] = useState<'good' | 'bad' | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEscapeToClose(isOpen, onClose);

  if (!isOpen || !ticket) return null;

  const handleClose = () => {
    if (submitting) return;
    setRating(null);
    setComment('');
    onClose();
  };

  const handleSubmit = async () => {
    if (!rating || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit-evaluation', ticketId: ticket.id, rating, comment: comment.trim() })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Não foi possível enviar a avaliação.');
      toast.success('Avaliação enviada. Obrigado pelo retorno!');
      setRating(null);
      setComment('');
      onSubmitted();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Não foi possível enviar a avaliação.');
    } finally {
      setSubmitting(false);
    }
  };

  const numero = ticket.ticketNumber ? `#${String(ticket.ticketNumber).padStart(4, '0')}` : '';

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={handleClose}
          className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        />
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 16 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 16 }}
          className="relative bg-[var(--surface-card)] w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden"
        >
          <div className="p-6 border-b border-[var(--border-default)] flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-black text-[var(--text-primary)]">Avaliar chamado {numero}</h3>
              <p className="text-xs text-[var(--text-tertiary)] mt-0.5 truncate max-w-[260px]">{ticket.title}</p>
            </div>
            <button onClick={handleClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors shrink-0">
              <X size={20} />
            </button>
          </div>

          <div className="p-6 space-y-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] mb-2">Como foi o atendimento deste chamado?</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setRating('good')}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-2xl border-2 py-5 transition-all',
                    rating === 'good'
                      ? 'border-[var(--text-success)] bg-[var(--surface-success)] text-[var(--text-success)]'
                      : 'border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-[var(--text-success)]/50'
                  )}
                >
                  <ThumbsUp size={28} />
                  <span className="text-xs font-black uppercase tracking-widest">Bom</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRating('bad')}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-2xl border-2 py-5 transition-all',
                    rating === 'bad'
                      ? 'border-[var(--text-danger)] bg-[var(--surface-danger)] text-[var(--text-danger)]'
                      : 'border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-[var(--text-danger)]/50'
                  )}
                >
                  <ThumbsDown size={28} />
                  <span className="text-xs font-black uppercase tracking-widest">Ruim</span>
                </button>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">Comentário (opcional)</label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="Conte como foi, se quiser."
                className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none resize-none"
              />
            </div>

            <p className="text-[10px] text-[var(--text-tertiary)]">
              A avaliação não pode ser alterada nem apagada depois de enviada.
            </p>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!rating || submitting}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-bold text-sm py-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              Enviar avaliação
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
