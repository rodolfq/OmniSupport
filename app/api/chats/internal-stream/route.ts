import { NextRequest } from 'next/server';
import { verifyJWT } from '@/lib/jwt';
import { query } from '@/lib/db';
import { subscribeToInternalChatEvents } from '@/lib/chat-events';

// SSE do Chat Interno — irmã de app/api/chats/stream/route.ts (mesma
// infraestrutura de fan-out em memória, ver lib/chat-events.ts), mas
// autenticada/escopada por public.internal_chats em vez de chat_sessions.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HEARTBEAT_MS = 25000;

export async function GET(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  const authenticatedUser = token ? await verifyJWT(token) : null;
  if (!authenticatedUser?.id) {
    return new Response('Sessão inválida.', { status: 401 });
  }

  const chatId = request.nextUrl.searchParams.get('chatId');
  if (!chatId) {
    return new Response('chatId é obrigatório.', { status: 400 });
  }

  const chatRes = await query('SELECT member_ids FROM public.internal_chats WHERE id = $1', [chatId]);
  if (chatRes.rowCount === 0) {
    return new Response('Conversa não encontrada.', { status: 404 });
  }
  const memberIds: string[] = chatRes.rows[0].member_ids || [];
  if (!memberIds.includes(authenticatedUser.id)) {
    return new Response('Acesso negado.', { status: 403 });
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

      send('connected', { chatId });

      unsubscribe = subscribeToInternalChatEvents(chatId, (payload) => {
        send('chat-event', payload);
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
