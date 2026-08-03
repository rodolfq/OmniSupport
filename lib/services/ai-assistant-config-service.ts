import { query } from '@/lib/db';
import { GROQ_MODEL_NAME } from '@/lib/groq-client';
import { isEmbeddingEnabled } from './embedding-service';
import { logAudit } from '@/lib/audit-log';

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
}

export async function getEffectiveAssistantConfig(): Promise<EffectiveAssistantConfig> {
  const res = await query(
    'SELECT system_prompt, model, semantic_search_enabled FROM public.ai_assistant_settings WHERE id = 1'
  );
  const row = res.rows[0];
  const promptOverride: string | null = row?.system_prompt?.trim() || null;
  const modelOverride: string | null = row?.model?.trim() || null;
  const semanticOverride: boolean | null = row?.semantic_search_enabled ?? null;

  return {
    systemPrompt: promptOverride || DEFAULT_SYSTEM_INSTRUCTION,
    model: modelOverride || GROQ_MODEL_NAME,
    // "Desligar por cima", nunca "ligar por baixo": se ENABLE_AI_EMBEDDINGS
    // estiver off neste servidor, a infra de embeddings (modelo local, fila
    // de indexação) simplesmente não existe aqui — nenhum valor salvo nesta
    // tabela consegue ligar algo que não roda neste ambiente.
    semanticSearchEnabled: isEmbeddingEnabled() && (semanticOverride ?? true),
    isPromptCustomized: !!promptOverride,
    isModelCustomized: !!modelOverride
  };
}

// Visibilidade pro card de status da tela — não precisa da config completa
// (com fallback já resolvido), só o que está de fato salvo no override.
export async function getRawAssistantSettings(): Promise<{ systemPrompt: string | null; model: string | null; semanticSearchEnabled: boolean | null }> {
  const res = await query(
    'SELECT system_prompt, model, semantic_search_enabled FROM public.ai_assistant_settings WHERE id = 1'
  );
  const row = res.rows[0];
  return {
    systemPrompt: row?.system_prompt || null,
    model: row?.model || null,
    semanticSearchEnabled: row?.semantic_search_enabled ?? null
  };
}

export async function saveAssistantConfig(
  actorId: string,
  actorName: string,
  updates: { systemPrompt: string | null; model: string | null; semanticSearchEnabled: boolean | null }
): Promise<void> {
  await query(
    `UPDATE public.ai_assistant_settings
     SET system_prompt = $1, model = $2, semantic_search_enabled = $3, updated_at = now(), updated_by = $4
     WHERE id = 1`,
    [updates.systemPrompt?.trim() || null, updates.model?.trim() || null, updates.semanticSearchEnabled, actorId]
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
      semanticSearchEnabled: updates.semanticSearchEnabled
    }
  });
}
