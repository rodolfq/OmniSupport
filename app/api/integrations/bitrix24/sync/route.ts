import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { syncCompaniesFromBitrix24, Bitrix24NotConfiguredError } from '@/lib/services/bitrix24-service';

// Sincronização manual de empresas do Bitrix24 — botão "Sincronizar
// Bitrix24" em app/(portal)/customers/page.tsx. Mesma permissão de quem já
// pode editar empresa (CUSTOMERS_WRITE), não é uma permissão nova — trazer
// empresa do CRM é a mesma responsabilidade de já poder criar/editar
// empresa aqui.

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
      return NextResponse.json({ error: 'Você não tem permissão para sincronizar empresas.' }, { status: 403 });
    }

    const result = await syncCompaniesFromBitrix24();
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[integrations/bitrix24/sync] Erro no POST:', error);

    if (error instanceof Bitrix24NotConfiguredError) {
      return NextResponse.json(
        { error: 'Integração com o Bitrix24 ainda não configurada — falta BITRIX24_WEBHOOK_URL no .env do servidor.' },
        { status: 503 }
      );
    }

    return NextResponse.json({ error: `Falha ao sincronizar com o Bitrix24: ${error?.message || 'erro desconhecido'}` }, { status: 502 });
  }
}
