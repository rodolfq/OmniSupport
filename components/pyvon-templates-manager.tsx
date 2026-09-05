"use client";

import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, X, Loader2, FileText } from 'lucide-react';
import { getPyvonTemplates, savePyvonTemplate, deletePyvonTemplate, PyvonTemplate, PyvonTemplateVariable } from '@/lib/services/pyvon-template-service';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { toast } from 'sonner';

const EMPTY_FORM = { id: null as string | null, templateName: '', language: 'pt_BR', description: '', variablesSchema: [] as PyvonTemplateVariable[], isActive: true };

/**
 * Cadastro dos templates HSM aprovados na Meta que o Pyvon pode usar pra
 * iniciar conversa fora da janela de 24h (§7 do contrato) — o Pyvon não
 * expõe uma forma de listar isso por API, então fica manual aqui, combinado
 * com quem administra a WABA.
 */
export function PyvonTemplatesManager() {
  const [templates, setTemplates] = useState<PyvonTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async () => {
    setTemplates(await getPyvonTemplates());
    setIsLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(EMPTY_FORM); setIsEditing(true); };
  const openEdit = (t: PyvonTemplate) => {
    setForm({ id: t.id, templateName: t.templateName, language: t.language, description: t.description, variablesSchema: t.variablesSchema, isActive: t.isActive });
    setIsEditing(true);
  };

  const addVariable = () => setForm(prev => ({ ...prev, variablesSchema: [...prev.variablesSchema, { key: '', label: '' }] }));
  const updateVariable = (idx: number, field: 'key' | 'label', value: string) => {
    setForm(prev => ({ ...prev, variablesSchema: prev.variablesSchema.map((v, i) => i === idx ? { ...v, [field]: value } : v) }));
  };
  const removeVariable = (idx: number) => setForm(prev => ({ ...prev, variablesSchema: prev.variablesSchema.filter((_, i) => i !== idx) }));

  const handleSave = async () => {
    if (!form.templateName.trim()) {
      toast.error('Informe o nome do template (o mesmo aprovado na Meta).');
      return;
    }
    setIsSaving(true);
    try {
      const result = await savePyvonTemplate(form);
      if (result.error) throw new Error(result.error);
      toast.success('Template salvo!');
      setIsEditing(false);
      load();
    } catch (e: any) {
      toast.error(e.message || 'Erro ao salvar template.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const result = await deletePyvonTemplate(id);
    if (result.error) toast.error(result.error);
    else { toast.success('Template excluído.'); load(); }
    setDeletingId(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
          <FileText size={14} />
          <p className="text-[10px] font-black uppercase tracking-widest">Templates de WhatsApp (Pyvon)</p>
        </div>
        {!isEditing && (
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[var(--accent-text)] bg-[var(--accent)]/10 px-3 py-1.5 rounded-lg hover:bg-[var(--accent)]/20 transition-all"
          >
            <Plus size={13} /> Novo Template
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-xs text-[var(--text-tertiary)] font-medium">Carregando templates...</p>
      ) : isEditing ? (
        <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-3xl p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Nome do Template (Meta)</label>
              <input
                type="text"
                value={form.templateName}
                onChange={(e) => setForm(prev => ({ ...prev, templateName: e.target.value }))}
                placeholder="Ex: veiculo_sem_posicao"
                className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Idioma</label>
              <input
                type="text"
                value={form.language}
                onChange={(e) => setForm(prev => ({ ...prev, language: e.target.value }))}
                placeholder="pt_BR"
                className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Descrição (uso interno)</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Ex: aviso de veículo sem posição"
              className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Variáveis</label>
              <button type="button" onClick={addVariable} className="text-[9px] font-bold uppercase text-[var(--accent-text)] hover:underline flex items-center gap-1">
                <Plus size={10} /> Adicionar
              </button>
            </div>
            <p className="text-[10px] text-[var(--text-tertiary)] ml-1">
              &quot;Chave&quot; é como o template espera (numérica <span className="font-mono">1</span>, <span className="font-mono">2</span>... ou nomeada <span className="font-mono">nome_unidade</span>) — não misture os dois formatos no mesmo template.
            </p>
            {form.variablesSchema.map((v, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <input
                  type="text"
                  value={v.key}
                  onChange={(e) => updateVariable(idx, 'key', e.target.value)}
                  placeholder="Chave (ex: 1)"
                  className="w-28 shrink-0 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
                />
                <input
                  type="text"
                  value={v.label}
                  onChange={(e) => updateVariable(idx, 'label', e.target.value)}
                  placeholder="Rótulo (ex: Nome do cliente)"
                  className="flex-1 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
                />
                <button type="button" onClick={() => removeVariable(idx)} className="p-2 text-[var(--text-tertiary)] hover:text-[var(--text-danger)]">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 py-3 bg-[var(--accent)] text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-md hover:bg-[var(--accent-hover)] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {isSaving && <Loader2 size={14} className="animate-spin" />}
              {form.id ? 'Salvar Alterações' : 'Criar Template'}
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="py-3 px-4 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] text-xs font-black uppercase tracking-widest transition-all"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : templates.length === 0 ? (
        <div className="p-6 text-center bg-[var(--surface-card)] rounded-2xl border border-dashed border-[var(--border-default)]">
          <p className="text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-widest">Nenhum template cadastrado</p>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-1">Cadastre aqui os templates já aprovados na Meta pra poder iniciar conversa fora da janela de 24h.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map(t => (
            <div key={t.id} className="flex items-center justify-between gap-3 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs font-black text-[var(--text-primary)] font-mono truncate">{t.templateName}</p>
                <p className="text-[10px] text-[var(--text-tertiary)] font-medium truncate">{t.description || 'Sem descrição'} • {t.language} • {t.variablesSchema.length} variável(is){!t.isActive ? ' • inativo' : ''}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => openEdit(t)} className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:bg-[var(--accent)]/10 transition-all" title="Editar">
                  <Pencil size={14} />
                </button>
                <button onClick={() => setDeletingId(t.id)} className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-danger)] hover:bg-[var(--surface-danger)] transition-all" title="Excluir">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deletingId}
        onClose={() => setDeletingId(null)}
        onConfirm={() => deletingId && handleDelete(deletingId)}
        title="Excluir template?"
        description="Isso remove o cadastro deste template — ele deixa de aparecer na tela de iniciar conversa."
        confirmLabel="Excluir"
        variant="danger"
      />
    </div>
  );
}
