'use client';

import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, Clock, Calendar, Users, ThumbsUp, ThumbsDown, MessageSquareText, Lock, Star, ClipboardList, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/app/theme-provider';
import { useApp } from '@/app/app-context';
import { Permission, MIN_RELIABLE_EVALUATION_COUNT } from '@/lib/types';

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

interface CustomerEvaluationRow {
  id: string;
  companyName: string;
  analystName: string;
  contactName: string | null;
  origin: 'chat_close' | 'manual';
  createdAt: string;
  knowledgeScore: number;
  autonomyScore: number;
  learningScore: number;
  engagementScore: number;
  organizationScore: number;
  communicationScore: number;
  profileTag: 'technical' | 'beginner' | 'challenging' | null;
}

interface CustomerEvaluationsReport {
  count: number;
  averages: Record<string, number>;
  overallAverage: number;
  tagDistribution: { technical: number; beginner: number; challenging: number };
  countByOrigin: { chatClose: number; manual: number };
  evaluations: CustomerEvaluationRow[];
}

const ORIGIN_LABELS: Record<'chat_close' | 'manual', string> = {
  chat_close: 'Atendimento',
  manual: 'Manual'
};

const TAG_LABELS: Record<'technical' | 'beginner' | 'challenging', string> = {
  technical: '👨‍💻 Técnico',
  beginner: '🙋‍♂️ Pouco Conhecimento',
  challenging: '😤 Desafiador'
};

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
  const [evaluationsReport, setEvaluationsReport] = React.useState<CustomerEvaluationsReport | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch('/api/reports/survey', { signal: controller.signal })
      .then(res => res.json())
      .then(data => setSurveyReport(data))
      .catch(() => {});
    fetch('/api/reports/customer-evaluations', { signal: controller.signal })
      .then(res => res.json())
      .then(data => setEvaluationsReport(data))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const surveyPieData = surveyReport ? [
    { name: 'Satisfeitos', value: surveyReport.satisfied, color: '#22c55e' },
    { name: 'A Melhorar', value: surveyReport.toImprove, color: '#ef4444' },
  ] : [];

  const evaluationTagPieData = evaluationsReport ? [
    { name: TAG_LABELS.technical, value: evaluationsReport.tagDistribution.technical, color: '#4f46e5' },
    { name: TAG_LABELS.beginner, value: evaluationsReport.tagDistribution.beginner, color: '#f59e0b' },
    { name: TAG_LABELS.challenging, value: evaluationsReport.tagDistribution.challenging, color: '#ef4444' },
  ].filter(d => d.value > 0) : [];

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

      {/* Avaliação interna de clientes: o inverso da pesquisa de satisfação
          acima — aqui é o analista avaliando o cliente, nunca visível a ele
          (ver components/customer-evaluation-modal.tsx). */}
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-black text-[var(--text-primary)] tracking-tight">Avaliação de Clientes</h2>
          <p className="text-xs text-[var(--text-tertiary)] font-medium mt-1">Indicadores internos preenchidos pelos analistas — nunca visíveis ao cliente.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <MetricCard label="Avaliações" value={String(evaluationsReport?.count ?? 0)} icon={<ClipboardList className="text-[var(--accent-text)]" />} />
          <MetricCard label="Média Geral" value={evaluationsReport ? evaluationsReport.overallAverage.toFixed(1) : '0.0'} icon={<Star size={24} className="text-white" />} accent />
          <MetricCard label="Clientes Desafiadores" value={String(evaluationsReport?.tagDistribution.challenging ?? 0)} icon={<ThumbsDown className="text-[var(--accent-text)]" />} />
        </div>

        {evaluationsReport && evaluationsReport.count > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
            <span>
              {evaluationsReport.countByOrigin.chatClose} de atendimento · {evaluationsReport.countByOrigin.manual} manual{evaluationsReport.countByOrigin.manual === 1 ? '' : 'is'}
            </span>
            {evaluationsReport.count < MIN_RELIABLE_EVALUATION_COUNT && (
              <span className="flex items-center gap-1.5 text-[var(--text-warning)]">
                <AlertTriangle size={11} /> Amostra pequena — a média geral ainda pode não ser representativa
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-[var(--surface-card)] p-8 rounded-2xl border border-[var(--border-default)] shadow-sm">
            <h3 className="font-bold mb-8 uppercase text-[10px] tracking-[0.2em] text-[var(--text-tertiary)]">Distribuição de Perfil</h3>
            <div className="h-64">
              {evaluationTagPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={evaluationTagPieData} innerRadius={60} outerRadius={80} paddingAngle={8} dataKey="value" stroke="none">
                      {evaluationTagPieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-[var(--text-tertiary)]">Nenhuma avaliação ainda</div>
              )}
            </div>
          </div>

          <div className="bg-[var(--surface-card)] p-8 rounded-2xl border border-[var(--border-default)] shadow-sm">
            <h3 className="font-bold mb-4 uppercase text-[10px] tracking-[0.2em] text-[var(--text-tertiary)]">Avaliações Recentes</h3>
            <div className="h-64 overflow-y-auto space-y-2">
              {evaluationsReport?.evaluations.length ? evaluationsReport.evaluations.map(e => {
                const avg = (e.knowledgeScore + e.autonomyScore + e.learningScore + e.engagementScore + e.organizationScore + e.communicationScore) / 6;
                return (
                  <div key={e.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[var(--border-default)] text-sm">
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--text-primary)] truncate">{e.companyName}</p>
                      <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest">
                        Por {e.analystName}{e.contactName && ` · Atendeu ${e.contactName}`} · {new Date(e.createdAt).toLocaleDateString('pt-BR')} · {ORIGIN_LABELS[e.origin]}
                        {e.profileTag && ` · ${TAG_LABELS[e.profileTag]}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 text-amber-400 shrink-0">
                      <Star size={14} fill="currentColor" />
                      <span className="text-xs font-bold text-[var(--text-secondary)]">{avg.toFixed(1)}</span>
                    </div>
                  </div>
                );
              }) : (
                <div className="h-full flex items-center justify-center text-sm text-[var(--text-tertiary)]">Nenhuma avaliação ainda</div>
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
