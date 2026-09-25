import axios from 'axios';
import crypto from 'crypto';
import { query } from '../db';
import { normalizePhone } from '../utils';
import { runExclusive } from '../key-mutex';
import { emitChatEvent, emitSessionsChanged, excludeActiveViewers } from '../chat-events';
import { notifyUser } from './push-service';
import { getChatRecipientIds } from './notification-recipients';
import { resolveQueueForInstance, resolveQueueById, pickNextQueueAssignee, dispatchPendingChatSessions, isOnlineQueueMember } from './queue-routing';
import { storeAttachmentBuffer } from './attachment-storage';
import { transcribeMessageAudio, isAudioAttachment, isTranscriptionEnabled } from './transcription-service';
import { isCrisisModeEnabled, recordCrisisModeMessage, getCrisisModeMessage } from './crisis-mode-service';
import { resolveReplyQuote } from './chat-reply';
import type { Attachment } from '@/lib/types';

/**
 * Canal WhatsApp via Pyvon (BSP/CRM que já cuida da conexão oficial com a
 * Meta) — mesmo padrão de provider já usado por Baileys em whatsapp_instances.
 * Documentação: https://pyvon.io/docs/bot-externo/
 *
 * Do ponto de vista do Pyvon, o SSX Desk É "o bot" do tenant — pra sempre.
 * NUNCA chamamos `transfer` (bot-response com transfer:true): isso entregaria
 * a conversa pra fila humana DENTRO do Pyvon e faria ele parar de nos
 * encaminhar mensagens desse contato até um atendente encerrar por lá — o
 * oposto do que precisamos, já que quem atende é sempre um humano aqui no
 * SSX Desk, não um agente de IA nem a equipe do próprio Pyvon.
 *
 * `bot-response` (envio) sempre responde 200 como "aceito e registrado" —
 * nunca "entregue". Se a entrega ao WhatsApp falhar depois (ex.: janela de
 * 24h fechada), o Pyvon marca como falha só no histórico DELE; não existe
 * hoje um jeito de sabermos disso pelo contrato. Por isso decisões de
 * "dentro ou fora da janela de 24h" (fase 3+) precisam ser calculadas do
 * nosso lado, olhando a última mensagem inbound já registrada, em vez de
 * reagir a um erro que o Pyvon nunca vai nos mandar.
 */

interface PyvonInboundPayload {
  cadastro_id: number;
  cadastro_name?: string;
  cadastro_phone?: string | null;
  atendimento_id?: number | null;
  message_id: number;
  content?: string;
  type?: 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location';
  channel_id?: number;
  channel_name?: string | null;
  media_url?: string | null;
  // Mensagem que o cliente CITOU ("responder" do WhatsApp) — v1.15 do contrato.
  // null quando não citou nada. message_id é o id da mensagem citada NO PYVON.
  quoted?: {
    message_id: number;
    content?: string;
    direction?: 'inbound' | 'outbound';
    type?: string;
    sent_by_bot?: boolean;
  } | null;
}

const BASE_URLS: Record<string, string> = {
  prod: 'https://api.pyvon.io',
  dev: 'https://api-dev.pyvon.io',
};

// Sem legenda, mostra um rótulo no lugar do texto — mesmo espírito do
// '[Áudio]'/'[Arquivo: nome]' que o canal Baileys já usa.
const PLACEHOLDER_BY_TYPE: Record<string, string> = {
  image: '[Imagem]',
  audio: '[Áudio]',
  video: '[Vídeo]',
  document: '[Documento]',
  sticker: '[Figurinha]',
  // Sem campo de coordenada documentado no contrato do Pyvon hoje — só dá
  // pra registrar que uma localização chegou, não qual é.
  location: '[Localização]',
};

// Mesmas variantes de 9º dígito/DDI que Baileys já calcula na própria cópia
// (não existe um helper compartilhado hoje no projeto).
export function phoneVariants(rawPhone: string): string[] {
  const digits = normalizePhone(rawPhone);
  if (!digits) return [];
  const variants = new Set<string>([digits]);

  if (digits.startsWith('55') && digits.length > 11) variants.add(digits.slice(2));
  else if (digits.length <= 11) variants.add(`55${digits}`);

  const base = [...variants];
  base.forEach(v => {
    if (v.startsWith('55') && v.length === 13 && v[4] === '9') variants.add(v.slice(0, 4) + v.slice(5));
    else if (v.startsWith('55') && v.length === 12) variants.add(v.slice(0, 4) + '9' + v.slice(4));
    else if (v.length === 11 && v[2] === '9') variants.add(v.slice(0, 2) + v.slice(3));
    else if (v.length === 10) variants.add(v.slice(0, 2) + '9' + v.slice(2));
  });

  return [...variants];
}

export class PyvonService {
  static async getInstanceById(instanceId: string) {
    const res = await query(
      `SELECT id, access_token, pyvon_environment, pyvon_channel_id FROM public.whatsapp_instances WHERE id = $1 AND provider = 'pyvon'`,
      [instanceId]
    );
    return res.rows[0] || null;
  }

  // Só existe UM tenant Pyvon hoje (um número de celular só) — o caminho do
  // webhook é livre por contrato do Pyvon (não carrega id de instância), e o
  // próprio segredo já identifica qual instância é. Se um dia precisar de
  // mais de um tenant, passa a exigir um identificador na própria rota.
  static async findInstanceBySecret(secret: string | null) {
    if (!secret) return null;
    const res = await query(
      `SELECT id, pyvon_environment FROM public.whatsapp_instances WHERE provider = 'pyvon' AND access_token = $1 LIMIT 1`,
      [secret]
    );
    return res.rows[0] || null;
  }

  private static baseUrlFor(environment: string | null | undefined): string {
    return BASE_URLS[environment || 'prod'] || BASE_URLS.prod;
  }

  private static async getCredentials(instanceId: string): Promise<{ secret: string; baseUrl: string; channelId?: number }> {
    const instance = await this.getInstanceById(instanceId);
    if (!instance?.access_token) throw new Error('Instância Pyvon não configurada.');
    return {
      secret: instance.access_token,
      baseUrl: this.baseUrlFor(instance.pyvon_environment),
      channelId: instance.pyvon_channel_id ?? undefined
    };
  }

  // ---------------------------------------------------------- entrada (webhook)

