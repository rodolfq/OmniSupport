import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword } from '@/lib/auth-utils';
import { verifyJWT } from '@/lib/jwt';

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('token')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Sessao expirada. Faca login novamente.' }, { status: 401 });
    }

    const decoded = await verifyJWT(token);
    if (!decoded?.id) {
      return NextResponse.json({ error: 'Sessao invalida ou expirada.' }, { status: 401 });
    }

    const { password } = await request.json();

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Nova senha e obrigatoria.' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'A senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
    }

    const hashedPassword = hashPassword(password);
    const result = await query(
      `UPDATE public.profiles
       SET password = $1,
           must_change_password = false
       WHERE id = $2
       RETURNING id, name, email, role, company_id, phone, view_all_company_tickets, must_change_password, is_admin, lives_in_squad`,
      [hashedPassword, decoded.id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Usuario nao encontrado.' }, { status: 404 });
    }

    const user = result.rows[0];

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.company_id,
        phone: user.phone,
        viewAllCompanyTickets: user.view_all_company_tickets,
        mustChangePassword: user.must_change_password,
        isAdmin: user.is_admin,
        livesInSquad: user.lives_in_squad
      }
    });
  } catch (error) {
    console.error('Erro ao alterar senha:', error);
    return NextResponse.json({ error: 'Erro interno ao alterar senha.' }, { status: 500 });
  }
}
