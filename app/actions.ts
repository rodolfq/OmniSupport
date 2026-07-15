'use server';

import { pool, query } from '@/lib/db';
import { hashPassword } from '@/lib/auth-utils';
import { verifyJWT } from '@/lib/jwt';
import { cookies } from 'next/headers';

async function getCurrentActionUser() {
  const token = (await cookies()).get('token')?.value;
  if (!token) return null;

  const decoded = await verifyJWT(token);
  if (!decoded?.id) return null;

  const result = await query(
    'SELECT id, role, company_id FROM public.profiles WHERE id = $1',
    [decoded.id]
  );

  return result.rows[0] || null;
}

export async function createUser(
  email: string,
  name: string,
  role: string,
  companyId: string | null,
  phones: string[],
  viewAllCompanyTickets: boolean
) {
  try {
    const actor = await getCurrentActionUser();
    if (!actor) {
      return { error: 'Sessão inválida.' };
    }

    const actorIsCustomer = actor.role === 'Cliente';
    if (actorIsCustomer) {
      if (role !== 'Funcionário' || companyId !== actor.company_id) {
        return { error: 'Você só pode criar funcionários da sua própria empresa.' };
      }
      viewAllCompanyTickets = false;
    } else if (actor.role !== 'Administrador') {
      return { error: 'Você não tem permissão para criar usuários.' };
    }

    const checkRes = await query('SELECT id FROM public.profiles WHERE email = $1', [email]);
    if ((checkRes.rowCount ?? 0) > 0) {
      return { error: 'Usuário com este e-mail já existe.' };
    }
    
    const newId = crypto.randomUUID();
    const defaultPass = hashPassword('Mudar@123');
    const isAdmin = role === 'Administrador';
    const livesInSquad = role === 'Administrador' || role === 'Equipe';
    
    await query(
      `INSERT INTO public.profiles (id, email, name, role, company_id, phone, view_all_company_tickets, password, is_admin, lives_in_squad)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        newId,
        email,
        name,
        role,
        companyId || null,
        phones[0] || null,
        !!viewAllCompanyTickets,
        defaultPass,
        isAdmin,
        livesInSquad
      ]
    );
    return { id: newId };
  } catch (err: any) {
    console.error("Error in server action createUser:", err);
    return { error: err.message || 'Erro inesperado no servidor.' };
  }
}

export async function saveCompany(
  id: string | null,
  name: string,
  industry: string,
  phone: string,
  adminUser?: { name: string; email: string; password: string; phone?: string }
) {
  try {
    const actor = await getCurrentActionUser();
    if (!actor || actor.role !== 'Administrador') {
      return { error: 'Você não tem permissão para gerenciar empresas.' };
    }

    let checkQuery;
    let params;
    if (id) {
      checkQuery = 'SELECT id FROM public.companies WHERE name = $1 AND id != $2';
      params = [name, id];
    } else {
      checkQuery = 'SELECT id FROM public.companies WHERE name = $1';
      params = [name];
    }
    const checkResult = await query(checkQuery, params);
    if ((checkResult.rowCount ?? 0) > 0) {
      return { error: 'Empresa com este nome já existe.' };
    }

    if (id) {
      await query(
        'UPDATE public.companies SET name=$1, industry=$2, phone=$3 WHERE id=$4',
        [name, industry, phone, id]
      );
      return { id };
    } else {
      if (!adminUser?.name?.trim() || !adminUser?.email?.trim() || !adminUser?.password?.trim()) {
        return { error: 'Informe nome, e-mail e senha do administrador da empresa.' };
      }

      const emailCheck = await query('SELECT id FROM public.profiles WHERE email = $1', [adminUser.email.trim()]);
      if ((emailCheck.rowCount ?? 0) > 0) {
        return { error: 'Usuário administrador com este e-mail já existe.' };
      }

      const newId = crypto.randomUUID();
      const adminId = crypto.randomUUID();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'INSERT INTO public.companies (id, name, industry, phone) VALUES ($1, $2, $3, $4)',
          [newId, name, industry, phone]
        );
        await client.query(
          `INSERT INTO public.profiles (
             id, email, name, role, company_id, phone, password,
             is_admin, lives_in_squad, must_change_password, view_all_company_tickets
           )
           VALUES ($1, $2, $3, 'Cliente', $4, $5, $6, TRUE, FALSE, FALSE, TRUE)`,
          [
            adminId,
            adminUser.email.trim(),
            adminUser.name.trim(),
            newId,
            adminUser.phone || phone || null,
            hashPassword(adminUser.password)
          ]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      return { id: newId };
    }
  } catch (err: any) {
    console.error("Error saving company in actions:", err);
    return { error: err.message || 'Erro ao salvar empresa no servidor.' };
  }
}

export async function deleteCompany(id: string) {
  try {
    const actor = await getCurrentActionUser();
    if (!actor || actor.role !== 'Administrador') {
      return { error: 'Você não tem permissão para excluir empresas.' };
    }

    await query('DELETE FROM public.companies WHERE id = $1', [id]);
    return { success: true };
  } catch (err: any) {
    console.error("Error deleting company in actions:", err);
    return { error: err.message || 'Erro ao excluir empresa no servidor.' };
  }
}

export async function getCompanies() {
  try {
    const actor = await getCurrentActionUser();
    if (!actor) return [];

    const isCompanyUser = actor.role === 'Cliente' || actor.role === 'Funcionário';
    const res = isCompanyUser
      ? await query('SELECT * FROM public.companies WHERE id = $1 ORDER BY name ASC', [actor.company_id])
      : await query('SELECT * FROM public.companies ORDER BY name ASC');

    return res.rows.map(c => ({
      id: c.id,
      name: c.name,
      industry: c.industry || '',
      phone: c.phone || '',
      createdAt: c.created_at
    }));
  } catch (err) {
    console.error("Error getting companies in actions:", err);
    return [];
  }
}

export async function getUsers() {
  try {
    const actor = await getCurrentActionUser();
    if (!actor) return [];

    const isCompanyUser = actor.role === 'Cliente' || actor.role === 'Funcionário';
    const res = isCompanyUser
      ? await query(
          "SELECT * FROM public.profiles WHERE company_id = $1 AND role IN ('Cliente', 'Funcionário') ORDER BY name ASC",
          [actor.company_id]
        )
      : await query('SELECT * FROM public.profiles ORDER BY name ASC');

    return res.rows.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      companyId: u.company_id,
      phone: u.phone || undefined,
      avatarUrl: u.avatar_url || undefined,
      viewAllCompanyTickets: u.view_all_company_tickets,
      isAdmin: u.is_admin
    }));
  } catch (err) {
    console.error("Error getting users in actions:", err);
    return [];
  }
}

export async function deleteUser(id: string) {
  try {
    await query('DELETE FROM public.profiles WHERE id = $1', [id]);
    return { success: true };
  } catch (err) {
    console.error("Error deleting user in actions:", err);
    return { error: 'Erro ao excluir usuário no servidor.' };
  }
}

export async function updateUser(
  id: string,
  name: string,
  email: string,
  role: string,
  companyId?: string | null,
  viewAllCompanyTickets?: boolean
) {
  try {
    await query(
      `UPDATE public.profiles
       SET name = $1, email = $2, role = $3, company_id = $4, view_all_company_tickets = $5, updated_at = NOW()
       WHERE id = $6`,
      [name, email, role, companyId || null, !!viewAllCompanyTickets, id]
    );
    return { success: true };
  } catch (err: any) {
    console.error("Error updating user in actions:", err);
    return { error: err.message || 'Erro ao atualizar usuário no servidor.' };
  }
}

export async function getAnalysts() {
  try {
    const res = await query(
      "SELECT * FROM public.profiles WHERE role IN ('Administrador', 'Analista', 'Suporte', 'Time Interno') ORDER BY name ASC"
    );
    return res.rows.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      companyId: u.company_id,
      phone: u.phone || undefined
    }));
  } catch (err) {
    console.error("Error getting analysts in actions:", err);
    return [];
  }
}

export async function getCustomers() {
  try {
    const res = await query(
      "SELECT * FROM public.profiles WHERE role IN ('Cliente', 'Funcionário') ORDER BY name ASC"
    );
    return res.rows.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      companyId: u.company_id,
      phone: u.phone || undefined
    }));
  } catch (err) {
    console.error("Error getting customers in actions:", err);
    return [];
  }
}

export async function updateUserStatus(userId: string, isOnline: boolean, reason?: string) {
  try {
    const status = isOnline ? 'online' : 'offline';
    await query(
      `INSERT INTO public.analyst_status (user_id, is_online, last_active, current_reason, status)
       VALUES ($1, $2, NOW(), $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET
         is_online = EXCLUDED.is_online,
         last_active = NOW(),
         current_reason = EXCLUDED.current_reason,
         status = EXCLUDED.status`,
      [userId, isOnline, reason || null, status]
    );
    await query(
      `INSERT INTO public.user_status_history (user_id, status, reason)
       VALUES ($1, $2, $3)`,
      [userId, status, reason || null]
    );
    return { success: true };
  } catch (err) {
    console.error("Error updating user status in actions:", err);
    return { error: 'Erro ao atualizar status.' };
  }
}

export async function getQueues() {
  try {
    const res = await query('SELECT * FROM public.queues');
    return res.rows.map(q => ({
      id: q.id,
      name: q.name,
      description: q.description,
      whatsappInstanceId: q.whatsapp_instance_id,
      memberIds: q.member_ids || []
    }));
  } catch (err) {
    console.error("Error getting queues in actions:", err);
    return [];
  }
}

export async function saveQueue(
  id: string | null,
  name: string,
  description: string | null,
  whatsappInstanceId: string | null,
  memberIds: string[]
) {
  try {
    if (id) {
      await query(
        `UPDATE public.queues
         SET name = $1, description = $2, whatsapp_instance_id = $3, member_ids = $4, updated_at = NOW()
         WHERE id = $5`,
        [name, description, whatsappInstanceId, memberIds, id]
      );
      return { id };
    } else {
      const res = await query(
        `INSERT INTO public.queues (name, description, whatsapp_instance_id, member_ids)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [name, description, whatsappInstanceId, memberIds]
      );
      return { id: res.rows[0].id };
    }
  } catch (err) {
    console.error("Error saving queue in actions:", err);
    return { error: 'Erro ao salvar fila.' };
  }
}