  static async handleWebhook(payload: PyvonInboundPayload, instanceId: string): Promise<void> {
    if (!payload?.message_id || !payload?.cadastro_id) return;

    // Idempotência: o próprio contrato do Pyvon avisa que o mesmo evento pode
    // chegar 2x em retentativa de rede.
    const messageIdStr = String(payload.message_id);
    const dup = await query('SELECT 1 FROM public.chat_messages WHERE pyvon_message_id = $1', [messageIdStr]);
    if ((dup.rowCount ?? 0) > 0) return;

    const name = payload.cadastro_name || 'Contato Pyvon';
    const variants = payload.cadastro_phone ? phoneVariants(payload.cadastro_phone) : [];
    const lockKey = variants[0] || `cadastro-${payload.cadastro_id}`;

    // Resposta "1"/"0" à pesquisa de satisfação de uma conversa ENCERRADA: vai
    // pra própria conversa encerrada (registra a nota) e NÃO abre atendimento
    // novo. Antes o Pyvon não tratava isso e cada avaliação virava um chat novo.
    try {
      if (await this.tryRecordSurveyAnswer(payload, variants, messageIdStr)) return;
    } catch (err) {
      console.error('[Pyvon] Falha ao registrar resposta da pesquisa — seguindo o fluxo normal:', err);
    }

    // Se este contato tem template automático guardado (ver
    // savePendingOutbound), a conversa que vai nascer já pode nascer com o autor
    // da nota — em vez de passar pelo rodízio e ser trocada depois.
    let preferredAssigneeId: string | null = null;
    try {
      preferredAssigneeId = await this.peekPendingOutboundAuthor(variants, payload.cadastro_id);
    } catch (err) {
      console.error('[Pyvon] Falha ao consultar template pendente do contato:', err);
    }

    const session = await runExclusive(`session:${lockKey}`, () =>
      this.findOrCreateSession(variants, payload.cadastro_id, name, instanceId, { preferredAssigneeId })
    );
    if (!session) return;

    if (session.pyvon_cadastro_id !== payload.cadastro_id) {
      await query('UPDATE public.chat_sessions SET pyvon_cadastro_id = $1 WHERE id = $2', [payload.cadastro_id, session.id]);
    }

    // Templates automáticos que ficaram esperando a resposta do cliente entram
    // agora na conversa (histórico + nota/autor pendentes).
    try {
      await this.adoptPendingOutbound(session, variants, payload.cadastro_id);
    } catch (err) {
      console.error('[Pyvon] Falha ao trazer o template pendente pra conversa:', err);
    }

    // A nota pendente mora na conversa que recebeu o template; se ela foi
    // fechada antes do cliente responder, traz a nota pra esta conversa.
    try {
      await this.adoptPendingNoteFromClosedSession(session, variants, payload.cadastro_id);
    } catch (err) {
      console.error('[Pyvon] Falha ao recuperar nota pendente da conversa fechada:', err);
    }

    let attachment: Attachment | null = null;
    if (payload.type && payload.type !== 'text') {
      if (payload.media_url) {
        try {
          attachment = await this.downloadMedia(payload.message_id, instanceId);
          if (!attachment) {
            console.warn(`[Pyvon] downloadMedia devolveu vazio pra message_id=${payload.message_id} (type=${payload.type}) — provável 404 nas duas tentativas.`);
          }
        } catch (err) {
          console.error('[Pyvon] Falha ao baixar mídia recebida:', err);
        }
      } else {
        // Diagnóstico: o payload veio com type != text mas sem media_url —
        // contraria a doc oficial ("presente quando type não é text"). Sem
        // isso não temos como saber por que a mídia nunca chega, já que o
        // resto do fluxo segue normal (mensagem salva só com o texto
        // placeholder "[Imagem]" etc.).
        console.warn(`[Pyvon] Mensagem type=${payload.type} chegou SEM media_url — message_id=${payload.message_id}, channel_id=${payload.channel_id}. Payload completo:`, JSON.stringify(payload));
      }
    }

    let text = payload.content || '';
    // Rótulo genérico ("[Imagem]" etc.) só quando a mídia NÃO baixou — vira o
    // único indício, na tela do analista, de que algo chegou e falhou. Mídia
    // baixada com sucesso e sem legenda de verdade (payload.content vazio)
    // fica com texto vazio mesmo: sem legenda digitada = sem legenda
    // mostrada (pedido do usuário 2026-09-17), o anexo já aparece sozinho.
    if (!text && payload.type && payload.type !== 'text' && !attachment) {
      text = PLACEHOLDER_BY_TYPE[payload.type] || '[Mensagem]';
    }
    if (!text && !attachment) return;

    // Citação feita pelo cliente (ver resolveInboundQuote).
    const replyTo = await this.resolveInboundQuote(session, payload.quoted);

    const metadata: Record<string, any> = {
      source: 'pyvon',
      channel_id: payload.channel_id,
      ...(attachment ? { attachments: [attachment] } : {}),
      ...(replyTo ? { replyTo } : {})
    };

    // session.customer_name (não a `name` do payload) — é o nome já resolvido
    // contra o cadastro em findOrCreateSession; usar o nome cru do WhatsApp/
    // Pyvon aqui reintroduziria o mesmo bug corrigido no nome da conversa
    // (mensagem, notificação e SSE mostrando o nome salvo no celular do
    // contato em vez do nome cadastrado, mesmo com a sessão já certa).
    const messageRes = await query(
      `INSERT INTO public.chat_messages (session_id, sender_id, sender_name, text, type, metadata, pyvon_message_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id, created_at`,
      [session.id, session.customer_id || null, session.customer_name, text, attachment ? 'file' : 'text', JSON.stringify(metadata), messageIdStr]
    );
    const savedMessage = messageRes.rows[0];
    if (!savedMessage) return;

    await query('UPDATE public.chat_sessions SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1', [session.id]);

    // Autor da nota / de quem abriu o chamado (ver automation-service.ts):
    // a conversa só vai pra ele agora, na primeira resposta do cliente
    // (decisão do usuário, 2026-09-22), e só se ele estiver online na fila
    // (2026-09-24). Precisa rodar ANTES da redistribuição de pendentes logo
    // abaixo — senão o rodízio pega a conversa primeiro e o autor nunca tem
    // vez. Sem elegibilidade, não faz nada e o rodízio segue normalmente.
    const pendingText: string | null = session.pyvon_pending_note_text || null;
    const pendingAuthorId: string | null = session.pyvon_pending_note_author_id || null;
    if (pendingAuthorId) {
      try {
        await this.assignToPendingAuthorIfOnline(session, pendingAuthorId, savedMessage.id);
      } catch (err) {
        console.error('[Pyvon] Falha ao atribuir a conversa ao autor pendente:', err);
      }
    }

    // Conversa que ficou 'pending' por não haver ninguém online quando
    // chegou tenta a distribuição de novo a cada mensagem nova (mesmo
    // gatilho do widget e dos outros canais WhatsApp).
    try {
      const dispatched = await dispatchPendingChatSessions({ sessionId: session.id });
      dispatched.forEach(d => emitSessionsChanged({ reason: 'assigned', sessionId: d.sessionId }));
      await Promise.all(dispatched.map(d => notifyUser(d.assigneeId, {
        title: 'Novo atendimento atribuído a você',
        body: `${d.customerName || 'Cliente'} está aguardando atendimento.`,
        url: `/chat?chat=${d.sessionId}`,
        tag: `chat_assign:${d.sessionId}`
      })));
    } catch (err) {
      console.error('[Pyvon] Falha ao redistribuir atendimento pendente:', err);
    }

    emitSessionsChanged({ reason: 'message', sessionId: session.id });
    emitChatEvent(session.id, {
      type: 'message',
      sessionId: session.id,
      message: {
        id: savedMessage.id,
        senderId: session.customer_id || null,
        senderName: session.customer_name,
        text,
        timestamp: savedMessage.created_at,
        type: attachment ? 'file' : 'text',
        metadata,
        attachments: attachment ? [attachment] : []
      }
    });

    getChatRecipientIds({ customerId: session.customer_id, assigneeId: session.assignee_id, queueId: session.queue_id }, null, false)
      .then(recipients => excludeActiveViewers(session.id, recipients))
      .then(recipients => Promise.all(recipients.map(id => notifyUser(id, {
        title: `Nova mensagem de ${session.customer_name}`,
        body: text || 'Anexo enviado',
        url: `/chat?chat=${session.id}`,
        tag: `chat_message:${savedMessage.id}`
      }))))
      .catch(err => console.error('[Pyvon] Falha ao notificar mensagem via push:', err));

    if (attachment && isTranscriptionEnabled() && isAudioAttachment(attachment)) {
      transcribeMessageAudio({ messageId: savedMessage.id, sessionId: session.id, attachment }).catch(err => {
        console.error('[Pyvon] Falha ao transcrever áudio automaticamente:', err);
      });
    }

    // Nota do "Histórico Cliente" enviada via template atualizacao_chamado
    // (ver dispatchTicketUpdateTemplate em automation-service.ts): só a
    // mensagem IMEDIATAMENTE seguinte do cliente decide se ela sai sozinha —
    // por isso o campo é sempre limpo aqui, dê "prosseguir" ou não. Qualquer
    // outra resposta fica pro analista decidir manualmente, como sempre.
    //
    // A atribuição ao autor (acima) vale pra qualquer resposta, não só
    // "Prosseguir": isProsseguir decide apenas se o TEXTO da nota é reenviado
    // como mensagem, é um critério à parte de "o cliente respondeu". Aqui só
    // se consome o pendente — a chamada de "abriu o chamado" não tem texto,
    // só autor, e também precisa ser limpa.
    if (pendingText || pendingAuthorId) {
      await query(
        `UPDATE public.chat_sessions
         SET pyvon_pending_note_text = NULL, pyvon_pending_note_set_at = NULL, pyvon_pending_note_author_id = NULL
         WHERE id = $1`,
        [session.id]
      );
      const isProsseguir = text.trim().toLowerCase().replace(/[.,!?]+$/, '') === 'prosseguir';
      if (pendingText && isProsseguir) {
        this.sendAutomaticNoteReply(instanceId, session, pendingText, pendingAuthorId).catch(err => {
          console.error('[Pyvon] Falha ao enviar nota automática após "Prosseguir":', err);
        });
      }
    }
  }

