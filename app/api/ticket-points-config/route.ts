import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { validateTicketConfigInput } from '@/lib/ticket-points';
import { getTicketConfig, saveTicketConfig, getTicketConfigHistory } from '@/lib/services/ticket-points-service';

// Configuração de metas e pontos de chamados (Configurações > Pontuação de Chamados).
// Mesma permissão da configuração do chat (reports:ranking_config). Administrador tem sempre.

const PERMISSION = 'reports:ranking_config';

async function getActor(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  if (!token) return null;
  const decoded = await verifyJWT(token);
  if (!decoded?.id) return null;
  const result = await query(
    `SELECT p.id, p.name, p.role, COALESCE(rp.permissions, '{}'::text[]) AS permissions
     FROM public.profiles p
     LEFT JOIN public.role_permissions rp ON rp.id = p.access_profile_id
     WHERE p.id = $1`,
    [decoded.id]
  );
  return result.rows[0] || null;
}

function canConfig(actor: any): boolean {
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes(PERMISSION);
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    if (!actor || !canConfig(actor)) {
      return NextResponse.json({ error: 'Você não tem permissão para ver esta configuração.' }, { status: 403 });
    }
    if (new URL(request.url).searchParams.get('history') === '1') {
      return NextResponse.json({ entries: await getTicketConfigHistory(30) });
    }
    const record = await getTicketConfig();
    return NextResponse.json({ config: record.config, updatedAt: record.updatedAt, isDefault: record.isDefault });
  } catch (error: any) {
    console.error('[ticket-points-config] Erro no GET:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const actor = await getActor(request);
    if (!actor || !canConfig(actor)) {
      return NextResponse.json({ error: 'Você não tem permissão para alterar a pontuação de chamados.' }, { status: 403 });
    }
    const body = await request.json().catch(() => null);
    const parsed = validateTicketConfigInput(body?.config);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const saved = await saveTicketConfig(parsed.value, { id: actor.id, name: actor.name ?? 'Usuário' });
    return NextResponse.json({ config: saved.config, updatedAt: saved.updatedAt, isDefault: saved.isDefault });
  } catch (error: any) {
    if (error?.code === '42P01') {
      return NextResponse.json({ error: 'A configuração ainda não está disponível neste banco (migração pendente).' }, { status: 503 });
    }
    console.error('[ticket-points-config] Erro no PUT:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
