import { 
  WASocket,
  SignalDataTypeMap,
  downloadContentFromMessage,
  proto
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { supabase } from './supabase';
import { v4 as uuidv4 } from 'uuid';
import { Attachment } from './types';
import { query } from './db';

const logger = pino({
  level: 'error',
  timestamp: pino.stdTimeFunctions.isoTime,
});

interface WhatsAppInstance {
  socket: WASocket;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  qr?: string;
  name: string;
}

class WhatsAppManager {
  private static instance: WhatsAppManager;
  private instances: Map<string, WhatsAppInstance> = new Map();

  private constructor() {}

  public static getInstance(): WhatsAppManager {
    if (!WhatsAppManager.instance) {
      WhatsAppManager.instance = new WhatsAppManager();
    }
    return WhatsAppManager.instance;
  }

  // Custom DB Auth State implementation for Baileys
  private async getAuthState(sessionId: string) {
    const { initAuthCreds, BufferJSON } = await import('@whiskeysockets/baileys');

    const readData = async (type: string, id: string) => {
      const key = `${sessionId}:${type}:${id}`;
      try {
        const res = await query('SELECT data FROM public.whatsapp_sessions WHERE id = $1', [key]);
        
        if (res.rowCount === 0 || !res.rows[0].data) return null;
        
        const rawData = typeof res.rows[0].data === 'string' ? JSON.parse(res.rows[0].data) : res.rows[0].data;
        return JSON.parse(JSON.stringify(rawData), BufferJSON.reviver);
      } catch (err) {
        console.error(`[WhatsApp:Auth:${sessionId}] Exception reading ${type}:${id}:`, err);
        return null;
      }
    };

    const writeData = async (data: any, type: string, id: string) => {
      const key = `${sessionId}:${type}:${id}`;
      try {
        const serialized = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
        await query(
          `INSERT INTO public.whatsapp_sessions (id, data, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (id) DO UPDATE SET
             data = EXCLUDED.data,
             updated_at = NOW()`,
          [key, serialized]
        );
      } catch (err) {
        console.error(`[WhatsApp:Auth:${sessionId}] Exception writing ${type}:${id}:`, err);
      }
    };

    const removeData = async (type: string, id: string) => {
      const key = `${sessionId}:${type}:${id}`;
      try {
        await query('DELETE FROM public.whatsapp_sessions WHERE id = $1', [key]);
      } catch (err) {
        console.error(`[WhatsApp:Auth:${sessionId}] Exception removing ${type}:${id}:`, err);
      }
    };

    let creds = await readData('creds', 'main');
    if (!creds) {
      console.log(`[WhatsApp:${sessionId}] Initializing new auth credentials`);
      creds = initAuthCreds();
    }

    return {
      state: {
        creds,
        keys: {
          get: async (type: keyof SignalDataTypeMap, ids: string[]) => {
            const data: { [id: string]: any } = {};
            await Promise.all(
              ids.map(async (id) => {
                const value = await readData(type, id);
                if (value) data[id] = value;
              })
            );
            return data;
          },
          set: async (data: any) => {
            const tasks: Promise<void>[] = [];
            for (const type in data) {
              for (const id in data[type]) {
                const value = data[type][id];
                if (value) {
                  tasks.push(writeData(value, type, id));
                } else {
                  tasks.push(removeData(type, id));
                }
               }
            }
            await Promise.all(tasks);
          }
        },
      },
      saveCreds: async () => {
        await writeData(creds, 'creds', 'main');
      }
    };
  }

  private retryCount: Map<string, number> = new Map();

  public async connect(sessionId: string, name: string, force = false) {
    const { Browsers, fetchLatestBaileysVersion, makeWASocket, DisconnectReason } = await import('@whiskeysockets/baileys');

    const currentRetry = this.retryCount.get(sessionId) || 0;
    
    if (this.instances.has(sessionId) || force) {
      const inst = this.instances.get(sessionId);
      if (inst?.status === 'connected' && !force) return inst;
      
      if (inst?.status === 'connecting' && inst.qr && currentRetry === 0 && !force) {
        console.log(`[WhatsApp:${sessionId}] Already connecting and has QR, skipping restart.`);
        return inst;
      }

      console.log(`[WhatsApp:${sessionId}] Cleaning up existing session before reconnect (force: ${force})...`);
      try {
        if (inst) {
          inst.socket.ev.removeAllListeners('connection.update');
          inst.socket.ev.removeAllListeners('creds.update');
          inst.socket.end(undefined);
        }
      } catch (e) {
        // ignore
      }
      this.instances.delete(sessionId);
    }

    if (currentRetry > 3 || force) {
      console.error(`[WhatsApp:${sessionId}] Resetting state (retryCount: ${currentRetry}, force: ${force}).`);
      await query('DELETE FROM public.whatsapp_sessions WHERE id = $1', [sessionId]);
      await query('DELETE FROM public.whatsapp_sessions WHERE id LIKE $1', [`${sessionId}:%`]);
      this.retryCount.set(sessionId, 0); 
    }

    console.log(`[WhatsApp:${sessionId}] Starting connection (Attempt ${currentRetry + 1})...`);
    try {
      let version: [number, number, number] = [2, 3000, 1017531287]; 
      try {
        const { version: latestVersion } = await fetchLatestBaileysVersion();
        version = latestVersion;
      } catch (error) {
        console.warn('[WhatsApp] Version fetch failed, using fallback:', version.join('.'));
      }

      console.log(`[WhatsApp:${sessionId}] Initializing socket...`);
      const { state, saveCreds } = await this.getAuthState(sessionId);

      const sock = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: state,
        logger: logger as any,
        browser: Browsers.ubuntu('Chrome'),
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000, 
        emitOwnEvents: false,
        retryRequestDelayMs: 5000,
        syncFullHistory: false,
        linkPreviewImageThumbnailWidth: 100,
        shouldIgnoreJid: (jid) => jid.includes('broadcast') || jid.includes('newsletter'),
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false,
      });

      this.instances.set(sessionId, {
        socket: sock,
        status: 'connecting',
        name
      });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        for (const msg of messages) {
          if (!msg.message || msg.key.fromMe) continue;
          
          const jid = msg.key.remoteJid;
          if (!jid || !jid.includes('@s.whatsapp.net')) continue;
          
          const phone = jid.split('@')[0];
          let text = msg.message.conversation || 
                       msg.message.extendedTextMessage?.text || 
                       msg.message.imageMessage?.caption || 
                       msg.message.videoMessage?.caption ||
                       msg.message.documentMessage?.caption ||
                       '';
          
          const pushName = msg.pushName || phone;

          let mediaData = null;
          const messageType = Object.keys(msg.message)[0];
          
          if (['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage'].includes(messageType)) {
            try {
              mediaData = await this.downloadAndUploadMedia(msg.message, messageType);
              if (mediaData && !text) {
                text = `[Arquivo: ${mediaData.name}]`;
              }
            } catch (err) {
              console.error(`[WhatsApp:${sessionId}] Falha ao processar mídia:`, err);
            }
          }

          if (text || mediaData) {
            await this.processIncomingMessage(sessionId, phone, text, pushName, msg, mediaData);
          }
        }
      });

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const inst = this.instances.get(sessionId);
        
        if (qr) {
          console.log(`[WhatsApp:${sessionId}] QR Code generated.`);
          if (inst) {
            inst.qr = qr;
            inst.status = 'connecting';
          }
          await query(
            `INSERT INTO public.whatsapp_sessions (id, data, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (id) DO UPDATE SET
               data = EXCLUDED.data,
               updated_at = NOW()`,
            [sessionId, { qr }]
          );
          this.retryCount.set(sessionId, 0); 
        }

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const errorMsg = (lastDisconnect?.error as Boom)?.message || 'Unknown error';
          
          const isRestartRequired = statusCode === 515 || errorMsg.includes('515') || errorMsg.includes('Restart Required');
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          console.log(`[WhatsApp:${sessionId}] Connection closed: ${errorMsg}`);

          if (inst) {
            inst.status = 'disconnected';
            inst.qr = undefined;
          }
          
          if (shouldReconnect) {
            const nextRetry = (this.retryCount.get(sessionId) || 0) + 1;
            
            if (isRestartRequired && nextRetry > 5) {
               console.error(`[WhatsApp:${sessionId}] Repeated 515 errors. Restarting WhatsApp connection.`);
               this.instances.delete(sessionId);
               return;
            }

            this.retryCount.set(sessionId, nextRetry);
            
            if (nextRetry <= 5) {
              const delay = isRestartRequired ? 1000 : Math.min(2000 * Math.pow(2, nextRetry - 1), 10000);
              setTimeout(() => this.connect(sessionId, name), delay);
            } else {
              this.instances.delete(sessionId);
            }
          } else {
            this.instances.delete(sessionId);
            this.retryCount.delete(sessionId);
          }
        } else if (connection === 'open') {
          console.log(`[WhatsApp:${sessionId}] Connected!`);
          if (inst) {
            inst.status = 'connected';
            inst.qr = undefined;
          }
          this.retryCount.set(sessionId, 0);
        }
      });

      return this.instances.get(sessionId);
    } catch (err: any) {
      console.error(`[WhatsApp:${sessionId}] Connect failed:`, err.message);
      this.retryCount.set(sessionId, (this.retryCount.get(sessionId) || 0) + 1);
      throw err;
    }
  }

  public getStatus(sessionId: string) {
    const inst = this.instances.get(sessionId);
    if (!inst) {
       return { status: 'disconnected' };
    }
    return { status: inst.status, qr: inst.qr };
  }

  public async sendMessage(sessionId: string, jid: string, text: string, options?: { mediaUrl?: string, mimetype?: string, fileName?: string }) {
    const inst = this.instances.get(sessionId);
    if (!inst || inst.status !== 'connected') {
      throw new Error('WhatsApp not connected');
    }
    
    const formattedJid = jid.includes('@s.whatsapp.net') ? jid : `${jid.replace(/\D/g, '')}@s.whatsapp.net`;
    
    if (options?.mediaUrl) {
      const type = options.mimetype?.startsWith('image/') ? 'image' : 
                   options.mimetype?.startsWith('video/') ? 'video' : 
                   options.mimetype?.startsWith('audio/') ? 'audio' : 'document';
      
      const messagePayload: any = {
        [type === 'document' ? 'document' : type]: { url: options.mediaUrl },
        caption: text,
        mimetype: options.mimetype,
        fileName: options.fileName
      };

      await inst.socket.sendMessage(formattedJid, messagePayload);
    } else {
      await inst.socket.sendMessage(formattedJid, { text });
    }
  }

  public async logout(sessionId: string) {
    const inst = this.instances.get(sessionId);
    if (inst) {
      await inst.socket.logout();
      this.instances.delete(sessionId);
      await query('DELETE FROM public.whatsapp_sessions WHERE id LIKE $1', [`${sessionId}:%`]);
    }
  }

  private async downloadAndUploadMedia(message: any, type: string): Promise<Attachment | null> {
    const mediaMessage = message[type];
    const stream = await downloadContentFromMessage(mediaMessage, type.replace('Message', '') as any);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    const fileName = mediaMessage.fileName || `${uuidv4()}.${mediaMessage.mimetype?.split('/')[1] || 'bin'}`;
    const filePath = `whatsapp/${fileName}`;

    console.log(`[WhatsApp:Media] Uploading file to Supabase storage...`);

    const { error: uploadError } = await supabase.storage
      .from('attachments')
      .upload(filePath, buffer, {
        contentType: mediaMessage.mimetype,
        upsert: true
      });

    if (uploadError) {
      console.error('[WhatsApp:Media] Supabase Storage Upload Error:', uploadError.message);
      return null;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('attachments')
      .getPublicUrl(filePath);

    return {
      id: uuidv4(),
      name: fileName,
      type: mediaMessage.mimetype || 'application/octet-stream',
      url: publicUrl,
      size: buffer.length
    };
  }

  private async processIncomingMessage(sessionId: string, phone: string, text: string, pushName: string, _msg: any, mediaData?: Attachment | null) {
    console.log(`[WhatsApp:Incoming] From: ${phone}`);

    let customerId = phone;
    let customerName = pushName || phone;
    const customerPhone = phone;
    
    // Identificar perfil
    const profileRes = await query(
      "SELECT id, name, phone, company_id FROM public.profiles WHERE phone = $1 OR phone = $2 OR phone = $3",
      [phone, `+${phone}`, `55${phone}`]
    );

    const profile = profileRes.rows[0];
    if (profile) {
      customerId = profile.id;
      customerName = profile.name;
    }

    // Buscar ou criar sessão
    const sessionRes = await query(
      `SELECT * FROM public.chat_sessions 
       WHERE customer_phone = $1 AND status != 'closed' 
       ORDER BY created_at DESC LIMIT 1`,
      [phone]
    );

    const session = sessionRes.rows[0];
    let activeSessionId;
    if (session) {
      activeSessionId = session.id;
      if (profile && session.customer_id !== profile.id) {
        await query(
          'UPDATE public.chat_sessions SET customer_id = $1, customer_name = $2, updated_at = NOW() WHERE id = $3',
          [profile.id, profile.name, activeSessionId]
        );
      }
    } else {
      activeSessionId = uuidv4();
      await query(
        `INSERT INTO public.chat_sessions (id, customer_id, customer_name, customer_phone, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'pending', NOW(), NOW())`,
        [activeSessionId, customerId, customerName, customerPhone]
      );
    }

    // Inserir mensagem
    const messageId = uuidv4();
    const metadata = mediaData ? {
      fileUrl: mediaData.url,
      fileName: mediaData.name,
      fileSize: mediaData.size
    } : { whatsapp_jid: `${phone}@s.whatsapp.net`, source: 'whatsapp' };

    await query(
      `INSERT INTO public.chat_messages (id, session_id, sender_id, sender_name, text, type, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        messageId,
        activeSessionId,
        customerId,
        customerName,
        text,
        mediaData ? 'file' : 'text',
        metadata
      ]
    );

    await query(
      'UPDATE public.chat_sessions SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
      [activeSessionId]
    );
  }
}

declare global {
  var whatsappManager: WhatsAppManager | undefined;
}

export const whatsappManager = global.whatsappManager || WhatsAppManager.getInstance();

if (process.env.NODE_ENV !== 'production') {
  global.whatsappManager = whatsappManager;
}

if (typeof process !== 'undefined') {
  process.on('uncaughtException', (err) => {
    if (err.message.includes('EPIPE')) {
      console.warn('[WhatsApp:System] Ignoring EPIPE stream error.');
    } else {
      console.error('[WhatsApp:System] Uncaught Exception:', err);
    }
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[WhatsApp:System] Unhandled Rejection:', reason);
  });
}
