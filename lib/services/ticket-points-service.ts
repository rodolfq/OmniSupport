import { query } from '@/lib/db';
import { logAudit } from '@/lib/audit-log';
import {
  DEFAULT_TICKET_CONFIG, TicketConfigValues, normalizeTicketConfig, diffTicketConfig, labelDoCampo, TicketConfigChange,
} from '@/lib/ticket-points';

// Configuração de metas e pontos de chamados (migrations/ticket_points_config.sql).
// Enquanto a tabela não existir, a leitura devolve os padrões do código. Salvar exige a tabela.

const UNDEFINED_TABLE = '42P01';

export interface TicketConfigRecord {
  config: TicketConfigValues;
  updatedAt: string | null;
  isDefault: boolean;
}

export async function getTicketConfig(): Promise<TicketConfigRecord> {
  try {
    const res = await query(`SELECT config, updated_at FROM public.ticket_points_config WHERE id = 1`);
    const row = res.rows[0];
    if (!row) return { config: DEFAULT_TICKET_CONFIG, updatedAt: null, isDefault: true };
    return {
      config: normalizeTicketConfig(row.config),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      isDefault: false,
    };
  } catch (err: any) {
    if (err?.code === UNDEFINED_TABLE) return { config: DEFAULT_TICKET_CONFIG, updatedAt: null, isDefault: true };
    throw err;
  }
}

// Grava e registra no log quem mudou o quê (antes e depois). Sem mudança de valor, não grava linha no log.
export async function saveTicketConfig(next: TicketConfigValues, actor: { id: string; name: string }): Promise<TicketConfigRecord> {
  const before = await getTicketConfig();
  await query(
    `INSERT INTO public.ticket_points_config (id, config, updated_at, updated_by)
     VALUES (1, $1::jsonb, now(), $2)
     ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(next), actor.id]
  );
  const changes = diffTicketConfig(before.config, next);
  if (changes.length > 0 || before.isDefault) {
    await logAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: before.isDefault ? 'create' : 'update',
      entityType: 'ticket_points_config',
      entityId: '1',
      entityLabel: 'Pontuação de chamados',
      changes: { alteracoes: changes, primeiraConfiguracao: before.isDefault },
    });
  }
  return getTicketConfig();
}

export interface TicketConfigHistoryEntry {
  id: string;
  quando: string;
  quem: string;
  acao: string;
  primeiraConfiguracao: boolean;
  alteracoes: (TicketConfigChange & { rotulo: string })[];
}

export async function getTicketConfigHistory(limit = 30): Promise<TicketConfigHistoryEntry[]> {
  try {
    const res = await query(
      `SELECT id, actor_name, action, changes, created_at
         FROM public.audit_log
        WHERE entity_type = 'ticket_points_config'
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit]
    );
    return res.rows.map(r => ({
      id: r.id,
      quando: new Date(r.created_at).toISOString(),
      quem: r.actor_name,
      acao: r.action,
      primeiraConfiguracao: !!r.changes?.primeiraConfiguracao,
      alteracoes: (r.changes?.alteracoes ?? []).map((c: TicketConfigChange) => ({ ...c, rotulo: labelDoCampo(c.campo) })),
    }));
  } catch (err: any) {
    if (err?.code === UNDEFINED_TABLE) return [];
    throw err;
  }
}
