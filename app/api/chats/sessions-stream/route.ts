import { NextRequest } from 'next/server';
import { verifyJWT } from '@/lib/jwt';
import { subscribeToSessionsChanges } from '@/lib/chat-events';
import { isTeamRole } from '@/lib/services/notification-recipients';

// Precisa rodar em runtime Node (não edge) — mesmo motivo de app/api/chats/stream.
export const dynamic = 'force-dynamic';

// Uma única conexão por analista, aberta assim que o widget monta (não por
// conversa selecionada, como /api/chats/stream) — avisa em tempo real quando
// QUALQUER sessão relevante muda (mensagem nova, atribuição, tag, fila,
// status), pra lista lateral não depender só do poll de 30s pra mostrar um
// atendimento novo. Só time (Administrador/Equipe/Time Interno) usa essa
// lista — cliente nunca vê a barra lateral (ver chat-widget.tsx).
const HEARTBEAT_MS = 25000;

export async function GET(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  const authenticatedUser = token ? await verifyJWT(token) : null;
  if (!authenticatedUser?.id || !isTeamRole(authenticatedUser.role)) {
    return new Response('Acesso negado.', { status: 401 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    unsubscribe?.();
    if (heartbeat) clearInterval(heartbeat);
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller já fechado (cliente desconectou entre o check e o enqueue) — ignora.
        }
      };

      send('connected', {});

      unsubscribe = subscribeToSessionsChanges((payload) => {
        send('sessions-changed', payload);
      });

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          cleanup();
        }
      }, HEARTBEAT_MS);
    },
    cancel: cleanup
  });

  request.signal.addEventListener('abort', cleanup);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}
