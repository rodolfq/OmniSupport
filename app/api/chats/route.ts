import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { emitChatEvent, excludeActiveViewers, emitInternalChatEvent } from '@/lib/chat-events';
import { notifyUser } from '@/lib/services/push-service';
import { getChatRecipientIds, isTeamRole } from '@/lib/services/notification-recipients';
import { resolveCombinedQueuePool, pickNextQueueAssignee, dispatchPendingChatSessions, RoutingQueue } from '@/lib/services/queue-routing';
import { transcribeMessageAudio, isAudioAttachment, isTranscriptionEnabled } from '@/lib/services/transcription-service';
import { Attachment } from '@/lib/types';
import { runExclusive } from '@/lib/key-mutex';
import { canForceOthersOffline } from '@/lib/services/presence-authorization';
import { isStalePresence } from '@/lib/presence';
import { persistAttachments } from '@/lib/services/attachment-storage';
import { getOrGenerateChatSummary, ChatSummaryNotFoundError, ChatSummaryGenerationError } from '@/lib/services/chat-summary-service';
import { AssistantNotConfiguredError, parseGroqRetryWait } from '@/lib/groq-client';
import { normalizeBrazilianPhoneDigits } from '@/lib/utils';

function normalizePhone(value?: string | null): string {
  return (value || '').replace(/\D/g, '');
}