  // O template de "chamado atualizado" (ver dispatchTicketUpdateTemplate em
  // automation-service.ts) nasce numa conversa própria e guarda a NOTA e o AUTOR
  // pendentes NELA. Se um analista fecha essa conversa antes de o cliente
  // responder (aconteceu em 2026-09-25: fechada 16s depois, o cliente mandou
  // "Prosseguir" 20s depois), a resposta cai numa conversa NOVA que não tem a
  // nota — e ela nunca era enviada, ficando esquecida na conversa fechada.
  //
  // Aqui, se a conversa que está recebendo a resposta não tem nada pendente,
  // busca a conversa FECHADA mais recente do mesmo contato (telefone ou
  // cadastro) com nota/autor pendente nas últimas 48h e move o pendente pra
  // cá. O UPDATE ... RETURNING na antiga garante que só UMA resposta adota
  // (retentativa de webhook ou duas mensagens seguidas não duplicam a nota).
  // Janela de 48h pra um pendente esquecido não reaparecer dias depois numa
  // conversa que não tem nada a ver.
  private static async adoptPendingNoteFromClosedSession(session: any, variants: string[], cadastroId: number): Promise<void> {
    if (session.pyvon_pending_note_text || session.pyvon_pending_note_author_id) return;

    const params: any[] = [session.id, cadastroId];
    let phoneClause = '';
    if (variants.length) {
      phoneClause = ` OR customer_phone IN (${variants.map((_, i) => `$${i + 3}`).join(',')})`;
      params.push(...variants);
    }
    // A CTE lê os valores ANTIGOS (picked) e só então limpa (cleared): o
    // RETURNING de um UPDATE devolveria os já anulados.
    const adoptedRes = await query(
      `WITH picked AS (
         SELECT id, pyvon_pending_note_text AS text, pyvon_pending_note_author_id AS author_id
           FROM public.chat_sessions
          WHERE id <> $1 AND status = 'closed'
            AND (pyvon_cadastro_id = $2${phoneClause})
            AND (pyvon_pending_note_text IS NOT NULL OR pyvon_pending_note_author_id IS NOT NULL)
            AND COALESCE(pyvon_pending_note_set_at, updated_at) > NOW() - INTERVAL '48 hours'
          ORDER BY COALESCE(pyvon_pending_note_set_at, updated_at) DESC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       ), cleared AS (
         UPDATE public.chat_sessions s
            SET pyvon_pending_note_text = NULL, pyvon_pending_note_set_at = NULL, pyvon_pending_note_author_id = NULL
          WHERE s.id IN (SELECT id FROM picked)
         RETURNING s.id
       )
       SELECT p.text, p.author_id FROM picked p JOIN cleared c ON c.id = p.id`,
      params
    );
    const adopted = adoptedRes.rows[0];
    if (!adopted) return;

    await query(
      `UPDATE public.chat_sessions
          SET pyvon_pending_note_text = $1, pyvon_pending_note_set_at = NOW(), pyvon_pending_note_author_id = $2
        WHERE id = $3`,
      [adopted.text, adopted.author_id, session.id]
    );
    // O resto do handleWebhook lê estes campos direto do objeto da sessão.
    session.pyvon_pending_note_text = adopted.text;
    session.pyvon_pending_note_author_id = adopted.author_id;
  }

  // Manda a conversa pro autor da nota / de quem abriu o chamado — só se ele
  // puder atender agora (online e membro da fila da conversa, mesma régua do
  // rodízio: isOnlineQueueMember). Se não puder, não faz nada aqui e a
  // conversa segue o rodízio da fila (dispatchPendingChatSessions, em
  // handleWebhook, ou o responsável que o rodízio já tinha escolhido).
  //
  // Troca um responsável já existente SÓ quando a conversa nasceu do próprio
  // template automático e ninguém mexeu nela: nenhuma mensagem além dos
  // templates/respostas automáticas e a resposta atual do cliente. Nesse caso
  // o responsável foi só o palpite do rodízio no envio do template, não um
  // atendimento em curso. Conversa com histórico nunca troca de dono.
  private static async assignToPendingAuthorIfOnline(session: any, authorId: string, currentMessageId: string): Promise<void> {
    if (session.assignee_id === authorId) return;

    const queue = session.queue_id ? await resolveQueueById(session.queue_id) : null;
    if (!(await isOnlineQueueMember(authorId, queue))) return;

    const res = await query(
      `UPDATE public.chat_sessions SET assignee_id = $1, status = 'active', updated_at = NOW()
        WHERE id = $2
          AND (
            assignee_id IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM public.chat_messages m
               WHERE m.session_id = $2 AND m.id <> $3
                 AND COALESCE(m.metadata->>'template', 'false') <> 'true'
                 AND COALESCE(m.metadata->>'auto_reply', 'false') <> 'true'
            )
          )
        RETURNING id`,
      [authorId, session.id, currentMessageId]
    );
    if ((res.rowCount ?? 0) > 0) {
      session.assignee_id = authorId;
      emitSessionsChanged({ reason: 'assigned', sessionId: session.id });
    }
  }

