'use server';

import { pool, query } from '@/lib/db';
import { hashPassword } from '@/lib/auth-utils';
import { verifyJWT } from '@/lib/jwt';
import { cookies } from 'next/headers';
import { emitChatEvent, excludeActiveViewers } from '@/lib/chat-events';
import { notifyUser } from '@/lib/services/push-service';
import { getChatRecipientIds, getTeamUserIds } from '@/lib/services/notification-recipients';
import { pickNextQueueAssignee } from '@/lib/services/queue-routing';
import { CustomerEvaluationScores, CustomerProfileTag, CustomerEvaluationSummary } from '@/lib/types';

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

// Equipes que o ator administra (internal_teams.admin_ids contém o id
// dele) — base de toda a autorização de "admin de setor" abaixo: fora do
// Administrador do sistema, ninguém mexe em usuário/perfil de acesso que
// não esteja em uma dessas equipes.
async function getAdminTeamIds(actorId: string): Promise<string[]> {
  const res = await query('SELECT id FROM public.internal_teams WHERE $1 = ANY(admin_ids)', [actorId]);
  return res.rows.map(r => r.id);
}

// Um perfil de acesso só pode ser editado/renomeado/excluído por: o
// Administrador do sistema, ou um admin da equipe à qual o perfil está
// escopado. Perfis de sistema (is_system) e perfis globais (sem equipe)
// nunca são editáveis por admin de equipe.
async function assertProfileEditable(actor: { id: string; role: string }, profileId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (actor.role === 'Administrador') return { ok: true };

  const res = await query('SELECT internal_team_id, is_system FROM public.role_permissions WHERE id = $1', [profileId]);
  const profile = res.rows[0];
  if (!profile || profile.is_system || !profile.internal_team_id) {
    return { ok: false, error: 'Você não tem permissão para editar este perfil.' };
  }

  const adminTeamIds = await getAdminTeamIds(actor.id);
  if (!adminTeamIds.includes(profile.internal_team_id)) {
    return { ok: false, error: 'Você não administra essa equipe.' };
  }
  return { ok: true };
}

