// Formatação de números de métricas de chat — compartilhada por todo
// relatório e pelo Dashboard Gerencial (extraído de dashboard/management/
// page.tsx quando o R1 virou o segundo consumidor). Um lugar só pra "1m 42s"
// nunca virar "1m42s" numa tela e "01:42" em outra.

export function formatSeconds(sec: number | null): string {
  if (sec === null || Number.isNaN(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function formatPercentage(pct: number | null): string {
  if (pct === null || Number.isNaN(pct)) return '—';
  return `${pct.toFixed(0)}%`;
}

// Abaixo de 1 minuto mostra só segundos ("24s"), nunca "0m 24s" nem "0,4 min".
export function formatMinutes(min: number | null): string {
  if (min === null || Number.isNaN(min)) return '—';
  const totalSeconds = Math.round(min * 60);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s}s`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function formatCount(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '—';
  return String(n);
}

export function formatAverage(n: number | null, decimals = 1): string {
  if (n === null || Number.isNaN(n)) return '—';
  return n.toFixed(decimals);
}

export function formatHours(hours: number | null, decimals = 1): string {
  if (hours === null || Number.isNaN(hours)) return '—';
  return `${hours.toFixed(decimals)}h`;
}

// Decimal no padrão brasileiro (vírgula), como manda o CLAUDE.md. Usado pelo dashboard
// de analistas; os formatadores acima continuam como estão, para não mudar as outras telas.
export function formatDecimalBr(n: number | null, decimals = 1): string {
  if (n === null || Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Indicador de tempo ADAPTATIVO: Dia/Hora/Minuto conforme a grandeza do
// valor, em vez de fixar uma unidade só (pedido do usuário, 2026-10-08).
// Pensado pra duração/SLA/backlog, que variam de minutos a vários dias —
// os formatadores acima (formatMinutes/formatHours/formatSeconds)
// continuam como estão de propósito (outras telas já dependem da unidade
// fixa deles); este é o ponto de entrada pra quem quiser a versão
// adaptativa num indicador novo ou numa tela sendo revista.
// Regra: < 60 min mostra só minutos; < 48h mostra horas (e minutos quando
// sobra resto); >= 48h vira dias (e horas quando sobra resto) — 48h é o
// mesmo corte que "backlog" já usa como "muito tempo aberto" em
// lib/ticket-points.ts, reaproveitado aqui por consistência.
export function formatDurationAdaptive(totalMinutes: number | null): string {
  if (totalMinutes === null || Number.isNaN(totalMinutes)) return '—';
  const minutosAbs = Math.round(Math.abs(totalMinutes));
  const sinal = totalMinutes < 0 ? '-' : '';
  if (minutosAbs < 60) return `${sinal}${minutosAbs}min`;

  const horasTotais = minutosAbs / 60;
  if (horasTotais < 48) {
    const horas = Math.floor(horasTotais);
    const minutosResto = minutosAbs % 60;
    return minutosResto > 0 ? `${sinal}${horas}h ${minutosResto}min` : `${sinal}${horas}h`;
  }

  const dias = Math.floor(horasTotais / 24);
  const horasResto = Math.floor(horasTotais % 24);
  return horasResto > 0 ? `${sinal}${dias}d ${horasResto}h` : `${sinal}${dias}d`;
}
