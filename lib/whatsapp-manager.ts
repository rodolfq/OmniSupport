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

// Use a more robust pino configuration to avoid EPIPE on closed stdout
const logger = pino({
  level: 'error', // Reduce noise to prevent stream overload
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
    const { useMultiFileAuthState, initAuthCreds, BufferJSON } = await import('@whiskeysockets/baileys');
    
    // If Supabase is missing, use a memory-only auth state (won't persist but works for demo)
    if (!supabase) {
      console.warn(`[WhatsApp:${sessionId}] Supabase not configured. Using local file auth state.`);
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const { state, saveCreds } = await useMultiFileAuthState(`/tmp/auth_info_${sessionId}`);
      return { state, saveCreds };
    }

    const readData = async (type: string, id: string) => {
      if (!supabase) return null;
      const key = `${sessionId}:${type}:${id}`;
      try {
        const { data, error } = await supabase
          .from('whatsapp_sessions')
          .select('data')
          .eq('id', key)
          .maybeSingle();
        
        if (error) {
          console.error(`[WhatsApp:Auth:${sessionId}] Error reading ${type}:${id}:`, error);
          return null;
        }
        if (!data || !data.data) return null;
        
        // Handle cases where data might be a string due to DB driver or manually inserted
        const rawData = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
        return JSON.parse(JSON.stringify(rawData), BufferJSON.reviver);
      } catch (err) {
        console.error(`[WhatsApp:Auth:${sessionId}] Exception reading ${type}:${id}:`, err);
        return null;
      }
    };

    const writeData = async (data: any, type: string, id: string) => {
      if (!supabase) return;
      const key = `${sessionId}:${type}:${id}`;
      try {
        const serialized = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
        const { error } = await supabase
          .from('whatsapp_sessions')
          .upsert({ id: key, data: serialized });
        
        if (error) {
          console.error(`[WhatsApp:Auth:${sessionId}] Error writing ${type}:${id}:`, error);
        }
      } catch (err) {
        console.error(`[WhatsApp:Auth:${sessionId}] Exception writing ${type}:${id}:`, err);
      }
    };

    const removeData = async (type: string, id: string) => {
      if (!supabase) return;
      const key = `${sessionId}:${type}:${id}`;
      try {
        await supabase
          .from('whatsapp_sessions')
          .delete()
          .eq('id', key);
      } catch (err) {
        console.error(`[WhatsApp:Auth:${sessionId}] Exception removing ${type}:${id}:`, err);
      }
    };

    // Initial creds
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
    // Dynamic import to avoid bundling issues
    const { Browsers, fetchLatestBaileysVersion, makeWASocket, DisconnectReason } = await import('@whiskeysockets/baileys');

    const currentRetry = this.retryCount.get(sessionId) || 0;
    
    if (this.instances.has(sessionId) || force) {
      const inst = this.instances.get(sessionId);
      if (inst?.status === 'connected' && !force) return inst;
      
      // If it's already connecting and we have a QR, don't restart unless it's a manual retry after failure OR force
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
        // Silently handle cleanup errors
      }
      this.instances.delete(sessionId);
    }

    if (currentRetry > 3 || force) {
      console.error(`[WhatsApp:${sessionId}] Resetting state (retryCount: ${currentRetry}, force: ${force}).`);
      if (supabase) {
        // Hard delete session from DB to ensure fresh QR
        const { error: delError } = await supabase.from('whatsapp_sessions').delete().eq('id', sessionId);
        if (delError) console.error(`[WhatsApp:${sessionId}] Error deleting session:`, delError.message);
        
        // Also clear any other derived keys if they exist with prefix
        const { error: delError2 } = await supabase.from('whatsapp_sessions').delete().like('id', `${sessionId}:%`);
        if (delError2) console.error(`[WhatsApp:${sessionId}] Error deleting derived sessions:`, delError2.message);
      }
      this.retryCount.set(sessionId, 0); 
    }

    console.log(`[WhatsApp:${sessionId}] Starting connection (Attempt ${currentRetry + 1})...`);
    try {
      // Use a more recent version fallback if fetch fails
      let version: [number, number, number] = [2, 3000, 1017531287]; 
      try {
        const { version: latestVersion, isLatest } = await fetchLatestBaileysVersion();
        version = latestVersion;
        console.log(`[WhatsApp] Baileys latest version: ${version.join('.')} (isLatest: ${isLatest})`);
      } catch (error) {
        console.warn('[WhatsApp] Version fetch failed, using updated fallback:', version.join('.'));
      }

      console.log(`[WhatsApp:${sessionId}] Initializing socket...`);
      const { state, saveCreds } = await this.getAuthState(sessionId);

      const sock = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: state,
        logger: logger as any,
        browser: Browsers.ubuntu('Chrome'), // Ubuntu Chrome often works better for server-side generation
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000, 
        emitOwnEvents: false,
        retryRequestDelayMs: 5000,
        syncFullHistory: false,
        linkPreviewImageThumbnailWidth: 100,
        shouldIgnoreJid: (jid) => jid.includes('broadcast') || jid.includes('newsletter'),
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false, // Reduce load
      });

      this.instances.set(sessionId, {
        socket: sock,
        status: 'connecting',
        name
      });

      sock.ev.on('creds.update', saveCreds);

      // Listen for incoming messages
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

          // Check for media
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

          // Process if there's content or media
          if (text || mediaData) {
            await this.processIncomingMessage(sessionId, phone, text, pushName, msg, mediaData);
          }
        }
      });

      sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        const inst = this.instances.get(sessionId);
        
        if (qr) {
          console.log(`[WhatsApp:${sessionId}] QR Code generated successfully.`);
          if (inst) {
            inst.qr = qr;
            inst.status = 'connecting';
          }
          this.retryCount.set(sessionId, 0); 
        }

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const errorMsg = (lastDisconnect?.error as Boom)?.message || 'Unknown error';
          
          // Special handling for 515 (Stream Errored / Restart Required)
          const isRestartRequired = statusCode === 515 || errorMsg.includes('515') || errorMsg.includes('Restart Required');
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          console.log(`[WhatsApp:${sessionId}] Connection closed. Reason: ${errorMsg} (${statusCode})${isRestartRequired ? ' - Restarting...' : ''}`);

          if (inst) {
            inst.status = 'disconnected';
            inst.qr = undefined;
          }
          
          if (shouldReconnect) {
            const nextRetry = (this.retryCount.get(sessionId) || 0) + 1;
            
            // If it's a 515, don't count it as a "failed" retry that leads to session deletion, 
            // just restart. But we still increment count to avoid infinite loops if the server is down.
            if (isRestartRequired && nextRetry > 5) {
               console.error(`[WhatsApp:${sessionId}] Repeated 515 errors. Giving up.`);
               this.instances.delete(sessionId);
               return;
            }

            this.retryCount.set(sessionId, nextRetry);
            
            if (nextRetry <= 5) {
              const delay = isRestartRequired ? 1000 : Math.min(2000 * Math.pow(2, nextRetry - 1), 10000);
              console.log(`[WhatsApp:${sessionId}] Reconnecting in ${delay}ms... (Attempt ${nextRetry})`);
              setTimeout(() => this.connect(sessionId, name), delay);
            } else {
              console.error(`[WhatsApp:${sessionId}] Max retries reached after sudden close.`);
              this.instances.delete(sessionId);
            }
          } else {
            console.log(`[WhatsApp:${sessionId}] Logged out or manual disconnect.`);
            this.instances.delete(sessionId);
            this.retryCount.delete(sessionId);
          }
        } else if (connection === 'open') {
          console.log(`[WhatsApp:${sessionId}] Connected successfully!`);
          if (inst) {
            inst.status = 'connected';
            inst.qr = undefined;
          }
          this.retryCount.set(sessionId, 0);
        }
      });

      return this.instances.get(sessionId);
    } catch (err: any) {
      console.error(`[WhatsApp:${sessionId}] Socket initialization failed:`, err.message);
      this.retryCount.set(sessionId, (this.retryCount.get(sessionId) || 0) + 1);
      throw err;
    }
  }

  public getStatus(sessionId: string) {
    const inst = this.instances.get(sessionId);
    if (!inst) {
       console.log(`[WhatsApp] Instance ${sessionId} not found in memory`);
       return { status: 'disconnected' };
    }
    console.log(`[WhatsApp] Instance ${sessionId} status: ${inst.status}, hasQR: ${!!inst.qr}`);
    return { status: inst.status, qr: inst.qr };
  }

  public async sendMessage(sessionId: string, jid: string, text: string, options?: { mediaUrl?: string, mimetype?: string, fileName?: string }) {
    const inst = this.instances.get(sessionId);
    if (!inst || inst.status !== 'connected') {
      throw new Error('WhatsApp not connected');
    }
    
    // Ensure jid format
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
      
      // Clear from DB
      if (supabase) {
        await supabase
          .from('whatsapp_sessions')
          .delete()
          .like('id', `${sessionId}:%`);
      }
    }
  }

  private async downloadAndUploadMedia(message: any, type: string): Promise<Attachment | null> {
    if (!supabase) return null;

    const mediaMessage = message[type];
    const stream = await downloadContentFromMessage(mediaMessage, type.replace('Message', '') as any);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    const fileName = mediaMessage.fileName || `${uuidv4()}.${mediaMessage.mimetype?.split('/')[1] || 'bin'}`;
    const filePath = `whatsapp/${fileName}`;

    console.log(`[WhatsApp:Media] Subindo arquivo do WhatsApp: ${fileName}...`);

    const { error: uploadError } = await supabase.storage
      .from('attachments')
      .upload(filePath, buffer, {
        contentType: mediaMessage.mimetype,
        upsert: true
      });

    if (uploadError) {
      console.error('[WhatsApp:Media] Erro no upload Supabase:', uploadError.message);
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
    if (!supabase) return;

    console.log(`[WhatsApp:Incoming] From: ${phone}, Text: ${text.substring(0, 20)}... Media: ${!!mediaData}`);

    // 1. Identify User/Employee
    let customerId = phone;
    let customerName = pushName || phone;
    const customerPhone = phone;
    
    // Try to find user by phone in profiles
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, name, phone, company_id')
      .or(`phone.eq.${phone},phone.eq.+${phone},phone.eq.55${phone}`)
      .maybeSingle();

    if (profile) {
      customerId = profile.id;
      customerName = profile.name;
      console.log(`[WhatsApp:Incoming] Identified as Employee/Contact: ${customerName} (${customerId})`);
    }

    // 2. Find or Create Session
    const { data: session } = await supabase
      .from('chat_sessions')
      .select('*')
      .eq('customer_phone', phone)
      .neq('status', 'closed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let activeSessionId;
    if (session) {
      activeSessionId = session.id;
      const updates: any = {};
      if (profile && session.customer_id !== profile.id) {
        updates.customer_id = profile.id;
        updates.customer_name = profile.name;
      }
      await supabase.from('chat_sessions').update(updates).eq('id', activeSessionId);
    } else {
      activeSessionId = uuidv4();
      await supabase.from('chat_sessions').insert({
        id: activeSessionId,
        customer_id: customerId,
        customer_name: customerName,
        customer_phone: customerPhone,
        status: 'pending',
        created_at: new Date().toISOString()
      });
      console.log(`[WhatsApp:Incoming] Created new session: ${activeSessionId}`);
    }

    // 3. Insert Message
    const messageId = uuidv4();
    const payload: any = {
      id: messageId,
      session_id: activeSessionId,
      sender_id: customerId,
      sender_name: customerName,
      text: text,
      type: mediaData ? 'file' : 'text',
      created_at: new Date().toISOString()
    };

    if (mediaData) {
      payload.metadata = {
        fileUrl: mediaData.url,
        fileName: mediaData.name,
        fileSize: mediaData.size
      };
    }

    await supabase.from('chat_messages').insert(payload);

    console.log(`[WhatsApp:Incoming] Message processed for session ${activeSessionId}`);
  }
}

declare global {
  var whatsappManager: WhatsAppManager | undefined;
}

export const whatsappManager = global.whatsappManager || WhatsAppManager.getInstance();

if (process.env.NODE_ENV !== 'production') {
  global.whatsappManager = whatsappManager;
}

// Global handler to catch EPIPE and other stream errors that bubble up
if (typeof process !== 'undefined') {
  process.on('uncaughtException', (err) => {
    if (err.message.includes('EPIPE')) {
      console.warn('[WhatsApp:System] Caught EPIPE error, ignoring to prevent crash.');
    } else {
      console.error('[WhatsApp:System] Uncaught Exception:', err);
    }
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[WhatsApp:System] Unhandled Rejection:', reason);
  });
}
