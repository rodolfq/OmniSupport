import { EventEmitter } from 'events';
import { query } from './db';

// Fan-out em memória para o SSE de chat (app/api/chats/stream/route.ts).
// Não há Redis/pub-sub no projeto — isso só alcança clientes conectados a
// este mesmo processo Node. Em produção com múltiplas instâncias, cada
// processo só notifica quem está conectado nele; o poller de 30s existente
// no cliente (chat-widget.tsx) continua como rede de segurança para os
// demais. Se no futuro houver mais de uma instância atendendo o mesmo
// tráfego, trocar por `pg LISTEN/NOTIFY` (um client dedicado, fora do pool,
// repassando para este mesmo emitter) sem precisar mudar quem consome.
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export interface ChatEventPayload {
  type: 'message' | 'survey-response' | 'transcription' | 'transcription-error' | 'typing' | 'receipt' | 'reaction' | 'edited' | 'deleted';
  sessionId: string;
  [key: string]: unknown;
}

function channelName(sessionId: string) {
  return `chat:${sessionId}`;
}

export function emitChatEvent(sessionId: string, payload: ChatEventPayload) {
  emitter.emit(channelName(sessionId), payload);
}

export function subscribeToChatEvents(sessionId: string, listener: (payload: ChatEventPayload) => void) {
  const event = channelName(sessionId);
  emitter.on(event, listener);
  return () => emitter.off(event, listener);
}

// Mesmo emitter em memória acima, canal separado (prefixo diferente) para o
// Chat Interno (public.internal_chats/internal_chat_messages) — reaproveita
// toda a infra de fan-out/limitações já documentadas no topo deste arquivo,
// só troca a "chave" do canal.
export interface InternalChatEventPayload {
  type: 'message' | 'typing' | 'receipt' | 'reaction';
  chatId: string;
  [key: string]: unknown;
}

function internalChannelName(chatId: string) {
  return `internal-chat:${chatId}`;
}

export function emitInternalChatEvent(chatId: string, payload: InternalChatEventPayload) {
  emitter.emit(internalChannelName(chatId), payload);
}

export function subscribeToInternalChatEvents(chatId: string, listener: (payload: InternalChatEventPayload) => void) {
  const event = internalChannelName(chatId);
  emitter.on(event, listener);
  return () => emitter.off(event, listener);
}

// Quem está com a conversa aberta agora (conectado ao SSE dela) — usado para
// não mandar push pra quem já está olhando a mensagem chegar na hora, do
// mesmo jeito que o WhatsApp não notifica a conversa que você já tem aberta.
//
// Persistido no banco (não em memória do processo): numa implantação
// serverless (ex.: Vercel), a conexão SSE e o disparo do push podem cair em
// instâncias isoladas sem nenhuma memória em comum — um Map local nunca
// seria visto pela instância que despacha o push. A tabela
// chat_session_viewers (ver migrations/chat_session_viewers.sql) é o único
// lugar que todas as instâncias realmente compartilham. A rota SSE
// (app/api/chats/stream/route.ts) renova o "last_seen_at" a cada heartbeat;
// aqui só se considera "ativo" quem foi visto há pouco tempo — se a conexão
// cair (aba fechada, processo reciclado no meio) o registro expira sozinho
// sem precisar de um "adeus" explícito.
const VIEWER_FRESHNESS_SECONDS = 45;

export async function markViewerActive(sessionId: string, userId: string): Promise<void> {
  await query(
    `INSERT INTO public.chat_session_viewers (session_id, user_id, last_seen_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (session_id, user_id) DO UPDATE SET last_seen_at = NOW()`,
    [sessionId, userId]
  ).catch(err => console.error('[chat-events] Falha ao marcar viewer ativo:', err));
}

export async function markViewerInactive(sessionId: string, userId: string): Promise<void> {
  await query(
    `DELETE FROM public.chat_session_viewers WHERE session_id = $1 AND user_id = $2`,
    [sessionId, userId]
  ).catch(err => console.error('[chat-events] Falha ao marcar viewer inativo:', err));
}

export async function isViewerActive(sessionId: string, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    const res = await query(
      `SELECT 1 FROM public.chat_session_viewers
       WHERE session_id = $1 AND user_id = $2 AND last_seen_at > NOW() - INTERVAL '${VIEWER_FRESHNESS_SECONDS} seconds'`,
      [sessionId, userId]
    );
    return (res.rowCount ?? 0) > 0;
  } catch (err) {
    console.error('[chat-events] Falha ao checar viewer ativo:', err);
    return false;
  }
}

// Dado um sessionId e uma lista de destinatários de push, devolve só quem
// NÃO está vendo a conversa agora (uma consulta só, em vez de uma por
// destinatário).
export async function excludeActiveViewers(sessionId: string, userIds: string[]): Promise<string[]> {
  if (!userIds.length) return [];
  try {
    const res = await query(
      `SELECT user_id FROM public.chat_session_viewers
       WHERE session_id = $1 AND user_id = ANY($2::uuid[]) AND last_seen_at > NOW() - INTERVAL '${VIEWER_FRESHNESS_SECONDS} seconds'`,
      [sessionId, userIds]
    );
    const activeIds = new Set(res.rows.map((r: any) => r.user_id));
    return userIds.filter(id => !activeIds.has(id));
  } catch (err) {
    console.error('[chat-events] Falha ao filtrar viewers ativos:', err);
    return userIds;
  }
}
