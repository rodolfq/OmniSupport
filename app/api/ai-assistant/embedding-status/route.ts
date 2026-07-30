import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { getEmbeddingQueueStatus } from '@/lib/services/embedding-service';

// Status de progresso da indexação (fila de embeddings) — mostrado no
// widget do Agente de IA (components/ai-assistant-widget.tsx) pra quem tem
// acesso ao agente entender por que uma busca semântica pode não achar
// mensagens muito recentes/histórico ainda não processado. Mesma
// permissão do agente — não é operação sensível, só leitura de contagem.

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

    const status = await getEmbeddingQueueStatus();
    return NextResponse.json(status);
  } catch (error: any) {
    console.error('[ai-assistant/embedding-status] Erro no GET:', error);
    return NextResponse.json({ error: 'Falha ao consultar status da indexação.' }, { status: 500 });
  }
}
