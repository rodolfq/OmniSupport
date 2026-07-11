import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/jwt';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('token')?.value;

    if (!token) {
      return NextResponse.json({ user: null, error: 'Sem sessão ativa' }, { status: 401 });
    }

    // Verificar JWT
    const decoded = await verifyJWT(token);
    if (!decoded || !decoded.id) {
      return NextResponse.json({ user: null, error: 'Sessão inválida ou expirada' }, { status: 401 });
    }

    // Buscar perfil no Postgres próprio
    const result = await query(
      'SELECT id, name, email, role, company_id, phone, avatar_url, view_all_company_tickets, must_change_password, is_admin, lives_in_squad FROM public.profiles WHERE id = $1',
      [decoded.id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ user: null, error: 'Usuário não encontrado' }, { status: 401 });
    }

    const profile = result.rows[0];

    // Buscar status de analista
    const statusResult = await query(
      'SELECT status, current_reason FROM public.analyst_status WHERE user_id = $1',
      [decoded.id]
    );
    const dbStatus = statusResult.rowCount > 0 ? statusResult.rows[0] : null;
    const status = dbStatus?.status || 'online';

    return NextResponse.json({
      user: {
        id: profile.id,
        email: profile.email,
        name: profile.name,
        role: profile.role,
        companyId: profile.company_id,
        phone: profile.phone,
        avatarUrl: profile.avatar_url,
        viewAllCompanyTickets: profile.view_all_company_tickets,
        mustChangePassword: profile.must_change_password,
        isAdmin: profile.is_admin,
        livesInSquad: profile.lives_in_squad,
        status: status,
        statusReason: dbStatus?.current_reason || null
      }
    });
  } catch (error: any) {
    console.error('Erro na rota /api/auth/me:', error);
    return NextResponse.json({ user: null, error: 'Erro interno do servidor' }, { status: 500 });
  }
}
