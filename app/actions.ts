'use server';

import { Client } from 'pg';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

export async function createUser(email: string, name: string, role: string, companyId: string, phones: string[], viewAllCompanyTickets: boolean) {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    // Call the RPC to create the auth user
    // The RPC creates the user in auth.users and triggers handle_new_user to populate profiles
    const password = Math.random().toString(36).slice(-8); // Generate random password
    
    const result = await client.query("SELECT create_user_account($1, $2, $3, $4)", [email, password, name, role]);
    
    if (result.rows[0].create_user_account.error) {
        return { error: result.rows[0].create_user_account.error };
    }
    
    const userId = result.rows[0].create_user_account.id;
    
    // Update the profile with extra fields
    await client.query(
        "UPDATE profiles SET company_id = $1, phone = $2, view_all_company_tickets = $3 WHERE id = $4",
        [companyId, phones[0] || '', viewAllCompanyTickets, userId]
    );

    return { id: userId };
  } catch (err) {
    console.error("Erro inesperado ao criar usuário:", err);
    return { error: 'Erro inesperado ao criar usuário.' };
  } finally {
    await client.end();
  }
}

export async function saveCompany(id: string | null, name: string, industry: string, phone: string) {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    
    // Check for duplicate name
    let checkQuery = "SELECT id FROM companies WHERE name ILIKE $1";
    const params: any[] = [name];
    if (id) {
        checkQuery += " AND id <> $2";
        params.push(id);
    }
    const checkResult = await client.query(checkQuery, params);
    
    if (checkResult.rows.length > 0) {
        return { error: 'Empresa com este nome já existe.' };
    }
    
    if (id) {
       await client.query(
        "UPDATE companies SET name = $1, industry = $2, phone = $3 WHERE id = $4",
        [name, industry, phone, id]
      );
      return { id };
    } else {
      const result = await client.query(
        "INSERT INTO companies (name, industry, phone) VALUES ($1, $2, $3) RETURNING id",
        [name, industry, phone]
      );
      return { id: result.rows[0].id };
    }
  } catch (err) {
    console.error("Erro ao salvar empresa:", err);
    return { error: 'Erro ao salvar empresa.' };
  } finally {
    await client.end();
  }
}

export async function deleteCompany(id: string) {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query("DELETE FROM companies WHERE id = $1", [id]);
    return { success: true };
  } catch (err) {
    console.error("Erro ao excluir empresa:", err);
    return { error: 'Erro ao excluir empresa.' };
  } finally {
    await client.end();
  }
}

export async function getCompanies() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const result = await client.query("SELECT * FROM companies");
    return result.rows;
  } finally {
    await client.end();
  }
}

export async function getUsers() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const result = await client.query("SELECT * FROM profiles");
    // Map snake_case to camelCase
    const users = result.rows.map(row => ({
      ...row,
      companyId: row.company_id,
      viewAllCompanyTickets: row.view_all_company_tickets,
    }));
    console.log("Usuários recuperados do banco:", users.length);
    return users;
  } finally {
    await client.end();
  }
}

export async function deleteUser(id: string) {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query("DELETE FROM profiles WHERE id = $1", [id]);
    // Also likely need to remove from auth.users, but the RPC might handle it if there's a trigger.
    // The current RPC-based setup might need to keep in sync.
    // For now, let's just delete from profiles.
  } finally {
    await client.end();
  }
}

export async function updateUser(id: string, name: string, email: string, role: string, companyId?: string) {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query(
      "UPDATE profiles SET name = $1, email = $2, role = $3, company_id = $4 WHERE id = $5",
      [name, email, role, companyId, id]
    );
  } finally {
    await client.end();
  }
}
