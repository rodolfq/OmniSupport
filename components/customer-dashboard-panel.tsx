'use client';

import React, { useEffect, useState } from 'react';
import { LayoutDashboard, Ticket as TicketIcon, MessageSquare, Sparkles, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getCustomerDashboard, CustomerDashboardData } from '@/lib/search';

// Dashboard do Cliente/Funcionário em "Meus Chamados" — pedido do usuário:
// sem SLA/tempo de resposta, só um retrato rápido de quantos chamados estão
// em andamento e como andam as conversas. Escopo (empresa toda vs só os
// próprios) decidido pelo servidor (ver app/api/search?action=customer-dashboard),
// mesma regra que já vale pra lista de chamados.
export function CustomerDashboardPanel() {
  const [data, setData] = useState<CustomerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getCustomerDashboard()
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-24 rounded-2xl bg-[var(--surface-pill)] animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const { tickets, chats, scope } = data;
  const statusTotal = tickets.novos + tickets.emAndamento + tickets.finalizadosRecentes;

  return (
    <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-3xl p-6 shadow-sm space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-[var(--accent)]/10 text-[var(--accent-text)] flex items-center justify-center">
            <LayoutDashboard size={16} />
          </div>
          <div>
            <p className="text-sm font-black text-[var(--text-primary)] tracking-tight">Visão geral</p>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">
              {scope === 'company' ? 'Dados de toda a empresa' : 'Seus chamados e conversas'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile label="Em andamento" value={tickets.emAndamento} icon={<TicketIcon size={14} />} tone="warning" />
        <StatTile label="Novos" value={tickets.novos} icon={<Sparkles size={14} />} tone="info" />
        <StatTile label="Finalizados (30 dias)" value={tickets.finalizadosRecentes} icon={<CheckCircle2 size={14} />} tone="success" />
        <StatTile label="Conversas ativas" value={chats.ativas} icon={<MessageSquare size={14} />} tone="neutral" />
      </div>

      {statusTotal > 0 && (
        <div className="space-y-2">
          <div className="flex h-2 rounded-full overflow-hidden bg-[var(--surface-pill)] gap-0.5">
            {tickets.novos > 0 && (
              <div className="bg-[var(--text-info)] rounded-full" style={{ width: `${(tickets.novos / statusTotal) * 100}%` }} />
            )}
            {tickets.emAndamento > 0 && (
              <div className="bg-[var(--text-warning)] rounded-full" style={{ width: `${(tickets.emAndamento / statusTotal) * 100}%` }} />
            )}
            {tickets.finalizadosRecentes > 0 && (
              <div className="bg-[var(--text-success)] rounded-full" style={{ width: `${(tickets.finalizadosRecentes / statusTotal) * 100}%` }} />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">
            <Legend color="bg-[var(--text-info)]" label={`Novos (${tickets.novos})`} />
            <Legend color="bg-[var(--text-warning)]" label={`Em andamento (${tickets.emAndamento})`} />
            <Legend color="bg-[var(--text-success)]" label={`Finalizados (${tickets.finalizadosRecentes})`} />
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('w-2 h-2 rounded-full', color)} />
      {label}
    </span>
  );
}

const TONE_CLASSES: Record<string, string> = {
  info: 'bg-[var(--surface-info)] text-[var(--text-info)]',
  warning: 'bg-[var(--surface-warning)] text-[var(--text-warning)]',
  success: 'bg-[var(--surface-success)] text-[var(--text-success)]',
  neutral: 'bg-[var(--surface-pill)] text-[var(--text-secondary)]',
};

function StatTile({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: keyof typeof TONE_CLASSES }) {
  return (
    <div className="p-4 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] flex flex-col justify-between gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest">{label}</p>
        <div className={cn('w-6 h-6 rounded-lg flex items-center justify-center', TONE_CLASSES[tone])}>{icon}</div>
      </div>
      <p className="text-2xl font-black text-[var(--text-primary)] tracking-tight">{value}</p>
    </div>
  );
}
