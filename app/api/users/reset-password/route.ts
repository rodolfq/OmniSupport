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
      'SELECT role, is_admin FROM public.profiles WHERE id = $1',
      [decoded.id]
    );

    if (actorResult.rowCount === 0) {
      return NextResponse.json({ error: 'Usuario autenticado nao encontrado.' }, { status: 401 });
    }

    const actor = actorResult.rows[0];
    const canResetPassword = actor.is_admin || ['Admin', 'Administrador'].includes(actor.role);

    if (!canResetPassword) {
      return NextResponse.json({ error: 'Voce nao tem permissao para reiniciar senhas.' }, { status: 403 });
    }

    const { userId, password } = await request.json();

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'ID do usuario e obrigatorio.' }, { status: 400 });
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
