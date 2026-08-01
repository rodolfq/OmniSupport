import { User, UserRole } from "../types";

export class UserService {
  static async getCurrentProfile(): Promise<User | null> {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) return null;
      const data = await res.json();
      return data.user;
    } catch (err) {
      console.error("UserService: error getting profile:", err);
      return null;
    }
  }

  static async getAllUsers(): Promise<User[]> {
    const res = await fetch('/api/users?type=all');
    return res.json();
  }

  static async getEmployees(): Promise<User[]> {
    const res = await fetch('/api/users?type=employees');
    return res.json();
  }

  static async getAnalysts(): Promise<User[]> {
    const res = await fetch('/api/users?type=analysts');
    return res.json();
  }

  // Busca paginada de analistas (com foto), usada pelo seletor de membros
  // de Fila — só a página pedida baixa avatar_url, ao contrário de
  // getAnalysts() que traz todo mundo de uma vez.
  static async searchAnalysts(q: string, page: number, pageSize: number): Promise<{ items: User[]; total: number }> {
    const params = new URLSearchParams({ type: 'analysts-search', q, page: String(page), pageSize: String(pageSize) });
    const res = await fetch(`/api/users?${params.toString()}`);
    if (!res.ok) return { items: [], total: 0 };
    return res.json();
  }

  // Busca por id específicos (com foto) — usada para hidratar membros já
  // selecionados que não estejam na página atual da busca.
  static async getAnalystsByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return [];
    const params = new URLSearchParams({ type: 'analysts-search', ids: ids.join(',') });
    const res = await fetch(`/api/users?${params.toString()}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || [];
  }

  static async updateProfile(
    userId: string,
    updates: Partial<User>,
  ): Promise<void> {
    await UserService.save({ id: userId, ...updates });
  }

  static async createEmployee(data: {
    email: string;
    name: string;
    companyId: string;
    phones?: string[];
  }): Promise<User> {
    const res = await createUser(data.email, data.name, UserRole.EMPLOYEE, data.companyId, data.phones || [], false);
    if (res.error) throw new Error(res.error);
    return {
      id: res.id!,
      name: data.name,
      email: data.email,
      role: UserRole.EMPLOYEE,
      companyId: data.companyId,
      phone: data.phones?.[0],
    };
  }

  static async save(user: Partial<User>): Promise<void> {
    if (!user.id) return;

    const res = await fetch('/api/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || (res.status === 401 ? 'Sua sessão expirou — faça login novamente.' : 'Erro ao salvar usuário.'));
    }
  }

  static async delete(id: string): Promise<void> {
    const res = await fetch(`/api/users?id=${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || (res.status === 401 ? 'Sua sessão expirou — faça login novamente.' : 'Erro ao excluir usuário.'));
    }
  }
}

export async function createUser(
  email: string,
  name: string,
  role: string,
  companyId: string | null,
  phones: string[],
  viewAllCompanyTickets: boolean,
) {
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create', email, name, role, companyId, phones, viewAllCompanyTickets })
  });
  if (!res.ok) {
    const errorData = await res.json();
    return { error: errorData.error };
  }
  const data = await res.json();
  return { id: data.id, error: null };
}
