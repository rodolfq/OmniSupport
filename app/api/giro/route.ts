import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit-log';
import { assertCanViewGiro, assertCanManageGiro, permissionErrorStatus } from '@/lib/server-permissions';
import * as giro from '@/lib/services/giro-service';

/**
 * Giro de Atendimento — operação do dia.
 *
 * Divisão de acesso adotada aqui:
 *   giro:view   → ler o giro e mexer no ATENDIMENTO (tipo, hora, observação,
 *                 checklist, almoço, concluir). O quadro do dia é
 *                 compartilhado, como o painel de chat: na prática quem está
 *                 no telefone anota pelo colega, e exigir permissão de gestão
 *                 para isso travaria a operação.
 *   giro:manage → tudo que muda a ESTRUTURA do dia: ordem, incluir/remover
 *                 gente, passagem de turno, reprocessar e excluir histórico.
 *
 * Em toda mutação a data também é checada (assert*Editable no service): dia
 * passado é somente leitura, independentemente de permissão.
 */

export async function GET(request: Request) {
  try {
    const check = await assertCanViewGiro();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });

    const searchParams = new URL(request.url).searchParams;
    const action = searchParams.get('action');

    if (action === 'summary') {
      return NextResponse.json(await giro.getTodaySummary(check.actor.id));
    }

    // Sem `date`, quem decide qual é o dia de hoje é o servidor (fuso de São
    // Paulo) — nunca o relógio do navegador, que pode estar em outro fuso e
    // faria a tela abrir o dia errado por volta da virada.
    const date = searchParams.get('date') || await giro.getTodayDate();
    return NextResponse.json(await giro.getGiroDay(date));
  } catch (err: any) {
    console.error('Error loading giro:', err);
    return NextResponse.json({ error: err?.message || 'Erro ao carregar o Giro.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const viewCheck = await assertCanViewGiro();
    if (!viewCheck.ok) return NextResponse.json({ error: viewCheck.error }, { status: permissionErrorStatus(viewCheck.error) });
    const actor = viewCheck.actor;

    const body = await request.json();
    const action = body?.action as string;

    // ---------------------------------------------------- giro:view basta
    if (action === 'update-row') {
      if (!body.rowId) return NextResponse.json({ error: 'rowId é obrigatório.' }, { status: 400 });
      const editable = await giro.assertRowEditable(body.rowId);
      if (!editable.ok) return NextResponse.json({ error: editable.error }, { status: 409 });

      await giro.updateRow(body.rowId, {
        serviceType: body.serviceType,
        serviceTime: body.serviceTime,
        note: body.note,
        lunchTime: body.lunchTime,
        checklist: body.checklist
      });
      return NextResponse.json({ success: true });
    }

    if (action === 'claim-ticket') {
      // Disparada pelo botão "Assumir" do chamado (ticket-detail-modal), não
      // pela tela do Giro — sempre sobre a PRÓPRIA linha do ator, nunca a de
      // outro analista. Silenciosa por natureza: se o ator não estiver no
      // Giro de hoje, skipTurnForTicketClaim só devolve skipped:false.
      const result = await giro.skipTurnForTicketClaim(actor.id, body.ticketNumber ?? null, body.ticketId || '');
      return NextResponse.json({ success: true, skipped: result.skipped });
    }

    if (action === 'complete') {
      if (!body.rowId) return NextResponse.json({ error: 'rowId é obrigatório.' }, { status: 400 });
      const editable = await giro.assertRowEditable(body.rowId);
      if (!editable.ok) return NextResponse.json({ error: editable.error }, { status: 409 });

      await giro.completeService(body.rowId);
      return NextResponse.json({ success: true });
    }

    // ------------------------------------------------- daqui pra baixo, manage
    const manageCheck = await assertCanManageGiro();
    if (!manageCheck.ok) return NextResponse.json({ error: manageCheck.error }, { status: permissionErrorStatus(manageCheck.error) });

    if (action === 'reorder') {
      const writable = await giro.assertDayWritable(body.dayId);
      if (!writable.ok) return NextResponse.json({ error: writable.error }, { status: 409 });
      await giro.reorderDay(body.dayId, body.orderedRowIds || []);
      return NextResponse.json({ success: true });
    }

    if (action === 'add-member') {
      // Recebe a DATA, não o id do dia: quando o giro do dia ainda não existe
      // (cadastro novo, ou zero participante elegível até agora), não há
      // dayId nenhum para checar — addMemberToDay cria a linha em giro_days
      // internamente antes de inserir. Ver comentário em giro-service.ts.
      if (!body.date) return NextResponse.json({ error: 'Informe a data.' }, { status: 400 });
      const result = await giro.addMemberToDay(body.date, body.userId);
      if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
      logAudit({ actorId: actor.id, actorName: actor.name, action: 'update', entityType: 'giro_day', entityId: body.date, entityLabel: 'Inclusão no giro do dia' });
      return NextResponse.json({ success: true });
    }

    if (action === 'remove-member') {
      const writable = await giro.assertDayWritable(body.dayId);
      if (!writable.ok) return NextResponse.json({ error: writable.error }, { status: 409 });
      await giro.removeMemberFromDay(body.dayId, body.rowId);
      logAudit({ actorId: actor.id, actorName: actor.name, action: 'update', entityType: 'giro_day', entityId: body.dayId, entityLabel: 'Remoção do giro do dia' });
      return NextResponse.json({ success: true });
    }

    if (action === 'set-handoff') {
      const writable = await giro.assertDayWritable(body.dayId);
      if (!writable.ok) return NextResponse.json({ error: writable.error }, { status: 409 });
      await giro.setHandoff(body.dayId, body.mode, body.userId);
      return NextResponse.json({ success: true });
    }

    if (action === 'reprocess') {
      const result = await giro.reprocessDay(body.date);
      if (result.error) return NextResponse.json({ error: result.error }, { status: 409 });
      logAudit({ actorId: actor.id, actorName: actor.name, action: 'update', entityType: 'giro_day', entityId: body.date, entityLabel: `Reprocessamento do giro de ${body.date}` });
      return NextResponse.json({ success: true });
    }

    if (action === 'delete-history') {
      const editable = await giro.assertHistoryEditable(body.historyId);
      if (!editable.ok) return NextResponse.json({ error: editable.error }, { status: 409 });
      await giro.deleteHistoryEntry(body.historyId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  } catch (err: any) {
    console.error('Error on giro action:', err);
    return NextResponse.json({ error: err?.message || 'Erro ao executar a ação.' }, { status: 500 });
  }
}
