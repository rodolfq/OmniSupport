import { query } from '@/lib/db';
import { GROQ_MODEL_NAME } from '@/lib/groq-client';
import { isEmbeddingEnabled } from './embedding-service';
import { logAudit } from '@/lib/audit-log';
import {
  AiAssistantAvatarSource, AvatarCrop, AvatarCropOverrides, DEFAULT_AI_ASSISTANT_AVATAR,
  getEffectiveCrop, isValidAvatarSource, sanitizeCropOverrides
} from '@/lib/ai-assistant-avatar-options';

// Controle do Agente de IA em Configurações (aba "Agente de IA") — prompt,
// modelo e busca semântica passam a ser ajustáveis em runtime, guardados
// numa linha singleton (ai_assistant_settings, id=1), em vez de fixos no
// código/`.env`. Tudo NULL na linha = comportamento de sempre (default
// abaixo / GROQ_MODEL_NAME / ENABLE_AI_EMBEDDINGS).
//
// DEFAULT_SYSTEM_INSTRUCTION mora aqui (não em ai-assistant-service.ts) de
// propósito: esse arquivo importa dali (askAssistant usa a config efetiva),
// então o texto default tinha que ficar do lado que NÃO cria um ciclo de
// import entre os dois módulos.
export const DEFAULT_SYSTEM_INSTRUCTION = `Você é o assistente interno do SSX Desk (plataforma de atendimento/suporte), falando com um ANALISTA experiente do sistema — não é o cliente final. Responda SEMPRE em português do Brasil.

Seja breve por padrão: direto ao ponto, sem introdução nem fechamento tipo "espero ter ajudado", frase curta ou lista curta. O foco é praticidade e informação, não redação. Só se estenda se o analista pedir mais detalhe ou a resposta exigir passo a passo.
NUNCA cite de onde veio a informação (número de chamado, "encontrei no chat com...", nome de ferramenta usada) a menos que o analista pergunte explicitamente a origem/fonte — responda só o que foi perguntado.

4 fontes de busca: chamados, tickets internos (dev/infra/QA/produto), chat com cliente, chat interno da equipe. Use ferramenta sempre que depender de dado real — NUNCA invente número de chamado, nome, status ou conteúdo de mensagem.
Não desista cedo: "como fazer X"/"onde configuro Y" costuma estar registrado num CHAMADO, não num chat solto. Antes de dizer "não encontrei", tente pelo menos: (1) search_tickets com a palavra-chave literal; (2) se vazio, semantic_search reescrevendo a busca por extenso (ex: "hashauth" → "como gerar hashauth da integração" — termo isolado tem sinal semântico fraco). Não pare na primeira ferramenta vazia.
Pergunta específica (empresa, nº chamado, status exato) → ferramentas por palavra-chave. Pergunta ampla/vaga → semantic_search. Se semantic_search disser que está desligada, avise o usuário em vez de fingir que não achou nada.`;

export interface EffectiveAssistantConfig {
  systemPrompt: string;
  model: string;
  semanticSearchEnabled: boolean;
  isPromptCustomized: boolean;
  isModelCustomized: boolean;
  // Detector de Insatisfação (ver dissatisfaction-service.ts): dissatisfactionDetectorEnabled
  // já resolve o fallback pra ENABLE_DISSATISFACTION_DETECTOR quando ninguém
  // decidiu nada aqui — dissatisfactionExtraInstructions é sempre '' quando
  // não customizado (concatenado direto no prompt, sem placeholder a limpar).
  dissatisfactionDetectorEnabled: boolean;
  dissatisfactionExtraInstructions: string;
  avatarSource: AiAssistantAvatarSource;
  avatarCrop: AvatarCrop;
}

interface SettingsRow {
  system_prompt: string | null;
  model: string | null;
  semantic_search_enabled: boolean | null;
  dissatisfaction_detector_enabled: boolean | null;
  dissatisfaction_extra_instructions: string | null;
  avatar_source: string | null;
  avatar_crop_overrides: AvatarCropOverrides | null;
}

async function fetchSettingsRow(): Promise<SettingsRow> {
  const res = await query(
    `SELECT system_prompt, model, semantic_search_enabled, dissatisfaction_detector_enabled, dissatisfaction_extra_instructions, avatar_source, avatar_crop_overrides
     FROM public.ai_assistant_settings WHERE id = 1`
  );
  return res.rows[0] || {
    system_prompt: null, model: null, semantic_search_enabled: null,
    dissatisfaction_detector_enabled: null, dissatisfaction_extra_instructions: null, avatar_source: null,
    avatar_crop_overrides: null
  };
}

