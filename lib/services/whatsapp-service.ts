import { makeWASocket, fetchLatestBaileysVersion, DisconnectReason, BufferJSON, downloadContentFromMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { normalizePhone } from '../utils';
import { useSupabaseAuthState, sessionDataCache } from '../supabase-auth';
import { whatsappQuery as query } from '../whatsapp-db';
import { Attachment } from '../types';
import { emitChatEvent, excludeActiveViewers } from '../chat-events';
import { notifyUser } from './push-service';
import { getChatRecipientIds } from './notification-recipients';
import { runExclusive } from '../key-mutex';
import { resolveQueueForInstance, pickNextQueueAssignee } from './queue-routing';
import { transcribeMessageAudio, isAudioAttachment, isTranscriptionEnabled } from './transcription-service';

const log = pino({ level: (process.env.WHATSAPP_LOG_LEVEL as any) || 'warn' });

const MAX_RECONNECT_ATTEMPTS = 5;
const CONNECTING_STALE_MS = 45000;
const MAX_INCOMING_MEDIA_BYTES = 8 * 1024 * 1024; // mesmo limite usado para anexos enviados pelo agente
const SEND_RETRY_ATTEMPTS = 3;
const MAX_CONTACT_PHOTO_BYTES = 2 * 1024 * 1024;

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

function buildRecipientJid(to: string): string {
  if (to.includes('@')) return to;
  const digits = normalizePhone(to);
  if (!digits) throw new Error('Invalid recipient');

  if (digits.length >= 14 || (digits.length === 13 && !digits.startsWith('55'))) {
    return `${digits}@lid`;
  }
  return `${digits}@s.whatsapp.net`;
}

function resolvePhoneFromLid(instanceId: string, lidDigits: string): string | null {
  const sessionData = sessionDataCache.get(instanceId);
  if (!sessionData) return null;
  const mapped = sessionData.keys[`lid-mapping:${lidDigits}`];
  const phone = typeof mapped === 'string' ? mapped : mapped?.phone || mapped?.pn;
  return phone ? normalizePhone(String(phone)) : null;
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

  // Robust 9th digit matching for Brazilian numbers
  const baseVariants = [...variants];
  baseVariants.forEach(v => {
    if (v.startsWith('55') && v.length === 13 && v[4] === '9') {
      variants.add(v.slice(0, 4) + v.slice(5));
    } else if (v.startsWith('55') && v.length === 12) {
      variants.add(v.slice(0, 4) + '9' + v.slice(4));
    } else if (v.length === 11 && v[2] === '9') {
      variants.add(v.slice(0, 2) + v.slice(3));
    } else if (v.length === 10) {
      variants.add(v.slice(0, 2) + '9' + v.slice(2));
    }
  });

  return [...variants];
}

function isLikelyDialablePhone(digits: string): boolean {
  return digits.startsWith('55') && digits.length >= 12 && digits.length <= 13;
}

function resolveLidFromPhone(instanceId: string, phoneDigits: string): string | null {
  const sessionData = sessionDataCache.get(instanceId);
  if (!sessionData) return null;

  for (const key in sessionData.keys) {
    if (key.startsWith('lid-mapping:')) {
      const mapped = sessionData.keys[key];
      const phone = normalizePhone(typeof mapped === 'string' ? mapped : String(mapped?.phone || mapped?.pn || ''));
      if (phone) {
        const phoneVariants = new Set([phone]);
        if (phone.startsWith('55') && phone.length > 11) phoneVariants.add(phone.slice(2));
        else if (phone.length <= 11) phoneVariants.add(`55${phone}`);

        if (phoneVariants.has(phoneDigits)) {
          return key.replace('lid-mapping:', '');
        }
      }
    }
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

async function findChatSessionByPhone(jid: string, instanceId = 'default') {
  const variants = expandContactLookupVariants(jid, instanceId);
  if (!variants.length) return null;

  // "Fechada" significa fechada de verdade: uma mensagem nova do mesmo
  // telefone é sempre outro atendimento, com sessão (e número de conversa)
  // novos — nunca uma reabertura silenciosa da anterior. A única exceção
  // (resposta "1"/"0" à pesquisa de satisfação, chegando atrasada) é tratada
  // à parte em findSurveyableClosedSession, antes deste lookup ser chamado.
  const placeHolders = variants.map((_, i) => `$${i + 1}`).join(',');
  const res = await query(
    `SELECT id, customer_phone, customer_id, customer_name, updated_at, status, awaiting_survey_until
     FROM public.chat_sessions
     WHERE customer_phone IN (${placeHolders})
       AND status != 'closed'
     ORDER BY updated_at DESC`,
    variants
  );

  if (res.rowCount === 0) return null;

  const dialable = res.rows.find((session) =>
    isLikelyDialablePhone(normalizePhone(session.customer_phone || ''))
  );

  return dialable || res.rows[0];
}

// Encontra a sessão fechada mais recente deste telefone que ainda está
// dentro da janela de resposta da pesquisa de satisfação — usado só para
// capturar um "1"/"0" chegando atrasado como resposta à pesquisa, sem
// reabrir a conversa nem criar uma sessão nova pra esse caso pontual.
async function findSurveyableClosedSession(jid: string, instanceId = 'default') {
  const variants = expandContactLookupVariants(jid, instanceId);
  if (!variants.length) return null;

  const placeHolders = variants.map((_, i) => `$${i + 1}`).join(',');
  const res = await query(
    `SELECT id, customer_phone, customer_id, customer_name
     FROM public.chat_sessions
     WHERE customer_phone IN (${placeHolders})
       AND status = 'closed'
       AND awaiting_survey_until IS NOT NULL
       AND awaiting_survey_until > NOW()
     ORDER BY updated_at DESC
     LIMIT 1`,
    variants
  );

  return res.rows[0] || null;
}

async function findOrCreateChatSession(jid: string, pushName: string | undefined, instanceId = 'default') {
  const digits = normalizePhone(jid.split('@')[0] || jid);
  if (!digits) return null;

  // Tudo dentro do lock: da checagem de sessão existente até o insert, para
  // que uma segunda mensagem do mesmo telefone (evento separado, quase
  // simultâneo) espere esta terminar em vez de rodar em paralelo.
  return runExclusive(`session:${digits}`, async () => {
    const existing = await findChatSessionByPhone(jid, instanceId);
    if (existing) return existing;

    const profileVariants = phoneLookupVariants(jid, instanceId);
    let profile: { id: string; name: string } | undefined;
    if (profileVariants.length) {
      const placeHolders = profileVariants.map((_, i) => `$${i + 1}`).join(',');
      const profileRes = await query(
        `SELECT id, name FROM public.profiles WHERE phone IN (${placeHolders}) LIMIT 1`,
        profileVariants
      );
      profile = profileRes.rows[0];
    }

    const customerName = profile?.name || pushName || 'Contato WhatsApp';

    const queue = await resolveQueueForInstance(instanceId);
    const assigneeId = queue ? await pickNextQueueAssignee(queue) : null;
    const status = assigneeId ? 'active' : 'pending';

    // ON CONFLICT como segunda rede de segurança (ver migrations/chat_sessions_
    // unique_open_phone.sql): cobre corrida entre processos/instâncias diferentes,
    // que o lock em memória (só vale dentro deste processo Node) não alcança.
    const insertRes = await query(
      `INSERT INTO public.chat_sessions (customer_id, customer_name, customer_phone, status, queue_id, assignee_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (customer_phone) WHERE status <> 'closed' AND customer_phone IS NOT NULL
       DO NOTHING
       RETURNING id, customer_phone, customer_id, customer_name, updated_at`,
      [profile?.id || null, customerName, digits, status, queue?.id || null, assigneeId]
    );

    if (insertRes.rows[0]) return insertRes.rows[0];

    // Perdeu a corrida contra outro processo — usa a sessão que venceu.
    return await findChatSessionByPhone(jid, instanceId);
  });
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
      // ignore
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

  static async hasSavedCredentials(instanceId: string): Promise<boolean> {
    if (sessionDataCache.has(instanceId)) {
      const sessionData = sessionDataCache.get(instanceId);
      return !!sessionData?.creds?.noiseKey;
    }
    const res = await query('SELECT data FROM public.whatsapp_sessions WHERE id = $1', [instanceId]);
    return !!res.rows[0]?.data?.noiseKey;
  }

  private static async hasInvalidCredentials(instanceId: string): Promise<boolean> {
    let creds = sessionDataCache.get(instanceId)?.creds;
    if (!creds) {
      const res = await query('SELECT data FROM public.whatsapp_sessions WHERE id = $1', [instanceId]);
      if (res.rows[0]?.data) {
        creds = JSON.parse(JSON.stringify(res.rows[0].data), BufferJSON.reviver);
      }
    }
    if (!creds) return false;
    return creds.registered === false && !!creds.me;
  }

  private static async clearLocalAuth(instanceId: string): Promise<void> {
    sessionDataCache.delete(instanceId);
    await query('DELETE FROM public.whatsapp_sessions WHERE id = $1 OR id LIKE $2', [instanceId, `${instanceId}:%`]);
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

    if (!await this.hasSavedCredentials(instanceId)) {
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
        if (await this.hasInvalidCredentials(instanceId)) {
          await this.clearLocalAuth(instanceId);
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
      const { state: authState, saveCreds } = await useSupabaseAuthState(null, instanceId);

      const sock = makeWASocket({
        version,
        auth: authState,
        logger: log,
        browser: ['SSX Resolve', 'Desktop', '1.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        retryRequestDelayMs: 5000,
        syncFullHistory: false,
        emitOwnEvents: false,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false,
        linkPreviewImageThumbnailWidth: 100,
        shouldIgnoreJid: (jid) => jid.includes('broadcast') || jid.includes('newsletter') || jid.endsWith('@g.us'),
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
            await query(
              `INSERT INTO public.whatsapp_sessions (id, data, updated_at)
               VALUES ($1, $2::jsonb, NOW())
               ON CONFLICT (id) DO UPDATE SET
                 data = EXCLUDED.data,
                 updated_at = NOW()`,
              [`${instanceId}:qr`, JSON.stringify({ qr: qrDataUrl })]
            );
          } catch (e: any) {
            console.error(`[WhatsApp:${instanceId}] QR generation/persist error:`, {
              message: e?.message,
              code: e?.code,
              detail: e?.detail,
              stack: e?.stack
            });
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

  private static profilePictureCache = new Map<string, { url: string | null; expiresAt: number }>();
  private static readonly PROFILE_PICTURE_TTL_MS = 60 * 60 * 1000;

  static async getProfilePicture(instanceId: string, phone: string): Promise<string | null> {
    // Já persistida no banco? Não precisamos consultar o WhatsApp de novo.
    const stored = await query(
      'SELECT photo_url FROM public.whatsapp_contact_photos WHERE instance_id = $1 AND phone = $2',
      [instanceId, phone]
    );
    if (stored.rows[0]?.photo_url) {
      return stored.rows[0].photo_url;
    }

    const cacheKey = `${instanceId}:${phone}`;
    const cached = this.profilePictureCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.url;
    }

    const inst = getState().instances.get(instanceId);
    let url: string | null = null;

    if (inst && this.isInstanceReady(inst)) {
      // O mesmo número pode existir em variantes (com/sem 9º dígito, com/sem DDI)
      // no JID real do WhatsApp; tentamos todas antes de desistir.
      const candidates = phoneLookupVariants(phone, instanceId);
      for (const candidate of candidates.length ? candidates : [phone]) {
        try {
          const jid = buildRecipientJid(candidate);
          const waUrl = await inst.sock.profilePictureUrl(jid, 'image');
          if (waUrl) {
            url = await this.downloadAndPersistContactPhoto(instanceId, phone, waUrl);
            if (url) break;
          }
        } catch {
          // tenta a próxima variante
        }
      }
    }

    this.profilePictureCache.set(cacheKey, { url, expiresAt: Date.now() + this.PROFILE_PICTURE_TTL_MS });
    return url;
  }

  private static async downloadAndPersistContactPhoto(instanceId: string, phone: string, waUrl: string): Promise<string | null> {
    try {
      const res = await fetch(waUrl);
      if (!res.ok) return null;

      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_CONTACT_PHOTO_BYTES) return null;

      const contentType = res.headers.get('content-type') || 'image/jpeg';
      const dataUrl = `data:${contentType};base64,${Buffer.from(arrayBuffer).toString('base64')}`;

      await query(
        `INSERT INTO public.whatsapp_contact_photos (instance_id, phone, photo_url, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (instance_id, phone) DO UPDATE SET
           photo_url = EXCLUDED.photo_url,
           updated_at = NOW()`,
        [instanceId, phone, dataUrl]
      );

      return dataUrl;
    } catch (e: any) {
      console.error(`[WhatsApp:${instanceId}] Falha ao baixar/persistir foto de perfil para ${phone}:`, {
        message: e?.message,
        code: e?.code,
        detail: e?.detail,
        stack: e?.stack
      });
      return null;
    }
  }

  private static async clearStoredSession(instanceId: string): Promise<void> {
    try {
      await query('DELETE FROM public.whatsapp_sessions WHERE id = $1 OR id LIKE $2', [instanceId, `${instanceId}:%`]);
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
    const jid = buildRecipientJid(to);
    let lastError: any;

    for (let attempt = 1; attempt <= SEND_RETRY_ATTEMPTS; attempt++) {
      try {
        await this.waitUntilConnected(instanceId);

        const inst = getState().instances.get(instanceId);
        if (!inst || !this.isInstanceReady(inst)) {
          const state = getState();
          const snapshot = inst
            ? { status: inst.status, hasQr: !!inst.qr, connectingSince: inst.connectingSince }
            : { status: 'no-instance-in-memory', reconnecting: state.reconnectTimers.has(instanceId) };
          throw new Error(`WhatsApp instance not connected (${JSON.stringify(snapshot)})`);
        }

        await inst.sock.sendMessage(jid, { text: message });
        return;
      } catch (error: any) {
        lastError = error;
        console.error(`[WhatsApp:${instanceId}] Send attempt ${attempt}/${SEND_RETRY_ATTEMPTS} failed to ${jid}:`, {
          message: error?.message,
          name: error?.name,
          code: error?.code,
          statusCode: error?.output?.statusCode,
          stack: error?.stack
        });
        getState().instances.delete(instanceId);
        if (attempt < SEND_RETRY_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    console.error(`[WhatsApp:${instanceId}] Giving up sending to ${jid} after ${SEND_RETRY_ATTEMPTS} attempts:`, lastError?.message || lastError);
    throw lastError;
  }

  private static async handleIncomingMessage(m: any, instanceId: string) {
    if (m.type && m.type !== 'notify') return;

    for (const msg of m.messages || []) {
      try {
        await this.processIncomingMessage(msg, instanceId);
      } catch (e) {
        console.error(`[WhatsApp:${instanceId}] Error processing message ${msg?.key?.id}:`, e);
      }
    }
  }

  private static async downloadIncomingMedia(message: any, type: string): Promise<Attachment | null> {
    const mediaMessage = message[type];
    if (!mediaMessage) return null;

    const stream = await downloadContentFromMessage(mediaMessage, type.replace('Message', '') as any);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_INCOMING_MEDIA_BYTES) {
        console.warn(`[WhatsApp] Mídia recebida excede ${MAX_INCOMING_MEDIA_BYTES} bytes, descartando conteúdo (mantendo apenas o texto).`);
        return null;
      }
    }

    // O WhatsApp reporta mimetypes com parâmetros de codec (ex.: "audio/ogg; codecs=opus"),
    // com espaço após o ";". Usar isso cru como extensão de arquivo ou dentro de uma data: URL
    // quebra tanto o nome do arquivo quanto a decodificação do <audio>/<img> no navegador.
    const rawMimetype = mediaMessage.mimetype || 'application/octet-stream';
    const baseMimetype = rawMimetype.split(';')[0].trim();
    const extension = baseMimetype.split('/')[1] || 'bin';
    const fileName = mediaMessage.fileName || `whatsapp-${Date.now()}.${extension}`;

    return {
      id: uuidv4(),
      name: fileName,
      type: baseMimetype,
      url: `data:${baseMimetype};base64,${buffer.toString('base64')}`,
      size: buffer.length
    };
  }

  private static async processIncomingMessage(msg: any, instanceId: string) {
    if (!msg?.message || msg.key?.fromMe) return;

    const remoteJid = msg.key.remoteJid;
    if (!remoteJid) return;
    // Conversas de grupo/broadcast/canal não representam um cliente individual;
    // ignoradas para não misturar com o atendimento 1:1.
    if (remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast') || remoteJid.endsWith('@newsletter')) return;

    const messageId: string | undefined = msg.key.id;
    if (messageId) {
      const dup = await query(
        `SELECT 1 FROM public.chat_messages WHERE metadata->>'whatsapp_message_id' = $1 LIMIT 1`,
        [messageId]
      );
      if ((dup.rowCount ?? 0) > 0) return;
    }

    let text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      msg.message?.documentMessage?.caption ||
      '';

    let mediaData: Attachment | null = null;
    const messageType = Object.keys(msg.message)[0];

    if (['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage'].includes(messageType)) {
      try {
        mediaData = await this.downloadIncomingMedia(msg.message, messageType);
        if (mediaData && !text) {
          text = messageType === 'audioMessage' ? '[Áudio]' : `[Arquivo: ${mediaData.name}]`;
        }
      } catch (err) {
        console.error(`[WhatsApp:${instanceId}] Falha ao baixar mídia:`, err);
      }
    }

    if (!text && !mediaData) return;

    // Resposta "1"/"0" à pesquisa de satisfação chegando atrasada pelo
    // WhatsApp: registrada na PRÓPRIA sessão fechada (sem reabri-la nem criar
    // atendimento novo) — é o único caso em que uma sessão fechada continua
    // "encontrável" por telefone. Qualquer outro texto/mídia é sempre um
    // atendimento novo (ver findChatSessionByPhone/findOrCreateChatSession).
    const trimmedAnswer = text.trim();
    if (trimmedAnswer === '0' || trimmedAnswer === '1') {
      const surveySession = await findSurveyableClosedSession(remoteJid, instanceId);
      if (surveySession) {
        try {
          const senderName = msg.pushName || surveySession.customer_name || 'Contato WhatsApp';
          const surveyMetadata = {
            whatsapp_jid: remoteJid,
            source: 'whatsapp',
            ...(messageId ? { whatsapp_message_id: messageId } : {})
          };
          const surveyMsgRes = await query(
            `INSERT INTO public.chat_messages (session_id, sender_id, sender_name, text, type, metadata, created_at)
             VALUES ($1, $2, $3, $4, 'text', $5, NOW())
             RETURNING id, created_at`,
            [surveySession.id, surveySession.customer_id || null, senderName, text, JSON.stringify(surveyMetadata)]
          );
          await query(
            `UPDATE public.chat_histories SET rating = $1
             WHERE id = (SELECT id FROM public.chat_histories WHERE session_id = $2 ORDER BY created_at DESC LIMIT 1)`,
            [parseInt(trimmedAnswer, 10), surveySession.id]
          );
          await query('UPDATE public.chat_sessions SET awaiting_survey_until = NULL WHERE id = $1', [surveySession.id]);

          const savedSurveyMessage = surveyMsgRes.rows[0];
          if (savedSurveyMessage) {
            emitChatEvent(surveySession.id, {
              type: 'survey-response',
              sessionId: surveySession.id,
              message: {
                id: savedSurveyMessage.id,
                senderId: surveySession.customer_id || null,
                senderName,
                text,
                timestamp: savedSurveyMessage.created_at,
                type: 'text',
                metadata: surveyMetadata,
                attachments: []
              }
            });
          }
        } catch (e) {
          console.error(`[WhatsApp:${instanceId}] Falha ao registrar resposta de pesquisa:`, e);
        }
        return;
      }
    }

    const session = await findOrCreateChatSession(remoteJid, msg.pushName, instanceId);
    if (!session?.id) return;

    const metadata: Record<string, any> = {
      whatsapp_jid: remoteJid,
      source: 'whatsapp',
      ...(messageId ? { whatsapp_message_id: messageId } : {}),
      ...(mediaData ? { attachments: [mediaData] } : {})
    };

    try {
      const senderName = msg.pushName || session.customer_name || 'Contato WhatsApp';
      const messageRes = await query(
        `INSERT INTO public.chat_messages (session_id, sender_id, sender_name, text, type, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING id, created_at`,
        [
          session.id,
          session.customer_id || null,
          senderName,
          text,
          mediaData ? 'file' : 'text',
          JSON.stringify(metadata)
        ]
      );
      const savedMessage = messageRes.rows[0];

      await query(
        'UPDATE public.chat_sessions SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
        [session.id]
      );

      // Mesma notificação em tempo real (SSE) e push que uma mensagem enviada
      // pelo widget web já dispara (app/api/chats/route.ts) — sem isso, uma
      // mensagem de WhatsApp só aparecia no próximo poll de 30s (ou nunca, com
      // o app em segundo plano no celular).
      if (savedMessage) {
        emitChatEvent(session.id, {
          type: 'message',
          sessionId: session.id,
          message: {
            id: savedMessage.id,
            senderId: session.customer_id || null,
            senderName,
            text,
            timestamp: savedMessage.created_at,
            type: mediaData ? 'file' : 'text',
            metadata,
            attachments: mediaData ? [mediaData] : []
          }
        });

        getChatRecipientIds({ customerId: session.customer_id }, null, false)
          .then(recipients => excludeActiveViewers(session.id, recipients))
          .then(recipients => Promise.all(recipients.map(id => notifyUser(id, {
            title: `Nova mensagem de ${senderName}`,
            body: text || 'Anexo enviado',
            url: `/chat?chat=${session.id}`,
            tag: `chat_message:${savedMessage.id}`
          }))))
          .catch(err => console.error(`[WhatsApp:${instanceId}] Falha ao notificar mensagem via push:`, err));

        // Transcrição automática de áudio recebido pelo WhatsApp — mesmo
        // gatilho fire-and-forget usado em app/api/chats/route.ts pro áudio
        // enviado pelo widget, pra cobrir os dois lados (enviado/recebido).
        if (mediaData && isTranscriptionEnabled() && isAudioAttachment(mediaData)) {
          transcribeMessageAudio({ messageId: savedMessage.id, sessionId: session.id, attachment: mediaData }).catch(err => {
            console.error(`[WhatsApp:${instanceId}] Falha ao transcrever áudio automaticamente:`, err);
          });
        }
      }
    } catch (e) {
      console.error('[WhatsApp:Incoming] Error inserting message in Postgres:', e);
    }
  }
}

if (process.env.NODE_ENV !== 'production') {
  getState();
}
