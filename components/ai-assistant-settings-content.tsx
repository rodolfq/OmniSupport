'use client';

import React, { useEffect, useState } from 'react';
import { Bot, Save, CheckCircle2, XCircle, RotateCcw, Search, MessageSquareText, Ticket, MessageCircle } from 'lucide-react';
import { getAssistantConfig, saveAssistantConfig } from '@/app/actions';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface AssistantConfigData {
  groqApiKeyConfigured: boolean;
  embeddingsEnabledInEnv: boolean;
  defaultSystemInstruction: string;
  effectiveSystemPrompt: string;
  effectiveModel: string;
  effectiveSemanticSearchEnabled: boolean;
  isPromptCustomized: boolean;
  isModelCustomized: boolean;
  rawSemanticSearchOverride: boolean | null;
}

const SOURCES = [
  { icon: Ticket, label: 'Chamados' },
  { icon: MessageSquareText, label: 'Tickets internos (dev/infra/QA/produto)' },
  { icon: MessageCircle, label: 'Chat com cliente' },
  { icon: MessageCircle, label: 'Chat interno da equipe' }
];

export function AiAssistantSettingsContent() {
  const [data, setData] = useState<AssistantConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [promptDraft, setPromptDraft] = useState('');
  const [modelDraft, setModelDraft] = useState('');
  const [semanticSearchDraft, setSemanticSearchDraft] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getAssistantConfig().then(result => {
      if (cancelled) return;
      if ('error' in result) {
        setLoadError(result.error as string);
        return;
      }
      const cfg = result as AssistantConfigData;
      setData(cfg);
      setPromptDraft(cfg.effectiveSystemPrompt);
      setModelDraft(cfg.effectiveModel);
      setSemanticSearchDraft(cfg.rawSemanticSearchOverride ?? true);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const handleRestoreDefault = () => {
    if (!data) return;
    setPromptDraft(data.defaultSystemInstruction);
  };

  const handleSave = async () => {
    if (!data) return;
    setSaving(true);
    try {
      // Prompt/modelo iguais ao padrão viram override=null (não fica um
      // "customizado" fantasma no banco só porque o texto bate por acaso).
      const promptOverride = promptDraft.trim() && promptDraft.trim() !== data.defaultSystemInstruction.trim() ? promptDraft.trim() : null;
      const modelOverride = modelDraft.trim() || null;
      const result = await saveAssistantConfig(promptOverride, modelOverride, semanticSearchDraft);
      if ('error' in result && result.error) throw new Error(result.error);
      toast.success('Configuração do Agente de IA salva!');
      const refreshed = await getAssistantConfig();
      if (!('error' in refreshed)) {
        const cfg = refreshed as AssistantConfigData;
        setData(cfg);
        setPromptDraft(cfg.effectiveSystemPrompt);
        setModelDraft(cfg.effectiveModel);
        setSemanticSearchDraft(cfg.rawSemanticSearchOverride ?? true);
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar configuração do Agente de IA.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-8 shadow-sm">
        <p className="text-[var(--text-tertiary)] text-xs font-bold uppercase tracking-widest italic">Carregando...</p>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-8 shadow-sm">
        <p className="text-[var(--text-danger)] text-sm font-bold">{loadError || 'Não foi possível carregar a configuração do Agente de IA.'}</p>
      </div>
    );
  }

  const embeddingsToggleDisabled = !data.embeddingsEnabledInEnv;

  return (
    <div className="space-y-6">
      {/* Documentação / status */}
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-8 shadow-sm space-y-6">
        <div>
          <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-2">
            <Bot className="text-[var(--accent-text)]" size={24} /> Agente de IA
          </h3>
          <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">
            Widget flutuante que responde perguntas de analistas buscando em 4 fontes de dados do sistema
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {SOURCES.map(s => (
            <div key={s.label} className="flex items-center gap-2.5 p-3 bg-[var(--surface-pill)] rounded-xl">
              <s.icon size={15} className="text-[var(--text-tertiary)] shrink-0" />
              <span className="text-xs font-semibold text-[var(--text-secondary)]">{s.label}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-[var(--border-default)]">
          <div className="pt-4 space-y-1">
            <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">Chave Groq (GROQ_API_KEY)</p>
            <p className={cn("text-xs font-bold flex items-center gap-1.5", data.groqApiKeyConfigured ? "text-[var(--text-success)]" : "text-[var(--text-danger)]")}>
              {data.groqApiKeyConfigured ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              {data.groqApiKeyConfigured ? 'Configurada' : 'Não configurada'}
            </p>
          </div>
          <div className="pt-4 space-y-1">
            <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">Modelo em uso</p>
            <p className="text-xs font-bold text-[var(--text-primary)] font-mono">{data.effectiveModel}</p>
          </div>
          <div className="pt-4 space-y-1">
            <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">Busca semântica</p>
            <p className={cn("text-xs font-bold flex items-center gap-1.5", data.effectiveSemanticSearchEnabled ? "text-[var(--text-success)]" : "text-[var(--text-tertiary)]")}>
              {data.effectiveSemanticSearchEnabled ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              {data.effectiveSemanticSearchEnabled ? 'Ligada' : embeddingsToggleDisabled ? 'Desligada neste servidor' : 'Desligada'}
            </p>
          </div>
        </div>
      </div>

      {/* Prompt */}
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-8 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h4 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-tight">Prompt do sistema</h4>
            <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">
              Muda o comportamento do agente pra todo mundo, imediatamente
            </p>
          </div>
          <button
            onClick={handleRestoreDefault}
            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[var(--accent-text)] hover:underline shrink-0"
          >
            <RotateCcw size={12} /> Restaurar padrão
          </button>
        </div>
        <textarea
          value={promptDraft}
          onChange={(e) => setPromptDraft(e.target.value)}
          rows={12}
          className="w-full bg-[var(--surface-pill)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-xs font-mono text-[var(--text-primary)] leading-relaxed focus:ring-4 focus:ring-[var(--accent)]/10 focus:border-[var(--accent)] outline-none transition-all"
        />
      </div>

      {/* Modelo + busca semântica */}
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-8 shadow-sm space-y-6">
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Modelo Groq</label>
          <input
            type="text"
            value={modelDraft}
            onChange={(e) => setModelDraft(e.target.value)}
            placeholder="Ex: llama-3.3-70b-versatile"
            className="w-full max-w-md bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
          />
          <p className="text-[10px] text-[var(--text-tertiary)] font-medium">Nome exato do modelo na Groq — lista muda com frequência, por isso é texto livre.</p>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-[var(--border-default)]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--surface-pill)] flex items-center justify-center text-[var(--text-tertiary)] shrink-0">
              <Search size={15} />
            </div>
            <div>
              <p className="text-[11px] font-black text-[var(--text-primary)] uppercase tracking-wider">Busca semântica</p>
              <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest">
                {embeddingsToggleDisabled
                  ? 'ENABLE_AI_EMBEDDINGS está desligado neste servidor — não é possível ligar por aqui'
                  : 'Permite o agente usar semantic_search além da busca por palavra-chave'}
              </p>
            </div>
          </div>
          <div
            onClick={() => { if (!embeddingsToggleDisabled) setSemanticSearchDraft(v => !v); }}
            title={embeddingsToggleDisabled ? 'Desligado no ambiente (.env) — configuração aqui não tem efeito' : undefined}
            className={cn(
              "w-12 h-6 rounded-full p-1 transition-all shrink-0",
              embeddingsToggleDisabled ? "opacity-40 cursor-not-allowed bg-[var(--border-default)]" : "cursor-pointer",
              !embeddingsToggleDisabled && (semanticSearchDraft ? "bg-[var(--accent)]" : "bg-[var(--border-default)]")
            )}
          >
            <div className={cn(
              "w-4 h-4 rounded-full bg-[var(--surface-card)] shadow-sm transition-transform",
              !embeddingsToggleDisabled && semanticSearchDraft ? "translate-x-6" : "translate-x-0"
            )} />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-3 bg-[var(--accent)] text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-md hover:bg-[var(--accent-hover)] transition-all disabled:opacity-60"
        >
          <Save size={14} /> {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}
