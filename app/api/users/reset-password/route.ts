import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword } from '@/lib/auth-utils';
import { verifyJWT } from '@/lib/jwt';

function generateTemporaryPassword() {
  return crypto.randomBytes(6).toString('base64url');
}

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

    const actorResult = await query(
      `SELECT p.role, COALESCE(rp.permissions, '{}'::text[]) AS permissions
       FROM public.profiles p
       LEFT JOIN public.role_permissions rp ON rp.id = p.access_profile_id
       WHERE p.id = $1`,
      [decoded.id]
    );

    if (actorResult.rowCount === 0) {
      return NextResponse.json({ error: 'Usuario autenticado nao encontrado.' }, { status: 401 });
    }

    const actor = actorResult.rows[0];
    const isFullAdmin = actor.role === 'Administrador';
    // Achado em 2026-09-23 (varredura de permissões): esta rota checava só
    // customers:write (pensada pra gerenciar empresa-cliente), descasada da
    // tela de Equipe, que libera o botão por team:write/admin de equipe — um
    // admin de equipe via "Redefinir Senha" e apanhava 403 pra qualquer alvo
    // que não fosse Cliente/Funcionário. users:reset_password é a permissão
    // dedicada daqui pra frente (cobre os dois domínios, decisão do usuário:
    // uma só, sem separar por tipo de conta) — customers:write/team:write
    // continuam valendo também, só para não tirar de quem já reiniciava
    // senha por uma delas hoje (perfis "Suporte"/"Gestor", ver
    // components/permissions-content.tsx).
    const permissions: string[] = actor.permissions || [];
    const hasResetPasswordPermission = permissions.includes('users:reset_password')
      || permissions.includes('customers:write')
      || permissions.includes('team:write');

    if (!isFullAdmin && !hasResetPasswordPermission) {
      return NextResponse.json({ error: 'Voce nao tem permissao para reiniciar senhas.' }, { status: 403 });
    }

    const { userId, password } = await request.json();

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'ID do usuario e obrigatorio.' }, { status: 400 });
    }

    // Mesmo assim, ação mais sensível do sistema — quem não é Administrador
    // de verdade nunca reinicia a senha de um Administrador (mesma regra de
    // assertUserManageable em lib/server-auth.ts).
    if (!isFullAdmin) {
      const targetResult = await query('SELECT role FROM public.profiles WHERE id = $1', [userId]);
      const targetRole = targetResult.rows[0]?.role;
      if (targetRole === 'Administrador') {
        return NextResponse.json({ error: 'Voce nao pode reiniciar a senha de um Administrador.' }, { status: 403 });
      }
    }

    if (password !== undefined && (typeof password !== 'string' || password.length < 6)) {
      return NextResponse.json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
    }

    const passwordToSave = password || generateTemporaryPassword();
    const isTemporaryPassword = !password;
    const hashedPassword = hashPassword(passwordToSave);

    const result = await query(
      `UPDATE public.profiles
       SET password = $1,
           must_change_password = $2
       WHERE id = $3
       RETURNING id`,
      [hashedPassword, isTemporaryPassword, userId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Usuario nao encontrado.' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      password: isTemporaryPassword ? passwordToSave : undefined
    });
  } catch (error) {
    console.error('Erro ao reiniciar senha:', error);
    return NextResponse.json({ error: 'Erro interno ao reiniciar senha.' }, { status: 500 });
  }
}
