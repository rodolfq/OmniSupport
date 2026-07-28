import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword } from '@/lib/auth-utils';
import { getCurrentActionUser, assertUserManageable } from '@/app/actions';

// Papéis "de equipe" — os únicos que hoje consomem GET/POST desta rota
// (Canais de Atendimento, Filas, Hotfixes, vínculo de contato). Cliente/
// Funcionário nunca deveriam enxergar a lista completa de usuários do
// sistema nem criar contas por aqui.
const STAFF_ROLES = ['Administrador', 'Equipe', 'Time Interno'];

export async function GET(request: Request) {
  const actor = await getCurrentActionUser();
  if (!actor || !STAFF_ROLES.includes(actor.role)) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'all';

  try {
    if (type === 'employees') {
      const res = await query(
        "SELECT id, name, email, role, company_id, phone FROM public.profiles WHERE role = 'Cliente' OR role = 'Funcionário'"
      );
      return NextResponse.json(res.rows.map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        companyId: r.company_id,
        phone: r.phone
      })));
    } else if (type === 'analysts') {
      const res = await query(
        "SELECT id, name, email, role, company_id, phone, avatar_url, internal_team_ids FROM public.profiles WHERE role IN ('Administrador', 'Equipe', 'Time Interno')"
      );
      return NextResponse.json(res.rows.map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        companyId: r.company_id,
        phone: r.phone,
        avatarUrl: r.avatar_url,
        internalTeamIds: r.internal_team_ids
      })));
    } else {
      const res = await query(
        "SELECT id, name, email, role, company_id, phone, view_all_company_tickets, must_change_password, is_admin, avatar_url, internal_team_ids, is_active FROM public.profiles"
      );
      return NextResponse.json(res.rows.map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        companyId: r.company_id,
        phone: r.phone,
        viewAllCompanyTickets: r.view_all_company_tickets,
        mustChangePassword: r.must_change_password,
        isAdmin: r.is_admin,
        avatarUrl: r.avatar_url,
        internalTeamIds: r.internal_team_ids,
        isActive: r.is_active
      })));
    }
  } catch (error: any) {
    console.error('Error fetching users in API:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getCurrentActionUser();
  if (!actor || !STAFF_ROLES.includes(actor.role)) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'create') {
      const { email, name, companyId, phones } = body;
      // Endpoint simplificado — só cria contato de empresa-cliente (usado
      // hoje por "Vincular contato" no chat). Promover alguém a
      // Administrador/Equipe/Time Interno passa exclusivamente pelo fluxo
      // dedicado (createUser em app/actions.ts, usado pela tela Equipe),
      // nunca por aqui — por isso o role vindo do body é ignorado.
      const safeRole = body.role === 'Cliente' ? 'Cliente' : 'Funcionário';
      const defaultPassword = Math.random().toString(36).slice(-8);
      const hashedPassword = hashPassword(defaultPassword);
      const phone = phones?.[0] || null;

      const res = await query(
        `INSERT INTO public.profiles (email, password, name, role, company_id, phone, is_admin, lives_in_squad)
         VALUES ($1, $2, $3, $4, $5, $6, FALSE, FALSE)
         RETURNING id, name, email, role`,
        [email, hashedPassword, name, safeRole, companyId || null, phone]
      );

      const newUser = res.rows[0];

      return NextResponse.json({
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        companyId,
        phone,
        password: defaultPassword // Retorna em texto plano apenas na criação para exibição do convite
      });
    }

    return NextResponse.json({ error: 'Action não suportada.' }, { status: 400 });
  } catch (error: any) {
    console.error('Error in users POST:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await getCurrentActionUser();
    if (!actor) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const { user } = await request.json();
    if (!user || !user.id) {
      return NextResponse.json({ error: 'ID do usuário é obrigatório.' }, { status: 400 });
    }

    let target: any;
    if (actor.id === user.id) {
      const res = await query('SELECT role, company_id, internal_team_ids, is_admin FROM public.profiles WHERE id = $1', [user.id]);
      target = res.rows[0];
      if (!target) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    } else {
      const check = await assertUserManageable(actor, user.id);
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 403 });
      target = check.target;
    }

    // role / is_admin / equipes internas / empresa só mudam de verdade se
    // quem está editando for Administrador do sistema — autoedição (ou
    // gerenciar um Funcionário/Cliente da própria empresa) nunca deveria
    // conseguir promover ninguém, nem a si mesmo, a um papel mais
    // privilegiado. Sem essa trava, qualquer usuário autenticado podia virar
    // Administrador só chamando este endpoint com {role:'Administrador'}.
    const isSystemAdmin = actor.role === 'Administrador';
    const role = isSystemAdmin ? (user.role ?? target.role) : target.role;
    const isAdmin = isSystemAdmin ? (user.isAdmin ?? target.is_admin) : target.is_admin;
    const internalTeamIds = isSystemAdmin ? (user.internalTeamIds ?? target.internal_team_ids) : target.internal_team_ids;
    const companyId = isSystemAdmin ? (user.companyId ?? target.company_id) : target.company_id;

    await query(
      `UPDATE public.profiles
       SET name = COALESCE($1, name),
           email = COALESCE($2, email),
           role = $3,
           company_id = $4,
           phone = $5,
           must_change_password = COALESCE($6, must_change_password),
           view_all_company_tickets = COALESCE($7, view_all_company_tickets),
           is_admin = $8,
           avatar_url = $9,
           internal_team_ids = $10,
           is_active = COALESCE($11, is_active)
       WHERE id = $12`,
      [
        user.name,
        user.email,
        role,
        companyId || null,
        user.phone || null,
        user.mustChangePassword,
        user.viewAllCompanyTickets,
        isAdmin,
        user.avatarUrl || null,
        internalTeamIds || '{}',
        user.isActive,
        user.id
      ]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in users PUT:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const actor = await getCurrentActionUser();
  if (!actor) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'ID do usuário é obrigatório.' }, { status: 400 });
  }

  if (actor.id === id) {
    return NextResponse.json({ error: 'Você não pode excluir sua própria conta.' }, { status: 400 });
  }

  const check = await assertUserManageable(actor, id);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 403 });
  }

  try {
    await query('DELETE FROM public.profiles WHERE id = $1', [id]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in users DELETE:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
