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
      `SELECT p.id, p.name, p.email, p.role, p.company_id, p.phone, p.avatar_url,
              p.view_all_company_tickets, p.must_change_password, p.is_admin, p.lives_in_squad,
              COALESCE(rp.permissions, '{}'::text[]) AS permissions
       FROM public.profiles p
       LEFT JOIN public.role_permissions rp ON rp.role = p.role
       WHERE p.id = $1`,
      [decoded.id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ user: null, error: 'Usuário não encontrado' }, { status: 401 });
    }

    const profile = result.rows[0];

    // Buscar status de analista
    const statusResult = await query(
      'SELECT status, current_reason, last_active FROM public.analyst_status WHERE user_id = $1',
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
        permissions: profile.permissions || [],
        companyId: profile.company_id,
        phone: profile.phone,
        avatarUrl: profile.avatar_url,
        viewAllCompanyTickets: profile.view_all_company_tickets,
        mustChangePassword: profile.must_change_password,
        isAdmin: profile.is_admin,
        livesInSquad: profile.lives_in_squad,
        status: status,
        statusReason: dbStatus?.current_reason || null,
        statusSince: dbStatus?.last_active || null
      }
    });
  } catch (error: any) {
    console.error('Erro na rota /api/auth/me:', error);
    return NextResponse.json({ user: null, error: 'Erro interno do servidor' }, { status: 500 });
  }
}
