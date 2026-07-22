// "Recusar por 1 semana" na avaliação interna de cliente (ver
// components/customer-evaluation-modal.tsx): guarda em localStorage, por
// analista + empresa, até quando o convite de avaliação deve ficar em
// silêncio. É só uma preferência de UX (não bloqueia nada no servidor) —
// por isso local, sem precisar de tabela nova no banco.
const STORAGE_KEY = 'omni_eval_snoozed_companies';

type SnoozeMap = Record<string, string>;

function readMap(): SnoozeMap {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeMap(map: SnoozeMap) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage indisponível (modo privado, quota etc.) — degrada
    // silenciosamente: o pior caso é perguntar de novo antes da hora.
  }
}

export function isEvaluationSnoozed(userId: string, companyId: string): boolean {
  const until = readMap()[`${userId}:${companyId}`];
  if (!until) return false;
  return new Date(until).getTime() > Date.now();
}

export function snoozeEvaluation(userId: string, companyId: string, days = 7): void {
  const map = readMap();
  map[`${userId}:${companyId}`] = new Date(Date.now() + days * 24 * 3600_000).toISOString();
  writeMap(map);
}