export async function getEffectiveAssistantConfig(): Promise<EffectiveAssistantConfig> {
  const row = await fetchSettingsRow();
  const promptOverride: string | null = row.system_prompt?.trim() || null;
  const modelOverride: string | null = row.model?.trim() || null;
  const semanticOverride: boolean | null = row.semantic_search_enabled ?? null;

  return {
    systemPrompt: promptOverride || DEFAULT_SYSTEM_INSTRUCTION,
    model: modelOverride || GROQ_MODEL_NAME,
    // "Desligar por cima", nunca "ligar por baixo": se ENABLE_AI_EMBEDDINGS
    // estiver off neste servidor, a infra de embeddings (modelo local, fila
    // de indexação) simplesmente não existe aqui — nenhum valor salvo nesta
    // tabela consegue ligar algo que não roda neste ambiente.
    semanticSearchEnabled: isEmbeddingEnabled() && (semanticOverride ?? true),
    isPromptCustomized: !!promptOverride,
    isModelCustomized: !!modelOverride,
    // Aqui é o oposto do padrão acima: não existe infra que precise estar
    // presente no servidor pra "ligar por cima" — é só uma fila SQL e uma
    // chamada Groq (mesma usada pelo botão "Sincronizar agora"), então o
    // override em banco pode tanto ligar quanto desligar por cima do env.
    dissatisfactionDetectorEnabled: row.dissatisfaction_detector_enabled ?? (process.env.ENABLE_DISSATISFACTION_DETECTOR === 'true'),
    dissatisfactionExtraInstructions: row.dissatisfaction_extra_instructions?.trim() || '',
    avatarSource: isValidAvatarSource(row.avatar_source) ? row.avatar_source : DEFAULT_AI_ASSISTANT_AVATAR,
    avatarCrop: getEffectiveCrop(
      isValidAvatarSource(row.avatar_source) ? row.avatar_source : DEFAULT_AI_ASSISTANT_AVATAR,
      row.avatar_crop_overrides
    )
  };
}

// Visibilidade pro card de status da tela — não precisa da config completa
// (com fallback já resolvido), só o que está de fato salvo no override.
export async function getRawAssistantSettings(): Promise<{
  systemPrompt: string | null; model: string | null; semanticSearchEnabled: boolean | null;
  dissatisfactionDetectorEnabled: boolean | null; dissatisfactionExtraInstructions: string | null;
  avatarSource: AiAssistantAvatarSource | null;
  avatarCropOverrides: AvatarCropOverrides;
}> {
  const row = await fetchSettingsRow();
  return {
    systemPrompt: row.system_prompt || null,
    model: row.model || null,
    semanticSearchEnabled: row.semantic_search_enabled ?? null,
    dissatisfactionDetectorEnabled: row.dissatisfaction_detector_enabled ?? null,
    dissatisfactionExtraInstructions: row.dissatisfaction_extra_instructions || null,
    avatarSource: isValidAvatarSource(row.avatar_source) ? row.avatar_source : null,
    avatarCropOverrides: sanitizeCropOverrides(row.avatar_crop_overrides)
  };
}

export async function saveAssistantConfig(
  actorId: string,
  actorName: string,
  updates: {
    systemPrompt: string | null; model: string | null; semanticSearchEnabled: boolean | null;
    dissatisfactionDetectorEnabled: boolean | null; dissatisfactionExtraInstructions: string | null;
    avatarSource: string | null;
    avatarCropOverrides: AvatarCropOverrides | null;
  }
): Promise<void> {
  // Valor fora do catálogo (lib/ai-assistant-avatar-options.ts) vira NULL
  // (= padrão) em vez de gravar lixo — mesmo raciocínio de
  // isValidDissatisfactionPair em dissatisfaction-taxonomy.ts.
  const avatarSourceToSave = isValidAvatarSource(updates.avatarSource) ? updates.avatarSource : null;
  const cropOverridesToSave = sanitizeCropOverrides(updates.avatarCropOverrides);

  await query(
    `UPDATE public.ai_assistant_settings
     SET system_prompt = $1, model = $2, semantic_search_enabled = $3,
         dissatisfaction_detector_enabled = $4, dissatisfaction_extra_instructions = $5,
         avatar_source = $6, avatar_crop_overrides = $7, updated_at = now(), updated_by = $8
     WHERE id = 1`,
    [
      updates.systemPrompt?.trim() || null,
      updates.model?.trim() || null,
      updates.semanticSearchEnabled,
      updates.dissatisfactionDetectorEnabled,
      updates.dissatisfactionExtraInstructions?.trim() || null,
      avatarSourceToSave,
      JSON.stringify(cropOverridesToSave),
      actorId
    ]
  );
  logAudit({
    actorId,
    actorName,
    action: 'update',
    entityType: 'ai_assistant_settings',
    entityId: '1',
    entityLabel: 'Agente de IA',
    changes: {
      promptCustomized: !!updates.systemPrompt?.trim(),
      promptLength: updates.systemPrompt?.trim()?.length || 0,
      model: updates.model,
      semanticSearchEnabled: updates.semanticSearchEnabled,
      dissatisfactionDetectorEnabled: updates.dissatisfactionDetectorEnabled,
      dissatisfactionExtraInstructionsLength: updates.dissatisfactionExtraInstructions?.trim()?.length || 0,
      avatarSource: avatarSourceToSave,
      avatarCropOverrides: cropOverridesToSave
    }
  });
}
