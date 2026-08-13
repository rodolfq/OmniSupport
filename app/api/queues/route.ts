import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { query } from '@/lib/db';
import { logAudit } from '@/lib/audit-log';
import { getCurrentActionUser } from '@/lib/server-auth';
import { assertCanManageQueues, permissionErrorStatus } from '@/lib/server-permissions';

/**
 * Filas de atendimento. Substitui as Server Actions getQueues / saveQueue /
 * deleteQueue na separação front/back (ver app/api/permissions/route.ts para o
 * porquê da conversão).
 */

export async function GET() {
  try {
    const actor = await getCurrentActionUser();
    if (!actor) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });

    // Leitura é aberta a qualquer sessão: a lista de filas alimenta seletores
    // em várias telas (chamado, relatórios) e não contém segredo.
    const res = await query('SELECT * FROM public.queues');
    return NextResponse.json(res.rows.map(q => ({
      id: q.id,
      name: q.name,
      description: q.description,
      whatsappInstanceId: q.whatsapp_instance_id,
      memberIds: q.member_ids || [],
      includeInternalChats: q.include_internal_chats !== false,
      routingStrategy: q.routing_strategy || 'round_robin'
    })));
  } catch (err) {
    console.error('Error getting queues:', err);
    return NextResponse.json({ error: 'Erro ao carregar filas.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const check = await assertCanManageQueues();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
    const { actor } = check;

    const {
      id, name, description, whatsappInstanceId, memberIds,
      includeInternalChats = true, routingStrategy = 'round_robin'
    } = await request.json();

    if (!name?.trim()) return NextResponse.json({ error: 'O nome da fila é obrigatório.' }, { status: 400 });

    if (id) {
      // A tabela `queues` NÃO tem coluna updated_at (ver schema_postgres.sql) —
      // incluí-la aqui derrubava o UPDATE inteiro com "column does not exist".
      await query(
        `UPDATE public.queues
            SET name = $1, description = $2, whatsapp_instance_id = $3, member_ids = $4,
                include_internal_chats = $5, routing_strategy = $6
          WHERE id = $7`,
        [name, description, whatsappInstanceId, memberIds, includeInternalChats, routingStrategy, id]
      );
      logAudit({ actorId: actor.id, actorName: actor.name, action: 'update', entityType: 'queue', entityId: id, entityLabel: name });
      return NextResponse.json({ id });
    }

    const newId = crypto.randomUUID();
    await query(
      `INSERT INTO public.queues (id, name, description, whatsapp_instance_id, member_ids, include_internal_chats, routing_strategy)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [newId, name, description, whatsappInstanceId, memberIds, includeInternalChats, routingStrategy]
    );
    logAudit({ actorId: actor.id, actorName: actor.name, action: 'create', entityType: 'queue', entityId: newId, entityLabel: name });
    return NextResponse.json({ id: newId });
  } catch (err) {
    console.error('Error saving queue:', err);
    return NextResponse.json({ error: 'Erro ao salvar fila.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const check = await assertCanManageQueues();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
    const { actor } = check;

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });

    const existing = await query('SELECT name FROM public.queues WHERE id = $1', [id]);
    await query('DELETE FROM public.queues WHERE id = $1', [id]);
    logAudit({
      actorId: actor.id, actorName: actor.name, action: 'delete',
      entityType: 'queue', entityId: id, entityLabel: existing.rows[0]?.name || null
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error deleting queue:', err);
    return NextResponse.json({ error: 'Erro ao excluir fila.' }, { status: 500 });
  }
}
