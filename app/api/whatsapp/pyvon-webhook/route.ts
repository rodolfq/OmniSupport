import { NextRequest, NextResponse } from 'next/server';
import { PyvonService } from '@/lib/services/pyvon-service';
import { storeInboundEvent, markInboundIgnored, processInboundEvent } from '@/lib/services/pyvon-inbound-events';

// Webhook que o Pyvon chama (POST /webhook/inbound do contrato deles — o
// caminho do nosso lado é livre). Sem sessão de usuário: autenticado só pelo
// header X-Pyvon-Secret (ver middleware.ts, precisa estar em PUBLIC_PATHS).
//
// Responder rápido é exigência do próprio Pyvon (§ Pyvon → você da doc): ele
// dispara, não espera resultado e NÃO reenvia. Por isso a ordem aqui importa:
//   1. o evento é GRAVADO (pyvon_inbound_events) antes de qualquer coisa — se
//      isto falhar, respondemos erro e registramos no log, mas nada é processado
//      sem estar guardado;
//   2. só então respondemos 200 e processamos em segundo plano;
//   3. se o processamento falhar, o evento fica 'failed' e o agendador retenta
//      (lib/services/pyvon-inbound-events.ts). Antes a falha sumia no console.
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-pyvon-secret');
  const instance = await PyvonService.findInstanceBySecret(secret);
  if (!instance) {
    return NextResponse.json({ error: 'X-Pyvon-Secret ausente ou inválido.' }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo não é JSON válido.' }, { status: 400 });
  }

  let eventId: number;
  try {
    eventId = await storeInboundEvent(payload, instance.id);
  } catch (err) {
    console.error('[Pyvon] Falha ao GUARDAR mensagem recebida — não processada:', err, { messageId: payload?.message_id });
    return NextResponse.json({ error: 'Não foi possível registrar a mensagem.' }, { status: 500 });
  }

  if (!payload?.message_id || !payload?.cadastro_id) {
    // Sem message_id ou cadastro_id não há como ligar a mensagem a um contato.
    // Fica registrada como 'ignored' com o payload completo, para conferência.
    await markInboundIgnored(eventId, 'payload sem message_id ou cadastro_id').catch(err => {
      console.error('[Pyvon] Falha ao marcar evento ignorado:', err);
    });
  } else {
    // Fire-and-forget de propósito: processInboundEvent nunca lança e registra o resultado.
    processInboundEvent(eventId, instance.id, payload);
  }

  return NextResponse.json({ ok: true });
}
