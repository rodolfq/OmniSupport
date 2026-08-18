'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bot, Save, CheckCircle2, XCircle, RotateCcw, Search, MessageSquareText, Ticket, MessageCircle, Frown, Clock, ListChecks, ArrowUpRight, RefreshCw, History, KeyRound, Trash2 } from 'lucide-react';
// Migrado para rota HTTP (/api/ai-assistant/config) na separação front/back.
import { getAssistantConfig, saveAssistantConfig, getDissatisfactionStats, runDissatisfactionBatchNow } from '@/lib/services/assistant-config-client';
// Só os TIPOS: o seletor de ícone saiu desta tela. Os componentes de preview e
// de recorte continuam existindo no projeto (o widget usa o primeiro), mas não
// são mais montados aqui.
import type { AiAssistantAvatarSource, AvatarCropOverrides } from '@/lib/ai-assistant-avatar-options';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface AssistantConfigData {
  groqApiKeyConfigured: boolean;
  groqApiKeyOverrideConfigured: boolean;
  embeddingsEnabledInEnv: boolean;
  defaultSystemInstruction: string;
  effectiveSystemPrompt: string;
  effectiveModel: string;
  effectiveSemanticSearchEnabled: boolean;
  isPromptCustomized: boolean;
  isModelCustomized: boolean;
  rawSemanticSearchOverride: boolean | null;
  effectiveDissatisfactionDetectorEnabled: boolean;
  rawDissatisfactionDetectorEnabled: boolean | null;
  dissatisfactionExtraInstructions: string;
  avatarSource: AiAssistantAvatarSource;
  avatarCropOverrides: AvatarCropOverrides;
}

interface DissatisfactionStatsData {
  enabled: boolean;
  total: number;
  pending: number;
  analyzed: number;
  detected: number;
  failed: number;
  skipped: number;
  lastActivityAt: string | null;
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
  const [dissatisfactionEnabledDraft, setDissatisfactionEnabledDraft] = useState(false);
  const [dissatisfactionInstructionsDraft, setDissatisfactionInstructionsDraft] = useState('');
  // Sem editor na tela, estes dois só carregam o que está salvo e devolvem o
  // mesmo valor ao gravar. Existem para que salvar QUALQUER outra configuração
  // do agente não zere o ícone que está em uso — a rota grava o objeto inteiro.
  const [avatarSourceDraft, setAvatarSourceDraft] = useState<AiAssistantAvatarSource>('expressive-faces');
  const [avatarCropDraft, setAvatarCropDraft] = useState<AvatarCropOverrides>({});
  // Nunca pré-preenchido com a chave atual (ela não volta do servidor, ver
  // getRawAssistantSettings) — em branco = "não mexe" no save; "Remover"
  // marca clearGroqApiKeyOverride, mas digitar uma chave nova sempre vence
  // (ver cálculo em handleSave).
  const [groqApiKeyDraft, setGroqApiKeyDraft] = useState('');
  const [clearGroqApiKeyOverride, setClearGroqApiKeyOverride] = useState(false);

