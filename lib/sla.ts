// Horário comercial fixo pro SLA de chamados: 8h-18h, segunda a sexta, sem
// desconto de almoço, sem cadastro de feriados (decisão do usuário, hotfix
// 31/08/2026) — 10h úteis por dia. Roda no client (Date local do navegador),
// mesmo padrão já usado pelo resto da tela pra formatar datas — a base de
// usuários é só Brasil, então o fuso do navegador já é o fuso certo.
const BUSINESS_DAY_START_HOUR = 8;
const BUSINESS_DAY_END_HOUR = 18;

function isWeekendDate(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

// Ponto de partida da contagem: se caiu fora do expediente (antes das 8h,
// depois das 18h ou num fim de semana), o prazo só começa a valer no próximo
// início de expediente — nunca conta hora "fora do horário" como parte do SLA.
function snapToBusinessStart(from: Date): Date {
  const result = new Date(from);
  if (result.getHours() >= BUSINESS_DAY_END_HOUR) {
    result.setDate(result.getDate() + 1);
    result.setHours(BUSINESS_DAY_START_HOUR, 0, 0, 0);
  } else if (result.getHours() < BUSINESS_DAY_START_HOUR) {
    result.setHours(BUSINESS_DAY_START_HOUR, 0, 0, 0);
  }
  while (isWeekendDate(result)) {
    result.setDate(result.getDate() + 1);
    result.setHours(BUSINESS_DAY_START_HOUR, 0, 0, 0);
  }
  return result;
}

/**
 * Soma `hours` horas ÚTEIS (8h-18h, seg-sex) a partir de `fromIso`, pulando
 * fim de semana — substitui a antiga soma de horas corridas (createdAt +
 * hours*3600000) usada no cálculo de SLA de chamado.
 */
export function addBusinessHours(fromIso: string, hours: number): Date {
  let cursor = snapToBusinessStart(new Date(fromIso));
  let remainingMs = hours * 60 * 60 * 1000;

  while (remainingMs > 0) {
    const endOfDay = new Date(cursor);
    endOfDay.setHours(BUSINESS_DAY_END_HOUR, 0, 0, 0);
    const availableMsToday = endOfDay.getTime() - cursor.getTime();

    if (remainingMs <= availableMsToday) {
      cursor = new Date(cursor.getTime() + remainingMs);
      remainingMs = 0;
    } else {
      remainingMs -= availableMsToday;
      cursor = endOfDay;
      do {
        cursor.setDate(cursor.getDate() + 1);
      } while (isWeekendDate(cursor));
      cursor.setHours(BUSINESS_DAY_START_HOUR, 0, 0, 0);
    }
  }
  return cursor;
}

// SLA de ticket interno: a prioridade (1-4) reflete o mesmo catálogo de
// prazos configurado em Configurações para chamados (config_priorities),
// mapeando o nível numérico pro rótulo em texto usado lá.

export const INTERNAL_PRIORITY_LABELS: Record<number, string> = {
  1: 'Baixa',
  2: 'Média',
  3: 'Alta',
  4: 'Urgente',
};

export function computeInternalTicketSla(
  priority: number,
  fromIso: string,
  priorityConfigs: Array<{ label: string; sla_hours?: number; slaHours?: number }>
): string | null {
  const label = INTERNAL_PRIORITY_LABELS[priority] || 'Baixa';
  const config = priorityConfigs.find(p => p.label === label);
  const hours = config?.sla_hours ?? config?.slaHours;
  if (!hours) return null;
  return new Date(new Date(fromIso).getTime() + hours * 60 * 60 * 1000).toISOString();
}
