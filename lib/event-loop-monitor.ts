import { monitorEventLoopDelay } from 'perf_hooks';

// Registra no log do container quando o processo Node fica travado (2026-11-18,
// lentidão em produção sem rastro nenhum). O Node atende todas as requisições
// numa thread só: se algo segura essa thread (inferência de IA, JSON enorme,
// laço pesado), TUDO fica lento e conexões com o banco dão timeout ao mesmo
// tempo — foi o que se viu às 13:28 de 18/11, sem como saber depois o que era.
//
// A cada 30 s olha o maior atraso do event loop no período; acima de 1 s,
// grava uma linha "[event-loop]" com o atraso e a memória. Medição de baixo
// custo (histograma nativo do Node), não muda nada no comportamento.
const CHECK_INTERVAL_MS = 30_000;
const WARN_THRESHOLD_MS = 1_000;

let started = false;

export function startEventLoopMonitor(): void {
  if (started) return;
  started = true;

  const histogram = monitorEventLoopDelay({ resolution: 50 });
  histogram.enable();

  const timer = setInterval(() => {
    const maxMs = histogram.max / 1e6;
    const p99Ms = histogram.percentile(99) / 1e6;
    histogram.reset();
    if (maxMs < WARN_THRESHOLD_MS) return;
    const mem = process.memoryUsage();
    console.warn(
      `[event-loop] processo travado por até ${Math.round(maxMs)} ms nos últimos 30 s ` +
      `(p99 ${Math.round(p99Ms)} ms, heap ${Math.round(mem.heapUsed / 1048576)} MB, rss ${Math.round(mem.rss / 1048576)} MB)`
    );
  }, CHECK_INTERVAL_MS);
  timer.unref();
}
