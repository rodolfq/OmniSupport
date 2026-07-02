import { existsSync, readFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import { normalizePhone } from '../utils';

const log = pino({ level: 'silent' });

const MAX_RECONNECT_ATTEMPTS = 5;
const CONNECTING_STALE_MS = 45000;

interface WhatsAppInstance {
  sock: any;
  status: 'connecting' | 'connected' | 'disconnected';
  qr?: string;
  connectingSince?: number;
}

interface WhatsAppServiceState {
  instances: Map<string, WhatsAppInstance>;
  retryCount: Map<string, number>;
  ensurePromises: Map<string, Promise<void>>;
  reconnectTimers: Map<string, ReturnType<typeof setTimeout>>;
}

declare global {
  // eslint-disable-next-line no-var
  var whatsappServiceState: WhatsAppServiceState | undefined;
}

function getState(): WhatsAppServiceState {
  if (!global.whatsappServiceState) {
    global.whatsappServiceState = {
      instances: new Map(),
      retryCount: new Map(),
      ensurePromises: new Map(),
      reconnectTimers: new Map(),
    };
  }
  return global.whatsappServiceState;
}

function clearReconnectTimer(instanceId: string): void {
  const state = getState();
  const timer = state.reconnectTimers.get(instanceId);
  if (timer) {
    clearTimeout(timer);
    state.reconnectTimers.delete(instanceId);
  }
}

function getAdminSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function buildRecipientJid(to: string): string {
  if (to.includes('@')) return to;
  const digits = normalizePhone(to);
  if (!digits) throw new Error('Invalid recipient');

  // WhatsApp LID (linked ID) — not a dialable phone number
  if (digits.length >= 14 || (digits.length === 13 && !digits.startsWith('55'))) {
    return `${digits}@lid`;
  }
  return `${digits}@s.whatsapp.net`;
}

function resolvePhoneFromLid(instanceId: string, lidDigits: string): string | null {
  const reversePath = join(process.cwd(), `whatsapp_auth_${instanceId}`, `lid-mapping-${lidDigits}_reverse.json`);
  if (!existsSync(reversePath)) return null;
  try {
    const mapped = JSON.parse(readFileSync(reversePath, 'utf-8'));
    const phone = typeof mapped === 'string' ? mapped : mapped?.phone || mapped?.pn;
    return phone ? normalizePhone(String(phone)) : null;
  } catch {
    return null;
  }
}

function phoneLookupVariants(jid: string, instanceId = 'default'): string[] {
  const localPart = jid.split('@')[0] || jid;
  const suffix = jid.includes('@') ? jid.split('@')[1] : '';
  const digits = normalizePhone(localPart);
  if (!digits) return [];

  const variants = new Set<string>([digits]);

  if (suffix === 'lid') {
    const phone = resolvePhoneFromLid(instanceId, digits);
    if (phone) variants.add(phone);
  }

  if (digits.startsWith('55') && digits.length > 11) {
    variants.add(digits.slice(2));
  } else if (digits.length <= 11) {
    variants.add(`55${digits}`);
  }
  return [...variants];
}

function isLikelyDialablePhone(digits: string): boolean {
  return digits.startsWith('55') && digits.length >= 12 && digits.length <= 13;
}

function resolveLidFromPhone(instanceId: string, phoneDigits: string): string | null {
  const authDir = join(process.cwd(), `whatsapp_auth_${instanceId}`);
  if (!existsSync(authDir)) return null;

  try {
    const reverseFiles = readdirSync(authDir).filter(
      (file) => file.startsWith('lid-mapping-') && file.endsWith('_reverse.json')
    );

    for (const file of reverseFiles) {
      const mapped = JSON.parse(readFileSync(join(authDir, file), 'utf-8'));
      const phone = normalizePhone(typeof mapped === 'string' ? mapped : String(mapped?.phone || mapped?.pn || ''));
      if (!phone) continue;

      const phoneVariants = new Set([phone]);
      if (phone.startsWith('55') && phone.length > 11) phoneVariants.add(phone.slice(2));
      else if (phone.length <= 11) phoneVariants.add(`55${phone}`);

      if (phoneVariants.has(phoneDigits)) {
        return file.replace('lid-mapping-', '').replace('_reverse.json', '');
      }
    }
  } catch {
    return null;
  }

  return null;
}

function expandContactLookupVariants(jid: string, instanceId = 'default'): string[] {
  const variants = new Set(phoneLookupVariants(jid, instanceId));

  for (const value of [...variants]) {
    const phone = resolvePhoneFromLid(instanceId, value);
    if (phone) variants.add(phone);

    const lid = resolveLidFromPhone(instanceId, value);
    if (lid) variants.add(lid);
  }

  return [...variants];
}

async function findChatSessionByPhone(admin: SupabaseClient, jid: string, instanceId = 'default') {
  const variants = expandContactLookupVariants(jid, instanceId);
  if (!variants.length) return null;

  const { data, error } = await admin
    .from('chat_sessions')
    .select('id, customer_phone, updated_at')
    .in('customer_phone', variants)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[WhatsApp:Incoming] Session lookup error:', error);
    return null;
  }
  if (!data?.length) return null;

  const dialable = data.find((session) =>
    isLikelyDialablePhone(normalizePhone(session.customer_phone || ''))
  );

  return dialable || data[0];
}

