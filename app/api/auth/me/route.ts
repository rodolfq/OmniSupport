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

    // Buscar perfil no Postgres próprio. Permissões vêm do Perfil de Acesso
    // escolhido (access_profile_id), não mais de um join por nome de role.
    const result = await query(
      `SELECT p.id, p.name, p.email, p.role, p.company_id, p.phone, p.avatar_url,
              p.view_all_company_tickets, p.must_change_password, p.is_admin, p.lives_in_squad,
              p.internal_team_ids, p.access_profile_id,
              COALESCE(rp.permissions, '{}'::text[]) AS permissions,
              COALESCE(
                (SELECT array_agg(it.id) FROM public.internal_teams it WHERE p.id = ANY(it.admin_ids)),
                '{}'::uuid[]
              ) AS admin_of_team_ids
       FROM public.profiles p
       LEFT JOIN public.role_permissions rp ON rp.id = p.access_profile_id
       WHERE p.id = $1`,
      [decoded.id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ user: null, error: 'Usuário não encontrado' }, { status: 401 });
    }

    const profile = result.rows[0];

    // Mesma regra do login: admin de equipe sempre enxerga Equipe e Perfil
    // de Acesso, independente do que o perfil de acesso dele concede.
    const effectivePermissions: string[] = profile.permissions || [];
    if ((profile.admin_of_team_ids || []).length > 0) {
      for (const p of ['team:read', 'settings:write']) {
        if (!effectivePermissions.includes(p)) effectivePermissions.push(p);
      }
    }

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
        permissions: effectivePermissions,
        companyId: profile.company_id,
        phone: profile.phone,
        avatarUrl: profile.avatar_url,
        viewAllCompanyTickets: profile.view_all_company_tickets,
        mustChangePassword: profile.must_change_password,
        isAdmin: profile.is_admin,
        livesInSquad: profile.lives_in_squad,
        internalTeamIds: profile.internal_team_ids || [],
        accessProfileId: profile.access_profile_id,
        adminOfTeamIds: profile.admin_of_team_ids || [],
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
