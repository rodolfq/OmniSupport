'use server';

import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

// Criar cliente admin com service role key
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

export async function createUser(email: string, name: string, role: string, companyId: string | null, phones: string[], viewAllCompanyTickets: boolean) {
  console.log('Iniciando createUser:', { email, name, role, companyId });
  
  try {
    // Primeiro verifica se já existe um usuário com esse email
    const { data: existingUser, error: checkError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, name, role, company_id, phone, must_change_password')
      .eq('email', email)
      .single();

    if (existingUser) {
      // Usuário já existe - atualizar profile com os novos dados
      const { error: updateError } = await supabaseAdmin.from('profiles').update({
        name,
        role,
        company_id: companyId || existingUser.company_id || '11111111-1111-4111-8111-111111111111',
        phone: phones?.[0] || existingUser.phone,
        view_all_company_tickets: viewAllCompanyTickets ?? false,
      }).eq('id', existingUser.id);

      if (updateError) {
        console.error('Erro ao atualizar usuário existente:', updateError);
        return { error: updateError.message };
      }
      
      console.log('Usuário atualizado com sucesso:', { id: existingUser.id, email });
      return { id: existingUser.id, updated: true };
    }

    // Gerar UUID para novo usuário
    const { randomUUID } = await import('crypto');
    const userId = randomUUID();
    
    // Inserir profile - o trigger on_auth_user_created deve criar o auth.users automaticamente
    // Se o trigger não funcionar, tenta criar auth user primeiro
    const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
      id: userId,
      email,
      name,
      role,
      company_id: companyId || '11111111-1111-4111-8111-111111111111',
      phone: phones?.[0] || null,
      view_all_company_tickets: viewAllCompanyTickets ?? false,
      must_change_password: true,
      is_admin: role === 'Administrador',
      lives_in_squad: role === 'Equipe' || role === 'Administrador'
    });

    if (profileError) {
      console.error('Profile error:', profileError);
      
      // Se for erro de FK, tenta criar auth user via signup (ignora email confirmation)
      if (profileError.code === '23503' || profileError.message?.includes('violates foreign key')) {
        try {
          const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password: Math.random().toString(36).slice(-8),
            email_confirm: true,
            user_metadata: { name, role }
          });

          if (authError) {
            console.error('Auth signup error:', authError);
            return { error: authError.message };
          }

          // Agora tenta inserir o profile novamente
          const { error: retryError } = await supabaseAdmin.from('profiles').upsert({
            id: authData.user.id,
            email,
            name,
            role,
            company_id: companyId || '11111111-1111-4111-8111-111111111111',
            phone: phones?.[0] || null,
            view_all_company_tickets: viewAllCompanyTickets ?? false,
            must_change_password: true,
            is_admin: role === 'Administrador',
            lives_in_squad: role === 'Equipe' || role === 'Administrador'
          });

          if (retryError) {
            console.error('Retry profile error:', retryError);
            return { error: retryError.message };
          }

          console.log('Usuário criado com sucesso (via admin API):', { id: authData.user.id, email });
          return { id: authData.user.id };
        } catch (authErr: any) {
          console.error("Erro ao criar auth user:", authErr);
          return { error: authErr.message || 'Erro ao criar usuário no Supabase Auth.' };
        }
      }
      
      return { error: profileError.message };
    }

    console.log('Profile criado com sucesso:', { id: userId, email });
    return { id: userId };
  } catch (err: any) {
    console.error("Erro inesperado ao criar usuário:", err);
    return { error: err.message || 'Erro inesperado ao criar usuário no servidor.' };
  }
}