export async function createUser(
  email: string,
  name: string,
  role: string,
  companyId: string | null,
  phones: string[],
  viewAllCompanyTickets: boolean,
  // Perfil de Acesso escolhido e equipe(s) internas — só usados pra quem
  // não é Cliente; um admin de equipe só consegue passar por aqui se
  // accessProfileId apontar pra um perfil da própria equipe (checado abaixo).
  accessProfileId?: string,
  internalTeamIds?: string[]
) {
  try {
    const actor = await getCurrentActionUser();
    if (!actor) {
      return { error: 'Sessão inválida.' };
    }

    const actorIsCustomer = actor.role === 'Cliente';
    const actorIsSystemAdmin = actor.role === 'Administrador';
    let finalRole = role;
    let finalProfileId: string | null = accessProfileId || null;
    let finalTeamIds: string[] = internalTeamIds || [];

    if (actorIsCustomer) {
      if (role !== 'Funcionário' || companyId !== actor.company_id) {
        return { error: 'Você só pode criar funcionários da sua própria empresa.' };
      }
      viewAllCompanyTickets = false;
      finalTeamIds = [];
    } else if (actorIsSystemAdmin) {
      // Administrador do sistema: livre, respeita o que veio do formulário.
      if (finalProfileId && finalTeamIds.length === 0) {
        const p = await query('SELECT internal_team_id FROM public.role_permissions WHERE id = $1', [finalProfileId]);
        if (p.rows[0]?.internal_team_id) finalTeamIds = [p.rows[0].internal_team_id];
      }
    } else {
      // Não é Administrador nem Cliente: só passa se for admin de uma
      // equipe e o perfil escolhido pertencer a essa mesma equipe. O time
      // estrutural (role) e a equipe atribuída vêm sempre do perfil, nunca
      // do que o formulário mandou — evita escalar pra Administrador/Equipe
      // globais ou atribuir a outra equipe.
      if (!finalProfileId) {
        return { error: 'Você não tem permissão para criar usuários.' };
      }
      const p = await query('SELECT internal_team_id, is_system FROM public.role_permissions WHERE id = $1', [finalProfileId]);
      const profile = p.rows[0];
      if (!profile || profile.is_system || !profile.internal_team_id) {
        return { error: 'Você só pode atribuir perfis de acesso da sua equipe.' };
      }
      const adminTeamIds = await getAdminTeamIds(actor.id);
      if (!adminTeamIds.includes(profile.internal_team_id)) {
        return { error: 'Você não administra essa equipe.' };
      }
      finalRole = 'Time Interno';
      companyId = null;
      viewAllCompanyTickets = false;
      finalTeamIds = [profile.internal_team_id];
    }

    // Fluxos antigos que só mandam `role` (sem accessProfileId) — inclui
    // Cliente criando Funcionário: assume o perfil de sistema
    // correspondente, preservando o comportamento de antes da migração pra
    // Perfil de Acesso (sem isso, o novo usuário ficaria sem NENHUMA
    // permissão pra sempre, mesmo que o perfil "Funcionário" tenha alguma).
    if (!finalProfileId) {
      const p = await query('SELECT id FROM public.role_permissions WHERE role = $1 AND is_system = true', [finalRole]);
      finalProfileId = p.rows[0]?.id || null;
    }

    const checkRes = await query('SELECT id FROM public.profiles WHERE email = $1', [email]);
    if ((checkRes.rowCount ?? 0) > 0) {
      return { error: 'Usuário com este e-mail já existe.' };
    }

    const newId = crypto.randomUUID();
    const defaultPass = hashPassword('Mudar@123');
    const isAdmin = finalRole === 'Administrador';
    const livesInSquad = finalRole === 'Administrador' || finalRole === 'Equipe';

    await query(
      `INSERT INTO public.profiles (id, email, name, role, company_id, phone, view_all_company_tickets, password, is_admin, lives_in_squad, access_profile_id, internal_team_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        newId,
        email,
        name,
        finalRole,
        companyId || null,
        phones[0] || null,
        !!viewAllCompanyTickets,
        defaultPass,
        isAdmin,
        livesInSquad,
        finalProfileId,
        finalTeamIds
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
      createdAt: c.created_at,
      // Nunca inclui pra quem é da própria empresa (Cliente/Funcionário) —
      // é perfil interno, não deve nem trafegar pro navegador do cliente.
      radarSync: isCompanyUser ? undefined : (c.radar_sync || false)
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
      isAdmin: u.is_admin,
      isActive: u.is_active,
      internalTeamIds: u.internal_team_ids || [],
      accessProfileId: u.access_profile_id || undefined
    }));
  } catch (err) {
    console.error("Error getting users in actions:", err);
    return [];
  }
}

// Um admin de equipe só pode agir sobre usuários que já pertencem a uma
// equipe que ele administra (nunca sobre um Administrador do sistema).
async function assertUserManageable(actor: { id: string; role: string; company_id?: string | null }, targetId: string): Promise<{ ok: true; target: any } | { ok: false; error: string }> {
  const res = await query('SELECT id, role, company_id, internal_team_ids FROM public.profiles WHERE id = $1', [targetId]);
  const target = res.rows[0];
  if (!target) return { ok: false, error: 'Usuário não encontrado.' };
  if (actor.role === 'Administrador') return { ok: true, target };

  if (actor.role === 'Cliente') {
    if (target.company_id !== actor.company_id || target.role !== 'Funcionário') {
      return { ok: false, error: 'Você só pode gerenciar funcionários da sua própria empresa.' };
    }
    return { ok: true, target };
  }

  if (target.role === 'Administrador') {
    return { ok: false, error: 'Você não tem permissão para gerenciar este usuário.' };
  }
  const adminTeamIds = await getAdminTeamIds(actor.id);
  const targetTeamIds: string[] = target.internal_team_ids || [];
  if (adminTeamIds.length === 0 || !targetTeamIds.some(t => adminTeamIds.includes(t))) {
    return { ok: false, error: 'Você não tem permissão para gerenciar este usuário.' };
  }
  return { ok: true, target };
}

export async function deleteUser(id: string) {
  try {
    const actor = await getCurrentActionUser();
    if (!actor) return { error: 'Sessão inválida.' };

    const check = await assertUserManageable(actor, id);
    if (!check.ok) return { error: check.error };

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
  viewAllCompanyTickets?: boolean,
  accessProfileId?: string,
  internalTeamIds?: string[]
) {
  try {
    const actor = await getCurrentActionUser();
    if (!actor) return { error: 'Sessão inválida.' };

    const check = await assertUserManageable(actor, id);
    if (!check.ok) return { error: check.error };
    const target = check.target;

    let finalRole = role;
    let finalProfileId = accessProfileId;
    let finalTeamIds = internalTeamIds;

    if (actor.role === 'Cliente') {
      finalRole = target.role; // cliente não muda o role de um funcionário
      finalProfileId = target.access_profile_id;
      finalTeamIds = [];
    } else if (actor.role !== 'Administrador') {
      // admin de equipe: só pode trocar pra um perfil da própria equipe;
      // não pode promover a Administrador nem tirar da própria equipe. Se
      // não veio um perfil novo (ex: só corrigindo o nome), preserva o role
      // estrutural que o usuário já tinha — forçar 'Time Interno' aqui
      // rebaixaria silenciosamente um 'Equipe' existente a cada edição.
      if (finalProfileId) {
        const p = await query('SELECT internal_team_id, is_system FROM public.role_permissions WHERE id = $1', [finalProfileId]);
        const profile = p.rows[0];
        const adminTeamIds = await getAdminTeamIds(actor.id);
        if (!profile || profile.is_system || !profile.internal_team_id || !adminTeamIds.includes(profile.internal_team_id)) {
          return { error: 'Você só pode atribuir perfis de acesso da sua equipe.' };
        }
        finalTeamIds = [profile.internal_team_id];
        finalRole = 'Time Interno';
      } else {
        finalTeamIds = target.internal_team_ids || [];
        finalRole = target.role;
      }
      companyId = target.company_id;
      viewAllCompanyTickets = false;
    } else if (finalProfileId && finalTeamIds === undefined) {
      // Administrador do sistema trocando o perfil sem informar equipe
      // explicitamente: se o perfil escolhido é de uma equipe, o usuário
      // passa a fazer parte dela automaticamente — sem isso, a pessoa ficava
      // com o perfil certo mas de fora da equipe pra todo o resto do
      // sistema (filtro de tickets internos, listagem de membros etc).
      const p = await query('SELECT internal_team_id FROM public.role_permissions WHERE id = $1', [finalProfileId]);
      const teamId = p.rows[0]?.internal_team_id;
      if (teamId) {
        const existing: string[] = target.internal_team_ids || [];
        finalTeamIds = existing.includes(teamId) ? existing : [...existing, teamId];
      }
    }

    // profiles não tem coluna updated_at (diferente de whatsapp_instances,
    // chat_sessions etc.) — incluir aqui já quebrava esse UPDATE antes desta
    // correção, só ninguém tinha salvo uma edição de analista até agora.
    const setClauses = ['name = $1', 'email = $2', 'role = $3', 'company_id = $4', 'view_all_company_tickets = $5'];
    const params: any[] = [name, email, finalRole, companyId || null, !!viewAllCompanyTickets];
    if (finalProfileId !== undefined) { params.push(finalProfileId); setClauses.push(`access_profile_id = $${params.length}`); }
    if (finalTeamIds !== undefined) { params.push(finalTeamIds); setClauses.push(`internal_team_ids = $${params.length}`); }
    params.push(id);

    await query(`UPDATE public.profiles SET ${setClauses.join(', ')} WHERE id = $${params.length}`, params);
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
      memberIds: q.member_ids || [],
      includeInternalChats: q.include_internal_chats !== false
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
  memberIds: string[],
  includeInternalChats: boolean = true
) {
  try {
    if (id) {
      // Tabela `queues` não tem coluna `updated_at` (ver schema_postgres.sql) —
      // setá-la aqui derrubava todo o UPDATE com "column does not exist".
      await query(
        `UPDATE public.queues
         SET name = $1, description = $2, whatsapp_instance_id = $3, member_ids = $4, include_internal_chats = $5
         WHERE id = $6`,
        [name, description, whatsappInstanceId, memberIds, includeInternalChats, id]
      );
      return { id };
    } else {
      const newId = crypto.randomUUID();
      await query(
        `INSERT INTO public.queues (id, name, description, whatsapp_instance_id, member_ids, include_internal_chats)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [newId, name, description, whatsappInstanceId, memberIds, includeInternalChats]
      );
      return { id: newId };
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
      const newId = crypto.randomUUID();
      await query(
        `INSERT INTO public.whatsapp_instances (id, name, phone, status)
         VALUES ($1, $2, $3, $4)`,
        [newId, name, phone, status]
      );
      return { id: newId };
    }
  } catch (err) {
    console.error("Error saving WhatsApp instance in actions:", err);
    return { error: 'Erro ao salvar instância.' };
  }
}

