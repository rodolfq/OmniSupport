import { NextResponse } from 'next/server';
import { pool, query } from '@/lib/db';
import { logAudit } from '@/lib/audit-log';
import { getCurrentActionUser, getAdminTeamIds } from '@/lib/server-auth';
import { permissionErrorStatus } from '@/lib/server-permissions';

/**
 * Equipes internas (tela Perfis de Acesso). Substitui getInternalTeamsPageData
 * / createInternalTeam / updateInternalTeamMeta / deleteInternalTeam /
 * applyTeamMembership.
 *
 * ATENÇÃO ao mexer na autorização daqui: `internal_teams.admin_ids` é o que
 * decide quem pode criar usuário e editar Perfil de Acesso (ver
 * getAdminTeamIds em lib/server-auth.ts). Antes da correção original, estas
 * operações vinham do shim direto do navegador e NÃO tinham autorização no
 * servidor — a única barreira era a tela esconder o botão, e quem chamasse o
 * endpoint na mão podia se tornar administrador de qualquer equipe.
 *
 * Regra, preservada da versão em Server Action:
 *   criar / renomear / excluir equipe .... só Administrador do sistema
 *   membros e administradores ............ Administrador OU admin da equipe
 */

async function assertCanManageTeam(teamId?: string): Promise<
  { ok: true; actor: any } | { ok: false; error: string }
> {
  const actor = await getCurrentActionUser();
  if (!actor) return { ok: false, error: 'Sessão inválida.' };
  if (actor.role === 'Administrador') return { ok: true, actor };

  // Sem teamId a operação é sobre a equipe em si (criar/renomear/excluir):
  // exclusiva do Administrador do sistema.
  if (!teamId) return { ok: false, error: 'Apenas administradores podem gerenciar equipes.' };
  const adminTeamIds = await getAdminTeamIds(actor.id);
  if (!adminTeamIds.includes(teamId)) {
    return { ok: false, error: 'Você não administra esta equipe.' };
  }
  return { ok: true, actor };
}

/**
 * Leitura da tela: equipes + pessoas elegíveis a membro.
 * Traz avatar_thumb_url e NÃO avatar_url — a lista mostra avatar pequeno, e a
 * foto cheia custa MBs por pessoa (ver app/api/users/[id]/avatar/route.ts).
 */
