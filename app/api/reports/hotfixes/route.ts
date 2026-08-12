import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { resolvePeriod } from '@/lib/report-period';

// Relatório de Hotfixes (R6) — mesmo padrão estrutural dos R1-R5.
//
// A pergunta que ele responde é "a janela de release está sendo cumprida, e o
// que ela carregava?". O encadeamento do dado é indireto e vale registrar,
// porque não é óbvio olhando só o schema:
//
//   hotfixes  <—hotfix_id—  internal_tickets  <—ticket_internal_links—  tickets
//
// Ou seja: o chamado do cliente NÃO aponta pro hotfix. Ele chega no hotfix
// pelo ticket interno que o resolveu. Um hotfix sem ticket interno vinculado
// aparece no relatório com zero chamados — o que é informação, não erro.
//
// Acesso: reports:read (mesma regra dos demais relatórios).

async function getActor(request: NextRequest) {
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

function isAuthorized(actor: any): boolean {
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes('reports:read');
}

// Dias de diferença entre duas datas-only, positivo = a segunda veio depois.
function diffDays(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86400000);
}

function toDateOnly(value: any): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const actor = await getActor(request);
  if (!actor) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (!isAuthorized(actor)) return NextResponse.json({ error: 'Sem permissão para ver relatórios.' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'overview';

  try {
    // extendToPeriodEnd: o intervalo vai até o FIM do período, não até hoje.
    // Sem isso, hotfix com data prevista à frente ficaria fora do relatório e
    // a situação "Pendente" nunca apareceria — justamente o que a equipe
    // precisa ver quando olha a janela de release do mês ou do ano.
    const { startDate, endDate } = await resolvePeriod(searchParams, { extendToPeriodEnd: true });

    // Filtro de situação (mesmos valores calculados abaixo). Vazio = todas.
    const situation = searchParams.get('situation') || '';

    if (action !== 'overview') {
      return NextResponse.json({ error: `Action não suportada: ${action}` }, { status: 400 });
    }

    // "Hoje" pelo banco, no fuso de São Paulo — mesma regra de lib/report-period.
    const todayRes = await query(`SELECT (NOW() AT TIME ZONE 'America/Sao_Paulo')::date AS today`);
    const today = toDateOnly(todayRes.rows[0].today)!;

    // O período filtra por data PREVISTA de publicação: é a data que define a
    // janela de release. Filtrar por published_at esconderia justamente o que
    // mais importa — o que estava previsto e não saiu.
    const hotfixesRes = await query(
      `SELECT h.id, h.name, h.description, h.expected_date, h.published_at, h.alerted_at, h.created_at,
              resp.name AS responsible_name,
              creator.name AS created_by_name,
              prod.label AS product_label
       FROM public.hotfixes h
       LEFT JOIN public.profiles resp ON resp.id = h.responsible_id
       LEFT JOIN public.profiles creator ON creator.id = h.created_by
       LEFT JOIN public.config_products prod ON prod.id = h.product_id
       WHERE h.expected_date BETWEEN $1 AND $2
       ORDER BY h.expected_date DESC`,
      [startDate, endDate]
    );

    const hotfixIds = hotfixesRes.rows.map((h: any) => h.id);

    // Sem hotfix no período não há o que buscar adiante — evita duas queries
    // com `= ANY('{}')` que sempre voltariam vazias.
    const internalRows = hotfixIds.length
      ? (await query(
          `SELECT i.id, i.hotfix_id, i.internal_ticket_number, i.title, i.status, i.priority,
                  i.created_at, i.updated_at, i.sla_limit, i.expected_publish_date,
                  a.name AS assignee_name,
                  c.name AS creator_name,
                  t.name AS team_name
           FROM public.internal_tickets i
           LEFT JOIN public.profiles a ON a.id = i.assignee_id
           LEFT JOIN public.profiles c ON c.id = i.creator_id
           LEFT JOIN public.internal_teams t ON t.id = i.internal_team_id
           WHERE i.hotfix_id = ANY($1)
           ORDER BY i.internal_ticket_number ASC`,
          [hotfixIds]
        )).rows
      : [];

    const internalIds = internalRows.map((i: any) => i.id);

    const ticketRows = internalIds.length
      ? (await query(
          `SELECT l.internal_ticket_id, t.id, t.public_ticket_number, t.title, t.status,
                  t.priority, t.created_at, t.updated_at, t.company_id,
                  co.name AS company_name,
                  ta.name AS assignee_name
           FROM public.ticket_internal_links l
           JOIN public.tickets t ON t.id = l.ticket_id
           LEFT JOIN public.companies co ON co.id = t.company_id
           LEFT JOIN public.profiles ta ON ta.id = t.assignee_id
           WHERE l.internal_ticket_id = ANY($1)
           ORDER BY t.public_ticket_number ASC`,
          [internalIds]
        )).rows
      : [];

    // Quais rótulos de status finalizam um item. Vem de config_statuses (a
    // lista é editável em Configurações), não de constante no código — o
    // equivalente server-side de lib/ticket-status.ts.
    const closedRes = await query(
      `SELECT scope, label FROM public.config_statuses WHERE is_closed = true`
    );
    const closedInternal = new Set(closedRes.rows.filter((r: any) => r.scope === 'internal_ticket').map((r: any) => r.label));
    const closedTicket = new Set(closedRes.rows.filter((r: any) => r.scope === 'ticket').map((r: any) => r.label));

    const ticketsByInternal = new Map<string, any[]>();
    for (const t of ticketRows) {
      const list = ticketsByInternal.get(t.internal_ticket_id) || [];
      list.push(t);
      ticketsByInternal.set(t.internal_ticket_id, list);
    }

    const internalByHotfix = new Map<string, any[]>();
    for (const i of internalRows) {
      const list = internalByHotfix.get(i.hotfix_id) || [];
      list.push(i);
      internalByHotfix.set(i.hotfix_id, list);
    }

    const hotfixes = hotfixesRes.rows.map((h: any) => {
      const expectedDate = toDateOnly(h.expected_date)!;
      const publishedAt = h.published_at ? new Date(h.published_at).toISOString() : null;
      const publishedDate = toDateOnly(h.published_at);

      // Atraso: dias entre o previsto e o que de fato aconteceu. Publicado
      // antes da data prevista dá negativo (adiantado) — mantido como número,
      // a tela decide como mostrar.
      const delayDays = publishedDate
        ? diffDays(expectedDate, publishedDate)
        : diffDays(expectedDate, today);

      const status: 'no_prazo' | 'com_atraso' | 'pendente' | 'pendente_atrasado' = publishedDate
        ? (delayDays > 0 ? 'com_atraso' : 'no_prazo')
        : (delayDays > 0 ? 'pendente_atrasado' : 'pendente');

      const internals = (internalByHotfix.get(h.id) || []).map((i: any) => {
        const isClosed = closedInternal.has(i.status);
        // SLA estourado: comparado com a conclusão quando já fechou, com
        // "agora" quando ainda está aberto. `updated_at` é a melhor
        // aproximação de "quando concluiu" que existe hoje — não há coluna
        // closed_at em internal_tickets, então um ticket reaberto e editado
        // depois desloca essa referência. Aproximação assumida, não bug.
        const reference = isClosed ? new Date(i.updated_at) : new Date();
        const slaBreached = i.sla_limit ? reference > new Date(i.sla_limit) : false;
        const tickets = (ticketsByInternal.get(i.id) || []).map((t: any) => ({
          id: t.id,
          ticketNumber: t.public_ticket_number,
          title: t.title,
          status: t.status,
          isClosed: closedTicket.has(t.status),
          priority: t.priority,
          companyId: t.company_id,
          companyName: t.company_name || null,
          assigneeName: t.assignee_name || null,
          createdAt: new Date(t.created_at).toISOString(),
          updatedAt: new Date(t.updated_at).toISOString()
        }));
        return {
          id: i.id,
          internalTicketNumber: i.internal_ticket_number,
          title: i.title,
          status: i.status,
          isClosed,
          slaLimit: i.sla_limit ? new Date(i.sla_limit).toISOString() : null,
          slaBreached,
          expectedPublishDate: i.expected_publish_date ? new Date(i.expected_publish_date).toISOString() : null,
          assigneeName: i.assignee_name || null,
          creatorName: i.creator_name || null,
          teamName: i.team_name || null,
          createdAt: new Date(i.created_at).toISOString(),
          updatedAt: new Date(i.updated_at).toISOString(),
          tickets
        };
      });

      const allTickets = internals.flatMap(i => i.tickets);
      // Um mesmo chamado pode estar ligado a dois tickets internos do mesmo
      // hotfix; conta uma vez só.
      const uniqueTicketIds = new Set(allTickets.map(t => t.id));

      return {
        id: h.id,
        name: h.name,
        description: h.description || null,
        responsibleName: h.responsible_name || null,
        createdByName: h.created_by_name || null,
        productLabel: h.product_label || null,
        expectedDate,
        publishedAt,
        alertedAt: h.alerted_at ? new Date(h.alerted_at).toISOString() : null,
        createdAt: new Date(h.created_at).toISOString(),
        status,
        delayDays,
        internalTicketCount: internals.length,
        ticketCount: uniqueTicketIds.size,
        openTicketCount: allTickets.filter(t => !t.isClosed).length,
        slaBreachedCount: internals.filter(i => i.slaBreached).length,
        internalTickets: internals
      };
    });

    // Filtro de situação, aplicado depois da montagem porque a situação é
    // calculada (data prevista x publicação x hoje), não uma coluna.
    const filtered = situation ? hotfixes.filter(h => h.status === situation) : hotfixes;

    const published = filtered.filter(h => h.publishedAt);
    const late = published.filter(h => h.status === 'com_atraso');
    const onTime = published.filter(h => h.status === 'no_prazo');
    const pendingLate = filtered.filter(h => h.status === 'pendente_atrasado');
    const totalTickets = new Set(
      filtered.flatMap(h => h.internalTickets.flatMap(i => i.tickets.map(t => t.id)))
    ).size;

    const kpis = {
      total: filtered.length,
      published: published.length,
      onTime: onTime.length,
      late: late.length,
      pending: filtered.length - published.length,
      pendingLate: pendingLate.length,
      // % no prazo é sobre o que JÁ FOI publicado — misturar o que ainda nem
      // venceu no denominador faria o indicador melhorar sozinho só por
      // existir hotfix futuro cadastrado.
      onTimeRate: published.length ? onTime.length / published.length : null,
      avgDelayDays: late.length ? late.reduce((sum, h) => sum + h.delayDays, 0) / late.length : null,
      maxDelayDays: late.length ? Math.max(...late.map(h => h.delayDays)) : null,
      internalTicketCount: filtered.reduce((sum, h) => sum + h.internalTicketCount, 0),
      ticketCount: totalTickets,
      slaBreachedCount: filtered.reduce((sum, h) => sum + h.slaBreachedCount, 0)
    };

    return NextResponse.json({ kpis, hotfixes: filtered, period: { startDate, endDate } });
  } catch (error: any) {
    console.error('[reports/hotfixes]', error);
    return NextResponse.json({ error: error.message || 'Falha ao gerar o relatório.' }, { status: 500 });
  }
}
