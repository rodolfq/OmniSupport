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
