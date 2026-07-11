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

    // Buscar perfil no banco Postgres próprio
    const result = await query(
      'SELECT id, name, email, role, password, must_change_password, company_id, phone, avatar_url, view_all_company_tickets, is_admin, lives_in_squad FROM public.profiles WHERE email = $1',
      [email]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Usuário ou senha incorretos.' }, { status: 401 });
    }

    const user = result.rows[0];

    // Verificar a senha digitada contra o hash armazenado
    const isPasswordValid = verifyPassword(password, user.password);
    if (!isPasswordValid) {
      return NextResponse.json({ error: 'Usuário ou senha incorretos.' }, { status: 401 });
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
        companyId: user.company_id,
        phone: user.phone,
        avatarUrl: user.avatar_url,
        viewAllCompanyTickets: user.view_all_company_tickets,
        isAdmin: user.is_admin,
        livesInSquad: user.lives_in_squad,
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
