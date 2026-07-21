'use client';

import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, Clock, Calendar, Users, ThumbsUp, ThumbsDown, MessageSquareText, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/app/theme-provider';
import { useApp } from '@/app/app-context';
import { Permission } from '@/lib/types';

interface SurveyResponse {
  id: string;
  customerName: string;
  ticketNumber: number | null;
  rating: number;
  finishedAt: string;
}

interface SurveyReport {
  total: number;
  satisfied: number;
  toImprove: number;
  satisfactionRate: number;
  responses: SurveyResponse[];
}

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
  const { hasPermission } = useApp();
  const { theme } = useTheme();
  const axisColor = theme === 'dark' ? '#94a3b8' : '#64748b';
  const tooltipStyle = theme === 'dark'
    ? { borderRadius: '12px', border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.3)' }
    : { borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' };

  const [surveyReport, setSurveyReport] = React.useState<SurveyReport | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch('/api/reports/survey', { signal: controller.signal })
      .then(res => res.json())
      .then(data => setSurveyReport(data))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const surveyPieData = surveyReport ? [
    { name: 'Satisfeitos', value: surveyReport.satisfied, color: '#22c55e' },
    { name: 'A Melhorar', value: surveyReport.toImprove, color: '#ef4444' },
  ] : [];

  if (!hasPermission(Permission.REPORTS_READ)) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8 bg-[var(--surface-card)] rounded-2xl shadow-lg border border-[var(--border-default)]">
          <Lock size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-xl font-bold text-[var(--text-secondary)] mb-2">Acesso Negado</h2>
          <p className="text-[var(--text-tertiary)]">Você não tem permissão para visualizar relatórios.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tight">Performance Analítica</h1>
        <button className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white px-6 py-2 rounded-lg font-bold shadow-md transition-colors">Exportar PDF</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <MetricCard label="Satisfação" value="4.7" icon={<TrendingUp size={24} className="text-white" />} accent />
        <MetricCard label="Tempo Médio" value="2.4h" icon={<Clock className="text-[var(--accent-text)]" />} />
        <MetricCard label="SLA" value="98.2%" icon={<Calendar className="text-[var(--accent-text)]" />} />
        <MetricCard label="Analistas" value="12" icon={<Users className="text-[var(--accent-text)]" />} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-[var(--surface-card)] p-8 rounded-2xl border border-[var(--border-default)] shadow-sm">
          <h3 className="font-bold mb-8 uppercase text-[10px] tracking-[0.2em] text-[var(--text-tertiary)]">Volume de Atendimentos</h3>
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
        <div className="bg-[var(--surface-card)] p-8 rounded-2xl border border-[var(--border-default)] shadow-sm">
          <h3 className="font-bold mb-8 uppercase text-[10px] tracking-[0.2em] text-[var(--text-tertiary)]">Distribuição</h3>
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

      <div className="space-y-6">
        <h2 className="text-xl font-black text-[var(--text-primary)] tracking-tight">Pesquisa de Satisfação</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <MetricCard label="Respostas" value={String(surveyReport?.total ?? 0)} icon={<MessageSquareText className="text-[var(--accent-text)]" />} />
          <MetricCard label="% Satisfação" value={surveyReport ? `${Math.round(surveyReport.satisfactionRate * 100)}%` : '0%'} icon={<ThumbsUp size={24} className="text-white" />} accent />
          <MetricCard label="A Melhorar" value={String(surveyReport?.toImprove ?? 0)} icon={<ThumbsDown className="text-[var(--accent-text)]" />} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-[var(--surface-card)] p-8 rounded-2xl border border-[var(--border-default)] shadow-sm">
            <h3 className="font-bold mb-8 uppercase text-[10px] tracking-[0.2em] text-[var(--text-tertiary)]">Satisfeitos x A Melhorar</h3>
            <div className="h-64">
              {surveyReport && surveyReport.total > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={surveyPieData} innerRadius={60} outerRadius={80} paddingAngle={8} dataKey="value" stroke="none">
                      {surveyPieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-[var(--text-tertiary)]">Nenhuma resposta ainda</div>
              )}
            </div>
          </div>

          <div className="bg-[var(--surface-card)] p-8 rounded-2xl border border-[var(--border-default)] shadow-sm">
            <h3 className="font-bold mb-4 uppercase text-[10px] tracking-[0.2em] text-[var(--text-tertiary)]">Respostas Recentes</h3>
            <div className="h-64 overflow-y-auto space-y-2">
              {surveyReport?.responses.length ? surveyReport.responses.map(r => (
                <div key={r.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[var(--border-default)] text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--text-primary)] truncate">{r.customerName || 'Cliente'}</p>
                    <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest">
                      {r.ticketNumber ? `Conversa #${String(r.ticketNumber).padStart(4, '0')}` : ''} · {new Date(r.finishedAt).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  {r.rating === 1 ? (
                    <ThumbsUp size={16} className="text-[var(--text-success)] shrink-0" />
                  ) : (
                    <ThumbsDown size={16} className="text-[var(--text-danger)] shrink-0" />
                  )}
                </div>
              )) : (
                <div className="h-full flex items-center justify-center text-sm text-[var(--text-tertiary)]">Nenhuma resposta ainda</div>
              )}
            </div>
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
      accent ? "bg-[var(--accent)] text-white shadow-indigo-200" : "bg-[var(--surface-card)] border border-[var(--border-default)]"
    )}>
      <div className={cn("p-3 rounded-xl mb-4", accent ? "bg-white/20" : "bg-[var(--surface-card)]")}>{icon}</div>
      <p className={cn("text-[10px] font-semibold uppercase tracking-widest mb-1", accent ? "opacity-70" : "text-[var(--text-tertiary)]")}>{label}</p>
      <p className="text-2xl font-black">{value}</p>
    </div>
  );
}
