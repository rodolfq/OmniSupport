import { EventEmitter } from 'events';

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
  type: 'message' | 'survey-response';
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

// Quem está com a conversa aberta agora (conectado ao SSE dela) — usado para
// não mandar push pra quem já está olhando a mensagem chegar na hora, do
// mesmo jeito que o WhatsApp não notifica a conversa que você já tem aberta.
// Só vale dentro deste processo: numa implantação com várias instâncias
// (ex.: Vercel serverless) a instância que despacha o push pode não ser a
// mesma que tem a conexão SSE — nesse caso simplesmente não há supressão
// (o push ainda é enviado), sem quebrar nada.
const activeViewers = new Map<string, Set<string>>();

export function markViewerActive(sessionId: string, userId: string) {
  let viewers = activeViewers.get(sessionId);
  if (!viewers) {
    viewers = new Set();
    activeViewers.set(sessionId, viewers);
  }
  viewers.add(userId);
}

export function markViewerInactive(sessionId: string, userId: string) {
  const viewers = activeViewers.get(sessionId);
  if (!viewers) return;
  viewers.delete(userId);
  if (viewers.size === 0) activeViewers.delete(sessionId);
}

export function isViewerActive(sessionId: string, userId: string | null | undefined): boolean {
  if (!userId) return false;
  return activeViewers.get(sessionId)?.has(userId) ?? false;
}
