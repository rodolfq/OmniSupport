import { NextRequest, NextResponse } from 'next/server';
import { WhatsAppService } from '@/lib/services/whatsapp-service';
import { PyvonService } from '@/lib/services/pyvon-service';
import { signPyvonMediaUrl } from '@/lib/services/pyvon-media-link';
import { ATTACHMENT_URL_PREFIX } from '@/lib/services/attachment-storage';
import { query } from '@/lib/db';
import type { Attachment } from '@/lib/types';

// bot-response só aceita UM anexo de verdade por chamada — com mais de um na
// mensagem, só o primeiro é encaminhado como mídia (o resto continua só no
// nosso chat). image/* vira image_url; audio/* vira audio_url (Pyvon converte
// pra OGG/Opus e entrega como mensagem de voz); qualquer outro tipo (vídeo,
// documento) vira document_url — o WhatsApp mostra como arquivo baixável em
// vez de tocar/exibir inline, mas ainda chega, que é a diferença que importa
// aqui.
function resolvePyvonMediaUrl(attachment: Attachment): { imageUrl?: string; documentUrl?: string; audioUrl?: string } | null {
  if (!attachment?.url) return null;

  let publicUrl: string | null = null;
  if (/^https?:\/\//i.test(attachment.url)) {
    publicUrl = attachment.url; // já é pública (ex.: anexo antigo de outra origem)
  } else if (attachment.url.startsWith(ATTACHMENT_URL_PREFIX)) {
    const relativePath = attachment.url.slice(ATTACHMENT_URL_PREFIX.length);
    publicUrl = signPyvonMediaUrl(relativePath);
  }
  // data: URL legado (base64, anexo anterior à migração pra disco) não tem
  // como virar link público — sem isso aqui, cai silenciosamente pro "mídia
  // não encaminhada" abaixo, nunca quebra o envio do texto.
  if (!publicUrl) return null;

  if (attachment.type?.startsWith('image/')) return { imageUrl: publicUrl };
  if (attachment.type?.startsWith('audio/')) return { audioUrl: publicUrl };
  return { documentUrl: publicUrl };
}

export async function POST(request: NextRequest) {
  const { instanceId, to, message, sessionId, messageId } = await request.json() as {
    instanceId: string; to: string; message: string; sessionId?: string; messageId?: string;
  };

  try {
    // O canal escolhe o provedor sozinho (Baileys ou Pyvon) — quem chama essa
    // rota (botão manual no chamado, automação, widget) não precisa saber
    // qual é. Sem linha correspondente em whatsapp_instances (canal antigo,
    // nunca migrado), assume Baileys pra manter o comportamento de sempre.
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
      // Busca do banco, nunca confia no que o client mandou: no momento em que
      // o client chama esta rota, o anexo ainda está como data: URL local
      // (o servidor só grava em disco e troca pela URL curta ao SALVAR a
      // mensagem, alguns milissegundos antes) — usar o que o client tem em
      // mãos aqui sempre resolvia pra "não dá pra encaminhar".
      let firstAttachment: Attachment | undefined;
      if (messageId) {
        const msgRes = await query('SELECT metadata FROM public.chat_messages WHERE id = $1', [messageId]);
        firstAttachment = msgRes.rows[0]?.metadata?.attachments?.[0];
      }
      const media = firstAttachment ? resolvePyvonMediaUrl(firstAttachment) : null;

      // bot-response exige content não-vazio mesmo quando só o anexo importa
      // (BotResponsePayload.content: "Obrigatório, exceto com transfer:true"
      // — testado na prática, `content: ''` volta 400). Um espaço não aparece
      // como legenda visível no WhatsApp, mas satisfaz a validação sem
      // inventar um texto tipo "Anexo enviado" (pedido do usuário
      // 2026-09-17: sem legenda digitada = sem legenda mostrada). Só entra
      // quando há anexo — mensagem de texto puro nunca chega vazia aqui
      // (chat-widget.tsx já bloqueia enviar sem texto e sem anexo).
      const contentForPyvon = message || (firstAttachment ? ' ' : message);

      const result = await PyvonService.sendMessage(
        instanceId,
        { cadastroId: session.pyvon_cadastro_id || undefined, phone: session.customer_phone || undefined, name: session.customer_name || undefined },
        contentForPyvon,
        media || undefined
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
      if (result.delivery && result.delivery !== 'sent') {
        // bot-response responde 200 (aceito e registrado) mesmo quando o
        // envio ao provedor falhou (ex.: janela de 24h fechada, número
        // inválido) — delivery/delivery_error é o único jeito de saber, na
        // mesma resposta. Sem checar isso, a mensagem ficava marcada como
        // enviada no nosso chat mesmo nunca tendo saído de verdade.
        return NextResponse.json(
          { error: result.delivery_error || `Pyvon não entregou a mensagem (${result.delivery}).` },
          { status: 422 }
        );
      }
      // mediaSent === false com anexo presente = mídia existe mas não deu
      // pra gerar link público (NEXT_PUBLIC_APP_URL/JWT_SECRET ausente, ou
      // anexo em data: URL legado) — o client usa isso pra avisar que só o
      // texto foi encaminhado, sem inventar sucesso total.
      return NextResponse.json({ success: true, mediaSent: firstAttachment ? !!media : undefined });
    } else {
      // Baileys ainda não encaminha o anexo em si (só o canal Pyvon tem isso
      // hoje) — sem legenda digitada, não há texto de verdade pra mandar por
      // aqui. Antes caía num "Anexo enviado" que passava a impressão de que
      // o arquivo tinha chegado, quando só o texto saiu. Sem legenda = não
      // manda nada à toa (pedido do usuário 2026-09-17).
      if (!message.trim()) return NextResponse.json({ success: true, mediaSent: false });
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