'use client';

import React from 'react';
import { InternalTicketDetailModal } from '@/components/internal-ticket-detail-modal';
import { useOpenInternalTicket } from '@/components/internal-ticket-modal-host';

interface NewInternalTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Chamado depois de criar com sucesso, além do onClose automático — usado
  // por quem precisa recarregar uma lista (ex.: internal-tickets-view.tsx).
  onCreated?: (ticketId: string) => void;
  initialTitle?: string;
  initialDescription?: string;
}

/**
 * "Novo Ticket Interno" (lista de Tickets Internos e "Criar ticket interno"
 * a partir de uma mensagem do Chat Interno).
 *
 * Desde 2026-11-12 (pedido do usuário) não é mais um formulário em modal: abre
 * a própria tela do ticket interno em modo criação (InternalTicketDetailModal
 * com `creating`), já com a cara de um ticket aberto e o botão "Criar ticket"
 * no lugar de Assumir/Finalizar/Salvar. Ao criar, o ticket de verdade abre
 * por cima da tela atual (mesmo ?internalTicket= de qualquer outro clique).
 *
 * As props continuam as mesmas de antes, então quem abria não mudou.
 */
export function NewInternalTicketModal({ isOpen, onClose, onCreated, initialTitle, initialDescription }: NewInternalTicketModalProps) {
  const openInternalTicket = useOpenInternalTicket();
  if (!isOpen) return null;
  return (
    <InternalTicketDetailModal
      // Desmontado a cada fechamento (return null acima), então o rascunho é
      // lido uma vez só, na abertura — mudar as props depois não apaga o que
      // a pessoa já digitou.
      ticketRef=""
      creating={{ title: initialTitle || '', description: initialDescription || '' }}
      onClose={onClose}
      onCreated={(id) => {
        onCreated?.(id);
        onClose();
        if (id) openInternalTicket(id);
      }}
    />
  );
}
