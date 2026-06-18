import { supabase } from '../supabase';
import axios from 'axios';

interface MetaWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging: Array<{
          sender: { id: string };
          recipient: { id: string };
          timestamp: number;
          message: {
            text?: { body: string };
            type?: string;
          };
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
  
  static getTokens(instanceId: string) {
    return supabase.from('whatsapp_instances')
      .select('access_token, phone_number_id, verify_token')
      .eq('id', instanceId)
      .single();
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
  
  static async handleWebhook(payload: MetaWebhookPayload) {
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        const { value } = change;
        
        for (const msg of value.messaging || []) {
          if (msg.message?.type === 'text') {
            await this.processIncomingMessage(msg, value.contacts);
          }
        }
      }
    }
  }
  
  private static async processIncomingMessage(message: any, contacts?: any[]) {
    const phone = message.sender.id;
    const contact = contacts?.find(c => c.wa_id === phone);
    const name = contact?.profile?.name || 'Contato WhatsApp';
    
    let { data: session } = await supabase
      .from('chat_sessions')
      .select('id')
      .eq('customer_phone', phone)
      .maybeSingle();
    
    if (!session) {
      const { data: newSession } = await supabase
        .from('chat_sessions')
        .insert({
          customer_phone: phone,
          customer_name: name,
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();
      session = newSession;
    }
    
    if (!session) return;
    
    await supabase.from('chat_messages').insert({
      session_id: session.id,
      sender_id: phone,
      sender_name: name,
      text: message.message.text?.body || '',
      type: 'text',
      created_at: new Date().toISOString()
    });
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