  // Depois que o cliente confirma com "Prosseguir" (ver handleWebhook acima),
  // manda o texto da nota como mensagem normal (já dentro da janela — o
  // cliente acabou de escrever) e registra no chat como resposta do autor de
  // verdade (pyvon_pending_note_author_id, gravado em dispatchTicketUpdate
  // Template/automation-service.ts) — nome em negrito antes do texto pro
  // cliente saber quem está escrevendo (mesma regra do envio manual em
  // chat-widget.tsx), igual sempre "SSX Desk (automático)" só se o autor não
  // existir mais (perfil excluído).
  private static async sendAutomaticNoteReply(instanceId: string, session: any, noteText: string, authorId: string | null): Promise<void> {
    let authorName: string | null = null;
    if (authorId) {
      const authorRes = await query('SELECT name FROM public.profiles WHERE id = $1', [authorId]);
      authorName = authorRes.rows[0]?.name || null;
    }
    const contentForPyvon = authorName ? `*${authorName}*\n\n${noteText}` : noteText;

    const result = await this.sendMessage(
      instanceId,
      { cadastroId: session.pyvon_cadastro_id || undefined, phone: session.customer_phone || undefined, name: session.customer_name || undefined },
      contentForPyvon
    );
    if (result.skipped || (result.delivery && result.delivery !== 'sent')) {
      console.warn(`[Pyvon] Nota automática não entregue (sessão ${session.id}): ${result.skipped || result.delivery_error || result.delivery}`);
      return;
    }

    const senderName = authorName || 'SSX Desk (automático)';
    const metadata = { source: 'pyvon', auto_reply: true };
    const messageRes = await query(
      `INSERT INTO public.chat_messages (session_id, sender_id, sender_name, text, type, metadata, created_at)
       VALUES ($1, $2, $3, $4, 'text', $5, NOW())
       RETURNING id, created_at`,
      [session.id, authorName ? authorId : null, senderName, noteText, JSON.stringify(metadata)]
    );
    const savedMessage = messageRes.rows[0];
    if (!savedMessage) return;

    await query('UPDATE public.chat_sessions SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1', [session.id]);

    emitSessionsChanged({ reason: 'message', sessionId: session.id });
    emitChatEvent(session.id, {
      type: 'message',
      sessionId: session.id,
      message: {
        id: savedMessage.id,
        senderId: authorName ? authorId : null,
        senderName,
        text: noteText,
        timestamp: savedMessage.created_at,
        type: 'text',
        metadata,
        attachments: []
      }
    });
  }

  // Modo de Crise (ver crisis-mode-service.ts) — chamado só para sessão
  // recém-criada (findOrCreateSession), nunca para conversa já existente.
  // Mesma checagem de delivery que sendAutomaticNoteReply: só grava no
  // histórico se o Pyvon confirmou o envio, senão o analista veria uma
  // mensagem marcada como enviada que o cliente nunca recebeu.
  private static async maybeSendCrisisModeMessage(instanceId: string, session: any): Promise<void> {
    if (!(await isCrisisModeEnabled())) return;
    const text = await getCrisisModeMessage();
    const result = await this.sendMessage(
      instanceId,
      { cadastroId: session.pyvon_cadastro_id || undefined, phone: session.customer_phone || undefined, name: session.customer_name || undefined },
      text
    );
    if (result.skipped || (result.delivery && result.delivery !== 'sent')) {
      console.warn(`[Pyvon] Mensagem do Modo de Crise não entregue (sessão ${session.id}): ${result.skipped || result.delivery_error || result.delivery}`);
      return;
    }
    await recordCrisisModeMessage(session.id, text);
  }

  // Cliente respondeu CITANDO uma mensagem (campo quoted do webhook, v1.15). Se a
  // mensagem citada é uma que o nosso banco conhece (do cliente, ou nossa já com
  // o id do Pyvon guardado) e é DESTA conversa, a citação sai do banco — mesmo
  // formato e mesmo vínculo (clicar leva até ela) da citação feita pela equipe.
  // Senão (ex.: template/mensagem do bot, conversa anterior já encerrada), usa o
  // que o Pyvon mandou no payload, sem vínculo. Falha aqui nunca derruba o
  // recebimento da mensagem do cliente.
  private static async resolveInboundQuote(
    session: { id: string; customer_name?: string | null },
    quoted: PyvonInboundPayload['quoted']
  ): Promise<{ messageId?: string; senderName?: string | null; text?: string; kind?: 'text' | 'image' | 'audio' | 'video' | 'file' } | null> {
    if (!quoted || quoted.message_id == null) return null;

    try {
      const found = await query(
        'SELECT id FROM public.chat_messages WHERE pyvon_message_id = $1 AND session_id = $2',
        [String(quoted.message_id), session.id]
      );
      if (found.rows[0]) {
        const fromDb = await resolveReplyQuote(session.id, found.rows[0].id);
        if (fromDb) return fromDb;
      }
    } catch (err) {
      console.error('[Pyvon] Falha ao localizar a mensagem citada pelo cliente:', err);
    }

    const type = quoted.type || 'text';
    const kind = type === 'text' ? 'text'
      : (type === 'image' || type === 'sticker') ? 'image'
      : type === 'audio' ? 'audio'
      : type === 'video' ? 'video'
      : 'file';
    return {
      senderName: quoted.direction === 'inbound'
        ? (session.customer_name || 'Cliente')
        : (quoted.sent_by_bot ? 'SSX Desk (automático)' : 'Equipe'),
      text: String(quoted.content || '').trim().slice(0, 200),
      kind
    };
  }

