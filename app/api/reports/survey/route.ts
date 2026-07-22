import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';

// Mesma lacuna encontrada em customer-evaluations/route.ts: a página
// /reports só escondia a seção no cliente, a API em si estava aberta pra
// qualquer um. Mesmo padrão de autenticação usado em app/api/tickets/route.ts.
async function getReportActor(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  if (!token) return null;

  const decoded = await verifyJWT(token);
  if (!decoded?.id) return null;

  const result = await query(
    `SELECT p.id, p.role, COALESCE(rp.permissions, '{}'::text[]) AS permissions
     FROM public.profiles p
     LEFT JOIN public.role_permissions rp ON rp.role = p.role
     WHERE p.id = $1`,
    [decoded.id]
  );

  return result.rows[0] || null;
}

function canReadReports(actor: any) {
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes('reports:read');
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getReportActor(request);
    if (!canReadReports(actor)) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
    }

    const res = await query(
      `SELECT h.id, h.customer_name, h.finished_at, h.rating, s.ticket_number
       FROM public.chat_histories h
       LEFT JOIN public.chat_sessions s ON s.id = h.session_id
       WHERE h.rating IS NOT NULL
       ORDER BY h.finished_at DESC`
    );

    const responses = res.rows.map(r => ({
      id: r.id,
      customerName: r.customer_name,
      ticketNumber: r.ticket_number,
      rating: r.rating,
      finishedAt: r.finished_at
    }));

    const total = responses.length;
    const satisfied = responses.filter(r => r.rating === 1).length;
    const toImprove = responses.filter(r => r.rating === 0).length;
    const satisfactionRate = total > 0 ? satisfied / total : 0;

    return NextResponse.json({ total, satisfied, toImprove, satisfactionRate, responses });
  } catch (error: any) {
    console.error('Error fetching survey report:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