export async function deleteQueue(id: string) {
  try {
    await query('DELETE FROM public.queues WHERE id = $1', [id]);
    return { success: true };
  } catch (err) {
    console.error("Error deleting queue in actions:", err);
    return { error: 'Erro ao excluir fila.' };
  }
}

export async function getWhatsappInstances() {
  try {
    const res = await query('SELECT * FROM public.whatsapp_instances');
    return res.rows;
  } catch (err) {
    console.error("Error getting WhatsApp instances in actions:", err);
    return [];
  }
}

export async function saveWhatsappInstance(id: string | null, name: string, phone: string, status: string) {
  try {
    if (id) {
      await query(
        `UPDATE public.whatsapp_instances
         SET name = $1, phone = $2, status = $3, updated_at = NOW()
         WHERE id = $4`,
        [name, phone, status, id]
      );
      return { id };
    } else {
      const res = await query(
        `INSERT INTO public.whatsapp_instances (name, phone, status)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [name, phone, status]
      );
      return { id: res.rows[0].id };
    }
  } catch (err) {
    console.error("Error saving WhatsApp instance in actions:", err);
    return { error: 'Erro ao salvar instância.' };
  }
}

export async function getQuickNotes() {
  try {
    const res = await query('SELECT * FROM public.quick_notes ORDER BY shortcut ASC');
    return res.rows;
  } catch (err) {
    console.error("Error getting quick notes in actions:", err);
    return [];
  }
}

export async function saveQuickNote(id: string | null, shortcut: string, content: string, category: string) {
  try {
    if (id) {
      await query(
        `UPDATE public.quick_notes
         SET shortcut = $1, content = $2, category = $3, updated_at = NOW()
         WHERE id = $4`,
        [shortcut, content, category, id]
      );
      return { id };
    } else {
      const res = await query(
        `INSERT INTO public.quick_notes (shortcut, content, category)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [shortcut, content, category]
      );
      return { id: res.rows[0].id };
    }
  } catch (err) {
    console.error("Error saving quick note in actions:", err);
    return { error: 'Erro ao salvar quick note.' };
  }
}

