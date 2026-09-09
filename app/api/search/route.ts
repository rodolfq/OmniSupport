import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { CLOSED_TICKET_STATUSES } from '@/lib/ticket-status';
import { getCurrentActionUser, getActorEffectivePermissions } from '@/lib/server-auth';
import { Permission } from '@/lib/types';

// SQL de "SLA vencido" reutilizado pelo filtro slaOverdue (action=tickets) e
// pela coluna "overdue" dos chips rápidos (action=quick-counts) — mantido
// num só lugar pra não divergir entre lista e contagem.
const SLA_OVERDUE_SQL = `EXISTS (
          SELECT 1
          FROM public.config_priorities cp
          WHERE cp.label = public.tickets.priority
            AND cp.sla_hours > 0
            AND public.tickets.created_at + make_interval(hours => cp.sla_hours) < NOW()
        )`;

// Status que encerram um chamado — inclui os cadastrados em Configurações >
// Status (config_statuses.is_closed), não só os 3 fixos de
// CLOSED_TICKET_STATUSES. Antes, um status customizado marcado como
// encerrado só era reconhecido no NAVEGADOR (dynamicClosedLabels, em
// lib/ticket-status.ts, populado em memória do processo do client) — o
// servidor nunca via essa lista e vazava chamados com status customizado
// fechado pra visão padrão (sem "Mostrar encerrados").
async function getClosedTicketStatuses(): Promise<string[]> {
  try {
    const res = await query(`SELECT label FROM public.config_statuses WHERE scope = 'ticket' AND is_closed = true`);
    const labels = res.rows.map(r => r.label as string);
    return labels.length > 0 ? labels : [...CLOSED_TICKET_STATUSES];
  } catch {
    return [...CLOSED_TICKET_STATUSES];
  }
}

// Filtros "de base" compartilhados entre a listagem paginada e as contagens
// dos chips rápidos — texto/status/prioridade/cliente/período/fechados. As
// dimensões dos chips (responsável, atraso, alta prioridade) ficam de fora
// daqui porque cada uma delas é justamente o que varia entre os chips.
function buildBaseWhere(searchParams: URLSearchParams, closedStatuses: string[]) {
  const q = searchParams.get('query') || '';
  const status = searchParams.get('status') || '';
  const priority = searchParams.get('priority') || '';
  const companyId = searchParams.get('companyId') || '';
  const startDate = searchParams.get('startDate') || '';
  const endDate = searchParams.get('endDate') || '';
  const includeClosed = searchParams.get('includeClosed') === 'true';

  let sql = 'WHERE 1=1';
  const params: any[] = [];
  let paramCount = 1;

  if (q) {
    // Painel de Filtros (modern-search-bar.tsx) promete buscar "chamados,
    // clientes, IDs, descrições" no placeholder, mas isso só olhava o
    // título — buscar pelo nome do cliente, pela descrição ou pelo número
    // do chamado voltava vazio mesmo com o chamado existindo.
    sql += ` AND (
      title ILIKE $${paramCount}
      OR description ILIKE $${paramCount}
      OR CAST(public_ticket_number AS TEXT) ILIKE $${paramCount}
      OR EXISTS (SELECT 1 FROM public.profiles cust WHERE cust.id = public.tickets.customer_id AND cust.name ILIKE $${paramCount})
      OR EXISTS (SELECT 1 FROM public.companies co WHERE co.id = public.tickets.company_id AND co.name ILIKE $${paramCount})
    )`;
    params.push(`%${q}%`);
    paramCount++;
  }

  if (status) {
    sql += ` AND status = $${paramCount}`;
    params.push(status);
    paramCount++;
  } else if (!includeClosed) {
    const closedStatusPlaceholders = closedStatuses.map((_, i) => `$${paramCount + i}`).join(',');
    sql += ` AND status NOT IN (${closedStatusPlaceholders})`;
    params.push(...closedStatuses);
    paramCount += closedStatuses.length;
  }

  if (priority) {
    sql += ` AND priority = $${paramCount}`;
    params.push(priority);
    paramCount++;
  }

  if (companyId) {
    sql += ` AND company_id = $${paramCount}`;
    params.push(companyId);
    paramCount++;
  }

  if (startDate) {
    sql += ` AND (public.tickets.created_at AT TIME ZONE 'America/Sao_Paulo')::date >= $${paramCount}::date`;
    params.push(startDate);
    paramCount++;
  }

  if (endDate) {
    sql += ` AND (public.tickets.created_at AT TIME ZONE 'America/Sao_Paulo')::date <= $${paramCount}::date`;
    params.push(endDate);
    paramCount++;
  }

  return { sql, params, paramCount };
}

