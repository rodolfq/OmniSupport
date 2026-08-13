import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentActionUser, getActorEffectivePermissions } from '@/lib/server-auth';
import { permissionErrorStatus } from '@/lib/server-permissions';
import {
  getEffectiveAssistantConfig,
  getRawAssistantSettings,
  saveAssistantConfig as saveAssistantConfigService,
  DEFAULT_SYSTEM_INSTRUCTION
} from '@/lib/services/ai-assistant-config-service';
import { isEmbeddingEnabled } from '@/lib/services/embedding-service';
import {
  processDissatisfactionQueueBatch,
  isDissatisfactionDetectorEnabled,
  requeueSkippedDissatisfactionBacklog
} from '@/lib/services/dissatisfaction-service';

/**
 * Configuração do Agente de IA e do Detector de Insatisfação. Substitui
 * getAssistantConfig / saveAssistantConfig / getDissatisfactionStats /
 * runDissatisfactionBatchNow.
 *
 * SEGREDO: a chave do Groq nunca sai do servidor — a resposta traz apenas
 * booleanos dizendo se há chave no ambiente e se existe um override salvo.
 */

async function assertCanManageAssistant(): Promise<{ ok: true; actor: any } | { ok: false; error: string }> {
  const actor = await getCurrentActionUser();
  if (!actor) return { ok: false, error: 'Sessão inválida.' };
  if (actor.role === 'Administrador') return { ok: true, actor };
  const permissions = await getActorEffectivePermissions(actor.id);
  if (!permissions.includes('settings:system')) {
    return { ok: false, error: 'Você não tem permissão para gerenciar o Agente de IA.' };
  }
  return { ok: true, actor };
}

// Lote maior que o do scheduler automático (10 vs 5): é ação explícita, quem
// clicou está esperando na tela — devolver pouco e pedir novo clique seria pior.
const MANUAL_SYNC_BATCH_SIZE = 10;

export async function GET(request: Request) {
  try {
    const check = await assertCanManageAssistant();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });

    const tipo = new URL(request.url).searchParams.get('tipo');

    // Progresso do processamento em segundo plano do Detector de Insatisfação.
    // Distingue 3 casos que TODOS têm dissatisfaction_detected NULL, para não
    // confundir "nunca foi analisado" com "tentou e desistiu":
    //   pending  — processed_at NULL (ainda na fila)
    //   failed   — processed_at preenchido, detected NULL, attempts > 0
    //   skipped  — processed_at preenchido, detected NULL, attempts = 0
    //              (backlog marcado pela própria migration, nunca enviado ao Groq)
    if (tipo === 'dissatisfaction-stats') {
      const res = await query(`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE dissatisfaction_processed_at IS NULL)::int AS pending,
          count(*) FILTER (WHERE dissatisfaction_detected IS NOT NULL)::int AS analyzed,
          count(*) FILTER (WHERE dissatisfaction_detected = true)::int AS detected,
          count(*) FILTER (
            WHERE dissatisfaction_processed_at IS NOT NULL
              AND dissatisfaction_detected IS NULL
              AND dissatisfaction_attempts > 0
          )::int AS failed,
          count(*) FILTER (
            WHERE dissatisfaction_processed_at IS NOT NULL
              AND dissatisfaction_detected IS NULL
              AND dissatisfaction_attempts = 0
          )::int AS skipped,
          max(dissatisfaction_processed_at) FILTER (
            WHERE dissatisfaction_attempts > 0 OR dissatisfaction_detected IS NOT NULL
          ) AS last_activity_at
        FROM public.chat_histories
      `);
      const row = res.rows[0];
      return NextResponse.json({
        enabled: await isDissatisfactionDetectorEnabled(),
        total: row.total,
        pending: row.pending,
        analyzed: row.analyzed,
        detected: row.detected,
        failed: row.failed,
        // "Sincronizar agora" reenfileira o backlog pulado antes do lote, então
        // a tela usa este número para saber se o botão tem o que fazer mesmo
        // com pending = 0.
        skipped: row.skipped,
        lastActivityAt: row.last_activity_at
      });
    }

    const [effective, raw] = await Promise.all([getEffectiveAssistantConfig(), getRawAssistantSettings()]);
    return NextResponse.json({
      groqApiKeyConfigured: !!process.env.GROQ_API_KEY,
      // Booleano só — o valor da chave nunca sai do servidor.
      groqApiKeyOverrideConfigured: raw.groqApiKeyOverrideConfigured,
      embeddingsEnabledInEnv: isEmbeddingEnabled(),
      defaultSystemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
      effectiveSystemPrompt: effective.systemPrompt,
      effectiveModel: effective.model,
      effectiveSemanticSearchEnabled: effective.semanticSearchEnabled,
      isPromptCustomized: effective.isPromptCustomized,
      isModelCustomized: effective.isModelCustomized,
      rawSemanticSearchOverride: raw.semanticSearchEnabled,
      effectiveDissatisfactionDetectorEnabled: effective.dissatisfactionDetectorEnabled,
      rawDissatisfactionDetectorEnabled: raw.dissatisfactionDetectorEnabled,
      dissatisfactionExtraInstructions: raw.dissatisfactionExtraInstructions || '',
      avatarSource: effective.avatarSource,
      avatarCropOverrides: raw.avatarCropOverrides
    });
  } catch (err: any) {
    console.error('Error getting assistant config:', err);
    return NextResponse.json({ error: 'Erro ao carregar configuração do Agente de IA.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const check = await assertCanManageAssistant();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
    const { actor } = check;

    const body = await request.json();

    if (body.action === 'run-dissatisfaction-batch') {
      if (!process.env.GROQ_API_KEY) {
        return NextResponse.json(
          { error: 'GROQ_API_KEY não configurada — configure a chave antes de sincronizar.' },
          { status: 400 }
        );
      }
      // Devolve à fila o backlog "pulado" antes de processar: sem isso essas
      // conversas nunca voltam a ser candidatas (processed_at já preenchido =
      // não conta como pendente).
      const requeued = await requeueSkippedDissatisfactionBacklog();
      const processed = await processDissatisfactionQueueBatch(MANUAL_SYNC_BATCH_SIZE, { force: true });
      return NextResponse.json({ success: true, processed, requeued });
    }

    const {
      systemPrompt, model, semanticSearchEnabled, dissatisfactionDetectorEnabled,
      dissatisfactionExtraInstructions, avatarSource, avatarCropOverrides, groqApiKey
    } = body;

    // groqApiKey é tri-state (ver ai-assistant-config-service.ts):
    //   ausente   = não mexe na chave salva
    //   null      = remove o override (volta a usar GROQ_API_KEY do .env)
    //   string    = troca para essa chave nova
    // Preservar a distinção entre "ausente" e "null" é o ponto: tratá-las
    // igual apagaria a chave de quem só quis mudar o prompt.
    await saveAssistantConfigService(actor.id, actor.name, {
      systemPrompt, model, semanticSearchEnabled, dissatisfactionDetectorEnabled,
      dissatisfactionExtraInstructions, avatarSource, avatarCropOverrides,
      ...( 'groqApiKey' in body ? { groqApiKey } : {})
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Error saving assistant config:', err);
    return NextResponse.json({ error: err.message || 'Erro ao salvar configuração do Agente de IA.' }, { status: 500 });
  }
}
