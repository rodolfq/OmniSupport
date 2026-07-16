'use client';

import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, Clock, Calendar, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/app/theme-provider';

const dataByDay = [
  { name: 'Seg', total: 40 },
  { name: 'Ter', total: 30 },
  { name: 'Qua', total: 60 },
  { name: 'Qui', total: 45 },
  { name: 'Sex', total: 70 },
  { name: 'Sab', total: 20 },
  { name: 'Dom', total: 15 },
];

const dataByCategory = [
  { name: 'Mobile', value: 400, color: '#4f46e5' },
  { name: 'Desktop', value: 300, color: '#6366f1' },
  { name: 'Hardware', value: 300, color: '#818cf8' },
  { name: 'Server', value: 200, color: '#a5b4fc' },
];

export default function ReportsPage() {
  const { theme } = useTheme();
  const axisColor = theme === 'dark' ? '#94a3b8' : '#64748b';
  const tooltipStyle = theme === 'dark'
    ? { borderRadius: '12px', border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.3)' }
    : { borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-black text-slate-800 dark:text-[var(--text-primary)] tracking-tight">Performance Analítica</h1>
        <button className="bg-indigo-600 dark:bg-[var(--accent)] hover:bg-indigo-700 dark:hover:bg-[var(--accent-hover)] text-white px-6 py-2 rounded-lg font-bold shadow-md transition-colors">Exportar PDF</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <MetricCard label="Satisfação" value="4.7" icon={<TrendingUp size={24} className="text-white" />} accent />
        <MetricCard label="Tempo Médio" value="2.4h" icon={<Clock className="text-indigo-600 dark:text-[var(--accent-text)]" />} />
        <MetricCard label="SLA" value="98.2%" icon={<Calendar className="text-indigo-600 dark:text-[var(--accent-text)]" />} />
        <MetricCard label="Analistas" value="12" icon={<Users className="text-indigo-600 dark:text-[var(--accent-text)]" />} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white dark:bg-[var(--surface-card)] p-8 rounded-2xl border border-slate-200 dark:border-[var(--border-default)] shadow-sm">
          <h3 className="font-bold mb-8 uppercase text-[10px] tracking-[0.2em] text-slate-400 dark:text-[var(--text-tertiary)]">Volume de Atendimentos</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dataByDay}>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: axisColor}} />
                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: axisColor}} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="total" stroke="#4f46e5" fill="#4f46e5" fillOpacity={0.1} strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white dark:bg-[var(--surface-card)] p-8 rounded-2xl border border-slate-200 dark:border-[var(--border-default)] shadow-sm">
          <h3 className="font-bold mb-8 uppercase text-[10px] tracking-[0.2em] text-slate-400 dark:text-[var(--text-tertiary)]">Distribuição</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={dataByCategory} innerRadius={60} outerRadius={80} paddingAngle={8} dataKey="value" stroke="none">
                  {dataByCategory.map((e: any, i: number) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon, accent }: { label: string, value: string, icon: React.ReactNode, accent?: boolean }) {
  return (
    <div className={cn(
      "p-6 rounded-2xl flex flex-col items-center shadow-sm transition-all",
      accent ? "bg-indigo-600 dark:bg-[var(--accent)] text-white shadow-indigo-200" : "bg-white dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)]"
    )}>
      <div className={cn("p-3 rounded-xl mb-4", accent ? "bg-white/20" : "bg-slate-50 dark:bg-[var(--surface-card)]")}>{icon}</div>
      <p className={cn("text-[10px] font-black uppercase tracking-widest mb-1", accent ? "opacity-70" : "text-slate-400 dark:text-[var(--text-tertiary)]")}>{label}</p>
      <p className="text-2xl font-black">{value}</p>
    </div>
  );
}
