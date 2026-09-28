import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { pool, query } from '@/lib/db';
import { emitChatEvent, emitSessionsChanged, excludeActiveViewers } from '@/lib/chat-events';
import { notifyUser } from '@/lib/services/push-service';
import { getChatRecipientIds, getTeamUserIds, isTeamRole } from '@/lib/services/notification-recipients';
import { pickNextQueueAssignee } from '@/lib/services/queue-routing';
import { runExclusive } from '@/lib/key-mutex';
import { getCurrentActionUser, getActorEffectivePermissions } from '@/lib/server-auth';
import { logAudit } from '@/lib/audit-log';
import { CHAT_TAG_REQUIRED_MESSAGE } from '@/lib/chat-close-rules';

// Achado em 2026-09-23 (varredura de permissões): as ações abaixo só
// checavam "sessão válida" — qualquer papel autenticado atribuía, transferia,
// mudava marcador e encerrava chat, e mesclava/duplicava chamado, mesmo sem
// nenhuma permissão. `perms` é "qualquer uma delas basta".
async function actorTemAlgumaPermissao(actor: any, perms: string[]): Promise<boolean> {
  if (actor?.role === 'Administrador') return true;
  const permissions = await getActorEffectivePermissions(actor.id);
  return perms.some(p => permissions.includes(p));
}

