import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('token')?.value;
    const authenticatedUser = token ? await verifyJWT(token) : null;
    if (!authenticatedUser?.id) {
      return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
    }

    const { endpoint } = await request.json();
    if (!endpoint) {
      return NextResponse.json({ error: 'endpoint é obrigatório.' }, { status: 400 });
    }

    await query(
      'DELETE FROM public.push_subscriptions WHERE endpoint = $1 AND user_id = $2',
      [endpoint, authenticatedUser.id]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Erro ao remover assinatura push:', error);
    return NextResponse.json({ error: 'Erro ao remover assinatura push.' }, { status: 500 });
  }
}