export async function GET() {
  try {
    const actor = await getCurrentActionUser();
    if (!actor) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });

    const [teamsRes, usersRes] = await Promise.all([
      query('SELECT id, name, description, admin_ids FROM public.internal_teams ORDER BY name ASC'),
      query(
        `SELECT id, name, email, role, internal_team_ids, avatar_thumb_url, access_profile_id,
                view_all_company_tickets
           FROM public.profiles
          WHERE role IN ('Equipe', 'Time Interno')
          ORDER BY name ASC`
      )
    ]);

    const users = usersRes.rows.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      internalTeamIds: u.internal_team_ids || [],
      avatarThumbUrl: u.avatar_thumb_url,
      accessProfileId: u.access_profile_id,
      viewAllCompanyTickets: u.view_all_company_tickets
    }));

    const teams = teamsRes.rows.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      memberIds: users.filter(u => (u.internalTeamIds || []).includes(t.id)).map(u => u.id),
      adminIds: t.admin_ids || []
    }));

    return NextResponse.json({ teams, users });
  } catch (err) {
    console.error('Error loading internal teams page data:', err);
    return NextResponse.json({ error: 'Erro ao carregar equipes internas.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    // ---------------------------------------------------- composição da equipe
    if (action === 'membership') {
      const { teamId, changes } = body;
      if (!teamId) return NextResponse.json({ error: 'teamId é obrigatório.' }, { status: 400 });

      const check = await assertCanManageTeam(teamId);
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        for (const userId of changes?.remove || []) {
          await client.query(
            'UPDATE public.profiles SET internal_team_ids = array_remove(internal_team_ids, $2) WHERE id = $1',
            [userId, teamId]
          );
        }
        for (const userId of changes?.add || []) {
          // Só acrescenta se ainda não estiver lá, para não duplicar o id no array.
          await client.query(
            `UPDATE public.profiles
                SET internal_team_ids = array_append(COALESCE(internal_team_ids, '{}'), $2)
              WHERE id = $1 AND NOT ($2 = ANY(COALESCE(internal_team_ids, '{}')))`,
            [userId, teamId]
          );
        }

        // Administrador de equipe precisa continuar sendo membro — a tela já
        // filtra, mas a regra tem que valer também para quem chamar direto.
        const finalAdmins = (changes?.adminIds || []).filter((id: string) => !(changes?.remove || []).includes(id));
        await client.query('UPDATE public.internal_teams SET admin_ids = $2 WHERE id = $1', [teamId, finalAdmins]);

        await client.query('COMMIT');

        logAudit({
          actorId: check.actor.id, actorName: check.actor.name, action: 'update',
          entityType: 'internal_team', entityId: teamId, entityLabel: null,
          changes: {
            adicionados: changes?.add?.length || 0,
            removidos: changes?.remove?.length || 0,
            administradores: finalAdmins.length
          }
        });
        return NextResponse.json({ success: true });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error applying team membership:', err);
        return NextResponse.json({ error: 'Erro ao salvar a composição da equipe.' }, { status: 500 });
      } finally {
        client.release();
      }
    }

    // ------------------------------------------------- criar / renomear equipe
    const check = await assertCanManageTeam();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });

    const label = (body.name || '').trim();
    if (!label) return NextResponse.json({ error: 'O nome da equipe é obrigatório.' }, { status: 400 });
    const description = body.description?.trim() || null;

    if (body.id) {
      const res = await query(
        'UPDATE public.internal_teams SET name = $2, description = $3 WHERE id = $1 RETURNING id',
        [body.id, label, description]
      );
      if (res.rowCount === 0) return NextResponse.json({ error: 'Equipe não encontrada.' }, { status: 404 });
      logAudit({
        actorId: check.actor.id, actorName: check.actor.name, action: 'update',
        entityType: 'internal_team', entityId: body.id, entityLabel: label
      });
      return NextResponse.json({ success: true });
    }

    const res = await query(
      'INSERT INTO public.internal_teams (name, description) VALUES ($1, $2) RETURNING id',
      [label, description]
    );
    logAudit({
      actorId: check.actor.id, actorName: check.actor.name, action: 'create',
      entityType: 'internal_team', entityId: res.rows[0].id, entityLabel: label
    });
    return NextResponse.json({ id: res.rows[0].id });
  } catch (err: any) {
    if (err?.code === '23505') {
      return NextResponse.json({ error: 'Já existe uma equipe com esse nome.' }, { status: 409 });
    }
    console.error('Error in internal teams POST:', err);
    return NextResponse.json({ error: 'Erro ao salvar equipe.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const check = await assertCanManageTeam();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });

  const client = await pool.connect();
  try {
    const existing = await client.query('SELECT name FROM public.internal_teams WHERE id = $1', [id]);
    if (existing.rowCount === 0) return NextResponse.json({ error: 'Equipe não encontrada.' }, { status: 404 });

    // Tirar a equipe das pessoas e apagar a equipe precisam acontecer JUNTOS:
    // uma falha entre as duas etapas deixaria usuários apontando para uma
    // equipe que não existe mais.
    await client.query('BEGIN');
    await client.query(
      'UPDATE public.profiles SET internal_team_ids = array_remove(internal_team_ids, $1) WHERE $1 = ANY(internal_team_ids)',
      [id]
    );
    await client.query('DELETE FROM public.internal_teams WHERE id = $1', [id]);
    await client.query('COMMIT');

    logAudit({
      actorId: check.actor.id, actorName: check.actor.name, action: 'delete',
      entityType: 'internal_team', entityId: id, entityLabel: existing.rows[0].name
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error deleting internal team:', err);
    return NextResponse.json({ error: 'Erro ao remover equipe.' }, { status: 500 });
  } finally {
    client.release();
  }
}
