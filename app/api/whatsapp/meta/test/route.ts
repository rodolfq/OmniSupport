import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/jwt';
import { query } from '@/lib/db';
import { MetaWhatsAppService } from '@/lib/services/meta-whatsapp-service';

// Autenticação por cookie de sessão (igual ao resto do portal) — mesmo
// padrão de app/api/integrations/keys/route.ts. Precisa de
// whatsapp:manage porque o teste usa o access_token já salvo no servidor
// (nunca reenviado pelo client) pra chamar a Graph API de verdade.
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

function canManageWhatsapp(actor: any) {
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes('whatsapp:manage');
}

export async function POST(request: NextRequest) {
  const actor = await getActor(request);
  if (!actor) return NextResponse.json({ error: 'Sessão inválida ou expirada.' }, { status: 401 });
  if (!canManageWhatsapp(actor)) return NextResponse.json({ error: 'Sem permissão para gerenciar WhatsApp.' }, { status: 403 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const { instanceId } = body;
  if (!instanceId) {
    return NextResponse.json({ error: 'instanceId é obrigatório.' }, { status: 400 });
  }

  try {
    const data = await MetaWhatsAppService.testConnection(instanceId);
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Falha ao testar conexão.' }, { status: 400 });
  }
}