// Assume/transfere um atendimento (usado tanto pelo widget quanto pela fila
// em /chat-management, individual ou em lote) — centraliza a lógica antes
// duplicada nos dois lugares e, quando o responsável realmente muda, registra
// uma mensagem automática de apresentação ("Você está falando com Fulano"),
// pro cliente saber com quem está falando assim que alguém aceita a
// conversa, do mesmo jeito que qualquer outro aviso do sistema no chat.
export async function assignChatSession(sessionId: string, assigneeId: string, actingUserId?: string) {
  try {
    const sessionRes = await query(
      `SELECT customer_id, assignee_id FROM public.chat_sessions WHERE id = $1`,
      [sessionId]
    );
    const session = sessionRes.rows[0];
    if (!session) return { error: 'Atendimento não encontrado.' };

    const previousAssigneeId: string | null = session.assignee_id;
    const assigneeChanged = previousAssigneeId !== assigneeId;

    await query(
      `UPDATE public.chat_sessions SET assignee_id = $1, status = 'active', updated_at = NOW() WHERE id = $2`,
      [assigneeId, sessionId]
    );

    if (assigneeChanged) {
      const agentRes = await query('SELECT name FROM public.profiles WHERE id = $1', [assigneeId]);
      const agentName = agentRes.rows[0]?.name;

      if (agentName) {
        const messageId = crypto.randomUUID();
        const text = `👋 Você está falando com ${agentName}.`;
        const timestamp = new Date().toISOString();

        // type 'system' (não 'text'): identifica esta como uma mensagem
        // automática, não uma resposta real do analista — usado pra não
        // contar como "1ª resposta" na métrica de tempo de atendimento.
        await query(
          `INSERT INTO public.chat_messages (id, session_id, sender_id, sender_name, text, type, metadata, created_at)
           VALUES ($1, $2, NULL, 'SSX Resolve', $3, 'system', '{}'::jsonb, $4)`,
          [messageId, sessionId, text, timestamp]
        );
        await query('UPDATE public.chat_sessions SET last_message_at = $1 WHERE id = $2', [timestamp, sessionId]);

        emitChatEvent(sessionId, {
          type: 'message',
          sessionId,
          message: {
            id: messageId,
            senderId: null,
            senderName: 'SSX Resolve',
            text,
            timestamp,
            type: 'system',
            metadata: {},
            attachments: []
          }
        });

        try {
          const recipients = await getChatRecipientIds({ customerId: session.customer_id }, null, true);
          const toNotify = await excludeActiveViewers(sessionId, recipients);
          await Promise.all(toNotify.map(id => notifyUser(id, {
            title: `Você está falando com ${agentName}`,
            body: text,
            url: `/chat?chat=${sessionId}`,
            tag: `chat_message:${messageId}`
          })));
        } catch (err) {
          console.error('Error notifying about chat assignment intro message:', err);
        }
      }

      // Só registra log de transferência quando havia mesmo alguém com a
      // conversa antes (senão é só um "assumir" comum, já coberto pelo aviso
      // de apresentação acima) — e o texto sempre descreve quem de fato
      // clicou (actingUserId), nunca o responsável anterior, pra não atribuir
      // a ação a quem não a realizou (ex: alguém "puxando" pra si um chat que
      // estava com outra pessoa não é essa outra pessoa "transferindo").
      let logText: string | null = null;
      if (agentName && actingUserId && previousAssigneeId) {
        if (actingUserId !== assigneeId) {
          const actingUserRes = await query('SELECT name FROM public.profiles WHERE id = $1', [actingUserId]);
          const actingUserName = actingUserRes.rows[0]?.name || 'Alguém';
          logText = `${actingUserName} transferiu a conversa para ${agentName}.`;
        } else if (previousAssigneeId !== assigneeId) {
          const previousAgentRes = await query('SELECT name FROM public.profiles WHERE id = $1', [previousAssigneeId]);
          const previousAgentName = previousAgentRes.rows[0]?.name || 'Alguém';
          logText = `${agentName} assumiu a conversa, que estava com ${previousAgentName}.`;
        }
      }

      if (logText) {
        try {
          const logMessageId = crypto.randomUUID();
          const logTimestamp = new Date().toISOString();

          // type 'internal': aviso de bastidores pro time, nunca aparece pro
          // lado do cliente (ver filtro em chat-widget.tsx) — diferente do
          // "Você está falando com" acima, que é a apresentação voltada ao
          // cliente.
          await query(
            `INSERT INTO public.chat_messages (id, session_id, sender_id, sender_name, text, type, metadata, created_at)
             VALUES ($1, $2, NULL, 'SSX Resolve', $3, 'internal', '{}'::jsonb, $4)`,
            [logMessageId, sessionId, logText, logTimestamp]
          );

          emitChatEvent(sessionId, {
            type: 'message',
            sessionId,
            message: {
              id: logMessageId,
              senderId: null,
              senderName: 'SSX Resolve',
              text: logText,
              timestamp: logTimestamp,
              type: 'internal',
              metadata: {},
              attachments: []
            }
          });

          const teamIds = (await getTeamUserIds()).filter(id => id !== actingUserId);
          const toNotify = await excludeActiveViewers(sessionId, teamIds);
          await Promise.all(toNotify.map(id => notifyUser(id, {
            title: 'Atendimento transferido',
            body: logText,
            url: `/chat?chat=${sessionId}`,
            tag: `chat_message:${logMessageId}`
          })));
        } catch (err) {
          console.error('Error registering internal chat transfer message:', err);
        }
      }
    }

    return { success: true };
  } catch (err: any) {
    console.error('Error assigning chat session in actions:', err);
    return { error: err.message || 'Erro ao atualizar o atendimento.' };
  }
}

