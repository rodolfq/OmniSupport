import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { CLOSED_TICKET_STATUSES } from '@/lib/ticket-status';

async function getAuthenticatedUserId(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  if (!token) return null;
  const decoded = await verifyJWT(token);
  return decoded?.id || null;
}

// Números "stackados" dos ícones da sidebar (Chat Interno / Meus Chamados) —
// diferente do polling de app/api/notifications/check (toasts efêmeros,
// deduplicados por `since`), aqui o número é sempre a contagem TOTAL de
// pendências atuais, recalculada a cada chamada.
export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json({ chatInternalUnread: 0, myTicketsUnread: 0, myTicketsUnreadByTicket: {} }, { status: 401 });
    }

    const [chatInternalRes, fechadosRes] = await Promise.all([
      // Mesmo critério de "não lida" usado na lista de conversas do Chat
      // Interno (ver unreadCountByChat em app/api/chats/route.ts): mensagem de
      // outra pessoa que este usuário ainda não abriu.
      query(
        `SELECT COUNT(*)::int AS total
         FROM public.internal_chat_messages m
         JOIN public.internal_chats c ON c.id = m.chat_id
         WHERE $1::uuid = ANY(c.member_ids)
           AND m.sender_id IS DISTINCT FROM $1
           AND NOT ($1::uuid = ANY(m.read_by))`,
        [userId]
      ),
      query(`SELECT label FROM public.config_statuses WHERE scope = 'ticket' AND is_closed = true`)
    ]);

    const fechados = [
      ...new Set([...CLOSED_TICKET_STATUSES, ...fechadosRes.rows.map((r: any) => r.label)])
    ];

    // Toda modificação/nota/nota interna (ticket_messages cobre as duas,
    // incluindo os logs 'system'/'system_log' de troca de campo — ver
    // ticket-detail-modal.tsx) feita por OUTRA pessoa num chamado atribuído a
    // este usuário, desde a última vez que ele abriu aquele chamado
    // (ticket_notification_reads.last_read_at) — só enquanto o chamado
    // continuar em aberto: fechar não gera mais pendência nova. Agrupado por
    // chamado (não só o total) pra dar pro card individual em "Meus
    // Chamados" (app/(portal)/my-tickets/page.tsx) mostrar o próprio número.
    const myTicketsRes = await query(
      `SELECT m.ticket_id, COUNT(*)::int AS cnt
       FROM public.ticket_messages m
       JOIN public.tickets t ON t.id = m.ticket_id
       LEFT JOIN public.ticket_notification_reads r ON r.ticket_id = t.id AND r.user_id = $1
       WHERE t.assignee_id = $1
         AND (t.status IS NULL OR t.status <> ALL($2))
         AND m.author_id IS DISTINCT FROM $1
         AND m.created_at > COALESCE(r.last_read_at, '-infinity'::timestamptz)
       GROUP BY m.ticket_id`,
      [userId, fechados]
    );

    const myTicketsUnreadByTicket: Record<string, number> = {};
    let myTicketsUnread = 0;
    myTicketsRes.rows.forEach((row: any) => {
      myTicketsUnreadByTicket[row.ticket_id] = row.cnt;
      myTicketsUnread += row.cnt;
    });

    return NextResponse.json({
      chatInternalUnread: chatInternalRes.rows[0]?.total || 0,
      myTicketsUnread,
      myTicketsUnreadByTicket
    });
  } catch (error) {
    console.error('Erro ao calcular notificações da sidebar:', error);
    return NextResponse.json({ chatInternalUnread: 0, myTicketsUnread: 0 }, { status: 500 });
  }
}

// Marca um chamado como "lido" pra este usuário — chamado ao abrir o modal
// de detalhe (ver ticket-detail-modal.tsx). Upsert: primeira vez que abre
// cria a linha, próximas só avançam last_read_at.
export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
    }

    const body = await request.json();
    const { action, ticketId } = body;

    if (action === 'mark-ticket-read') {
      if (!ticketId) {
        return NextResponse.json({ error: 'ticketId é obrigatório' }, { status: 400 });
      }

      // Lido ANTES do upsert avançar o cursor — é o corte que o modal usa
      // pra destacar, dentro do chamado, exatamente quais notas/alterações
      // foram a origem da notificação (ver ticket-detail-modal.tsx: tudo
      // criado depois desse instante e não pelo próprio usuário ganha a
      // marca "Novo"). null = primeira vez que abre esse chamado.
      const previousRes = await query(
        `SELECT last_read_at FROM public.ticket_notification_reads WHERE ticket_id = $1 AND user_id = $2`,
        [ticketId, userId]
      );
      const previousReadAt = previousRes.rows[0]?.last_read_at || null;

      await query(
        `INSERT INTO public.ticket_notification_reads (ticket_id, user_id, last_read_at)
         VALUES ($1, $2, now())
         ON CONFLICT (ticket_id, user_id) DO UPDATE SET last_read_at = now()`,
        [ticketId, userId]
      );

      return NextResponse.json({ success: true, previousReadAt });
    }

    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  } catch (error) {
    console.error('Erro ao marcar chamado como lido:', error);
    return NextResponse.json({ error: 'Erro ao marcar chamado como lido.' }, { status: 500 });
  }
}
