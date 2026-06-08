'use client';

import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, Clock, Calendar, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-black text-slate-800 tracking-tight">Performance Analítica</h1>
        <button className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-bold shadow-md transition-colors">Exportar PDF</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <MetricCard label="Satisfação" value="4.7" icon={<TrendingUp size={24} className="text-white" />} accent />
        <MetricCard label="Tempo Médio" value="2.4h" icon={<Clock className="text-indigo-600" />} />
        <MetricCard label="SLA" value="98.2%" icon={<Calendar className="text-indigo-600" />} />
        <MetricCard label="Analistas" value="12" icon={<Users className="text-indigo-600" />} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="font-bold mb-8 uppercase text-[10px] tracking-[0.2em] text-slate-400">Volume de Atendimentos</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dataByDay}>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#64748b'}} />
                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#64748b'}} />
                <Tooltip contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}} />
                <Area type="monotone" dataKey="total" stroke="#4f46e5" fill="#4f46e5" fillOpacity={0.1} strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="font-bold mb-8 uppercase text-[10px] tracking-[0.2em] text-slate-400">Distribuição</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={dataByCategory} innerRadius={60} outerRadius={80} paddingAngle={8} dataKey="value" stroke="none">
                  {dataByCategory.map((e: any, i: number) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip />
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
      accent ? "bg-indigo-600 text-white shadow-indigo-200" : "bg-white border border-slate-200"
    )}>
      <div className={cn("p-3 rounded-xl mb-4", accent ? "bg-white/20" : "bg-slate-50")}>{icon}</div>
      <p className={cn("text-[10px] font-black uppercase tracking-widest mb-1", accent ? "opacity-70" : "text-slate-400")}>{label}</p>
      <p className="text-2xl font-black">{value}</p>
    </div>
  );
}