  const [stats, setStats] = useState<DissatisfactionStatsData | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const loadStats = () => {
    getDissatisfactionStats().then(result => {
      if ('error' in result) {
        setStatsError(result.error as string);
        return;
      }
      setStatsError(null);
      setStats(result as DissatisfactionStatsData);
    });
  };

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
      setDissatisfactionEnabledDraft(cfg.rawDissatisfactionDetectorEnabled ?? cfg.effectiveDissatisfactionDetectorEnabled);
      setDissatisfactionInstructionsDraft(cfg.dissatisfactionExtraInstructions);
      setAvatarSourceDraft(cfg.avatarSource);
      setAvatarCropDraft(cfg.avatarCropOverrides);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    loadStats();
    return () => { cancelled = true; };
  }, []);

  const handleSyncNow = async () => {
    setIsSyncing(true);
    try {
      const result = await runDissatisfactionBatchNow();
      if ('error' in result && result.error) throw new Error(result.error);
      const { processed, requeued } = result as { processed: number; requeued: number };
      if (processed === 0 && requeued === 0) {
        toast.success('Nenhuma conversa pendente para processar.');
      } else {
        const parts = [`${processed} conversa(s) processada(s) agora`];
        if (requeued > processed) parts.push(`mais ${requeued - processed} devolvida(s) à fila — o restante processa sozinho em segundo plano`);
        toast.success(`${parts.join(', ')}.`);
      }
      loadStats();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao sincronizar o detector de insatisfação.');
    } finally {
      setIsSyncing(false);
    }
  };

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
      // Digitar uma chave nova sempre vence sobre "Remover" marcado por
      // engano antes; em branco e sem "Remover" = undefined = não mexe.
      const groqApiKeyUpdate = groqApiKeyDraft.trim()
        ? groqApiKeyDraft.trim()
        : clearGroqApiKeyOverride ? null : undefined;
      const result = await saveAssistantConfig(
        promptOverride,
        modelOverride,
        semanticSearchDraft,
        dissatisfactionEnabledDraft,
        dissatisfactionInstructionsDraft.trim() || null,
        avatarSourceDraft,
        avatarCropDraft,
        groqApiKeyUpdate
      );
      if ('error' in result && result.error) throw new Error(result.error);
      toast.success('Configuração do Agente de IA salva!');
      setGroqApiKeyDraft('');
      setClearGroqApiKeyOverride(false);
      const refreshed = await getAssistantConfig();
      if (!('error' in refreshed)) {
        const cfg = refreshed as AssistantConfigData;
        setData(cfg);
        setPromptDraft(cfg.effectiveSystemPrompt);
        setModelDraft(cfg.effectiveModel);
        setSemanticSearchDraft(cfg.rawSemanticSearchOverride ?? true);
        setDissatisfactionEnabledDraft(cfg.rawDissatisfactionDetectorEnabled ?? cfg.effectiveDissatisfactionDetectorEnabled);
        setDissatisfactionInstructionsDraft(cfg.dissatisfactionExtraInstructions);
      setAvatarSourceDraft(cfg.avatarSource);
      setAvatarCropDraft(cfg.avatarCropOverrides);
      }
      loadStats();
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
      {/* Detector de Insatisfação — progresso do processamento em segundo
          plano (ver lib/services/dissatisfaction-scheduler.ts). */}
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-8 shadow-sm space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-2">
              <Frown className="text-[var(--accent-text)]" size={22} /> Detector de Insatisfação
            </h3>
            <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">
              Resume e classifica cada chat encerrado em segundo plano — ver colunas em Histórico de Conversas
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className={cn(
              "text-[10px] font-black uppercase tracking-widest",
              dissatisfactionEnabledDraft ? "text-[var(--text-success)]" : "text-[var(--text-tertiary)]"
            )}>
              {dissatisfactionEnabledDraft ? 'Ligado' : 'Desligado'}
            </span>
            <div
              onClick={() => setDissatisfactionEnabledDraft(v => !v)}
              title="Liga/desliga o processamento automático em segundo plano — salvar pra aplicar"
              className={cn(
                "w-12 h-6 rounded-full p-1 transition-all shrink-0 cursor-pointer",
                dissatisfactionEnabledDraft ? "bg-[var(--accent)]" : "bg-[var(--border-default)]"
              )}
            >
              <div className={cn(
                "w-4 h-4 rounded-full bg-[var(--surface-card)] shadow-sm transition-transform",
                dissatisfactionEnabledDraft ? "translate-x-6" : "translate-x-0"
              )} />
            </div>
          </div>
        </div>

        {stats && dissatisfactionEnabledDraft !== stats.enabled && (
          <p className="text-[10px] font-bold text-[var(--text-warning)] uppercase tracking-widest">
            Alteração pendente — clique em &ldquo;Salvar&rdquo; no final da página pra {dissatisfactionEnabledDraft ? 'ligar' : 'desligar'} o processamento automático.
          </p>
        )}

        {statsError ? (
          <p className="text-xs text-[var(--text-danger)] font-bold">{statsError}</p>
        ) : !stats ? (
          <p className="text-[var(--text-tertiary)] text-xs font-bold uppercase tracking-widest italic">Carregando estatísticas...</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="p-4 bg-[var(--surface-pill)] rounded-xl space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)] flex items-center gap-1"><Clock size={11} /> Pendentes</p>
                <p className="text-xl font-black text-[var(--text-primary)]">{stats.pending}</p>
              </div>
              <div className="p-4 bg-[var(--surface-pill)] rounded-xl space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)] flex items-center gap-1"><ListChecks size={11} /> Analisadas</p>
                <p className="text-xl font-black text-[var(--text-primary)]">{stats.analyzed}</p>
              </div>
              <div className="p-4 bg-[var(--surface-danger)] rounded-xl space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-danger)] flex items-center gap-1"><Frown size={11} /> Insatisfação</p>
                <p className="text-xl font-black text-[var(--text-danger)]">{stats.detected}</p>
              </div>
              <div className="p-4 bg-[var(--surface-pill)] rounded-xl space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)] flex items-center gap-1"><XCircle size={11} /> Falhas</p>
                <p className={cn("text-xl font-black", stats.failed > 0 ? "text-[var(--text-warning)]" : "text-[var(--text-primary)]")}>{stats.failed}</p>
              </div>
              <div className="p-4 bg-[var(--surface-pill)] rounded-xl space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)] flex items-center gap-1"><History size={11} /> Nunca analisadas</p>
                <p className={cn("text-xl font-black", stats.skipped > 0 ? "text-[var(--text-warning)]" : "text-[var(--text-primary)]")}>{stats.skipped}</p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 flex-wrap pt-2">
              <p className="text-[10px] text-[var(--text-tertiary)] font-semibold uppercase tracking-widest">
                {stats.lastActivityAt
                  ? `Última atividade: ${new Date(stats.lastActivityAt).toLocaleString('pt-BR')}`
                  : 'Nenhum processamento registrado ainda'}
                {' · '}{stats.total} conversa(s) no histórico
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSyncNow}
                  disabled={isSyncing || (stats.pending === 0 && stats.skipped === 0)}
                  title={
                    stats.pending === 0 && stats.skipped === 0
                      ? 'Nenhuma conversa pendente'
                      : stats.skipped > 0
                        ? `Devolve ${stats.skipped} conversa(s) nunca analisada(s) pra fila e processa até 10 agora — o resto continua em segundo plano`
                        : `Processar até ${Math.min(stats.pending, 10)} conversa(s) agora`
                  }
                  className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[var(--accent-text)] bg-[var(--accent)]/10 px-3 py-1.5 rounded-lg hover:bg-[var(--accent)]/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw size={12} className={isSyncing ? 'animate-spin' : ''} />
                  {isSyncing ? 'Sincronizando...' : 'Sincronizar agora'}
                </button>
                <Link
                  href="/chat-history"
                  className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[var(--accent-text)] hover:underline"
                >
                  Ver Histórico de Conversas <ArrowUpRight size={12} />
                </Link>
              </div>
            </div>

            {!stats.enabled && (
              <div className="p-3 bg-[var(--surface-warning)] border border-[var(--border-alert)] rounded-xl">
                <p className="text-[10px] font-bold text-[var(--text-warning)]">
                  Processamento automático desligado — use o toggle acima pra ligar (aplica sem precisar de redeploy). O botão &ldquo;Sincronizar agora&rdquo; funciona mesmo desligado, sob demanda.
                </p>
              </div>
            )}
          </>
        )}

        <div className="space-y-2 pt-2 border-t border-[var(--border-default)]">
          <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Critério adicional de insatisfação (opcional)</label>
          <textarea
            value={dissatisfactionInstructionsDraft}
            onChange={(e) => setDissatisfactionInstructionsDraft(e.target.value)}
            rows={4}
            placeholder="Ex: considere insatisfação também quando o cliente pedir reembolso ou mencionar cancelamento do contrato."
            className="w-full bg-[var(--surface-pill)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-xs font-mono text-[var(--text-primary)] leading-relaxed focus:ring-4 focus:ring-[var(--accent)]/10 focus:border-[var(--accent)] outline-none transition-all"
          />
          <p className="text-[10px] text-[var(--text-tertiary)] font-medium">Acrescentado ao prompt de classificação, sem substituir o formato JSON nem a taxonomia de departamento/categoria.</p>
        </div>
      </div>

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
            <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">Chave Groq</p>
            <p className={cn("text-xs font-bold flex items-center gap-1.5", (data.groqApiKeyOverrideConfigured || data.groqApiKeyConfigured) ? "text-[var(--text-success)]" : "text-[var(--text-danger)]")}>
              {(data.groqApiKeyOverrideConfigured || data.groqApiKeyConfigured) ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              {data.groqApiKeyOverrideConfigured ? 'Customizada (Configurações)' : data.groqApiKeyConfigured ? 'Configurada (.env)' : 'Não configurada'}
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

        {/* Trocar a chave Groq — sobrescreve o GROQ_API_KEY do .env sem
            precisar editar arquivo nem redeployar (ver lib/groq-client.ts).
            A chave atual nunca é reenviada pro browser (nem mascarada) —
            este campo é sempre "escreva pra trocar", nunca mostra o valor
            salvo. Ficou "atingiu o limite"/"não foi possível falar com o
            assistente" no widget quando a chave configurada foi rejeitada
            pelo provedor (ver app/api/ai-assistant/route.ts) — trocar por
            aqui é o jeito rápido de recuperar sem depender de deploy. */}
        <div className="pt-4 border-t border-[var(--border-default)] space-y-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1 flex items-center gap-1.5">
            <KeyRound size={12} /> Trocar chave da API Groq
          </label>
          <div className="flex items-center gap-2 max-w-md">
            <input
              type="password"
              autoComplete="off"
              value={groqApiKeyDraft}
              onChange={(e) => { setGroqApiKeyDraft(e.target.value); if (e.target.value) setClearGroqApiKeyOverride(false); }}
              placeholder={data.groqApiKeyOverrideConfigured ? 'Já customizada — digite uma nova pra trocar' : 'gsk_... (deixe em branco pra manter a do .env)'}
              className="flex-1 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
            />
            {data.groqApiKeyOverrideConfigured && (
              <button
                type="button"
                onClick={() => { setClearGroqApiKeyOverride(v => !v); setGroqApiKeyDraft(''); }}
                title="Remover a chave customizada — volta a usar GROQ_API_KEY do .env"
                className={cn(
                  "shrink-0 p-3 rounded-xl border transition-all",
                  clearGroqApiKeyOverride
                    ? "bg-[var(--surface-danger)] border-[var(--border-alert)] text-[var(--text-danger)]"
                    : "border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-danger)] hover:bg-[var(--surface-danger)]"
                )}
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
          {clearGroqApiKeyOverride && !groqApiKeyDraft && (
            <p className="text-[10px] font-bold text-[var(--text-warning)] uppercase tracking-widest">
              Marcado pra remover — ao salvar, volta a usar a chave do .env deste servidor.
            </p>
          )}
          <p className="text-[10px] text-[var(--text-tertiary)] font-medium">
            Nunca mostrada de novo depois de salva, por segurança — gere uma chave nova em{' '}
            <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="text-[var(--accent-text)] underline">console.groq.com/keys</a>.
          </p>
        </div>
      </div>

      {/* O bloco "Ícone do agente" (seletor + editor de enquadramento) foi
          removido a pedido: a escolha está fechada e vive agora em
          DEFAULT_AI_ASSISTANT_AVATAR, em lib/ai-assistant-avatar-options.ts,
          junto do enquadramento que estava salvo. Manter editável só abria
          espaço para o widget mudar de cara sem intenção. Trocar o ícone
          passou a ser uma linha de código, não uma opção de tela. */}

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
            placeholder="Ex: openai/gpt-oss-120b"
            className="w-full max-w-md bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
          />
          <p className="text-[10px] text-[var(--text-tertiary)] font-medium">
            Nome exato do modelo na Groq — lista muda com frequência, por isso é texto livre. Modelos atuais em{' '}
            <a href="https://console.groq.com/docs/models" target="_blank" rel="noopener noreferrer" className="text-[var(--accent-text)] underline">console.groq.com/docs/models</a>.
          </p>
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
