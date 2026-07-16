"use client";

import React, { useState, useEffect } from 'react';
import { StyledSelect } from '@/components/styled-select';
import { motion, AnimatePresence } from 'motion/react';
import { Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { InternalTicket } from '@/lib/types';

interface LinkInternalTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLink: (internalTicketId: string) => void;
}

export function LinkInternalTicketModal({ isOpen, onClose, onLink }: LinkInternalTicketModalProps) {
  const [allTickets, setAllTickets] = useState<InternalTicket[]>([]);
  const [teams, setTeams] = useState<Array<{id: string, name: string}>>([]);
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  // Fetch teams
  useEffect(() => {
    if (!isOpen) return;
    const fetchTeams = async () => {
      const { data } = await supabase.from('internal_teams').select('id, name').order('name');
      setTeams(data || []);
    };
    fetchTeams();
  }, [isOpen]);

  // Fetch paginated tickets from backend when debounced search changes
  useEffect(() => {
    if (!isOpen) return;
    
    const fetchTickets = async () => {
      setLoading(true);
      let query = supabase.from('internal_tickets').select('*');
      
      // Apply search filter on backend if not empty
      if (debouncedSearch) {
        query = query.ilike('title', `%${debouncedSearch}%`);
      }
      
      // Apply team filter on backend if not empty  
      if (teamFilter) {
        // Find team by name and filter by UUID
        const team = teams.find(t => t.name === teamFilter);
        if (team) {
          query = query.eq('internal_team_id', team.id);
        }
      }
      
      // Limit results for performance
      query = query.limit(50);
      
      const { data, error } = await query;
      if (error) {
        console.error('Error fetching internal tickets:', error.message);
      }
      setAllTickets((data || []).map((it: any) => ({
        id: it.id,
        title: it.title,
        teamId: it.team_id,
        internalTeamId: it.internal_team_id,
        assigneeId: it.assignee_id,
        priority: it.priority,
        tags: it.tags || [],
        creatorId: it.creator_id,
        description: it.description,
        createdAt: it.created_at,
        updatedAt: it.updated_at,
        slaLimit: it.sla_limit,
      })));
      setLoading(false);
    };
    
    fetchTickets();
  }, [isOpen, debouncedSearch, teamFilter, teams]);

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
            className="bg-white dark:bg-[var(--surface-card)] rounded-2xl p-6 max-w-lg w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-black text-slate-800 dark:text-[var(--text-primary)] mb-4 uppercase">
              Vincular Ticket Interno
            </h3>
            
            <div className="flex gap-2 mb-4">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[var(--text-tertiary)]" />
                <input
                  type="text"
                  placeholder="Buscar tickets internos..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-[var(--border-default)] text-sm focus:border-amber-400 dark:focus:border-[var(--text-warning-strong)] outline-none"
                />
              </div>
<StyledSelect
               value={teamFilter}
               onChange={(e) => setTeamFilter(e.target.value)}
               className="px-3 py-2 rounded-lg border border-slate-200 dark:border-[var(--border-default)] text-xs font-bold uppercase"
             >
               <option value="">Todas equipes</option>
               {teams.map(team => (
                 <option key={team.id} value={team.name}>{team.name}</option>
               ))}
             </StyledSelect>
            </div>

            <div className="flex-1 overflow-y-auto -mx-2 px-2">
              {loading ? (
                <p className="text-center py-8 text-slate-400 dark:text-[var(--text-tertiary)]">Carregando...</p>
              ) : allTickets.length === 0 ? (
                <p className="text-center py-8 text-slate-400 dark:text-[var(--text-tertiary)]">Nenhum ticket interno encontrado</p>
              ) : (
                <div className="space-y-2">
                  {allTickets.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => onLink(t.id!)}
                      className="w-full p-3 text-left border border-slate-200 dark:border-[var(--border-default)] rounded-lg hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] transition-all"
                    >
                      <p className="text-sm font-bold text-slate-800 dark:text-[var(--text-primary)]">{t.title}</p>
                      <p className="text-xs text-slate-500 dark:text-[var(--text-tertiary)] mt-1">{t.teamId || 'Sem equipe'}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end mt-4 pt-4 border-t border-slate-100 dark:border-[var(--border-default)]">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-[var(--border-default)] text-slate-600 dark:text-[var(--text-secondary)] hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] transition-all text-sm font-bold"
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
