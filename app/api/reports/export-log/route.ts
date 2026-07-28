import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { logAudit } from '@/lib/audit-log';

// Etapa 9 do roadmap "Time x Gerencial" — registra em audit_log quem
// exportou o quê. O arquivo em si (CSV/PDF) é gerado 100% no navegador, a
// partir de dado que a tela já buscou com reports:read; esta rota não
// serve o arquivo, só grava a auditoria — é o único ponto onde
// reports:export é de fato aplicado no servidor (o botão de exportar na
// tela é conveniência, não barreira de dado, ver plano da Etapa 9).

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

function canExport(actor: any): boolean {
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes('reports:export');
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getActor(request);
    if (!canExport(actor)) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
    }

    const body = await request.json();
    const { reportId, reportLabel, format, filter } = body || {};
    if (!reportId || !reportLabel || (format !== 'csv' && format !== 'pdf')) {
      return NextResponse.json({ error: 'reportId, reportLabel e format (csv|pdf) são obrigatórios.' }, { status: 400 });
    }

    await logAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'export',
      entityType: 'report',
      entityId: reportId,
      entityLabel: reportLabel,
      changes: { format, filter: filter ?? null }
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[reports/export-log] Erro no POST:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
