import { query } from '@/lib/db';
import { getGroqClient, GROQ_MODEL_NAME, AssistantNotConfiguredError } from '@/lib/groq-client';
import { truncateTranscriptForSummary } from './chat-summary-service';
import { formatTaxonomyForPrompt, isValidDissatisfactionPair } from '@/lib/dissatisfaction-taxonomy';
import { getEffectiveAssistantConfig } from './ai-assistant-config-service';

// "Detector de insatisfação do cliente" — item 9 do ROADMAP_MELHORIAS_2.md.
// Processado 100% em segundo plano (ver dissatisfaction-scheduler.ts) sobre
// chat_histories já encerradas — nunca bloqueia o fechamento do chat em si.
// Reaproveita o mesmo transcript/truncamento do "Chat Resumido"
// (chat-summary-service.ts) e, quando a conversa ainda não tem resumo,
// gera os dois (resumo + classificação) numa única chamada ao Groq, pra não
// gastar 2x da cota compartilhada com o Agente de IA/Chat Resumido.

export class DissatisfactionGenerationError extends Error {}

// Depois de N tentativas malsucedidas (429 persistente, JSON inválido do
// modelo, etc.), desiste permanentemente da linha — mesmo raciocínio de
// embedding-service.ts (markProcessed mesmo em erro), com algumas
// tentativas de retry antes (o 429 do Groq se resolve sozinho com o tempo).
export const MAX_DISSATISFACTION_ATTEMPTS = 5;

// Fica em ai_assistant_settings (dissatisfaction_detector_enabled) — NULL
// segue o env ENABLE_DISSATISFACTION_DETECTOR de sempre, preenchido decide
// por cima dele. Só assim o toggle na tela funciona sem redeploy: rota de
// integração/scheduler chamam essa função a cada rodada em vez de ler o env
// direto (ver dissatisfaction-scheduler.ts).
export async function isDissatisfactionDetectorEnabled(): Promise<boolean> {
  const config = await getEffectiveAssistantConfig();
  return config.dissatisfactionDetectorEnabled;
}

interface PendingRow {
  id: string;
  transcript: string | null;
  summary: string | null;
  customer_name: string | null;
  dissatisfaction_attempts: number;
}

interface ClassificationResult {
  dissatisfactionDetected: boolean;
  department: string | null;
  category: string | null;
  reason: string | null;
}

// extraInstructions vem de ai_assistant_settings.dissatisfaction_extra_instructions
// (tela Configurações > Agente de IA) — critério de negócio adicional do que
// contar como insatisfação, acrescentado ao prompt SEM tocar no contrato
// JSON nem na taxonomia fixa abaixo (ambos exigidos pelo parseClassification).
function buildCombinedSystemInstruction(extraInstructions: string): string {
  return `Você analisa conversas de atendimento ao cliente do SSX Desk para um analista interno. Responda SEMPRE em português do Brasil, em JSON estrito, sem nenhum texto fora do JSON, exatamente no formato:
{"summary": string, "dissatisfactionDetected": boolean, "department": string|null, "category": string|null, "reason": string|null}

"summary": 3 a 6 frases em texto corrido cobrindo motivo do contato, o que foi feito, e como terminou. Baseie-se só no que está na conversa — nunca invente número de chamado, nome ou fato que não apareça no texto. Não escreva saudação, introdução nem comentário fora do resumo em si.

"dissatisfactionDetected": true SOMENTE se o cliente demonstrou claramente insatisfação, frustração ou reclamação explícita durante a conversa — não marque true por reclamação neutra/técnica sem carga emocional, nem por perguntas normais.
${extraInstructions ? `\nCritério de negócio adicional definido pela equipe:\n${extraInstructions}\n` : ''}
Se dissatisfactionDetected for true, classifique com EXATAMENTE um departamento e uma categoria da lista abaixo (nunca invente um valor fora dela) e preencha "reason" com uma frase curta ou trecho/citação da conversa que justifique a escolha:
${formatTaxonomyForPrompt()}

Se dissatisfactionDetected for false, "department", "category" e "reason" devem ser null.`;
}

