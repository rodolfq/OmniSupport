import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { pool, query } from '@/lib/db';
import { emitChatEvent, excludeActiveViewers } from '@/lib/chat-events';
import { notifyUser } from '@/lib/services/push-service';
import { getChatRecipientIds, getTeamUserIds } from '@/lib/services/notification-recipients';
import { pickNextQueueAssignee } from '@/lib/services/queue-routing';
import { runExclusive } from '@/lib/key-mutex';
import { getCurrentActionUser } from '@/lib/server-auth';

/**
 * Operações de atendimento e de chamado ligadas à conversa. Última leva da
 * separação front/back — substitui assignChatSession / returnChatSessionToQueue
 * / saveTicketFromChatSession / linkChatSessionToTicket / mergeTickets /
 * duplicateTicket / closeChatSessionAfterTicket.
 *
 * ATENÇÃO — duas decisões de produto embutidas aqui que NÃO devem ser
 * "melhoradas" sem intenção:
 *
 * 1. mergeTickets e duplicateTicket gravam SQL direto, sem passar pelo PATCH
 *    de /api/tickets. É de propósito: aquele caminho dispara automação e
 *    notifica o cliente, e nem mesclar nem duplicar são eventos que o cliente
 *    deva receber. Mesclar também usa o status 'Mesclado' em vez de 'Fechado'
 *    justamente para não acionar a automação de encerramento.
 *
 * 2. saveTicketFromChatSession NÃO copia o histórico da conversa para
 *    tickets.description. O histórico continua só em chat_messages, e o chamado
 *    aponta para a sessão — duplicar o texto criaria uma cópia que envelhece
 *    enquanto a conversa continua.
 */

