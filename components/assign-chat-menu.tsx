'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, ListRestart, Send, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';

const MENU_WIDTH = 224; // w-56

interface OnlineTarget {
  id: string;
  name: string;
}

interface QueueTarget {
  id: string;
  name: string;
}

interface AssignChatMenuProps {
  currentUserId?: string;
  isCurrentUserOnline: boolean;
  onlineTargets: OnlineTarget[];
  onAssignToSelf?: () => void;
  onAssignToUser: (userId: string) => void;
  queues?: QueueTarget[];
  currentQueueId?: string | null;
  onReturnToQueue?: (queueId: string) => void;
  selfLabel?: string;
  showSelf?: boolean;
  variant?: 'full' | 'icon';
  className?: string;
}

export function AssignChatMenu({
  currentUserId,
  isCurrentUserOnline,
  onlineTargets,
  onAssignToSelf,
  onAssignToUser,
  queues = [],
  currentQueueId,
  onReturnToQueue,
  selfLabel = 'Assumir',
  showSelf = true,
  variant = 'full',
  className
}: AssignChatMenuProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 320 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // Esse menu abre dentro de cards com `overflow-hidden` (usado pra
  // arredondar os cantos das listas de atendimento) — como popover
  // `absolute` normal, ele ficava cortado pela borda do card sempre que a
  // linha estava perto do fim da lista. Por isso, igual ao StyledSelect,
  // portamos pro <body> e calculamos a posição via getBoundingClientRect.
  const updatePosition = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const roomBelow = window.innerHeight - rect.bottom - 12;
    const roomAbove = rect.top - 12;
    const openAbove = roomBelow < 220 && roomAbove > roomBelow;
    const maxHeight = Math.max(160, Math.min(360, openAbove ? roomAbove : roomBelow));
    const next = {
      top: openAbove ? Math.max(8, rect.top - maxHeight - 8) : rect.bottom + 8,
      left: Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8),
      maxHeight,
    };
    setPosition(prev => (
      prev.top === next.top && prev.left === next.left && prev.maxHeight === next.maxHeight ? prev : next
    ));
  };

  useEffect(() => {
    if (!open) return;
    updatePosition();
    let frame: number;
    const loop = () => {
      updatePosition();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // Inclui o próprio usuário na lista (se estiver online): permite "puxar"
  // pra si um chat que está com outra pessoa, direto pela mesma lista de
  // transferência, sem depender do botão "Assumir" (que nem sempre aparece,
  // ex: quando showSelf=false porque o chat já tem responsável).
  const targets = onlineTargets;
  // Lista todas as filas, incluindo a atual: mesmo pra fila que já é a do
  // chat, "Voltar para fila" tem utilidade (força um novo rodízio/distribuição).
  const queueTargets = queues;

  return (
    <div ref={containerRef} className={cn('relative inline-block', className)}>
      <div className="flex items-center rounded-xl overflow-hidden shadow-sm shadow-indigo-100">
        {showSelf && (
          <button
            type="button"
            onClick={onAssignToSelf}
            disabled={!isCurrentUserOnline}
            className={cn(
              'flex items-center gap-2 bg-[var(--accent)] text-white text-[10px] font-semibold hover:bg-[var(--accent-hover)] transition-all disabled:opacity-50 disabled:cursor-not-allowed',
              variant === 'full' ? 'px-4 py-2.5' : 'px-2.5 py-2.5'
            )}
            title={isCurrentUserOnline ? undefined : 'Você precisa estar Online para assumir atendimentos'}
          >
            <UserPlus size={14} /> {variant === 'full' && selfLabel}
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className={cn(
            'flex items-center justify-center bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-all',
            showSelf ? 'px-2 py-2.5 border-l border-white/20' : 'px-2.5 py-2.5'
          )}
          title="Enviar para outro usuário online"
        >
          <ChevronDown size={14} />
          {!showSelf && variant === 'full' && <span className="ml-2">Transferir</span>}
        </button>
      </div>

      {mounted && createPortal(
        <AnimatePresence>
          {open && (
            <>
              <div className="fixed inset-0" style={{ zIndex: 2147483000 }} onMouseDown={() => setOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                className="fixed w-56 flex flex-col bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-2xl overflow-y-auto"
                style={{ top: position.top, left: position.left, maxHeight: position.maxHeight, zIndex: 2147483001 }}
              >
                <p className="px-4 py-2 text-[9px] font-semibold text-[var(--text-tertiary)] border-b border-[var(--border-default)] shrink-0">
                  Enviar para
                </p>
                {targets.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-[var(--text-tertiary)] italic">Nenhum outro usuário online</p>
                ) : (
                  <div className="overflow-y-auto">
                    {targets.map(target => (
                      <button
                        key={target.id}
                        type="button"
                        onClick={() => {
                          onAssignToUser(target.id);
                          setOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--accent)]/10 transition-all text-left"
                      >
                        <Send size={12} className="text-[var(--accent-text)] shrink-0" /> {target.name}
                      </button>
                    ))}
                  </div>
                )}
                {onReturnToQueue && (
                  <>
                    <p className="px-4 py-2 text-[9px] font-semibold text-[var(--text-tertiary)] border-y border-[var(--border-default)] shrink-0">
                      Voltar para fila
                    </p>
                    {queueTargets.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-[var(--text-tertiary)] italic">Nenhuma outra fila disponível</p>
                    ) : (
                      <div className="overflow-y-auto">
                        {queueTargets.map(queue => (
                          <button
                            key={queue.id}
                            type="button"
                            onClick={() => {
                              onReturnToQueue(queue.id);
                              setOpen(false);
                            }}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--accent)]/10 transition-all text-left"
                          >
                            <ListRestart size={12} className="text-[var(--accent-text)] shrink-0" /> {queue.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
