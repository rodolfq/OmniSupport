import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';

// Registro RÍGIDO de criação de usuários (public.user_creation_log, gravado por
// gatilho no banco — ver migrations/user_creation_log.sql): quem foi criado e por
// qual login. Só leitura. Mesma restrição do Log de Alterações: Administrador,
// reports:audit_log ou settings:system — é dado sensível (quem cadastrou quem).
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

function canRead(actor: any) {
  return actor?.role === 'Administrador'
    || (actor?.permissions || []).includes('reports:audit_log')
    || (actor?.permissions || []).includes('settings:system');
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    if (!canRead(actor)) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const source = searchParams.get('source');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    const conditions: string[] = [];
    const params: any[] = [];
    if (source) {
      params.push(source);
      conditions.push(`source = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      const n = params.length;
      conditions.push(`(created_user_name ILIKE $${n} OR created_user_email ILIKE $${n} OR created_by_name ILIKE $${n}
        OR created_by_email ILIKE $${n} OR created_user_company_name ILIKE $${n} OR actor_label ILIKE $${n})`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(`SELECT COUNT(*)::int AS total FROM public.user_creation_log ${whereClause}`, params);
    const total = countRes.rows[0]?.total ?? 0;

    const listParams = [...params, limit, offset];
    const res = await query(
      `SELECT id, created_at, created_user_id, created_user_name, created_user_email, created_user_role,
              created_user_company_name, created_by_id, created_by_name, created_by_email, created_by_role,
              source, actor_label, ip, user_agent
         FROM public.user_creation_log
         ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    return NextResponse.json({
      data: res.rows.map(r => ({
        id: r.id,
        createdAt: r.created_at,
        createdUserId: r.created_user_id,
        createdUserName: r.created_user_name,
        createdUserEmail: r.created_user_email,
        createdUserRole: r.created_user_role,
        createdUserCompanyName: r.created_user_company_name,
        createdById: r.created_by_id,
        createdByName: r.created_by_name,
        createdByEmail: r.created_by_email,
        createdByRole: r.created_by_role,
        source: r.source,
        actorLabel: r.actor_label,
        ip: r.ip,
        userAgent: r.user_agent
      })),
      meta: { limit, offset, total, hasMore: offset + res.rows.length < total }
    });
  } catch (error: any) {
    console.error('[reports/user-creation-log] Erro no GET:', error);
    return NextResponse.json({ error: 'Erro ao carregar o registro de criação de usuários.' }, { status: 500 });
  }
}
