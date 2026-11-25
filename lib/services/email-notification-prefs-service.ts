import { query } from '../db';
import {
  EmailPrefs, sanitizeEmailPrefs, FIELD_CATEGORY, InternalChangeCategory,
} from '../email-notification-prefs';

/**
 * Preferências de e-mail de várias pessoas de uma vez. Banco ainda sem a
 * coluna (migration profile_email_notification_prefs.sql não aplicada) =
 * todo mundo com tudo ligado, como antes da tela existir.
 */
export async function loadEmailPrefs(userIds: string[]): Promise<Map<string, EmailPrefs>> {
  const map = new Map<string, EmailPrefs>();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return map;
  try {
    const res = await query('SELECT id, email_notification_prefs FROM public.profiles WHERE id = ANY($1::uuid[])', [ids]);
    for (const r of res.rows) map.set(r.id, sanitizeEmailPrefs(r.email_notification_prefs));
  } catch (err: any) {
    if (err?.code !== '42703') throw err;
  }
  return map;
}

// Campo do `fields` da rota → coluna de internal_tickets (para comparar com o
// valor gravado ANTES da mudança).
const FIELD_COLUMN: Record<string, string> = {
  status: 'status', subStatus: 'sub_status', internalQueueId: 'internal_queue_id',
  teamId: 'team_id', internalTeamId: 'internal_team_id', assigneeId: 'assignee_id',
  title: 'title', description: 'description', priority: 'priority', tags: 'tags',
  hotfixId: 'hotfix_id', effortId: 'effort_id', outcomeId: 'outcome_id',
  queueTopPriority: 'queue_top_priority', slaLimit: 'sla_limit',
  expectedPublishDate: 'expected_publish_date', qaRejected: 'qa_rejected',
  environmentRejected: 'environment_rejected',
};

/** Colunas que `changedCategories` precisa ler do ticket antes de gravar. */
export const CHANGE_COMPARE_COLUMNS = [...new Set(Object.values(FIELD_COLUMN))].join(', ');

function normalize(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (Array.isArray(value)) return JSON.stringify([...value].map(String).sort());
  if (value instanceof Date) return String(value.getTime());
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return String(t);
  }
  return String(value);
}

/**
 * Quais tipos de mudança uma gravação fez de verdade, comparando o que veio
 * com o que estava gravado. A tela reenvia o formulário inteiro, então campo
 * presente não quer dizer campo alterado. Campo sem categoria própria vai
 * para "other".
 */
export function changedCategories(before: Record<string, any> | null | undefined, fields: Record<string, any>): InternalChangeCategory[] {
  const out = new Set<InternalChangeCategory>();
  for (const [key, value] of Object.entries(fields || {})) {
    if (value === undefined) continue;
    const column = FIELD_COLUMN[key];
    if (!column) continue;
    if (before && normalize(before[column]) === normalize(value)) continue;
    out.add(FIELD_CATEGORY[key] || 'other');
  }
  return [...out];
}
