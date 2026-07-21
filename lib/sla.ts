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
