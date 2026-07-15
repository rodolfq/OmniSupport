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
      <div className="flex items-center rounded-xl overflow-hidden shadow-lg shadow-indigo-100">
        {showSelf && (
          <button
            type="button"
            onClick={onAssignToSelf}
            disabled={!isCurrentUserOnline}
            className={cn(
              'flex items-center gap-2 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed',
              variant === 'full' ? 'px-5 py-2.5' : 'px-3 py-2.5'
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
            'flex items-center justify-center bg-indigo-600 text-white hover:bg-indigo-700 transition-all',
            showSelf ? 'px-2 py-2.5 border-l border-indigo-500' : 'px-3 py-2.5'
          )}
          title="Enviar para outro usuário online"
        >
          <ChevronDown size={14} />
          {!showSelf && variant === 'full' && <span className="ml-2">Transferir</span>}
        </button>
      </div>

      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-2xl shadow-2xl z-30 overflow-hidden">
          <p className="px-4 py-2 text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-50">
            Enviar para
          </p>
          {targets.length === 0 ? (
            <p className="px-4 py-3 text-xs text-slate-400 italic">Nenhum outro usuário online</p>
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
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-indigo-50 transition-all text-left"
                >
                  <Send size={12} className="text-indigo-500 shrink-0" /> {target.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
