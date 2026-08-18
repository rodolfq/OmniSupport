import { apiJson, apiFetch } from '../api-client';
import type { MutationResult } from './queue-service';
import type { User } from '../types';

/**
 * Usuários e presença, do lado do cliente — substitui as Server Actions
 * getUsers / getAnalysts / getCustomers / createUser / updateUser / deleteUser
 * / updateUserStatus na separação front/back.
 *
 * Nome com sufixo `-actions-service` para não colidir com o
 * lib/services/user-service.ts que já existe (UserService, outra fatia da
 * mesma área). Juntar os dois num arquivo só entraria em conflito com o que
 * cada tela já importa — fica para uma limpeza posterior, quando a migração
 * inteira estiver estável.
 *
 * As assinaturas são IDÊNTICAS às das actions: as telas trocam só o import.
 */

async function post(body: Record<string, unknown>, fallback: string): Promise<MutationResult> {
  try {
    return await apiJson('/api/users', { method: 'POST', body: JSON.stringify(body) });
  } catch (err: any) {
    return { error: err?.message || fallback };
  }
}

/** Lista com escopo pelo ator: Cliente/Funcionário só veem a própria empresa. */
export async function getUsers(): Promise<User[]> {
  try {
    return await apiJson<User[]>('/api/users?type=scoped');
  } catch (err) {
    console.error('Erro ao carregar usuários:', err);
    return [];
  }
}

// Busca paginada da Gestão da Equipe — troca "baixa todo mundo e filtra no
// client" por página + busca já resolvidas no servidor (mesmo padrão de
// UserService.searchAnalysts, usado pelo seletor de membros de Fila).
export async function searchTeamMembers(q: string, page: number, pageSize: number): Promise<{ items: User[]; total: number }> {
  try {
    const params = new URLSearchParams({ type: 'team-search', q, page: String(page), pageSize: String(pageSize) });
    return await apiJson<{ items: User[]; total: number }>(`/api/users?${params.toString()}`);
  } catch (err) {
    console.error('Erro ao buscar equipe:', err);
    return { items: [], total: 0 };
  }
}

export async function getAnalysts(): Promise<User[]> {
  try {
    return await apiJson<User[]>('/api/users?type=analysts-basic');
  } catch (err) {
    console.error('Erro ao carregar analistas:', err);
    return [];
  }
}

export async function getCustomers(): Promise<User[]> {
  try {
    return await apiJson<User[]>('/api/users?type=customers');
  } catch (err) {
    console.error('Erro ao carregar clientes:', err);
    return [];
  }
}

export async function createUser(
  email: string,
  name: string,
  role: string,
  companyId: string | null,
  phones: string[],
  viewAllCompanyTickets: boolean,
  accessProfileId?: string,
  internalTeamIds?: string[]
): Promise<MutationResult> {
  return post(
    { action: 'create-full', email, name, role, companyId, phones, viewAllCompanyTickets, accessProfileId, internalTeamIds },
    'Não foi possível criar o cadastro. Tente novamente.'
  );
}

export async function updateUser(
  id: string,
  name: string,
  email: string,
  role: string,
  companyId?: string | null,
  viewAllCompanyTickets?: boolean,
  accessProfileId?: string | null,
  internalTeamIds?: string[]
): Promise<MutationResult> {
  return post(
    { action: 'update-profile', id, name, email, role, companyId, viewAllCompanyTickets, accessProfileId, internalTeamIds },
    'Erro ao atualizar usuário no servidor.'
  );
}

export async function updateUserStatus(
  userId: string,
  isOnline: boolean,
  reason?: string
): Promise<MutationResult> {
  return post({ action: 'presence', userId, isOnline, reason }, 'Erro ao atualizar status.');
}

export async function deleteUser(id: string): Promise<MutationResult> {
  try {
    const res = await apiFetch(`/api/users?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return { error: data?.error || 'Erro ao excluir usuário no servidor.' };
    }
    return { success: true };
  } catch (err: any) {
    return { error: err?.message || 'Erro ao excluir usuário no servidor.' };
  }
}
