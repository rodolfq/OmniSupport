import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';

// Só Administrador (ou quem tem settings:system, mesma permissão que já
// libera "Geral do Sistema") vê o log de alterações — é dado mais sensível
// que o resto de /reports (quem excluiu o quê), por isso a checagem extra
// aqui em vez de reusar REPORTS_READ como o resto da página.
async function getActor(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  if (!token) return null;

  const decoded = await verifyJWT(token);
  if (!decoded?.id) return null;

  const result = await query(
    `SELECT p.id, p.role, COALESCE(rp.permissions, '{}'::text[]) AS permissions
     FROM public.profiles p
     LEFT JOIN public.role_permissions rp ON rp.id = p.access_profile_id
     WHERE p.id = $1`,
    [decoded.id]
  );

  return result.rows[0] || null;
}

function canReadAuditLog(actor: any) {
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes('settings:system');
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    if (!canReadAuditLog(actor)) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get('entityType');
    const search = searchParams.get('search');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    const conditions: string[] = [];
    const params: any[] = [];
    if (entityType) {
      params.push(entityType);
      conditions.push(`entity_type = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(actor_name ILIKE $${params.length} OR entity_label ILIKE $${params.length})`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(`SELECT COUNT(*)::int AS total FROM public.audit_log ${whereClause}`, params);
    const total = countRes.rows[0]?.total ?? 0;

    const listParams = [...params, limit, offset];
    const res = await query(
      `SELECT id, actor_id, actor_name, action, entity_type, entity_id, entity_label, changes, created_at
       FROM public.audit_log
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    return NextResponse.json({
      data: res.rows.map(r => ({
        id: r.id,
        actorId: r.actor_id,
        actorName: r.actor_name,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        entityLabel: r.entity_label,
        changes: r.changes,
        createdAt: r.created_at
      })),
      meta: { limit, offset, total, hasMore: offset + res.rows.length < total }
    });
  } catch (error: any) {
    console.error('[reports/audit-log] Erro no GET:', error);
    return NextResponse.json({ error: 'Erro ao carregar log de alterações.' }, { status: 500 });
  }
}