export class WhatsAppService {
  private static isInstanceReady(inst: WhatsAppInstance): boolean {
    if (inst.status !== 'connected') return false;
    if (!inst.sock?.user?.id) return false;
    const ws = inst.sock?.ws ?? inst.sock?.socket;
    if (ws && typeof ws.readyState === 'number' && ws.readyState !== 1) {
      return false;
    }
    return true;
  }

  private static forceDropInstance(instanceId: string): void {
    const state = getState();
    const inst = state.instances.get(instanceId);
    if (!inst) return;

    try {
      inst.sock?.end?.(undefined);
    } catch {
      // ignore stale socket cleanup errors
    }
    state.instances.delete(instanceId);
  }

  private static isConnectingStale(inst: WhatsAppInstance): boolean {
    if (inst.status !== 'connecting') return false;
    if (this.isInstanceReady(inst)) return false;

    const ws = inst.sock?.ws ?? inst.sock?.socket;
    if (ws && typeof ws.readyState === 'number' && ws.readyState !== 0 && ws.readyState !== 1) {
      return true;
    }

    const since = inst.connectingSince ?? 0;
    return since > 0 && Date.now() - since > CONNECTING_STALE_MS && !inst.qr;
  }

  private static dropStaleInstance(instanceId: string): void {
    const state = getState();
    const inst = state.instances.get(instanceId);
    if (!inst) return;

    if (this.isInstanceReady(inst)) return;
    if (inst.status === 'connecting' && !this.isConnectingStale(inst)) return;
    if (inst.status === 'disconnected') return;

    this.forceDropInstance(instanceId);
  }

  static async waitUntilConnected(instanceId: string, timeoutMs = 20000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.dropStaleInstance(instanceId);
      await this.ensureConnection(instanceId);
      const inst = getState().instances.get(instanceId);
      if (inst && this.isInstanceReady(inst)) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('WhatsApp instance not connected');
  }

  static hasSavedCredentials(instanceId: string): boolean {
    const credsPath = join(process.cwd(), `whatsapp_auth_${instanceId}`, 'creds.json');
    return existsSync(credsPath);
  }

  private static hasInvalidCredentials(instanceId: string): boolean {
    const credsPath = join(process.cwd(), `whatsapp_auth_${instanceId}`, 'creds.json');
    if (!existsSync(credsPath)) return false;
    try {
      const creds = JSON.parse(readFileSync(credsPath, 'utf-8'));
      return creds.registered === false && !!creds.me;
    } catch {
      return true;
    }
  }

