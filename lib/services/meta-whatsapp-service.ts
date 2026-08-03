import axios from 'axios';
import { query } from '../db';
import { runExclusive } from '../key-mutex';
import { emitChatEvent, excludeActiveViewers } from '../chat-events';
import { notifyUser } from './push-service';
import { getChatRecipientIds } from './notification-recipients';
import { resolveQueueForInstance, pickNextQueueAssignee } from './queue-routing';

interface MetaWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          text?: { body: string };
          type: string;
        }>;
        contacts?: Array<{
          profile?: { name: string };
          wa_id: string;
        }>;
      };
    }>;
  }>;
}

export class MetaWhatsAppService {
  private static baseUrl = 'https://graph.facebook.com/v19.0';

  static async getTokens(instanceId: string) {
    const res = await query(
      `SELECT access_token, phone_number_id, verify_token FROM public.whatsapp_instances WHERE id = $1 AND provider = 'meta'`,
      [instanceId]
    );
    return { data: res.rows[0] || null };
  }

  // Cada canal Meta pode ter seu próprio verify_token (App diferente,
  // credenciais diferentes) — comparamos contra qualquer canal Meta
  // cadastrado. WHATSAPP_VERIFY_TOKEN continua valendo como fallback pra não
  // quebrar uma configuração antiga que já tenha usado o valor fixo do env.
  static async verifyWebhookToken(token: string | null): Promise<boolean> {
    if (!token) return false;
    if (token === (process.env.WHATSAPP_VERIFY_TOKEN || 'omnisupport_webhook')) return true;

    const res = await query(
      `SELECT 1 FROM public.whatsapp_instances WHERE provider = 'meta' AND verify_token = $1 LIMIT 1`,
      [token]
    );
    return (res.rowCount ?? 0) > 0;
  }

  // Acha qual canal (linha de whatsapp_instances) recebeu a mensagem — o
  // payload da Meta identifica o número pelo phone_number_id, não pelo id
  // interno que a Fila usa pra vincular o canal (queues.whatsapp_instance_id).
  private static async resolveInstanceId(phoneNumberId: string | undefined): Promise<string | null> {
    if (!phoneNumberId) return null;
    const res = await query(
      `SELECT id FROM public.whatsapp_instances WHERE provider = 'meta' AND phone_number_id = $1 LIMIT 1`,
      [phoneNumberId]
    );
    return res.rows[0]?.id || null;
  }

  static async setupWebhook(instanceId: string, verifyToken: string, callbackUrl: string) {
    const { data: instance } = await this.getTokens(instanceId);
    if (!instance?.phone_number_id) throw new Error('Instance not configured');

    const url = `${this.baseUrl}/${instance.phone_number_id}/subscribers?access_token=${instance.access_token}`;

    await axios.post(url, {
      object: 'whatsapp_business_account',
      callback_url: callbackUrl,
      verify_token: verifyToken,
      fields: ['messages', 'message_deliveries', 'message_reads']
    });
  }

  // Chama a Graph API com as credenciais já salvas pra confirmar que
  // phone_number_id + access_token são válidos, sem o segredo trafegar de
  // volta pro navegador — usada pelo botão "Testar Conexão" da tela de
  // Configurações.
  static async testConnection(instanceId: string): Promise<{ verifiedName?: string; displayPhoneNumber?: string }> {
    const { data: instance } = await this.getTokens(instanceId);
    if (!instance?.phone_number_id || !instance?.access_token) {
      throw new Error('Configure o Phone Number ID e o Access Token antes de testar.');
    }

    try {
      const res = await axios.get(`${this.baseUrl}/${instance.phone_number_id}`, {
        params: {
          fields: 'verified_name,display_phone_number',
          access_token: instance.access_token
        }
      });
      return {
        verifiedName: res.data?.verified_name,
        displayPhoneNumber: res.data?.display_phone_number
      };
    } catch (error: any) {
      const metaError = error?.response?.data?.error?.message;
      throw new Error(metaError || 'Falha ao conectar com a Meta Cloud API.');
    }
  }

  static async handleWebhook(payload: MetaWebhookPayload) {
    const entry = payload.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (value?.messages) {
      const instanceId = await this.resolveInstanceId(value.metadata?.phone_number_id);
      for (const msg of value.messages) {
        if (msg.type === 'text') {
          await this.processIncomingMessage(msg, value.contacts, instanceId);
        }
      }
    }
  }

