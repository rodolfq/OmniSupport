import { NextRequest, NextResponse } from 'next/server';
import { assertCanViewGiro, permissionErrorStatus } from '@/lib/server-permissions';
import { getWeekendSchedule, WeekendScheduleNotFoundError } from '@/lib/services/weekend-schedule-service';

// Mesma audiência do Giro de Atendimento (ver components/giro-content.tsx) —
// é onde o item de menu fica, ao lado dele. Só leitura: não existe ação de
// escrita aqui, a planilha do Google é a única fonte.
export async function GET(request: NextRequest) {
  const check = await assertCanViewGiro();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });

  const params = new URL(request.url).searchParams;
  const forceRefresh = params.get('refresh') === '1';
  // Deslocamento em meses a partir do atual (0 = mês atual, 1 = próximo,
  // -1 = anterior) — navegação de mês na tela "Escala Fim de Semana".
  const monthOffsetParam = parseInt(params.get('month') || '0', 10);
  const monthOffset = Number.isFinite(monthOffsetParam) ? monthOffsetParam : 0;

  try {
    const result = await getWeekendSchedule(forceRefresh, monthOffset);
    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof WeekendScheduleNotFoundError) {
      return NextResponse.json(
        { error: error.message, availableTabs: error.availableTabs },
        { status: 404 }
      );
    }
    console.error('[weekend-schedule] Falha ao buscar escala:', error);
    // error.message já vem traduzido pelo service (timeout, sem rede, aba
    // não encontrada) — repassar em vez do texto genérico, senão o motivo
    // real (ex: "Google Sheets não respondeu a tempo") nunca chega na tela.
    return NextResponse.json({ error: error?.message || 'Não foi possível carregar a escala agora. Tente novamente em instantes.' }, { status: 502 });
  }
}