export async function POST(request: Request) {
  const actor = await getCurrentActionUser();
  if (!actor) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  try {
    const body = await request.json();
    const { action } = body;

    // =====================================================================
    // Assumir / transferir atendimento
    // =====================================================================
    if (action === 'assign') {
      const { sessionId, assigneeId, actingUserId } = body;
      const sessionRes = await query(
        'SELECT customer_id, assignee_id FROM public.chat_sessions WHERE id = $1',
        [sessionId]
      );
      const session = sessionRes.rows[0];
      if (!session) return NextResponse.json({ error: 'Atendimento não encontrado.' }, { status: 404 });

      const previousAssigneeId: string | null = session.assignee_id;
      const assigneeChanged = previousAssigneeId !== assigneeId;

      await query(
        `UPDATE public.chat_sessions SET assignee_id = $1, status = 'active', updated_at = NOW() WHERE id = $2`,
        [assigneeId, sessionId]
      );

      if (assigneeChanged) {
        const agentRes = await query('SELECT name FROM public.profiles WHERE id = $1', [assigneeId]);
        const agentName = agentRes.rows[0]?.name;

        if (agentName) {
          // Push de apresentação ao cliente. Não existe bolha equivalente na
          // conversa: o nome do operador aparece em cada mensagem dele, e um
          // aviso isolado ficaria desatualizado na primeira transferência.
          try {
            const recipients = await getChatRecipientIds({ customerId: session.customer_id }, null, true);
            const toNotify = await excludeActiveViewers(sessionId, recipients);
            await Promise.all(toNotify.map(id => notifyUser(id, {
              title: `Você está falando com ${agentName}`,
              body: 'Um atendente está com você agora.',
              url: `/chat?chat=${sessionId}`,
              tag: `chat_assign:${sessionId}`
            })));
          } catch (err) {
            console.error('Error notifying about chat assignment:', err);
          }
        }

        // Log de transferência só quando JÁ havia alguém com a conversa — do
        // contrário é um "assumir" comum. O texto sempre descreve quem de fato
        // clicou (actingUserId), nunca o responsável anterior: alguém puxando
        // para si um chat que estava com outra pessoa não é essa outra pessoa
        // "transferindo".
        let logText: string | null = null;
        if (agentName && actingUserId && previousAssigneeId) {
          if (actingUserId !== assigneeId) {
            const actingUserRes = await query('SELECT name FROM public.profiles WHERE id = $1', [actingUserId]);
            logText = `${actingUserRes.rows[0]?.name || 'Alguém'} transferiu a conversa para ${agentName}.`;
          } else if (previousAssigneeId !== assigneeId) {
            const previousAgentRes = await query('SELECT name FROM public.profiles WHERE id = $1', [previousAssigneeId]);
            logText = `${agentName} assumiu a conversa, que estava com ${previousAgentRes.rows[0]?.name || 'Alguém'}.`;
          }
        }

        if (logText) {
          try {
            const logMessageId = crypto.randomUUID();
            const logTimestamp = new Date().toISOString();

            // type 'internal': aviso de bastidores para o time, nunca visível
            // ao cliente (ver filtro em chat-widget.tsx).
            await query(
              `INSERT INTO public.chat_messages (id, session_id, sender_id, sender_name, text, type, metadata, created_at)
               VALUES ($1, $2, NULL, 'SSX Desk', $3, 'internal', '{}'::jsonb, $4)`,
              [logMessageId, sessionId, logText, logTimestamp]
            );

            emitChatEvent(sessionId, {
              type: 'message',
              sessionId,
              message: {
                id: logMessageId, senderId: null, senderName: 'SSX Desk',
                text: logText, timestamp: logTimestamp, type: 'internal',
                metadata: {}, attachments: []
              }
            });

            const teamIds = (await getTeamUserIds()).filter(id => id !== actingUserId);
            const toNotify = await excludeActiveViewers(sessionId, teamIds);
            await Promise.all(toNotify.map(id => notifyUser(id, {
              title: 'Atendimento transferido',
              body: logText as string,
              url: `/chat?chat=${sessionId}`,
              tag: `chat_message:${logMessageId}`
            })));
          } catch (err) {
            console.error('Error registering internal chat transfer message:', err);
          }
        }
      }

      return NextResponse.json({ success: true });
    }

    // =====================================================================
    // Devolver para a fila
    // =====================================================================
    if (action === 'return-to-queue') {
      const { sessionId, queueId, actingUserId } = body;
      const sessionRes = await query('SELECT customer_id, assignee_id FROM public.chat_sessions WHERE id = $1', [sessionId]);
      if (!sessionRes.rows[0]) return NextResponse.json({ error: 'Atendimento não encontrado.' }, { status: 404 });

      const queueRes = await query('SELECT id, name, member_ids FROM public.queues WHERE id = $1', [queueId]);
      const queue = queueRes.rows[0];
      if (!queue) return NextResponse.json({ error: 'Fila não encontrada.' }, { status: 404 });

      // Escolha + gravação sob o MESMO lock por fila: sem isso, duas devoluções
      // quase simultâneas calculam o mesmo "próximo" e caem no mesmo analista.
      await runExclusive(`queue-assign:${queue.id}`, async () => {
        const nextAssigneeId = await pickNextQueueAssignee({ id: queue.id, memberIds: queue.member_ids || [] });
        await query(
          `UPDATE public.chat_sessions
              SET assignee_id = $1, queue_id = $2, status = $3, updated_at = NOW()
            WHERE id = $4`,
          [nextAssigneeId, queueId, nextAssigneeId ? 'active' : 'pending', sessionId]
        );
      });

      const actingUserRes = await query('SELECT name FROM public.profiles WHERE id = $1', [actingUserId]);
      const actingUserName = actingUserRes.rows[0]?.name || 'Alguém';

      const messageId = crypto.randomUUID();
      const text = `${actingUserName} devolveu a conversa para a fila ${queue.name}.`;
      const timestamp = new Date().toISOString();

      await query(
        `INSERT INTO public.chat_messages (id, session_id, sender_id, sender_name, text, type, metadata, created_at)
         VALUES ($1, $2, NULL, 'SSX Desk', $3, 'internal', '{}'::jsonb, $4)`,
        [messageId, sessionId, text, timestamp]
      );
      await query('UPDATE public.chat_sessions SET last_message_at = $1 WHERE id = $2', [timestamp, sessionId]);

      emitChatEvent(sessionId, {
        type: 'message',
        sessionId,
        message: {
          id: messageId, senderId: null, senderName: 'SSX Desk',
          text, timestamp, type: 'internal', metadata: {}, attachments: []
        }
      });

      try {
        const teamIds = ((queue.member_ids || []) as string[]).length
          ? (queue.member_ids as string[])
          : await getTeamUserIds();
        const toNotify = await excludeActiveViewers(sessionId, teamIds.filter(id => id !== actingUserId));
        await Promise.all(toNotify.map(id => notifyUser(id, {
          title: 'Atendimento devolvido para a fila',
          body: text,
          url: `/chat?chat=${sessionId}`,
          tag: `chat_message:${messageId}`
        })));
      } catch (err) {
        console.error('Error notifying about chat queue return:', err);
      }

      return NextResponse.json({ success: true });
    }

    // =====================================================================
    // Encerrar atendimento (após gerar chamado)
    // =====================================================================
    if (action === 'close') {
      const { sessionId, awaitingSurveyUntil } = body;
      await query(
        `UPDATE public.chat_sessions SET status = 'closed', awaiting_survey_until = $1, updated_at = NOW() WHERE id = $2`,
        [awaitingSurveyUntil ?? null, sessionId]
      );
      return NextResponse.json({ success: true });
    }

    // =====================================================================
    // Gerar chamado a partir da conversa
    // =====================================================================
    if (action === 'create-ticket') {
      const { sessionId, ticketTitle, closeTicketImmediately, forceNew = false } = body;

      const sessionRes = await query(
        'SELECT customer_id, assignee_id, ticket_id, ticket_number FROM public.chat_sessions WHERE id = $1',
        [sessionId]
      );
      const session = sessionRes.rows[0];
      if (!session) return NextResponse.json({ error: 'Atendimento não encontrado.' }, { status: 404 });

      // Já existe chamado vinculado: reaproveita em vez de abrir um segundo
      // para o mesmo atendimento — a menos que quem clicou tenha confirmado
      // que quer outro (forceNew, ver o popup em chat-widget.tsx).
      if (session.ticket_id && !forceNew) {
        if (closeTicketImmediately) {
          await query(`UPDATE public.tickets SET status = 'Fechado', updated_at = NOW() WHERE id = $1`, [session.ticket_id]);
        }
        return NextResponse.json({ ticketId: session.ticket_id, ticketNumber: session.ticket_number });
      }

      let companyId: string | null = null;
      if (session.customer_id) {
        const profileRes = await query('SELECT company_id FROM public.profiles WHERE id = $1', [session.customer_id]);
        companyId = profileRes.rows[0]?.company_id || null;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const ticketRes = await client.query(
          `INSERT INTO public.tickets (title, description, status, priority, category, company_id, customer_id, assignee_id, created_by, chat_session_id)
           VALUES ($1, '', $2, 'Média', 'Atendimento Chat', $3, $4, $5, $6, $7)
           RETURNING id, public_ticket_number`,
          [
            ticketTitle,
            closeTicketImmediately ? 'Fechado' : 'Novo',
            companyId,
            session.customer_id || null,
            session.assignee_id || actor.id,
            actor.id,
            sessionId
          ]
        );
        const { id: ticketId, public_ticket_number: ticketNumber } = ticketRes.rows[0];

        // chat_sessions.ticket_id aponta para o chamado MAIS RECENTE desta
        // conversa (é o badge do chat). Chamados anteriores continuam
        // existindo, ligados por tickets.chat_session_id.
        await client.query(
          'UPDATE public.chat_sessions SET ticket_id = $1, ticket_number = $2 WHERE id = $3',
          [ticketId, ticketNumber, sessionId]
        );

        await client.query('COMMIT');
        return NextResponse.json({ ticketId, ticketNumber });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // =====================================================================
    // Vincular a conversa a um chamado JÁ existente
    // =====================================================================
    if (action === 'link-ticket') {
      const { sessionId, ticketId } = body;
      const ticketRes = await query('SELECT id, public_ticket_number FROM public.tickets WHERE id = $1', [ticketId]);
      const ticket = ticketRes.rows[0];
      if (!ticket) return NextResponse.json({ error: 'Chamado não encontrado.' }, { status: 404 });

      await query('UPDATE public.tickets SET chat_session_id = $1 WHERE id = $2', [sessionId, ticketId]);
      await query(
        'UPDATE public.chat_sessions SET ticket_id = $1, ticket_number = $2 WHERE id = $3',
        [ticket.id, ticket.public_ticket_number, sessionId]
      );
      return NextResponse.json({ ticketId: ticket.id, ticketNumber: ticket.public_ticket_number });
    }

    // =====================================================================
    // Mesclar chamados
    // =====================================================================
    if (action === 'merge-tickets') {
      const { sourceTicketIds, targetTicketId } = body;
      if (!sourceTicketIds?.length) {
        return NextResponse.json({ error: 'Nenhum chamado selecionado para mesclar.' }, { status: 400 });
      }

      const targetRes = await query('SELECT id, public_ticket_number FROM public.tickets WHERE id = $1', [targetTicketId]);
      const target = targetRes.rows[0];
      if (!target) return NextResponse.json({ error: 'Chamado principal não encontrado.' }, { status: 404 });
      const targetLabel = `#${String(target.public_ticket_number).padStart(4, '0')}`;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        for (const sourceId of sourceTicketIds) {
          if (sourceId === targetTicketId) continue;

          const sourceRes = await client.query('SELECT id, public_ticket_number FROM public.tickets WHERE id = $1', [sourceId]);
          const source = sourceRes.rows[0];
          if (!source) continue;
          const sourceLabel = `#${String(source.public_ticket_number).padStart(4, '0')}`;

          // sub_status também é limpo: sem isso o absorvido fica com
          // status='Mesclado' e um sub-status órfão de um status pai que não
          // existe mais — combinação que a UI normal nunca produziria.
          await client.query(
            `UPDATE public.tickets SET status = 'Mesclado', sub_status = NULL, merged_into_id = $1, updated_at = NOW() WHERE id = $2`,
            [targetTicketId, sourceId]
          );

          // Chats que apontavam para o absorvido passam a apontar para o
          // sobrevivente, senão o badge do chat fica preso a um chamado morto.
          await client.query(
            'UPDATE public.chat_sessions SET ticket_id = $1, ticket_number = $2 WHERE ticket_id = $3',
            [target.id, target.public_ticket_number, sourceId]
          );

          await client.query(
            `INSERT INTO public.ticket_messages (ticket_id, author_id, content, type, is_visible_to_customer)
             VALUES ($1, $2, $3, 'system', false)`,
            [targetTicketId, actor.id, `Chamado ${sourceLabel} mesclado neste chamado.`]
          );
          await client.query(
            `INSERT INTO public.ticket_messages (ticket_id, author_id, content, type, is_visible_to_customer)
             VALUES ($1, $2, $3, 'system', false)`,
            [sourceId, actor.id, `Este chamado foi mesclado no chamado ${targetLabel}.`]
          );
        }

        await client.query('COMMIT');
        return NextResponse.json({ success: true, ticketId: target.id, ticketNumber: target.public_ticket_number });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // =====================================================================
    // Duplicar chamado
    // =====================================================================
    if (action === 'duplicate-ticket') {
      const { ticketId } = body;
      const sourceRes = await query(
        `SELECT title, description, public_ticket_number, category, queue_id, category_id,
                request_type_id, product_id, company_id, customer_id, priority
           FROM public.tickets WHERE id = $1`,
        [ticketId]
      );
      const source = sourceRes.rows[0];
      if (!source) return NextResponse.json({ error: 'Chamado não encontrado.' }, { status: 404 });
      const sourceLabel = `#${String(source.public_ticket_number).padStart(4, '0')}`;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Cópia "em branco": leva dados cadastrais e corpo, mas nasce SEM
        // atendente, sem vínculo de chat e sem as mensagens do atendimento
        // original.
        const newRes = await client.query(
          `INSERT INTO public.tickets (title, description, status, priority, category, queue_id, category_id,
                                       request_type_id, product_id, company_id, customer_id, created_by)
           VALUES ($1, $2, 'Novo', $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id, public_ticket_number`,
          [source.title, source.description, source.priority, source.category, source.queue_id,
           source.category_id, source.request_type_id, source.product_id, source.company_id,
           source.customer_id, actor.id]
        );
        const { id: newTicketId, public_ticket_number: newTicketNumber } = newRes.rows[0];

        await client.query(
          `INSERT INTO public.ticket_messages (ticket_id, author_id, content, type, is_visible_to_customer)
           VALUES ($1, $2, $3, 'system', false)`,
          [newTicketId, actor.id, `Duplicado a partir do chamado ${sourceLabel}.`]
        );

        await client.query('COMMIT');
        return NextResponse.json({ ticketId: newTicketId, ticketNumber: newTicketNumber });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    return NextResponse.json({ error: 'Action não suportada.' }, { status: 400 });
  } catch (err: any) {
    console.error('Error in chat-sessions POST:', err);
    return NextResponse.json({ error: 'Erro ao processar a operação do atendimento.' }, { status: 500 });
  }
}
