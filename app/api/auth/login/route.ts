import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyPassword } from '@/lib/auth-utils';
import { signJWT } from '@/lib/jwt';

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'E-mail e senha são obrigatórios.' }, { status: 400 });
    }

    // Buscar perfil no banco Postgres próprio. Permissões vêm do Perfil de
    // Acesso escolhido (access_profile_id), não mais de um join por nome de
    // role — dois usuários com o mesmo role podem ter perfis diferentes.
    const result = await query(
      `SELECT p.id, p.name, p.email, p.role, p.password, p.must_change_password,
              p.company_id, p.phone, p.avatar_url, p.view_all_company_tickets,
              p.is_admin, p.lives_in_squad, p.is_active, p.internal_team_ids, p.access_profile_id,
              COALESCE(rp.permissions, '{}'::text[]) AS permissions,
              COALESCE(
                (SELECT array_agg(it.id) FROM public.internal_teams it WHERE p.id = ANY(it.admin_ids)),
                '{}'::uuid[]
              ) AS admin_of_team_ids
       FROM public.profiles p
       LEFT JOIN public.role_permissions rp ON rp.id = p.access_profile_id
       WHERE p.email = $1`,
      [email]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Usuário ou senha incorretos.' }, { status: 401 });
    }

    const user = result.rows[0];

    // Quem administra ao menos uma equipe interna sempre enxerga Equipe e
    // Perfil de Acesso, mesmo que o perfil de acesso dele não inclua essas
    // permissões — o acesso real a QUAIS usuários/perfis ele edita continua
    // escopado à(s) própria(s) equipe(s) nas actions do servidor.
    const effectivePermissions: string[] = user.permissions || [];
    if ((user.admin_of_team_ids || []).length > 0) {
      for (const p of ['team:read', 'settings:write']) {
        if (!effectivePermissions.includes(p)) effectivePermissions.push(p);
      }
    }

    // Verificar a senha digitada contra o hash armazenado
    const isPasswordValid = verifyPassword(password, user.password);
    if (!isPasswordValid) {
      return NextResponse.json({ error: 'Usuário ou senha incorretos.' }, { status: 401 });
    }

    if (user.is_active === false) {
      return NextResponse.json({ error: 'Este usuário está desativado. Entre em contato com o administrador.' }, { status: 403 });
    }

    // Assinar token JWT
    const token = await signJWT({
      id: user.id,
      email: user.email,
      role: user.role
    });

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: effectivePermissions,
        companyId: user.company_id,
        phone: user.phone,
        avatarUrl: user.avatar_url,
        viewAllCompanyTickets: user.view_all_company_tickets,
        isAdmin: user.is_admin,
        livesInSquad: user.lives_in_squad,
        internalTeamIds: user.internal_team_ids || [],
        accessProfileId: user.access_profile_id,
        adminOfTeamIds: user.admin_of_team_ids || [],
        mustChangePassword: user.must_change_password
      }
    });

    // Configurar o cookie seguro HTTP-only na resposta
    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 86400, // 1 dia
      path: '/'
    });

    return response;
  } catch (error: any) {
    console.error('Erro na rota de login:', error);
    return NextResponse.json({ error: 'Erro interno do servidor.' }, { status: 500 });
  }
}
