import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getCurrentActionUser } from '@/lib/server-auth';
import {
  buildAuthUrl,
  resolveRedirectUri,
  getConnectionStatus,
  disconnectGoogleCalendar,
  GoogleCalendarNotConfiguredError
} from '@/lib/services/google-calendar-service';

/** Curta duração (10 min é sobra pra alguém completar o consentimento no
 * Google) — só protege o ida-e-volta do OAuth, não é a sessão do SSX Desk. */
const STATE_COOKIE = 'google_calendar_oauth_state';
const STATE_MAX_AGE_SECONDS = 600;

export async function GET(request: NextRequest) {
  const actor = await getCurrentActionUser();
  if (!actor) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const action = request.nextUrl.searchParams.get('action');

  if (action === 'status') {
    return NextResponse.json(await getConnectionStatus(actor.id));
  }

  if (action === 'connect') {
    try {
      const redirectUri = resolveRedirectUri(request.headers);
      // O state liga a volta do Google a ESTE pedido (dono + nonce contra
      // CSRF) — mas quem de fato decide a quem a conexão pertence é sempre o
      // cookie de sessão normal, lido de novo no callback. O state sozinho
      // nunca autoriza nada.
      const nonce = crypto.randomBytes(16).toString('hex');
      const state = `${actor.id}.${nonce}`;

      const response = NextResponse.redirect(buildAuthUrl(state, redirectUri));
      response.cookies.set(STATE_COOKIE, state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: STATE_MAX_AGE_SECONDS
      });
      return response;
    } catch (err: any) {
      if (err instanceof GoogleCalendarNotConfiguredError) {
        return NextResponse.json({ error: err.message }, { status: 501 });
      }
      throw err;
    }
  }

  return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const actor = await getCurrentActionUser();
  if (!actor) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const body = await request.json().catch(() => ({}));

  if (body.action === 'disconnect') {
    await disconnectGoogleCalendar(actor.id);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
}
