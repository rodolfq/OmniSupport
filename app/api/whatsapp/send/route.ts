import { NextRequest, NextResponse } from 'next/server';
import { WhatsAppService } from '@/lib/services/whatsapp-service';
import { MetaWhatsAppService } from '@/lib/services/meta-whatsapp-service';
import { PyvonService } from '@/lib/services/pyvon-service';
import { query } from '@/lib/db';

export async function POST(request: NextRequest) {
  const { instanceId, to, message, sessionId } = await request.json();

  try {
    // O canal escolhe o provedor sozinho (Baileys, Meta ou Pyvon) — quem
    // chama essa rota (botão manual no chamado, automação, widget) não
    // precisa saber qual é. Sem linha correspondente em whatsapp_instances
    // (canal antigo, nunca migrado), assume Baileys pra manter o
    // comportamento de sempre.
    const instRes = await query('SELECT provider FROM public.whatsapp_instances WHERE id = $1', [instanceId || 'default']);
    const provider = instRes.rows[0]?.provider || 'baileys';

    if (provider === 'pyvon') {
      // Desde a v1.6.4 do contrato, bot-response aceita phone (+name) além
      // de cadastro_id — então esta rota exige sessionId (pra achar telefone
      // e, se já tiver, cadastro_id), mas não trava mais quando a conversa
      // ainda não recebeu nenhuma mensagem por esse canal.
      if (!sessionId) {
        return NextResponse.json({ error: 'sessionId é obrigatório para enviar pelo canal Pyvon.' }, { status: 400 });
      }
      const sessionRes = await query('SELECT pyvon_cadastro_id, customer_phone, customer_name FROM public.chat_sessions WHERE id = $1', [sessionId]);
      const session = sessionRes.rows[0];
      if (!session?.pyvon_cadastro_id && !session?.customer_phone) {
        return NextResponse.json({ error: 'Esta conversa não tem cadastro_id nem telefone do Pyvon associado.' }, { status: 400 });
      }
      const result = await PyvonService.sendMessage(
        instanceId,
        { cadastroId: session.pyvon_cadastro_id || undefined, phone: session.customer_phone || undefined, name: session.customer_name || undefined },
        message
      );
      if (result.skipped) {
        // Aceito pelo Pyvon mas não entregue de verdade (modo de teste do
        // tenant, homologação, ou contato interno de suporte) — sinaliza
        // pro client tratar como falha de envio, não sucesso silencioso.
        // 422 (não 502): Cloudflare reescreve qualquer 502/503/504 nosso pela
        // própria página de erro genérica, mesmo sendo intencional — vimos
        // isso na prática (funcionava direto no localhost, quebrava sempre
        // que passava pelo túnel).
        return NextResponse.json({ error: `Pyvon não entregou a mensagem (${result.skipped}).` }, { status: 422 });
      }
    } else if (provider === 'meta') {
      await MetaWhatsAppService.sendMessage(instanceId, to, message);
    } else {
      await WhatsAppService.sendMessage(instanceId, to, message);
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[api/whatsapp/send] Failed:', {
      instanceId,
      to,
      sessionId,
      messageLength: message?.length,
      message: error?.message,
      stack: error?.stack
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}