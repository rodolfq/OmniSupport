import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { logAudit } from '@/lib/audit-log';
import {
  getCurrentActionUser,
  getAdminTeamIds,
  getActorEffectivePermissions,
  assertProfileEditable
} from '@/lib/server-auth';

/**
 * Perfis de Acesso (tabela role_permissions).
 *
 * Primeira leva da separação front/back: substitui as Server Actions
 * getRolePermissions / saveRolePermissionsById / renameAccessProfile /
 * createAccessProfile / deleteRolePermission.
 *
 * Server Action executa no servidor que ENTREGA A PÁGINA. Com o front virando
 * imagem própria, elas rodariam no container do front, que precisaria de
 * DATABASE_URL — anulando a separação. Por isso viram rotas HTTP: o front passa
 * a ser só interface, e o acesso ao banco fica de um lado só.
 *
 * As regras de autorização são as MESMAS de antes, importadas de
 * lib/server-auth.ts em vez de copiadas — cópia é o caminho curto para as duas
 * versões divergirem sem ninguém notar.
 */

export async function GET() {
  try {
    const actor = await getCurrentActionUser();
    if (!actor) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });

    const res = await query(
      `SELECT id, name, role, permissions, internal_team_id, is_system
         FROM public.role_permissions
        ORDER BY is_system DESC, name ASC`
    );
    return NextResponse.json(res.rows.map(r => ({
      id: r.id,
      name: r.name,
      role: r.role,
      permissions: r.permissions || [],
      internalTeamId: r.internal_team_id,
      isSystem: r.is_system
    })));
  } catch (err) {
    console.error('Error getting role permissions:', err);
    return NextResponse.json({ error: 'Erro ao carregar perfis de acesso.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getCurrentActionUser();
    if (!actor) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });

    const body = await request.json();
    const { action } = body;

    // ----------------------------------------------------------------- criar
    if (action === 'create') {
      const name = (body.name || '').trim();
      if (!name) return NextResponse.json({ error: 'O nome não pode ficar vazio.' }, { status: 400 });

      // Administrador do sistema cria global (sem equipe) ou escopado a
      // qualquer equipe; quem não é Administrador só cria dentro de uma equipe
      // que administra, e nunca um perfil global.
      const teamId = body.internalTeamId || null;
      if (actor.role !== 'Administrador') {
        if (!teamId) {
          return NextResponse.json(
            { error: 'Você só pode criar perfis para uma equipe que administra.' },
            { status: 403 }
          );
        }
        const adminTeamIds = await getAdminTeamIds(actor.id);
        if (!adminTeamIds.includes(teamId)) {
          return NextResponse.json({ error: 'Você não administra essa equipe.' }, { status: 403 });
        }
      }

      const res = await query(
        `INSERT INTO public.role_permissions (name, role, permissions, internal_team_id, is_system)
         VALUES ($1, $1, '{}', $2, false)
         RETURNING id`,
        [name, teamId]
      );
      logAudit({
        actorId: actor.id, actorName: actor.name, action: 'create',
        entityType: 'access_profile', entityId: res.rows[0].id, entityLabel: name
      });
      return NextResponse.json({ id: res.rows[0].id });
    }

    // -------------------------------------------------------------- renomear
    if (action === 'rename') {
      const { profileId } = body;
      const name = (body.name || '').trim();
      if (!profileId || !name) {
        return NextResponse.json({ error: 'Perfil e nome são obrigatórios.' }, { status: 400 });
      }

      const check = await assertProfileEditable(actor, profileId);
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 403 });

      await query('UPDATE public.role_permissions SET name = $1 WHERE id = $2', [name, profileId]);
      logAudit({
        actorId: actor.id, actorName: actor.name, action: 'update',
        entityType: 'access_profile', entityId: profileId, entityLabel: name, changes: { name }
      });
      return NextResponse.json({ success: true });
    }

    // ------------------------------------------------- salvar as permissões
    if (action === 'save-permissions') {
      const { profileId, permissions } = body;
      if (!profileId || !Array.isArray(permissions)) {
        return NextResponse.json({ error: 'Perfil e permissões são obrigatórios.' }, { status: 400 });
      }

      const check = await assertProfileEditable(actor, profileId);
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 403 });

      // Barreira de verdade (a tela já esconde, mas quem chamar a rota direto
      // não pode conceder o que não tem): só o que está sendo ADICIONADO
      // precisa estar no conjunto do próprio ator. Permissões que o perfil já
      // tinha — concedidas por um Administrador, por exemplo — continuam
      // podendo ser removidas ou mantidas, mesmo fora do alcance dele.
      if (actor.role !== 'Administrador') {
        const [myPermissions, existingRes] = await Promise.all([
          getActorEffectivePermissions(actor.id),
          query('SELECT permissions FROM public.role_permissions WHERE id = $1', [profileId])
        ]);
        const oldPermissions: string[] = existingRes.rows[0]?.permissions || [];
        const added = permissions.filter((p: string) => !oldPermissions.includes(p));
        const notAllowed = added.filter((p: string) => !myPermissions.includes(p));
        if (notAllowed.length > 0) {
          return NextResponse.json(
            { error: 'Você só pode conceder permissões que você mesmo tem.' },
            { status: 403 }
          );
        }
      }

      const profileRes = await query('SELECT name FROM public.role_permissions WHERE id = $1', [profileId]);
      await query('UPDATE public.role_permissions SET permissions = $1 WHERE id = $2', [permissions, profileId]);
      logAudit({
        actorId: actor.id, actorName: actor.name, action: 'update',
        entityType: 'access_profile', entityId: profileId,
        entityLabel: profileRes.rows[0]?.name || null, changes: { permissions }
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Action não suportada.' }, { status: 400 });
  } catch (err: any) {
    if (err?.code === '23505') {
      return NextResponse.json({ error: 'Já existe um perfil com esse nome.' }, { status: 409 });
    }
    console.error('Error in permissions POST:', err);
    return NextResponse.json({ error: 'Erro ao salvar o perfil de acesso.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await getCurrentActionUser();
    if (!actor) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });

    const profileId = new URL(request.url).searchParams.get('id');
    if (!profileId) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });

    const check = await assertProfileEditable(actor, profileId);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 403 });

    const profileRes = await query('SELECT name FROM public.role_permissions WHERE id = $1', [profileId]);
    // Quem estava neste perfil fica SEM Perfil de Acesso (portanto sem
    // permissão) em vez de a exclusão falhar por causa da chave estrangeira.
    await query('UPDATE public.profiles SET access_profile_id = NULL WHERE access_profile_id = $1', [profileId]);
    await query('DELETE FROM public.role_permissions WHERE id = $1', [profileId]);
    logAudit({
      actorId: actor.id, actorName: actor.name, action: 'delete',
      entityType: 'access_profile', entityId: profileId,
      entityLabel: profileRes.rows[0]?.name || null
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error deleting role permission:', err);
    return NextResponse.json({ error: 'Erro ao excluir o perfil de acesso.' }, { status: 500 });
  }
}
