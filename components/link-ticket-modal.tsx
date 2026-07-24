'use client';

import React, { useState, useEffect } from 'react';
import { Search, X, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { isClosedTicketStatus } from '@/lib/ticket-status';
import { TicketService } from '@/lib/services/ticket-service';
import { linkChatSessionToTicket } from '@/app/actions';
import { toast } from 'sonner';

// Modal "Vincular Chamado" — busca chamados já existentes da mesma empresa
// e vincula a ESTA conversa (item 11 do roadmap), sem criar nada. Estrutura
// clonada de components/link-contact-modal.tsx (mesmo padrão de busca +
// lista clicável), trocando usuários por chamados.
export function LinkTicketModal({
  isOpen,
  onClose,
  sessionId,
  companyId,
  onSuccess
}: {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string | null;
  companyId?: string;
  onSuccess: (ticketId: string, ticketNumber: number) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      setTickets([]);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !companyId) return;
    setLoading(true);
    const timer = setTimeout(async () => {
      const result = await TicketService.getRecentByCompany(companyId, undefined, 20, searchTerm || undefined);
      setTickets(result);
      setLoading(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [isOpen, companyId, searchTerm]);

  const handleLink = async (ticket: any) => {
    if (!sessionId) return;
    setLinkingId(ticket.id);
    try {
      const result = await linkChatSessionToTicket(sessionId, ticket.id);
      if ('error' in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Chamado #${String(result.ticketNumber).padStart(4, '0')} vinculado a esta conversa.`);
      onSuccess(result.ticketId, result.ticketNumber);
      onClose();
    } catch (err) {
      console.error('Erro ao vincular chamado:', err);
      toast.error('Erro ao vincular chamado.');
    } finally {
      setLinkingId(null);
    }
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
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-[var(--surface-card)] w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden border border-[var(--border-default)]"
          >
            <div className="bg-slate-900 px-8 py-6 text-white flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black tracking-tight">Vincular Chamado</h3>
                <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">
                  Busca por número ou título, da mesma empresa
                </p>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors text-[var(--text-tertiary)]">
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-4">
              {!companyId ? (
                <p className="text-xs text-[var(--text-tertiary)] italic text-center py-4">
                  Esta conversa não tem uma empresa vinculada — associe um contato antes de buscar chamados.
                </p>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={18} />
                    <input
                      type="text"
                      placeholder="Buscar por número ou título..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl pl-12 pr-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                    />
                  </div>

                  <div className="max-h-72 overflow-y-auto space-y-2 pr-2">
                    {loading ? (
                      <p className="text-xs text-[var(--text-tertiary)] text-center py-4">Buscando...</p>
                    ) : tickets.length === 0 ? (
                      <p className="text-xs text-[var(--text-tertiary)] italic text-center py-4">Nenhum chamado encontrado.</p>
                    ) : (
                      tickets.map(t => (
                        <button
                          key={t.id}
                          onClick={() => handleLink(t)}
                          disabled={linkingId === t.id}
                          className="w-full flex items-center justify-between gap-3 p-3 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 transition-all group text-left disabled:opacity-50"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[10px] font-black text-[var(--accent-text)] bg-[var(--accent)]/10 px-2 py-0.5 rounded tracking-widest shrink-0">
                                #{String(t.ticketNumber ?? '').padStart(4, '0')}
                              </span>
                              <span className={cn(
                                "text-[9px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full shrink-0",
                                isClosedTicketStatus(t.status) ? "bg-[var(--surface-success)] text-[var(--text-success)]" : "bg-[var(--surface-info)] text-[var(--text-info)]"
                              )}>
                                {t.status}
                              </span>
                            </div>
                            <p className="text-xs font-bold text-[var(--text-secondary)] truncate">{t.title}</p>
                            {t.chatSessionId && (
                              <p className="text-[9px] text-[var(--text-tertiary)] font-medium mt-0.5">Já vinculado a outra conversa</p>
                            )}
                          </div>
                          <Check size={16} className="text-[var(--accent-text)] opacity-0 group-hover:opacity-100 shrink-0" />
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
