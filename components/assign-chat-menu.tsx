'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Send, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OnlineTarget {
  id: string;
  name: string;
}

interface AssignChatMenuProps {
  currentUserId?: string;
  isCurrentUserOnline: boolean;
  onlineTargets: OnlineTarget[];
  onAssignToSelf?: () => void;
  onAssignToUser: (userId: string) => void;
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
  selfLabel = 'Assumir',
  showSelf = true,
  variant = 'full',
  className
}: AssignChatMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const targets = onlineTargets.filter(t => t.id !== currentUserId);

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
              variant === 'full' ? 'px-4 py-2' : 'px-2.5 py-2'
            )}
            title={isCurrentUserOnline ? undefined : 'Você precisa estar Online para assumir atendimentos'}
          >
            <UserPlus size={13} /> {variant === 'full' && selfLabel}
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className={cn(
            'flex items-center justify-center bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-all',
            showSelf ? 'px-1.5 py-2 border-l border-[var(--accent)]' : 'px-2.5 py-2'
          )}
          title="Enviar para outro usuário online"
        >
          <ChevronDown size={13} />
          {!showSelf && variant === 'full' && <span className="ml-2">Transferir</span>}
        </button>
      </div>

      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-2xl z-30 overflow-hidden">
          <p className="px-4 py-2 text-[9px] font-semibold text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
            Enviar para
          </p>
          {targets.length === 0 ? (
            <p className="px-4 py-3 text-xs text-[var(--text-tertiary)] italic">Nenhum outro usuário online</p>
          ) : (
            <div className="max-h-56 overflow-y-auto">
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
        </div>
      )}
    </div>
  );
}
