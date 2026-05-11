'use server';

import postgres from 'postgres';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';
const sql = postgres(connectionString, { ssl: 'require' });

export async function createUser(email: string, name: string, role: string, companyId: string | null, phones: string[], viewAllCompanyTickets: boolean) {
  console.log('Iniciando createUser:', { email, name, role, companyId });
  
  // Sanitize companyId
  const sanitizedCompanyId = (companyId === 'platform-company-id' || companyId === 'company-id' || !companyId) ? null : companyId;
  
  try {
    const password = Math.random().toString(36).slice(-8); // Generate random password
    
    // Call the RPC to create the auth user
    const [result] = await sql`SELECT create_user_account(${email}, ${password}, ${name}, ${role}) as create_user_account`;
    
    if (result.create_user_account.error) {
        return { error: result.create_user_account.error };
    }
    
    const userId = result.create_user_account.id;
    
    // Update the profile with extra fields
    await sql`UPDATE profiles SET company_id = ${sanitizedCompanyId}, phone = ${phones[0] || ''}, view_all_company_tickets = ${viewAllCompanyTickets} WHERE id = ${userId}`;
    
    return { id: userId };
  } catch (err) {
    console.error("Erro inesperado ao criar usuário:", err);
    return { error: 'Erro inesperado ao criar usuário no servidor.' };
  }
}

export async function saveCompany(id: string | null, name: string, industry: string, phone: string) {
  try {
    // Check for duplicate name
    let checkResult;
    if (id) {
        checkResult = await sql`SELECT id FROM companies WHERE name ILIKE ${name} AND id <> ${id}`;
    } else {
        checkResult = await sql`SELECT id FROM companies WHERE name ILIKE ${name}`;
    }
    
    if (checkResult.length > 0) {
        return { error: 'Empresa com este nome já existe.' };
    }
    
    if (id) {
       await sql`UPDATE companies SET name = ${name}, industry = ${industry}, phone = ${phone} WHERE id = ${id}`;
       return { id };
    } else {
      const [result] = await sql`INSERT INTO companies (name, industry, phone) VALUES (${name}, ${industry}, ${phone}) RETURNING id`;
      return { id: result.id };
    }
  } catch (err) {
    console.error("Erro ao salvar empresa:", err);
    return { error: 'Erro ao salvar empresa no servidor.' };
  }
}

export async function deleteCompany(id: string) {
  try {
    await sql`DELETE FROM companies WHERE id = ${id}`;
    return { success: true };
  } catch (err) {
    console.error("Erro ao excluir empresa:", err);
    return { error: 'Erro ao excluir empresa no servidor.' };
  }
}

export async function getCompanies() {
  try {
    const rows = await sql`SELECT id, name, industry, phone FROM companies ORDER BY name ASC`;
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      industry: row.industry || '',
      phone: row.phone || ''
    }));
  } catch (err) {
    console.error("Erro ao buscar empresas:", err);
    return [];
  }
}

export async function getUsers() {
  try {
    const rows = await sql`SELECT id, name, email, role, company_id, phone, view_all_company_tickets, must_change_password FROM profiles`;
    return rows.map(row => ({
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
    console.error("Erro ao buscar usuários:", err);
    return [];
  }
}

export async function deleteUser(id: string) {
  try {
    await sql`DELETE FROM profiles WHERE id = ${id}`;
  } catch (err) {
    console.error("Erro ao excluir usuário:", err);
  }
}

export async function updateUser(id: string, name: string, email: string, role: string, companyId?: string | null, viewAllCompanyTickets?: boolean) {
  const sanitizedCompanyId = (companyId === 'platform-company-id' || companyId === 'company-id' || !companyId) ? null : companyId;

  try {
    await sql`UPDATE profiles SET name = ${name}, email = ${email}, role = ${role}, company_id = ${sanitizedCompanyId}, view_all_company_tickets = ${viewAllCompanyTickets ?? false} WHERE id = ${id}`;
    return { success: true };
  } catch (err) {
    console.error("Erro ao atualizar usuário:", err);
    return { error: 'Erro ao atualizar usuário no servidor.' };
  }
}
