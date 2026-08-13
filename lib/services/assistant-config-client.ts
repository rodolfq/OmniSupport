import { apiJson } from '../api-client';
import type { AvatarCropOverrides } from '../ai-assistant-avatar-options';

/**
 * Configuração do Agente de IA, do lado do cliente — substitui
 * getAssistantConfig / saveAssistantConfig / getDissatisfactionStats /
 * runDissatisfactionBatchNow na separação front/back.
 *
 * Nome do arquivo com sufixo `-client` para não colidir com
 * lib/services/ai-assistant-config-service.ts, que é o módulo de SERVIDOR
 * (fala com o banco). Um lê, o outro é lido — misturar os dois num nome só
 * seria convite a importar o de servidor num componente de tela.
 */

export async function getAssistantConfig(): Promise<any> {
  try {
    return await apiJson('/api/ai-assistant/config');
  } catch (err: any) {
    return { error: err?.message || 'Erro ao carregar configuração do Agente de IA.' };
  }
}

export async function saveAssistantConfig(
  systemPrompt: string | null,
  model: string | null,
  semanticSearchEnabled: boolean | null,
  dissatisfactionDetectorEnabled: boolean | null,
  dissatisfactionExtraInstructions: string | null,
  avatarSource: string | null,
  avatarCropOverrides: AvatarCropOverrides | null,
  // Tri-state: omitido = não mexe na chave salva; null = remove o override
  // (volta ao GROQ_API_KEY do .env); string = troca pela chave nova.
  ...rest: [groqApiKey?: string | null]
): Promise<{ success?: true; error?: string }> {
  const body: Record<string, unknown> = {
    systemPrompt, model, semanticSearchEnabled, dissatisfactionDetectorEnabled,
    dissatisfactionExtraInstructions, avatarSource, avatarCropOverrides
  };
  // Só inclui a chave quando o chamador de fato passou o argumento — é o que
  // preserva o tri-state ao atravessar o JSON (`undefined` sumiria na
  // serialização e viraria indistinguível de `null`, que APAGA a chave).
  if (rest.length > 0) body.groqApiKey = rest[0];

  try {
    return await apiJson('/api/ai-assistant/config', { method: 'POST', body: JSON.stringify(body) });
  } catch (err: any) {
    return { error: err?.message || 'Erro ao salvar configuração do Agente de IA.' };
  }
}

export async function getDissatisfactionStats(): Promise<any> {
  try {
    return await apiJson('/api/ai-assistant/config?tipo=dissatisfaction-stats');
  } catch (err: any) {
    return { error: err?.message || 'Erro ao carregar estatísticas do detector de insatisfação.' };
  }
}

export async function runDissatisfactionBatchNow(): Promise<any> {
  try {
    return await apiJson('/api/ai-assistant/config', {
      method: 'POST',
      body: JSON.stringify({ action: 'run-dissatisfaction-batch' })
    });
  } catch (err: any) {
    return { error: err?.message || 'Erro ao sincronizar o detector de insatisfação.' };
  }
}
