import { query } from '@/lib/db';

export type AuditAction = 'create' | 'update' | 'delete' | 'publish';

export interface AuditLogEntry {
  actorId: string | null;
  actorName: string;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  changes?: Record<string, unknown> | null;
}

// Grava uma linha no log de alterações. Nunca lança — uma falha aqui (ex:
// tabela indisponível num instante) não pode derrubar a ação principal que
// está sendo registrada, só perde aquela entrada de log (fica no console).
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    await query(
      `INSERT INTO public.audit_log (actor_id, actor_name, action, entity_type, entity_id, entity_label, changes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.actorId,
        entry.actorName,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.entityLabel ?? null,
        entry.changes ? JSON.stringify(entry.changes) : null
      ]
    );
  } catch (err) {
    console.error('[audit-log] Falha ao gravar entrada de log:', err);
  }
}
