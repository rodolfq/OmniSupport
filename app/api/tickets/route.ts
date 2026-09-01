import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { CLOSED_TICKET_STATUSES } from '@/lib/ticket-status';
import { verifyJWT } from '@/lib/jwt';
import { handleTicketCreated, handleTicketUpdated, handleTicketMessageCreated } from '@/lib/services/automation-service';
import { notifyUser } from '@/lib/services/push-service';
import { getTeamUserIds, getTicketRecipients, pushToTicketRecipients, ticketLabel } from '@/lib/services/notification-recipients';
import { persistAttachments } from '@/lib/services/attachment-storage';

async function getTicketActor(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  if (!token) return null;

  const decoded = await verifyJWT(token);
  if (!decoded?.id) return null;

  const result = await query(
    `SELECT p.id, p.role, COALESCE(rp.permissions, '{}'::text[]) AS permissions
     FROM public.profiles p
     LEFT JOIN public.role_permissions rp ON rp.id = p.access_profile_id
     WHERE p.id = $1`,
    [decoded.id]
  );

  return result.rows[0] || null;
}

function canDeleteTickets(actor: any) {
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes('tickets:delete');
}

/**
 * Editar chamado existente (PUT e PATCH em lote).
 *
 * `tickets:write` era declarada, aparecia na tela de Perfis de Acesso e nunca
 * era conferida no servidor: qualquer sessão autenticada podia alterar status,
 * responsável e conteúdo de qualquer chamado chamando a rota direto. A tela
 * escondia os controles, o que não é barreira.
 *
 * Não vale para a CRIAÇÃO (POST action=create): Cliente e Funcionário abrem os
 * próprios chamados pelo portal e não têm — nem devem ter — `tickets:write`,
 * que é a permissão de atuar sobre chamado alheio. Exigi-la ali trancaria os
 * cinco usuários do perfil "Funcionário" fora do próprio portal.
 */
