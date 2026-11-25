import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentActionUser } from '@/lib/server-auth';
import { sanitizeEmailPrefs } from '@/lib/email-notification-prefs';

/**
 * Preferências de notificação por e-mail do PRÓPRIO usuário (2026-11-25).
 * Sempre a pessoa da sessão — nunca um id vindo do corpo. Sem permissão
 * própria: é configuração pessoal, como o restante de Configurações >
 * Notificações. Chave ausente = ligada (ver lib/email-notification-prefs.ts).
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const actor = await getCurrentActionUser();
  if (!actor) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
  try {
    const res = await query('SELECT email, email_notification_prefs FROM public.profiles WHERE id = $1', [actor.id]);
    return NextResponse.json({
      prefs: sanitizeEmailPrefs(res.rows[0]?.email_notification_prefs),
      email: res.rows[0]?.email || null,
      available: true,
    });
  } catch (err: any) {
    // Banco sem a migration ainda: mostra tudo ligado e avisa que não salva.
    if (err?.code === '42703') return NextResponse.json({ prefs: {}, email: null, available: false });
    console.error('[email-notification-prefs] GET', err);
    return NextResponse.json({ error: 'Erro ao carregar as preferências.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const actor = await getCurrentActionUser();
  if (!actor) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 }); }
  const prefs = sanitizeEmailPrefs(body?.prefs);
  try {
    // Mescla com o que já estava gravado: uma chave enviada não apaga as outras.
    const res = await query(
      `UPDATE public.profiles
          SET email_notification_prefs = COALESCE(email_notification_prefs, '{}'::jsonb) || $2::jsonb
        WHERE id = $1
        RETURNING email_notification_prefs`,
      [actor.id, JSON.stringify(prefs)]
    );
    return NextResponse.json({ prefs: sanitizeEmailPrefs(res.rows[0]?.email_notification_prefs) });
  } catch (err: any) {
    if (err?.code === '42703') {
      return NextResponse.json({ error: 'Esta opção ainda não está disponível neste ambiente (falta aplicar a atualização do banco).' }, { status: 503 });
    }
    console.error('[email-notification-prefs] PUT', err);
    return NextResponse.json({ error: 'Erro ao salvar as preferências.' }, { status: 500 });
  }
}
