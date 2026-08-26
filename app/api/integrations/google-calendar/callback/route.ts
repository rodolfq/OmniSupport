import { NextRequest, NextResponse } from 'next/server';
import { getCurrentActionUser } from '@/lib/server-auth';
import { connectGoogleCalendar, resolvePublicOrigin, resolveRedirectUri } from '@/lib/services/google-calendar-service';

/**
 * Endpoint fixo, registrado como "URI de redirecionamento" no Google Cloud
 * Console (não pode ter query param de ação como o resto das rotas deste
 * projeto — o Google chama exatamente esta URL de volta).
 */

const STATE_COOKIE = 'google_calendar_oauth_state';
const SETTINGS_PATH = '/settings';

function redirectToSettings(request: NextRequest, status: 'connected' | 'error', message?: string) {
  // `resolvePublicOrigin`, não `request.url` — ver o porquê em
  // google-calendar-service.ts (o host que o Next calcula é "0.0.0.0" nesse
  // ambiente Docker, um endereço que o navegador não consegue nem abrir).
  const url = new URL(SETTINGS_PATH, resolvePublicOrigin(request.headers));
  url.searchParams.set('tab', 'notifications');
  url.searchParams.set('google_calendar', status);
  if (message) url.searchParams.set('google_calendar_error', message);

  const response = NextResponse.redirect(url);
  response.cookies.delete(STATE_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const googleError = request.nextUrl.searchParams.get('error');

  if (googleError) return redirectToSettings(request, 'error', googleError);

  const actor = await getCurrentActionUser();
  if (!actor) return redirectToSettings(request, 'error', 'sessão expirada, faça login de novo');

  const cookieState = request.cookies.get(STATE_COOKIE)?.value;
  if (!code || !state || !cookieState || state !== cookieState || !state.startsWith(`${actor.id}.`)) {
    return redirectToSettings(request, 'error', 'validação de segurança falhou, tente novamente');
  }

  try {
    const redirectUri = resolveRedirectUri(request.headers);
    await connectGoogleCalendar(actor.id, code, redirectUri);
    return redirectToSettings(request, 'connected');
  } catch (err: any) {
    console.error('[google-calendar] Falha no callback OAuth:', err);
    return redirectToSettings(request, 'error', err?.message || 'erro ao conectar');
  }
}