// Devolve um atendimento pra fila escolhida (opção "Voltar para fila" em
// AssignChatMenu), tirando o responsável atual e deixando a distribuição
// normal da fila (mesmo rodízio round-robin de pickNextQueueAssignee usado
// quando uma mensagem nova chega) decidir quem fica com ele — ou 'pending',
// se ninguém da fila estiver online. Sempre registra um aviso visível só pro
// time (type 'internal'), nunca encaminhado ao cliente.
export async function returnChatSessionToQueue(sessionId: string, queueId: string, actingUserId: string) {
  try {
    const sessionRes = await query(
      `SELECT customer_id, assignee_id FROM public.chat_sessions WHERE id = $1`,
      [sessionId]
    );
    const session = sessionRes.rows[0];
    if (!session) return { error: 'Atendimento não encontrado.' };

    const queueRes = await query('SELECT id, name, member_ids FROM public.queues WHERE id = $1', [queueId]);
    const queue = queueRes.rows[0];
    if (!queue) return { error: 'Fila não encontrada.' };

    const nextAssigneeId = await pickNextQueueAssignee({ id: queue.id, memberIds: queue.member_ids || [] });

    await query(
      `UPDATE public.chat_sessions
       SET assignee_id = $1, queue_id = $2, status = $3, updated_at = NOW()
       WHERE id = $4`,
      [nextAssigneeId, queueId, nextAssigneeId ? 'active' : 'pending', sessionId]
    );

    const actingUserRes = await query('SELECT name FROM public.profiles WHERE id = $1', [actingUserId]);
    const actingUserName = actingUserRes.rows[0]?.name || 'Alguém';

    const messageId = crypto.randomUUID();
    const text = `${actingUserName} devolveu a conversa para a fila ${queue.name}.`;
    const timestamp = new Date().toISOString();

    await query(
      `INSERT INTO public.chat_messages (id, session_id, sender_id, sender_name, text, type, metadata, created_at)
       VALUES ($1, $2, NULL, 'SSX Resolve', $3, 'internal', '{}'::jsonb, $4)`,
      [messageId, sessionId, text, timestamp]
    );
    await query('UPDATE public.chat_sessions SET last_message_at = $1 WHERE id = $2', [timestamp, sessionId]);

    emitChatEvent(sessionId, {
      type: 'message',
      sessionId,
      message: {
        id: messageId,
        senderId: null,
        senderName: 'SSX Resolve',
        text,
        timestamp,
        type: 'internal',
        metadata: {},
        attachments: []
      }
    });

    try {
      const teamIds = ((queue.member_ids || []) as string[]).length
        ? (queue.member_ids as string[])
        : await getTeamUserIds();
      const toNotify = await excludeActiveViewers(sessionId, teamIds.filter(id => id !== actingUserId));
      await Promise.all(toNotify.map(id => notifyUser(id, {
        title: 'Atendimento devolvido para a fila',
        body: text,
        url: `/chat?chat=${sessionId}`,
        tag: `chat_message:${messageId}`
      })));
    } catch (err) {
      console.error('Error notifying about chat queue return:', err);
    }

    return { success: true };
  } catch (err: any) {
    console.error('Error returning chat session to queue in actions:', err);
    return { error: err.message || 'Erro ao devolver o atendimento para a fila.' };
  }
}