function buildClassificationOnlySystemInstruction(extraInstructions: string): string {
  return `Você classifica conversas de atendimento ao cliente do SSX Desk para um analista interno. Responda SEMPRE em português do Brasil, em JSON estrito, sem nenhum texto fora do JSON, exatamente no formato:
{"dissatisfactionDetected": boolean, "department": string|null, "category": string|null, "reason": string|null}

"dissatisfactionDetected": true SOMENTE se o cliente demonstrou claramente insatisfação, frustração ou reclamação explícita durante a conversa — não marque true por reclamação neutra/técnica sem carga emocional, nem por perguntas normais.
${extraInstructions ? `\nCritério de negócio adicional definido pela equipe:\n${extraInstructions}\n` : ''}
Se true, classifique com EXATAMENTE um departamento e uma categoria da lista abaixo (nunca invente um valor fora dela) e preencha "reason" com uma frase curta ou trecho/citação da conversa que justifique a escolha:
${formatTaxonomyForPrompt()}

Se false, "department", "category" e "reason" devem ser null.`;
}

function parseClassification(raw: string, expectSummary: boolean): { summary: string | null; result: ClassificationResult } {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DissatisfactionGenerationError('Resposta do modelo não é um JSON válido.');
  }

  const detected = parsed?.dissatisfactionDetected === true;
  let department: string | null = null;
  let category: string | null = null;
  let reason: string | null = null;

  if (detected) {
    const dep = typeof parsed?.department === 'string' ? parsed.department.trim() : '';
    const cat = typeof parsed?.category === 'string' ? parsed.category.trim() : '';
    if (isValidDissatisfactionPair(dep, cat)) {
      department = dep;
      category = cat;
      reason = typeof parsed?.reason === 'string' ? parsed.reason.trim().slice(0, 500) : null;
    } else {
      // Modelo disse "insatisfeito" mas o departamento/categoria não bate
      // com a taxonomia — degrada (mantém detected=true mas sem
      // department/category) em vez de gravar lixo no banco.
      console.warn(`[dissatisfaction-service] department/category fora da taxonomia: "${dep}" / "${cat}"`);
    }
  }

  const summary = expectSummary && typeof parsed?.summary === 'string' ? parsed.summary.trim() : null;
  if (expectSummary && !summary) {
    throw new DissatisfactionGenerationError('Resposta do modelo não incluiu o resumo esperado.');
  }

  return { summary, result: { dissatisfactionDetected: detected, department, category, reason } };
}

async function classifyWithGroq(
  client: ReturnType<typeof getGroqClient>,
  params: { transcript: string; customerName: string | null; needsSummary: boolean; model: string; extraInstructions: string }
): Promise<{ summary: string | null; result: ClassificationResult }> {
  const completion = await client.chat.completions.create({
    model: params.model,
    max_tokens: 500,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: params.needsSummary
          ? buildCombinedSystemInstruction(params.extraInstructions)
          : buildClassificationOnlySystemInstruction(params.extraInstructions)
      },
      { role: 'user', content: `Conversa com ${params.customerName || 'o cliente'}:\n\n${params.transcript}` }
    ]
  });
  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) throw new DissatisfactionGenerationError('O modelo de IA não retornou nenhum conteúdo.');
  return parseClassification(raw, params.needsSummary);
}

async function markDone(id: string, v: {
  detected: boolean | null; department: string | null; category: string | null;
  reason: string | null; attempts: number; error: string | null;
}): Promise<void> {
  await query(
    `UPDATE public.chat_histories SET
       dissatisfaction_processed_at = now(), dissatisfaction_detected = $2,
       dissatisfaction_department = $3, dissatisfaction_category = $4,
       dissatisfaction_reason = $5, dissatisfaction_attempts = $6, dissatisfaction_last_error = $7
     WHERE id = $1`,
    [id, v.detected, v.department, v.category, v.reason, v.attempts, v.error]
  ).catch(err => console.error('[dissatisfaction-service] Falha ao gravar resultado:', id, err));
}

