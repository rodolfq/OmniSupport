'use client';

import React from 'react';
import { Plus, Trash2, Star } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export function SystemConfigContent({ categories, priorities, requestTypes, products, setCategories, setPriorities, setRequestTypes, setProducts, surveySettings, setSurveySettings }: any) {
  const [newCatLabel, setNewCatLabel] = React.useState('');

  const addCategory = async () => {
    if (!newCatLabel) return;
    const label = newCatLabel;
    setNewCatLabel('');
    await supabase.from('config_categories').insert({ label });
    // Reconsulta a lista em vez de confiar só na resposta do insert: se a
    // resposta se perder por uma falha transitória de rede (o insert já
    // pode ter sido gravado), isso evita um erro falso e a necessidade de
    // recarregar a tela pra ver o item novo.
    const { data } = await supabase.from('config_categories').select('*');
    if (data) {
      setCategories(data);
      if (data.some((c: any) => c.label === label)) {
        toast.success('Categoria adicionada');
      } else {
        toast.error('Erro ao adicionar categoria');
      }
    } else {
      toast.error('Erro ao adicionar categoria');
    }
  };

  const deleteCategory = async (id: string) => {
    const { error } = await supabase.from('config_categories').delete().eq('id', id);
    if (!error) { setCategories(categories.filter((c: any) => c.id !== id)); toast.success('Categoria removida'); }
  };

  const [newReqTypeLabel, setNewReqTypeLabel] = React.useState('');

  const addRequestType = async () => {
    if (!newReqTypeLabel) return;
    const label = newReqTypeLabel;
    setNewReqTypeLabel('');
    await supabase.from('config_request_types').insert({ label });
    // Mesma lógica de reconsulta do addCategory — ver comentário lá.
    const { data } = await supabase.from('config_request_types').select('*');
    if (data) {
      setRequestTypes(data);
      if (data.some((r: any) => r.label === label)) {
        toast.success('Tipo de solicitação adicionado');
      } else {
        toast.error('Erro ao adicionar tipo de solicitação');
      }
    } else {
      toast.error('Erro ao adicionar tipo de solicitação');
    }
  };

  const deleteRequestType = async (id: string) => {
    const { error } = await supabase.from('config_request_types').delete().eq('id', id);
    if (!error) { setRequestTypes(requestTypes.filter((r: any) => r.id !== id)); toast.success('Tipo de solicitação removido'); }
  };

  const [newProductLabel, setNewProductLabel] = React.useState('');

  const addProduct = async () => {
    if (!newProductLabel) return;
    const label = newProductLabel;
    setNewProductLabel('');
    await supabase.from('config_products').insert({ label });
    // Mesma lógica de reconsulta do addCategory — ver comentário lá.
    const { data } = await supabase.from('config_products').select('*');
    if (data) {
      setProducts(data);
      if (data.some((p: any) => p.label === label)) {
        toast.success('Produto adicionado');
      } else {
        toast.error('Erro ao adicionar produto');
      }
    } else {
      toast.error('Erro ao adicionar produto');
    }
  };

  const deleteProduct = async (id: string) => {
    const { error } = await supabase.from('config_products').delete().eq('id', id);
    if (!error) { setProducts(products.filter((p: any) => p.id !== id)); toast.success('Produto removido'); }
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
      const { data, error } = await supabase
        .from('config_priorities')
        .update({ sla_hours: hours })
        .eq('id', priority.id)
        .single();
      if (error) { 
        toast.error('Erro ao atualizar SLA'); 
        console.error('Update error:', error);
      }
      else {
        console.log(`✅ SLA de ${label} atualizado com sucesso no Supabase`);
        const persistedHours = Number(data?.sla_hours);
        if (persistedHours !== hours) {
          toast.error('O SLA não foi confirmado no banco. Tente novamente.');
          return;
        }
        setPriorities(priorities.map((p: any) => p.id === priority.id ? { ...p, sla_hours: persistedHours } : p));
        toast.success(`SLA de ${label} atualizado para ${days} dias`);
      }
    } else {
      const { data, error } = await supabase.from('config_priorities').insert({ label, sla_hours: hours, color: 'bg-[var(--surface-pill)] text-[var(--text-secondary)]' }).select();
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

  const [surveyEnabled, setSurveyEnabled] = React.useState(true);
  const [surveyMessage, setSurveyMessage] = React.useState('');
  const [surveyWindowHours, setSurveyWindowHours] = React.useState(24);

  React.useEffect(() => {
    if (surveySettings) {
      setSurveyEnabled(surveySettings.enabled ?? true);
      setSurveyMessage(surveySettings.message ?? '');
      setSurveyWindowHours(surveySettings.response_window_hours ?? surveySettings.responseWindowHours ?? 24);
    }
  }, [surveySettings]);

  const handleSaveSurvey = async () => {
    const { data, error } = await supabase
      .from('config_survey_settings')
      .update({
        enabled: surveyEnabled,
        message: surveyMessage,
        response_window_hours: surveyWindowHours
      })
      .eq('id', 1)
      .select();
    if (error) {
      toast.error('Erro ao salvar pesquisa de satisfação');
    } else {
      setSurveySettings((data && data[0]) || null);
      toast.success('Pesquisa de satisfação atualizada');
    }
  };

  return (
    <>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border-t border-[var(--border-default)] pt-8 mt-8">
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-tight">Categorias</h4>
        <div className="flex items-center gap-2">
          <input value={newCatLabel} onChange={e => setNewCatLabel(e.target.value)} placeholder="Nova categoria..." className="flex-1 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2 text-sm" />
          <button onClick={addCategory} className="shrink-0 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white p-2 rounded-xl transition-colors"><Plus size={18}/></button>
        </div>
        <div className="bg-[var(--surface-card)] rounded-2xl p-4 space-y-2">
          {categories.map((c: any) => (
            <div key={c.id} className="flex justify-between items-center bg-[var(--surface-card)] p-3 rounded-lg border border-[var(--border-default)] text-sm font-medium">
              {c.label}
              <button onClick={() => deleteCategory(c.id)} className="text-[var(--text-danger)] hover:opacity-70 transition-opacity"><Trash2 size={16}/></button>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-tight">Tipos de Solicitação</h4>
        <div className="flex items-center gap-2">
          <input value={newReqTypeLabel} onChange={e => setNewReqTypeLabel(e.target.value)} placeholder="Novo tipo de solicitação..." className="flex-1 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2 text-sm" />
          <button onClick={addRequestType} className="shrink-0 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white p-2 rounded-xl transition-colors"><Plus size={18}/></button>
        </div>
        <div className="bg-[var(--surface-card)] rounded-2xl p-4 space-y-2">
          {requestTypes.map((r: any) => (
            <div key={r.id} className="flex justify-between items-center bg-[var(--surface-card)] p-3 rounded-lg border border-[var(--border-default)] text-sm font-medium">
              {r.label}
              <button onClick={() => deleteRequestType(r.id)} className="text-[var(--text-danger)] hover:opacity-70 transition-opacity"><Trash2 size={16}/></button>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-tight">Produtos</h4>
        <div className="flex items-center gap-2">
          <input value={newProductLabel} onChange={e => setNewProductLabel(e.target.value)} placeholder="Novo produto..." className="flex-1 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2 text-sm" />
          <button onClick={addProduct} className="shrink-0 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white p-2 rounded-xl transition-colors"><Plus size={18}/></button>
        </div>
        <div className="bg-[var(--surface-card)] rounded-2xl p-4 space-y-2">
          {products.map((p: any) => (
            <div key={p.id} className="flex justify-between items-center bg-[var(--surface-card)] p-3 rounded-lg border border-[var(--border-default)] text-sm font-medium">
              {p.label}
              <button onClick={() => deleteProduct(p.id)} className="text-[var(--text-danger)] hover:opacity-70 transition-opacity"><Trash2 size={16}/></button>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-tight">Prioridades (SLA)</h4>
        <div className="bg-[var(--surface-card)] rounded-2xl p-4 space-y-3">
          {priorityLabels.map((label, index) => {
            const priority = priorities.find((p: any) => p.label === label);
            const rawSlaHours = priority ? (priority.sla_hours || 24) : 24;
            const currentVal = slaValues[label] ?? Math.round(rawSlaHours / 24);

            return (
              <div key={label} className="bg-[var(--surface-card)] p-4 rounded-xl border border-[var(--border-default)] flex items-center justify-between gap-4 shadow-sm">
                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex">
                    {[0, 1, 2, 3].map((s) => (
                      <Star
                        key={s}
                        size={14}
                        className={index >= s ? "fill-amber-400 text-[var(--text-warning)]" : "text-[var(--border-strong)]"}
                      />
                    ))}
                  </div>
                  <span className="text-xs font-bold text-[var(--text-secondary)]">{label}</span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex items-center gap-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg px-2.5 py-1.5">
                    <input
                       type="number"
                       step="1"
                       min="1"
                       value={currentVal}
                       onChange={(e) => {
                         const val = parseInt(e.target.value) || 1;
                         setSlaValues(prev => ({ ...prev, [label]: val }));
                       }}
                       className="w-8 bg-transparent text-xs font-bold focus:outline-none"
                    />
                    <span className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase">dias</span>
                  </div>

                  <button
                    onClick={() => handleSaveSLA(label)}
                    className="text-[10px] font-semibold uppercase text-[var(--accent-text)] hover:bg-[var(--accent)]/10 px-3 py-1.5 rounded-lg border border-[var(--accent)]/20 transition-colors"
                  >
                    Salvar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-[var(--text-tertiary)] font-medium px-2 italic">
          * O SLA define o tempo máximo para atendimento em dias inteiros.
        </p>
      </div>
    </div>

    <div className="border-t border-[var(--border-default)] pt-8 mt-8 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-tight">Pesquisa de Satisfação</h4>
        <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={surveyEnabled}
            onChange={(e) => setSurveyEnabled(e.target.checked)}
            className="w-4 h-4 accent-[var(--accent)]"
          />
          Ativar ao finalizar conversa
        </label>
      </div>
      <div className="bg-[var(--surface-card)] rounded-2xl p-4 space-y-4 border border-[var(--border-default)]">
        <div className="space-y-2">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">Mensagem enviada ao cliente</label>
          <textarea
            value={surveyMessage}
            onChange={(e) => setSurveyMessage(e.target.value)}
            rows={4}
            className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm resize-y"
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg px-2.5 py-1.5">
            <input
              type="number"
              step="1"
              min="1"
              value={surveyWindowHours}
              onChange={(e) => setSurveyWindowHours(parseInt(e.target.value) || 1)}
              className="w-14 bg-transparent text-xs font-bold focus:outline-none"
            />
            <span className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase">horas para aceitar resposta</span>
          </div>
          <button
            onClick={handleSaveSurvey}
            className="text-[10px] font-semibold uppercase text-[var(--accent-text)] hover:bg-[var(--accent)]/10 px-3 py-1.5 rounded-lg border border-[var(--accent)]/20 transition-colors"
          >
            Salvar
          </button>
        </div>
      </div>
      <p className="text-[10px] text-[var(--text-tertiary)] font-medium px-2 italic">
        * Enviada por WhatsApp junto com o aviso de encerramento. O cliente responde "1" (satisfeito) ou "0" (poderia ser melhor) dentro do prazo configurado.
      </p>
    </div>
    </>
  );
}


