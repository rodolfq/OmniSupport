'use client';

import { useEffect, useState } from 'react';
import { ReportSectionStatus } from './report-section';

// Hook compartilhado por todo relatório e pelo Dashboard Gerencial: busca
// uma "action" de uma rota de API de métricas e devolve o trio
// dado/status/retry que ReportSection espera — evita reimplementar
// loading/erro/abort em cada página nova (R1 é o primeiro consumidor).

async function fetchReportAction<T>(endpoint: string, action: string, filterQs: string, extraQs: string, signal: AbortSignal): Promise<T> {
  const qs = extraQs ? `${filterQs}&${extraQs}` : filterQs;
  const res = await fetch(`${endpoint}?action=${action}&${qs}`, { signal });
  if (!res.ok) throw new Error(`Falha ao carregar (${res.status})`);
  return res.json();
}

export function useReportFetch<T>(
  endpoint: string,
  action: string,
  filterQs: string,
  ready: boolean,
  extraQs = ''
): { data: T | null; status: ReportSectionStatus; retry: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<ReportSectionStatus>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setStatus('loading');
    fetchReportAction<T>(endpoint, action, filterQs, extraQs, controller.signal)
      .then((d) => {
        setData(d);
        setStatus('ready');
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setStatus('error');
      });
    return () => controller.abort();
  }, [endpoint, action, filterQs, extraQs, ready, attempt]);

  return { data, status, retry: () => setAttempt((a) => a + 1) };
}
