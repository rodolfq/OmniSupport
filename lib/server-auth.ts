import { cookies } from 'next/headers';
import { query } from './db';
import { verifyJWT } from './jwt';

/**
 * Autorização do lado servidor, compartilhada por rotas de API e Server Actions.
 *
 * Estas funções moravam em `app/actions.ts`. Foram extraídas por causa da
 * separação front/back: as Server Actions estão sendo convertidas em rotas
 * HTTP, e enquanto a conversão acontece os DOIS caminhos precisam aplicar
 * exatamente as mesmas regras. Duplicar a lógica seria o jeito mais rápido de
 * fazer as duas divergirem — e divergência em código de autorização não
 * aparece em teste funcional, aparece em incidente.
 *
 * IMPORTANTE — por que não ficou em `app/actions.ts`: naquele arquivo vale
 * `'use server'`, e ali TODA função exportada vira um endpoint que qualquer
 * navegador autenticado pode chamar diretamente. Ajudante de autorização
 * exposto como endpoint é superfície de ataque sem motivo. Aqui não há
 * `'use server'`: é módulo de servidor comum, importável por rota e por action,
 * e invisível para o cliente.
 */

/** Usuário da sessão atual, lido do cookie. `null` = sem sessão válida. */
export async function getCurrentActionUser() {
  const token = (await cookies()).get('token')?.value;
  if (!token) return null;

  const decoded = await verifyJWT(token);
  if (!decoded?.id) return null;

  // internal_team_ids vem junto porque é dado de AUTORIZAÇÃO: decide quais
  // tickets internos e quais equipes a pessoa enxerga (ver
  // app/api/internal-tickets/route.ts). Buscá-lo à parte em cada rota levaria
  // a alguma esquecer, e o modo de falhar é abrir demais, não de menos.
  const result = await query(
    'SELECT id, name, role, company_id, internal_team_ids FROM public.profiles WHERE id = $1',
    [decoded.id]
  );

  return result.rows[0] || null;
}

/**
 * Equipes que o ator administra (internal_teams.admin_ids contém o id dele) —
 * base de toda a autorização de "admin de setor": fora do Administrador do
 * sistema, ninguém mexe em usuário/perfil de acesso que não esteja em uma
 * dessas equipes.
 */
export async function getAdminTeamIds(actorId: string): Promise<string[]> {
  const res = await query('SELECT id FROM public.internal_teams WHERE $1 = ANY(admin_ids)', [actorId]);
  return res.rows.map(r => r.id);
}

/**
 * O que o próprio ator "tem" para fins de conceder permissão a outro perfil —
 * mesmas duas fontes usadas no login e em `/api/auth/me`: as permissões do
 * Perfil de Acesso dele e, se administra alguma equipe, o mesmo bônus
 * (team:read/settings:write) que já libera essa tela para ele. Um admin de
 * equipe nunca pode conceder a outro perfil algo que ele mesmo não tem — só o
 * Administrador do sistema está isento (quem chama confere o papel antes).
 */
export async function getActorEffectivePermissions(actorId: string): Promise<string[]> {
  const res = await query(
    `SELECT COALESCE(rp.permissions, '{}'::text[]) AS permissions
     FROM public.profiles p LEFT JOIN public.role_permissions rp ON rp.id = p.access_profile_id
     WHERE p.id = $1`,
    [actorId]
  );
  const permissions = new Set<string>(res.rows[0]?.permissions || []);
  const adminTeamIds = await getAdminTeamIds(actorId);
  if (adminTeamIds.length > 0) {
    permissions.add('team:read');
    permissions.add('settings:write');
  }
  return Array.from(permissions);
}

/**
 * Um admin de equipe só pode agir sobre usuários que já pertencem a uma equipe
 * que ele administra — e nunca sobre um Administrador do sistema. Cliente
 * (dono da empresa-cliente) só age sobre Funcionário da própria empresa.
 */
export async function assertUserManageable(
  actor: { id: string; role: string; company_id?: string | null },
  targetId: string
): Promise<{ ok: true; target: any } | { ok: false; error: string }> {
  const res = await query(
    'SELECT id, role, company_id, internal_team_ids, is_admin, access_profile_id FROM public.profiles WHERE id = $1',
    [targetId]
  );
  const target = res.rows[0];
  if (!target) return { ok: false, error: 'Usuário não encontrado.' };
  if (actor.role === 'Administrador') return { ok: true, target };

  if (actor.role === 'Cliente') {
    if (target.company_id !== actor.company_id || target.role !== 'Funcionário') {
      return { ok: false, error: 'Você só pode gerenciar funcionários da sua própria empresa.' };
    }
    return { ok: true, target };
  }

  if (target.role === 'Administrador') {
    return { ok: false, error: 'Você não tem permissão para gerenciar este usuário.' };
  }
  const adminTeamIds = await getAdminTeamIds(actor.id);
  const targetTeamIds: string[] = target.internal_team_ids || [];
  if (adminTeamIds.length === 0 || !targetTeamIds.some(t => adminTeamIds.includes(t))) {
    return { ok: false, error: 'Você não tem permissão para gerenciar este usuário.' };
  }
  return { ok: true, target };
}

/**
 * Um perfil de acesso só pode ser editado/renomeado/excluído pelo Administrador
 * do sistema ou por um admin da equipe à qual o perfil está escopado. Perfis de
 * sistema (is_system) e perfis globais (sem equipe) nunca são editáveis por
 * admin de equipe.
 */
export async function assertProfileEditable(
  actor: { id: string; role: string },
  profileId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (actor.role === 'Administrador') return { ok: true };

  const res = await query('SELECT internal_team_id, is_system FROM public.role_permissions WHERE id = $1', [profileId]);
  const profile = res.rows[0];
  if (!profile || profile.is_system || !profile.internal_team_id) {
    return { ok: false, error: 'Você não tem permissão para editar este perfil.' };
  }

  const adminTeamIds = await getAdminTeamIds(actor.id);
  if (!adminTeamIds.includes(profile.internal_team_id)) {
    return { ok: false, error: 'Você não administra essa equipe.' };
  }
  return { ok: true };
}
