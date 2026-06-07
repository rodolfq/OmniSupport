import { supabase } from '../supabase';
import { User, UserRole, Permission } from '../types';

export class UserService {
  static async getCurrentProfile(): Promise<User | null> {
    if (!supabase) {
      console.warn('UserService: supabase client not available');
      return null;
    }
    
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      console.warn('UserService: no active session');
      return null;
    }

    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();

      if (error) {
        console.error('UserService: error fetching profile:', error);
        throw error;
      }
      if (!profile) {
        console.warn('UserService: profile not found for user id:', session.user.id);
        return null;
      }

      return {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        role: profile.role,
        companyId: profile.company_id,
        phone: profile.phone,
        viewAllCompanyTickets: profile.view_all_company_tickets,
        mustChangePassword: profile.must_change_password,
        isAdmin: profile.is_admin
      };
    } catch (e: any) {
      console.error('UserService: exception in getCurrentProfile:', e?.message || e);
      return null;
    }
  }

  static async getAllUsers(): Promise<User[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, email, role, company_id, phone, view_all_company_tickets, must_change_password, is_admin');

    if (error) throw error;
    return (data || []).map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      companyId: u.company_id,
      phone: u.phone,
      viewAllCompanyTickets: u.view_all_company_tickets,
      mustChangePassword: u.must_change_password,
      isAdmin: u.is_admin
    }));
  }

  static async getEmployees(): Promise<User[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, email, role, company_id, phone')
      .eq('role', UserRole.EMPLOYEE);

    if (error) throw error;
    return (data || []).map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      companyId: u.company_id,
      phone: u.phone
    }));
  }

  static async getAnalysts(): Promise<User[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, email, role, company_id, phone')
      .or(`role.eq.${UserRole.ADMIN},role.eq.${UserRole.SUPPORT}`);

    if (error) throw error;
    return (data || []).map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      companyId: u.company_id,
      phone: u.phone
    }));
  }

  static async updateProfile(userId: string, updates: Partial<User>): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update({
        name: updates.name,
        email: updates.email,
        role: updates.role,
        company_id: updates.companyId,
        phone: updates.phone,
        view_all_company_tickets: updates.viewAllCompanyTickets
      })
      .eq('id', userId);

    if (error) throw error;
  }

  static async createEmployee(data: { email: string; name: string; companyId: string; phones?: string[] }): Promise<User> {
    const { data: result, error } = await supabase.rpc('create_user_account', {
      p_email: data.email,
      p_password: Math.random().toString(36).slice(-8),
      p_name: data.name,
      p_role: UserRole.EMPLOYEE
    });

    if (error) throw error;
    return {
      id: result.id,
      name: result.name,
      email: result.email,
      role: result.role,
      companyId: data.companyId,
      phones: data.phones
    };
  }

  static getPermissionsByRole(roleName: string): Permission[] {
    const permissions: Record<string, Permission[]> = {
      [UserRole.ADMIN]: [
        Permission.TICKETS_READ, Permission.TICKETS_WRITE, Permission.TICKETS_DELETE, Permission.TICKETS_ASSIGN,
        Permission.CUSTOMERS_READ, Permission.CUSTOMERS_WRITE,
        Permission.TEAM_READ, Permission.TEAM_WRITE,
        Permission.SETTINGS_READ, Permission.SETTINGS_WRITE,
        Permission.REPORTS_READ, Permission.INTERNAL_TICKETS_VIEW,
        Permission.OUTSIDE_QUEUE_VIEW, Permission.DASHBOARD_VIEW, Permission.CHAT_INTERNAL_VIEW
      ],
      [UserRole.SUPPORT]: [
        Permission.DASHBOARD_VIEW, Permission.TICKETS_READ, Permission.TICKETS_WRITE,
        Permission.CUSTOMERS_READ, Permission.INTERNAL_TICKETS_VIEW, Permission.OUTSIDE_QUEUE_VIEW
      ],
      [UserRole.EMPLOYEE]: [
        Permission.DASHBOARD_VIEW, Permission.TICKETS_READ, Permission.TICKETS_WRITE
      ],
      [UserRole.CUSTOMER]: [
        Permission.DASHBOARD_VIEW, Permission.TICKETS_READ, Permission.TICKETS_WRITE
      ]
    };
    return permissions[roleName] || [];
  }
}

export async function createUser(email: string, name: string, role: string, companyId: string | null, phones: string[], viewAllCompanyTickets: boolean) {
  const password = Math.random().toString(36).slice(-8);
  
  const { data, error } = await supabase.rpc('create_user_account', {
    p_email: email,
    p_password: password,
    p_name: name,
    p_role: role
  });

  if (error) {
    return { error: error.message };
  }

  // Support both 'id' and 'user_id' field names from RPC
  const userId = data?.id || data?.user_id;
  if (userId) {
    await supabase.from('profiles').update({
      company_id: companyId,
      phone: phones[0] || null,
      view_all_company_tickets: viewAllCompanyTickets
    }).eq('id', userId);
  }

  return { id: userId, error: data?.error };
}