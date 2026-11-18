"use client";

import React, { useState, useEffect } from 'react';
import { useEscapeToClose } from '@/hooks/use-escape-to-close';
import { StyledSelect } from '@/components/styled-select';
import { motion, AnimatePresence } from 'motion/react';
import { Search } from 'lucide-react';
import { useInternalTicketQueuesQuery } from '@/lib/query-hooks';
import { InternalTicket, InternalTicketQueue } from '@/lib/types';

interface LinkInternalTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLink: (internalTicketId: string) => void;
  // Tickets internos já vinculados a este chamado — não faz sentido
  // oferecer "vincular" de novo algo que já está vinculado.
  excludeIds?: string[];
}

export function LinkInternalTicketModal({ isOpen, onClose, onLink, excludeIds = [] }: LinkInternalTicketModalProps) {
  useEscapeToClose(isOpen, onClose);
  const [allTickets, setAllTickets] = useState<InternalTicket[]>([]);
  // Filtro por FILA de ticket interno (2026-11-17) — antes era por equipe,
  // que deixou de ser o agrupamento do ticket interno. "none" = tickets
  // antigos, ainda sem fila.
  const { data: queuesData } = useInternalTicketQueuesQuery();
  const queues = React.useMemo(
    () => ((queuesData || []) as InternalTicketQueue[]),
    [queuesData]
  );
  const activeQueues = React.useMemo(
    () => queues.filter(q => q.isActive).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [queues]
  );
  const [search, setSearch] = useState('');
  const [queueFilter, setQueueFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  // Fetch paginated tickets from backend when debounced search changes
  useEffect(() => {
    if (!isOpen) return;
    
    const fetchTickets = async () => {
      setLoading(true);
      const params = new URLSearchParams({ action: 'list', limit: '50' });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (queueFilter) params.set('queueId', queueFilter);

      let data: any[] = [];
      try {
        const res = await fetch(`/api/internal-tickets?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      } catch (err) {
        console.error('Erro ao buscar tickets internos:', err);
      }
      setAllTickets((data || []).filter((it: any) => !excludeIds.includes(it.id)).map((it: any) => ({
        id: it.id,
        title: it.title,
        teamId: it.team_id,
        internalTeamId: it.internal_team_id,
        internalQueueId: it.internal_queue_id ?? null,
        assigneeId: it.assignee_id,
        priority: it.priority,
        tags: it.tags || [],
        creatorId: it.creator_id,
        description: it.description,
        createdAt: it.created_at,
        updatedAt: it.updated_at,
        slaLimit: it.sla_limit,
        internalTicketNumber: it.internal_ticket_number ?? null,
      })));
      setLoading(false);
    };
    
    fetchTickets();
  }, [isOpen, debouncedSearch, queueFilter]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-[var(--surface-card)] rounded-2xl p-6 max-w-lg w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-black text-[var(--text-primary)] mb-4 uppercase">
              Vincular Ticket Interno
            </h3>

            <div className="flex gap-2 mb-4">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                <input
                  type="text"
                  placeholder="Buscar por título ou nº (ex: 23 ou int-0023)..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border-default)] text-sm focus:border-[var(--text-warning-strong)] outline-none"
                />
              </div>
<StyledSelect
               value={queueFilter}
               onChange={(e) => setQueueFilter(e.target.value)}
               aria-label="Filtrar por fila"
               className="px-3 py-2 rounded-lg border border-[var(--border-default)] text-xs font-bold uppercase"
             >
               <option value="">Todas as filas</option>
               {activeQueues.map(q => (
                 <option key={q.id} value={q.id}>{q.name}</option>
               ))}
               <option value="none">Sem fila</option>
             </StyledSelect>
            </div>

            <div className="flex-1 overflow-y-auto -mx-2 px-2">
              {loading ? (
                <p className="text-center py-8 text-[var(--text-tertiary)]">Carregando...</p>
              ) : allTickets.length === 0 ? (
                <p className="text-center py-8 text-[var(--text-tertiary)]">Nenhum ticket interno encontrado</p>
              ) : (
                <div className="space-y-2">
                  {allTickets.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => onLink(t.id!)}
                      className="w-full p-3 text-left border border-[var(--border-default)] rounded-lg hover:bg-[var(--surface-card)] transition-all"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-[var(--text-primary)]">{t.title}</p>
                        {t.internalTicketNumber != null && (
                          <span className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase shrink-0">
                            int-{String(t.internalTicketNumber).padStart(4, '0')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-tertiary)] mt-1">
                        {t.internalQueueId
                          ? (queues.find(q => q.id === t.internalQueueId)?.name || 'Fila removida')
                          : (t.teamId ? `Sem fila · Equipe (antiga): ${t.teamId}` : 'Sem fila')}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end mt-4 pt-4 border-t border-[var(--border-default)]">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-card)] transition-all text-sm font-bold"
              >
                Cancelar
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
