'use server';

import { createClient } from '@/lib/supabase/server';

export async function createUser(email: string, name: string, role: string, companyId: string | null, phones: string[], viewAllCompanyTickets: boolean) {
  console.log('Iniciando createUser:', { email, name, role, companyId });
  const supabase = await createClient();
  
  // Sanitize companyId
  const sanitizedCompanyId = (companyId === 'platform-company-id' || companyId === 'company-id' || !companyId) ? null : companyId;
  
  try {
    const password = Math.random().toString(36).slice(-8); // Generate random password
    
    // Call the RPC to create the auth user
    const { data: result, error: rpcError } = await supabase.rpc('create_user_account', {
      p_email: email,
      p_password: password,
      p_name: name,
      p_role: role
    });
    
    if (rpcError) {
        return { error: rpcError.message };
    }
    
    if (result?.error) {
        return { error: result.error };
    }
    
    const userId = result.id;
    
    // Update the profile with extra fields
    await supabase.from('profiles').update({
      company_id: sanitizedCompanyId,
      phone: phones[0] || '',
      view_all_company_tickets: viewAllCompanyTickets
    }).eq('id', userId);
    
    return { id: userId };
  } catch (err) {
    console.error("Erro inesperado ao criar usuário:", err);
    return { error: 'Erro inesperado ao criar usuário no servidor.' };
  }
}

export async function saveCompany(id: string | null, name: string, industry: string, phone: string) {
  const supabase = await createClient();
  try {
    // Check for duplicate name
    let query = supabase.from('companies').select('id').ilike('name', name);
    if (id) {
       query = query.neq('id', id);
    }
    
    const { data: checkResult } = await query;
    
    if (checkResult && checkResult.length > 0) {
        return { error: 'Empresa com este nome já existe.' };
    }
    
    const payload = { name, industry, phone };
    
    if (id) {
       const { error } = await supabase.from('companies').update(payload).eq('id', id);
       if (error) throw error;
       return { id };
    } else {
       const { data, error } = await supabase.from('companies').insert([payload]).select('id').single();
       if (error) throw error;
       return { id: data.id };
    }
  } catch (err: any) {
    console.error("Erro ao salvar empresa:", err);
    return { error: err.message || 'Erro ao salvar empresa no servidor.' };
  }
}

export async function deleteCompany(id: string) {
  const supabase = await createClient();
  try {
    const { error } = await supabase.from('companies').delete().eq('id', id);
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error("Erro ao excluir empresa:", err);
    return { error: 'Erro ao excluir empresa no servidor.' };
  }
}

export async function getCompanies() {
  const supabase = await createClient();
  try {
    console.log('🔄 Server Action: getCompanies iniciado');
    const { data: rows, error } = await supabase.from('companies').select('id, name, industry, phone').order('name', { ascending: true });
    
    if (error) throw error;

    console.log(`📊 getCompanies: ${rows?.length || 0} empresas encontradas`);
    return (rows || []).map(row => ({
      id: row.id,
      name: row.name,
      industry: row.industry || '',
      phone: row.phone || ''
    }));
  } catch (err) {
    console.error("❌ Erro ao buscar empresas (actions.ts):", err);
    return [];
  }
}

export async function getUsers() {
  const supabase = await createClient();
  try {
    console.log('🔄 Server Action: getUsers iniciado');
    const { data: rows, error } = await supabase.from('profiles').select('id, name, email, role, company_id, phone, view_all_company_tickets, must_change_password');
    
    if (error) throw error;

    console.log(`📊 getUsers: ${rows?.length || 0} usuários encontrados`);
    return (rows || []).map(row => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      companyId: row.company_id,
      phone: row.phone,
      viewAllCompanyTickets: !!row.view_all_company_tickets,
      mustChangePassword: !!row.must_change_password
    }));
  } catch (err) {
    console.error("❌ Erro ao buscar usuários (actions.ts):", err);
    return [];
  }
}

export async function deleteUser(id: string) {
  const supabase = await createClient();
  try {
    await supabase.from('profiles').delete().eq('id', id);
  } catch (err) {
    console.error("Erro ao excluir usuário:", err);
  }
}

export async function updateUser(id: string, name: string, email: string, role: string, companyId?: string | null, viewAllCompanyTickets?: boolean) {
  const supabase = await createClient();
  const sanitizedCompanyId = (companyId === 'platform-company-id' || companyId === 'company-id' || !companyId) ? null : companyId;

  try {
    const { error } = await supabase.from('profiles').update({
      name,
      email,
      role,
      company_id: sanitizedCompanyId,
      view_all_company_tickets: viewAllCompanyTickets ?? false
    }).eq('id', id);
    
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error("Erro ao atualizar usuário:", err);
    return { error: 'Erro ao atualizar usuário no servidor.' };
  }
}
