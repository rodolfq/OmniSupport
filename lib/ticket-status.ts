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

export function isClosedTicketStatus(status?: string | null): boolean {
  return CLOSED_TICKET_STATUSES.includes(status as (typeof CLOSED_TICKET_STATUSES)[number]);
}

export function isInProgressTicketStatus(status?: string | null): boolean {
  return IN_PROGRESS_TICKET_STATUSES.includes(status as (typeof IN_PROGRESS_TICKET_STATUSES)[number]);
}

export function getDefaultClosedTicketStatus(availableStatuses: string[] = []): string {
  return availableStatuses.find(isClosedTicketStatus) || TicketStatus.CLOSED;
}
