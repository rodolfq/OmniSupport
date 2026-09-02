import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { syncCompaniesFromSheet } from '@/lib/services/customer-sheet-service';

// Sincronização manual de empresas a partir da planilha de CS (Google
// Sheets) — botão "Importar Planilha" em app/(portal)/customers/page.tsx.
// Substitui o antigo sync do Bitrix24 pra empresas. Mesma permissão de quem
// já pode editar empresa (CUSTOMERS_WRITE) — não é permissão nova.

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
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes('customers:write');
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getActor(request);
    if (!actor || !isAuthorized(actor)) {
      return NextResponse.json({ error: 'Você não tem permissão para importar empresas.' }, { status: 403 });
    }

    const result = await syncCompaniesFromSheet();
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[integrations/customer-sheet/sync] Erro no POST:', error);
    return NextResponse.json({ error: `Falha ao importar a planilha: ${error?.message || 'erro desconhecido'}` }, { status: 502 });
  }
}
