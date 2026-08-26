'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CalendarClock, X } from 'lucide-react';
import { useApp } from '@/app/app-context';

interface ActiveReminder {
  id: string;
  title: string;
  message: string;
  eventUrl?: string;
}

/**
 * Lembrete de evento da Google Agenda, no mesmo estilo cheio-de-tela do
 * lembrete de almoço do Giro (ver components/giro-lunch-onboarding.tsx) —
 * pedido explícito do time: o pop-up deve parecer o mesmo componente.
 *
 * O evento em si (som, toast, sino, push nativo) já passa pelo pipeline
 * genérico de qualquer notificação (addNotification, em app-context.tsx),
 * alimentado por app/api/notifications/check/route.ts a partir do que
 * lib/services/google-calendar-scheduler.ts grava no servidor. Este
 * componente só ACRESCENTA o modal grande por cima quando a aba está aberta,
 * pra dar o mesmo destaque que o lembrete de almoço tem — não duplica o
 * disparo, só decora um tipo específico ('calendar_event') que já chegou.
 */
export function CalendarEventReminder() {
  const { notifications } = useApp();
  const [active, setActive] = useState<ActiveReminder | null>(null);
  const shownIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const next = notifications.find(n => n.type === 'calendar_event' && !shownIdsRef.current.has(n.id));
    if (!next) return;
    shownIdsRef.current.add(next.id);
    setActive({ id: next.id, title: next.title, message: next.message, eventUrl: next.meta?.eventUrl });
  }, [notifications]);

  useEffect(() => {
    if (!active) return;
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setActive(null); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [active]);

  return (
    <AnimatePresence>
      {active && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-[var(--surface-card)] w-full max-w-sm rounded-[3rem] shadow-2xl overflow-hidden"
          >
            <div className="relative bg-[var(--accent)] p-8 text-white text-center">
              <button
                onClick={() => setActive(null)}
                className="absolute top-5 right-5 p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all"
                title="Fechar"
              >
                <X size={16} />
              </button>
              <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
                <CalendarClock size={32} />
              </div>
              <h2 className="text-2xl font-black uppercase tracking-tight">{active.title}</h2>
              <p className="text-indigo-100 dark:text-[var(--accent-soft-text)] text-sm mt-2 font-medium opacity-80">
                {active.message}
              </p>
            </div>
            <div className="p-8 flex gap-3">
              {active.eventUrl && (
                <a
                  href={active.eventUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setActive(null)}
                  className="flex-1 text-center border border-[var(--border-default)] text-[var(--text-secondary)] py-4 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-[var(--surface-pill)] transition-all"
                >
                  Abrir evento
                </a>
              )}
              <button
                onClick={() => setActive(null)}
                className="flex-1 bg-[var(--accent)] text-white py-4 rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl hover:bg-[var(--accent-hover)] transition-all"
              >
                Entendi
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
