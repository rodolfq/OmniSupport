'use client';

import React, { useState } from 'react';
import { RefreshCw, Lock, CalendarDays, SlidersHorizontal } from 'lucide-react';
import { Permission } from '@/lib/types';
import { useApp } from '@/app/app-context';
import { cn } from '@/lib/utils';
import { GiroDayView } from './giro-day-view';
import { GiroConfigView } from './giro-config-view';

type Tab = 'day' | 'config';

/**
 * Giro de Atendimento — rodízio diário da equipe.
 *
 * Duas abas na mesma tela (e não duas rotas) porque as duas se olham o tempo
 * todo: quem ajusta posição fixa ou marca ausência quer conferir na hora como
 * o dia ficou. A aba de configuração só existe para quem tem giro:manage.
 */
export default function GiroPage() {
  const { hasPermission } = useApp();
  const canView = hasPermission(Permission.GIRO_VIEW) || hasPermission(Permission.GIRO_MANAGE);
  const canManage = hasPermission(Permission.GIRO_MANAGE);
  const [tab, setTab] = useState<Tab>('day');

  if (!canView) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8 bg-[var(--surface-card)] rounded-2xl shadow-lg">
          <Lock size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-xl font-bold text-[var(--text-secondary)] mb-2">Acesso Negado</h2>
          <p className="text-[var(--text-tertiary)]">Você não tem permissão para ver o Giro de Atendimento.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-3">
            <RefreshCw className="text-[var(--accent-text)]" size={28} />
            Giro de Atendimento
          </h1>
          <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">
            Ordem do rodízio da equipe, dia a dia
          </p>
        </div>

        {canManage && (
          <div className="flex items-center gap-1 p-1 bg-[var(--surface-pill)] rounded-xl border border-[var(--border-default)] self-start">
            <button
              onClick={() => setTab('day')}
              className={cn(
                'px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2',
                tab === 'day'
                  ? 'bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              )}
            >
              <CalendarDays size={14} /> Giro do dia
            </button>
            <button
              onClick={() => setTab('config')}
              className={cn(
                'px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2',
                tab === 'config'
                  ? 'bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              )}
            >
              <SlidersHorizontal size={14} /> Configuração
            </button>
          </div>
        )}
      </div>

      {tab === 'day' || !canManage ? <GiroDayView canManage={canManage} /> : <GiroConfigView />}
    </div>
  );
}