export async function deleteQuickNote(id: string) {
  try {
    await query('DELETE FROM public.quick_notes WHERE id = $1', [id]);
    return { success: true };
  } catch (err) {
    console.error("Error deleting quick note in actions:", err);
    return { error: 'Erro ao excluir quick note.' };
  }
}

export async function getInternalTickets() {
  try {
    const res = await query('SELECT * FROM public.internal_tickets');
    return res.rows;
  } catch (err) {
    console.error("Error getting internal tickets in actions:", err);
    return [];
  }
}

export async function getRolePermissions() {
  try {
    const res = await query('SELECT * FROM public.role_permissions');
    return res.rows;
  } catch (err) {
    console.error("Error getting role permissions in actions:", err);
    return [];
  }
}

export async function saveRolePermissions(roleId: string, permissions: string[]) {
  try {
    await query(
      `INSERT INTO public.role_permissions (name, role, permissions)
       VALUES ($1, $1, $2)
       ON CONFLICT (name) DO UPDATE SET permissions = EXCLUDED.permissions`,
      [roleId, permissions]
    );
    return { success: true };
  } catch (err) {
    console.error("Error saving role permissions in actions:", err);
    return { error: 'Erro ao salvar permissões.' };
  }
}

export async function deleteRolePermission(roleId: string) {
  try {
    await query('DELETE FROM public.role_permissions WHERE id::text = $1 OR name = $1', [roleId]);
    return { success: true };
  } catch (err) {
    console.error("Error deleting role permission in actions:", err);
    return { error: 'Erro ao excluir permissões.' };
  }
}

