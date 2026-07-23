import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { emitChatEvent, excludeActiveViewers, emitInternalChatEvent } from '@/lib/chat-events';
import { notifyUser } from '@/lib/services/push-service';
import { getChatRecipientIds, isTeamRole } from '@/lib/services/notification-recipients';
import { resolveCombinedQueuePool, pickNextQueueAssignee, RoutingQueue } from '@/lib/services/queue-routing';
import { transcribeMessageAudio, isAudioAttachment, isTranscriptionEnabled } from '@/lib/services/transcription-service';
import { Attachment } from '@/lib/types';
import { runExclusive } from '@/lib/key-mutex';

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

      // "Entregue" (2o check, cinza): marca só pra quem de fato é parte da
      // conversa (cliente dono, ou analista responsável) — evita marcar
      // "entregue" pra todo mundo do time só porque o painel de fila listou
      // a sessão. `userId` é opcional (rotas antigas/scripts continuam
      // funcionando sem isso, só sem o efeito colateral de entrega).
      const deliveredForUserId = searchParams.get('userId');
      if (deliveredForUserId) {
        await query(
          `UPDATE public.chat_messages m
           SET delivered_by = array_append(m.delivered_by, $1::uuid)
           FROM public.chat_sessions s
           WHERE m.session_id = s.id
             AND (s.customer_id = $1::uuid OR s.assignee_id = $1::uuid)
             AND m.sender_id IS DISTINCT FROM $1
             AND NOT ($1::uuid = ANY(m.delivered_by))`,
          [deliveredForUserId]
        );
      }

      // Conversas fechadas já têm o histórico salvo em chat_histories (texto) e não
      // aparecem na fila/lista ativa — não há motivo para reenviar seus anexos (áudio/
      // imagem em base64) a cada polling do widget de chat. Exceção: enquanto a janela
      // da pesquisa de satisfação estiver aberta, a sessão fechada ainda precisa expor
      // a mensagem de encerramento (e uma eventual resposta "1"/"0") no widget.
      const messagesRes = await query(
        `SELECT m.*, COALESCE(r.reactions, '[]'::json) AS reactions
         FROM public.chat_messages m
         JOIN public.chat_sessions s ON s.id = m.session_id
         LEFT JOIN LATERAL (
           SELECT json_agg(json_build_object('userId', mr.user_id, 'emoji', mr.emoji)) AS reactions
           FROM public.chat_message_reactions mr
           WHERE mr.message_id = m.id
         ) r ON true
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
          readBy: m.read_by || [],
          deliveredBy: m.delivered_by || [],
          reactions: m.reactions || [],
          isEdited: !!m.edited_at,
          editedAt: m.edited_at,
          isDeleted: !!m.deleted_at,
          deletedAt: m.deleted_at,
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

    if (action === 'session-messages') {
      // Histórico ao vivo de UMA sessão específica, pra tela de detalhe do
      // chamado vinculado (ver chatSessionId em app/api/tickets/route.ts) —
      // ao contrário de `sessions`, inclui as mensagens mesmo com a sessão
      // fechada, já que aqui o objetivo é exatamente ver o que já aconteceu.
      const sessionId = searchParams.get('sessionId');
      if (!sessionId) return NextResponse.json({ error: 'sessionId é obrigatório' }, { status: 400 });

      const sessionRes = await query(
        `SELECT id, customer_name, customer_phone, status, created_at, last_message_at
         FROM public.chat_sessions WHERE id = $1`,
        [sessionId]
      );
      const session = sessionRes.rows[0];
      if (!session) return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 });

      const messagesRes = await query(
        `SELECT * FROM public.chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
        [sessionId]
      );

      return NextResponse.json({
        session: {
          id: session.id,
          customerName: session.customer_name,
          customerPhone: session.customer_phone,
          status: session.status,
          startedAt: session.created_at,
          lastMessageAt: session.last_message_at || session.created_at
        },
        messages: messagesRes.rows.map(m => ({
          id: m.id,
          senderId: m.sender_id,
          senderName: m.sender_name,
          text: m.text,
          timestamp: m.created_at,
          type: m.type,
          attachments: m.metadata?.attachments || []
        }))
      });
    }

    if (action === 'histories') {
      // "Cliente" = a empresa contratante (companies.name, via profiles.company_id
      // do usuário que conversou) — não confundir com "Funcionário", que é a
      // PESSOA do lado do cliente que efetivamente conversou (customer_name),
      // nem com "Equipe", que é quem da equipe interna atendeu (assignee_name).
      const res = await query(
        `SELECT h.*, p1.name as customer_profile_name, p1.company_id as customer_company_id,
                co.name as company_name, p2.name as assignee_profile_name,
                s.ticket_id, s.ticket_number, s.queue_id, q.name as queue_name
         FROM public.chat_histories h
         LEFT JOIN public.profiles p1 ON h.customer_id = p1.id
         LEFT JOIN public.companies co ON co.id = p1.company_id
         LEFT JOIN public.profiles p2 ON h.assignee_id = p2.id
         LEFT JOIN public.chat_sessions s ON s.id = h.session_id
         LEFT JOIN public.queues q ON q.id = s.queue_id
         ORDER BY h.finished_at DESC`
      );

      return NextResponse.json(res.rows.map(h => ({
        id: h.id,
        sessionId: h.session_id,
        customerId: h.customer_id,
        customerName: h.customer_name || h.customer_profile_name,
        customerPhone: h.customer_phone,
        companyId: h.customer_company_id,
        companyName: h.company_name,
        assigneeId: h.assignee_id,
        assigneeName: h.assignee_profile_name,
        startedAt: h.started_at,
        finishedAt: h.finished_at,
        durationSeconds: h.duration_seconds,
        firstResponseSeconds: h.first_response_seconds,
        rating: h.rating,
        transcript: h.transcript,
        ticketId: h.ticket_id,
        ticketNumber: h.ticket_number,
        queueId: h.queue_id,
        queueName: h.queue_name
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

      // "Entregue" (2o check, cinza) = o cliente deste usuário sincronizou a
      // lista de conversas — acontece aqui, toda vez que a lista carrega,
      // mesmo pra salas que não estão abertas agora. "Lido" (3o check,
      // colorido) é mais estrito e só acontece em internal-messages GET
      // abaixo, quando a sala é de fato aberta.
      await query(
        `UPDATE public.internal_chat_messages m
         SET delivered_by = array_append(m.delivered_by, $1::uuid)
         FROM public.internal_chats c
         WHERE m.chat_id = c.id
           AND $1::uuid = ANY(c.member_ids)
           AND m.sender_id IS DISTINCT FROM $1
           AND NOT ($1::uuid = ANY(m.delivered_by))`,
        [authenticatedUser.id]
      );

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

      // Abrir a sala de verdade = "lido" (3o check, colorido). Também cobre
      // delivered_by por segurança (ex.: mensagem chegou via SSE com a sala
      // já aberta, sem passar pelo internal-chats GET antes).
      const markRead = await query(
        `UPDATE public.internal_chat_messages
         SET read_by = array_append(read_by, $2::uuid),
             delivered_by = CASE WHEN $2::uuid = ANY(delivered_by) THEN delivered_by ELSE array_append(delivered_by, $2::uuid) END
         WHERE chat_id = $1 AND sender_id IS DISTINCT FROM $2 AND NOT ($2::uuid = ANY(read_by))
         RETURNING id`,
        [chatId, authenticatedUser.id]
      );
      if ((markRead.rowCount ?? 0) > 0) {
        emitInternalChatEvent(chatId, { type: 'receipt', chatId });
      }

      const res = await query(
        `SELECT m.*, COALESCE(r.reactions, '[]'::json) AS reactions
         FROM public.internal_chat_messages m
         JOIN public.internal_chats c ON c.id = m.chat_id
         LEFT JOIN LATERAL (
           SELECT json_agg(json_build_object('userId', mr.user_id, 'emoji', mr.emoji)) AS reactions
           FROM public.internal_chat_message_reactions mr
           WHERE mr.message_id = m.id
         ) r ON true
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
        readBy: m.read_by || [],
        deliveredBy: m.delivered_by || [],
        reactions: m.reactions || [],
        attachments: m.metadata?.attachments || []
      })));
    }

    if (action === 'chat-message-history') {
      // Histórico de versões de uma mensagem editada (auditoria) — mostrado
      // ao clicar em "editado" na bolha da mensagem, ver
      // migrations/chat_messages_realtime_features.sql.
      const messageId = searchParams.get('messageId');
      if (!messageId) return NextResponse.json({ error: 'messageId é obrigatório' }, { status: 400 });

      const res = await query(
        `SELECT e.previous_text, e.edited_at, p.name AS edited_by_name
         FROM public.chat_message_edits e
         LEFT JOIN public.profiles p ON p.id = e.edited_by
         WHERE e.message_id = $1
         ORDER BY e.edited_at ASC`,
        [messageId]
      );
      return NextResponse.json(res.rows.map(r => ({
        previousText: r.previous_text,
        editedAt: r.edited_at,
        editedByName: r.edited_by_name
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
      const lookupWhere = lookupClauses.map(c => `(${c})`).join(' OR ');

      async function findOpenExisting() {
        if (!lookupClauses.length) return null;
        const res = await query(
          `SELECT id, assignee_id FROM public.chat_sessions WHERE (${lookupWhere}) AND status != 'closed' ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
          lookupParams
        );
        return res.rows[0] || null;
      }

      // Tudo dentro do lock (checagem + insert), pra uma segunda chamada quase
      // simultânea do mesmo cliente (ex.: widget montando duas vezes, aba
      // duplicada) esperar esta terminar em vez de rodar em paralelo — mesma
      // proteção que já existia pro lado do WhatsApp, agora também aqui.
      const mutexKey = session.customerId || phoneVariants[0] || `anon:${session.id || 'new'}`;
      const result = await runExclusive(`create-session:${mutexKey}`, async () => {
        // "Fechada" significa fechada de verdade: um novo contato do mesmo
        // cliente é sempre outro atendimento, com sessão (e número de
        // conversa) novos — nunca uma reabertura silenciosa da anterior, nem
        // durante a janela de resposta da pesquisa de satisfação (é só o
        // widget quem decide, olhando o estado já carregado, se um "0"/"1"
        // deve ir para submit-survey-response em vez de criar sessão nova).
        const existing = await findOpenExisting();
        if (existing) {
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
              existing.id
            ]
          );
          return { id: existing.id, assigneeId: existing.assignee_id, reused: true };
        }

        const id = session.id || crypto.randomUUID();
        let status = session.status || 'pending';
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

        // ON CONFLICT sem alvo explícito cobre tanto o índice único de
        // telefone aberto quanto o de customer_id aberto — segunda rede de
        // segurança pra corrida entre processos/instâncias diferentes (o
        // mutex acima só vale dentro deste processo Node).
        const insertRes = await query(
          `INSERT INTO public.chat_sessions (id, customer_id, customer_name, customer_phone, status, queue_id, assignee_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, NOW())
           ON CONFLICT DO NOTHING
           RETURNING id, assignee_id`,
          [id, session.customerId || null, session.customerName || null, session.customerPhone || null, status, assigneeId, session.startedAt]
        );

        if (insertRes.rows[0]) {
          return { id: insertRes.rows[0].id, assigneeId: insertRes.rows[0].assignee_id };
        }

        // Perdeu a corrida contra outro processo — usa a sessão que venceu.
        const winner = await findOpenExisting();
        return winner
          ? { id: winner.id, assigneeId: winner.assignee_id, reused: true }
          : { id, assigneeId: null };
      });

      return NextResponse.json(result);
    }

    if (action === 'push-message') {
      const { sessionId, message } = body;

      const sessionRes = await query(
        `SELECT id, customer_id, customer_name, customer_phone, status, queue_id
         FROM public.chat_sessions WHERE id = $1`,
        [sessionId]
      );
      const session = sessionRes.rows[0];
      if (!session) {
        return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 });
      }

      let targetSessionId = sessionId;

      if (session.status === 'closed') {
        // Atendimento anterior está de fato encerrado: mensagem nova é outro
        // atendimento, com sessão (e número de conversa) novos — nunca uma
        // reabertura silenciosa do anterior, mesmo que ainda esteja na janela
        // de resposta da pesquisa de satisfação (isso é tratado à parte, pelo
        // widget, antes de chamar esta ação — ver isSurveyResponse em
        // chat-widget.tsx e a ação submit-survey-response). Mesma regra de
        // create-session e findOrCreateChatSession, aplicada aqui pro funil
        // de mensagens do widget.
        let queue: RoutingQueue | null = null;
        if (session.queue_id) {
          const queueRes = await query('SELECT id, member_ids FROM public.queues WHERE id = $1', [session.queue_id]);
          if (queueRes.rows[0]) queue = { id: queueRes.rows[0].id, memberIds: queueRes.rows[0].member_ids || [] };
        }
        if (!queue) queue = await resolveCombinedQueuePool();
        const assigneeId = queue ? await pickNextQueueAssignee(queue) : null;

        const newId = crypto.randomUUID();
        await query(
          `INSERT INTO public.chat_sessions (id, customer_id, customer_name, customer_phone, status, queue_id, assignee_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
          [newId, session.customer_id, session.customer_name, session.customer_phone, assigneeId ? 'active' : 'pending', queue?.id || null, assigneeId]
        );
        targetSessionId = newId;
      }

      const metadata = { ...(message.metadata || {}), attachments: message.attachments || message.metadata?.attachments || [] };
      await query(
        `INSERT INTO public.chat_messages (id, session_id, sender_id, sender_name, text, type, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [
          message.id,
          targetSessionId,
          message.senderId || null,
          message.senderName || null,
          message.text,
          message.type || 'text',
          JSON.stringify(metadata),
          message.timestamp
        ]
      );
      await query(
        `UPDATE public.chat_sessions SET last_message_at = $1, updated_at = NOW() WHERE id = $2`,
        [message.timestamp, targetSessionId]
      );
      emitChatEvent(targetSessionId, {
        type: 'message',
        sessionId: targetSessionId,
        message: {
          id: message.id,
          senderId: message.senderId || null,
          senderName: message.senderName || null,
          text: message.text,
          timestamp: message.timestamp,
          type: message.type || 'text',
          metadata,
          readBy: [],
          deliveredBy: [],
          reactions: [],
          attachments: metadata.attachments || []
        }
      });

      // Transcrição automática: dispara pra qualquer anexo de áudio, enviado
      // por quem for (agente ou cliente, via widget) — não espera clique no
      // botão "Transcrever" (que continua existindo como fallback/retry).
      if (isTranscriptionEnabled()) {
        const audioAttachments: Attachment[] = (metadata.attachments || []).filter((a: Attachment) => isAudioAttachment(a));
        audioAttachments.forEach((attachment: Attachment) => {
          transcribeMessageAudio({ messageId: message.id, sessionId: targetSessionId, attachment }).catch(err => {
            console.error('[transcription] Falha ao transcrever áudio automaticamente:', err);
          });
        });
      }

      (async () => {
        try {
          const senderRoleRes = message.senderId
            ? await query('SELECT role FROM public.profiles WHERE id = $1', [message.senderId])
            : { rows: [] as any[] };
          const senderIsTeam = isTeamRole(senderRoleRes.rows[0]?.role);
          const recipients = await getChatRecipientIds({ customerId: session.customer_id }, message.senderId || null, senderIsTeam);
          // Não manda push pra quem já está com essa conversa aberta (conectado
          // ao SSE dela agora) — mesmo espírito do WhatsApp.
          const toNotify = await excludeActiveViewers(targetSessionId, recipients);

          await Promise.all(toNotify.map(id => notifyUser(id, {
            title: `Nova mensagem de ${message.senderName || session.customer_name || 'Cliente'}`,
            body: message.text || 'Anexo enviado',
            url: `/chat?chat=${targetSessionId}`,
            tag: `chat_message:${message.id}`
          })));
        } catch (err) {
          console.error('[push] Falha ao notificar mensagem de chat:', err);
        }
      })();

      return NextResponse.json({ success: true, sessionId: targetSessionId });
    }

    if (action === 'chat-typing') {
      const { sessionId, userId, userName } = body;
      if (!sessionId || !userId) {
        return NextResponse.json({ error: 'Dados incompletos.' }, { status: 400 });
      }
      emitChatEvent(sessionId, { type: 'typing', sessionId, userId, userName });
      return NextResponse.json({ success: true });
    }

    if (action === 'mark-chat-messages-read') {
      const { sessionId, userId } = body;
      if (!sessionId || !userId) {
        return NextResponse.json({ error: 'Dados incompletos.' }, { status: 400 });
      }
      const marked = await query(
        `UPDATE public.chat_messages
         SET read_by = array_append(read_by, $2::uuid),
             delivered_by = CASE WHEN $2::uuid = ANY(delivered_by) THEN delivered_by ELSE array_append(delivered_by, $2::uuid) END
         WHERE session_id = $1 AND sender_id IS DISTINCT FROM $2 AND NOT ($2::uuid = ANY(read_by))
         RETURNING id`,
        [sessionId, userId]
      );
      if ((marked.rowCount ?? 0) > 0) {
        emitChatEvent(sessionId, { type: 'receipt', sessionId });
      }
      return NextResponse.json({ success: true });
    }

    if (action === 'toggle-chat-message-reaction') {
      const { messageId, userId, emoji } = body;
      if (!messageId || !userId || !emoji) {
        return NextResponse.json({ error: 'Dados incompletos.' }, { status: 400 });
      }
      const sessionRes = await query('SELECT session_id FROM public.chat_messages WHERE id = $1', [messageId]);
      const sessionId = sessionRes.rows[0]?.session_id;
      if (!sessionId) {
        return NextResponse.json({ error: 'Mensagem não encontrada.' }, { status: 404 });
      }

      const removed = await query(
        `DELETE FROM public.chat_message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3 RETURNING id`,
        [messageId, userId, emoji]
      );
      if ((removed.rowCount ?? 0) === 0) {
        await query(
          `INSERT INTO public.chat_message_reactions (message_id, user_id, emoji)
           VALUES ($1, $2, $3)
           ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = NOW()`,
          [messageId, userId, emoji]
        );
      }
      emitChatEvent(sessionId, { type: 'reaction', sessionId, messageId });
      return NextResponse.json({ success: true });
    }

    if (action === 'edit-chat-message') {
      const { messageId, userId, text } = body;
      if (!messageId || !userId || typeof text !== 'string' || !text.trim()) {
        return NextResponse.json({ error: 'Dados incompletos.' }, { status: 400 });
      }

      const current = await query(
        `SELECT session_id, sender_id, text FROM public.chat_messages WHERE id = $1`,
        [messageId]
      );
      const row = current.rows[0];
      if (!row) {
        return NextResponse.json({ error: 'Mensagem não encontrada.' }, { status: 404 });
      }
      if (row.sender_id !== userId) {
        return NextResponse.json({ error: 'Só quem enviou pode editar esta mensagem.' }, { status: 403 });
      }
      if (row.text === text.trim()) {
        return NextResponse.json({ success: true });
      }

      // Guarda a versão ANTERIOR antes de sobrescrever — histórico completo
      // fica em chat_message_edits, chat_messages.text sempre reflete a
      // versão atual (mesmo padrão de uso do internal_chat_messages, só que
      // aqui com histórico real em vez de sobrescrever sem rastro).
      await query(
        `INSERT INTO public.chat_message_edits (message_id, previous_text, edited_by) VALUES ($1, $2, $3)`,
        [messageId, row.text, userId]
      );
      await query(
        `UPDATE public.chat_messages SET text = $1, edited_at = NOW() WHERE id = $2`,
        [text.trim(), messageId]
      );
      emitChatEvent(row.session_id, { type: 'edited', sessionId: row.session_id, messageId, text: text.trim() });
      return NextResponse.json({ success: true });
    }

    if (action === 'delete-chat-message') {
      const { messageId, userId } = body;
      if (!messageId || !userId) {
        return NextResponse.json({ error: 'Dados incompletos.' }, { status: 400 });
      }

      // Soft-delete só: o texto original NUNCA é apagado da linha (nem o
      // histórico de edições é removido) — só fica marcado como excluído
      // pra sumir da visualização normal, mantendo rastro auditável (ver
      // migrations/chat_messages_realtime_features.sql).
      const deleted = await query(
        `UPDATE public.chat_messages
         SET deleted_at = NOW(), deleted_by = $2
         WHERE id = $1 AND sender_id = $2 AND deleted_at IS NULL
         RETURNING session_id`,
        [messageId, userId]
      );
      if (deleted.rowCount === 0) {
        return NextResponse.json({ error: 'Mensagem não encontrada ou sem permissão para excluir.' }, { status: 404 });
      }
      const sessionId = deleted.rows[0].session_id;
      emitChatEvent(sessionId, { type: 'deleted', sessionId, messageId });
      return NextResponse.json({ success: true });
    }

    if (action === 'transcribe-audio') {
      if (!isTranscriptionEnabled()) {
        return NextResponse.json({ error: 'Transcrição desativada neste servidor' }, { status: 403 });
      }

      const { sessionId, messageId, attachmentId } = body;
      const msgRes = await query('SELECT metadata FROM public.chat_messages WHERE id = $1 AND session_id = $2', [messageId, sessionId]);
      const row = msgRes.rows[0];
      if (!row) {
        return NextResponse.json({ error: 'Mensagem não encontrada' }, { status: 404 });
      }

      const attachments: Attachment[] = row.metadata?.attachments || [];
      const attachment = attachments.find(a => a.id === attachmentId);
      if (!attachment || !isAudioAttachment(attachment)) {
        return NextResponse.json({ error: 'Anexo de áudio não encontrado' }, { status: 404 });
      }

      const transcription = await transcribeMessageAudio({ messageId, sessionId, attachment });
      if (!transcription) {
        return NextResponse.json({ error: 'Não foi possível transcrever o áudio' }, { status: 500 });
      }

      return NextResponse.json({ success: true, transcription });
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

      // Rede de segurança contra duplicidade de conversa 1:1 (além do índice
      // único idx_internal_chats_direct_pair, que garante isso no schema):
      // se já existe outra conversa direct com esse mesmo par de membros,
      // devolve o id dela em vez de inserir uma linha nova. Cobre a corrida
      // entre abas/cliques rápidos que o dedupe client-side (rooms.find em
      // chat-internal/page.tsx) sozinho não fecha. `id <> $1` garante que
      // isso não interfere num UPDATE normal de uma conversa já existente.
      if (chat.type === 'direct' && Array.isArray(chat.memberIds) && chat.memberIds.length === 2) {
        const [memberA, memberB] = chat.memberIds;
        const dupCheck = await query(
          `SELECT id FROM public.internal_chats
           WHERE type = 'direct' AND id <> $1
             AND cardinality(member_ids) = 2
             AND member_ids @> ARRAY[$2, $3]::uuid[]
           LIMIT 1`,
          [chat.id, memberA, memberB]
        );
        if ((dupCheck.rowCount ?? 0) > 0) {
          return NextResponse.json({ success: true, chatId: dupCheck.rows[0].id, deduped: true });
        }
      }

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
      return NextResponse.json({ success: true, chatId: chat.id });
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
      const inserted = await query(
        `INSERT INTO public.internal_chat_messages (chat_id, sender_id, sender_name, text, type, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         RETURNING id, created_at`,
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
      emitInternalChatEvent(chatId, { type: 'message', chatId });
      return NextResponse.json({ success: true, id: inserted.rows[0].id });
    }

    if (action === 'internal-chat-typing') {
      const { chatId, userId, userName } = body;
      if (!chatId || !userId) {
        return NextResponse.json({ error: 'Dados incompletos.' }, { status: 400 });
      }
      emitInternalChatEvent(chatId, { type: 'typing', chatId, userId, userName });
      return NextResponse.json({ success: true });
    }

    if (action === 'toggle-internal-message-reaction') {
      const { messageId, userId, emoji } = body;
      if (!messageId || !userId || !emoji) {
        return NextResponse.json({ error: 'Dados incompletos.' }, { status: 400 });
      }
      const chatRes = await query('SELECT chat_id FROM public.internal_chat_messages WHERE id = $1', [messageId]);
      const chatId = chatRes.rows[0]?.chat_id;
      if (!chatId) {
        return NextResponse.json({ error: 'Mensagem não encontrada.' }, { status: 404 });
      }

      // Clicar no mesmo emoji que já reagiu remove a reação (toggle); um
      // emoji diferente substitui — só 1 reação por pessoa por mensagem,
      // igual WhatsApp/Telegram.
      const removed = await query(
        `DELETE FROM public.internal_chat_message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3 RETURNING id`,
        [messageId, userId, emoji]
      );
      if ((removed.rowCount ?? 0) === 0) {
        await query(
          `INSERT INTO public.internal_chat_message_reactions (message_id, user_id, emoji)
           VALUES ($1, $2, $3)
           ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = NOW()`,
          [messageId, userId, emoji]
        );
      }
      emitInternalChatEvent(chatId, { type: 'reaction', chatId, messageId });
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