function canWriteTickets(actor: any) {
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes('tickets:write');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const action = searchParams.get('action');
  const includeClosed = searchParams.get('includeClosed') === 'true';

  try {
    if (action === 'lookup') {
      // Busca enxuta para seletores (ex.: vincular chamado a um ticket
      // interno): só id, título e número, com teto de resultados.
      const search = (searchParams.get('search') || '').trim();
      const limit = Math.min(Number(searchParams.get('limit')) || 20, 50);
      const res = search
        ? await query(
            `SELECT id, title, public_ticket_number FROM public.tickets
              WHERE title ILIKE $1 ORDER BY created_at DESC LIMIT ${limit}`,
            [`%${search}%`]
          )
        : await query(
            `SELECT id, title, public_ticket_number FROM public.tickets
              ORDER BY created_at DESC LIMIT ${limit}`
          );
      return NextResponse.json(res.rows.map(t => ({
        id: t.id,
        title: t.title,
        ticketNumber: t.public_ticket_number
      })));
    }

    if (action === 'resolve-id') {
      // A URL /tickets/<ref> aceita o número público (0052) ou o id interno.
      // Resolver aqui evita a tela ter que saber por qual coluna procurar.
      const ref = (searchParams.get('ref') || '').trim();
      if (!ref) return NextResponse.json({ error: 'ref é obrigatório' }, { status: 400 });

      const isNumeric = /^\d+$/.test(ref);
      const res = isNumeric
        ? await query('SELECT id FROM public.tickets WHERE public_ticket_number = $1', [Number(ref)])
        : await query('SELECT id FROM public.tickets WHERE id = $1', [ref]);

      return NextResponse.json(res.rows[0] || null);
    }

    if (action === 'messages') {
      const ticketId = searchParams.get('ticketId');
      if (!ticketId) return NextResponse.json({ error: 'ticketId é obrigatório' }, { status: 400 });

      // Nome/foto do autor via JOIN, não mais resolvidos no client contra
      // /api/users?type=all — aquela rota é restrita a papel de equipe
      // (Cliente/Funcionário recebem 403), então o próprio autor de uma
      // mensagem (inclusive a de quem está vendo) nunca resolvia pra eles:
      // avatar caía no fallback genérico "U" e o nome ficava em branco.
      const res = await query(
        `SELECT m.*, p.name AS sender_name, p.avatar_thumb_url AS sender_avatar_thumb_url
           FROM public.ticket_messages m
           LEFT JOIN public.profiles p ON p.id = m.author_id
          WHERE m.ticket_id = $1
          ORDER BY m.created_at DESC`,
        [ticketId]
      );
      return NextResponse.json(res.rows.map(m => ({
        id: m.id,
        ticketId: m.ticket_id,
        senderId: m.author_id,
        senderName: m.sender_name,
        senderAvatarThumbUrl: m.sender_avatar_thumb_url,
        text: m.content,
        timestamp: m.created_at,
        isVisibleToCustomer: m.is_visible_to_customer,
        type: m.type,
        attachments: m.attachments_data || []
      })));
    }

    if (action === 'recent-by-company') {
      // Lista curta e só informativa dos outros chamados recentes da mesma
      // empresa — aba "Chamados Recentes" em ticket-detail-modal.tsx, e base
      // de busca do modal "Vincular Chamado" em chat-widget.tsx (que usa o
      // parâmetro opcional `search`, por número ou título).
      const companyId = searchParams.get('companyId');
      const excludeId = searchParams.get('excludeId');
      const search = searchParams.get('search');
      const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '5', 10) || 5, 1), 20);
      if (!companyId) return NextResponse.json({ error: 'companyId é obrigatório' }, { status: 400 });

      const params: any[] = [companyId, excludeId || ''];
      let whereClause = 'company_id = $1 AND id != $2';
      if (search) {
        params.push(`%${search}%`);
        whereClause += ` AND (title ILIKE $${params.length} OR CAST(public_ticket_number AS TEXT) ILIKE $${params.length})`;
      }
      params.push(limit);

      const res = await query(
        `SELECT id, public_ticket_number, title, status, priority, created_at, chat_session_id
         FROM public.tickets
         WHERE ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${params.length}`,
        params
      );
      return NextResponse.json(res.rows.map(t => ({
        id: t.id,
        ticketNumber: t.public_ticket_number,
        title: t.title,
        status: t.status,
        priority: t.priority,
        createdAt: t.created_at,
        chatSessionId: t.chat_session_id
      })));
    }

    if (action === 'by-company') {
      // Lista completa (paginada) de chamados de uma empresa — tela dedicada
      // /customers/[id] (item 13 do roadmap). Diferente de 'recent-by-company'
      // (lista curta, sem paginação, usada em contextos de picker/aba lateral):
      // aqui precisamos de OFFSET real e total pra "carregar mais".
      const companyId = searchParams.get('companyId');
      if (!companyId) return NextResponse.json({ error: 'companyId é obrigatório' }, { status: 400 });
      const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '15', 10) || 15, 1), 50);
      const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

      // Fechados sempre por último: mesma lista de status fechado que
      // 'open-count-by-company' usa (config_statuses.is_closed + os rótulos
      // fixos de lib/ticket-status.ts, "Mesclado" incluso) — sem isso, um
      // chamado fechado antigo intercala com abertos recentes na paginação e
      // não dá pra saber, só de bater o olho, com quantos em aberto a
      // empresa está de fato.
      const fechadosRes = await query(
        `SELECT label FROM public.config_statuses WHERE scope = 'ticket' AND is_closed = true`
      );
      const fechados = [
        ...new Set([...CLOSED_TICKET_STATUSES, ...fechadosRes.rows.map((r: any) => r.label)])
      ];

      const [countRes, res] = await Promise.all([
        query(`SELECT COUNT(*)::int AS count FROM public.tickets WHERE company_id = $1`, [companyId]),
        query(
          `SELECT id, public_ticket_number, title, status, priority, created_at
           FROM public.tickets
           WHERE company_id = $1
           ORDER BY (status = ANY($2)) ASC, created_at DESC
           LIMIT $3 OFFSET $4`,
          [companyId, fechados, limit, offset]
        )
      ]);

      return NextResponse.json({
        total: countRes.rows[0]?.count || 0,
        tickets: res.rows.map(t => ({
          id: t.id,
          ticketNumber: t.public_ticket_number,
          title: t.title,
          status: t.status,
          priority: t.priority,
          createdAt: t.created_at
        }))
      });
    }

    if (action === 'open-count-by-company') {
      // Quantos chamados a empresa tem em aberto — mostrado ao lado do nome da
      // empresa no cabeçalho do chat, para o atendente saber com o que já
      // estão lidando antes de responder.
      const companyId = searchParams.get('companyId');
      if (!companyId) return NextResponse.json({ error: 'companyId é obrigatório' }, { status: 400 });

      // "Em aberto" = tudo que não é status de encerramento. A lista sai de
      // config_statuses (is_closed), porque status é configurável, MAIS os
      // rótulos fixos de lib/ticket-status.ts — "Mesclado" é o caso que
      // importa: chamado absorvido por outro não está em aberto, e não é um
      // status cadastrado na tela de configuração.
      const fechadosRes = await query(
        `SELECT label FROM public.config_statuses WHERE scope = 'ticket' AND is_closed = true`
      );
      const fechados = [
        ...new Set([...CLOSED_TICKET_STATUSES, ...fechadosRes.rows.map((r: any) => r.label)])
      ];

      const res = await query(
        `SELECT COUNT(*)::int AS count
           FROM public.tickets
          WHERE company_id = $1 AND (status IS NULL OR status <> ALL($2))`,
        [companyId, fechados]
      );
      return NextResponse.json({ count: res.rows[0]?.count || 0 });
    }

    if (action === 'internal-links') {
      const res = await query(
        `SELECT til.ticket_id, til.internal_ticket_id, it.status, it.internal_ticket_number
         FROM public.ticket_internal_links til
         JOIN public.internal_tickets it ON it.id = til.internal_ticket_id`
      );
      return NextResponse.json(res.rows);
    }
    
    if (action === 'teams') {
      // internal_teams não tem coluna member_ids — a relação é invertida,
      // vive em profiles.internal_team_ids (array, com índice GIN). Deriva
      // aqui pra manter o mesmo contrato {id, name, member_ids} que o
      // seletor "Atribuir por equipe" (tickets-view.tsx) já consome.
      const res = await query(
        `SELECT it.id, it.name,
                COALESCE(array_agg(p.id) FILTER (WHERE p.id IS NOT NULL), '{}') AS member_ids
         FROM public.internal_teams it
         LEFT JOIN public.profiles p ON it.id = ANY(p.internal_team_ids)
         GROUP BY it.id, it.name`
      );
      return NextResponse.json(res.rows.map(t => ({
        id: t.id,
        name: t.name,
        member_ids: t.member_ids || []
      })));
    }

    if (id) {
      // customer_name/assignee_name vêm no JOIN porque o consumidor
      // (TicketService.getById) os exibe direto — antes esse método passava
      // pelo shim, que fazia o mesmo join em `profiles`.
      const res = await query(
        `SELECT t.*,
                cust.name AS customer_name,
                asg.name AS assignee_name,
                (SELECT cs.id FROM public.chat_sessions cs WHERE cs.ticket_id = t.id ORDER BY cs.created_at DESC LIMIT 1) AS chat_session_id
         FROM public.tickets t
         LEFT JOIN public.profiles cust ON cust.id = t.customer_id
         LEFT JOIN public.profiles asg ON asg.id = t.assignee_id
         WHERE t.id = $1`,
        [id]
      );
      if (res.rowCount === 0) {
        return NextResponse.json({ error: 'Chamado não encontrado' }, { status: 404 });
      }
      const data = res.rows[0];
      return NextResponse.json({
        ...data,
        ticketId: data.number,
        ticketNumber: data.public_ticket_number,
        companyId: data.company_id,
        customerId: data.customer_id,
        customerName: data.customer_name || undefined,
        assigneeName: data.assignee_name || undefined,
        // O spread acima só entrega snake_case (assignee_id/sub_status); a
        // interface Ticket lê camelCase. Sem estes dois apelidos o valor existe
        // no banco mas chega como `undefined` na tela — o responsável some da
        // tela de detalhe ("Não atribuído") logo depois de ser salvo, e cada
        // gravação seguinte registra de novo "Não atribuído -> Fulano" no
        // histórico, dando a impressão de que o save não funciona.
        assigneeId: data.assignee_id || undefined,
        subStatus: data.sub_status ?? null,
        employeeIds: data.employee_ids || [],
        attachments: data.attachments_data || [],
        chatSessionId: data.chat_session_id,
        queueId: data.queue_id,
        categoryId: data.category_id,
        requestTypeId: data.request_type_id,
        productId: data.product_id,
        mergedIntoId: data.merged_into_id,
        tags: data.tags || [],
        createdAt: data.created_at,
        updatedAt: data.updated_at
      });
    } else {
      // Obter todos os tickets que não estão concluídos/fechados. O
      // chat_session_id vinculado (ver saveTicketFromChatSession em
      // app/actions.ts) usa o índice idx_chat_sessions_ticket_id — permite à
      // tela de detalhe mostrar o histórico do chat ao vivo em vez de duplicar
      // o conteúdo em tickets.description.
      const chatSessionSelect = `(SELECT cs.id FROM public.chat_sessions cs WHERE cs.ticket_id = t.id ORDER BY cs.created_at DESC LIMIT 1) AS chat_session_id`;
      const closedStatusPlaceholders = CLOSED_TICKET_STATUSES.map((_, i) => `$${i + 1}`).join(',');
      const ticketsRes = includeClosed
        ? await query(`SELECT t.*, ${chatSessionSelect} FROM public.tickets t ORDER BY t.created_at DESC`)
        : await query(
            `SELECT t.*, ${chatSessionSelect} FROM public.tickets t WHERE t.status NOT IN (${closedStatusPlaceholders}) ORDER BY t.created_at DESC`,
            [...CLOSED_TICKET_STATUSES]
          );

      const customerIds = [...new Set(ticketsRes.rows.map(t => t.customer_id).filter(Boolean))];
      const customerMap = new Map<string, string>();

      if (customerIds.length > 0) {
        const placeHolders = customerIds.map((_, i) => `$${i + 1}`).join(',');
        const customersRes = await query(
          `SELECT id, name FROM public.profiles WHERE id IN (${placeHolders})`,
          customerIds
        );
        customersRes.rows.forEach(c => customerMap.set(c.id, c.name));
      }

      const tickets = ticketsRes.rows.map(t => ({
        ...t,
        ticketId: t.number,
        ticketNumber: t.public_ticket_number,
        companyId: t.company_id,
        customerId: t.customer_id,
        customerName: customerMap.get(t.customer_id),
        // Mesmo apelido do branch de chamado único acima — a lista alimenta o
        // modal de detalhe, então sem isto o modal abre já sem responsável.
        assigneeId: t.assignee_id || undefined,
        subStatus: t.sub_status ?? null,
        employeeIds: t.employee_ids || [],
        attachments: t.attachments_data || [],
        chatSessionId: t.chat_session_id,
        queueId: t.queue_id,
        categoryId: t.category_id,
        requestTypeId: t.request_type_id,
        productId: t.product_id,
        mergedIntoId: t.merged_into_id,
        tags: t.tags || [],
        createdAt: t.created_at,
        updatedAt: t.updated_at
      }));

      return NextResponse.json(tickets);
    }
  } catch (error: any) {
    console.error('Error in tickets GET:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'create') {
      const { ticket, userId } = body;

      if (!userId) {
        return NextResponse.json({ error: 'Sessão expirada. Faça login novamente.' }, { status: 401 });
      }

      // Validar empresa
      const companyId = ticket.companyId || '11111111-1111-4111-8111-111111111111';

      // Certificar que o perfil existe no Postgres próprio
      const profileCheck = await query('SELECT role FROM public.profiles WHERE id = $1', [userId]);
      let userRole = 'Cliente';
      if (profileCheck.rowCount === 0) {
        await query(
          `INSERT INTO public.profiles (id, email, name, role, company_id, password)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            userId,
            'auto-created@ticket.com',
            'Usuário Auto-criado',
            'Cliente',
            companyId,
            'auto-created-default-123'
          ]
        );
      } else {
        userRole = profileCheck.rows[0].role;
      }

      // Anexo chega do client como data: URL e é gravado em disco aqui (ver
      // lib/services/attachment-storage.ts) — no banco fica só a URL curta.
      const ticketAttachments = await persistAttachments(ticket.attachments || []);

      const res = await query(
        `INSERT INTO public.tickets (title, description, status, priority, queue_id, category_id, request_type_id, product_id, tags, company_id, customer_id, created_by, attachments_data, employee_ids, assignee_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING *`,
        [
          ticket.title,
          ticket.description,
          ticket.status || 'Novo',
          ticket.priority || 'Baixa',
          ticket.queueId || null,
          ticket.categoryId || null,
          ticket.requestTypeId || null,
          ticket.productId || null,
          ticket.tags || [],
          companyId,
          ticket.customerId || userId,
          userId,
          JSON.stringify(ticketAttachments),
          ticket.employeeIds || [],
          ticket.assigneeId || null
        ]
      );

      const newTicket = res.rows[0];
      handleTicketCreated(newTicket);

      // Exclui quem criou o chamado — mesmo motivo do polling em
      // app/api/notifications/check/route.ts: sem isso, quem acabou de criar
      // também levava a notificação push nativa sobre o próprio chamado.
      getTeamUserIds().then(teamIds => Promise.all(teamIds.filter(id => id !== userId).map(teamId => notifyUser(teamId, {
        title: `Novo chamado ${ticketLabel(newTicket.public_ticket_number, newTicket.id)}`,
        body: newTicket.title,
        url: `/tickets?ticket=${newTicket.id}`,
        tag: `ticket_new:${newTicket.id}`
      })))).catch(err => console.error('[push] Falha ao notificar novo chamado:', err));

      // Se o usuário for "Time Interno", criar ticket interno automaticamente.
      // internal_tickets.team_id é um conceito próprio (texto legado, não FK)
      // e não deve ser derivado de nenhum campo do chamado principal — o time
      // interno terá seus próprios marcadores, à parte.
      if (userRole === 'Time Interno') {
        await query(
          `INSERT INTO public.internal_tickets (title, description, team_id, creator_id, priority)
           VALUES ($1, $2, $3, $4, 1)
           RETURNING id`,
          [
            ticket.title || 'Ticket Interno',
            ticket.description || '',
            'Desenvolvimento',
            userId
          ]
        );
      }

      return NextResponse.json({ success: true, ticket: newTicket });
    }

    if (action === 'create-message') {
      const { message } = body;

      // Anexo chega do client como data: URL e é gravado em disco aqui (ver
      // lib/services/attachment-storage.ts) — no banco fica só a URL curta.
      const messageAttachments = await persistAttachments(message.attachments || []);

      const res = await query(
        `INSERT INTO public.ticket_messages (id, ticket_id, author_id, content, created_at, is_visible_to_customer, type, attachments_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          message.id || crypto.randomUUID(),
          message.ticketId,
          message.senderId || null,
          message.text,
          message.timestamp || new Date().toISOString(),
          message.isVisibleToCustomer !== false,
          message.type || 'text',
          JSON.stringify(messageAttachments)
        ]
      );
      
      await query(
        'UPDATE public.tickets SET updated_at = NOW() WHERE id = $1',
        [message.ticketId]
      );

      const newMessage = res.rows[0];
      if (newMessage.is_visible_to_customer && newMessage.type !== 'internal') {
        query('SELECT * FROM public.tickets WHERE id = $1', [message.ticketId])
          .then(ticketRes => {
            const relatedTicket = ticketRes.rows[0];
            handleTicketMessageCreated(newMessage, relatedTicket);
            if (relatedTicket) {
              const recipients = getTicketRecipients({
                assigneeId: relatedTicket.assignee_id,
                createdBy: relatedTicket.created_by,
                customerId: relatedTicket.customer_id,
                employeeIds: relatedTicket.employee_ids
              }, newMessage.author_id);
              pushToTicketRecipients(recipients, {
                title: `Atualização no chamado ${ticketLabel(relatedTicket.public_ticket_number, relatedTicket.id)}`,
                body: newMessage.content || relatedTicket.title,
                ticketId: relatedTicket.id,
                tag: `ticket_message:${newMessage.id}`
              });
            }
          })
          .catch(err => console.error('[automation] Falha ao buscar chamado para create-message:', err));
      }

      return NextResponse.json(res.rows[0]);
    }

    return NextResponse.json({ error: 'Action não suportada.' }, { status: 400 });
  } catch (error: any) {
    console.error('Error in tickets POST:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// NextRequest (e não Request) porque getTicketActor lê o cookie de sessão por
// request.cookies, que só existe no tipo do Next.
export async function PUT(request: NextRequest) {
  const actor = await getTicketActor(request);
  if (!actor) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (!canWriteTickets(actor)) {
    return NextResponse.json({ error: 'Você não tem permissão para editar chamados.' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'ID do chamado é obrigatório' }, { status: 400 });
  }

  try {
    const ticket = await request.json();

    const oldRes = await query('SELECT * FROM public.tickets WHERE id = $1', [id]);
    const oldTicket = oldRes.rows[0];

    // SET dinâmico a partir das chaves REALMENTE enviadas. É o que reproduz a
    // semântica que o shim tinha e que a tela de detalhe depende:
    //   chave ausente  -> coluna não é tocada
    //   valor null/''  -> coluna é LIMPA
    // A versão anterior usava COALESCE em tudo, o que tornava impossível
    // desmarcar categoria, fila, produto ou sub-status — o valor antigo
    // voltava sozinho.
    //
    // Quem chama é TicketService.update, sempre com o objeto INTEIRO do
    // chamado (spread `...ticket`) — nunca só o campo editado. Ou seja: toda
    // gravação passa por aqui com title/description/status/priority juntos,
    // mesmo quando o usuário só trocou o responsável ou escreveu uma nota.
    // Qualquer regra nova neste laço tem que aguentar esse cenário.
    const FIELDS: Record<string, string> = {
      title: 'title',
      description: 'description',
      status: 'status',
      subStatus: 'sub_status',
      priority: 'priority',
      companyId: 'company_id',
      customerId: 'customer_id',
      assigneeId: 'assignee_id',
      queueId: 'queue_id',
      categoryId: 'category_id',
      requestTypeId: 'request_type_id',
      productId: 'product_id',
      tags: 'tags',
      employeeIds: 'employee_ids'
    };
    // tags e employeeIds são arrays: [] é lista vazia legítima, nunca NULL.
    const ARRAY_FIELDS = new Set(['tags', 'employeeIds']);
    // Colunas NOT NULL no banco (conferido em information_schema): string vazia
    // é valor VÁLIDO e precisa ser gravada como '' — 21 dos 38 chamados em
    // produção têm description = ''. Traduzir '' para NULL aqui derrubava o
    // save inteiro com "null value in column violates not-null constraint",
    // quebrando trocar responsável e responder no chamado (o campo ia junto no
    // spread do objeto, mesmo sem ninguém ter editado a descrição).
    const NOT_NULL_FIELDS = new Set(['title', 'description', 'status', 'priority']);

    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, column] of Object.entries(FIELDS)) {
      if (!(key in ticket) || ticket[key] === undefined) continue;
      const raw = ticket[key];

      if (ARRAY_FIELDS.has(key)) {
        params.push(raw ?? []);
      } else if (NOT_NULL_FIELDS.has(key)) {
        // null/undefined aqui só pode ser lixo do client: ignora o campo em vez
        // de estourar a constraint — a coluna fica com o valor que já tinha.
        if (raw === null) continue;
        params.push(raw);
      } else {
        // Chaves estrangeiras e sub-status: '' vindo de um <select> vazio
        // significa "desmarcar", e aí NULL é o valor certo.
        params.push(raw === '' ? null : (raw ?? null));
      }
      sets.push(`${column} = $${params.length}`);
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: 'Nenhum campo informado.' }, { status: 400 });
    }

    sets.push('updated_at = NOW()');
    params.push(id);

    const updateRes = await query(
      `UPDATE public.tickets SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );

    if (updateRes.rowCount === 0) {
      return NextResponse.json({ error: 'Chamado não encontrado.' }, { status: 404 });
    }

    const newTicket = updateRes.rows[0];
    handleTicketUpdated(oldTicket, newTicket);

    // Edição de campo (status, prioridade, responsável etc.) não gera push:
    // quem editou já vê a confirmação visual na própria tela (flashSaved em
    // ticket-detail-modal.tsx), e um aviso genérico "Chamado atualizado" pros
    // demais é ruído — quem precisa saber de verdade (nova mensagem, chamado
    // encerrado, chamado atribuído a você) continua avisado por outros
    // caminhos (create-message acima, e o polling de notificações).

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in tickets PUT:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const actor = await getTicketActor(request);
  if (!actor) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (!canWriteTickets(actor)) {
    return NextResponse.json({ error: 'Você não tem permissão para editar chamados.' }, { status: 403 });
  }

  try {
    const { ids, updates } = await request.json();
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'IDs dos chamados são obrigatórios.' }, { status: 400 });
    }
    
    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;
    
    if (updates.assigneeId !== undefined) {
      setClauses.push(`assignee_id = $${paramIndex}`);
      params.push(updates.assigneeId || null);
      paramIndex++;
    }
    
    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex}`);
      params.push(updates.status);
      paramIndex++;
      // Igual ao caminho manual único (ticket-detail-modal, que sempre
      // zera subStatus junto de qualquer troca de status): sem isso, um
      // chamado ficava com sub_status de um status pai antigo depois de
      // uma mudança de status em massa, combinação que a UI normal nunca
      // produz sozinha.
      if (updates.subStatus !== undefined) {
        setClauses.push(`sub_status = $${paramIndex}`);
        params.push(updates.subStatus || null);
        paramIndex++;
      } else {
        setClauses.push(`sub_status = NULL`);
      }
    }

    if (updates.title !== undefined) {
      setClauses.push(`title = $${paramIndex}`);
      params.push(updates.title);
      paramIndex++;
    }
    
    if (updates.priority !== undefined) {
      setClauses.push(`priority = $${paramIndex}`);
      params.push(updates.priority);
      paramIndex++;
    }
    
    if (updates.tags !== undefined) {
      setClauses.push(`tags = $${paramIndex}`);
      params.push(updates.tags);
      paramIndex++;
    }
    
    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'Nenhuma alteração informada.' }, { status: 400 });
    }

    setClauses.push(`updated_at = NOW()`);

    const idParamsStart = paramIndex;
    const idPlaceholders = ids.map((_, i) => `$${idParamsStart + i}`).join(',');
    params.push(...ids);

    const selectIdPlaceholders = ids.map((_: any, i: number) => `$${i + 1}`).join(',');
    const oldRes = await query(`SELECT * FROM public.tickets WHERE id IN (${selectIdPlaceholders})`, ids);
    const oldById = new Map(oldRes.rows.map((r: any) => [r.id, r]));

    const sql = `
      UPDATE public.tickets
      SET ${setClauses.join(', ')}
      WHERE id IN (${idPlaceholders})
      RETURNING *
    `;

    const updateRes = await query(sql, params);
    // Mesmo raciocínio do PUT único acima: edição em massa já mostra
    // confirmação visual pra quem fez (toasts em tickets-view.tsx) — sem
    // push genérico de "Chamado atualizado" pra cada um dos chamados afetados.
    for (const newTicket of updateRes.rows) {
      handleTicketUpdated(oldById.get(newTicket.id), newTicket);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in tickets PATCH:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'ID do chamado é obrigatório.' }, { status: 400 });
  }

  try {
    const actor = await getTicketActor(request);
    if (!actor) {
      return NextResponse.json({ error: 'Sessão inválida ou expirada.' }, { status: 401 });
    }

    if (!canDeleteTickets(actor)) {
      return NextResponse.json({ error: 'Você não tem permissão para excluir chamados.' }, { status: 403 });
    }

    const result = await query(
      'DELETE FROM public.tickets WHERE id = $1 RETURNING id, public_ticket_number',
      [id]
    );

    if ((result.rowCount ?? 0) === 0) {
      return NextResponse.json({ error: 'Chamado não encontrado.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, ticket: result.rows[0] });
  } catch (error: any) {
    console.error('Error in tickets DELETE:', error);
    return NextResponse.json({ error: error.message || 'Erro ao excluir chamado.' }, { status: 500 });
  }
}
