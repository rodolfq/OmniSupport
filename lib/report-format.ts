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