// Escopo por papel — antes era aplicado no CLIENT (tickets-view.tsx,
// applyRoleBasedFilters), DEPOIS da paginação do servidor: uma página podia
// vir com menos de 10 chamados (ou nenhum) mesmo o servidor dizendo que
// havia mais páginas, porque o corte real acontecia em cima dos 10 já
// paginados. Portado pra dentro do WHERE pra paginação e contagem baterem
// com o que o usuário realmente pode ver. Mesma regra, 1:1.
async function buildScopeWhere(
  actor: { id: string; role: string; company_id?: string | null } | null,
  paramStart: number
): Promise<{ sql: string; params: any[]; paramCount: number }> {
  if (!actor) return { sql: '', params: [], paramCount: paramStart };

  let sql = '';
  const params: any[] = [];
  let paramCount = paramStart;

  if (actor.role === 'Cliente') {
    sql += ` AND company_id = $${paramCount}`;
    params.push(actor.company_id);
    paramCount++;

    const profileRes = await query('SELECT view_all_company_tickets FROM public.profiles WHERE id = $1', [actor.id]);
    if (!profileRes.rows[0]?.view_all_company_tickets) {
      sql += ` AND (customer_id = $${paramCount} OR $${paramCount} = ANY(employee_ids))`;
      params.push(actor.id);
      paramCount++;
    }
  } else if (actor.role !== 'Administrador') {
    // Chegar aqui já exige tickets:read (checado no client antes de montar a
    // tela) — só resta escopar quem não tem Central de Atendimento
    // (outside_queue) às próprias filas/atribuições.
    const permissions = await getActorEffectivePermissions(actor.id);
    if (!permissions.includes(Permission.OUTSIDE_QUEUE_VIEW)) {
      sql += ` AND (assignee_id IS NULL OR assignee_id = $${paramCount} OR $${paramCount} = ANY(employee_ids))`;
      params.push(actor.id);
      paramCount++;
    }
  }

  return { sql, params, paramCount };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    if (action === 'tickets') {
      const slaOverdue = searchParams.get('slaOverdue') === 'true';
      const assigneeId = searchParams.get('assigneeId') || '';
      const unassigned = searchParams.get('unassigned') === 'true';
      const highPriority = searchParams.get('highPriority') === 'true';
      const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
      const requestedPageSize = parseInt(searchParams.get('pageSize') || '10', 10);
      const pageSize = Math.min(10, Math.max(1, requestedPageSize));

      const offset = (page - 1) * pageSize;

      const actor = await getCurrentActionUser();
      const closedStatuses = await getClosedTicketStatuses();
      const base = buildBaseWhere(searchParams, closedStatuses);
      let sql = `SELECT * FROM public.tickets ${base.sql}`;
      const params: any[] = [...base.params];
      let paramCount = base.paramCount;

      if (slaOverdue) {
        sql += ` AND ${SLA_OVERDUE_SQL}`;
      }

      if (assigneeId) {
        sql += ` AND assignee_id = $${paramCount}`;
        params.push(assigneeId);
        paramCount++;
      }

      if (unassigned) {
        sql += ` AND assignee_id IS NULL`;
      }

      if (highPriority) {
        sql += ` AND priority IN ('Alta', 'Urgente')`;
      }

      // Escopo por papel dentro do WHERE (não mais um corte client-side
      // depois da paginação — ver comentário de buildScopeWhere).
      const scope = await buildScopeWhere(actor, paramCount);
      sql += scope.sql;
      params.push(...scope.params);
      paramCount = scope.paramCount;

      const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) AS total');
      const countParams = [...params];

      sql += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
      params.push(pageSize, offset);

      const [res, countRes] = await Promise.all([
        query(sql, params),
        query(countSql, countParams)
      ]);
      const total = parseInt(countRes.rows[0]?.total || '0', 10);

      // Map tickets
      const tickets = res.rows.map(t => ({
        ...t,
        ticketNumber: t.public_ticket_number,
        companyId: t.company_id,
        customerId: t.customer_id,
        createdBy: t.created_by || undefined,
        // Esta é a listagem principal de chamados, e é dela que sai o objeto
        // aberto no modal de detalhe. O spread acima entrega só snake_case;
        // sem estes apelidos o responsavel e o sub-status chegam `undefined`
        // na tela mesmo estando gravados no banco.
        assigneeId: t.assignee_id || undefined,
        subStatus: t.sub_status ?? null,
        attachments: t.attachments_data || [],
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        queueId: t.queue_id,
        categoryId: t.category_id,
        requestTypeId: t.request_type_id,
        productId: t.product_id,
        chatSessionId: t.chat_session_id,
        mergedIntoId: t.merged_into_id,
        tags: t.tags || []
      }));

      return NextResponse.json({
        tickets,
        total,
        page,
        pageSize,
        hasMore: offset + tickets.length < total
      });
    }

    if (action === 'quick-counts') {
      const userId = searchParams.get('userId') || '';
      const actor = await getCurrentActionUser();
      const closedStatuses = await getClosedTicketStatuses();
      const base = buildBaseWhere(searchParams, closedStatuses);
      const scope = await buildScopeWhere(actor, base.paramCount);

      const sql = `
        SELECT
          COUNT(*) AS total_count,
          COUNT(*) FILTER (WHERE assignee_id = $${scope.paramCount}) AS mine,
          COUNT(*) FILTER (WHERE assignee_id IS NULL) AS unassigned,
          COUNT(*) FILTER (WHERE ${SLA_OVERDUE_SQL}) AS overdue,
          COUNT(*) FILTER (WHERE priority IN ('Alta', 'Urgente')) AS high
        FROM public.tickets ${base.sql}${scope.sql}
      `;
      const params = [...base.params, ...scope.params, userId];

      const res = await query(sql, params);
      const row = res.rows[0] || {};
      return NextResponse.json({
        all: parseInt(row.total_count || '0', 10),
        mine: parseInt(row.mine || '0', 10),
        unassigned: parseInt(row.unassigned || '0', 10),
        overdue: parseInt(row.overdue || '0', 10),
        high: parseInt(row.high || '0', 10),
      });
    }

    if (action === 'customer-dashboard') {
      // Dashboard do Cliente/Funcionário em /my-tickets — sem SLA/tempo de
      // resposta (pedido explícito): só contagem de chamados por estágio e de
      // conversas, no mesmo escopo que a lista de chamados já usa (empresa
      // toda com view_all_company_tickets, senão só os próprios).
      const actor = await getCurrentActionUser();
      if (!actor || (actor.role !== 'Cliente' && actor.role !== 'Funcionário')) {
        return NextResponse.json({ error: 'Acesso restrito a Cliente/Funcionário.' }, { status: 403 });
      }

      const profileRes = await query('SELECT view_all_company_tickets FROM public.profiles WHERE id = $1', [actor.id]);
      const viewAll = actor.role === 'Cliente' && !!profileRes.rows[0]?.view_all_company_tickets;

      const scopeSql = viewAll ? 'company_id = $1' : '(customer_id = $1 OR $1 = ANY(employee_ids))';
      const scopeParam = viewAll ? actor.company_id : actor.id;

      const closedStatuses = await getClosedTicketStatuses();
      const closedPlaceholders = closedStatuses.map((_, i) => `$${i + 2}`).join(',');

      const ticketCountsRes = await query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'Novo') AS novos,
           COUNT(*) FILTER (WHERE status NOT IN (${closedPlaceholders}) AND status <> 'Novo') AS em_andamento,
           COUNT(*) FILTER (WHERE status IN (${closedPlaceholders}) AND updated_at > NOW() - INTERVAL '30 days') AS finalizados_recentes,
           COUNT(*) AS total
         FROM public.tickets WHERE ${scopeSql}`,
        [scopeParam, ...closedStatuses]
      );

      const chatScopeSql = viewAll
        ? 'customer_id IN (SELECT id FROM public.profiles WHERE company_id = $1)'
        : 'customer_id = $1';

      const [chatActiveRes, chatClosedRecentRes] = await Promise.all([
        query(`SELECT COUNT(*) AS total FROM public.chat_sessions WHERE status != 'closed' AND ${chatScopeSql}`, [scopeParam]),
        query(`SELECT COUNT(*) AS total FROM public.chat_histories WHERE finished_at > NOW() - INTERVAL '30 days' AND ${chatScopeSql}`, [scopeParam])
      ]);

      const row = ticketCountsRes.rows[0] || {};
      return NextResponse.json({
        scope: viewAll ? 'company' : 'self',
        tickets: {
          novos: parseInt(row.novos || '0', 10),
          emAndamento: parseInt(row.em_andamento || '0', 10),
          finalizadosRecentes: parseInt(row.finalizados_recentes || '0', 10),
          total: parseInt(row.total || '0', 10),
        },
        chats: {
          ativas: parseInt(chatActiveRes.rows[0]?.total || '0', 10),
          encerradasRecentes: parseInt(chatClosedRecentRes.rows[0]?.total || '0', 10),
        }
      });
    }

    if (action === 'suggestions') {
      const userId = searchParams.get('userId');
      const limit = parseInt(searchParams.get('limit') || '5', 10);
      if (!userId) return NextResponse.json({ error: 'userId é obrigatório' }, { status: 400 });

      const res = await query(
        'SELECT query FROM public.user_search_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
        [userId, limit]
      );
      return NextResponse.json(res.rows.map(h => h.query));
    }

    if (action === 'views') {
      const userId = searchParams.get('userId');
      if (!userId) return NextResponse.json({ error: 'userId é obrigatório' }, { status: 400 });

      const res = await query(
        'SELECT * FROM public.saved_views WHERE user_id = $1 ORDER BY created_at DESC',
        [userId]
      );
      return NextResponse.json(res.rows.map(v => ({
        id: v.id,
        name: v.name,
        filters: v.filters
      })));
    }

    if (action === 'stats') {
      const closedStatusPlaceholders = CLOSED_TICKET_STATUSES.map((_, i) => `$${i + 1}`).join(',');
      const totalRes = await query('SELECT COUNT(*) FROM public.tickets');
      const openRes = await query("SELECT COUNT(*) FROM public.tickets WHERE status = 'Novo'");
      const inProgressRes = await query("SELECT COUNT(*) FROM public.tickets WHERE status IN ('Em Andamento', 'Em Atendimento')");
      const closedRes = await query(
        `SELECT COUNT(*) FROM public.tickets WHERE status IN (${closedStatusPlaceholders})`,
        [...CLOSED_TICKET_STATUSES]
      );

      return NextResponse.json({
        total: parseInt(totalRes.rows[0].count || '0', 10),
        open: parseInt(openRes.rows[0].count || '0', 10),
        inProgress: parseInt(inProgressRes.rows[0].count || '0', 10),
        closed: parseInt(closedRes.rows[0].count || '0', 10),
        overdue: 0
      });
    }

    return NextResponse.json({ error: 'Action não suportada.' }, { status: 400 });
  } catch (error: any) {
    console.error('Error in search GET:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'save-history') {
      const { userId, query: q } = body;
      if (!userId || !q) return NextResponse.json({ error: 'userId e query são obrigatórios' }, { status: 400 });

      await query(
        'DELETE FROM public.user_search_history WHERE user_id = $1 AND query = $2',
        [userId, q]
      );
      await query(
        'INSERT INTO public.user_search_history (user_id, query) VALUES ($1, $2)',
        [userId, q]
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'save-view') {
      const { userId, name, filters } = body;
      if (!userId || !name) return NextResponse.json({ error: 'userId e name são obrigatórios' }, { status: 400 });

      await query(
        'INSERT INTO public.saved_views (user_id, name, filters) VALUES ($1, $2, $3)',
        [userId, name, filters]
      );
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Action não suportada.' }, { status: 400 });
  } catch (error: any) {
    console.error('Error in search POST:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
