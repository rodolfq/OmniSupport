import axios from 'axios';
import { query } from '../db';
import { runExclusive } from '../key-mutex';
import { emitChatEvent, isViewerActive } from '../chat-events';
import { notifyUser } from './push-service';
import { getChatRecipientIds } from './notification-recipients';

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
      'SELECT access_token, phone_number_id, verify_token FROM public.whatsapp_instances WHERE id = $1',
      [instanceId]
    );
    return { data: res.rows[0] || null };
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
  
  static async handleWebhook(payload: any) {
    const entry = payload.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    
    if (value?.messages) {
      for (const msg of value.messages) {
        if (msg.type === 'text') {
          await this.processIncomingMessage(msg, value.contacts);
        }
      }
    }
  }
  
  private static async processIncomingMessage(message: any, contacts?: any[]) {
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

      // ON CONFLICT como rede de segurança entre processos/instâncias — ver
      // migrations/chat_sessions_unique_open_phone.sql.
      const insertRes = await query(
        `INSERT INTO public.chat_sessions (customer_phone, customer_name, status, created_at, updated_at)
         VALUES ($1, $2, 'active', NOW(), NOW())
         ON CONFLICT (customer_phone) WHERE status <> 'closed' AND customer_phone IS NOT NULL
         DO NOTHING
         RETURNING id, customer_phone, customer_id`,
        [digits, name]
      );

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
        .then(recipients => recipients.filter(id => !isViewerActive(session.id, id)))
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