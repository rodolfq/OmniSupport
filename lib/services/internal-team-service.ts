import { apiJson, apiFetch } from '../api-client';
import type { MutationResult } from './queue-service';

/**
 * Equipes internas, do lado do cliente — substitui getInternalTeamsPageData /
 * createInternalTeam / updateInternalTeamMeta / deleteInternalTeam /
 * applyTeamMembership na separação front/back.
 */

export interface InternalTeamRecord {
  id: string;
  name: string;
  // `undefined` e não `string | null`: o tipo Team da tela usa opcional, e a
  // Server Action anterior devolvia o mesmo formato. Manter a assinatura
  // idêntica é o que permite trocar só o transporte, sem mexer na tela.
  description?: string;
  memberIds: string[];
  adminIds: string[];
}

export interface InternalTeamPageUser {
  id: string;
  name: string;
  email: string | null;
  role: string;
  internalTeamIds: string[];
  avatarThumbUrl?: string | null;
  accessProfileId?: string | null;
  viewAllCompanyTickets?: boolean;
}

export async function getInternalTeamsPageData(): Promise<{
  teams: InternalTeamRecord[];
  users: InternalTeamPageUser[];
}> {
  try {
    return await apiJson('/api/internal-teams');
  } catch (err) {
    console.error('Erro ao carregar equipes internas:', err);
    // Mesma tolerância da action anterior: a tela abre vazia em vez de quebrar.
    return { teams: [], users: [] };
  }
}

async function post(body: Record<string, unknown>, fallback: string): Promise<MutationResult> {
  try {
    return await apiJson('/api/internal-teams', { method: 'POST', body: JSON.stringify(body) });
  } catch (err: any) {
    return { error: err?.message || fallback };
  }
}

export async function createInternalTeam(name: string, description?: string | null): Promise<MutationResult> {
  return post({ name, description }, 'Erro ao criar equipe.');
}

export async function updateInternalTeamMeta(
  id: string,
  name: string,
  description?: string | null
): Promise<MutationResult> {
  return post({ id, name, description }, 'Erro ao salvar equipe.');
}

export async function applyTeamMembership(
  teamId: string,
  changes: { add: string[]; remove: string[]; adminIds: string[] }
): Promise<MutationResult> {
  return post({ action: 'membership', teamId, changes }, 'Erro ao salvar a composição da equipe.');
}

export async function deleteInternalTeam(id: string): Promise<MutationResult> {
  try {
    const res = await apiFetch(`/api/internal-teams?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return { error: data?.error || 'Erro ao remover equipe.' };
    }
    return { success: true };
  } catch (err: any) {
    return { error: err?.message || 'Erro ao remover equipe.' };
  }
}