export async function saveCompany(id: string | null, name: string, industry: string, phone: string) {
  const supabase = await createServerClient();
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
    
    const payload: any = { name, phone };
    // Only include industry if needed (avoids schema cache errors)
    if (industry) payload.industry = industry;

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
  const supabase = await createServerClient();
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
  const supabase = await createServerClient();
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
  const supabase = await createServerClient();
  try {
    console.log('🔄 Server Action: getUsers iniciado');
    const { data: rows, error } = await supabase.from('profiles').select('id, name, email, role, company_id, phone, view_all_company_tickets, must_change_password');
    
    if (error) throw error;

    console.log(`📊 getUsers: ${rows?.length || 0} usuários encontrados`);
    return (rows || []).map(row => {
      // Normalizar role para bater com o enum UserRole
      // BD: 'Administrador', 'Equipe', 'Cliente', 'Funcionário'
      // Enum: ADMIN='Administrador', SUPPORT='Equipe', CUSTOMER='Cliente', EMPLOYEE='Funcionário'
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role, // Já é o valor correto do BD
        companyId: row.company_id,
        phone: row.phone,
        viewAllCompanyTickets: !!row.view_all_company_tickets,
        mustChangePassword: !!row.must_change_password
      };
    });
  } catch (err) {
    console.error("❌ Erro ao buscar usuários (actions.ts):", err);
    return [];
  }
}

export async function deleteUser(id: string) {
  const supabase = await createServerClient();
  try {
    // Deletar do auth.users também
    const { data: profile } = await supabase.from('profiles').select('email').eq('id', id).single();
    if (profile?.email) {
      await supabaseAdmin.auth.admin.deleteUser(id);
    }
    await supabase.from('profiles').delete().eq('id', id);
  } catch (err) {
    console.error("Erro ao excluir usuário:", err);
  }
}

