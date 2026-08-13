import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyPassword } from '@/lib/auth-utils';
import { signJWT } from '@/lib/jwt';
import {
  buildLoginKeys,
  checkLoginThrottle,
  registerLoginFailure,
  clearLoginFailures
} from '@/lib/login-rate-limit';

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'E-mail e senha são obrigatórios.' }, { status: 400 });
    }

    // Freio de força bruta ANTES de qualquer consulta: tentativa barrada não
    // deve custar ida ao banco nem cálculo de PBKDF2 (10.000 iterações), senão
    // o próprio limitador vira o vetor de sobrecarga que ele deveria conter.
    const throttleKeys = buildLoginKeys(request, email);
    const throttle = checkLoginThrottle(throttleKeys);
    if (throttle.blocked) {
      return NextResponse.json(
        { error: `Muitas tentativas. Tente novamente em ${throttle.retryAfterSeconds} segundo(s).` },
        { status: 429, headers: { 'Retry-After': String(throttle.retryAfterSeconds) } }
      );
    }

    // Buscar perfil no banco Postgres próprio. Permissões vêm do Perfil de
    // Acesso escolhido (access_profile_id), não mais de um join por nome de
    // role — dois usuários com o mesmo role podem ter perfis diferentes.
    const result = await query(
      `SELECT p.id, p.name, p.email, p.role, p.password, p.must_change_password,
              p.company_id, p.phone,
              -- Endereço da foto, não a foto: avatar_url guarda a imagem
              -- inteira em base64 (até 2,7 MB) e vinha na resposta do login.
              -- Ver app/api/users/[id]/avatar/route.ts.
              (p.avatar_url IS NOT NULL AND p.avatar_url <> '') AS has_avatar,
              p.view_all_company_tickets,
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
      // E-mail inexistente também conta: sem isso, dava para varrer quais
      // e-mails existem sem nunca acionar o freio. A mensagem é a mesma de
      // senha errada, de propósito.
      registerLoginFailure(throttleKeys);
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
      const after = registerLoginFailure(throttleKeys);
      if (after.blocked) {
        return NextResponse.json(
          { error: `Muitas tentativas. Tente novamente em ${after.retryAfterSeconds} segundo(s).` },
          { status: 429, headers: { 'Retry-After': String(after.retryAfterSeconds) } }
        );
      }
      return NextResponse.json({ error: 'Usuário ou senha incorretos.' }, { status: 401 });
    }

    if (user.is_active === false) {
      // Conta desativada NÃO limpa o contador: a senha até confere, mas manter
      // o freio evita usar esta resposta para confirmar senhas válidas.
      return NextResponse.json({ error: 'Este usuário está desativado. Entre em contato com o administrador.' }, { status: 403 });
    }

    // Senha certa e conta ativa: zera os contadores, para que quem só esqueceu
    // a senha não continue penalizado depois de acertar.
    clearLoginFailures(throttleKeys);

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
        avatarUrl: user.has_avatar ? `/api/users/${user.id}/avatar` : null,
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