export async function calculateSLA(ticketId: string, priority: string) {
  try {
    const res = await query('SELECT sla_hours FROM public.config_priorities WHERE label = $1', [priority]);
    if (res.rowCount === 0) return undefined;
    const slaHours = res.rows[0].sla_hours || 24;
    return new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString();
  } catch (err) {
    return undefined;
  }
}

export async function uploadFile(ticketId: string, fileName: string, fileData: string) {
  try {
    const res = await query(
      `INSERT INTO public.attachments (ticket_id, name, type, url)
       VALUES ($1, $2, 'file', $3)
       RETURNING id`,
      [ticketId, fileName, fileData]
    );
    return { id: res.rows[0].id };
  } catch (err) {
    console.error("Error uploading file in actions:", err);
    return { error: 'Erro ao fazer upload do arquivo.' };
  }
}

export async function getInternalChats() {
  try {
    const res = await query('SELECT * FROM public.internal_chats ORDER BY created_at DESC');
    return res.rows.map(c => ({
      id: c.id,
      name: c.name,
      imageUrl: c.image_url,
      type: c.type,
      memberIds: c.member_ids || []
    }));
  } catch (err) {
    console.error("Error getting internal chats in actions:", err);
    return [];
  }
}

export async function saveInternalChat(id: string | null, data: any) {
  try {
    if (id) {
      await query(
        `UPDATE public.internal_chats
         SET name = COALESCE($1, name),
             image_url = COALESCE($2, image_url),
             type = COALESCE($3, type),
             member_ids = COALESCE($4, member_ids)
         WHERE id = $5`,
        [data.name, data.imageUrl, data.type, data.memberIds, id]
      );
      return { id };
    } else {
      const res = await query(
        `INSERT INTO public.internal_chats (name, image_url, type, member_ids)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [data.name, data.imageUrl, data.type, data.memberIds]
      );
      return { id: res.rows[0].id };
    }
  } catch (err) {
    console.error("Error saving internal chat in actions:", err);
    return { error: 'Erro ao salvar chat interno.' };
  }
}
