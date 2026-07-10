import 'dotenv/config';
import { makeWASocket, fetchLatestBaileysVersion, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { useSupabaseAuthState } from '../lib/supabase-auth';

const log = pino({ level: 'info' });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-url.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-role-key',
  {
    realtime: {
      transport: WebSocket as any
    }
  }
);

const instanceId = 'default';

async function start() {
  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useSupabaseAuthState(supabase, instanceId);
  
  const sock = makeWASocket({
    version,
    auth: state,
    logger: log,
    browser: ['OmniSupport', 'Desktop', '1.0.0'],
    printQRInTerminal: true,
  });

  sock.ev.on('connection.update', async (update: any) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      const qrDataUrl = await QRCode.toDataURL(qr);
      await supabase.from('whatsapp_sessions').upsert({
        id: instanceId,
        data: { qr: qrDataUrl, status: 'connecting' },
        updated_at: new Date().toISOString()
      });
      console.log('QR Code gerado - acesse /whatsapp no navegador');
    }
    
    if (connection === 'open') {
      await supabase.from('whatsapp_sessions').upsert({
        id: instanceId,
        data: { status: 'connected' },
        updated_at: new Date().toISOString()
      });
      console.log('WhatsApp conectado!');
    }
    
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        console.log('Reconectando...');
        setTimeout(start, 3000);
      }
    }
  });

  sock.ev.on('messages.upsert', async (m: any) => {
    const msg = m.messages[0];
    if (!msg || msg.key.fromMe) return;
    
    const remoteJid = msg.key.remoteJid;
    const phone = remoteJid.split('@')[0];
    
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
          customer_name: msg.pushName || 'Contato WhatsApp',
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
      sender_id: msg.key.participant || remoteJid,
      sender_name: msg.pushName || 'Contato',
      text: msg.message?.conversation || msg.message?.extendedTextMessage?.text || '',
      type: 'text',
      created_at: new Date().toISOString()
    });
    
    await supabase.from('chat_sessions').update({ 
      last_message_at: new Date().toISOString() 
    }).eq('id', session.id);
  });
}

start().catch(console.error);