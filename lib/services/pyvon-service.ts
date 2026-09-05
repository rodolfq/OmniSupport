import axios from 'axios';
import crypto from 'crypto';
import { query } from '../db';
import { normalizePhone } from '../utils';
import { runExclusive } from '../key-mutex';
import { emitChatEvent, emitSessionsChanged, excludeActiveViewers } from '../chat-events';
import { notifyUser } from './push-service';
import { getChatRecipientIds } from './notification-recipients';
import { resolveQueueForInstance, pickNextQueueAssignee, dispatchPendingChatSessions } from './queue-routing';
import { storeAttachmentBuffer } from './attachment-storage';
import { transcribeMessageAudio, isAudioAttachment, isTranscriptionEnabled } from './transcription-service';
import type { Attachment } from '@/lib/types';

/**
 * Canal WhatsApp via Pyvon (BSP/CRM que já cuida da conexão oficial com a
 * Meta) — mesmo padrão de provider já usado por Baileys/Meta em
 * whatsapp_instances. Documentação: https://pyvon.io/docs/bot-externo/
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

// Mesmas variantes de 9º dígito/DDI que Meta e Baileys já calculam cada um
// na própria cópia (não existe um helper compartilhado hoje no projeto).
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
      `SELECT id, access_token, pyvon_environment FROM public.whatsapp_instances WHERE id = $1 AND provider = 'pyvon'`,
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

  private static async getCredentials(instanceId: string): Promise<{ secret: string; baseUrl: string }> {
    const instance = await this.getInstanceById(instanceId);
    if (!instance?.access_token) throw new Error('Instância Pyvon não configurada.');
    return { secret: instance.access_token, baseUrl: this.baseUrlFor(instance.pyvon_environment) };
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

    const session = await runExclusive(`session:${lockKey}`, () =>
      this.findOrCreateSession(variants, payload.cadastro_id, name, instanceId)
    );
    if (!session) return;

    if (session.pyvon_cadastro_id !== payload.cadastro_id) {
      await query('UPDATE public.chat_sessions SET pyvon_cadastro_id = $1 WHERE id = $2', [payload.cadastro_id, session.id]);
    }

    let attachment: Attachment | null = null;
    if (payload.type && payload.type !== 'text' && payload.media_url) {
      try {
        attachment = await this.downloadMedia(payload.message_id, instanceId);
      } catch (err) {
        console.error('[Pyvon] Falha ao baixar mídia recebida:', err);
      }
    }

    let text = payload.content || '';
    if (!text && payload.type && payload.type !== 'text') {
      text = PLACEHOLDER_BY_TYPE[payload.type] || '[Mensagem]';
    }
    if (!text && !attachment) return;

    const metadata: Record<string, any> = {
      source: 'pyvon',
      channel_id: payload.channel_id,
      ...(attachment ? { attachments: [attachment] } : {})
    };

    const messageRes = await query(
      `INSERT INTO public.chat_messages (session_id, sender_id, sender_name, text, type, metadata, pyvon_message_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id, created_at`,
      [session.id, session.customer_id || null, name, text, attachment ? 'file' : 'text', JSON.stringify(metadata), messageIdStr]
    );
    const savedMessage = messageRes.rows[0];
    if (!savedMessage) return;

    await query('UPDATE public.chat_sessions SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1', [session.id]);

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
        senderName: name,
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
        title: `Nova mensagem de ${name}`,
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
  }

  // NOTA: diferente de Baileys/Meta, ainda não trata a resposta "1"/"0" a uma
  // pesquisa de satisfação como caso especial (findSurveyableClosedSession) —
  // vira atendimento novo por ora. Replicar isso é um follow-up, não um
  // bloqueio pra receber texto/mídia normalmente.
  static async findOrCreateSession(variants: string[], cadastroId: number, name: string, instanceId: string) {
    const placeHoldersFor = (arr: string[]) => arr.map((_, i) => `$${i + 1}`).join(',');

    if (variants.length) {
      const existing = await query(
        `SELECT id, customer_phone, customer_id, customer_name, assignee_id, queue_id, pyvon_cadastro_id
           FROM public.chat_sessions
          WHERE customer_phone IN (${placeHoldersFor(variants)}) AND status != 'closed'
          ORDER BY updated_at DESC LIMIT 1`,
        variants
      );
      if (existing.rows[0]) return existing.rows[0];
    } else {
      // Canal sem telefone exposto (ex.: Instagram) — casa só pelo cadastro_id.
      const existing = await query(
        `SELECT id, customer_phone, customer_id, customer_name, assignee_id, queue_id, pyvon_cadastro_id
           FROM public.chat_sessions
          WHERE pyvon_cadastro_id = $1 AND status != 'closed'
          ORDER BY updated_at DESC LIMIT 1`,
        [cadastroId]
      );
      if (existing.rows[0]) return existing.rows[0];
    }

    const digits = variants[0] || null;
    const profileRes = variants.length
      ? await query(`SELECT id, name FROM public.profiles WHERE phone IN (${placeHoldersFor(variants)}) LIMIT 1`, variants)
      : { rows: [] as any[] };
    const profile = profileRes.rows[0];
    const customerName = profile?.name || name;

    const queue = await resolveQueueForInstance(instanceId);

    const { insertRes } = await runExclusive(`queue-assign:${queue?.id ?? 'combined'}`, async () => {
      const assigneeId = queue ? await pickNextQueueAssignee(queue) : null;
      const status = assigneeId ? 'active' : 'pending';
      const insertRes = await query(
        `INSERT INTO public.chat_sessions (customer_id, customer_name, customer_phone, status, queue_id, assignee_id, pyvon_cadastro_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (customer_phone) WHERE status <> 'closed' AND customer_phone IS NOT NULL
         DO NOTHING
         RETURNING id, customer_phone, customer_id, customer_name, assignee_id, queue_id, pyvon_cadastro_id`,
        [profile?.id || null, customerName, digits, status, queue?.id || null, assigneeId, cadastroId]
      );
      return { insertRes };
    });

    if (insertRes.rows[0]) return insertRes.rows[0];

    // Perdeu a corrida contra outro processo — usa a sessão que venceu.
    if (variants.length) {
      const retryRes = await query(
        `SELECT id, customer_phone, customer_id, customer_name, assignee_id, queue_id, pyvon_cadastro_id
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
    opts?: { imageUrl?: string; documentUrl?: string }
  ): Promise<{ ok: boolean; message_id?: number; skipped?: string }> {
    const { secret, baseUrl } = await this.getCredentials(instanceId);
    const res = await axios.post(
      `${baseUrl}/api/webhook/bot-response`,
      {
        cadastro_id: target.cadastroId,
        phone: target.cadastroId ? undefined : target.phone,
        name: target.cadastroId ? undefined : target.name,
        content,
        image_url: opts?.imageUrl,
        document_url: opts?.documentUrl
      },
      { headers: { 'X-Pyvon-Secret': secret } }
    );
    if (res.data?.skipped) {
      // 200 "aceito" mas nada foi enviado nem registrado (modo de teste do
      // tenant, homologação sem contato marcado como teste, ou contato
      // interno de suporte do Pyvon) — nunca tratar como entregue.
      console.warn(`[Pyvon] Envio ignorado (${res.data.skipped}) para ${target.cadastroId ? `cadastro_id=${target.cadastroId}` : `phone=${target.phone}`}`);
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
    const { secret, baseUrl } = await this.getCredentials(instanceId);
    const res = await axios.post(
      `${baseUrl}/api/webhook/bot-template`,
      {
        template_name: params.templateName,
        cadastro_id: params.cadastroId,
        phone: params.phone,
        name: params.name,
        language: params.language || 'pt_BR',
        variables: params.variables,
        channel_id: params.channelId,
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
  static async recordOutboundTemplateMessage(params: {
    instanceId: string;
    phone?: string;
    cadastroId: number;
    customerName: string;
    analystId: string | null;
    analystName: string;
    text: string;
  }): Promise<{ id: string } | null> {
    const variants = params.phone ? phoneVariants(params.phone) : [];
    const session = await runExclusive(`session:${variants[0] || `cadastro-${params.cadastroId}`}`, () =>
      this.findOrCreateSession(variants, params.cadastroId, params.customerName, params.instanceId)
    );
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
}
