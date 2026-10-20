import type { ReleaseCycleStage, ReleaseStageStatus, ReleaseTemplateStage, ReleaseItemType } from './types';

/**
 * Regras puras do ciclo de publicação — sem import de `pg`/Next, de
 * propósito: este arquivo é usado tanto no servidor
 * (app/api/release-cycles/route.ts, lib/services/release-cycle-scheduler.ts)
 * quanto no cliente (components/release-timeline.tsx,
 * components/hotfixes-content.tsx), igual a lib/sla.ts e lib/ticket-status.ts.
 *
 * Status de ETAPA é sempre CALCULADO a partir das datas — nunca persistido
 * no banco —, exceto completedAt, que é o único dado de verdade gravado.
 * Um ITEM (hotfix/publicação) não tem data própria — sua "posição no
 * tempo" é só a etapa compartilhada a que está atrelado (currentStageId).
 */

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysToIsoDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Status de UMA etapa, isolada — sem considerar as outras (ver computeStagesWithStatus). */
export function computeBaseStageStatus(
  stage: { startDate: string; endDate: string; completedAt?: string | null },
  today: string = todayIsoDate()
): Exclude<ReleaseStageStatus, 'em_risco'> {
  if (stage.completedAt) return 'concluida';
  if (stage.endDate < today) return 'atrasada';
  if (stage.startDate <= today) return 'em_andamento';
  return 'pendente';
}

/**
 * Aplica o efeito cascata: se uma etapa anterior (por stageOrder) está
 * atrasada e ainda não foi concluída, toda etapa PENDENTE depois dela nesse
 * mesmo ciclo fica "em risco" — só aviso visual, nunca move data de ninguém
 * sozinho. `stages` deve ser de UM MESMO ciclo, em qualquer ordem (a função
 * ordena por stageOrder internamente).
 */
export function computeStagesWithStatus<T extends { stageOrder: number; startDate: string; endDate: string; completedAt?: string | null }>(
  stages: T[],
  today: string = todayIsoDate()
): Array<T & { status: ReleaseStageStatus }> {
  const ordered = [...stages].sort((a, b) => a.stageOrder - b.stageOrder);
  let sawUnresolvedDelay = false;
  return ordered.map(stage => {
    const base = computeBaseStageStatus(stage, today);
    let status: ReleaseStageStatus = base;
    if (base === 'pendente' && sawUnresolvedDelay) status = 'em_risco';
    if (base === 'atrasada') sawUnresolvedDelay = true;
    return { ...stage, status };
  });
}

/** true = o ciclo inteiro está travado (última etapa concluída => release_cycles.published_at setado). */
export function isLastStage(stage: { stageOrder: number }, allStages: { stageOrder: number }[]): boolean {
  if (allStages.length === 0) return false;
  const maxOrder = Math.max(...allStages.map(s => s.stageOrder));
  return stage.stageOrder === maxOrder;
}

export interface GeneratedStageDraft {
  templateStageId: string;
  stageOrder: number;
  name: string;
  description: string | null;
  color: string;
  icon: string | null;
  startDate: string;
  endDate: string;
  teamId: string | null;
  responsibleIds: string[];
}

/** Gera as etapas concretas de um ciclo a partir do modelo + data-âncora. */
export function generateStagesFromTemplate(templateStages: ReleaseTemplateStage[], anchorDate: string): GeneratedStageDraft[] {
  return [...templateStages]
    .sort((a, b) => a.stageOrder - b.stageOrder)
    .map(ts => ({
      templateStageId: ts.id,
      stageOrder: ts.stageOrder,
      name: ts.name,
      description: ts.description ?? null,
      color: ts.color,
      icon: ts.icon ?? null,
      startDate: addDaysToIsoDate(anchorDate, ts.offsetStartDays),
      endDate: addDaysToIsoDate(anchorDate, ts.offsetEndDays),
      teamId: ts.defaultTeamId ?? null,
      responsibleIds: ts.defaultResponsibleIds || []
    }));
}

export const RELEASE_ITEM_TYPE_META: Record<ReleaseItemType, { label: string; short: string; color: string }> = {
  hotfix: { label: 'Hotfix', short: 'HF', color: '#6366f1' },
  emergencial: { label: 'Publicação Emergencial', short: 'EMG', color: '#f97316' },
  prevista: { label: 'Publicação Prevista', short: 'PREV', color: '#14b8a6' },
};

export const STAGE_STATUS_META: Record<ReleaseStageStatus, { label: string; textVar: string; surfaceVar: string }> = {
  pendente: { label: 'Pendente', textVar: 'var(--text-tertiary)', surfaceVar: 'var(--surface-pill)' },
  em_andamento: { label: 'Em andamento', textVar: 'var(--accent-text)', surfaceVar: 'var(--accent)' },
  concluida: { label: 'Concluída', textVar: 'var(--text-success)', surfaceVar: 'var(--surface-success)' },
  atrasada: { label: 'Atrasada', textVar: 'var(--text-danger)', surfaceVar: 'var(--surface-danger)' },
  em_risco: { label: 'Em risco', textVar: 'var(--text-warning-strong)', surfaceVar: 'var(--surface-warning)' },
};

export function isStageMilestone(stage: { startDate: string; endDate: string }): boolean {
  return stage.startDate === stage.endDate;
}

/** Diferença em dias inteiros entre duas datas ISO (b - a). */
export function diffIsoDays(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00`).getTime();
  const db = new Date(`${b}T00:00:00`).getTime();
  return Math.round((db - da) / 86400000);
}

export function formatIsoDatePtBr(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR');
}

/** Pra "transformar ciclo em modelo": deslocamento em dias a partir da âncora. */
export function computeOffsetsFromAnchor(stage: ReleaseCycleStage, anchorDate: string): { offsetStartDays: number; offsetEndDays: number } {
  return {
    offsetStartDays: diffIsoDays(anchorDate, stage.startDate),
    offsetEndDays: diffIsoDays(anchorDate, stage.endDate),
  };
}
