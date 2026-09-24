import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
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
  const { instanceId, to, message, sessionId, messageId, replyToMessageId } = await request.json() as {
    instanceId: string; to: string; message: string; sessionId?: string; messageId?: string;
    // id (nosso) da mensagem a citar — só o canal Pyvon usa
    replyToMessageId?: string;
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

      // Citação ("responder" do WhatsApp): o widget manda o id NOSSO da mensagem
      // citada; o id que o Pyvon entende (pyvon_message_id) é resolvido aqui,
      // sempre da MESMA conversa — nunca aceita um id de outra sessão.
      let replyPyvonId: number | undefined;
      if (replyToMessageId) {
        const quotedRes = await query(
          'SELECT pyvon_message_id FROM public.chat_messages WHERE id::text = $1 AND session_id::text = $2',
          [replyToMessageId, sessionId]
        );
        const asNumber = Number(quotedRes.rows[0]?.pyvon_message_id);
        if (Number.isInteger(asNumber) && asNumber > 0) replyPyvonId = asNumber;
      }

      const target = { cadastroId: session.pyvon_cadastro_id || undefined, phone: session.customer_phone || undefined, name: session.customer_name || undefined };
      // A citação nunca pode custar a mensagem: se o Pyvon recusar (422: a
      // mensagem citada não é citável nesta conversa, ex.: ainda não foi
      // entregue ao WhatsApp), reenvia SEM citar em vez de perder a resposta.
      // Um 422 por outro motivo (ex.: anexo que não baixou) falha igual de novo
      // e chega ao usuário como erro de sempre.
      let result;
      let quoteDropped = !!replyToMessageId && !replyPyvonId;
      try {
        result = await PyvonService.sendMessage(instanceId, target, contentForPyvon, { ...(media || {}), replyToMessageId: replyPyvonId });
      } catch (err) {
        if (replyPyvonId && axios.isAxiosError(err) && err.response?.status === 422) {
          console.warn(`[api/whatsapp/send] Pyvon recusou a citação (${JSON.stringify(err.response.data)}); reenviando sem citar.`);
          quoteDropped = true;
          result = await PyvonService.sendMessage(instanceId, target, contentForPyvon, media || undefined);
        } else {
          throw err;
        }
      }
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
      // Guarda o id que o Pyvon deu a esta mensagem: é ele que permite CITAR
      // depois uma mensagem enviada por nós (as do cliente já chegam com o id
      // pelo webhook). Falha aqui só tira a opção de citar, nunca o envio.
      if (messageId && result.message_id) {
        try {
          await query(
            'UPDATE public.chat_messages SET pyvon_message_id = $1 WHERE id::text = $2 AND pyvon_message_id IS NULL',
            [String(result.message_id), messageId]
          );
        } catch (err) {
          console.warn('[api/whatsapp/send] Não consegui guardar o id do Pyvon da mensagem enviada:', err);
        }
      }

      return NextResponse.json({
        success: true,
        mediaSent: firstAttachment ? !!media : undefined,
        // true = era pra citar e saiu sem citação (o widget avisa o analista)
        quoteDropped: quoteDropped || undefined
      });
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
    // Erro do Pyvon vem como "Request failed with status code 422" — inútil pra
    // quem precisa saber o que houve. O motivo de verdade está no corpo da
    // resposta dele (message/error); é ele que vai pro widget e pro console.
    const pyvonReason = axios.isAxiosError(error)
      ? (error.response?.data?.message || error.response?.data?.error || null)
      : null;
    const reason = pyvonReason
      ? `Pyvon (HTTP ${error.response?.status}): ${typeof pyvonReason === 'string' ? pyvonReason : JSON.stringify(pyvonReason)}`
      : error.message;
    console.error('[api/whatsapp/send] Failed:', {
      instanceId,
      to,
      sessionId,
      messageLength: message?.length,
      message: reason,
      stack: error?.stack
    });
    return NextResponse.json({ error: reason }, { status: 500 });
  }
}