  private static clearLocalAuth(instanceId: string): void {
    const authPath = join(process.cwd(), `whatsapp_auth_${instanceId}`);
    if (!existsSync(authPath)) return;
    try {
      rmSync(authPath, { recursive: true, force: true });
    } catch (e) {
      console.error(`[WhatsApp:${instanceId}] Failed to clear local auth:`, e);
    }
  }

  static async ensureConnection(instanceId: string): Promise<void> {
    this.dropStaleInstance(instanceId);

    const state = getState();
    const inFlight = state.ensurePromises.get(instanceId);
    if (inFlight) {
      await inFlight;
      return;
    }

    const inst = state.instances.get(instanceId);
    if (inst && this.isInstanceReady(inst)) {
      return;
    }
    if (inst?.status === 'connecting') {
      return;
    }
    if (inst?.status === 'disconnected' && state.reconnectTimers.has(instanceId)) {
      return;
    }
    if (inst) {
      this.forceDropInstance(instanceId);
    }

    if (!this.hasSavedCredentials(instanceId)) {
      return;
    }

    const pending = this.connect(instanceId)
      .then(() => undefined)
      .catch((err) => {
        console.error(`[WhatsApp:${instanceId}] Auto-reconnect failed:`, err);
      })
      .finally(() => {
        state.ensurePromises.delete(instanceId);
      });
    state.ensurePromises.set(instanceId, pending);

    await pending;
  }

  static async connect(instanceId: string, options?: { manual?: boolean }): Promise<any> {
    const state = getState();

    try {
      clearReconnectTimer(instanceId);

      if (options?.manual) {
        state.retryCount.set(instanceId, 0);
        this.forceDropInstance(instanceId);
        if (this.hasInvalidCredentials(instanceId)) {
          this.clearLocalAuth(instanceId);
        }
      } else {
        const existing = state.instances.get(instanceId);
        if (existing && this.isInstanceReady(existing)) {
          return { connected: true };
        }
        if (existing?.status === 'connecting' && !this.isConnectingStale(existing)) {
          return { connected: false };
        }
        if (existing) {
          this.forceDropInstance(instanceId);
        }
      }

      const { version } = await fetchLatestBaileysVersion();
      const authPath = `./whatsapp_auth_${instanceId}`;
      const { state: authState, saveCreds } = await useMultiFileAuthState(authPath);

      const sock = makeWASocket({
        version,
        auth: authState,
        logger: log,
        browser: ['OmniSupport', 'Desktop', '1.0.0'],
      });

      state.instances.set(instanceId, {
        sock,
        status: 'connecting',
        connectingSince: Date.now(),
      });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update: any) => {
        const current = state.instances.get(instanceId);
        if (!current || current.sock !== sock) return;

        const { connection, lastDisconnect, qr } = update;
        const inst = current;

        if (qr) {
          try {
            const qrDataUrl = await QRCode.toDataURL(qr);
            if (state.instances.get(instanceId)?.sock === sock) {
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
          clearReconnectTimer(instanceId);
          if (state.instances.get(instanceId)?.sock === sock) {
            inst.status = 'connected';
            inst.qr = undefined;
            inst.connectingSince = undefined;
          }
          state.retryCount.set(instanceId, 0);
          await this.clearStoredSession(instanceId);
        }

        if (connection === 'close') {
          if (state.instances.get(instanceId)?.sock !== sock) return;

          if (inst) {
            inst.status = 'disconnected';
            inst.qr = undefined;
          }

          const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

          if (shouldReconnect) {
            const attempts = (state.retryCount.get(instanceId) || 0) + 1;
            state.retryCount.set(instanceId, attempts);

            if (attempts <= MAX_RECONNECT_ATTEMPTS) {
              clearReconnectTimer(instanceId);
              const timer = setTimeout(() => {
                state.reconnectTimers.delete(instanceId);
                void this.connect(instanceId);
              }, 3000);
              state.reconnectTimers.set(instanceId, timer);
            } else {
              console.error(`[WhatsApp:${instanceId}] Max reconnect attempts reached, giving up.`);
              clearReconnectTimer(instanceId);
              if (state.instances.get(instanceId)?.sock === sock) {
                state.instances.delete(instanceId);
              }
              state.retryCount.delete(instanceId);
              await this.clearStoredSession(instanceId);
            }
          } else {
            clearReconnectTimer(instanceId);
            if (state.instances.get(instanceId)?.sock === sock) {
              state.instances.delete(instanceId);
            }
            state.retryCount.delete(instanceId);
            this.clearLocalAuth(instanceId);
            await this.clearStoredSession(instanceId);
          }
        }
      });

      sock.ev.on('messages.upsert', async (m: any) => {
        if (state.instances.get(instanceId)?.sock !== sock) return;
        await WhatsAppService.handleIncomingMessage(m, instanceId);
      });

      return { connected: true };
    } catch (error) {
      console.error('WhatsApp connect error:', error);
      throw error;
    }
  }