export async function updateUser(id: string, name: string, email: string, role: string, companyId?: string | null, viewAllCompanyTickets?: boolean) {
  const supabase = await createServerClient();
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

// Função para retornar analistas (Equipe)
export async function getAnalysts() {
  const supabase = await createServerClient();
  try {
    const { data, error } = await supabase.from('profiles').select('id, name, email, role, company_id, phone').eq('role', 'Equipe');
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("Erro ao buscar analistas:", err);
    return [];
  }
}

// Função para retornar clientes
export async function getCustomers() {
  const supabase = await createServerClient();
  try {
    const { data, error } = await supabase.from('profiles').select('id, name, email, role, company_id, phone').eq('role', 'Cliente');
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("Erro ao buscar clientes:", err);
    return [];
  }
}

// Função para atualizar status do analista
export async function updateUserStatus(userId: string, isOnline: boolean, reason?: string) {
  const supabase = await createServerClient();
  try {
    const { error } = await supabase.from('analyst_status').upsert({
      user_id: userId,
      is_online: isOnline,
      last_active: new Date().toISOString(),
      current_reason: reason || null
    });
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error("Erro ao atualizar status:", err);
    return { error: 'Erro ao atualizar status.' };
  }
}

// Função para obter filas
export async function getQueues() {
  const supabase = await createServerClient();
  try {
    const { data, error } = await supabase.from('queues').select('*');
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("Erro ao buscar filas:", err);
    return [];
  }
}

// Função para salvar fila
export async function saveQueue(id: string | null, name: string, description: string | null, whatsappInstanceId: string | null, memberIds: string[]) {
  const supabase = await createServerClient();
  try {
    if (id) {
      const { error } = await supabase.from('queues').update({ name, description, whatsapp_instance_id: whatsappInstanceId, member_ids: memberIds }).eq('id', id);
      if (error) throw error;
      return { id };
    } else {
      const { data, error } = await supabase.from('queues').insert([{ name, description, whatsapp_instance_id: whatsappInstanceId, member_ids: memberIds }]).select('id').single();
      if (error) throw error;
      return { id: data.id };
    }
  } catch (err) {
    console.error("Erro ao salvar fila:", err);
    return { error: 'Erro ao salvar fila.' };
  }
}

// Função para excluir fila
export async function deleteQueue(id: string) {
  const supabase = await createServerClient();
  try {
    const { error } = await supabase.from('queues').delete().eq('id', id);
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error("Erro ao excluir fila:", err);
    return { error: 'Erro ao excluir fila.' };
  }
}

// Função para obter instâncias WhatsApp
export async function getWhatsappInstances() {
  const supabase = await createServerClient();
  try {
    const { data, error } = await supabase.from('whatsapp_instances').select('*');
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("Erro ao buscar instâncias:", err);
    return [];
  }
}

// Função para salvar instância WhatsApp
export async function saveWhatsappInstance(id: string | null, name: string, phone: string, status: string) {
  const supabase = await createServerClient();
  try {
    if (id) {
      const { error } = await supabase.from('whatsapp_instances').update({ name, phone, status }).eq('id', id);
      if (error) throw error;
      return { id };
    } else {
      const { data, error } = await supabase.from('whatsapp_instances').insert([{ name, phone, status }]).select('id').single();
      if (error) throw error;
      return { id: data.id };
    }
  } catch (err) {
    console.error("Erro ao salvar instância:", err);
    return { error: 'Erro ao salvar instância.' };
  }
}

// Função para obter quick notes
export async function getQuickNotes() {
  const supabase = await createServerClient();
  try {
    const { data, error } = await supabase.from('quick_notes').select('*');
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("Erro ao buscar quick notes:", err);
    return [];
  }
}

// Função para salvar quick note
export async function saveQuickNote(id: string | null, shortcut: string, content: string, category: string) {
  const supabase = await createServerClient();
  try {
    if (id) {
      const { error } = await supabase.from('quick_notes').update({ shortcut, content, category }).eq('id', id);
      if (error) throw error;
      return { id };
    } else {
      const { data, error } = await supabase.from('quick_notes').insert([{ shortcut, content, category }]).select('id').single();
      if (error) throw error;
      return { id: data.id };
    }
  } catch (err) {
    console.error("Erro ao salvar quick note:", err);
    return { error: 'Erro ao salvar quick note.' };
  }
}

// Função para excluir quick note
export async function deleteQuickNote(id: string) {
  const supabase = await createServerClient();
  try {
    const { error } = await supabase.from('quick_notes').delete().eq('id', id);
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error("Erro ao excluir quick note:", err);
    return { error: 'Erro ao excluir quick note.' };
  }
}

// Função para obter tickets internos
export async function getInternalTickets() {
  const supabase = await createServerClient();
  try {
    const { data, error } = await supabase.from('internal_tickets').select('*');
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("Erro ao buscar tickets internos:", err);
    return [];
  }
}

// Função para obter permissões de roles
export async function getRolePermissions() {
  const supabase = await createServerClient();
  try {
    const { data, error } = await supabase.from('role_permissions').select('*');
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("Erro ao buscar permissões:", err);
    return [];
  }
}

// Função para salvar permissões de roles
export async function saveRolePermissions(roleId: string, permissions: string[]) {
  const supabase = await createServerClient();
  try {
    const { error } = await supabase.from('role_permissions').upsert({ id: roleId, permissions });
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error("Erro ao salvar permissões:", err);
    return { error: 'Erro ao salvar permissões.' };
  }
}

// Função para calcular SLA
export async function calculateSLA(ticketId: string, priority: string) {
  const supabase = await createServerClient();
  try {
    const { data: priorityConfig, error } = await supabase.from('priorities').select('slaHours').eq('label', priority).single();
    if (error) return undefined;
    
    const slaHours = priorityConfig?.slaHours || 24;
    return new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString();
  } catch (err) {
    return undefined;
  }
}

// Função para upload de arquivos
export async function uploadFile(ticketId: string, fileName: string, fileData: string) {
  const supabase = await createServerClient();
  try {
    const { data, error } = await supabase.from('attachments').insert([{
      ticket_id: ticketId,
      name: fileName,
      type: 'file',
      url: fileData
    }]).select('id').single();
    
    if (error) throw error;
    return { id: data.id };
  } catch (err) {
    console.error("Erro ao fazer upload:", err);
    return { error: 'Erro ao fazer upload do arquivo.' };
  }
}

// Função para obter chats internos
export async function getInternalChats() {
  const supabase = await createServerClient();
  try {
    const { data, error } = await supabase.from('internal_chats').select('*');
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("Erro ao buscar chats internos:", err);
    return [];
  }
}

// Função para salvar chat interno
export async function saveInternalChat(id: string | null, data: any) {
  const supabase = await createServerClient();
  try {
    if (id) {
      const { error } = await supabase.from('internal_chats').update(data).eq('id', id);
      if (error) throw error;
      return { id };
    } else {
      const { data: result, error } = await supabase.from('internal_chats').insert([data]).select('id').single();
      if (error) throw error;
      return { id: result.id };
    }
  } catch (err) {
    console.error("Erro ao salvar chat interno:", err);
    return { error: 'Erro ao salvar chat interno.' };
  }
}
