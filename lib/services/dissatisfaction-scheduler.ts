import { isDissatisfactionDetectorEnabled, processDissatisfactionQueueBatch } from './dissatisfaction-service';

// Mesmo padrão de embedding-scheduler.ts/hotfix-scheduler.ts: setInterval +
// guarda em globalThis pra sobreviver ao hot-reload do Next.js em dev.
declare global {
  var dissatisfactionSchedulerStarted: boolean | undefined;
}

// Cota do Groq é COMPARTILHADA com o Agente de IA e o Chat Resumido (mesma
// chave de teste pessoal — ver CLAUDE.md seção 4, GROQ_API_KEY). Ao
// contrário dos outros schedulers, cada rodada aqui gasta tokens de
// verdade sem nenhum humano ter pedido — poll espaçado e lote pequeno de
// propósito, pra essa fila automática não competir com o uso interativo do
// agente (que já bateu o teto diário de 100k tokens/dia do tier gratuito
// uma vez, ver comentário em ai-assistant-service.ts).
const POLL_INTERVAL_MS = 2 * 60_000; // 2 minutos
const BATCH_SIZE = 5;

export function startDissatisfactionScheduler(): void {
  if (!isDissatisfactionDetectorEnabled()) return;
  if (global.dissatisfactionSchedulerStarted) return;
  global.dissatisfactionSchedulerStarted = true;

  setInterval(() => {
    processDissatisfactionQueueBatch(BATCH_SIZE).catch((err) => {
      console.error('[dissatisfaction-scheduler] Falha ao processar fila:', err);
    });
  }, POLL_INTERVAL_MS);
}
