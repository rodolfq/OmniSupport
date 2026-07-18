import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword } from '@/lib/auth-utils';

export async function GET(request: Request) {
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
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'create') {
      const { email, name, role, companyId, phones } = body;
      const defaultPassword = Math.random().toString(36).slice(-8);
      const hashedPassword = hashPassword(defaultPassword);
      const phone = phones?.[0] || null;

      const res = await query(
        `INSERT INTO public.profiles (email, password, name, role, company_id, phone, is_admin, lives_in_squad)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, email, role`,
        [
          email, 
          hashedPassword, 
          name, 
          role || 'Cliente', 
          companyId || null, 
          phone,
          role === 'Administrador',
          role === 'Administrador' || role === 'Equipe'
        ]
      );
      
      const newUser = res.rows[0];
      
      // Auto-inserir status do analista se for parte do suporte
      if (role === 'Administrador' || role === 'Equipe') {
        await query(
          'INSERT INTO public.analyst_status (user_id, is_online, current_load) VALUES ($1, false, 0) ON CONFLICT DO NOTHING',
          [newUser.id]
        );
      }

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
    const { user } = await request.json();
    if (!user || !user.id) {
      return NextResponse.json({ error: 'ID do usuário é obrigatório.' }, { status: 400 });
    }

    await query(
      `UPDATE public.profiles
       SET name = COALESCE($1, name),
           email = COALESCE($2, email),
           role = COALESCE($3, role),
           company_id = $4,
           phone = $5,
           must_change_password = COALESCE($6, must_change_password),
           view_all_company_tickets = COALESCE($7, view_all_company_tickets),
           is_admin = COALESCE($8, is_admin),
           avatar_url = $9,
           internal_team_ids = $10,
           is_active = COALESCE($11, is_active)
       WHERE id = $12`,
      [
        user.name,
        user.email,
        user.role,
        user.companyId || null,
        user.phone || null,
        user.mustChangePassword,
        user.viewAllCompanyTickets,
        user.isAdmin,
        user.avatarUrl || null,
        user.internalTeamIds || '{}',
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
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'ID do usuário é obrigatório.' }, { status: 400 });
  }

  try {
    await query('DELETE FROM public.profiles WHERE id = $1', [id]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in users DELETE:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
