import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { logAudit } from '@/lib/audit-log';
import { getCurrentActionUser } from '@/lib/server-auth';
import { assertCanManageInternalQueues, permissionErrorStatus } from '@/lib/server-permissions';

/**
 * Filas de ticket interno (public.internal_ticket_queues, 2026-11-13).
 * Substituem o campo "Equipe" no ticket interno. NÃO são public.queues (filas
 * de atendimento de chat, rota /api/queues).
 *
 *   GET  ............ lista (qualquer usuário de equipe: alimenta o campo Fila)
 *   POST save ........ cria/edita nome, membros, ativa  — internal:queues_manage
 *   POST delete ...... exclui (tickets da fila ficam sem fila) — idem
 */

const TEAM_ROLES = ['Administrador', 'Equipe', 'Time Interno'];

function toQueue(r: any) {
  return {
    id: r.id,
    name: r.name,
    memberIds: r.member_ids || [],
    isActive: r.is_active,
    sortOrder: r.sort_order,
    ticketCount: r.ticket_count !== undefined ? Number(r.ticket_count) : undefined
  };
}

export async function GET() {
  const actor = await getCurrentActionUser();
  if (!actor) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
  if (!TEAM_ROLES.includes(actor.role)) return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });
  const res = await query(
    `SELECT q.*, (SELECT count(*) FROM public.internal_tickets it WHERE it.internal_queue_id = q.id) AS ticket_count
       FROM public.internal_ticket_queues q
      ORDER BY q.sort_order, lower(q.name)`
  );
  return NextResponse.json(res.rows.map(toQueue));
}

export async function POST(request: Request) {
  const check = await assertCanManageInternalQueues();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
  const actor = check.actor;

  try {
    const body = await request.json();
    const action = body.action;

    if (action === 'save') {
      const name = String(body.name || '').trim();
      if (!name) return NextResponse.json({ error: 'Informe o nome da fila.' }, { status: 400 });
      const isActive = body.isActive !== false;
      // Só ids com formato de uuid — um valor qualquer derrubaria a consulta.
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const rawMembers: string[] = Array.isArray(body.memberIds) ? body.memberIds.filter((x: any) => typeof x === 'string' && UUID_RE.test(x)) : [];
      // Só gente de equipe pode ser membro (mesmo critério do Responsável).
      const members = rawMembers.length
        ? (await query(
            `SELECT id FROM public.profiles WHERE id = ANY($1::uuid[]) AND role IN ('Administrador','Equipe','Time Interno')`,
            [rawMembers]
          )).rows.map((r: any) => r.id)
        : [];

      const dup = await query(
        `SELECT id FROM public.internal_ticket_queues WHERE lower(name) = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid)`,
        [name, body.id || null]
      );
      if (dup.rows[0]) return NextResponse.json({ error: 'Já existe uma fila com esse nome.' }, { status: 409 });

      if (body.id) {
        const before = (await query('SELECT * FROM public.internal_ticket_queues WHERE id = $1', [body.id])).rows[0];
        if (!before) return NextResponse.json({ error: 'Fila não encontrada.' }, { status: 404 });
        const res = await query(
          `UPDATE public.internal_ticket_queues
              SET name = $2, member_ids = $3::uuid[], is_active = $4, updated_at = now()
            WHERE id = $1 RETURNING *`,
          [body.id, name, members, isActive]
        );
        await logAudit({
          entityType: 'internal_ticket_queue', entityId: body.id, action: 'update', actorId: actor.id, actorName: actor.name,
          changes: { name: [before.name, name], members: [before.member_ids?.length || 0, members.length], isActive: [before.is_active, isActive] }
        } as any);
        return NextResponse.json(toQueue(res.rows[0]));
      }

      const order = (await query('SELECT COALESCE(max(sort_order), 0) + 1 AS n FROM public.internal_ticket_queues')).rows[0].n;
      const res = await query(
        `INSERT INTO public.internal_ticket_queues (name, member_ids, is_active, sort_order)
         VALUES ($1, $2::uuid[], $3, $4) RETURNING *`,
        [name, members, isActive, order]
      );
      await logAudit({
        entityType: 'internal_ticket_queue', entityId: res.rows[0].id, action: 'create', actorId: actor.id, actorName: actor.name,
        changes: { name, members: members.length }
      } as any);
      return NextResponse.json(toQueue(res.rows[0]));
    }

    if (action === 'delete') {
      if (!body.id) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });
      const res = await query('DELETE FROM public.internal_ticket_queues WHERE id = $1 RETURNING name', [body.id]);
      if (!res.rows[0]) return NextResponse.json({ error: 'Fila não encontrada.' }, { status: 404 });
      await logAudit({
        entityType: 'internal_ticket_queue', entityId: body.id, action: 'delete', actorId: actor.id, actorName: actor.name,
        changes: { name: res.rows[0].name }
      } as any);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (err: any) {
    console.error('[internal-ticket-queues]', err);
    return NextResponse.json({ error: 'Erro ao salvar a fila.' }, { status: 500 });
  }
}
