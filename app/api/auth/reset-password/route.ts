import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword } from '@/lib/auth-utils';
import { consumePasswordResetToken } from '@/lib/services/password-reset-service';

export async function POST(request: Request) {
  try {
    const { token, password, confirmPassword } = await request.json();

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Link inválido.' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Nova senha é obrigatória.' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'A senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
    }
    if (confirmPassword !== undefined && password !== confirmPassword) {
      return NextResponse.json({ error: 'As senhas não coincidem.' }, { status: 400 });
    }

    // Consome DEPOIS de validar a senha — uma tentativa com senha inválida
    // (curta demais, confirmação divergente) não queima o link de uso único;
    // a pessoa pode corrigir e tentar de novo com o mesmo e-mail.
    const consumed = await consumePasswordResetToken(token);
    if (!consumed) {
      return NextResponse.json({ error: 'Link inválido ou expirado. Solicite um novo.' }, { status: 400 });
    }

    const hashed = hashPassword(password);
    await query(
      `UPDATE public.profiles SET password = $1, must_change_password = false WHERE id = $2`,
      [hashed, consumed.profileId]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Erro em reset-password:', error);
    return NextResponse.json({ error: 'Erro interno do servidor.' }, { status: 500 });
  }
}
