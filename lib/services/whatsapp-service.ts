import { supabase } from '../supabase';
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';

const log = pino({ level: 'silent' });

const MAX_RECONNECT_ATTEMPTS = 5;

interface WhatsAppInstance {
  sock: any;
  status: 'connecting' | 'connected' | 'disconnected';
  qr?: string;
}

export class WhatsAppService {
  private static instances: Map<string, WhatsAppInstance> = new Map();
  private static retryCount: Map<string, number> = new Map();

  static async connect(instanceId: string): Promise<any> {
    try {
      const { version } = await fetchLatestBaileysVersion();

      const authPath = `./whatsapp_auth_${instanceId}`;

      const { state, saveCreds } = await useMultiFileAuthState(authPath);

      const sock = makeWASocket({
        version,
        auth: state,
        logger: log,
        browser: ['OmniSupport', 'Desktop', '1.0.0'],
      });

      this.instances.set(instanceId, { sock, status: 'connecting' });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;
        const inst = this.instances.get(instanceId);

        if (qr) {
          try {
            const qrDataUrl = await QRCode.toDataURL(qr);
            if (inst) {
              inst.status = 'connecting';
              inst.qr = qrDataUrl;
            }
            await supabase.from('whatsapp_sessions').upsert({
              id: instanceId,
              data: { qr: qrDataUrl },
              updated_at: new Date().toISOString()
            });
          } catch (e) {
            console.error('QR generation error:', e);
          }
        }

        if (connection === 'open') {
          if (inst) {
            inst.status = 'connected';
            inst.qr = undefined;
          }
          this.retryCount.set(instanceId, 0);
          await this.clearStoredSession(instanceId);
        }

        if (connection === 'close') {
          if (inst) {
            inst.status = 'disconnected';
            inst.qr = undefined;
          }

          const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

          if (shouldReconnect) {
            const attempts = (this.retryCount.get(instanceId) || 0) + 1;
            this.retryCount.set(instanceId, attempts);

            if (attempts <= MAX_RECONNECT_ATTEMPTS) {
              setTimeout(() => this.connect(instanceId), 3000);
            } else {
              console.error(`[WhatsApp:${instanceId}] Max reconnect attempts reached, giving up.`);
              this.instances.delete(instanceId);
              this.retryCount.delete(instanceId);
              await this.clearStoredSession(instanceId);
            }
          } else {
            this.instances.delete(instanceId);
            this.retryCount.delete(instanceId);
            await this.clearStoredSession(instanceId);
          }
        }
      });

      sock.ev.on('messages.upsert', async (m: any) => {
        await WhatsAppService.handleIncomingMessage(m, instanceId);
      });

      return { connected: true };
    } catch (error) {
      console.error('WhatsApp connect error:', error);
      throw error;
    }
  }

  static getStatus(instanceId: string): { connected: boolean; status: 'connecting' | 'connected' | 'disconnected'; qr: string | null } {
    const inst = this.instances.get(instanceId);
    if (!inst) {
      return { connected: false, status: 'disconnected', qr: null };
    }
    return {
      connected: inst.status === 'connected',
      status: inst.status,
      qr: inst.qr || null
    };
  }

  static async getQR(instanceId: string): Promise<string | null> {
    return this.getStatus(instanceId).qr;
  }

  private static async clearStoredSession(instanceId: string): Promise<void> {
    try {
      await supabase.from('whatsapp_sessions').delete().eq('id', instanceId);
    } catch (e) {
      console.error(`[WhatsApp:${instanceId}] Error clearing stored session:`, e);
    }
  }

  static async disconnect(instanceId: string): Promise<void> {
    const inst = this.instances.get(instanceId);
    if (inst) {
      try {
        await inst.sock.logout();
      } catch (e) {
        console.error(`[WhatsApp:${instanceId}] Error during logout:`, e);
      }
      this.instances.delete(instanceId);
    }
    this.retryCount.delete(instanceId);
    await this.clearStoredSession(instanceId);
  }

  static async sendMessage(instanceId: string, to: string, message: string): Promise<void> {
    const inst = this.instances.get(instanceId);
    if (!inst || inst.status !== 'connected') throw new Error('WhatsApp instance not connected');

    const jid = to.includes('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;

    await inst.sock.sendMessage(jid, { text: message });
  }
  
  private static async handleIncomingMessage(m: any, instanceId: string) {
    const msg = m.messages[0];
    if (!msg || msg.key.fromMe) return;
    
    const remoteJid = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    
    let { data: session } = await supabase
      .from('chat_sessions')
      .select('id')
      .eq('customer_phone', remoteJid.split('@')[0])
      .maybeSingle();
    
    if (!session) {
      const { data: newSession } = await supabase
        .from('chat_sessions')
        .insert({
          customer_phone: remoteJid.split('@')[0],
          customer_name: msg.pushName || 'Contato',
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();
      
      if (!newSession) return;
      session = newSession;
    }
    
    if (!session?.id) return;
    
    await supabase.from('chat_messages').insert({
      session_id: session.id,
      sender_id: sender,
      sender_name: msg.pushName || 'Contato',
      text: msg.message?.conversation || msg.message?.extendedTextMessage?.text || '',
      type: 'text',
      created_at: new Date().toISOString()
    });
    
    await supabase
      .from('chat_sessions')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', session.id);
  }
}