// Cria (ou reaproveita) o chamado de um atendimento de chat, vinculando-o via
// chat_sessions.ticket_id em vez de copiar o histórico da conversa pra dentro
// de tickets.description — o histórico continua vivendo só em chat_messages;
// quem quiser ver a conversa busca pela sessão vinculada (ver aba "Conversa"
// no chamado), sem duplicar dado nem correr o risco de description ficar
// desatualizada em relação ao chat.
export async function saveTicketFromChatSession(
  sessionId: string,
  ticketTitle: string,
  closeTicketImmediately: boolean
) {
  try {
    const actor = await getCurrentActionUser();
    if (!actor) return { error: 'Não autenticado.' };

    const sessionRes = await query(
      `SELECT customer_id, assignee_id, ticket_id, ticket_number
       FROM public.chat_sessions WHERE id = $1`,
      [sessionId]
    );
    const session = sessionRes.rows[0];
    if (!session) return { error: 'Atendimento não encontrado.' };

    // Já existe um chamado vinculado a este atendimento — reaproveita em vez
    // de criar um segundo chamado pro mesmo atendimento.
    if (session.ticket_id) {
      if (closeTicketImmediately) {
        await query(`UPDATE public.tickets SET status = 'Fechado', updated_at = NOW() WHERE id = $1`, [session.ticket_id]);
      }
      return { ticketId: session.ticket_id, ticketNumber: session.ticket_number };
    }

    let companyId: string | null = null;
    if (session.customer_id) {
      const profileRes = await query('SELECT company_id FROM public.profiles WHERE id = $1', [session.customer_id]);
      companyId = profileRes.rows[0]?.company_id || null;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ticketRes = await client.query(
        `INSERT INTO public.tickets (title, description, status, priority, category, company_id, customer_id, assignee_id, created_by)
         VALUES ($1, '', $2, 'Média', 'Atendimento Chat', $3, $4, $5, $6)
         RETURNING id, public_ticket_number`,
        [
          ticketTitle,
          closeTicketImmediately ? 'Fechado' : 'Novo',
          companyId,
          session.customer_id || null,
          session.assignee_id || actor.id,
          actor.id
        ]
      );
      const { id: ticketId, public_ticket_number: ticketNumber } = ticketRes.rows[0];

      await client.query(
        `UPDATE public.chat_sessions SET ticket_id = $1, ticket_number = $2 WHERE id = $3`,
        [ticketId, ticketNumber, sessionId]
      );

      await client.query('COMMIT');
      return { ticketId, ticketNumber };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error("Error saving ticket from chat session in actions:", err);
    return { error: err.message || 'Erro ao gerar chamado a partir do atendimento.' };
  }
}

export async function closeChatSessionAfterTicket(sessionId: string, awaitingSurveyUntil: string | null) {
  try {
    await query(
      `UPDATE public.chat_sessions SET status = 'closed', awaiting_survey_until = $1, updated_at = NOW() WHERE id = $2`,
      [awaitingSurveyUntil, sessionId]
    );
    return { success: true };
  } catch (err: any) {
    console.error("Error closing chat session in actions:", err);
    return { error: err.message || 'Erro ao fechar o atendimento.' };
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

// "Perfil de Acesso" — fonte única de telas/permissões (ver profiles.access_profile_id).
// Identidade é sempre por id (nunca por name/role) desde aqui pra cima.
export async function getRolePermissions() {
  try {
    const res = await query('SELECT id, name, role, permissions, internal_team_id, is_system FROM public.role_permissions ORDER BY is_system DESC, name ASC');
    return res.rows.map(r => ({
      id: r.id,
      name: r.name,
      role: r.role,
      permissions: r.permissions || [],
      internalTeamId: r.internal_team_id,
      isSystem: r.is_system
    }));
  } catch (err) {
    console.error("Error getting role permissions in actions:", err);
    return [];
  }
}

export async function saveRolePermissionsById(profileId: string, permissions: string[]) {
  try {
    const actor = await getCurrentActionUser();
    if (!actor) return { error: 'Sessão inválida.' };

    const check = await assertProfileEditable(actor, profileId);
    if (!check.ok) return { error: check.error };

    await query('UPDATE public.role_permissions SET permissions = $1 WHERE id = $2', [permissions, profileId]);
    return { success: true };
  } catch (err) {
    console.error("Error saving role permissions in actions:", err);
    return { error: 'Erro ao salvar permissões.' };
  }
}

export async function renameAccessProfile(profileId: string, name: string) {
  try {
    const actor = await getCurrentActionUser();
    if (!actor) return { error: 'Sessão inválida.' };

    const check = await assertProfileEditable(actor, profileId);
    if (!check.ok) return { error: check.error };

    await query('UPDATE public.role_permissions SET name = $1 WHERE id = $2', [name.trim(), profileId]);
    return { success: true };
  } catch (err: any) {
    if (err.code === '23505') return { error: 'Já existe um perfil com esse nome.' };
    console.error("Error renaming access profile in actions:", err);
    return { error: 'Erro ao renomear perfil.' };
  }
}

// Cria um novo Perfil de Acesso. Administrador do sistema pode criar
// global (internalTeamId nulo) ou escopado a qualquer equipe; quem não é
// Administrador só passa se administrar a equipe informada — nunca cria
// perfil global.
export async function createAccessProfile(name: string, internalTeamId?: string | null) {
  try {
    const actor = await getCurrentActionUser();
    if (!actor) return { error: 'Sessão inválida.' };

    const teamId = internalTeamId || null;
    if (actor.role !== 'Administrador') {
      if (!teamId) return { error: 'Você só pode criar perfis para uma equipe que administra.' };
      const adminTeamIds = await getAdminTeamIds(actor.id);
      if (!adminTeamIds.includes(teamId)) return { error: 'Você não administra essa equipe.' };
    }

    const res = await query(
      `INSERT INTO public.role_permissions (name, role, permissions, internal_team_id, is_system)
       VALUES ($1, $1, '{}', $2, false)
       RETURNING id`,
      [name.trim(), teamId]
    );
    return { id: res.rows[0].id };
  } catch (err: any) {
    if (err.code === '23505') return { error: 'Já existe um perfil com esse nome.' };
    console.error("Error creating access profile in actions:", err);
    return { error: 'Erro ao criar perfil.' };
  }
}

export async function deleteRolePermission(profileId: string) {
  try {
    const actor = await getCurrentActionUser();
    if (!actor) return { error: 'Sessão inválida.' };

    const check = await assertProfileEditable(actor, profileId);
    if (!check.ok) return { error: check.error };

    // Usuários que estavam nesse perfil ficam sem Perfil de Acesso (sem
    // permissões) em vez de a exclusão falhar por causa da FK.
    await query('UPDATE public.profiles SET access_profile_id = NULL WHERE access_profile_id = $1', [profileId]);
    await query('DELETE FROM public.role_permissions WHERE id = $1', [profileId]);
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

// ===== Perfil interno da empresa-cliente (avaliação do analista) =====
// Nunca confundir com a pesquisa de satisfação existente (cliente avaliando
// o atendimento) — aqui é o inverso: o analista avaliando o cliente, pra uso
// exclusivamente interno. Vinculado à empresa (companies), não a um contato
// específico. Ver migrations/customer_evaluations_company_scope.sql.

export async function updateCompanyRadarSync(companyId: string, radarSync: boolean) {
  try {
    await query(`UPDATE public.companies SET radar_sync = $1 WHERE id = $2`, [radarSync, companyId]);
    return { success: true };
  } catch (err: any) {
    console.error('Error updating company radar sync in actions:', err);
    return { error: err.message || 'Erro ao atualizar sincronismo com Radar.' };
  }
}

export async function saveCustomerEvaluation(
  companyId: string,
  analystId: string,
  scores: CustomerEvaluationScores,
  profileTag: CustomerProfileTag | null,
  chatSessionId?: string | null
) {
  try {
    await query(
      `INSERT INTO public.customer_evaluations
         (company_id, analyst_id, chat_session_id, knowledge_score, autonomy_score, learning_score, engagement_score, organization_score, communication_score, profile_tag)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        companyId,
        analystId,
        chatSessionId || null,
        scores.knowledgeScore,
        scores.autonomyScore,
        scores.learningScore,
        scores.engagementScore,
        scores.organizationScore,
        scores.communicationScore,
        profileTag || null
      ]
    );
    return { success: true };
  } catch (err: any) {
    console.error('Error saving customer evaluation in actions:', err);
    return { error: err.message || 'Erro ao salvar avaliação do cliente.' };
  }
}

// Média por critério + tag mais recente — usado no cadastro da empresa
// (resumo, sem listar cada avaliação individual; isso fica pro relatório).
export async function getCustomerEvaluationSummary(companyId: string): Promise<CustomerEvaluationSummary | { error: string }> {
  try {
    const avgRes = await query(
      `SELECT
         COUNT(*)::int AS count,
         AVG(knowledge_score) AS knowledge_avg,
         AVG(autonomy_score) AS autonomy_avg,
         AVG(learning_score) AS learning_avg,
         AVG(engagement_score) AS engagement_avg,
         AVG(organization_score) AS organization_avg,
         AVG(communication_score) AS communication_avg
       FROM public.customer_evaluations
       WHERE company_id = $1`,
      [companyId]
    );
    const row = avgRes.rows[0];
    const count = row?.count || 0;

    const latestRes = count > 0
      ? await query(
          `SELECT knowledge_score, autonomy_score, learning_score, engagement_score, organization_score, communication_score, profile_tag
           FROM public.customer_evaluations
           WHERE company_id = $1
           ORDER BY created_at DESC LIMIT 1`,
          [companyId]
        )
      : { rows: [] as any[] };
    const latestRow = latestRes.rows[0];

    const averages: CustomerEvaluationScores = {
      knowledgeScore: count > 0 ? Number(row.knowledge_avg) : 0,
      autonomyScore: count > 0 ? Number(row.autonomy_avg) : 0,
      learningScore: count > 0 ? Number(row.learning_avg) : 0,
      engagementScore: count > 0 ? Number(row.engagement_avg) : 0,
      organizationScore: count > 0 ? Number(row.organization_avg) : 0,
      communicationScore: count > 0 ? Number(row.communication_avg) : 0
    };
    const overallAverage = count > 0
      ? Object.values(averages).reduce((sum, v) => sum + v, 0) / Object.values(averages).length
      : 0;

    return {
      count,
      averages,
      overallAverage,
      latestTag: (latestRow?.profile_tag as CustomerProfileTag) || null,
      latestScores: latestRow ? {
        knowledgeScore: latestRow.knowledge_score,
        autonomyScore: latestRow.autonomy_score,
        learningScore: latestRow.learning_score,
        engagementScore: latestRow.engagement_score,
        organizationScore: latestRow.organization_score,
        communicationScore: latestRow.communication_score
      } : null
    };
  } catch (err: any) {
    console.error('Error getting customer evaluation summary in actions:', err);
    return { error: err.message || 'Erro ao carregar avaliações do cliente.' };
  }
}
