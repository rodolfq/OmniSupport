import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { query } from '@/lib/db';
import { logAudit } from '@/lib/audit-log';
import { getCurrentActionUser } from '@/lib/server-auth';
import { assertCanManageHotfixes, permissionErrorStatus } from '@/lib/server-permissions';

/**
 * Hotfixes / janela de release. Substitui getHotfixes / saveHotfix /
 * deleteHotfix / markHotfixPublished.
 *
 * ATENÇÃO ao mexer nas datas: node-pg devolve DATE/TIMESTAMP como objeto Date.
 * A normalização abaixo existe para o cliente SEMPRE receber string — sem ela o
 * formato dependeria de como a serialização trata Date, e a tela quebra ao
 * tentar formatar o que achava ser texto.
 */

function toIsoDateOnly(value: any): string {
  if (!value) return '';
  return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
}

function toIsoOrUndefined(value: any): string | undefined {
  if (!value) return undefined;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export async function GET() {
  try {
    const actor = await getCurrentActionUser();
    if (!actor) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });

    const res = await query('SELECT * FROM public.hotfixes ORDER BY expected_date DESC');
    return NextResponse.json(res.rows.map(h => ({
      id: h.id,
      name: h.name,
      description: h.description,
      responsibleId: h.responsible_id,
      productId: h.product_id,
      expectedDate: toIsoDateOnly(h.expected_date),
      publishedAt: toIsoOrUndefined(h.published_at),
      createdAt: toIsoOrUndefined(h.created_at)
    })));
  } catch (err) {
    console.error('Error getting hotfixes:', err);
    return NextResponse.json({ error: 'Erro ao carregar hotfixes.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const check = await assertCanManageHotfixes();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
    const { actor } = check;

    const body = await request.json();

    // Marcar como publicado
    if (body.action === 'publish') {
      const { id } = body;
      if (!id) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });

      const existing = await query('SELECT name FROM public.hotfixes WHERE id = $1', [id]);
      await query('UPDATE public.hotfixes SET published_at = now(), updated_at = now() WHERE id = $1', [id]);
      logAudit({
        actorId: actor.id, actorName: actor.name, action: 'publish',
        entityType: 'hotfix', entityId: id, entityLabel: existing.rows[0]?.name || null
      });
      return NextResponse.json({ success: true });
    }

    // Criar ou atualizar
    const { id, name, description, responsibleId, expectedDate, productId = null } = body;
    if (!name?.trim()) return NextResponse.json({ error: 'O nome do hotfix é obrigatório.' }, { status: 400 });

    if (id) {
      await query(
        `UPDATE public.hotfixes
            SET name = $1, description = $2, responsible_id = $3, expected_date = $4,
                product_id = $5, updated_at = now()
          WHERE id = $6`,
        [name, description, responsibleId, expectedDate, productId, id]
      );
      logAudit({ actorId: actor.id, actorName: actor.name, action: 'update', entityType: 'hotfix', entityId: id, entityLabel: name });
      return NextResponse.json({ id });
    }

    const newId = crypto.randomUUID();
    await query(
      `INSERT INTO public.hotfixes (id, name, description, responsible_id, expected_date, product_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [newId, name, description, responsibleId, expectedDate, productId, actor.id]
    );
    logAudit({ actorId: actor.id, actorName: actor.name, action: 'create', entityType: 'hotfix', entityId: newId, entityLabel: name });
    return NextResponse.json({ id: newId });
  } catch (err) {
    console.error('Error saving hotfix:', err);
    return NextResponse.json({ error: 'Erro ao salvar hotfix.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const check = await assertCanManageHotfixes();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
    const { actor } = check;

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });

    const existing = await query('SELECT name FROM public.hotfixes WHERE id = $1', [id]);
    await query('DELETE FROM public.hotfixes WHERE id = $1', [id]);
    logAudit({
      actorId: actor.id, actorName: actor.name, action: 'delete',
      entityType: 'hotfix', entityId: id, entityLabel: existing.rows[0]?.name || null
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error deleting hotfix:', err);
    return NextResponse.json({ error: 'Erro ao excluir hotfix.' }, { status: 500 });
  }
}