  private static async processIncomingMessage(
    message: NonNullable<MetaWebhookPayload['entry'][number]['changes'][number]['value']['messages']>[number],
    contacts: MetaWebhookPayload['entry'][number]['changes'][number]['value']['contacts'],
    instanceId: string | null
  ) {
    const phone = message.from;
    const contact = contacts?.find(c => c.wa_id === phone);
    const name = contact?.profile?.name || 'Contato WhatsApp';

    // Normalize phone
    const digits = phone.replace(/\D/g, '');

    // Robust 9th digit matching for Brazilian numbers
    const variants = [digits];
    if (digits.startsWith('55') && digits.length > 11) {
      variants.push(digits.slice(2)); // without country code
    } else if (digits.length <= 11) {
      variants.push(`55${digits}`); // with country code
    }

    const newVariants = new Set(variants);
    variants.forEach(v => {
      if (v.startsWith('55') && v.length === 13 && v[4] === '9') {
        newVariants.add(v.slice(0, 4) + v.slice(5));
      } else if (v.startsWith('55') && v.length === 12) {
        newVariants.add(v.slice(0, 4) + '9' + v.slice(4));
      } else if (v.length === 11 && v[2] === '9') {
        newVariants.add(v.slice(0, 2) + v.slice(3));
      } else if (v.length === 10) {
        newVariants.add(v.slice(0, 2) + '9' + v.slice(2));
      }
    });

    const finalVariants = [...newVariants];

    // Tudo dentro do lock (mesma chave usada pela integração Baileys em
    // whatsapp-service.ts) para não criar duas sessões quando duas mensagens
    // da mesma pessoa chegam quase juntas.
    const session = await runExclusive(`session:${digits}`, async () => {
      const placeHolders = finalVariants.map((_, i) => `$${i + 1}`).join(',');
      const sessionRes = await query(
        `SELECT id, customer_phone, customer_id FROM public.chat_sessions
         WHERE customer_phone IN (${placeHolders})
           AND (status != 'closed' OR (awaiting_survey_until IS NOT NULL AND awaiting_survey_until > NOW()))
         ORDER BY updated_at DESC LIMIT 1`,
        finalVariants
      );

      if (sessionRes.rows[0]) return sessionRes.rows[0];

      // Mesmo tratamento do canal Baileys (ver findOrCreateChatSession em
      // whatsapp-service.ts): resolve o perfil do cliente pelo telefone e
      // roteia pra fila vinculada a este canal, senão a conversa nasce sem
      // dono (bug que existia aqui antes — toda mensagem via Meta virava
      // 'active' sem assignee_id nem queue_id, fora do rodízio de filas).
      const profileRes = finalVariants.length
        ? await query(
            `SELECT id, name FROM public.profiles WHERE phone IN (${placeHolders}) LIMIT 1`,
            finalVariants
          )
        : { rows: [] as any[] };
      const profile = profileRes.rows[0];
      const customerName = profile?.name || name;

      const queue = instanceId ? await resolveQueueForInstance(instanceId) : null;

      const { insertRes } = await runExclusive(`queue-assign:${queue?.id ?? 'combined'}`, async () => {
        const assigneeId = queue ? await pickNextQueueAssignee(queue) : null;
        const status = assigneeId ? 'active' : 'pending';

        // ON CONFLICT como rede de segurança entre processos/instâncias — ver
        // migrations/chat_sessions_unique_open_phone.sql.
        const insertRes = await query(
          `INSERT INTO public.chat_sessions (customer_id, customer_name, customer_phone, status, queue_id, assignee_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
           ON CONFLICT (customer_phone) WHERE status <> 'closed' AND customer_phone IS NOT NULL
           DO NOTHING
           RETURNING id, customer_phone, customer_id`,
          [profile?.id || null, customerName, digits, status, queue?.id || null, assigneeId]
        );
        return { insertRes };
      });

      if (insertRes.rows[0]) return insertRes.rows[0];

      const retryRes = await query(
        `SELECT id, customer_phone, customer_id FROM public.chat_sessions
         WHERE customer_phone IN (${placeHolders})
         ORDER BY updated_at DESC LIMIT 1`,
        finalVariants
      );
      return retryRes.rows[0] || null;
    });

    if (!session) return;

    const text = message.text?.body || '';
    const messageRes = await query(
      `INSERT INTO public.chat_messages (session_id, sender_id, sender_name, text, type, metadata, created_at)
       VALUES ($1, $2, $3, $4, 'text', $5, NOW())
       RETURNING id, created_at`,
      [
        session.id,
        null,
        name,
        text,
        JSON.stringify({ whatsapp_jid: phone, source: 'whatsapp' })
      ]
    );

    await query(
      `UPDATE public.chat_sessions SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [session.id]
    );

    const savedMessage = messageRes.rows[0];
    if (savedMessage) {
      emitChatEvent(session.id, {
        type: 'message',
        sessionId: session.id,
        message: {
          id: savedMessage.id,
          senderId: null,
          senderName: name,
          text,
          timestamp: savedMessage.created_at,
          type: 'text',
          metadata: { whatsapp_jid: phone, source: 'whatsapp' },
          attachments: []
        }
      });

      getChatRecipientIds({ customerId: session.customer_id }, null, false)
        .then(recipients => excludeActiveViewers(session.id, recipients))
        .then(recipients => Promise.all(recipients.map(id => notifyUser(id, {
          title: `Nova mensagem de ${name}`,
          body: text || 'Anexo enviado',
          url: `/chat?chat=${session.id}`,
          tag: `chat_message:${savedMessage.id}`
        }))))
        .catch(err => console.error('[MetaWhatsApp] Falha ao notificar mensagem via push:', err));
    }
  }

  static async sendMessage(instanceId: string, to: string, message: string) {
    const { data: instance } = await this.getTokens(instanceId);
    if (!instance?.phone_number_id || !instance?.access_token) {
      throw new Error('WhatsApp instance not configured');
    }

    await axios.post(
      `${this.baseUrl}/${instance.phone_number_id}/messages?access_token=${instance.access_token}`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: message }
      }
    );
  }
}
