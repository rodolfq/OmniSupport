'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { ThumbsUp, X } from 'lucide-react';
import { useApp } from '@/app/app-context';
import { UserRole } from '@/lib/types';
import { useEscapeToClose } from '@/hooks/use-escape-to-close';

const SESSION_KEY = 'ticket_eval_reminder_shown';

interface PendingEvaluationTicket {
  id: string;
  ticketNumber?: number;
  title: string;
}

/**
 * Lembrete pop-up pra Cliente/Funcionário avaliar chamados Concluídos ainda
 * sem avaliação — pedido do usuário, 2026-10-08. Mesmo estilo cheio-de-tela
 * dos outros lembretes do sistema (giro-lunch-onboarding.tsx,
 * calendar-event-reminder.tsx), mas fonte de dado própria: busca direto
 * GET /api/tickets?action=pending-evaluations (já existente, usado também
 * pela faixa passiva em /my-tickets) — não depende de notificação/push.
 *
 * Mostra no máximo 1 vez por sessão de navegador (sessionStorage): quem
 * adiou ("Depois") não vê de novo até a aba fechar/reabrir ou logar de novo.
 * A faixa de "Meus Chamados" continua visível sempre — este pop-up é só o
 * empurrão inicial, não a única forma de chegar lá.
 */
export function TicketEvaluationReminder() {
  const { currentUser } = useApp();
  const router = useRouter();
  const [pending, setPending] = useState<PendingEvaluationTicket[] | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const isCompanyUser = !!currentUser && [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser.role as UserRole);

  useEffect(() => {
    if (!isCompanyUser) return;
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
    } catch {
      // sessionStorage bloqueado (aba privada etc.) — segue sem a trava de
      // "1x por sessão", melhor mostrar de novo do que nunca mostrar.
    }
    let cancelled = false;
    fetch('/api/tickets?action=pending-evaluations')
      .then(res => (res.ok ? res.json() : []))
      .then(data => {
        if (cancelled) return;
        if (Array.isArray(data) && data.length > 0) setPending(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isCompanyUser]);

  const close = () => {
    setDismissed(true);
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch {}
  };

  const isOpen = !!pending && pending.length > 0 && !dismissed;
  useEscapeToClose(isOpen, close);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-[var(--surface-card)] w-full max-w-sm rounded-[3rem] shadow-2xl overflow-hidden"
        >
          <div className="relative bg-[var(--accent)] p-8 text-white text-center">
            <button
              onClick={close}
              className="absolute top-5 right-5 p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all"
              title="Fechar"
            >
              <X size={16} />
            </button>
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
              <ThumbsUp size={32} />
            </div>
            <h2 className="text-2xl font-black uppercase tracking-tight">
              {pending!.length === 1 ? '1 chamado aguarda sua avaliação' : `${pending!.length} chamados aguardam sua avaliação`}
            </h2>
            <p className="text-indigo-100 dark:text-[var(--accent-soft-text)] text-sm mt-2 font-medium opacity-80">
              Conte pra gente como foi o atendimento — leva menos de 1 minuto.
            </p>
          </div>
          <div className="p-8 flex gap-3">
            <button
              onClick={close}
              className="flex-1 text-center border border-[var(--border-default)] text-[var(--text-secondary)] py-4 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-[var(--surface-pill)] transition-all"
            >
              Depois
            </button>
            <button
              onClick={() => { close(); router.push('/my-tickets'); }}
              className="flex-1 bg-[var(--accent)] text-white py-4 rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl hover:bg-[var(--accent-hover)] transition-all"
            >
              Avaliar agora
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