  static getStatus(instanceId: string): { connected: boolean; status: 'connecting' | 'connected' | 'disconnected'; qr: string | null } {
    this.dropStaleInstance(instanceId);

    const state = getState();
    const inst = state.instances.get(instanceId);
    if (!inst) {
      return { connected: false, status: 'disconnected', qr: null };
    }

    if (inst.status === 'disconnected' && state.reconnectTimers.has(instanceId)) {
      return { connected: false, status: 'connecting', qr: null };
    }

    const connected = this.isInstanceReady(inst);

    return {
      connected,
      status: connected ? 'connected' : inst.status,
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
    const state = getState();
    clearReconnectTimer(instanceId);

    const inst = state.instances.get(instanceId);
    if (inst) {
      try {
        await inst.sock.logout();
      } catch (e) {
        console.error(`[WhatsApp:${instanceId}] Error during logout:`, e);
      }
      this.forceDropInstance(instanceId);
    }
    state.retryCount.delete(instanceId);
    this.clearLocalAuth(instanceId);
    await this.clearStoredSession(instanceId);
  }

  static async sendMessage(instanceId: string, to: string, message: string): Promise<void> {
    await this.waitUntilConnected(instanceId);

    const inst = getState().instances.get(instanceId);
    if (!inst || !this.isInstanceReady(inst)) {
      throw new Error('WhatsApp instance not connected');
    }

    const jid = buildRecipientJid(to);

    try {
      await inst.sock.sendMessage(jid, { text: message });
    } catch (error) {
      console.error(`[WhatsApp:${instanceId}] Send failed to ${jid}:`, error);
      getState().instances.delete(instanceId);
      throw error;
    }
  }

  private static async handleIncomingMessage(m: any, instanceId: string) {
    if (m.type && m.type !== 'notify') return;

    const msg = m.messages[0];
    if (!msg || msg.key.fromMe) return;

    const remoteJid = msg.key.remoteJid;
    if (!remoteJid) return;

    const admin = getAdminSupabase();
    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
      '';

    if (!text) return;

    const session = await findChatSessionByPhone(admin, remoteJid, instanceId);

    // Só importa respostas de conversas já abertas no app — não espelha todo o WhatsApp pessoal
    if (!session?.id) return;

    const { error: messageError } = await admin.from('chat_messages').insert({
      session_id: session.id,
      sender_id: null,
      sender_name: msg.pushName || 'Contato',
      text,
      type: 'text',
      metadata: { whatsapp_jid: remoteJid, source: 'whatsapp' },
      created_at: new Date().toISOString()
    });

    if (messageError) {
      console.error('[WhatsApp:Incoming] Message insert error:', messageError);
      return;
    }

    const { error: updateError } = await admin
      .from('chat_sessions')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', session.id);

    if (updateError) {
      console.error('[WhatsApp:Incoming] Session update error:', updateError);
    }
  }
}

if (process.env.NODE_ENV !== 'production') {
  getState();
}
