import { NextRequest } from 'next/server';
import { verifyJWT } from '@/lib/jwt';
import { query } from '@/lib/db';
import { subscribeToChatEvents, markViewerActive, markViewerInactive } from '@/lib/chat-events';

// Precisa rodar em runtime Node (não edge) porque `query()` usa o driver `pg`.
export const dynamic = 'force-dynamic';
// Na Vercel, funções serverless têm um limite de duração — sem isso, o
// padrão é bem curto (ex.: 10s no plano Hobby) e a conexão SSE cai quase
// imediatamente. Fora da Vercel (servidor próprio) esse valor é ignorado,
// sem efeito nenhum. Ajuste conforme o teto do seu plano.
export const maxDuration = 60;

const HEARTBEAT_MS = 25000;
const TEAM_ROLES = ['Administrador', 'Equipe', 'Time Interno'];

export async function GET(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  const authenticatedUser = token ? await verifyJWT(token) : null;
  if (!authenticatedUser?.id) {
    return new Response('Sessão inválida.', { status: 401 });
  }

  const sessionId = request.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return new Response('sessionId é obrigatório.', { status: 400 });
  }

  const sessionRes = await query('SELECT customer_id FROM public.chat_sessions WHERE id = $1', [sessionId]);
  if (sessionRes.rowCount === 0) {
    return new Response('Conversa não encontrada.', { status: 404 });
  }

  const profileRes = await query('SELECT role FROM public.profiles WHERE id = $1', [authenticatedUser.id]);
  const isTeam = TEAM_ROLES.includes(profileRes.rows[0]?.role);
  const isOwner = sessionRes.rows[0].customer_id === authenticatedUser.id;
  if (!isTeam && !isOwner) {
    return new Response('Acesso negado.', { status: 403 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    unsubscribe?.();
    if (heartbeat) clearInterval(heartbeat);
    markViewerInactive(sessionId, authenticatedUser.id);
  };

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller já fechado (cliente desconectou entre o check e o enqueue) — ignora.
        }
      };

      send('connected', { sessionId });

      // Enquanto essa conexão SSE existir, este usuário conta como "olhando
      // esta conversa agora" — usado para não mandar push duplicado pra quem
      // já está vendo a mensagem chegar na tela.
      markViewerActive(sessionId, authenticatedUser.id);

      unsubscribe = subscribeToChatEvents(sessionId, (payload) => {
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