  // (A resposta "1"/"0" à pesquisa de satisfação é tratada ANTES daqui, em
  // tryRecordSurveyAnswer.)
  static async findOrCreateSession(
    variants: string[],
    cadastroId: number,
    name: string,
    instanceId: string,
    options?: { preferredAssigneeId?: string | null }
  ) {
    const placeHoldersFor = (arr: string[]) => arr.map((_, i) => `$${i + 1}`).join(',');

    if (variants.length) {
      const existing = await query(
        `SELECT id, customer_phone, customer_id, customer_name, assignee_id, queue_id, pyvon_cadastro_id, pyvon_pending_note_text, pyvon_pending_note_author_id
           FROM public.chat_sessions
          WHERE customer_phone IN (${placeHoldersFor(variants)}) AND status != 'closed'
          ORDER BY updated_at DESC LIMIT 1`,
        variants
      );
      if (existing.rows[0]) return existing.rows[0];
    } else {
      // Canal sem telefone exposto (ex.: Instagram) — casa só pelo cadastro_id.
      const existing = await query(
        `SELECT id, customer_phone, customer_id, customer_name, assignee_id, queue_id, pyvon_cadastro_id, pyvon_pending_note_text, pyvon_pending_note_author_id
           FROM public.chat_sessions
          WHERE pyvon_cadastro_id = $1 AND status != 'closed'
          ORDER BY updated_at DESC LIMIT 1`,
        [cadastroId]
      );
      if (existing.rows[0]) return existing.rows[0];
    }

    const digits = variants[0] || null;
    // regexp_replace: profiles.phone é salvo com máscara ((21) 99177-8567) —
    // comparar sem normalizar os dois lados nunca batia, e a conversa nascia
    // com o nome de exibição do WhatsApp/Pyvon em vez do nome cadastrado
    // (mesma correção em whatsapp-service.ts).
    const profileRes = variants.length
      ? await query(
          `SELECT id, name FROM public.profiles
           WHERE regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') IN (${placeHoldersFor(variants)})
           LIMIT 1`,
          variants
        )
      : { rows: [] as any[] };
    const profile = profileRes.rows[0];
    const customerName = profile?.name || name;

    const queue = await resolveQueueForInstance(instanceId);

    const { insertRes } = await runExclusive(`queue-assign:${queue?.id ?? 'combined'}`, async () => {
      // Autor da nota/de quem abriu o chamado (template guardado): a conversa
      // nasce direto com ele, mas só se ele puder atender agora (online e da
      // fila) — senão, o rodízio de sempre. Não gasta a vez de ninguém no rodízio.
      const preferred = options?.preferredAssigneeId || null;
      const assigneeId = preferred && (await isOnlineQueueMember(preferred, queue))
        ? preferred
        : (queue ? await pickNextQueueAssignee(queue) : null);
      const status = assigneeId ? 'active' : 'pending';
      const insertRes = await query(
        `INSERT INTO public.chat_sessions (customer_id, customer_name, customer_phone, status, queue_id, assignee_id, pyvon_cadastro_id, channel, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pyvon', NOW(), NOW())
         ON CONFLICT (customer_phone) WHERE status <> 'closed' AND customer_phone IS NOT NULL
         DO NOTHING
         RETURNING id, customer_phone, customer_id, customer_name, assignee_id, queue_id, pyvon_cadastro_id, pyvon_pending_note_text, pyvon_pending_note_author_id`,
        [profile?.id || null, customerName, digits, status, queue?.id || null, assigneeId, cadastroId]
      );
      return { insertRes };
    });

    if (insertRes.rows[0]) {
      const newSession = insertRes.rows[0];
      // Modo de Crise (ver crisis-mode-service.ts) — disparo sem bloquear o
      // processamento da mensagem real que originou esta sessão.
      this.maybeSendCrisisModeMessage(instanceId, newSession).catch(err => {
        console.error('[Pyvon] Falha ao enviar mensagem do Modo de Crise:', err?.message || err);
      });
      return newSession;
    }

    // Perdeu a corrida contra outro processo — usa a sessão que venceu.
    if (variants.length) {
      const retryRes = await query(
        `SELECT id, customer_phone, customer_id, customer_name, assignee_id, queue_id, pyvon_cadastro_id, pyvon_pending_note_text, pyvon_pending_note_author_id
           FROM public.chat_sessions WHERE customer_phone IN (${placeHoldersFor(variants)})
          ORDER BY updated_at DESC LIMIT 1`,
        variants
      );
      return retryRes.rows[0] || null;
    }
    return null;
  }

