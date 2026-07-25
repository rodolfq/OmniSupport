import { TicketStatus } from './types';

export const CLOSED_TICKET_STATUSES = [
  TicketStatus.CLOSED,
  'Concluído',
  'Encerrado',
  'Mesclado',
] as const;

export const IN_PROGRESS_TICKET_STATUSES = [
  TicketStatus.IN_PROGRESS,
  'Em Andamento',
] as const;

// Status cadastrados manualmente (Configurações > Geral > Status) também podem
// ser marcados como "finaliza o chamado" (config_statuses.is_closed) — esse
// Set é alimentado em runtime por registerClosedStatusLabels sempre que a
// lista de status é buscada do banco (ver ConfigService.getStatuses), pra não
// precisar re-listar cada tela que já chamava isClosedTicketStatus.
const dynamicClosedLabels = new Set<string>(CLOSED_TICKET_STATUSES as readonly string[]);

export function registerClosedStatusLabels(statuses: { label: string; isClosed?: boolean; is_closed?: boolean }[]): void {
  for (const s of statuses) {
    if (s.isClosed || s.is_closed) dynamicClosedLabels.add(s.label);
  }
}

export function isClosedTicketStatus(status?: string | null): boolean {
  if (!status) return false;
  return dynamicClosedLabels.has(status);
}

export function isInProgressTicketStatus(status?: string | null): boolean {
  return IN_PROGRESS_TICKET_STATUSES.includes(status as (typeof IN_PROGRESS_TICKET_STATUSES)[number]);
}

export function getDefaultClosedTicketStatus(availableStatuses: string[] = []): string {
  return availableStatuses.find(isClosedTicketStatus) || TicketStatus.CLOSED;
}
