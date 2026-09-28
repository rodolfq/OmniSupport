import { NextRequest, NextResponse } from 'next/server';
import { PyvonService } from '@/lib/services/pyvon-service';
import { handleDeliveryStatus } from '@/lib/services/pyvon-delivery-status';

// URL que o Pyvon chama quando uma mensagem que ele JÁ tinha aceito falha (ou
// é entregue/lida) depois — a Meta só avisa de forma assíncrona, então o
// bot-template/bot-response responde 2xx e a falha chega aqui, sem esperar.
// Mesmo modelo do pyvon-webhook ao lado: sem sessão de usuário, autenticado só
// por X-Pyvon-Secret (o mesmo segredo do canal; ver middleware.ts, precisa
// estar em PUBLIC_PATHS). Formato do corpo e regras de leitura: ver
// lib/services/pyvon-delivery-status.ts.
//
// Sempre 200 quando o segredo e o JSON são válidos — mesmo sem nenhuma
// mensagem nossa correspondendo ao message_id ou se o processamento falhar:
// um erro aqui faria o Pyvon repetir o aviso, e o evento já fica gravado (cru)
// em pyvon_delivery_events pra investigação. Diferente do webhook de entrada,
// AGUARDAMOS o processamento: é só um punhado de UPDATEs, e assim o retorno já
// diz se a mensagem foi encontrada (`matched`), o que ajuda a homologar com o
// Pyvon.
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

  try {
    const result = await handleDeliveryStatus(payload, instance.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[pyvon-status] Falha ao processar aviso de entrega:', err, JSON.stringify(payload));
    return NextResponse.json({ ok: true, processed: false });
  }
}
