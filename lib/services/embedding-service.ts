import path from 'path';
import { query } from '@/lib/db';

// Busca semântica do Agente de IA — embeddings 100% locais (mesma técnica
// de lib/services/transcription-service.ts: modelo open-source rodando no
// próprio servidor via @huggingface/transformers, sem API paga nem gasto
// por uso). Desligado por padrão (ENABLE_AI_EMBEDDINGS) pelo mesmo motivo
// da transcrição: baixa um modelo na primeira vez e é CPU-bound — não roda
// bem em ambiente serverless (Vercel), ligar só em servidor dedicado.
//
// Sem pgvector (não disponível no Postgres de produção — ver
// migrations/ai_embeddings.sql): os vetores ficam num array nativo do
// Postgres e a similaridade de cosseno é calculada aqui em JS. Como os
// vetores já saem normalizados do modelo, cosseno == produto escalar
// simples — rápido o bastante em JS pro volume de dados atual (milhares de
// linhas, não milhões).
const ENABLED = process.env.ENABLE_AI_EMBEDDINGS === 'true';
const MODEL_NAME = process.env.EMBEDDING_MODEL || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const CACHE_DIR = path.resolve(process.cwd(), '.cache', 'embedding-models');

export function isEmbeddingEnabled(): boolean {
  return ENABLED;
}

let embedderPromise: Promise<any> | null = null;
async function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = CACHE_DIR;
      return pipeline('feature-extraction', MODEL_NAME, { dtype: 'q8' });
    })();
  }
  return embedderPromise;
}

// Fila com no máximo 1 embedding rodando por vez — mesmo raciocínio de
// transcription-service.ts (CPU-bound, sem GPU, várias ao mesmo tempo só
// disputariam os mesmos núcleos).
let queueTail: Promise<unknown> = Promise.resolve();
function enqueueLocal<T>(job: () => Promise<T>): Promise<T> {
  const run = queueTail.catch(() => {}).then(job);
  queueTail = run.catch(() => {});
  return run;
}

export async function embedText(text: string): Promise<number[]> {
  return enqueueLocal(async () => {
    const embedder = await getEmbedder();
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
  });
}

// Vetores já normalizados (normalize: true acima) — cosseno == produto
// escalar, sem precisar dividir pelas normas.
function dotProduct(a: number[], b: Float64Array | number[]): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) sum += a[i] * Number(b[i]);
  return sum;
}

// --- Fila de indexação (alimentada pelos triggers de banco) ---------------
// Ver migrations/ai_embeddings.sql — todo INSERT nas 4 tabelas de mensagem
// cai aqui sozinho via trigger, não importa o caminho de código que criou a
// mensagem. Isto só DRENA a fila; quem a enche é o banco.

interface SourceMapping {
  table: string;
  textCol: string;
  parentCol: string;
}

const SOURCE_TABLE_MAP: Record<string, SourceMapping> = {
  ticket_message: { table: 'ticket_messages', textCol: 'content', parentCol: 'ticket_id' },
  internal_ticket_message: { table: 'internal_ticket_messages', textCol: 'content', parentCol: 'internal_ticket_id' },
  chat_message: { table: 'chat_messages', textCol: 'text', parentCol: 'session_id' },
  internal_chat_message: { table: 'internal_chat_messages', textCol: 'text', parentCol: 'chat_id' }
};

async function markProcessed(queueId: number): Promise<void> {
  await query('UPDATE public.ai_embedding_queue SET processed_at = now() WHERE id = $1', [queueId]).catch((err) => {
    console.error('[embedding-service] Falha ao marcar item da fila como processado:', queueId, err);
  });
}

async function processQueueItem(item: { id: number; source_type: string; source_id: string }): Promise<void> {
  const mapping = SOURCE_TABLE_MAP[item.source_type];
  if (!mapping) {
    console.error(`[embedding-service] source_type desconhecido na fila: ${item.source_type}`);
    await markProcessed(item.id);
    return;
  }

  try {
    const res = await query(
      `SELECT ${mapping.textCol} AS content, ${mapping.parentCol} AS parent_id, created_at
       FROM public.${mapping.table} WHERE id = $1`,
      [item.source_id]
    );
    const row = res.rows[0];

    // Linha pode não existir mais (apagada depois de entrar na fila) ou não
    // ter texto (mensagem só com anexo, ex: imagem/áudio sem legenda) —
    // nada pra vetorizar, marca como processado e segue.
    if (row && typeof row.content === 'string' && row.content.trim()) {
      const embedding = await embedText(row.content);
      await query(
        `INSERT INTO public.ai_embeddings (source_type, source_id, parent_id, content, embedding, source_created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (source_type, source_id) DO UPDATE SET
           content = EXCLUDED.content,
           embedding = EXCLUDED.embedding,
           parent_id = EXCLUDED.parent_id`,
        [item.source_type, item.source_id, row.parent_id !== null ? String(row.parent_id) : null, row.content, embedding, row.created_at]
      );
    }
    await markProcessed(item.id);
  } catch (err) {
    console.error(`[embedding-service] Falha ao indexar ${item.source_type}:${item.source_id}:`, err);
    // Marca como processado mesmo assim — evita um item permanentemente
    // ruim (ex: texto que trava o modelo) travar a fila pra sempre. Perde
    // só esse item, não bloqueia os próximos.
    await markProcessed(item.id);
  }
}

