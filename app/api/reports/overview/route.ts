import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { resolvePeriod, buildMetricsFilter } from '@/lib/report-period';
import { ReportDimension } from '@/lib/types';
import {
  getVolumeChats,
  getTempoPrimeiraResposta,
  getPctRespondidoAte2min,
  getDuracaoChat,
  getMsgsPorChat,
  getTempoEmEspera,
  getTaxaAbandono,
  getVolumePorDia,
  getVolumePorHoraDoDia,
  getVolumePorDiaDaSemana,
  getResumoPorDimensao
} from '@/lib/services/metrics-service';

// Relatório "Atendimento — visão geral" (R1) — primeiro dos 5, estabelece o
// padrão: página em app/(portal)/reports/<nome>/, rota aqui só orquestra
// (nunca calcula métrica), tudo vem de lib/services/metrics-service.ts.
// Acesso: reports:read.

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

const VALID_DIMENSIONS: ReportDimension[] = ['queue', 'instance', 'channel', 'company'];

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    if (!isAuthorized(actor)) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const { startDate, endDate } = await resolvePeriod(searchParams);
    const filter = buildMetricsFilter(searchParams, startDate, endDate);

    if (action === 'summary') {
      const [volume, firstResponse, pct2min, duration, msgsPorChat, waiting, abandono] = await Promise.all([
        getVolumeChats(filter),
        getTempoPrimeiraResposta(filter),
        getPctRespondidoAte2min(filter),
        getDuracaoChat(filter),
        getMsgsPorChat(filter),
        getTempoEmEspera(filter),
        getTaxaAbandono(filter)
      ]);

      return NextResponse.json({
        parcial: volume.parcial,
        volume: { count: volume.count },
        firstResponse: { medianSeconds: firstResponse.medianSeconds, p90Seconds: firstResponse.p90Seconds, sampleSize: firstResponse.sampleSize },
        pct2min: { percentage: pct2min.percentage },
        duration: { medianMinutes: duration.medianMinutes },
        msgsPorChat: { average: msgsPorChat.average },
        waiting: { medianSeconds: waiting.medianSeconds, p90Seconds: waiting.p90Seconds },
        abandono: { percentage: abandono.percentage }
      });
    }

    if (action === 'volume-by-day') {
      const buckets = await getVolumePorDia(filter);
      return NextResponse.json({ buckets });
    }

    if (action === 'volume-by-hour') {
      const buckets = await getVolumePorHoraDoDia(filter);
      return NextResponse.json({ buckets });
    }

    if (action === 'volume-by-weekday') {
      const buckets = await getVolumePorDiaDaSemana(filter);
      return NextResponse.json({ buckets });
    }

    if (action === 'breakdown') {
      const dimension = searchParams.get('dimension') as ReportDimension | null;
      if (!dimension || !VALID_DIMENSIONS.includes(dimension)) {
        return NextResponse.json({ error: 'dimension inválida — use queue, instance, channel ou company.' }, { status: 400 });
      }
      const rows = await getResumoPorDimensao(filter, dimension);
      return NextResponse.json({ rows });
    }

    return NextResponse.json({ error: 'Action não suportada.' }, { status: 400 });
  } catch (error: any) {
    console.error('[reports/overview] Erro no GET:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
