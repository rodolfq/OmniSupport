import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { askAssistant, AssistantChatMessage, AssistantNotConfiguredError } from '@/lib/services/ai-assistant-service';

// Widget flutuante do Agente de IA (Groq) — Permission.AI_ASSISTANT_USE
// ('ai:assistant'), concedida por padrão a Equipe/Time Interno (ver
// migrations/ai_assistant.sql). Administrador passa sempre, igual ao resto
// do app (getUserPermissions dá Object.values(Permission) pra ele).

async function getActor(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  if (!token) return null;
  const decoded = await verifyJWT(token);
  if (!decoded?.id) return null;
  const result = await query(
    `SELECT p.id, p.name, p.role, COALESCE(rp.permissions, '{}'::text[]) AS permissions
     FROM public.profiles p
     LEFT JOIN public.role_permissions rp ON rp.id = p.access_profile_id
     WHERE p.id = $1`,
    [decoded.id]
  );
  return result.rows[0] || null;
}

function isAuthorized(actor: any): boolean {
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes('ai:assistant');
}

const MAX_MESSAGE_LENGTH = 2000;
// Reduzido de 20 pra 8 — cada turno de histórico é reenviado por INTEIRO em
// toda pergunta nova (o Groq não tem memória de conversa entre chamadas),
// então 20 turnos numa conversa longa multiplicava o custo de token à toa.
// 8 já cobre o contexto que importa pra maioria das perguntas de
// acompanhamento.
const MAX_HISTORY_TURNS = 8;

// Extrai "25m51.744s" do texto de erro do Groq e devolve algo tipo "26
// minutos" — bem mais legível que o texto cru da API pro analista que só
// quer saber quando pode tentar de novo.
function parseGroqRetryWait(message: string): string | null {
  const match = /try again in\s+(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i.exec(message);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  const totalMinutes = Number(match[1] || 0) * 60 + Number(match[2] || 0) + Number(match[3] || 0) / 60;
  if (totalMinutes < 1) return 'menos de 1 minuto';
  const rounded = Math.ceil(totalMinutes);
  if (rounded >= 60) {
    const h = Math.floor(rounded / 60);
    const m = rounded % 60;
    return m > 0 ? `${h}h${m}min` : `${h}h`;
  }
  return `${rounded} minuto${rounded > 1 ? 's' : ''}`;
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getActor(request);
    if (!actor) {
      return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
    }
    if (!isAuthorized(actor)) {
      return NextResponse.json({ error: 'Você não tem permissão para usar o assistente de IA.' }, { status: 403 });
    }

    const body = await request.json();
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null;
    const rawHistory = Array.isArray(body?.history) ? body.history : [];

    if (!message) {
      return NextResponse.json({ error: 'Mensagem vazia.' }, { status: 400 });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: `Mensagem muito longa (máximo ${MAX_MESSAGE_LENGTH} caracteres).` }, { status: 400 });
    }
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId é obrigatório.' }, { status: 400 });
    }

    // Só os últimos N turnos — histórico ilimitado infla o custo de token a
    // cada pergunta nova sem ganho real de qualidade de resposta.
    const history: AssistantChatMessage[] = rawHistory
      .filter((m: any) => (m?.role === 'user' || m?.role === 'model') && typeof m?.text === 'string')
      .slice(-MAX_HISTORY_TURNS)
      .map((m: any) => ({ role: m.role, text: m.text }));

    const result = await askAssistant({
      userId: actor.id,
      conversationId,
      message,
      history
    });

    return NextResponse.json(result);
  } catch (error: any) {
    // Detalhe técnico completo só no log do servidor — o que volta pro
    // cliente é sempre uma mensagem curta e acionável, nunca o JSON cru da
    // API do provedor.
    console.error('[ai-assistant] Erro no POST:', error);

    // Falta de configuração é diferente de falha transitória da API do
    // Groq — merece mensagem que diz o que fazer, não "tenta de novo"
    // (tentar de novo sem configurar a chave nunca vai funcionar).
    if (error instanceof AssistantNotConfiguredError) {
      return NextResponse.json(
        { error: 'Assistente de IA ainda não configurado — peça pra alguém do time técnico configurar a chave.' },
        { status: 503 }
      );
    }

    const status = error?.status;
    const code = error?.error?.error?.code ?? error?.error?.code;
    if (status === 429 || code === 'rate_limit_exceeded') {
      const wait = parseGroqRetryWait(typeof error?.message === 'string' ? error.message : '');
      return NextResponse.json(
        { error: `O assistente atingiu o limite de uso gratuito de hoje.${wait ? ` Tente novamente em ${wait}.` : ' Tente novamente mais tarde.'}` },
        { status: 429 }
      );
    }

    return NextResponse.json({ error: 'Não foi possível falar com o assistente agora. Tente de novo em instantes.' }, { status: 502 });
  }
}
