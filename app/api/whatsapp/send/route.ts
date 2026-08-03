import { NextRequest, NextResponse } from 'next/server';
import { WhatsAppService } from '@/lib/services/whatsapp-service';
import { MetaWhatsAppService } from '@/lib/services/meta-whatsapp-service';
import { query } from '@/lib/db';

export async function POST(request: NextRequest) {
  const { instanceId, to, message } = await request.json();

  try {
    // O canal escolhe o provedor sozinho (Baileys ou Meta) — quem chama essa
    // rota (botão manual no chamado, automação, widget) não precisa saber
    // qual é. Sem linha correspondente em whatsapp_instances (canal antigo,
    // nunca migrado), assume Baileys pra manter o comportamento de sempre.
    const instRes = await query('SELECT provider FROM public.whatsapp_instances WHERE id = $1', [instanceId || 'default']);
    const provider = instRes.rows[0]?.provider || 'baileys';

    if (provider === 'meta') {
      await MetaWhatsAppService.sendMessage(instanceId, to, message);
    } else {
      await WhatsAppService.sendMessage(instanceId, to, message);
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[api/whatsapp/send] Failed:', {
      instanceId,
      to,
      messageLength: message?.length,
      message: error?.message,
      stack: error?.stack
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}