'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, History, ChevronRight, Loader2, ThumbsUp, ThumbsDown, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ClientTime } from '@/components/client-time';
import { getPreviousChatHistories, fetchSessionMessages, PreviousChatHistoriesResult, ActiveSessionInfo } from '@/lib/services/chat-service';
import { ChatMessage } from '@/lib/types';

interface ContactConversationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  phone: string;
  contactName?: string | null;
  activeSession: ActiveSessionInfo | null;
  onOpenActiveSession: (sessionId: string) => void;
}

// "Ver conversas" do painel de contato (ver components/phone-contact-panel.tsx)
// — lista atendimentos ENCERRADOS (chat_histories, mesmo endpoint de
// "Carregar histórico anterior" em chat-widget.tsx) desse telefone, mais a
// conversa ATIVA no topo se existir uma. Expandir um item carrega a
// transcrição sob demanda (fetchSessionMessages) — mesmo padrão já usado
// dentro do próprio chat, só que numa tela dedicada, sem precisar abrir a
// conversa primeiro.
export function ContactConversationsModal({ isOpen, onClose, phone, contactName, activeSession, onOpenActiveSession }: ContactConversationsModalProps) {
  const [histories, setHistories] = useState<PreviousChatHistoriesResult['histories']>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [messagesById, setMessagesById] = useState<Record<string, ChatMessage[]>>({});
  const [loadingMessagesId, setLoadingMessagesId] = useState<string | null>(null);

  const loadMore = async (fromOffset: number) => {
    setLoading(true);
    try {
      const result = await getPreviousChatHistories({ customerPhone: phone, limit: 10, offset: fromOffset });
      setHistories(prev => fromOffset === 0 ? result.histories : [...prev, ...result.histories]);
      setOffset(fromOffset + result.histories.length);
      setTotal(result.total);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setHistories([]);
    setOffset(0);
    setTotal(0);
    setExpandedId(null);
    setMessagesById({});
    loadMore(0);
  }, [isOpen, phone]);

  const toggleExpand = async (sessionId: string) => {
    if (expandedId === sessionId) { setExpandedId(null); return; }
    setExpandedId(sessionId);
    if (messagesById[sessionId] || loadingMessagesId === sessionId) return;
    setLoadingMessagesId(sessionId);
    try {
      const result = await fetchSessionMessages(sessionId);
      setMessagesById(prev => ({ ...prev, [sessionId]: result.messages }));
    } catch {
      setExpandedId(null);
    } finally {
      setLoadingMessagesId(null);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[260] flex items-center justify-center p-4">
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
            className="relative bg-[var(--surface-card)] w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-[var(--border-default)] flex flex-col max-h-[85vh]"
          >
            <div className="bg-slate-900 px-8 py-6 text-white flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-xl font-black tracking-tight m-0">Conversas{contactName ? ` de ${contactName}` : ''}</h3>
                <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">{phone}</p>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors text-[var(--text-tertiary)] hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {activeSession && (
                <button
                  onClick={() => onOpenActiveSession(activeSession.id)}
                  className="w-full flex items-center justify-between gap-3 p-4 rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/10 hover:bg-[var(--accent)]/15 transition-all text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-[var(--accent)] flex items-center justify-center text-white shrink-0">
                      <MessageCircle size={16} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-black text-[var(--text-primary)]">Conversa em andamento</p>
                      <p className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-tighter truncate">
                        {activeSession.assigneeName ? `Com ${activeSession.assigneeName}` : 'Sem responsável'} · <ClientTime date={activeSession.lastMessageAt} showDate showTime />
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-[var(--accent-text)] shrink-0" />
                </button>
              )}

              {histories.length === 0 && !loading && !activeSession && (
                <p className="text-sm text-[var(--text-tertiary)] italic text-center py-8">Nenhuma conversa encontrada com esse número.</p>
              )}

              {histories.map((h) => {
                const isExpanded = expandedId === h.sessionId;
                const isLoadingThis = loadingMessagesId === h.sessionId;
                const loadedMessages = messagesById[h.sessionId] || [];
                const durationLabel = h.durationSeconds != null
                  ? `${Math.floor(h.durationSeconds / 60)}m ${h.durationSeconds % 60}s`
                  : null;
                return (
                  <div key={h.id} className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleExpand(h.sessionId)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--surface-pill)] transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0 text-xs font-semibold text-[var(--text-secondary)]">
                        <History size={14} className="text-[var(--text-tertiary)] shrink-0" />
                        <span className="truncate">
                          Atendimento <ClientTime date={h.finishedAt} showDate showTime />
                          {h.assigneeName ? ` · ${h.assigneeName}` : ''}
                          {durationLabel ? ` · ${durationLabel}` : ''}
                        </span>
                        {h.rating === 1 && (
                          <ThumbsUp size={11} className="text-[var(--text-success)] shrink-0" />
                        )}
                        {h.rating === -1 && (
                          <ThumbsDown size={11} className="text-[var(--text-danger)] shrink-0" />
                        )}
                      </div>
                      <ChevronRight size={14} className={cn("shrink-0 text-[var(--text-tertiary)] transition-transform", isExpanded && "rotate-90")} />
                    </button>
                    {isExpanded && (
                      <div className="px-4 py-3 border-t border-[var(--border-default)] bg-[var(--surface-pill)]/40 space-y-2 max-h-64 overflow-y-auto">
                        {isLoadingThis ? (
                          <div className="flex items-center justify-center py-4 text-[var(--text-tertiary)]">
                            <Loader2 size={16} className="animate-spin" />
                          </div>
                        ) : loadedMessages.length === 0 ? (
                          <p className="text-[10px] text-[var(--text-tertiary)] text-center py-2">Sem mensagens registradas.</p>
                        ) : (
                          loadedMessages.map((m) => (
                            <div key={m.id} className="text-[11px] leading-relaxed">
                              <span className="font-semibold text-[var(--text-tertiary)]">{m.senderName || 'Cliente'}: </span>
                              <span className="text-[var(--text-secondary)]">{m.text}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {offset < total && (
                <div className="flex justify-center pt-2">
                  <button
                    onClick={() => loadMore(offset)}
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:border-[var(--accent)]/30 transition-all disabled:opacity-50"
                  >
                    {loading ? <Loader2 size={12} className="animate-spin" /> : <History size={12} />}
                    Carregar mais
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