function phoneLookupVariants(phone?: string | null): string[] {
  const digits = normalizeBrazilianPhoneDigits(normalizePhone(phone));
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

    if (action === 'previous-histories') {
      // Atendimentos anteriores do MESMO contato, pra exibir como resumo
      // (expansível) dentro do chat em andamento — ver chat-widget.tsx. Contato
      // é identificado por customer_id OU customer_phone (nunca só um dos
      // dois, tem sessão antiga só com telefone), igual ao resto do arquivo.
      const customerId = searchParams.get('customerId');
      const customerPhone = searchParams.get('customerPhone');
      const excludeSessionId = searchParams.get('excludeSessionId');
      const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '2', 10) || 2, 1), 20);
      const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

      const phoneVariants = phoneLookupVariants(customerPhone);
      if (!customerId && phoneVariants.length === 0) {
        return NextResponse.json({ histories: [], total: 0 });
      }

      const conditions: string[] = [];
      const params: any[] = [];
      if (customerId) {
        params.push(customerId);
        conditions.push(`h.customer_id = $${params.length}`);
      }
      if (phoneVariants.length > 0) {
        params.push(phoneVariants);
        conditions.push(`h.customer_phone = ANY($${params.length}::text[])`);
      }
      let whereClause = `(${conditions.join(' OR ')})`;
      if (excludeSessionId) {
        params.push(excludeSessionId);
        whereClause += ` AND h.session_id != $${params.length}`;
      }

      const countRes = await query(`SELECT COUNT(*)::int AS count FROM public.chat_histories h WHERE ${whereClause}`, params);

      params.push(limit);
      const limitParam = params.length;
      params.push(offset);
      const offsetParam = params.length;

      const rowsRes = await query(
        `SELECT h.*, p2.name as assignee_profile_name
         FROM public.chat_histories h
         LEFT JOIN public.profiles p2 ON h.assignee_id = p2.id
         WHERE ${whereClause}
         ORDER BY h.finished_at DESC
         LIMIT $${limitParam} OFFSET $${offsetParam}`,
        params
      );

      return NextResponse.json({
        total: countRes.rows[0]?.count || 0,
        histories: rowsRes.rows.map(h => ({
          id: h.id,
          sessionId: h.session_id,
          assigneeName: h.assignee_profile_name,
          startedAt: h.started_at,
          finishedAt: h.finished_at,
          durationSeconds: h.duration_seconds,
          rating: h.rating
        }))
      });
    }

    if (action === 'histories-by-company') {
      // Atendimentos finalizados de uma empresa (via profiles.company_id do
      // contato) — tela dedicada /customers/[id] (item 13 do roadmap). Mesmo
      // JOIN de 'histories', mas filtrado e paginado (essa aqui pode ter
      // volume alto, 'histories' original não pagina).
      const companyId = searchParams.get('companyId');
      if (!companyId) return NextResponse.json({ total: 0, histories: [] });
      const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '5', 10) || 5, 1), 20);
      const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

      const countRes = await query(
        `SELECT COUNT(*)::int AS count
         FROM public.chat_histories h
         LEFT JOIN public.profiles p1 ON h.customer_id = p1.id
         WHERE p1.company_id = $1`,
        [companyId]
      );

      const rowsRes = await query(
        `SELECT h.*, p1.name as customer_profile_name, p2.name as assignee_profile_name
         FROM public.chat_histories h
         LEFT JOIN public.profiles p1 ON h.customer_id = p1.id
         LEFT JOIN public.profiles p2 ON h.assignee_id = p2.id
         WHERE p1.company_id = $1
         ORDER BY h.finished_at DESC
         LIMIT $2 OFFSET $3`,
        [companyId, limit, offset]
      );

      return NextResponse.json({
        total: countRes.rows[0]?.count || 0,
        histories: rowsRes.rows.map(h => ({
          id: h.id,
          sessionId: h.session_id,
          customerName: h.customer_name || h.customer_profile_name,
          assigneeName: h.assignee_profile_name,
          startedAt: h.started_at,
          finishedAt: h.finished_at,
          durationSeconds: h.duration_seconds,
          rating: h.rating
        }))
      });
    }

    if (action === 'sessions-by-company') {
      // Atendimentos EM ANDAMENTO de uma empresa — tela dedicada
      // /customers/[id] (item 13 do roadmap). Lista leve (sem array de
      // mensagens, diferente de 'sessions'/'sessions-summary' que trazem tudo
      // que está ativo no sistema inteiro). Sessões só com telefone avulso
      // (sem customer_id vinculado a um profile) não têm como ser amarradas a
      // uma empresa e ficam de fora — mesma limitação de 'previous-histories'.
      const companyId = searchParams.get('companyId');
      if (!companyId) return NextResponse.json([]);

      const res = await query(
        `SELECT s.*, p2.name as assignee_profile_name
         FROM public.chat_sessions s
         JOIN public.profiles p1 ON p1.id = s.customer_id
         LEFT JOIN public.profiles p2 ON p2.id = s.assignee_id
         WHERE p1.company_id = $1 AND s.status != 'closed'
         ORDER BY COALESCE(s.last_message_at, s.updated_at, s.created_at) DESC`,
        [companyId]
      );

      return NextResponse.json(res.rows.map(s => ({
        id: s.id,
        customerName: s.customer_name,
        assigneeName: s.assignee_profile_name,
        status: s.status,
        startedAt: s.created_at,
        lastMessageAt: s.last_message_at || s.created_at,
        ticketId: s.ticket_id,
        ticketNumber: s.ticket_number
      })));
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
        summary: h.summary,
        summaryGeneratedAt: h.summary_generated_at,
        dissatisfactionProcessedAt: h.dissatisfaction_processed_at,
        dissatisfactionDetected: h.dissatisfaction_detected,
        dissatisfactionDepartment: h.dissatisfaction_department,
        dissatisfactionCategory: h.dissatisfaction_category,
        dissatisfactionReason: h.dissatisfaction_reason,
        ticketId: h.ticket_id,
        ticketNumber: h.ticket_number,
        queueId: h.queue_id,
        queueName: h.queue_name
      })));
    }

    if (action === 'status-history') {
      // Filtrar por usuário/período no servidor (em vez de trazer sempre o
      // teto fixo global e filtrar no client) importa aqui especificamente
      // porque o heartbeat de 60s grava uma linha nova mesmo sem trocar de
      // status — com todo mundo online o dia inteiro, um LIMIT fixo sem
      // filtro estoura em poucas horas e corta o histórico de quem não foi
      // pedido. A tela (status-history-panel.tsx) agrupa essas linhas em
      // "turnos" contínuos por status, então o teto aqui só precisa ser alto
      // o bastante pra cobrir o período pedido, não a lista final exibida.
      const userId = searchParams.get('userId');
      const from = searchParams.get('from');
      const to = searchParams.get('to');
      const conditions: string[] = [];
      const params: any[] = [];
      if (userId && userId !== 'all') {
        params.push(userId);
        conditions.push(`user_id = $${params.length}`);
      }
      if (from) {
        params.push(from);
        conditions.push(`timestamp >= $${params.length}`);
      }
      if (to) {
        params.push(to);
        conditions.push(`timestamp < $${params.length}`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const res = await query(
        `SELECT * FROM public.user_status_history ${where} ORDER BY timestamp DESC LIMIT 5000`,
        params
      );
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

    // Painel de confirmação ao clicar num telefone dentro de uma mensagem
    // (ver components/phone-contact-panel.tsx) — leitura pura, não
    // acha/cria nada: só diz se o número bate com um perfil cadastrado e/ou
    // se já tem uma conversa ABERTA (não fechada) com ele, pra decidir o que
    // mostrar (nome+empresa / "cadastrar contato", e se precisa avisar sobre
    // conversa em andamento antes de abrir uma nova).
    if (action === 'contact-lookup') {
      const variants = phoneLookupVariants(searchParams.get('phone'));
      if (!variants.length) return NextResponse.json({ profile: null, activeSession: null });

      const placeholders = variants.map((_, i) => `$${i + 1}`).join(',');
      const profileRes = await query(
        `SELECT p.id, p.name, p.role, p.company_id, c.name AS company_name
         FROM public.profiles p
         LEFT JOIN public.companies c ON c.id = p.company_id
         WHERE regexp_replace(COALESCE(p.phone, ''), '\\D', '', 'g') IN (${placeholders})
         LIMIT 1`,
        variants
      );
      const sessionRes = await query(
        `SELECT s.id, s.customer_id, s.customer_name, s.customer_phone, s.assignee_id,
                p.name AS assignee_name, s.created_at, s.last_message_at
         FROM public.chat_sessions s
         LEFT JOIN public.profiles p ON p.id = s.assignee_id
         WHERE regexp_replace(COALESCE(s.customer_phone, ''), '\\D', '', 'g') IN (${placeholders})
           AND s.status != 'closed'
         ORDER BY s.updated_at DESC LIMIT 1`,
        variants
      );

      const p = profileRes.rows[0];
      const s = sessionRes.rows[0];
      return NextResponse.json({
        profile: p ? {
          id: p.id, name: p.name, role: p.role, companyId: p.company_id, companyName: p.company_name
        } : null,
        activeSession: s ? {
          id: s.id,
          customerId: s.customer_id,
          customerName: s.customer_name,
          customerPhone: s.customer_phone,
          assigneeId: s.assignee_id,
          assigneeName: s.assignee_name,
          startedAt: s.created_at,
          lastMessageAt: s.last_message_at
        } : null
      });
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

    if (action === 'set-session-contact') {
      // Vincula a conversa a um contato cadastrado (modal "Vincular
      // contato"). Ação focada em vez de reaproveitar save-session: aquele
      // faz upsert da linha inteira, e chamá-lo com um objeto parcial
      // apagaria responsável, fila e vínculo com chamado.
      const { sessionId, customerId, customerName } = body;
      if (!sessionId) return NextResponse.json({ error: 'sessionId é obrigatório.' }, { status: 400 });

      const res = await query(
        `UPDATE public.chat_sessions
            SET customer_id = $2, customer_name = $3, updated_at = NOW()
          WHERE id = $1 RETURNING id`,
        [sessionId, customerId || null, customerName || null]
      );
      if (res.rowCount === 0) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });
      return NextResponse.json({ success: true });
    }

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

      // Quando quem chamou não já sabe quem é (nem customerId nem
      // customerName vieram prontos — é o caso do clique num telefone
      // detectado dentro de uma mensagem, ver resolveChatSessionForPhone em
      // lib/services/chat-service.ts), tenta achar um funcionário/cliente já
      // cadastrado com esse telefone ANTES de decidir achar/criar a sessão —
      // assim a conversa (nova ou reaproveitada) já nasce com nome/empresa
      // corretos em vez de "anônima" só com o número. Fica aqui (servidor)
      // em vez de round-trip separado do client: menos requisição, e não
      // corre risco de o widget ler uma sessão "anônima" antes do
      // enriquecimento chegar.
      let resolvedCustomerId: string | null = session.customerId || null;
      let resolvedCustomerName: string | null = session.customerName || null;
      if (!resolvedCustomerId && !resolvedCustomerName && phoneVariants.length > 0) {
        const profileRes = await query(
          `SELECT id, name FROM public.profiles
           WHERE regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') IN (${phoneVariants.map((_, i) => `$${i + 1}`).join(',')})
           LIMIT 1`,
          phoneVariants
        );
        if (profileRes.rows[0]) {
          resolvedCustomerId = profileRes.rows[0].id;
          resolvedCustomerName = profileRes.rows[0].name;
        }
      }

      const lookupClauses: string[] = [];
      const lookupParams: any[] = [];

      if (resolvedCustomerId) {
        lookupParams.push(resolvedCustomerId);
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
      const mutexKey = resolvedCustomerId || phoneVariants[0] || `anon:${session.id || 'new'}`;
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
              resolvedCustomerId,
              resolvedCustomerName,
              session.customerPhone || null,
              session.status || 'active',
              existing.id
            ]
          );
          return { id: existing.id, assigneeId: existing.assignee_id, reused: true };
        }

        const id = session.id || crypto.randomUUID();
        const initialStatus = session.status || 'pending';

        // Distribuição automática: só entra em ação quando a conversa chega como
        // 'pending' (é o caso da primeira mensagem de um cliente logado pelo
        // widget, chat-widget.tsx — abrir o widget não cria nada, justamente
        // pra não ocupar a fila sem ninguém ter escrito) — se já veio 'active'
        // é porque um agente iniciou a conversa manualmente (ex.: "Novo
        // WhatsApp"), e nesse caso o
        // próprio agente já é quem está assumindo, sem round-robin. Como essa
        // conversa não chegou por nenhuma instância de WhatsApp específica, usa
        // o pool combinado de todas as filas (mesmo comportamento/rodízio das
        // conversas de WhatsApp, só que somando os analistas de todas as filas).
        //
        // Escolha + gravação sob o mesmo lock por fila: o mutex de fora é por
        // cliente, não impede duas conversas de clientes diferentes lendo o
        // mesmo "último atribuído" ao mesmo tempo e caindo no mesmo analista.
        const pool = initialStatus === 'pending' ? await resolveCombinedQueuePool() : null;

        // Conversa que chega 'active' foi iniciada por um agente ("Novo
        // WhatsApp", clique num telefone, tela de Empresas). O comentário acima
        // sempre disse que nesse caso "o próprio agente é quem assume" — mas
        // ninguém executava essa atribuição, e o rodízio não roda para 'active'.
        // Resultado: a conversa nascia SEM responsável, sem aparecer como de
        // ninguém. Resolver aqui, e não em cada tela, cobre os três pontos de
        // entrada de uma vez (chat-widget.tsx, phone-contact-panel.tsx e
        // customers/page.tsx).
        //
        // Só papéis de atendimento assumem: um Cliente/Funcionário abrindo
        // conversa pelo widget não pode virar responsável por ela.
        let starterId: string | null = null;
        if (initialStatus !== 'pending') {
          // POST recebe Request (não NextRequest), então o cookie vem por
          // cookies() do next/headers — mesmo padrão das outras ações deste
          // arquivo que precisam da sessão.
          const token = (await cookies()).get('token')?.value;
          const authenticated = token ? await verifyJWT(token) : null;
          if (authenticated?.id && isTeamRole(String(authenticated.role))) {
            starterId = authenticated.id;
          }
        }

        const insertRes = await runExclusive(`queue-assign:${pool?.id ?? 'combined'}`, async () => {
          let status = initialStatus;
          let assigneeId: string | null = starterId;
          if (pool) {
            assigneeId = await pickNextQueueAssignee(pool);
            if (assigneeId) status = 'active';
          }

          // ON CONFLICT sem alvo explícito cobre tanto o índice único de
          // telefone aberto quanto o de customer_id aberto — segunda rede de
          // segurança pra corrida entre processos/instâncias diferentes (o
          // mutex acima só vale dentro deste processo Node).
          return query(
            // created_at = NOW(): a sessão está nascendo agora, e session.startedAt
            // vinha do relógio do navegador. Como o tempo de espera e o de
            // primeira resposta são medidos a partir daqui, um relógio errado
            // no cliente distorcia métrica de atendimento.
            `INSERT INTO public.chat_sessions (id, customer_id, customer_name, customer_phone, status, queue_id, assignee_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NULL, $6, NOW(), NOW())
             ON CONFLICT DO NOTHING
             RETURNING id, assignee_id`,
            [id, resolvedCustomerId, resolvedCustomerName, session.customerPhone || null, status, assigneeId]
          );
        });

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

        // Escolha + gravação sob o mesmo lock por fila — este ponto não tinha
        // nenhum lock antes, então duas reaberturas quase simultâneas (dois
        // clientes diferentes reabrindo pela mesma fila) podiam calcular o
        // mesmo "próximo" e cair no mesmo analista.
        const newId = crypto.randomUUID();
        await runExclusive(`queue-assign:${queue?.id ?? 'combined'}`, async () => {
          const assigneeId = queue ? await pickNextQueueAssignee(queue) : null;
          await query(
            `INSERT INTO public.chat_sessions (id, customer_id, customer_name, customer_phone, status, queue_id, assignee_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
            [newId, session.customer_id, session.customer_name, session.customer_phone, assigneeId ? 'active' : 'pending', queue?.id || null, assigneeId]
          );
        });
        targetSessionId = newId;
      }

      // Anexo chega do client como data: URL e é gravado em disco aqui (ver
      // lib/services/attachment-storage.ts) — no banco fica só a URL curta.
      const persistedAttachments = await persistAttachments(
        message.attachments || message.metadata?.attachments || []
      );
      const metadata = { ...(message.metadata || {}), attachments: persistedAttachments };

      // created_at = NOW() do servidor, e não message.timestamp do navegador.
      // A conversa é ordenada por created_at: com o relógio do cliente, uma
      // máquina adiantada ou atrasada jogava a mensagem para o lugar errado da
      // conversa (e, no caso de atraso, para trás de mensagens que vieram
      // depois). RETURNING devolve o valor gravado, que é o mesmo devolvido ao
      // cliente e emitido no SSE abaixo — assim a tela nunca mostra um horário
      // diferente do que está no banco.
      const inserted = await query(
        `INSERT INTO public.chat_messages (id, session_id, sender_id, sender_name, text, type, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
         RETURNING created_at`,
        [
          message.id,
          targetSessionId,
          message.senderId || null,
          message.senderName || null,
          message.text,
          message.type || 'text',
          JSON.stringify(metadata)
        ]
      );
      const serverTimestamp = new Date(inserted.rows[0].created_at).toISOString();

      await query(
        `UPDATE public.chat_sessions SET last_message_at = $1, updated_at = NOW() WHERE id = $2`,
        [serverTimestamp, targetSessionId]
      );

      // Conversa que ficou 'pending' por não haver ninguém online na hora tenta
      // a distribuição de novo a cada mensagem nova — no-op barato (o filtro é
      // por id + status) quando ela já tem responsável.
      try {
        const dispatched = await dispatchPendingChatSessions({ sessionId: targetSessionId });
        await Promise.all(dispatched.map(d => notifyUser(d.assigneeId, {
          title: 'Novo atendimento atribuído a você',
          body: `${d.customerName || 'Cliente'} está aguardando atendimento.`,
          url: `/chat?chat=${d.sessionId}`,
          tag: `chat_assign:${d.sessionId}`
        })));
      } catch (err) {
        console.error('[queue] Falha ao redistribuir atendimento pendente:', err);
      }

      emitChatEvent(targetSessionId, {
        type: 'message',
        sessionId: targetSessionId,
        message: {
          id: message.id,
          senderId: message.senderId || null,
          senderName: message.senderName || null,
          text: message.text,
          // O horário do servidor, o mesmo que foi gravado — não o que o
          // navegador enviou.
          timestamp: serverTimestamp,
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

      // timestamp devolvido para quem chamou poder corrigir a bolha otimista
      // que já desenhou com o horário local.
      return NextResponse.json({ success: true, sessionId: targetSessionId, timestamp: serverTimestamp });
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

      // Escala de chat_histories.rating é -1 (negativo) / 1 (positivo) — o
      // widget já manda nessa escala, mas clientes com bundle antigo em cache
      // ainda mandam 0 para "ruim", que seria lido como "neutro" e sumiria de
      // todas as contagens de avaliação. Normaliza aqui também.
      const normalizedRating = rating === 1 ? 1 : -1;
      await query(
        `UPDATE public.chat_histories SET rating = $1
         WHERE id = (SELECT id FROM public.chat_histories WHERE session_id = $2 ORDER BY created_at DESC LIMIT 1)`,
        [normalizedRating, sessionId]
      );
      await query(
        'UPDATE public.chat_sessions SET awaiting_survey_until = NULL WHERE id = $1',
        [sessionId]
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'save-status') {
      const { status } = body;

      // Só o heartbeat de presença do próprio cliente (app-context.tsx) usa
      // esta ação, sempre com o próprio id — mesma trava de log-status-change
      // pra não deixar uma requisição forjada marcar outra pessoa online.
      const token = (await cookies()).get('token')?.value;
      const authenticatedUser = token ? await verifyJWT(token) : null;
      if (!authenticatedUser?.id || authenticatedUser.id !== status.userId) {
        return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
      }

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

      // Ninguém decide Online/Ausente por outra pessoa — só o próprio dono
      // do status. Colegas só podem forçar Offline (ex.: "derrubar login" de
      // alguém preso como disponível sem estar), e mesmo isso exige uma das
      // permissões de supervisão de fila/equipe. Sem isso, qualquer sessão
      // autenticada podia forjar o userId no corpo da requisição e fraudar o
      // rodízio de atendimento marcando um colega como disponível.
      const token = (await cookies()).get('token')?.value;
      const authenticatedUser = token ? await verifyJWT(token) : null;
      if (!authenticatedUser?.id) {
        return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
      }
      if (authenticatedUser.id !== userId) {
        if (status !== 'offline') {
          return NextResponse.json({ error: 'Só o próprio usuário pode alterar o status para Online/Ausente.' }, { status: 403 });
        }
        const actorRes = await query('SELECT role FROM public.profiles WHERE id = $1', [authenticatedUser.id]);
        const actor = { id: authenticatedUser.id, role: actorRes.rows[0]?.role || '' };
        if (!(await canForceOthersOffline(actor))) {
          return NextResponse.json({ error: 'Você não tem permissão para alterar o status de outro usuário.' }, { status: 403 });
        }
      }

      const isOnline = status === 'online';

      // Estado ANTES do upsert, pra decidir lá embaixo se vale reprocessar a
      // fila de pendentes. Esta rota é usada tanto pelo toggle manual quanto
      // pelo heartbeat de 60s (app-context.tsx) — reprocessar a cada heartbeat
      // de cada analista online seria puro desperdício.
      const beforeRes = await query(
        'SELECT status, last_active FROM public.analyst_status WHERE user_id = $1',
        [userId]
      );
      const before = beforeRes.rows[0];
      const wasOnline = before?.status === 'online';
      const wasStale = !before || isStalePresence(before.last_active);

      // Mesma lógica de âncora diária de app/actions.ts#updateUserStatus —
      // ver migrations/queue_daily_anchor.sql. Este é o ponto usado tanto
      // pelo toggle manual quanto pelo heartbeat de 60s (app-context.tsx),
      // então o heartbeat repetindo o mesmo status não pode reancorar.
      //
      // status_since (ver migrations/analyst_status_since.sql) só avança
      // quando status OU current_reason realmente mudam — o heartbeat
      // repetindo o mesmo status/motivo não pode empurrá-lo pra frente,
      // senão o cronômetro de almoço "reinicia" toda vez que o sistema é
      // reaberto (statusSince em /api/auth/me lia last_active, que o
      // heartbeat sempre atualiza; ver comentário lá).
      await query(
        `INSERT INTO public.analyst_status (user_id, is_online, last_active, current_reason, status, status_since, queue_anchor_at, queue_anchor_date)
         VALUES ($1, $2, NOW(), $3, $4, NOW(), CASE WHEN $2 THEN NOW() END, CASE WHEN $2 THEN CURRENT_DATE END)
         ON CONFLICT (user_id) DO UPDATE SET
           is_online = EXCLUDED.is_online,
           last_active = NOW(),
           current_reason = EXCLUDED.current_reason,
           status = EXCLUDED.status,
           status_since = CASE
             WHEN analyst_status.status IS DISTINCT FROM EXCLUDED.status
               OR analyst_status.current_reason IS DISTINCT FROM EXCLUDED.current_reason
             THEN NOW() ELSE COALESCE(analyst_status.status_since, NOW()) END,
           queue_anchor_at = CASE
             WHEN EXCLUDED.is_online AND (analyst_status.queue_anchor_date IS NULL OR analyst_status.queue_anchor_date < CURRENT_DATE)
             THEN NOW() ELSE analyst_status.queue_anchor_at END,
           queue_anchor_date = CASE
             WHEN EXCLUDED.is_online AND (analyst_status.queue_anchor_date IS NULL OR analyst_status.queue_anchor_date < CURRENT_DATE)
             THEN CURRENT_DATE ELSE analyst_status.queue_anchor_date END`,
        [userId, isOnline, reason || null, status]
      );
      await query(
        `INSERT INTO public.user_status_history (user_id, status, reason, timestamp)
         VALUES ($1, $2, $3, NOW())`,
        [userId, status, reason || null]
      );

      // Atendimentos que ficaram em 'pending' por não haver ninguém elegível
      // quando chegaram (ver dispatchPendingChatSessions). Só vale a pena
      // tentar quando este analista passou a contar pro rodízio agora: entrou
      // como online, ou voltou de uma presença já vencida (is_online seguia
      // true, mas sem heartbeat pickNextQueueAssignee o ignorava).
      if (isOnline && (!wasOnline || wasStale)) {
        try {
          const dispatched = await dispatchPendingChatSessions();
          await Promise.all(dispatched.map(d => notifyUser(d.assigneeId, {
            title: 'Novo atendimento atribuído a você',
            body: `${d.customerName || 'Cliente'} está aguardando atendimento.`,
            url: `/chat?chat=${d.sessionId}`,
            tag: `chat_assign:${d.sessionId}`
          })));
        } catch (err) {
          console.error('[queue] Falha ao redistribuir atendimentos pendentes após mudança de status:', err);
        }
      }

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
      // Anexo chega do client como data: URL e é gravado em disco aqui (ver
      // lib/services/attachment-storage.ts) — no banco fica só a URL.
      const internalAttachments = await persistAttachments(message.attachments || []);
      const internalMetadata = { ...message.metadata, attachments: internalAttachments };
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

    if (action === 'summarize-history') {
      // Mesma checagem de sessão usada em log-status-change/save-status
      // (token do cookie), sem exigir permissão fina extra — quem já pode
      // ver o Histórico de Conversas (tela gated por tickets:read) pode
      // pedir o resumo dela.
      const token = (await cookies()).get('token')?.value;
      const authenticatedUser = token ? await verifyJWT(token) : null;
      if (!authenticatedUser?.id) {
        return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
      }
      const actorRes = await query(
        `SELECT p.role, COALESCE(rp.permissions, '{}'::text[]) AS permissions
         FROM public.profiles p LEFT JOIN public.role_permissions rp ON rp.id = p.access_profile_id
         WHERE p.id = $1`,
        [authenticatedUser.id]
      );
      const actor = actorRes.rows[0];
      const authorized = actor?.role === 'Administrador' || (actor?.permissions || []).includes('tickets:read');
      if (!authorized) {
        return NextResponse.json({ error: 'Você não tem permissão para resumir conversas.' }, { status: 403 });
      }

      const historyId = typeof body?.historyId === 'string' ? body.historyId : null;
      if (!historyId) {
        return NextResponse.json({ error: 'historyId é obrigatório.' }, { status: 400 });
      }
      // UUID inválido faria a query estourar "invalid input syntax for type
      // uuid" antes mesmo de checar "conversa não encontrada" — valida aqui
      // pra sempre devolver um erro claro em vez do genérico de falha
      // transitória.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(historyId)) {
        return NextResponse.json({ error: 'historyId inválido.' }, { status: 400 });
      }

      try {
        const result = await getOrGenerateChatSummary(historyId);
        return NextResponse.json(result);
      } catch (err: any) {
        // Detalhe técnico completo só no log do servidor — o motivo exato da
        // falha (config ausente, limite do Groq, sem transcrição) já vira uma
        // mensagem clara e específica pro cliente, nunca um JSON cru de erro.
        console.error('[chats] Erro ao gerar resumo de conversa:', err);

        if (err instanceof ChatSummaryNotFoundError) {
          return NextResponse.json({ error: err.message }, { status: 404 });
        }
        if (err instanceof ChatSummaryGenerationError) {
          return NextResponse.json({ error: err.message }, { status: 422 });
        }
        if (err instanceof AssistantNotConfiguredError) {
          return NextResponse.json(
            { error: 'Resumo por IA ainda não configurado — peça pra alguém do time técnico configurar a chave do Groq.' },
            { status: 503 }
          );
        }

        const status = err?.status;
        const code = err?.error?.error?.code ?? err?.error?.code;
        if (status === 429 || code === 'rate_limit_exceeded') {
          const wait = parseGroqRetryWait(typeof err?.message === 'string' ? err.message : '');
          return NextResponse.json(
            { error: `O resumo por IA atingiu o limite de uso gratuito de hoje.${wait ? ` Tente novamente em ${wait}.` : ' Tente novamente mais tarde.'}` },
            { status: 429 }
          );
        }

        return NextResponse.json({ error: 'Não foi possível gerar o resumo agora. Tente de novo em instantes.' }, { status: 502 });
      }
    }

    if (action === 'requeue-dissatisfaction') {
      // Mesma checagem de permissão de 'summarize-history' — quem pode ver o
      // Histórico de Conversas pode pedir reprocessamento manual de uma
      // linha (backfill do detector é sempre opt-in, uma linha por vez, ver
      // migrations/chat_histories_dissatisfaction.sql).
      const token = (await cookies()).get('token')?.value;
      const authenticatedUser = token ? await verifyJWT(token) : null;
      if (!authenticatedUser?.id) {
        return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
      }
      const actorRes = await query(
        `SELECT p.role, COALESCE(rp.permissions, '{}'::text[]) AS permissions
         FROM public.profiles p LEFT JOIN public.role_permissions rp ON rp.id = p.access_profile_id
         WHERE p.id = $1`,
        [authenticatedUser.id]
      );
      const actor = actorRes.rows[0];
      const authorized = actor?.role === 'Administrador' || (actor?.permissions || []).includes('tickets:read');
      if (!authorized) {
        return NextResponse.json({ error: 'Você não tem permissão para reprocessar conversas.' }, { status: 403 });
      }

      const historyId = typeof body?.historyId === 'string' ? body.historyId : null;
      if (!historyId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(historyId)) {
        return NextResponse.json({ error: 'historyId inválido.' }, { status: 400 });
      }

      const res = await query(
        `UPDATE public.chat_histories
         SET dissatisfaction_processed_at = NULL, dissatisfaction_attempts = 0, dissatisfaction_last_error = NULL
         WHERE id = $1
         RETURNING id`,
        [historyId]
      );
      if (res.rowCount === 0) {
        return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });
      }
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
          // ?? e não || : rating 0 ("neutro") é valor válido e virava null aqui.
          history.rating ?? null,
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
