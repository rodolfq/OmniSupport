import { NextResponse } from 'next/server';
import { query, pool } from '@/lib/db';
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
 *   POST set-statuses  status que a fila usa (vazio = todos) — idem
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
    statusIds: r.status_ids || [],
    ticketCount: r.ticket_count !== undefined ? Number(r.ticket_count) : undefined
  };
}

export async function GET() {
  const actor = await getCurrentActionUser();
  if (!actor) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
  if (!TEAM_ROLES.includes(actor.role)) return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });
  const base = `SELECT q.*, (SELECT count(*) FROM public.internal_tickets it WHERE it.internal_queue_id = q.id) AS ticket_count`;
  const order = `FROM public.internal_ticket_queues q ORDER BY q.sort_order, lower(q.name)`;
  try {
    // Status que cada fila usa, na ordem da fila (2026-11-24). Vazio = todos.
    const res = await query(
      `${base},
              ARRAY(SELECT qs.status_id FROM public.internal_ticket_queue_statuses qs
                     WHERE qs.queue_id = q.id ORDER BY qs.sort_order) AS status_ids
         ${order}`
    );
    return NextResponse.json(res.rows.map(toQueue));
  } catch (err: any) {
    if (err?.code !== '42P01') throw err;
    // Banco sem migrations/internal_ticket_queue_statuses.sql: filas sem restrição.
    const res = await query(`${base} ${order}`);
    return NextResponse.json(res.rows.map(toQueue));
  }
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

    if (action === 'set-statuses') {
      // Status que a fila usa (2026-11-24). statusIds chega na ordem da fila
      // (topo e sub-status). Lista vazia = volta a usar todos os status.
      if (!body.id) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const requested: string[] = Array.isArray(body.statusIds)
        ? [...new Set<string>(body.statusIds.filter((x: any) => typeof x === 'string' && UUID_RE.test(x)))]
        : [];
      const queue = (await query('SELECT name FROM public.internal_ticket_queues WHERE id = $1', [body.id])).rows[0];
      if (!queue) return NextResponse.json({ error: 'Fila não encontrada.' }, { status: 404 });

      const known = requested.length
        ? (await query(
            `SELECT id, label, parent_status_id FROM public.config_statuses
              WHERE scope = 'internal_ticket' AND id = ANY($1::uuid[])`,
            [requested]
          )).rows
        : [];
      const byId = new Map(known.map((r: any) => [r.id, r]));
      // Sub-status sem o pai na fila não teria onde aparecer: descarta.
      const ids = requested.filter(id => {
        const s: any = byId.get(id);
        return s && (!s.parent_status_id || requested.includes(s.parent_status_id));
      });
      if (requested.length > 0 && !ids.some(id => !(byId.get(id) as any).parent_status_id)) {
        return NextResponse.json({ error: 'Escolha ao menos um status (não só sub-status).' }, { status: 400 });
      }

      const before = (await query(
        `SELECT cs.label FROM public.internal_ticket_queue_statuses qs JOIN public.config_statuses cs ON cs.id = qs.status_id
          WHERE qs.queue_id = $1 ORDER BY qs.sort_order`,
        [body.id]
      )).rows.map((r: any) => r.label);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM public.internal_ticket_queue_statuses WHERE queue_id = $1', [body.id]);
        if (ids.length) {
          await client.query(
            `INSERT INTO public.internal_ticket_queue_statuses (queue_id, status_id, sort_order)
             SELECT $1::uuid, s.id, s.ord FROM unnest($2::uuid[]) WITH ORDINALITY AS s(id, ord)`,
            [body.id, ids]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }

      await logAudit({
        entityType: 'internal_ticket_queue', entityId: body.id, action: 'update', actorId: actor.id, actorName: actor.name,
        changes: { statuses: [before.length ? before : 'todos', ids.length ? ids.map(id => (byId.get(id) as any).label) : 'todos'] }
      } as any);
      return NextResponse.json({ success: true, statusIds: ids });
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