  private static async downloadMedia(pyvonMessageId: number, instanceId: string): Promise<Attachment | null> {
    const { secret, baseUrl } = await this.getCredentials(instanceId);
    const url = `${baseUrl}/api/webhook/media/${pyvonMessageId}`;

    // Download no Pyvon é assíncrono e pode levar centenas de ms depois do
    // webhook — 404 na primeira tentativa é esperado; espera 1s e tenta de
    // novo antes de desistir (documentado pelo próprio Pyvon).
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await axios.get(url, {
        headers: { 'X-Pyvon-Secret': secret },
        responseType: 'arraybuffer',
        validateStatus: () => true
      });
      if (res.status === 200) {
        const mimeType = (res.headers['content-type'] as string) || 'application/octet-stream';
        const disposition = (res.headers['content-disposition'] as string) || '';
        const fileName = disposition.match(/filename="?([^"]+)"?/)?.[1];
        const buffer = Buffer.from(res.data);
        const stored = await storeAttachmentBuffer(buffer, mimeType, fileName);
        return { id: crypto.randomUUID(), name: fileName || `pyvon-${pyvonMessageId}`, type: mimeType, url: stored.url, size: stored.size };
      }
      if (res.status === 404 && attempt === 0) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      return null;
    }
    return null;
  }

  // ------------------------------------------------------------ saída (envio)

  // Identifica o contato por cadastroId OU por phone (+name, usado só se o
  // Pyvon precisar criar o contato na hora) — desde a v1.6.4 do contrato,
  // bot-response aceita as duas formas. cadastroId, quando disponível, tem
  // prioridade (identificador mais forte, sem risco de ambiguidade).
  static async sendMessage(
    instanceId: string,
    target: { cadastroId?: number; phone?: string; name?: string },
    content?: string,
    opts?: { imageUrl?: string; documentUrl?: string; audioUrl?: string; channelId?: number; replyToMessageId?: number }
  ): Promise<{ ok: boolean; message_id?: number; skipped?: string; delivery?: 'sent' | 'failed' | 'not_sent'; delivery_error?: string }> {
    const { secret, baseUrl, channelId } = await this.getCredentials(instanceId);
    const res = await axios.post(
      `${baseUrl}/api/webhook/bot-response`,
      {
        cadastro_id: target.cadastroId,
        phone: target.cadastroId ? undefined : target.phone,
        name: target.cadastroId ? undefined : target.name,
        content,
        // Cita uma mensagem da conversa, como o "responder" do WhatsApp (v1.14
        // do contrato). É o message_id DO PYVON — o do inbound, ou o devolvido
        // por um bot-response/bot-template anterior —, precisa ser da mesma
        // conversa e já ter sido entregue ao WhatsApp; senão o Pyvon responde
        // 422 e não envia nada (quem chama trata, ver app/api/whatsapp/send).
        reply_to_message_id: opts?.replyToMessageId,
        image_url: opts?.imageUrl,
        document_url: opts?.documentUrl,
        // audio_url: Pyvon baixa, converte pra OGG/Opus e entrega como
        // mensagem de voz — sem legenda embutida (diferente de imagem/
        // documento), o `content` sai antes como texto separado. Só usar
        // quando NENHUM dos outros dois estiver setado (prioridade deles é
        // maior no próprio Pyvon: document_url > image_url > audio_url), mas
        // quem chama já garante isso (resolvePyvonMediaUrl manda só um).
        audio_url: opts?.audioUrl,
        // channel_id: obrigatório quando o tenant tem mais de um canal oficial
        // ativo (bot-response/bot-template recusam com 422 sem ele) — vem do
        // canal padrão configurado em Configurações > WhatsApp
        // (whatsapp_instances.pyvon_channel_id), a menos que quem chamou
        // explicitamente informe outro.
        channel_id: opts?.channelId ?? channelId
      },
      { headers: { 'X-Pyvon-Secret': secret } }
    );
    if (res.data?.skipped) {
      // 200 "aceito" mas nada foi enviado nem registrado (modo de teste do
      // tenant, homologação sem contato marcado como teste, ou contato
      // interno de suporte do Pyvon) — nunca tratar como entregue.
      console.warn(`[Pyvon] Envio ignorado (${res.data.skipped}) para ${target.cadastroId ? `cadastro_id=${target.cadastroId}` : `phone=${target.phone}`}`);
    } else if (res.data?.delivery && res.data.delivery !== 'sent') {
      // bot-response responde 200 (aceito e registrado no histórico) mesmo
      // quando o envio ao provedor falhou de verdade (ex.: janela de 24h
      // fechada) — o único jeito de saber é olhar `delivery`/`delivery_error`
      // na mesma resposta. Sem isso, a mensagem aparecia como "enviada" no
      // nosso chat mesmo nunca tendo chegado no WhatsApp do cliente.
      console.warn(`[Pyvon] Envio não entregue (${res.data.delivery}): ${res.data.delivery_error || 'sem motivo informado'}`);
    }
    return res.data;
  }

  static async sendTemplate(instanceId: string, params: {
    templateName: string;
    cadastroId?: number;
    phone?: string;
    name?: string;
    language?: string;
    variables?: Record<string, string>;
    channelId?: number;
    contentPreview?: string;
  }): Promise<{ ok: boolean; cadastro_id?: number; created?: boolean; message_id?: number; skipped?: string }> {
    const { secret, baseUrl, channelId } = await this.getCredentials(instanceId);
    const res = await axios.post(
      `${baseUrl}/api/webhook/bot-template`,
      {
        template_name: params.templateName,
        cadastro_id: params.cadastroId,
        phone: params.phone,
        name: params.name,
        language: params.language || 'pt_BR',
        variables: params.variables,
        // Mesmo canal padrão de sendMessage acima — só sobrepõe se quem
        // chamou informar um channel_id explícito.
        channel_id: params.channelId ?? channelId,
        content_preview: params.contentPreview
      },
      { headers: { 'X-Pyvon-Secret': secret } }
    );
    if (res.data?.skipped) {
      // Desde a v1.6.1 do contrato: bot-template também pode responder 200
      // com `skipped` em vez de `201`+message_id (bot-debug-mode ou
      // bot-reply-test-only) — o contato pode até existir/ter sido criado
      // (cadastro_id presente), mas NADA foi enviado. Nunca tratar como
      // sucesso só porque cadastro_id veio preenchido.
      console.warn(`[Pyvon] Template ignorado (${res.data.skipped}) para template=${params.templateName}`);
    }
    return res.data;
  }

  static async listChannels(instanceId: string): Promise<any[]> {
    const { secret, baseUrl } = await this.getCredentials(instanceId);
    const res = await axios.get(`${baseUrl}/api/webhook/channels`, { headers: { 'X-Pyvon-Secret': secret } });
    return res.data?.channels || [];
  }

  // ------------------------------------------------------ suporte à automação

  /** Único canal Pyvon configurado (ou null se nenhum) — usado pela automação
   *  pra decidir se tenta esse canal antes do Baileys 'default'. */
  static async getSoleInstanceId(): Promise<string | null> {
    const res = await query(`SELECT id FROM public.whatsapp_instances WHERE provider = 'pyvon' LIMIT 1`);
    return res.rows[0]?.id || null;
  }

  /**
   * Resolve, a partir de um telefone (sem contexto de sessão), se já existe
   * relacionamento Pyvon conhecido (cadastro_id) e se a janela de 24h está
   * aberta — calculada aqui, não reagindo a erro do Pyvon (ver comentário no
   * topo do arquivo: bot-response nunca avisa quando a entrega falha).
   */
  static async resolveOutboundContext(phone: string): Promise<{ sessionId: string | null; cadastroId: number | null; withinWindow: boolean }> {
    const variants = phoneVariants(phone);
    if (!variants.length) return { sessionId: null, cadastroId: null, withinWindow: false };

    const placeHolders = variants.map((_, i) => `$${i + 1}`).join(',');
    const sessionRes = await query(
      `SELECT id, pyvon_cadastro_id FROM public.chat_sessions
        WHERE customer_phone IN (${placeHolders}) AND pyvon_cadastro_id IS NOT NULL
        ORDER BY updated_at DESC LIMIT 1`,
      variants
    );
    const session = sessionRes.rows[0];
    if (!session) return { sessionId: null, cadastroId: null, withinWindow: false };

    // Última mensagem GENUINAMENTE recebida do cliente por este canal (não
    // conta o próprio disparo de template, marcado com metadata.template).
    const windowRes = await query(
      `SELECT MAX(created_at) AS last_inbound FROM public.chat_messages
        WHERE session_id = $1 AND metadata->>'source' = 'pyvon'
          AND COALESCE(metadata->>'template', 'false') <> 'true'`,
      [session.id]
    );
    const lastInbound = windowRes.rows[0]?.last_inbound;
    const withinWindow = !!lastInbound && (Date.now() - new Date(lastInbound).getTime()) < 24 * 3600 * 1000;

    return { sessionId: session.id, cadastroId: session.pyvon_cadastro_id, withinWindow };
  }

  // Depois de iniciar conversa via template (bot-template), registra a
  // sessão/mensagem do nosso lado — sem isso, o analista mandaria o template
  // e nunca veria essa conversa aparecer no chat, mesmo tendo sido entregue.
  // A resposta do cliente chega depois pelo fluxo normal do webhook (§4), que
  // encontra esta MESMA sessão pelo telefone.
  // Pesquisa de satisfação (Pyvon): o cliente responde "1" (satisfeito) ou "0"
  // (poderia melhorar) — mesma regra do WhatsApp não oficial
  // (findSurveyableClosedSession em whatsapp-service.ts). A resposta é gravada na
  // conversa ENCERRADA que mandou a pesquisa, enquanto a janela
  // (awaiting_survey_until, 24h por padrão) está aberta; a nota entra em
  // chat_histories.rating na escala -1/1 (o "0" do cliente vira -1 — gravar o
  // dígito cru faria a avaliação ruim virar "neutro" e sumir das contagens).
  //
  // Só vale quando o contato NÃO tem conversa aberta: com um atendimento em
  // curso, um "1" é resposta de conversa ("digite 1 pra opção A"), não nota.
  // Devolve true quando tratou a mensagem (o chamador não abre conversa).
  private static async tryRecordSurveyAnswer(payload: PyvonInboundPayload, variants: string[], messageIdStr: string): Promise<boolean> {
    if (payload.type && payload.type !== 'text') return false;
    const answer = String(payload.content || '').trim().replace(/[.!]+$/, '');
    if (answer !== '0' && answer !== '1') return false;

    if (await this.findOpenSession(variants, payload.cadastro_id)) return false;

    const params: any[] = [payload.cadastro_id];
    let phoneClause = '';
    if (variants.length) {
      phoneClause = ` OR customer_phone IN (${variants.map((_, i) => `$${i + 2}`).join(',')})`;
      params.push(...variants);
    }
    const sessionRes = await query(
      `SELECT id, customer_id, customer_name
         FROM public.chat_sessions
        WHERE status = 'closed'
          AND awaiting_survey_until IS NOT NULL AND awaiting_survey_until > NOW()
          AND (pyvon_cadastro_id = $1${phoneClause})
        ORDER BY updated_at DESC
        LIMIT 1`,
      params
    );
    const session = sessionRes.rows[0];
    if (!session) return false;

    const senderName = session.customer_name || payload.cadastro_name || 'Contato Pyvon';
    const metadata = { source: 'pyvon', channel_id: payload.channel_id, survey_response: true };
    const msgRes = await query(
      `INSERT INTO public.chat_messages (session_id, sender_id, sender_name, text, type, metadata, pyvon_message_id, created_at)
       VALUES ($1, $2, $3, $4, 'text', $5, $6, NOW())
       RETURNING id, created_at`,
      [session.id, session.customer_id || null, senderName, String(payload.content).trim(), JSON.stringify(metadata), messageIdStr]
    );
    await query(
      `UPDATE public.chat_histories SET rating = $1, rating_at = NOW()
        WHERE id = (SELECT id FROM public.chat_histories WHERE session_id = $2 ORDER BY created_at DESC LIMIT 1)`,
      [answer === '1' ? 1 : -1, session.id]
    );
    await query('UPDATE public.chat_sessions SET awaiting_survey_until = NULL WHERE id = $1', [session.id]);

    const saved = msgRes.rows[0];
    if (saved) {
      emitChatEvent(session.id, {
        type: 'survey-response',
        sessionId: session.id,
        message: {
          id: saved.id,
          senderId: session.customer_id || null,
          senderName,
          text: String(payload.content).trim(),
          timestamp: saved.created_at,
          type: 'text',
          metadata,
          attachments: []
        }
      });
    }
    return true;
  }

  // Conversa ABERTA do contato (mesma busca de findOrCreateSession, sem criar).
  static async findOpenSession(variants: string[], cadastroId: number) {
    if (variants.length) {
      const res = await query(
        `SELECT id, customer_phone, customer_id, customer_name, assignee_id, queue_id, pyvon_cadastro_id, pyvon_pending_note_text, pyvon_pending_note_author_id
           FROM public.chat_sessions
          WHERE customer_phone IN (${variants.map((_, i) => `$${i + 1}`).join(',')}) AND status != 'closed'
          ORDER BY updated_at DESC LIMIT 1`,
        variants
      );
      return res.rows[0] || null;
    }
    const res = await query(
      `SELECT id, customer_phone, customer_id, customer_name, assignee_id, queue_id, pyvon_cadastro_id, pyvon_pending_note_text, pyvon_pending_note_author_id
         FROM public.chat_sessions WHERE pyvon_cadastro_id = $1 AND status != 'closed'
        ORDER BY updated_at DESC LIMIT 1`,
      [cadastroId]
    );
    return res.rows[0] || null;
  }

  private static async savePendingOutbound(params: {
    instanceId: string; phone?: string; cadastroId: number; customerName: string; analystName: string; text: string;
    pending?: { noteText?: string | null; authorId?: string | null };
  }, variants: string[]): Promise<void> {
    await query(
      `INSERT INTO public.pyvon_pending_outbound (cadastro_id, phone, customer_name, instance_id, template_text, sender_name, note_text, note_author_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [params.cadastroId, variants[0] || null, params.customerName, params.instanceId, params.text, params.analystName,
       params.pending?.noteText || null, params.pending?.authorId || null]
    );
  }

  // Filtro das linhas pendentes do contato: pelo cadastro OU pelo telefone.
  private static pendingOutboundWhere(variants: string[], cadastroId: number): { sql: string; params: any[] } {
    const params: any[] = [cadastroId];
    let sql = 'cadastro_id = $1';
    if (variants.length) {
      sql += ` OR phone IN (${variants.map((_, i) => `$${i + 2}`).join(',')})`;
      params.push(...variants);
    }
    return { sql, params };
  }

  // Autor que vale pra conversa que vai nascer: o da nota mais recente; sem
  // nota, o de quem abriu o chamado mais recente. Só olha as últimas 48h.
  private static async peekPendingOutboundAuthor(variants: string[], cadastroId: number): Promise<string | null> {
    const w = this.pendingOutboundWhere(variants, cadastroId);
    const res = await query(
      `SELECT note_author_id FROM public.pyvon_pending_outbound
        WHERE (${w.sql}) AND note_author_id IS NOT NULL AND created_at > NOW() - INTERVAL '48 hours'
        ORDER BY (note_text IS NOT NULL) DESC, created_at DESC LIMIT 1`,
      w.params
    );
    return res.rows[0]?.note_author_id || null;
  }

  // O cliente respondeu: consome os templates guardados do contato. O DELETE ...
  // RETURNING é atômico — só uma resposta leva as linhas (retentativa de
  // webhook ou duas mensagens seguidas não duplicam nada). Linhas com mais de
  // 48h são apagadas mas NÃO usadas.
  //   - cada template vira mensagem da conversa, com a hora em que foi enviado
  //     (aparece antes da resposta do cliente, como histórico);
  //   - a nota/autor viram os pendentes da conversa (se ela ainda não tem).
  private static async adoptPendingOutbound(session: any, variants: string[], cadastroId: number): Promise<void> {
    const w = this.pendingOutboundWhere(variants, cadastroId);
    const takenRes = await query(
      `DELETE FROM public.pyvon_pending_outbound WHERE ${w.sql}
       RETURNING sender_name, template_text, note_text, note_author_id, created_at,
                 (created_at > NOW() - INTERVAL '48 hours') AS fresh`,
      w.params
    );
    const rows = takenRes.rows.filter((r: any) => r.fresh).sort((a: any, b: any) => +new Date(a.created_at) - +new Date(b.created_at));
    if (!rows.length) return;

    for (const r of rows) {
      await query(
        `INSERT INTO public.chat_messages (session_id, sender_id, sender_name, text, type, metadata, created_at)
         VALUES ($1, NULL, $2, $3, 'text', $4, $5)`,
        [session.id, r.sender_name, r.template_text, JSON.stringify({ source: 'pyvon', template: true }), r.created_at]
      );
    }

    if (session.pyvon_pending_note_text || session.pyvon_pending_note_author_id) return;
    const withNote = [...rows].reverse().find((r: any) => r.note_text);
    const withAuthor = withNote || [...rows].reverse().find((r: any) => r.note_author_id);
    if (!withAuthor) return;
    const text = withNote ? withNote.note_text : null;
    const authorId = withAuthor.note_author_id || null;
    await query(
      `UPDATE public.chat_sessions
          SET pyvon_pending_note_text = $1, pyvon_pending_note_set_at = CASE WHEN $1::text IS NULL THEN NULL ELSE NOW() END, pyvon_pending_note_author_id = $2
        WHERE id = $3`,
      [text, authorId, session.id]
    );
    session.pyvon_pending_note_text = text;
    session.pyvon_pending_note_author_id = authorId;
  }

  static async recordOutboundTemplateMessage(params: {
    instanceId: string;
    phone?: string;
    cadastroId: number;
    customerName: string;
    analystId: string | null;
    analystName: string;
    text: string;
    // Template AUTOMÁTICO (chamado aberto, nota no chamado, mensagem fora da
    // janela): se o contato NÃO tem conversa aberta, não cria conversa — guarda
    // o template (tabela pyvon_pending_outbound) e ele só entra numa conversa
    // quando o cliente responder. Regra do usuário, 2026-09-25: conversa só
    // existe se o cliente responder. Sem isto (envio manual por analista,
    // "iniciar conversa"), cria a conversa como sempre.
    deferUntilReply?: boolean;
    // Nota / autor que valem na resposta do cliente (ver handleWebhook).
    pending?: { noteText?: string | null; authorId?: string | null };
  }): Promise<{ id: string | null } | null> {
    const variants = params.phone ? phoneVariants(params.phone) : [];

    let session: any = null;
    if (params.deferUntilReply) {
      const existing = await this.findOpenSession(variants, params.cadastroId);
      if (existing) {
        session = existing;
      } else {
        try {
          await this.savePendingOutbound(params, variants);
          return { id: null };
        } catch (err) {
          // Não perde a nota: cai no comportamento antigo (abre a conversa).
          console.error('[Pyvon] Falha ao guardar o template pendente — abrindo a conversa como antes:', err);
        }
      }
    }

    if (!session) {
      session = await runExclusive(`session:${variants[0] || `cadastro-${params.cadastroId}`}`, () =>
        this.findOrCreateSession(variants, params.cadastroId, params.customerName, params.instanceId)
      );
    }
    if (!session) return null;

    if (session.pyvon_cadastro_id !== params.cadastroId) {
      await query('UPDATE public.chat_sessions SET pyvon_cadastro_id = $1 WHERE id = $2', [params.cadastroId, session.id]);
    }

    const metadata = { source: 'pyvon', template: true };
    const messageRes = await query(
      `INSERT INTO public.chat_messages (session_id, sender_id, sender_name, text, type, metadata, created_at)
       VALUES ($1, $2, $3, $4, 'text', $5, NOW())
       RETURNING id, created_at`,
      [session.id, params.analystId, params.analystName, params.text, JSON.stringify(metadata)]
    );
    const savedMessage = messageRes.rows[0];
    if (!savedMessage) return null;

    await query('UPDATE public.chat_sessions SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1', [session.id]);

    // Nota / autor pendentes NESTA conversa (já existia uma aberta, ou o
    // fallback acima a criou): a nota vence; só o autor não pisa numa nota.
    if (params.pending?.noteText) {
      await query(
        `UPDATE public.chat_sessions
            SET pyvon_pending_note_text = $1, pyvon_pending_note_set_at = NOW(), pyvon_pending_note_author_id = $2
          WHERE id = $3`,
        [params.pending.noteText, params.pending.authorId || null, session.id]
      );
    } else if (params.pending?.authorId) {
      await query(
        `UPDATE public.chat_sessions SET pyvon_pending_note_author_id = $1
          WHERE id = $2 AND pyvon_pending_note_text IS NULL`,
        [params.pending.authorId, session.id]
      );
    }

    emitSessionsChanged({ reason: 'message', sessionId: session.id });
    emitChatEvent(session.id, {
      type: 'message',
      sessionId: session.id,
      message: {
        id: savedMessage.id,
        senderId: params.analystId,
        senderName: params.analystName,
        text: params.text,
        timestamp: savedMessage.created_at,
        type: 'text',
        metadata,
        attachments: []
      }
    });

    return { id: session.id };
  }

  // Substitui {{1}}, {{2}}... pelo valor de cada variável, na ORDEM da chave
  // numérica — mesma convenção que o próprio Pyvon/Meta usa no template
  // aprovado. Variável nomeada (não numérica) é substituída pelo nome
  // literal entre chaves (ex.: {{nome_unidade}}), mesma sintaxe.
  static renderTemplateBody(bodyText: string | null | undefined, variables: Record<string, string>): string {
    if (!bodyText) return '';
    return bodyText.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => variables[key] ?? match);
  }

  /**
   * Ponto único pra "iniciar conversa" nos dois lugares que abrem chat por
   * telefone (botão "Iniciar Conversa" em Empresas, e "+ Novo WhatsApp" no
   * chat widget) — decide sozinho, olhando a janela de 24h
   * (resolveOutboundContext), se dá pra abrir a conversa normal ou se precisa
   * mandar o template `contato_pos_vendas` antes. Sempre reivindica a
   * conversa pro analista que chamou, mas só quando ela ainda não tiver
   * responsável — não tira atendimento de quem já está atendendo.
   */
  static async startConversation(instanceId: string, params: {
    phone: string;
    name?: string;
    actorId: string;
    actorName: string;
  }): Promise<{ sessionId: string; usedTemplate: boolean }> {
    const customerName = params.name?.trim() || 'Cliente';
    const context = await this.resolveOutboundContext(params.phone);

    let sessionId: string;
    let usedTemplate: boolean;

    if (context.withinWindow && context.sessionId) {
      sessionId = context.sessionId;
      usedTemplate = false;
    } else {
      const templateRes = await query(
        `SELECT body_text FROM public.pyvon_templates WHERE template_name = 'contato_pos_vendas' AND is_active = true LIMIT 1`
      );
      const template = templateRes.rows[0];
      if (!template) {
        throw new Error('Template "contato_pos_vendas" não está cadastrado (ou está inativo) em Configurações > WhatsApp.');
      }

      const variables = { '1': customerName };
      const sendResult = await this.sendTemplate(instanceId, {
        templateName: 'contato_pos_vendas',
        phone: params.phone,
        name: customerName,
        cadastroId: context.cadastroId || undefined,
        variables
      });
      if (sendResult.skipped) {
        throw new Error(`Pyvon não enviou o template (${sendResult.skipped}).`);
      }
      if (!sendResult.cadastro_id) {
        throw new Error('Pyvon não retornou o cadastro_id do contato.');
      }

      const recorded = await this.recordOutboundTemplateMessage({
        instanceId,
        phone: params.phone,
        cadastroId: sendResult.cadastro_id,
        customerName,
        analystId: params.actorId,
        analystName: params.actorName,
        text: this.renderTemplateBody(template.body_text, variables) || `[template contato_pos_vendas]`
      });
      if (!recorded?.id) throw new Error('Falha ao registrar a conversa iniciada.');
      sessionId = recorded.id;
      usedTemplate = true;
    }

    await this.claimSessionIfUnassigned(sessionId, params.actorId);

    return { sessionId, usedTemplate };
  }

  // Reivindica a conversa pra quem chamou, só se ainda não tiver responsável
  // — nunca tira atendimento de quem já está atendendo. Usado depois de
  // qualquer envio automático que "começa" ou "reabre" contato em nome de um
  // analista específico (startConversation acima, dispatchTicketUpdateTemplate
  // em automation-service.ts).
  static async claimSessionIfUnassigned(sessionId: string, actorId: string): Promise<void> {
    const claimRes = await query(
      `UPDATE public.chat_sessions SET assignee_id = $1, status = 'active', updated_at = NOW()
        WHERE id = $2 AND assignee_id IS NULL
        RETURNING id`,
      [actorId, sessionId]
    );
    if ((claimRes.rowCount ?? 0) > 0) {
      emitSessionsChanged({ reason: 'assigned', sessionId });
    }
  }
}