async function processRow(client: ReturnType<typeof getGroqClient>, model: string, row: PendingRow, extraInstructions: string): Promise<void> {
  const transcript = (row.transcript || '').trim();
  const nextAttempts = row.dissatisfaction_attempts + 1;

  if (!transcript) {
    await markDone(row.id, { detected: false, department: null, category: null, reason: null, attempts: nextAttempts, error: 'Conversa sem transcrição registrada.' });
    return;
  }

  const needsSummary = !row.summary;
  const truncated = truncateTranscriptForSummary(transcript);

  try {
    const { summary, result } = await classifyWithGroq(client, { transcript: truncated, customerName: row.customer_name, needsSummary, model, extraInstructions });

    if (needsSummary && summary) {
      // WHERE summary IS NULL: não sobrescreve um resumo manual que possa
      // ter sido gerado (via "Chat Resumido") entre a leitura e esta escrita.
      await query(
        `UPDATE public.chat_histories SET summary = $1, summary_generated_at = now() WHERE id = $2 AND summary IS NULL`,
        [summary, row.id]
      );
    }

    await markDone(row.id, {
      detected: result.dissatisfactionDetected, department: result.department,
      category: result.category, reason: result.reason, attempts: nextAttempts, error: null
    });
  } catch (err: any) {
    const message = (err?.message || String(err)).slice(0, 500);
    console.error(`[dissatisfaction-service] Falha ao classificar chat_history ${row.id} (tentativa ${nextAttempts}/${MAX_DISSATISFACTION_ATTEMPTS}):`, message);

    if (nextAttempts >= MAX_DISSATISFACTION_ATTEMPTS) {
      // Esgotou as tentativas — desiste permanentemente pra não travar a
      // fila com uma linha quebrada.
      await markDone(row.id, { detected: null, department: null, category: null, reason: null, attempts: nextAttempts, error: message });
    } else {
      // Sobra tentativa — NÃO marca processed_at, só registra a tentativa;
      // volta pra fila na próxima rodada (útil sobretudo pra 429 do Groq).
      await query(
        `UPDATE public.chat_histories SET dissatisfaction_attempts = $2, dissatisfaction_last_error = $3 WHERE id = $1`,
        [row.id, nextAttempts, message]
      ).catch(e => console.error('[dissatisfaction-service] Falha ao registrar tentativa:', row.id, e));
    }
  }
}

// Chamada pelo scheduler (dissatisfaction-scheduler.ts) e pelo botão
// "Sincronizar agora" (ver runDissatisfactionBatchNow em app/actions.ts) —
// retorna quantas linhas foram tentadas nesta rodada. `force` ignora a flag
// ENABLE_DISSATISFACTION_DETECTOR: um clique explícito do usuário já é o
// consentimento humano que a flag existe pra exigir antes de gastar cota
// automaticamente — não faz sentido bloquear a mesma ação quando é pedida
// na hora, só a recorrência automática sem ninguém pedir.
export async function processDissatisfactionQueueBatch(limit: number, options?: { force?: boolean }): Promise<number> {
  const config = await getEffectiveAssistantConfig();
  if (!options?.force && !config.dissatisfactionDetectorEnabled) return 0;

  let client: ReturnType<typeof getGroqClient>;
  try {
    client = getGroqClient();
  } catch (err) {
    if (err instanceof AssistantNotConfiguredError) {
      console.warn('[dissatisfaction-service] GROQ_API_KEY não configurada — fila não processada nesta rodada.');
      return 0;
    }
    throw err;
  }

  try {
    const pending = await query(
      `SELECT id, transcript, summary, customer_name, dissatisfaction_attempts
       FROM public.chat_histories
       WHERE dissatisfaction_processed_at IS NULL AND dissatisfaction_attempts < $1
       ORDER BY finished_at ASC
       LIMIT $2`,
      [MAX_DISSATISFACTION_ATTEMPTS, limit]
    );
    for (const row of pending.rows) {
      // Sequencial de propósito — mesma cota Groq do Agente de IA/Chat
      // Resumido, não paralelizar.
      await processRow(client, GROQ_MODEL_NAME, row, config.dissatisfactionExtraInstructions);
    }
    return pending.rows.length;
  } catch (err) {
    console.error('[dissatisfaction-service] Falha ao processar lote da fila:', err);
    return 0;
  }
}
