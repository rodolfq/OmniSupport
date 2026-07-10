import axios from 'axios';
import { query } from '../db';

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
    const placeHolders = finalVariants.map((_, i) => `$${i + 1}`).join(',');
    
    const sessionRes = await query(
      `SELECT id, customer_phone FROM public.chat_sessions WHERE customer_phone IN (${placeHolders}) ORDER BY updated_at DESC LIMIT 1`,
      finalVariants
    );
    
    let session = sessionRes.rows[0];
    
    if (!session) {
      const insertRes = await query(
        `INSERT INTO public.chat_sessions (customer_phone, customer_name, status, created_at, updated_at)
         VALUES ($1, $2, 'active', NOW(), NOW())
         RETURNING id`,
        [digits, name]
      );
      session = insertRes.rows[0];
    }
    
    if (!session) return;
    
    await query(
      `INSERT INTO public.chat_messages (session_id, sender_id, sender_name, text, type, metadata, created_at)
       VALUES ($1, $2, $3, $4, 'text', $5, NOW())`,
      [
        session.id,
        null,
        name,
        message.text?.body || '',
        JSON.stringify({ whatsapp_jid: phone, source: 'whatsapp' })
      ]
    );
    
    await query(
      `UPDATE public.chat_sessions SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [session.id]
    );
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