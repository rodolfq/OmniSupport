import { NextRequest, NextResponse } from 'next/server';
import { PyvonService } from '@/lib/services/pyvon-service';

// Webhook que o Pyvon chama (POST /webhook/inbound do contrato deles — o
// caminho do nosso lado é livre). Sem sessão de usuário: autenticado só pelo
// header X-Pyvon-Secret (ver middleware.ts, precisa estar em PUBLIC_PATHS).
//
// Responder rápido e processar em background é uma exigência do próprio
// Pyvon (§ Pyvon → você da doc): ele dispara e não espera resultado, não
// reprocessa nem repete — por isso NÃO awaitamos handleWebhook antes do 200,
// diferente da rota do Meta (app/api/whatsapp/webhook/route.ts).
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

  PyvonService.handleWebhook(payload, instance.id).catch(err => {
    console.error('[Pyvon] Falha ao processar mensagem recebida:', err);
  });

  return NextResponse.json({ ok: true });
}
