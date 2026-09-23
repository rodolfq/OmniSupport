import { NextRequest, NextResponse } from 'next/server';
import { EmailService } from '@/lib/services/email-service';
import { getCurrentActionUser, getActorEffectivePermissions } from '@/lib/server-auth';

// Achado em 2026-09-23 (varredura de permissões): esta rota não checava
// NADA além de sessão válida — qualquer usuário logado, de qualquer papel,
// disparava e-mail de teste usando as credenciais SMTP configuradas.
async function canTestEmail(): Promise<boolean> {
  const actor = await getCurrentActionUser();
  if (!actor) return false;
  if (actor.role === 'Administrador') return true;
  const permissions = await getActorEffectivePermissions(actor.id);
  return permissions.includes('settings:email') || permissions.includes('settings:write') || permissions.includes('settings:system');
}

export async function POST(request: NextRequest) {
  if (!(await canTestEmail())) {
    return NextResponse.json({ error: 'Você não tem permissão para testar o e-mail.' }, { status: 403 });
  }

  const { to } = await request.json();

  try {
    await EmailService.sendTest(to);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[api/email/test] Failed:', { to, message: error?.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
