import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { logAudit } from '@/lib/audit-log';
import { assertCanViewGiro, assertCanManageGiro, permissionErrorStatus } from '@/lib/server-permissions';
import * as giro from '@/lib/services/giro-service';

/**
 * Configuração do Giro: quem participa e os itens do checklist.
 *
 * Leitura exige só giro:view — a tela de operação precisa dos itens do
 * checklist para desenhar as caixinhas, e do cadastro para mostrar quem está
 * ausente. Toda escrita exige giro:manage.
 */

export async function GET() {
  try {
    const check = await assertCanViewGiro();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });

    const [participants, checklistItems, candidates] = await Promise.all([
      giro.listParticipants(),
      giro.listChecklistItems(true),
      // Candidatos a entrar no Giro: gente do time, ativa. Cliente e
      // Funcionário nunca entram — o rodízio é de quem atende, não de quem é
      // atendido. `avatar_url` NUNCA cru numa lista (foto inteira em base64,
      // até ~2,7MB cada) — só a miniatura direto, e a foto cheia como link
      // sob demanda (/api/users/[id]/avatar), mesmo padrão do resto do
      // sistema (ver app/api/users/route.ts).
      query(
        `SELECT id, name, avatar_thumb_url, role,
                (avatar_url IS NOT NULL AND avatar_url <> '') AS has_avatar
           FROM public.profiles
          WHERE role IN ('Administrador', 'Equipe', 'Time Interno')
            AND is_active = true
          ORDER BY name ASC`
      )
    ]);

    return NextResponse.json({
      participants,
      checklistItems,
      candidates: candidates.rows.map(r => ({
        id: r.id,
        name: r.name,
        role: r.role,
        avatarUrl: r.has_avatar ? `/api/users/${r.id}/avatar` : null,
        avatarThumbUrl: r.avatar_thumb_url
      }))
    });
  } catch (err) {
    console.error('Error loading giro config:', err);
    return NextResponse.json({ error: 'Erro ao carregar a configuração do Giro.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const check = await assertCanManageGiro();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
    const { actor } = check;

    const body = await request.json();
    const action = body?.action as string;

    if (action === 'save-participant') {
      const result = await giro.saveParticipant(body);
      if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
      logAudit({ actorId: actor.id, actorName: actor.name, action: 'update', entityType: 'giro_participant', entityId: body.userId, entityLabel: 'Participante do Giro' });
      return NextResponse.json({ success: true, reinserted: !!result.reinserted });
    }

    if (action === 'reorder-participants') {
      if (!Array.isArray(body.orderedUserIds)) return NextResponse.json({ error: 'orderedUserIds é obrigatório.' }, { status: 400 });
      await giro.reorderParticipants(body.orderedUserIds);
      return NextResponse.json({ success: true });
    }

    if (action === 'delete-participant') {
      if (!body.userId) return NextResponse.json({ error: 'userId é obrigatório.' }, { status: 400 });
      await giro.deleteParticipant(body.userId);
      logAudit({ actorId: actor.id, actorName: actor.name, action: 'delete', entityType: 'giro_participant', entityId: body.userId, entityLabel: 'Participante do Giro' });
      return NextResponse.json({ success: true });
    }

    if (action === 'save-checklist-item') {
      const result = await giro.saveChecklistItem(body);
      if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ success: true, id: result.id });
    }

    if (action === 'delete-checklist-item') {
      if (!body.id) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });
      await giro.deleteChecklistItem(body.id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  } catch (err: any) {
    console.error('Error saving giro config:', err);
    return NextResponse.json({ error: err?.message || 'Erro ao salvar a configuração.' }, { status: 500 });
  }
}
