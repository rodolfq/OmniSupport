import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { resolvePeriod } from '@/lib/report-period';

// Relatório de Avaliação do Chamado (Bom/Ruim + comentário) — pedido do
// usuário, 2026-10-07. Distinto do relatório de Satisfação (R4), que é sobre
// a CONVERSA de chat (chat_histories.rating); este é sobre o CHAMADO em si
// (public.ticket_evaluations, uma por chamado, somente-inserção).
//
// Acesso: reports:read (mesma regra da maioria dos outros relatórios).

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
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes('reports:read');
}

export async function GET(request: NextRequest) {
  const actor = await getActor(request);
  if (!actor) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (!isAuthorized(actor)) return NextResponse.json({ error: 'Sem permissão para ver relatórios.' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'overview';
  if (action !== 'overview') {
    return NextResponse.json({ error: `Action não suportada: ${action}` }, { status: 400 });
  }

  try {
    const { startDate, endDate } = await resolvePeriod(searchParams);

    const res = await query(
      `SELECT e.id, e.rating, e.comment, e.created_at,
              t.id AS ticket_id, t.public_ticket_number, t.title,
              t.company_id, co.name AS company_name,
              p.name AS customer_name
         FROM public.ticket_evaluations e
         JOIN public.tickets t ON t.id = e.ticket_id
         LEFT JOIN public.companies co ON co.id = t.company_id
         LEFT JOIN public.profiles p ON p.id = e.customer_id
        WHERE (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $1::date AND $2::date`,
      [startDate, endDate]
    );

    const todas = res.rows.map((r: any) => ({
      id: r.id,
      ticketId: r.ticket_id,
      ticketNumber: Number(r.public_ticket_number),
      title: r.title,
      companyId: r.company_id,
      companyName: r.company_name,
      customerName: r.customer_name,
      rating: r.rating as 'good' | 'bad',
      comment: r.comment,
      createdAt: new Date(r.created_at).toISOString()
    }));

    // Opções de empresa vêm do período INTEIRO, antes do filtro — senão filtrar
    // por empresa esvaziaria a própria lista de empresas disponíveis.
    const empresasMap = new Map<string, string>();
    for (const a of todas) if (a.companyId && a.companyName) empresasMap.set(a.companyId, a.companyName);
    const opcoes = {
      empresas: [...empresasMap].map(([id, nome]) => ({ id, nome })).sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'))
    };

    const companyIdFilter = searchParams.get('companyId');
    const ratingFilter = searchParams.get('rating'); // 'good' | 'bad' | null
    const avaliacoes = todas.filter(a =>
      (!companyIdFilter || a.companyId === companyIdFilter) &&
      (!ratingFilter || a.rating === ratingFilter)
    );

    const bons = avaliacoes.filter(a => a.rating === 'good').length;
    const ruins = avaliacoes.length - bons;
    const kpis = {
      total: avaliacoes.length,
      bons,
      ruins,
      percentualBom: avaliacoes.length === 0 ? null : bons / avaliacoes.length
    };

    // Ruim primeiro (o que pede ação), depois por data mais recente.
    const lista = [...avaliacoes].sort((a, b) => {
      if (a.rating !== b.rating) return a.rating === 'bad' ? -1 : 1;
      return +new Date(b.createdAt) - +new Date(a.createdAt);
    });

    return NextResponse.json({ kpis, avaliacoes: lista, opcoes });
  } catch (error: any) {
    if (error?.code === '42P01') {
      return NextResponse.json({ error: 'Relatório indisponível neste banco (migração pendente).' }, { status: 503 });
    }
    console.error('[reports/ticket-evaluations] Erro:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
