// Classifica cada linha da escala de fim de semana em passado / próximo fim
// de semana / restante, pra destacar com cores diferentes (popover e tela
// cheia — ver components/giro-status-popover.tsx e
// components/weekend-schedule-content.tsx). `todayIso` vem sempre do
// servidor (lib/services/weekend-schedule-service.ts via Postgres), nunca do
// relógio do navegador.

export type WeekendRowStatus = 'past' | 'next' | 'upcoming';

interface DatedRow {
  date: string; // DD/MM/AAAA
  weekday: string; // "Sábado" | "Domingo" | ...
}

function toIso(dateBr: string): string {
  const [d, m, y] = dateBr.split('/');
  return `${y}-${m}-${d}`;
}

/**
 * "Próximo fim de semana" é o par Sábado+Domingo (ou só um dos dois, se o
 * outro já passou) mais próximo que ainda não é passado — não simplesmente
 * "a primeira linha futura", porque aquela pode ser só o Domingo de um
 * Sábado que já passou.
 */
export function classifyWeekendRows<T extends DatedRow>(rows: T[], todayIso: string): (T & { status: WeekendRowStatus })[] {
  const isPast = rows.map(r => toIso(r.date) < todayIso);
  const nextIdx = isPast.findIndex(p => !p);

  if (nextIdx === -1) {
    // Nada futuro na aba (mês acabando) — tudo passado.
    return rows.map((r, i) => ({ ...r, status: isPast[i] ? 'past' : 'upcoming' as WeekendRowStatus }));
  }

  // Sábado abre o par com o Domingo seguinte; Domingo sozinho (Sábado já
  // passou) fecha o par nele mesmo.
  const nextIndices = new Set([nextIdx]);
  if (rows[nextIdx].weekday === 'Sábado' && rows[nextIdx + 1]?.weekday === 'Domingo') {
    nextIndices.add(nextIdx + 1);
  }

  return rows.map((r, i) => ({
    ...r,
    status: isPast[i] ? 'past' : nextIndices.has(i) ? 'next' : 'upcoming'
  }));
}
