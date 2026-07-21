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
    if (!res.ok) throw new Error('Error saving user via API');
  }

  static async delete(id: string): Promise<void> {
    const res = await fetch(`/api/users?id=${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error deleting user via API');
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