export async function processEmbeddingQueueBatch(limit: number): Promise<number> {
  if (!ENABLED) return 0;
  try {
    const pending = await query(
      `SELECT id, source_type, source_id FROM public.ai_embedding_queue
       WHERE processed_at IS NULL ORDER BY created_at ASC LIMIT $1`,
      [limit]
    );
    for (const item of pending.rows) {
      await processQueueItem(item);
    }
    return pending.rows.length;
  } catch (err) {
    console.error('[embedding-service] Falha ao processar lote da fila:', err);
    return 0;
  }
}

export interface EmbeddingQueueStatus {
  enabled: boolean;
  total: number;
  processed: number;
  pending: number;
  percent: number; // 0-100, arredondado. 100 quando não há nada na fila.
  oldestPendingAt: string | null;
}

// Usado pelo painel de progresso do widget (app/api/ai-assistant/embedding-
// status/route.ts) — só leitura, não mexe na fila.
export async function getEmbeddingQueueStatus(): Promise<EmbeddingQueueStatus> {
  const res = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE processed_at IS NOT NULL)::int AS processed,
       MIN(created_at) FILTER (WHERE processed_at IS NULL) AS oldest_pending_at
     FROM public.ai_embedding_queue`
  );
  const row = res.rows[0] || { total: 0, processed: 0, oldest_pending_at: null };
  const total = row.total ?? 0;
  const processed = row.processed ?? 0;
  const pending = total - processed;
  const percent = total === 0 ? 100 : Math.round((processed / total) * 100);

  return {
    enabled: ENABLED,
    total,
    processed,
    pending,
    percent,
    oldestPendingAt: row.oldest_pending_at
  };
}

// --- Busca semântica --------------------------------------------------------

export interface SemanticSearchResult {
  sourceType: string;
  parentId: string | null;
  content: string;
  relevance: number;
  at: string;
}

// Teto de candidatos trazidos do banco pra rankear em JS — sem pgvector não
// dá pra empurrar "ORDER BY similaridade" pro Postgres, então isso limita o
// pior caso de memória/tempo. Suficiente para o volume atual; se a tabela
// crescer muito, o próximo passo é filtrar por período antes de rankear, ou
// migrar pra pgvector de verdade (ver comentário no topo da migration).
const CANDIDATE_CAP = 4000;

// Corta o texto devolvido pro modelo — o conteúdo bruto de uma mensagem
// (principalmente chamado, que pode ter HTML/resposta longa) ia inteiro em
// todo resultado de busca, multiplicado por até 30 resultados. É o maior
// consumidor de token do agente (ver app/api/ai-assistant/route.ts,
// redução de custo depois de bater rate limit diário do Groq).
export function truncateText(text: string, maxLen = 280): string {
  if (!text || text.length <= maxLen) return text;
  return `${text.slice(0, maxLen).trim()}…`;
}

export async function semanticSearch(
  searchText: string,
  opts: { sourceTypes?: string[]; limit?: number } = {}
): Promise<SemanticSearchResult[]> {
  if (!ENABLED) return [];

  const queryEmbedding = await embedText(searchText);

  const params: any[] = [];
  let where = '';
  if (opts.sourceTypes && opts.sourceTypes.length > 0) {
    params.push(opts.sourceTypes);
    where = 'WHERE source_type = ANY($1)';
  }
  params.push(CANDIDATE_CAP);

  const res = await query(
    `SELECT source_type, source_id, parent_id, content, embedding, source_created_at
     FROM public.ai_embeddings
     ${where}
     ORDER BY source_created_at DESC
     LIMIT $${params.length}`,
    params
  );

  const scored = res.rows.map((r: any) => ({
    sourceType: r.source_type as string,
    parentId: r.parent_id as string | null,
    content: r.content as string,
    at: r.source_created_at as string,
    score: dotProduct(queryEmbedding, r.embedding)
  }));
  scored.sort((a, b) => b.score - a.score);

  // Default/teto reduzidos (eram 12/30) — cada resultado a mais é mais
  // texto reenviado pro modelo a cada rodada de tool-calling.
  const limit = Math.min(Math.max(opts.limit ?? 6, 1), 15);
  return scored.slice(0, limit).map((r) => ({
    sourceType: r.sourceType,
    parentId: r.parentId,
    content: truncateText(r.content),
    relevance: Math.round(r.score * 1000) / 1000,
    at: r.at
  }));
}
