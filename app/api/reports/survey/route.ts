import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { resolvePeriod, buildMetricsFilter } from '@/lib/report-period';
import { anonymizeAnalystRows } from '@/lib/report-anonymize';
import { ReportDimension, NegativeEvaluationRow } from '@/lib/types';
import {
  getSatisfacao,
  getSatisfacaoPorDia,
  getSatisfacaoPorDimensao,
  getSatisfacaoPorFaixaTempo,
  getPeriodBounds
} from '@/lib/services/metrics-service';

// Relatório "Satisfação e Qualidade" (R4) — EVOLUI este arquivo em vez de
// recomeçar do zero, como pedido: o GET sem ?action= (usado hoje por
// app/(portal)/reports/page.tsx) fica 100% intocado; todo conteúdo novo do
// R4 entra atrás de ?action=, mesmo padrão de roteamento das outras rotas
// de relatório (overview/analysts/capacity).
//
// Escala de rating (-1/0/1) NUNCA convertida pra 1-5 de fonte externa —
// decisão em aberto, fora deste relatório.
//
// Sem essa checagem de ator, a API ficava aberta pra qualquer um (a página
// /reports só escondia a seção no cliente) — mesmo padrão de autenticação
// usado em app/api/tickets/route.ts. O JOIN é por access_profile_id, não por
// role: perfis de acesso customizados gravam role_permissions.role com o
// NOME do perfil, não o UserRole do ator, então `rp.role = p.role` (padrão
// antigo, de antes de profiles.access_profile_id existir) nunca bate pra
// eles — cai de volta na linha padrão do papel estrutural, liberando ou
// bloqueando errado.
async function getReportActor(request: NextRequest) {
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

function canReadReports(actor: any) {
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes('reports:read');
}

function canSeeIndividual(actor: any) {
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes('reports:individual');
}

const VALID_DIMENSIONS: ReportDimension[] = ['queue', 'instance', 'channel', 'company', 'analyst'];

export async function GET(request: NextRequest) {
  try {
    const actor = await getReportActor(request);
    if (!canReadReports(actor)) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (!action) {
      // Comportamento legado, intocado — consumido por app/(portal)/reports/page.tsx.
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
    }

    const { startDate, endDate } = await resolvePeriod(searchParams);
    const filter = buildMetricsFilter(searchParams, startDate, endDate);

    if (action === 'summary') {
      const satisfacao = await getSatisfacao(filter);
      return NextResponse.json({
        parcial: satisfacao.parcial,
        totalClosed: satisfacao.totalClosed,
        evaluated: satisfacao.evaluated,
        positiveRate: satisfacao.positiveRate,
        responseRate: satisfacao.responseRate
      });
    }

    if (action === 'trend') {
      const buckets = await getSatisfacaoPorDia(filter);
      return NextResponse.json({ buckets });
    }

    if (action === 'breakdown') {
      const dimension = searchParams.get('dimension') as ReportDimension | null;
      if (!dimension || !VALID_DIMENSIONS.includes(dimension)) {
        return NextResponse.json({ error: 'dimension inválida — use queue, instance, channel, company ou analyst.' }, { status: 400 });
      }
      const rows = await getSatisfacaoPorDimensao(filter, dimension);

      if (dimension !== 'analyst') {
        return NextResponse.json({ rows: rows.map(r => ({ ...r, isSelf: false })) });
      }

      if (canSeeIndividual(actor)) {
        return NextResponse.json({ rows: rows.map(r => ({ ...r, isSelf: r.segmentId === actor.id })) });
      }

      // Anonimiza o nome do analista (segmentLabel) mantendo segmentId real
      // internamente só pra decidir isSelf — a mesma ordem estável por
      // profiles.created_at do R2, via o helper compartilhado.
      const anonymized = await anonymizeAnalystRows(actor.id, rows.map(r => ({ analystId: r.segmentId, analystName: r.segmentLabel })));
      const finalRows = rows.map((r, i) => ({ ...r, segmentLabel: anonymized[i].analystName, isSelf: anonymized[i].isSelf }));
      return NextResponse.json({ rows: finalRows });
    }

    if (action === 'crosscut') {
      const data = await getSatisfacaoPorFaixaTempo(filter);
      return NextResponse.json(data);
    }

    if (action === 'negative-list') {
      const limit = Math.min(Number(searchParams.get('limit') ?? 20) || 20, 100);
      const offset = Math.max(Number(searchParams.get('offset') ?? 0) || 0, 0);
      const bounds = await getPeriodBounds(filter);

      const countRes = await query(
        `SELECT COUNT(*)::int AS total
         FROM public.chat_histories h
         LEFT JOIN public.chat_sessions s ON s.id = h.session_id
         LEFT JOIN public.queues q ON q.id = s.queue_id
         WHERE h.rating = -1
           AND h.finished_at >= $1 AND h.finished_at < $2
           AND ($3::text IS NULL OR s.queue_id = $3)
           AND ($4::text IS NULL OR q.whatsapp_instance_id = $4)`,
        [bounds.startUtc, bounds.endUtcExclusive, filter.queueId ?? null, filter.instanceId ?? null]
      );

      const res = await query(
        `SELECT h.id, h.session_id, h.customer_name, p.name AS analyst_name, h.finished_at,
                h.first_response_seconds, h.duration_seconds, s.ticket_number
         FROM public.chat_histories h
         LEFT JOIN public.chat_sessions s ON s.id = h.session_id
         LEFT JOIN public.queues q ON q.id = s.queue_id
         LEFT JOIN public.profiles p ON p.id = h.assignee_id
         WHERE h.rating = -1
           AND h.finished_at >= $1 AND h.finished_at < $2
           AND ($3::text IS NULL OR s.queue_id = $3)
           AND ($4::text IS NULL OR q.whatsapp_instance_id = $4)
         ORDER BY h.finished_at DESC
         LIMIT $5 OFFSET $6`,
        [bounds.startUtc, bounds.endUtcExclusive, filter.queueId ?? null, filter.instanceId ?? null, limit, offset]
      );

      const rows: NegativeEvaluationRow[] = res.rows.map(r => ({
        historyId: r.id,
        sessionId: r.session_id,
        customerName: r.customer_name ?? 'Cliente',
        analystName: r.analyst_name,
        finishedAt: r.finished_at,
        firstResponseSeconds: r.first_response_seconds,
        durationSeconds: r.duration_seconds,
        ticketNumber: r.ticket_number
      }));

      return NextResponse.json({ rows, total: countRes.rows[0]?.total ?? 0, limit, offset });
    }

    return NextResponse.json({ error: 'Action não suportada.' }, { status: 400 });
  } catch (error: any) {
    console.error('Error fetching survey report:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
