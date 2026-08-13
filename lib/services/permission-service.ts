import { apiJson, apiFetch } from '../api-client';

/**
 * Perfis de Acesso, do lado do cliente.
 *
 * Substitui as Server Actions do domínio (getRolePermissions,
 * saveRolePermissionsById, renameAccessProfile, createAccessProfile,
 * deleteRolePermission) por chamadas HTTP à rota /api/permissions.
 *
 * Passa por apiJson/apiFetch (lib/api-client.ts) e não por `fetch` direto: é o
 * que faz a chamada apontar para o back quando NEXT_PUBLIC_API_URL estiver
 * definida e levar o cookie de sessão entre origens diferentes.
 *
 * O formato de retorno foi mantido igual ao das actions — `{ error }` em vez de
 * exceção nas mutações — para que os componentes não precisassem mudar a forma
 * de tratar erro no mesmo passo em que mudam de transporte. Uma coisa de cada
 * vez: se algo quebrar, fica claro se foi o transporte ou a tela.
 */

export interface RolePermissionProfile {
  id: string;
  name: string;
  role: string;
  permissions: string[];
  internalTeamId: string | null;
  isSystem: boolean;
}

/**
 * Mesmo formato que as Server Actions devolviam: campos opcionais em vez de
 * união discriminada. As telas checam `result.error` direto, sem estreitar
 * tipo — trocar o formato aqui obrigaria a mexer na lógica das telas no mesmo
 * passo em que se troca o transporte, e aí um erro deixa de ser atribuível a
 * uma causa só.
 */
interface MutationResult {
  success?: true;
  error?: string;
  id?: string;
}

async function post(body: Record<string, unknown>): Promise<any> {
  try {
    return await apiJson('/api/permissions', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  } catch (err: any) {
    return { error: err?.message || 'Erro ao salvar o perfil de acesso.' };
  }
}

export async function getRolePermissions(): Promise<RolePermissionProfile[]> {
  try {
    return await apiJson<RolePermissionProfile[]>('/api/permissions');
  } catch (err) {
    console.error('Erro ao carregar perfis de acesso:', err);
    // Lista vazia em vez de exceção: mesma tolerância da action anterior — a
    // tela de Perfis de Acesso ainda abre, só sem itens.
    return [];
  }
}

export async function createAccessProfile(
  name: string,
  internalTeamId?: string | null
): Promise<MutationResult> {
  return post({ action: 'create', name, internalTeamId: internalTeamId || null });
}

export async function renameAccessProfile(profileId: string, name: string): Promise<MutationResult> {
  return post({ action: 'rename', profileId, name });
}

export async function saveRolePermissionsById(
  profileId: string,
  permissions: string[]
): Promise<MutationResult> {
  return post({ action: 'save-permissions', profileId, permissions });
}

export async function deleteRolePermission(profileId: string): Promise<MutationResult> {
  try {
    const res = await apiFetch(`/api/permissions?id=${encodeURIComponent(profileId)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return { error: data?.error || 'Erro ao excluir o perfil de acesso.' };
    }
    return { success: true };
  } catch (err: any) {
    return { error: err?.message || 'Erro ao excluir o perfil de acesso.' };
  }
}
