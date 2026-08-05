import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { getEffectiveAssistantConfig } from '@/lib/services/ai-assistant-config-service';

// Qual ícone o widget (components/ai-assistant-widget.tsx) deve mostrar —
// precisa ser lido antes mesmo do painel abrir (botão flutuante), então não
// dá pra reaproveitar a Server Action getAssistantConfig (essa é restrita a
// quem administra o Agente de IA). Mesmo padrão/permissão de
// embedding-status/route.ts: qualquer usuário com acesso ao agente pode ler,
// não é operação sensível.

async function getActor(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  if (!token) return null;
  const decoded = await verifyJWT(token);
  if (!decoded?.id) return null;
  const result = await query(
    `SELECT p.id, p.role, COALESCE(rp.permissions, '{}'::text[]) AS permissions
     FROM public.profiles p
     LEFT JOIN public.role_permissions rp ON rp.id = p.access_profile_id
     WHERE p.id = $1`,
    [decoded.id]
  );
  return result.rows[0] || null;
}

function isAuthorized(actor: any): boolean {
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes('ai:assistant');
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    if (!actor || !isAuthorized(actor)) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
    }

    const { avatarSource, avatarCrop } = await getEffectiveAssistantConfig();
    return NextResponse.json({ avatarSource, crop: avatarCrop });
  } catch (error: any) {
    console.error('[ai-assistant/avatar] Erro no GET:', error);
    return NextResponse.json({ error: 'Falha ao consultar o ícone do Agente de IA.' }, { status: 500 });
  }
}
