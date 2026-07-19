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

    const { subscription } = await request.json();
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json({ error: 'Assinatura push inválida.' }, { status: 400 });
    }

    await query(
      `INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         user_agent = EXCLUDED.user_agent,
         last_seen_at = NOW()`,
      [
        authenticatedUser.id,
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth,
        request.headers.get('user-agent') || null
      ]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Erro ao salvar assinatura push:', error);
    return NextResponse.json({ error: 'Erro ao salvar assinatura push.' }, { status: 500 });
  }
}
