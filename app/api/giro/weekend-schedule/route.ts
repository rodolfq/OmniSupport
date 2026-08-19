import { NextRequest, NextResponse } from 'next/server';
import { assertCanViewGiro, permissionErrorStatus } from '@/lib/server-permissions';
import { getWeekendSchedule, WeekendScheduleNotFoundError } from '@/lib/services/weekend-schedule-service';

// Mesma audiência do Giro de Atendimento (ver components/giro-content.tsx) —
// é onde o item de menu fica, ao lado dele. Só leitura: não existe ação de
// escrita aqui, a planilha do Google é a única fonte.
export async function GET(request: NextRequest) {
  const check = await assertCanViewGiro();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });

  const forceRefresh = new URL(request.url).searchParams.get('refresh') === '1';

  try {
    const result = await getWeekendSchedule(forceRefresh);
    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof WeekendScheduleNotFoundError) {
      return NextResponse.json(
        { error: error.message, availableTabs: error.availableTabs },
        { status: 404 }
      );
    }
    console.error('[weekend-schedule] Falha ao buscar escala:', error);
    return NextResponse.json({ error: 'Não foi possível carregar a escala agora. Tente novamente em instantes.' }, { status: 502 });
  }
}
