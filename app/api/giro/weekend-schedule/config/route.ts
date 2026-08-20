import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit-log';
import { assertCanViewGiro, assertCanManageGiro, permissionErrorStatus } from '@/lib/server-permissions';
import {
  getConfiguredPublishedSheetId,
  saveWeekendScheduleSheetId,
  InvalidSheetLinkError
} from '@/lib/services/weekend-schedule-service';

// Link da planilha da Escala Fim de Semana — mesma divisão de acesso do
// resto do Giro: giro:view lê, giro:manage troca.
export async function GET() {
  const check = await assertCanViewGiro();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });

  const sheetId = await getConfiguredPublishedSheetId();
  return NextResponse.json({ sheetId });
}

export async function POST(request: Request) {
  const check = await assertCanManageGiro();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });

  try {
    const body = await request.json();
    const rawInput: string | null = typeof body?.sheetLink === 'string' ? body.sheetLink : null;
    await saveWeekendScheduleSheetId(rawInput, check.actor.id);
    logAudit({
      actorId: check.actor.id,
      actorName: check.actor.name,
      action: 'update',
      entityType: 'weekend_schedule_settings',
      entityId: '1',
      entityLabel: 'Escala Fim de Semana',
      changes: { sheetLinkChanged: true }
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof InvalidSheetLinkError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[weekend-schedule-config] Falha ao salvar link:', error);
    return NextResponse.json({ error: 'Não foi possível salvar o link agora.' }, { status: 500 });
  }
}
