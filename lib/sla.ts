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
 *
 * Só usada hoje pra prioridade "Urgente" (ver HOURLY_SLA_PRIORITY_LABEL
 * abaixo) — as demais prioridades usam `addBusinessDays`.
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

/**
 * Soma `days` DIAS ÚTEIS inteiros a partir de `fromIso` — pedido do usuário,
 * 2026-11-16 (chamado #7054: SLA "15 dias" = 360h úteis virava 04/01/2027 em
 * vez de ~28/11, porque a conta era em HORAS úteis de 8h-18h, não em dias
 * inteiros). Regras explícitas do pedido:
 *   - o dia da ABERTURA nunca conta (a contagem começa no dia seguinte);
 *   - a hora da abertura não importa — não há fração de dia;
 *   - cada dia útil (seg-sex, sem feriado cadastrado — mesma convenção de
 *     `isWeekendDate` acima) que vier depois consome 1 dia do prazo;
 *   - o vencimento cai no INÍCIO do expediente (8h) do dia útil que fecha a
 *     contagem.
 */
export function addBusinessDays(fromIso: string, days: number): Date {
  const cursor = new Date(fromIso);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() + 1); // nunca conta o dia da abertura

  let remaining = Math.max(1, Math.round(days));
  while (true) {
    if (!isWeekendDate(cursor)) {
      remaining--;
      if (remaining === 0) break;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  cursor.setHours(BUSINESS_DAY_START_HOUR, 0, 0, 0);
  return cursor;
}

// "Urgente" fica de fora da contagem por dias inteiros (decisão do usuário,
// 2026-11-16): virar dia útil inteiro quase dobraria o prazo real da
// prioridade mais crítica (ex.: aberto sexta à tarde só venceria na
// segunda). Só ela continua em `addBusinessHours`; as demais (Baixa/Média/
// Alta e qualquer prioridade nova) usam `addBusinessDays`. Mesmo rótulo
// hardcoded espelhado em app/api/search/route.ts (`ticket_sla_deadline`,
// função Postgres) — mudar aqui sem mudar lá quebra a consistência entre a
// tela do chamado e o card "SLA Vencido" do Dashboard.
export const HOURLY_SLA_PRIORITY_LABEL = 'Urgente';

// Prioridade, como ela chega de GET /api/config?type=priorities (sla_hours,
// snake_case puro — ver app/api/config/route.ts) ou de algum consumidor mais
// antigo que normalizou pra camelCase. Aceita as duas por via das dúvidas,
// mas a fonte real hoje é sempre snake_case.
export interface TicketPriorityConfig {
  label: string;
  sla_hours?: number | null;
  slaHours?: number | null;
}

/**
 * Vencimento (Prazo/SLA) de UM chamado — ÚNICA fórmula no projeto pra isso:
 * acha a prioridade pelo rótulo e soma as horas úteis configuradas nela a
 * partir da abertura do chamado. Null = prioridade sem SLA configurado (sem
 * `sla_hours`) ou sem prioridade reconhecida — nesses casos não existe
 * vencimento, não é erro.
 *
 * Existia reimplementada à mão em pelo menos 3 arquivos (lista de chamados,
 * detalhe do chamado, Dashboard — este com 4 cópias só dele) — cada um lendo
 * a config de prioridades de uma fonte diferente, o que fazia o mesmo chamado
 * mostrar um Vencimento diferente dependendo de qual tela tinha carregado a
 * config mais recente (2026-10-16, achado do usuário: lista e detalhe do
 * chamado divergindo). Centralizado aqui — qualquer tela nova que precisar
 * mostrar "Vencimento" deve chamar esta função (ou `getTicketSlaStatus`
 * abaixo), nunca recalcular na mão, e sempre ler a config de prioridades via
 * `useConfigPrioritiesQuery` (lib/query-hooks.ts) — mesmo cache em toda tela,
 * invalidado junto quando o SLA de uma prioridade é editado em Configurações
 * (components/system-config-content.tsx).
 */
export function computeTicketSlaLimit(
  createdAt: string,
  priorityLabel: string | null | undefined,
  priorities: TicketPriorityConfig[] | null | undefined
): Date | null {
  const config = (priorities || []).find(p => p.label === priorityLabel);
  const hours = config?.sla_hours ?? config?.slaHours;
  if (!hours) return null;
  // Urgente continua em horas úteis; as demais viram dias úteis inteiros
  // (o campo de Configurações continua guardando HORAS — só a fórmula lê
  // esse número como `horas / 24 = dias`, pedido do usuário 2026-11-16).
  if (priorityLabel === HOURLY_SLA_PRIORITY_LABEL) {
    return addBusinessHours(createdAt, hours);
  }
  return addBusinessDays(createdAt, hours / 24);
}

export interface TicketSlaStatus {
  limit: Date | null;
  isOverdue: boolean;
  // Urgente: vence em menos de 4h de relógio, ainda não vencido. Demais
  // prioridades (dias úteis): vence HOJE, ainda não vencido.
  isNear: boolean;
}

/** Vencimento + se já venceu/está perto de vencer — mesma janela de "perto
 * do vencimento" (4h) usada em toda tela que mostra esse aviso. Chamado
 * fechado nunca é tratado como vencido (quem chama decide se filtra fechado
 * antes; esta função só calcula a data, `isClosedTicketStatus` é de quem usa).
 * `exempt` (pedido do usuário, 2026-11-03): sub-status marcado "Ignora SLA"
 * em Configurações > Status (`config_statuses.sla_exempt`) — o Vencimento
 * continua calculado e exibido (é só informativo), mas nunca conta como
 * vencido/perto de vencer enquanto o chamado estiver nesse sub-status. Quem
 * chama decide o exempt via `isTicketSlaExempt` abaixo, mesma convenção de
 * `isClosedTicketStatus`. */
export function getTicketSlaStatus(
  createdAt: string,
  priorityLabel: string | null | undefined,
  priorities: TicketPriorityConfig[] | null | undefined,
  now: Date = new Date(),
  exempt: boolean = false
): TicketSlaStatus {
  const limit = computeTicketSlaLimit(createdAt, priorityLabel, priorities);
  if (!limit) return { limit: null, isOverdue: false, isNear: false };
  if (exempt) return { limit, isOverdue: false, isNear: false };
  const diffMs = limit.getTime() - now.getTime();
  const isOverdue = diffMs < 0;
  // Urgente: mantém a janela de "perto de vencer" em horas de relógio (4h),
  // igual sempre foi — faz sentido numa escala de horas.
  if (priorityLabel === HOURLY_SLA_PRIORITY_LABEL) {
    return { limit, isOverdue, isNear: diffMs > 0 && diffMs < 4 * 60 * 60 * 1000 };
  }
  // Demais prioridades (dias úteis inteiros): "perto de vencer" = o
  // vencimento cai no mesmo dia de calendário de `now`, ainda não vencido —
  // janela de horas não faz sentido numa escala de dias. Não documentado no
  // pedido original; avisar se quiser outro critério.
  const sameCalendarDay = limit.getFullYear() === now.getFullYear()
    && limit.getMonth() === now.getMonth()
    && limit.getDate() === now.getDate();
  return { limit, isOverdue, isNear: !isOverdue && sameCalendarDay };
}

// Status, como `getTicketSlaStatus` precisa pra achar o sub-status (só os
// 3 campos que importam aqui — aceita tanto StatusConfig quanto a resposta
// crua snake_case da API, pra não forçar normalização em quem só quer
// checar isenção).
export interface SlaExemptStatusLike {
  label: string;
  parentStatusId?: string | null;
  parent_status_id?: string | null;
  slaExempt?: boolean;
  sla_exempt?: boolean;
}

/** O chamado está num sub-status marcado "Ignora SLA"? Sub-status é
 * identificado por RÓTULO (igual o próprio `tickets.sub_status`, que não é
 * FK) — por isso compara `label`, não id. */
export function isTicketSlaExempt(
  subStatusLabel: string | null | undefined,
  statuses: SlaExemptStatusLike[] | null | undefined
): boolean {
  if (!subStatusLabel || !statuses?.length) return false;
  return statuses.some(s =>
    s.label === subStatusLabel &&
    (s.parentStatusId ?? s.parent_status_id) &&
    (s.slaExempt ?? s.sla_exempt)
  );
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
