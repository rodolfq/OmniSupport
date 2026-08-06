'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { StyledSelect } from '@/components/styled-select';
import { useApp } from '@/app/app-context';
import { User } from '@/lib/types';
import { InternalTicketService } from '@/lib/services/ticket-service';
import { useInternalTeamsQuery, useProfilesLiteQuery } from '@/lib/query-hooks';

// Mesmo fallback de app/(portal)/tickets/internal-tickets-view.tsx, usado
// enquanto internal_teams ainda não carregou (ou está vazia).
const DEFAULT_TEAM_OPTIONS = [
  { value: 'Desenvolvimento', label: 'Desenvolvimento' },
  { value: 'Infraestrutura', label: 'Infraestrutura' },
  { value: 'QA / Testes', label: 'QA / Testes' },
  { value: 'Produto', label: 'Produto' },
];

interface NewInternalTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Chamado depois de criar com sucesso, além do onClose automático — usado
  // por quem precisa recarregar uma lista (ex.: internal-tickets-view.tsx).
  onCreated?: (ticketId: string) => void;
  initialTitle?: string;
  initialDescription?: string;
}

// Extraído do TicketModal que antes vivia só dentro de
// app/(portal)/tickets/internal-tickets-view.tsx — precisava ser reaberto
// também fora daquela tela (transformar mensagem do chat interno em ticket
// interno, ver app/(portal)/chat-internal/page.tsx). Diferente do original,
// este componente é autossuficiente: busca seus próprios dados de
// referência (equipes/analistas) e chama InternalTicketService.save
// sozinho, em vez de depender de estado levantado pelo pai. A tela de
// Tickets Internos continua dona da edição (isso aqui só cobre criação).
export function NewInternalTicketModal({ isOpen, onClose, onCreated, initialTitle, initialDescription }: NewInternalTicketModalProps) {
  const { currentUser } = useApp();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [team, setTeam] = useState('Desenvolvimento');
  const [priority, setPriority] = useState(1);
  const [assignee, setAssignee] = useState('');
  const [loading, setLoading] = useState(false);

  const { data: profilesLiteData } = useProfilesLiteQuery({ enabled: isOpen });
  const analysts = useMemo(
    () => ((profilesLiteData || []) as User[]).filter((u) => u.role === 'Equipe' || u.role === 'Administrador'),
    [profilesLiteData]
  );

  const { data: internalTeamsData } = useInternalTeamsQuery({ enabled: isOpen });
  const sortedInternalTeams = useMemo(
    () => [...(internalTeamsData || [])].sort((a: any, b: any) => a.name.localeCompare(b.name)),
    [internalTeamsData]
  );
  const teams = useMemo(
    () => sortedInternalTeams.length > 0
      ? sortedInternalTeams.map((t: any) => ({ value: t.name, label: t.name }))
      : DEFAULT_TEAM_OPTIONS,
    [sortedInternalTeams]
  );

  // Reinicia o formulário a cada abertura — mesmo motivo do NewTicketModal
  // (components/new-ticket-modal.tsx): sem isso, reabrir mostraria os
  // valores da última criação.
  useEffect(() => {
    if (!isOpen) return;
    setTitle(initialTitle || '');
    setDescription(initialDescription || '');
    setTeam('Desenvolvimento');
    setPriority(1);
    setAssignee('');
  }, [isOpen, initialTitle, initialDescription]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!currentUser || !title || loading) return;
    setLoading(true);
    try {
      const savedId = await InternalTicketService.save({
        title,
        description,
        teamId: team,
        internalTeamId: sortedInternalTeams.find((t: any) => t.name === team)?.id,
        priority,
        assigneeId: assignee || undefined,
        creatorId: currentUser.id,
        tags: [],
      });
      toast.success('Ticket interno criado com sucesso!');
      onCreated?.(savedId);
      onClose();
    } catch (error) {
      console.error('Error saving internal ticket:', error);
      toast.error('Erro ao salvar: ' + ((error as any)?.message || 'erro desconhecido'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-[var(--surface-card)] rounded-2xl p-6 max-w-lg w-full"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-lg font-black text-[var(--text-primary)] mb-4 uppercase">
            Novo Ticket Interno
          </h2>

          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase mb-1 block">Título *</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Título do ticket"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] focus:border-[var(--text-warning-strong)] outline-none text-sm font-medium"
              />
            </div>

            <div>
              <label className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase mb-1 block">Descrição</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detalhes técnicos..."
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] focus:border-[var(--text-warning-strong)] outline-none text-sm min-h-[100px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase mb-1 block">Equipe</label>
                <StyledSelect
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] text-sm font-medium bg-[var(--surface-card)]"
                >
                  {teams.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </StyledSelect>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase mb-1 block">Prioridade</label>
                <StyledSelect
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] text-sm font-medium bg-[var(--surface-card)]"
                >
                  <option value={1}>Baixa</option>
                  <option value={2}>Média</option>
                  <option value={3}>Alta</option>
                </StyledSelect>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase mb-1 block">Responsável</label>
              <StyledSelect
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] text-sm font-medium bg-[var(--surface-card)]"
              >
                <option value="">Não atribuído</option>
                {analysts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </StyledSelect>
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-card)] transition-all text-sm font-bold"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={!title || loading}
              className="flex-1 px-4 py-2 rounded-lg bg-[var(--text-warning-strong)] text-white font-black uppercase tracking-widest hover:bg-[var(--accent-warning-hover)] transition-all disabled:opacity-50 text-sm"
            >
              {loading ? 'Criando...' : 'Criar'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
