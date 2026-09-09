import { NextResponse } from 'next/server';
import { requestPasswordReset } from '@/lib/services/password-reset-service';
import { EmailService } from '@/lib/services/email-service';
import { wrapEmailHtml } from '@/lib/email-templates';
import { checkLoginThrottle, registerLoginFailure } from '@/lib/login-rate-limit';

// Chaves próprias (prefixo reset-), não as de app/api/auth/login/route.ts —
// pedir redefinição de senha não deve nem sofrer nem causar bloqueio de
// login, são fluxos independentes. Reaproveita só o motor de bucket
// (lib/login-rate-limit.ts): a lógica de "5 tentativas, bloqueio dobrando"
// serve igual aqui, e criar uma segunda cópia divergiria com o tempo.
function buildResetKeys(request: Request, email: string): string[] {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip')?.trim() || 'desconhecido';
  const normalized = (email || '').trim().toLowerCase();
  return [`reset-ip:${ip}`, `reset-email:${normalized}`];
}

const GENERIC_MESSAGE = 'Se este e-mail estiver cadastrado, você vai receber um link para redefinir a senha em instantes.';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'E-mail é obrigatório.' }, { status: 400 });
    }

    const keys = buildResetKeys(request, email);
    const throttle = checkLoginThrottle(keys);
    if (throttle.blocked) {
      return NextResponse.json(
        { error: `Muitas tentativas. Tente novamente em ${throttle.retryAfterSeconds} segundo(s).` },
        { status: 429, headers: { 'Retry-After': String(throttle.retryAfterSeconds) } }
      );
    }
    // Toda chamada conta pro freio, ache ou não o e-mail — diferente do
    // login (só falha conta): aqui não existe "acerto" observável de fora,
    // e não contar quando o e-mail existe reabriria enumeration por outro
    // canal (custo/tempo de disparo do e-mail).
    registerLoginFailure(keys);

    const result = await requestPasswordReset(email);
    if (result) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
      const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(result.token)}`;
      const html = wrapEmailHtml({
        bodyHtml: `
          <p style="margin:0 0 16px;">Olá, ${result.name}.</p>
          <p style="margin:0 0 16px;">Recebemos um pedido para redefinir a senha da sua conta no SSX Desk. Clique no botão abaixo para escolher uma nova senha.</p>
          <p style="margin:0;font-size:12px;color:#6b7280;">Este link expira em 1 hora. Se você não pediu essa troca, pode ignorar este e-mail — sua senha continua a mesma.</p>
        `,
        ctaUrl: resetUrl,
        ctaLabel: 'Redefinir senha'
      });

      try {
        await EmailService.send(result.email, 'Redefinição de senha — SSX Desk', html);
      } catch (err) {
        // Falha de envio nunca aparece pro client (revelaria que o e-mail
        // existe) — fica só no log do servidor, mesmo padrão descrito no
        // CLAUDE.md seção 10 pra e-mail de automação.
        console.error('[forgot-password] Falha ao enviar e-mail de redefinição:', err);
      }
    }

    // Mesma resposta sempre, exista ou não o e-mail — enumeration-safe,
    // mesmo princípio já usado em app/api/auth/login/route.ts.
    return NextResponse.json({ success: true, message: GENERIC_MESSAGE });
  } catch (error) {
    console.error('Erro em forgot-password:', error);
    return NextResponse.json({ error: 'Erro interno do servidor.' }, { status: 500 });
  }
}