// Encerrar conversa exige ao menos 1 tag de chat válida (pedido do usuário,
// 2026-09-28). "Válida" = o id ainda existe em config_tags com domain 'chat' (tag
// apagada depois não conta). Sem NENHUMA tag de chat cadastrada não há o que
// exigir — senão ninguém encerraria nenhuma conversa. Devolve null se a conversa
// não existe.
async function conversaTemTagParaEncerrar(sessionId: string): Promise<boolean | null> {
  const sessionRes = await query('SELECT 1 FROM public.chat_sessions WHERE id::text = $1', [String(sessionId)]);
  if (sessionRes.rowCount === 0) return null;
  const cadastradas = await query(`SELECT 1 FROM public.config_tags WHERE domain = 'chat' LIMIT 1`);
  if (cadastradas.rowCount === 0) return true;
  const comTag = await query(
    `SELECT 1 FROM public.chat_sessions s
      WHERE s.id::text = $1
        AND EXISTS (SELECT 1 FROM public.config_tags t WHERE t.domain = 'chat' AND t.id::text = ANY(s.tags))`,
    [String(sessionId)]
  );
  return (comTag.rowCount ?? 0) > 0;
}

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
      if (!(await actorTemAlgumaPermissao(actor, ['tickets:outside_queue']))) {
        return NextResponse.json({ error: 'Você não tem permissão para atender a Central de Atendimento.' }, { status: 403 });
      }
      const { sessionId, assigneeId, actingUserId } = body;

      // Só alguém da equipe pode ficar responsável por uma conversa. A tela já
      // filtra a lista de "Enviar para", mas a rota não conferia nada — um
      // Cliente/Funcionário logado no portal (que tem presença em analyst_status)
      // chegou a aparecer como opção de transferência.
      const assigneeRes = await query('SELECT role FROM public.profiles WHERE id = $1', [assigneeId]);
      if (!isTeamRole(assigneeRes.rows[0]?.role)) {
        return NextResponse.json({ error: 'A conversa só pode ser atribuída a um analista da equipe.' }, { status: 400 });
      }

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
      emitSessionsChanged({ reason: 'assigned', sessionId });

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

            // Só quem RECEBEU a conversa precisa de um push sobre isso — o
            // resto do time já vê a mudança pela lista (emitSessionsChanged)
            // e por este mesmo log, se abrir a conversa. Um "assumir" não
            // notifica ninguém: quem clicou já sabe o que fez.
            if (actingUserId !== assigneeId) {
              const toNotify = await excludeActiveViewers(sessionId, [assigneeId]);
              await Promise.all(toNotify.map(id => notifyUser(id, {
                title: 'Conversa transferida para você',
                body: logText as string,
                url: `/chat?chat=${sessionId}`,
                tag: `chat_message:${logMessageId}`
              })));
            }
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
      if (!(await actorTemAlgumaPermissao(actor, ['tickets:outside_queue']))) {
        return NextResponse.json({ error: 'Você não tem permissão para atender a Central de Atendimento.' }, { status: 403 });
      }
      const { sessionId, queueId } = body;
      // Quem clicou vem da sessão, não do corpo da requisição (mesmo motivo
      // dos achados de 2026-09-23 em app/api/chats/route.ts).
      const actingUserId: string = actor.id;
      const sessionRes = await query('SELECT customer_id, assignee_id FROM public.chat_sessions WHERE id = $1', [sessionId]);
      if (!sessionRes.rows[0]) return NextResponse.json({ error: 'Atendimento não encontrado.' }, { status: 404 });
      const previousAssigneeId: string | null = sessionRes.rows[0].assignee_id;

      const queueRes = await query('SELECT id, name, member_ids FROM public.queues WHERE id = $1', [queueId]);
      const queue = queueRes.rows[0];
      if (!queue) return NextResponse.json({ error: 'Fila não encontrada.' }, { status: 404 });

      // Escolha + gravação sob o MESMO lock por fila: sem isso, duas devoluções
      // quase simultâneas calculam o mesmo "próximo" e caem no mesmo analista.
      //
      // Devolver pra fila é passar pro PRÓXIMO: quem devolveu (e quem estava
      // com a conversa, se não for a mesma pessoa) fica fora da escolha —
      // antes ele continuava elegível e, sendo o único online (ou caindo na
      // sua vez do rodízio), a conversa voltava pra ele e parecia que nada
      // tinha mudado. Sem mais ninguém online, fica 'pending' sem responsável,
      // aguardando a fila (dispatchPendingChatSessions reatribui quando
      // alguém ficar online ou o cliente escrever de novo).
      await runExclusive(`queue-assign:${queue.id}`, async () => {
        const nextAssigneeId = await pickNextQueueAssignee(
          { id: queue.id, memberIds: queue.member_ids || [] },
          { excludeUserIds: [actingUserId, previousAssigneeId].filter((id): id is string => !!id) }
        );
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
      emitSessionsChanged({ reason: 'queue', sessionId });

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
    // Marcadores (tags) da conversa — vínculo em tempo real pelo atendente
    // =====================================================================
    if (action === 'set-tags') {
      if (!(await actorTemAlgumaPermissao(actor, ['tickets:outside_queue']))) {
        return NextResponse.json({ error: 'Você não tem permissão para atender a Central de Atendimento.' }, { status: 403 });
      }
      const { sessionId, tagIds } = body;
      if (!sessionId || !Array.isArray(tagIds)) {
        return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });
      }

      const sessionRes = await query('SELECT tags, assignee_id FROM public.chat_sessions WHERE id = $1', [sessionId]);
      const session = sessionRes.rows[0];
      if (!session) return NextResponse.json({ error: 'Atendimento não encontrado.' }, { status: 404 });

      const previousTags: string[] = session.tags || [];
      const nextTags = [...new Set(tagIds as string[])];

      await query(`UPDATE public.chat_sessions SET tags = $1, updated_at = NOW() WHERE id = $2`, [nextTags, sessionId]);

      emitChatEvent(sessionId, { type: 'tags-updated', sessionId, tags: nextTags });
      emitSessionsChanged({ reason: 'tags', sessionId });

      // Log de bastidor só quando o conjunto realmente muda — evita spam de
      // "atualizou os marcadores" a cada clique que já estava no estado final
      // (ex.: dois analistas com o mesmo popover aberto). `actorId` no
      // metadata (em vez de confiar num actingUserId vindo do corpo da
      // requisição) é o que permite ao polling de notificações
      // (app/api/notifications/check/route.ts) saber quem mexeu, pra nunca
      // avisar o próprio autor da mudança — e o filtro por esse mesmo campo
      // tira esta mensagem do fluxo genérico de "nova mensagem", que ia pro
      // time inteiro sem olhar responsável nenhum.
      const added = nextTags.filter(id => !previousTags.includes(id));
      const removed = previousTags.filter(id => !nextTags.includes(id));
      if (added.length || removed.length) {
        try {
          const labelIds = [...new Set([...added, ...removed])];
          const labelsRes = await query('SELECT id, label FROM public.config_tags WHERE id = ANY($1::uuid[])', [labelIds]);
          const labelById = new Map(labelsRes.rows.map((r: any) => [r.id, r.label]));

          // Símbolos (+ / −) em vez de "adicionou X ao marcador" evita ter que
          // acertar singular/plural pros dois casos possíveis ao mesmo tempo.
          const parts: string[] = [];
          if (added.length) parts.push(`+ ${added.map(id => labelById.get(id) || '?').join(', ')}`);
          if (removed.length) parts.push(`− ${removed.map(id => labelById.get(id) || '?').join(', ')}`);
          const text = `${actor.name} atualizou os marcadores da conversa: ${parts.join(' ')}`;

          const logMessageId = crypto.randomUUID();
          const logTimestamp = new Date().toISOString();
          const logMetadata = { systemEvent: 'tags-updated', actorId: actor.id };
          await query(
            `INSERT INTO public.chat_messages (id, session_id, sender_id, sender_name, text, type, metadata, created_at)
             VALUES ($1, $2, NULL, 'SSX Desk', $3, 'internal', $5::jsonb, $4)`,
            [logMessageId, sessionId, text, logTimestamp, JSON.stringify(logMetadata)]
          );
          emitChatEvent(sessionId, {
            type: 'message',
            sessionId,
            message: {
              id: logMessageId, senderId: null, senderName: 'SSX Desk',
              text, timestamp: logTimestamp, type: 'internal', metadata: logMetadata, attachments: []
            }
          });
        } catch (err) {
          console.error('Error registering internal chat tags log:', err);
        }
      }

      return NextResponse.json({ success: true, tags: nextTags });
    }

    // =====================================================================
    // Encerrar atendimento (após gerar chamado)
    // =====================================================================
    if (action === 'close') {
      if (!(await actorTemAlgumaPermissao(actor, ['tickets:outside_queue']))) {
        return NextResponse.json({ error: 'Você não tem permissão para atender a Central de Atendimento.' }, { status: 403 });
      }
      const { sessionId, awaitingSurveyUntil, isSpam, checkOnly } = body;
      // Achado em 2026-09-23: "Fechar como Spam" nunca tinha sinal nenhum no
      // servidor — a diferença (mandar ou não a pesquisa de satisfação) era
      // decidida só no client, então CHAT_MARK_SPAM nunca era conferida de
      // verdade. `isSpam` (opcional, default false — chamadores antigos
      // continuam fechando normal) agora exige a permissão de verdade.
      if (isSpam && !(await actorTemAlgumaPermissao(actor, ['chat:mark_spam']))) {
        return NextResponse.json({ error: 'Você não tem permissão para marcar conversas como spam.' }, { status: 403 });
      }
      // Tag obrigatória pra encerrar — vale pra TODO caminho que fecha conversa
      // (Finalizar, Gerar chamado & Finalizar, Fechar como spam, Duplicar, "Encerrar
      // e iniciar nova", finalizar em massa na Central), porque todos passam por aqui.
      const temTag = await conversaTemTagParaEncerrar(sessionId);
      if (temTag === null) return NextResponse.json({ error: 'Atendimento não encontrado.' }, { status: 404 });
      if (!temTag) {
        return NextResponse.json({ error: CHAT_TAG_REQUIRED_MESSAGE, code: 'tag_required' }, { status: 422 });
      }
      // Pré-checagem: quem tem passos com efeito ANTES de fechar (criar chamado,
      // gravar histórico) pergunta primeiro, pra não deixar um chamado criado com
      // a conversa ainda aberta. Não fecha nada.
      if (checkOnly === true) return NextResponse.json({ success: true, canClose: true });

      await query(
        `UPDATE public.chat_sessions SET status = 'closed', awaiting_survey_until = $1, updated_at = NOW() WHERE id = $2`,
        [awaitingSurveyUntil ?? null, sessionId]
      );
      emitSessionsChanged({ reason: 'status', sessionId });
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
           VALUES ($1, '', $2, 'Baixa', 'Atendimento Chat', $3, $4, $5, $6, $7)
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
    // Dois pontos de entrada usam esta ação: o chat ("Vincular chamado existente",
    // Central de Atendimento) e o próprio chamado (aba Conversa > "Vincular
    // conversa"). Achado em 2026-09-28: ela só exigia sessão válida — qualquer
    // papel, inclusive Cliente/Funcionário, vinculava QUALQUER conversa a QUALQUER
    // chamado, e como quem enxerga o chamado lê a conversa vinculada
    // (canReadChatSessionFromTicket em app/api/chats/route.ts), isso era leitura de
    // conversa de outra empresa. Agora: equipe + (tickets:link_chat, a permissão
    // do chamado, OU tickets:outside_queue, de quem já vinculava pelo chat).
    if (action === 'link-ticket') {
      if (!isTeamRole(actor.role) || !(await actorTemAlgumaPermissao(actor, ['tickets:link_chat', 'tickets:outside_queue']))) {
        return NextResponse.json({ error: 'Você não tem permissão para vincular conversas a chamados.' }, { status: 403 });
      }
      const { sessionId, ticketId, confirmDifferentCompany } = body;
      if (!sessionId || !ticketId) {
        return NextResponse.json({ error: 'sessionId e ticketId são obrigatórios.' }, { status: 400 });
      }

      const ticketRes = await query(
        `SELECT t.id, t.public_ticket_number, t.title, t.company_id, t.chat_session_id, co.name AS company_name
           FROM public.tickets t LEFT JOIN public.companies co ON co.id = t.company_id
          WHERE t.id = $1`,
        [String(ticketId)]
      );
      const ticket = ticketRes.rows[0];
      if (!ticket) return NextResponse.json({ error: 'Chamado não encontrado.' }, { status: 404 });

      // id::text: um id malformado vira "não encontrada", não erro 500 de uuid.
      const sessionRes = await query(
        `SELECT s.id, s.status, s.ticket_id, s.customer_name, s.customer_phone, s.channel, s.created_at,
                p.company_id AS customer_company_id, cc.name AS customer_company_name
           FROM public.chat_sessions s
           LEFT JOIN public.profiles p ON p.id = s.customer_id
           LEFT JOIN public.companies cc ON cc.id = p.company_id
          WHERE s.id::text = $1`,
        [String(sessionId)]
      );
      const session = sessionRes.rows[0];
      if (!session) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });

      // Empresa diferente: só com confirmação explícita. Vincular a conversa de
      // uma empresa ao chamado de outra a expõe a quem acompanha esse chamado.
      // Conversa de contato sem cadastro (sem empresa) não trava — não há como
      // saber, e é o caso comum de "o cliente ligou de outro número".
      if (ticket.company_id && session.customer_company_id && ticket.company_id !== session.customer_company_id && confirmDifferentCompany !== true) {
        return NextResponse.json({
          error: `Esta conversa é de ${session.customer_company_name || 'outra empresa'} e o chamado é de ${ticket.company_name || 'outra empresa'}. Confirme para vincular mesmo assim.`,
          code: 'company_mismatch'
        }, { status: 409 });
      }

      // Já vinculada exatamente a este chamado: nada a fazer (e nada de log duplicado).
      if (session.ticket_id === ticket.id && ticket.chat_session_id === session.id) {
        return NextResponse.json({ ticketId: ticket.id, ticketNumber: ticket.public_ticket_number, alreadyLinked: true });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('UPDATE public.tickets SET chat_session_id = $1 WHERE id = $2', [session.id, ticket.id]);
        // chat_sessions.ticket_id/ticket_number = "chamado mais recente desta
        // conversa" (o badge do chat); o chamado que ela apontava antes continua
        // ligado por tickets.chat_session_id.
        await client.query(
          'UPDATE public.chat_sessions SET ticket_id = $1, ticket_number = $2 WHERE id = $3',
          [ticket.id, ticket.public_ticket_number, session.id]
        );
        // Registro no histórico do chamado (aba Logs de Alteração), interno.
        const quando = new Date(session.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        await client.query(
          `INSERT INTO public.ticket_messages (ticket_id, author_id, content, type, is_visible_to_customer)
           VALUES ($1, $2, $3, 'system', false)`,
          [ticket.id, actor.id, `Conversa vinculada ao chamado: ${session.customer_name || session.customer_phone || 'contato'} (iniciada em ${quando}).`]
        );
        await client.query('COMMIT');
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* conexão já caiu */ }
        throw err;
      } finally {
        client.release();
      }

      await logAudit({
        actorId: actor.id,
        actorName: actor.name,
        action: 'update',
        entityType: 'ticket',
        entityId: ticket.id,
        entityLabel: `#${ticket.public_ticket_number} ${ticket.title || ''}`.trim(),
        changes: {
          conversaVinculada: session.id,
          contato: session.customer_name || session.customer_phone || null,
          empresaDiferenteConfirmada: !!(ticket.company_id && session.customer_company_id && ticket.company_id !== session.customer_company_id)
        }
      });
      // O badge de chamado na lista de conversas muda.
      emitSessionsChanged({ reason: 'status', sessionId: session.id });
      return NextResponse.json({ ticketId: ticket.id, ticketNumber: ticket.public_ticket_number });
    }

    // =====================================================================
    // Mesclar chamados
    // =====================================================================
    if (action === 'merge-tickets') {
      if (!(await actorTemAlgumaPermissao(actor, ['tickets:merge']))) {
        return NextResponse.json({ error: 'Você não tem permissão para mesclar chamados.' }, { status: 403 });
      }
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
      if (!(await actorTemAlgumaPermissao(actor, ['tickets:duplicate']))) {
        return NextResponse.json({ error: 'Você não tem permissão para duplicar chamados.' }, { status: 403 });
      }
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
