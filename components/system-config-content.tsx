'use client';

import React from 'react';
import { Plus, Trash2, Star } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export function SystemConfigContent({ categories, priorities, setCategories, setPriorities }: any) {
  const [newCatLabel, setNewCatLabel] = React.useState('');

  const addCategory = async () => {
    if (!newCatLabel) return;
    const { data, error } = await supabase.from('config_categories').insert({ label: newCatLabel }).select();
    if (error) { toast.error('Erro ao adicionar categoria'); }
    else { setCategories([...categories, data[0]]); setNewCatLabel(''); toast.success('Categoria adicionada'); }
  };
  
  const deleteCategory = async (id: string) => {
    const { error } = await supabase.from('config_categories').delete().eq('id', id);
    if (!error) { setCategories(categories.filter((c: any) => c.id !== id)); toast.success('Categoria removida'); }
  };

  const [slaValues, setSlaValues] = React.useState<Record<string, number>>({});

  React.useEffect(() => {
    const initialValues: Record<string, number> = {};
    priorities.forEach((p: any) => {
      initialValues[p.label] = Math.round(p.sla_hours / 24);
    });
    setSlaValues(initialValues);
  }, [priorities]);

  const handleSaveSLA = async (label: string) => {
    const days = slaValues[label] || 1;
    const hours = days * 24;
    const priority = priorities.find((p: any) => p.label === label);

    console.log(`💾 Salvando SLA para ${label}: ${days} dias (${hours} horas)`);

    if (priority) {
      const { error } = await supabase.from('config_priorities').update({ sla_hours: hours }).eq('id', priority.id);
      if (error) { 
        toast.error('Erro ao atualizar SLA'); 
        console.error('Update error:', error);
      }
      else {
        console.log(`✅ SLA de ${label} atualizado com sucesso no Supabase`);
        setPriorities(priorities.map((p: any) => p.id === priority.id ? { ...p, sla_hours: hours } : p));
        toast.success(`SLA de ${label} atualizado para ${days} dias`);
      }
    } else {
      const { data, error } = await supabase.from('config_priorities').insert({ label, sla_hours: hours, color: 'bg-slate-100 text-slate-600' }).select();
      if (error) { 
        toast.error('Erro ao ativar prioridade');
        console.error('Insert error:', error);
      }
      else if (data) {
        setPriorities([...priorities, data[0]]);
        toast.success(`${label} ativado com ${days} dias`);
      }
    }
  };

  const priorityLabels = ['Baixa', 'Média', 'Alta', 'Urgente'];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 border-t border-slate-200 pt-8 mt-8">
      <div className="space-y-4">
        <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">Categorias</h4>
        <div className="flex gap-2">
          <input value={newCatLabel} onChange={e => setNewCatLabel(e.target.value)} placeholder="Nova categoria..." className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm" />
          <button onClick={addCategory} className="bg-slate-900 text-white p-2 rounded-xl"><Plus size={18}/></button>
        </div>
        <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
          {categories.map((c: any) => (
            <div key={c.id} className="flex justify-between items-center bg-white p-3 rounded-lg border border-slate-100 text-sm font-medium">
              {c.label}
              <button onClick={() => deleteCategory(c.id)} className="text-red-500"><Trash2 size={16}/></button>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">Prioridades (SLA)</h4>
        <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
          {priorityLabels.map((label, index) => {
            const priority = priorities.find((p: any) => p.label === label);
            const rawSlaHours = priority ? (priority.sla_hours || 24) : 24;
            const currentVal = slaValues[label] ?? Math.round(rawSlaHours / 24);

            return (
              <div key={label} className="bg-white p-4 rounded-xl border border-slate-100 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex">
                    {[0, 1, 2, 3].map((s) => (
                      <Star 
                        key={s} 
                        size={14} 
                        className={index >= s ? "fill-amber-400 text-amber-400" : "text-slate-200"} 
                      />
                    ))}
                  </div>
                  <span className="text-xs font-bold text-slate-700">{label}</span>
                </div>
                
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2 shrink-0">
                    <input 
                       type="number" 
                       step="1"
                       min="1"
                       value={currentVal} 
                       onChange={(e) => {
                         const val = parseInt(e.target.value) || 1;
                         setSlaValues(prev => ({ ...prev, [label]: val }));
                       }}
                       className="w-10 bg-transparent text-xs font-bold py-1 focus:outline-none"
                    />
                    <span className="text-[10px] font-bold text-slate-400 uppercase">dias</span>
                  </div>
                  
                  <button 
                    onClick={() => handleSaveSLA(label)}
                    className="text-[10px] font-black uppercase text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 transition-colors"
                  >
                    Salvar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-400 font-medium px-2 italic">
          * O SLA define o tempo máximo para atendimento em dias inteiros.
        </p>
      </div>
    </div>
  );
}


