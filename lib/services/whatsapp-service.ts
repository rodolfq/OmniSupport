import { supabase } from '../supabase';
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';

const log = pino({ level: 'silent' });

export class WhatsAppService {
  private static instances: Map<string, any> = new Map();
  
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
      
      this.instances.set(instanceId, sock);
      
      sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
          try {
            const qrDataUrl = await QRCode.toDataURL(qr);
            await supabase.from('whatsapp_sessions').upsert({
              id: instanceId,
              data: { qr: qrDataUrl },
              updated_at: new Date().toISOString()
            });
          } catch (e) {
            console.error('QR generation error:', e);
          }
        }
        
        if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
          if (shouldReconnect) {
            setTimeout(() => this.connect(instanceId), 3000);
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
  
  static async getQR(instanceId: string): Promise<string | null> {
    const { data } = await supabase
      .from('whatsapp_sessions')
      .select('data')
      .eq('id', instanceId)
      .single();
    
    return data?.data?.qr || null;
  }
  
  static async disconnect(instanceId: string): Promise<void> {
    const sock = this.instances.get(instanceId);
    if (sock) {
      await sock.logout();
      this.instances.delete(instanceId);
    }
  }
  
  static async sendMessage(instanceId: string, to: string, message: string): Promise<void> {
    const sock = this.instances.get(instanceId);
    if (!sock) throw new Error('WhatsApp instance not connected');
    
    const jid = to.includes('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;
    
    await sock.sendMessage(jid, { text: message });
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