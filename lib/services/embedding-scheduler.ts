import { isEmbeddingEnabled, processEmbeddingQueueBatch } from './embedding-service';

// Drena em segundo plano a fila alimentada pelos triggers de banco (ver
// migrations/ai_embeddings.sql) — "processamento silencioso" de verdade:
// roda no servidor, independente de qualquer usuário estar com o navegador
// aberto. Mesmo padrão de lib/services/hotfix-scheduler.ts (setInterval +
// guarda em globalThis pra sobreviver ao hot-reload do Next.js em dev).
declare global {
  var embeddingSchedulerStarted: boolean | undefined;
}

// Curto o bastante pra alcançar mensagens novas em minutos, longo o
// bastante pra não competir demais por CPU com o resto do servidor — é o
// mesmo processo Node que atende requisições HTTP. BATCH_SIZE pequeno pelo
// mesmo motivo (embedText já serializa a 1 por vez internamente, ver
// embedding-service.ts).
const POLL_INTERVAL_MS = 15_000;
const BATCH_SIZE = 10;

export function startEmbeddingScheduler(): void {
  if (!isEmbeddingEnabled()) return;
  if (global.embeddingSchedulerStarted) return;
  global.embeddingSchedulerStarted = true;

  setInterval(() => {
    processEmbeddingQueueBatch(BATCH_SIZE).catch((err) => {
      console.error('[embedding-scheduler] Falha ao drenar fila de embeddings:', err);
    });
  }, POLL_INTERVAL_MS);
}
