import { getCurrentActionUser, getActorEffectivePermissions } from './server-auth';

/**
 * Checagens de permissão por domínio, compartilhadas por rotas de API e pelas
 * Server Actions que ainda restam.
 *
 * Vieram de `app/actions.ts` (assertCanManageQueues, assertCanManageHotfixes,
 * assertCanManageWhatsapp, assertCanManageAssistant, assertCanManageTeam) na
 * separação front/back. Mesmo motivo de lib/server-auth.ts: enquanto rota e
 * action coexistem, as duas precisam aplicar a MESMA regra — e um arquivo sem
 * `'use server'` não expõe ajudante de autorização como endpoint público.
 */

export type PermissionCheck = { ok: true; actor: any } | { ok: false; error: string };

/**
 * Administrador do sistema passa sempre; os demais precisam da permissão
 * nomeada no Perfil de Acesso.
 */
async function assertPermission(permission: string, mensagemNegada: string): Promise<PermissionCheck> {
  const actor = await getCurrentActionUser();
  if (!actor) return { ok: false, error: 'Sessão inválida.' };
  if (actor.role === 'Administrador') return { ok: true, actor };

  const permissions = await getActorEffectivePermissions(actor.id);
  if (!permissions.includes(permission)) return { ok: false, error: mensagemNegada };
  return { ok: true, actor };
}

export function assertCanManageQueues(): Promise<PermissionCheck> {
  return assertPermission('queues:manage', 'Você não tem permissão para gerenciar filas.');
}

export function assertCanManageHotfixes(): Promise<PermissionCheck> {
  return assertPermission('hotfixes:manage', 'Você não tem permissão para gerenciar hotfixes.');
}

export function assertCanManageWhatsapp(): Promise<PermissionCheck> {
  return assertPermission('whatsapp:manage', 'Você não tem permissão para gerenciar WhatsApp.');
}

/**
 * Giro de Atendimento. `giro:manage` implica `giro:view` — quem gerencia o
 * rodízio obviamente pode olhá-lo, e exigir as duas marcadas juntas no Perfil
 * de Acesso seria uma pegadinha silenciosa (a tela abriria vazia para quem
 * marcou só "Gerenciar").
 */
export async function assertCanViewGiro(): Promise<PermissionCheck> {
  const actor = await getCurrentActionUser();
  if (!actor) return { ok: false, error: 'Sessão inválida.' };
  if (actor.role === 'Administrador') return { ok: true, actor };

  const permissions = await getActorEffectivePermissions(actor.id);
  if (!permissions.includes('giro:view') && !permissions.includes('giro:manage')) {
    return { ok: false, error: 'Você não tem permissão para ver o Giro de Atendimento.' };
  }
  return { ok: true, actor };
}

export function assertCanManageGiro(): Promise<PermissionCheck> {
  return assertPermission('giro:manage', 'Você não tem permissão para gerenciar o Giro de Atendimento.');
}

/** Converte a checagem no status HTTP correto: 401 sem sessão, 403 sem direito. */
export function permissionErrorStatus(error: string): number {
  return error === 'Sessão inválida.' ? 401 : 403;
}
