import { query } from '@/lib/db';
import { getGroqClient, GROQ_MODEL_NAME } from '@/lib/groq-client';

// "Chat Resumido" — item 6 do ROADMAP_MELHORIAS_2.md. Resumo gerado por IA
// (Groq, mesmo provedor do Agente de IA) de uma conversa já encerrada
// (chat_histories), salvo em banco de forma PERMANENTE na primeira geração
// (chat_histories.summary) — chamadas seguintes retornam o que já existe em
// vez de gastar token de novo. Usado tanto pelo toggle "Chat completo /
// Chat Resumido" na tela de Histórico de Conversas quanto por quem chamar a
// action 'summarize-history' da API diretamente.

export class ChatSummaryNotFoundError extends Error {}
export class ChatSummaryGenerationError extends Error {}

// Cap de tamanho do transcript enviado ao modelo — conversas longas de
// verdade podem ter dezenas de milhares de caracteres, o que estoura
// contexto/custo de token à toa pra um resumo de poucas frases. Mantém
// início (contexto do problema) e fim (como terminou) em vez de cortar só
// a partir do fim, que perderia o motivo original do contato.
const MAX_TRANSCRIPT_CHARS = 12000;
const HEAD_CHARS = 7000;
const TAIL_CHARS = 4500;

function truncateTranscriptForSummary(transcript: string): string {
  if (transcript.length <= MAX_TRANSCRIPT_CHARS) return transcript;
  const head = transcript.slice(0, HEAD_CHARS).trim();
  const tail = transcript.slice(-TAIL_CHARS).trim();
  return `${head}\n\n[... trecho intermediário omitido por tamanho ...]\n\n${tail}`;
}

const SUMMARY_SYSTEM_INSTRUCTION = `Você resume conversas de atendimento ao cliente do SSX Desk para um analista interno reler rapidamente depois. Responda SEMPRE em português do Brasil, em texto corrido (não use lista/tópicos), entre 3 e 6 frases cobrindo: (1) motivo do contato, (2) o que foi feito/informado durante o atendimento, (3) como terminou (resolvido, pendente, escalado para outro time, etc). Baseie-se só no que está na conversa — nunca invente número de chamado, nome ou fato que não apareça no texto. Não escreva saudação, introdução ("aqui está o resumo") nem comentário fora do resumo em si.`;

export interface ChatSummaryResult {
  summary: string;
  generatedAt: string;
  cached: boolean;
}

export async function getOrGenerateChatSummary(historyId: string): Promise<ChatSummaryResult> {
  const existing = await query(
    `SELECT summary, summary_generated_at, transcript, customer_name
     FROM public.chat_histories WHERE id = $1`,
    [historyId]
  );
  const row = existing.rows[0];
  if (!row) {
    throw new ChatSummaryNotFoundError('Conversa não encontrada.');
  }

  if (row.summary) {
    return { summary: row.summary, generatedAt: row.summary_generated_at, cached: true };
  }

  const transcript = (row.transcript || '').trim();
  if (!transcript) {
    throw new ChatSummaryGenerationError('Esta conversa não tem transcrição registrada para resumir.');
  }

  // getGroqClient() lança AssistantNotConfiguredError se GROQ_API_KEY não
  // estiver setada — propagada pro chamador (rota da API), não capturada
  // aqui, pra virar um 503 com mensagem clara em vez de "falha genérica".
  const client = getGroqClient();

  const completion = await client.chat.completions.create({
    model: GROQ_MODEL_NAME,
    max_tokens: 400,
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM_INSTRUCTION },
      {
        role: 'user',
        content: `Conversa com ${row.customer_name || 'o cliente'}:\n\n${truncateTranscriptForSummary(transcript)}`
      }
    ]
  });

  const summaryText = completion.choices[0]?.message?.content?.trim();
  if (!summaryText) {
    throw new ChatSummaryGenerationError('O modelo de IA não retornou nenhum resumo — tente novamente em instantes.');
  }

  const generatedAt = new Date().toISOString();
  await query(
    `UPDATE public.chat_histories SET summary = $1, summary_generated_at = $2 WHERE id = $3`,
    [summaryText, generatedAt, historyId]
  );

  return { summary: summaryText, generatedAt, cached: false };
}
