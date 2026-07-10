import 'dotenv/config';
import { makeWASocket, fetchLatestBaileysVersion, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import { useSupabaseAuthState } from '../lib/supabase-auth';
import { query } from '../lib/db';

const log = pino({ level: 'info' });
const instanceId = 'default';

async function start() {
  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useSupabaseAuthState(null, instanceId);
  
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
      await query(
        `INSERT INTO public.whatsapp_sessions (id, data, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (id) DO UPDATE SET
           data = EXCLUDED.data,
           updated_at = NOW()`,
        [instanceId, { qr: qrDataUrl, status: 'connecting' }]
      );
      console.log('QR Code gerado - acesse /settings no navegador');
    }
    
    if (connection === 'open') {
      await query(
        `INSERT INTO public.whatsapp_sessions (id, data, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (id) DO UPDATE SET
           data = EXCLUDED.data,
           updated_at = NOW()`,
        [instanceId, { status: 'connected' }]
      );
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
    if (!remoteJid) return;
    
    const localPart = remoteJid.split('@')[0] || remoteJid;
    const digits = localPart.replace(/\D/g, ''); // normalize
    
    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
      '';
      
    if (!text) return;

    // Search variants with robust 9th digit matching
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
        [digits, msg.pushName || 'Contato WhatsApp']
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
        msg.pushName || 'Contato',
        text,
        JSON.stringify({ whatsapp_jid: remoteJid, source: 'whatsapp' })
      ]
    );
    
    await query(
      `UPDATE public.chat_sessions SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [session.id]
    );
  });
}

start().catch(console.error);