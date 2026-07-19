import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { emitChatEvent, excludeActiveViewers } from '@/lib/chat-events';
import { notifyUser } from '@/lib/services/push-service';
import { getChatRecipientIds, isTeamRole } from '@/lib/services/notification-recipients';
import { resolveCombinedQueuePool, pickNextQueueAssignee } from '@/lib/services/queue-routing';

function normalizePhone(value?: string | null): string {
  return (value || '').replace(/\D/g, '');
}

function phoneLookupVariants(phone?: string | null): string[] {
  const digits = normalizePhone(phone);
  if (!digits) return [];
  const variants = new Set<string>([digits]);
  if (digits.startsWith('55') && digits.length > 11) {
    variants.add(digits.slice(2));
  } else if (digits.length <= 11) {
    variants.add(`55${digits}`);
  }
  return [...variants];
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    if (action === 'sessions') {
      // Obter todas as sessões e suas respectivas mensagens.
      // Sessões cujo "telefone" tem mais dígitos do que um número real (E.164, até 15)
      // são resquícios de mensagens de grupo/broadcast processadas por engano no passado.
      const sessionsRes = await query(
        `SELECT * FROM public.chat_sessions
         WHERE customer_phone IS NULL OR length(regexp_replace(customer_phone, '\\D', '', 'g')) <= 15
         ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC`
      );
      // Conversas fechadas já têm o histórico salvo em chat_histories (texto) e não
      // aparecem na fila/lista ativa — não há motivo para reenviar seus anexos (áudio/
      // imagem em base64) a cada polling do widget de chat. Exceção: enquanto a janela
      // da pesquisa de satisfação estiver aberta, a sessão fechada ainda precisa expor
      // a mensagem de encerramento (e uma eventual resposta "1"/"0") no widget.
      const messagesRes = await query(
        `SELECT m.* FROM public.chat_messages m
         JOIN public.chat_sessions s ON s.id = m.session_id
         WHERE s.status != 'closed'
            OR (s.awaiting_survey_until IS NOT NULL AND s.awaiting_survey_until > NOW())
         ORDER BY m.created_at ASC`
      );
      
      const messagesBySession = new Map<string, any[]>();
      messagesRes.rows.forEach(m => {
        const arr = messagesBySession.get(m.session_id) || [];
        arr.push({
          id: m.id,
          senderId: m.sender_id,
          senderName: m.sender_name,
          text: m.text,
          timestamp: m.created_at,
          type: m.type,
          metadata: m.metadata,
          attachments: m.metadata?.attachments || []
        });
        messagesBySession.set(m.session_id, arr);
      });

      const sessions = sessionsRes.rows.map(s => ({
        id: s.id,
        customerId: s.customer_id,
        customerName: s.customer_name,
        customerPhone: s.customer_phone,
        assigneeId: s.assignee_id,
        queueId: s.queue_id,
        status: s.status,
        ticketId: s.ticket_id,
        ticketNumber: s.ticket_number,
        startedAt: s.created_at,
        lastMessageAt: s.last_message_at || s.created_at,
        awaitingSurveyUntil: s.awaiting_survey_until,
        messages: messagesBySession.get(s.id) || []
      }));

      return NextResponse.json(sessions);
    }

    if (action === 'sessions-summary') {
      // Versão leve de `sessions`: sem o array de mensagens completo (que inclui
      // anexos em base64) — pensada para a lista de conversas em conexões
      // móveis, onde baixar o histórico inteiro de toda sessão aberta a cada
      // poll é desnecessário. Mensagens completas continuam vindo só da ação
      // `sessions` (ou do SSE), buscadas quando uma conversa é de fato aberta.
      const sessionsRes = await query(
        `SELECT * FROM public.chat_sessions
         WHERE customer_phone IS NULL OR length(regexp_replace(customer_phone, '\\D', '', 'g')) <= 15
         ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC`
      );

      const lastMessagesRes = await query(
        `SELECT DISTINCT ON (session_id) session_id, id, sender_id, sender_name, text, type, created_at
         FROM public.chat_messages
         ORDER BY session_id, created_at DESC`
      );
      const lastMessageBySession = new Map(lastMessagesRes.rows.map(m => [m.session_id, m]));

      const sessions = sessionsRes.rows.map(s => {
        const lastMessage = lastMessageBySession.get(s.id);
        return {
          id: s.id,
          customerId: s.customer_id,
          customerName: s.customer_name,
          customerPhone: s.customer_phone,
          assigneeId: s.assignee_id,
          queueId: s.queue_id,
          status: s.status,
          ticketId: s.ticket_id,
          ticketNumber: s.ticket_number,
          startedAt: s.created_at,
          lastMessageAt: s.last_message_at || s.created_at,
          awaitingSurveyUntil: s.awaiting_survey_until,
          lastMessage: lastMessage ? {
            id: lastMessage.id,
            senderId: lastMessage.sender_id,
            senderName: lastMessage.sender_name,
            text: lastMessage.text,
            timestamp: lastMessage.created_at,
            type: lastMessage.type
          } : null
        };
      });

      return NextResponse.json(sessions);
    }

    if (action === 'histories') {
      const res = await query(
        `SELECT h.*, p1.name as customer_profile_name, p2.name as assignee_profile_name 
         FROM public.chat_histories h
         LEFT JOIN public.profiles p1 ON h.customer_id = p1.id
         LEFT JOIN public.profiles p2 ON h.assignee_id = p2.id
         ORDER BY h.finished_at DESC`
      );
      
      return NextResponse.json(res.rows.map(h => ({
        id: h.id,
        sessionId: h.session_id,
        customerId: h.customer_id,
        customerName: h.customer_name || h.customer_profile_name,
        customerPhone: h.customer_phone,
        assigneeId: h.assignee_id,
        assigneeName: h.assignee_profile_name,
        startedAt: h.started_at,
        finishedAt: h.finished_at,
        durationSeconds: h.duration_seconds,
        firstResponseSeconds: h.first_response_seconds,
        rating: h.rating,
        transcript: h.transcript
      })));
    }

    if (action === 'status-history') {
      const res = await query('SELECT * FROM public.user_status_history ORDER BY timestamp DESC LIMIT 500');
      return NextResponse.json(res.rows.map(h => ({
        id: h.id,
        userId: h.user_id,
        status: h.status,
        reason: h.reason,
        timestamp: h.timestamp,
        duration: h.duration
      })));
    }

    if (action === 'absence-reasons') {
      const res = await query('SELECT * FROM public.absence_reasons ORDER BY created_at ASC');
      return NextResponse.json(res.rows.map(r => ({ id: r.id, label: r.label })));
    }

    if (action === 'analyst-status') {
      const res = await query('SELECT * FROM public.analyst_status');
      return NextResponse.json(res.rows.map(s => ({
        userId: s.user_id,
        isOnline: s.is_online,
        lastActive: s.last_active,
        currentLoad: s.current_load,
        currentReason: s.current_reason
      })));
    }

    if (action === 'internal-chats') {
      const token = request.cookies.get('token')?.value;
      const authenticatedUser = token ? await verifyJWT(token) : null;
      if (!authenticatedUser?.id) {
        return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
      }

      const res = await query(
        `SELECT *
         FROM public.internal_chats
         WHERE $1::uuid = ANY(member_ids)
         ORDER BY last_message_at DESC`,
        [authenticatedUser.id]
      );
      return NextResponse.json(res.rows.map(c => ({
        id: c.id,
        name: c.name,
        imageUrl: c.image_url,
        type: c.type,
        memberIds: c.member_ids || [],
        messages: [],
        lastMessageAt: c.last_message_at || c.created_at,
        pinnedBy: c.pinned_by || [],
        pinnedMessageIds: c.pinned_message_ids || [],
        mutedBy: c.muted_by || [],
        readLaterBy: c.read_later_by || [],
        hiddenBy: c.hidden_by || []
      })));
    }

    if (action === 'internal-messages') {
      const chatId = searchParams.get('chatId');
      if (!chatId) return NextResponse.json({ error: 'chatId é obrigatório' }, { status: 400 });

      const token = request.cookies.get('token')?.value;
      const authenticatedUser = token ? await verifyJWT(token) : null;
      if (!authenticatedUser?.id) {
        return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
      }

      const res = await query(
        `SELECT m.*
         FROM public.internal_chat_messages m
         JOIN public.internal_chats c ON c.id = m.chat_id
         WHERE m.chat_id = $1
           AND $2::uuid = ANY(c.member_ids)
         ORDER BY m.created_at ASC`,
        [chatId, authenticatedUser.id]
      );
      return NextResponse.json(res.rows.map(m => ({
        id: m.id,
        senderId: m.sender_id,
        senderName: m.sender_name,
        text: m.text,
        timestamp: m.created_at,
        type: m.type,
        metadata: m.metadata,
        readBy: [],
        attachments: m.metadata?.attachments || []
      })));
    }

    return NextResponse.json({ error: 'Action não suportada.' }, { status: 400 });
  } catch (error: any) {
    console.error('Error in chats GET:', {
      action,
      message: error?.message,
      code: error?.code,
      detail: error?.detail,
      stack: error?.stack
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'save-session') {
      const { session } = body;
      await query(
        `INSERT INTO public.chat_sessions (id, customer_id, customer_name, customer_phone, assignee_id, queue_id, status, ticket_id, ticket_number, created_at, last_message_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
         ON CONFLICT (id) DO UPDATE SET
           customer_id = EXCLUDED.customer_id,
           customer_name = EXCLUDED.customer_name,
           customer_phone = EXCLUDED.customer_phone,
           assignee_id = EXCLUDED.assignee_id,
           queue_id = EXCLUDED.queue_id,
           status = EXCLUDED.status,
           ticket_id = COALESCE(EXCLUDED.ticket_id, chat_sessions.ticket_id),
           ticket_number = COALESCE(EXCLUDED.ticket_number, chat_sessions.ticket_number),
           last_message_at = EXCLUDED.last_message_at,
           updated_at = NOW()`,
        [
          session.id,
          session.customerId || null,
          session.customerName || null,
          session.customerPhone || null,
          session.assigneeId || null,
          session.queueId || null,
          session.status,
          session.ticketId || null,
          session.ticketNumber || null,
          session.startedAt,
          session.lastMessageAt
        ]
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'create-session') {
      const { session } = body;
      const phoneVariants = phoneLookupVariants(session.customerPhone);
      const lookupClauses: string[] = [];
      const lookupParams: any[] = [];

      if (session.customerId) {
        lookupParams.push(session.customerId);
        lookupClauses.push(`customer_id = $${lookupParams.length}`);
      }

      if (phoneVariants.length > 0) {
        const placeholders = phoneVariants.map((_, i) => `$${lookupParams.length + i + 1}`).join(',');
        lookupClauses.push(`regexp_replace(COALESCE(customer_phone, ''), '\\D', '', 'g') IN (${placeholders})`);
        lookupParams.push(...phoneVariants);
      }

      if (lookupClauses.length > 0) {
        // Só reaproveita uma sessão fechada enquanto a janela da pesquisa de
        // satisfação dela ainda estiver aberta (resposta "1"/"0" chegando
        // atrasada) — fora disso, "fechada" significa fechada de verdade: um
        // novo contato do mesmo cliente é outro atendimento, com número de
        // conversa novo, não uma reabertura silenciosa do anterior.
        const existing = await query(
          `SELECT id FROM public.chat_sessions
           WHERE (${lookupClauses.map(c => `(${c})`).join(' OR ')})
             AND (status != 'closed' OR (awaiting_survey_until IS NOT NULL AND awaiting_survey_until > NOW()))
           ORDER BY updated_at DESC, created_at DESC
           LIMIT 1`,
          lookupParams
        );

        if ((existing.rowCount || 0) > 0) {
          const existingId = existing.rows[0].id;
          await query(
            `UPDATE public.chat_sessions
             SET customer_id = COALESCE($1, customer_id),
                 customer_name = COALESCE($2, customer_name),
                 customer_phone = COALESCE($3, customer_phone),
                 status = $4,
                 updated_at = NOW()
             WHERE id = $5`,
            [
              session.customerId || null,
              session.customerName || null,
              session.customerPhone || null,
              session.status || 'active',
              existingId
            ]
          );
          return NextResponse.json({ id: existingId, reused: true });
        }
      }

      const id = session.id || crypto.randomUUID();
      let status = session.status || 'pending';
      let queueId: string | null = null;
      let assigneeId: string | null = null;

      // Distribuição automática: só entra em ação quando a conversa chega como
      // 'pending' (é o caso do widget abrindo sozinho o chat de um usuário
      // logado, chat-widget.tsx) — se já veio 'active' é porque um agente
      // iniciou a conversa manualmente (ex.: "Novo WhatsApp"), e nesse caso o
      // próprio agente já é quem está assumindo, sem round-robin. Como essa
      // conversa não chegou por nenhuma instância de WhatsApp específica, usa
      // o pool combinado de todas as filas (mesmo comportamento/rodízio das
      // conversas de WhatsApp, só que somando os analistas de todas as filas).
      if (status === 'pending') {
        const pool = await resolveCombinedQueuePool();
        if (pool) {
          assigneeId = await pickNextQueueAssignee(pool);
          if (assigneeId) status = 'active';
        }
      }

      await query(
        `INSERT INTO public.chat_sessions (id, customer_id, customer_name, customer_phone, status, queue_id, assignee_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          id,
          session.customerId || null,
          session.customerName || null,
          session.customerPhone || null,
          status,
          queueId,
          assigneeId,
          session.startedAt
        ]
      );
      return NextResponse.json({ id, assigneeId });
    }

    if (action === 'push-message') {
      const { sessionId, message } = body;
      const metadata = { ...(message.metadata || {}), attachments: message.attachments || message.metadata?.attachments || [] };
      await query(
        `INSERT INTO public.chat_messages (id, session_id, sender_id, sender_name, text, type, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [
          message.id,
          sessionId,
          message.senderId || null,
          message.senderName || null,
          message.text,
          message.type || 'text',
          JSON.stringify(metadata),
          message.timestamp
        ]
      );
      await query(
        `UPDATE public.chat_sessions
         SET last_message_at = $1,
             status = CASE WHEN status = 'closed' THEN 'pending' ELSE status END,
             updated_at = NOW()
         WHERE id = $2`,
        [message.timestamp, sessionId]
      );
      emitChatEvent(sessionId, {
        type: 'message',
        sessionId,
        message: {
          id: message.id,
          senderId: message.senderId || null,
          senderName: message.senderName || null,
          text: message.text,
          timestamp: message.timestamp,
          type: message.type || 'text',
          metadata,
          attachments: metadata.attachments || []
        }
      });

      (async () => {
        try {
          const [senderRoleRes, sessionRes] = await Promise.all([
            message.senderId
              ? query('SELECT role FROM public.profiles WHERE id = $1', [message.senderId])
              : Promise.resolve({ rows: [] as any[] }),
            query('SELECT customer_id, customer_name FROM public.chat_sessions WHERE id = $1', [sessionId])
          ]);
          const senderIsTeam = isTeamRole(senderRoleRes.rows[0]?.role);
          const session = sessionRes.rows[0];
          const recipients = await getChatRecipientIds({ customerId: session?.customer_id }, message.senderId || null, senderIsTeam);
          // Não manda push pra quem já está com essa conversa aberta (conectado
          // ao SSE dela agora) — mesmo espírito do WhatsApp.
          const toNotify = await excludeActiveViewers(sessionId, recipients);

          await Promise.all(toNotify.map(id => notifyUser(id, {
            title: `Nova mensagem de ${message.senderName || session?.customer_name || 'Cliente'}`,
            body: message.text || 'Anexo enviado',
            url: `/chat?chat=${sessionId}`,
            tag: `chat_message:${message.id}`
          })));
        } catch (err) {
          console.error('[push] Falha ao notificar mensagem de chat:', err);
        }
      })();

      return NextResponse.json({ success: true });
    }

    if (action === 'submit-survey-response') {
      const { sessionId, rating, message } = body;

      // Grava a resposta ("1"/"0") como mensagem normal, mas via INSERT direto
      // (sem passar pelo fluxo de push-message) para NÃO acionar o
      // reabre-sessão-fechada — responder a pesquisa não deve reabrir o
      // atendimento como se fosse uma nova conversa.
      if (message) {
        await query(
          `INSERT INTO public.chat_messages (id, session_id, sender_id, sender_name, text, type, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
          [
            message.id,
            sessionId,
            message.senderId || null,
            message.senderName || null,
            message.text,
            message.type || 'text',
            JSON.stringify({}),
            message.timestamp
          ]
        );
        await query(
          'UPDATE public.chat_sessions SET last_message_at = $1, updated_at = NOW() WHERE id = $2',
          [message.timestamp, sessionId]
        );
        emitChatEvent(sessionId, {
          type: 'survey-response',
          sessionId,
          message: {
            id: message.id,
            senderId: message.senderId || null,
            senderName: message.senderName || null,
            text: message.text,
            timestamp: message.timestamp,
            type: message.type || 'text',
            metadata: {},
            attachments: []
          }
        });
      }

      await query(
        `UPDATE public.chat_histories SET rating = $1
         WHERE id = (SELECT id FROM public.chat_histories WHERE session_id = $2 ORDER BY created_at DESC LIMIT 1)`,
        [rating, sessionId]
      );
      await query(
        'UPDATE public.chat_sessions SET awaiting_survey_until = NULL WHERE id = $1',
        [sessionId]
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'save-status') {
      const { status } = body;
      await query(
        `INSERT INTO public.analyst_status (user_id, is_online, last_active, current_load)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           is_online = EXCLUDED.is_online,
           last_active = EXCLUDED.last_active,
           current_load = EXCLUDED.current_load`,
        [status.userId, status.isOnline, status.lastActive, status.currentLoad]
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'log-status-change') {
      const { userId, status, reason } = body;
      await query(
        `INSERT INTO public.analyst_status (user_id, is_online, last_active, current_reason, status)
         VALUES ($1, $2, NOW(), $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           is_online = EXCLUDED.is_online,
           last_active = NOW(),
           current_reason = EXCLUDED.current_reason,
           status = EXCLUDED.status`,
        [userId, status === 'online', reason || null, status]
      );
      await query(
        `INSERT INTO public.user_status_history (user_id, status, reason, timestamp)
         VALUES ($1, $2, $3, NOW())`,
        [userId, status, reason || null]
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'save-absence-reason') {
      const { reason } = body;
      await query('INSERT INTO public.absence_reasons (label) VALUES ($1)', [reason.label]);
      return NextResponse.json({ success: true });
    }

    if (action === 'delete-absence-reason') {
      const { id } = body;
      await query('DELETE FROM public.absence_reasons WHERE id = $1', [id]);
      return NextResponse.json({ success: true });
    }

    if (action === 'save-internal-chat') {
      const { chat } = body;
      await query(
        `INSERT INTO public.internal_chats (
           id, name, image_url, type, member_ids, last_message_at,
           pinned_by, pinned_message_ids, muted_by, read_later_by, hidden_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           image_url = EXCLUDED.image_url,
           type = EXCLUDED.type,
           member_ids = EXCLUDED.member_ids,
           last_message_at = EXCLUDED.last_message_at,
           pinned_by = EXCLUDED.pinned_by,
           pinned_message_ids = EXCLUDED.pinned_message_ids,
           muted_by = EXCLUDED.muted_by,
           read_later_by = EXCLUDED.read_later_by,
           hidden_by = EXCLUDED.hidden_by`,
        [
          chat.id, chat.name, chat.imageUrl || null, chat.type, chat.memberIds || [],
          chat.lastMessageAt || null, chat.pinnedBy || [], chat.pinnedMessageIds || [],
          chat.mutedBy || [], chat.readLaterBy || [], chat.hiddenBy || []
        ]
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'delete-internal-message') {
      const { chatId, messageId, userId } = body;
      if (!chatId || !messageId || !userId) {
        return NextResponse.json({ error: 'Dados incompletos para excluir a mensagem.' }, { status: 400 });
      }

      const deleted = await query(
        `DELETE FROM public.internal_chat_messages
         WHERE id = $1 AND chat_id = $2 AND sender_id = $3
         RETURNING id`,
        [messageId, chatId, userId]
      );

      if (deleted.rowCount === 0) {
        return NextResponse.json({ error: 'Mensagem não encontrada ou sem permissão para excluir.' }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    }

    if (action === 'save-internal-message') {
      const { chatId, message } = body;
      const internalMetadata = { ...message.metadata, attachments: message.attachments || [] };
      await query(
        `INSERT INTO public.internal_chat_messages (chat_id, sender_id, sender_name, text, type, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          chatId,
          message.senderId || null,
          message.senderName || null,
          message.text,
          message.type || 'text',
          JSON.stringify(internalMetadata),
          message.timestamp || new Date().toISOString()
        ]
      );
      await query(
        'UPDATE public.internal_chats SET last_message_at = $1 WHERE id = $2',
        [message.timestamp || new Date().toISOString(), chatId]
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'save-history') {
      const { history } = body;
      await query(
        `INSERT INTO public.chat_histories (session_id, customer_id, customer_name, customer_phone, assignee_id, started_at, finished_at, duration_seconds, first_response_seconds, rating, transcript)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          history.sessionId,
          history.customerId || null,
          history.customerName || null,
          history.customerPhone || null,
          history.assigneeId || null,
          history.startedAt,
          history.finishedAt,
          history.durationSeconds || null,
          history.firstResponseSeconds || null,
          history.rating || null,
          history.transcript || ''
        ]
      );
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Action não suportada.' }, { status: 400 });
  } catch (error: any) {
    console.error('Error in chats POST:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
