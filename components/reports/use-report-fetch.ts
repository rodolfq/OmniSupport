'use client';

import { useEffect, useState } from 'react';
import { ReportSectionStatus } from './report-section';

// Hook compartilhado por todo relatório e pelo Dashboard Gerencial: busca
// uma "action" de uma rota de API de métricas e devolve o trio
// dado/status/retry que ReportSection espera — evita reimplementar
// loading/erro/abort em cada página nova (R1 é o primeiro consumidor).

// Atualização automática (pedido do usuário, 2026-11-03, só para as telas de
// /reports — Dashboard Gerencial em /dashboard/management, que usa este
// mesmo hook, fica de fora de propósito e passa `poll: false`): enquanto a
// tela está parada num relatório já carregado, refaz a busca sozinha de
// tempos em tempos — sem isso, um chat fechado/avaliado depois de o
// relatório ter sido gerado só aparece se a pessoa trocar de filtro ou dar
// F5. É SILENCIOSA (nunca volta pra 'loading' nem pisca a tabela): só troca
// o conteúdo quando a resposta chega, e erro nesse ciclo é ignorado (mantém
// o dado antigo na tela, tenta de novo no próximo ciclo) — diferente da 1ª
// carga, que mostra erro de verdade. Pausa com a aba em segundo plano, mesmo
// padrão já usado no poll de `chat-widget.tsx`/`app-context.tsx`.
const REPORT_POLL_INTERVAL_MS = 3 * 60 * 1000;

async function fetchReportAction<T>(endpoint: string, action: string, filterQs: string, extraQs: string, signal: AbortSignal): Promise<T> {
  const qs = extraQs ? `${filterQs}&${extraQs}` : filterQs;
  const res = await fetch(`${endpoint}?action=${action}&${qs}`, { signal });
  if (!res.ok) {
    // O corpo de erro (`{ error: "..." }`) sempre existiu na resposta, mas
    // era descartado — a tela só sabia "deu erro", nunca o quê, então
    // ReportSection sempre caía na mensagem genérica "Não foi possível
    // carregar estes dados.", mesmo quando a causa real (ex: tabela
    // inexistente, filtro inválido) já vinha pronta do servidor.
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Falha ao carregar (HTTP ${res.status}).`);
  }
  return res.json();
}

export function useReportFetch<T>(
  endpoint: string,
  action: string,
  filterQs: string,
  ready: boolean,
  extraQs = '',
  poll = true
): { data: T | null; status: ReportSectionStatus; error: string | null; retry: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<ReportSectionStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setStatus('loading');
    setError(null);
    fetchReportAction<T>(endpoint, action, filterQs, extraQs, controller.signal)
      .then((d) => {
        setData(d);
        setStatus('ready');
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(err.message || null);
        setStatus('error');
      });
    return () => controller.abort();
  }, [endpoint, action, filterQs, extraQs, ready, attempt]);

  useEffect(() => {
    if (!ready || !poll) return;
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const controller = new AbortController();
      fetchReportAction<T>(endpoint, action, filterQs, extraQs, controller.signal)
        .then((d) => {
          setData(d);
          setStatus('ready');
          setError(null);
        })
        .catch(() => {
          // Silencioso de propósito — ver comentário de REPORT_POLL_INTERVAL_MS.
        });
    }, REPORT_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [endpoint, action, filterQs, extraQs, ready, poll]);

  return { data, status, error, retry: () => setAttempt((a) => a + 1) };
}
