import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { CLOSED_TICKET_STATUSES } from '@/lib/ticket-status';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    if (action === 'tickets') {
      const q = searchParams.get('query') || '';
      const status = searchParams.get('status') || '';
      const priority = searchParams.get('priority') || '';
      const slaOverdue = searchParams.get('slaOverdue') === 'true';
      const includeClosed = searchParams.get('includeClosed') === 'true';
      const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
      const requestedPageSize = parseInt(searchParams.get('pageSize') || '10', 10);
      const pageSize = Math.min(10, Math.max(1, requestedPageSize));
      
      const offset = (page - 1) * pageSize;
      
      let sql = 'SELECT * FROM public.tickets WHERE 1=1';
      const params: any[] = [];
      let paramCount = 1;

      if (q) {
        sql += ` AND title ILIKE $${paramCount}`;
        params.push(`%${q}%`);
        paramCount++;
      }

      if (status) {
        sql += ` AND status = $${paramCount}`;
        params.push(status);
        paramCount++;
      } else if (!includeClosed) {
        const closedStatusPlaceholders = CLOSED_TICKET_STATUSES.map((_, i) => `$${paramCount + i}`).join(',');
        sql += ` AND status NOT IN (${closedStatusPlaceholders})`;
        params.push(...CLOSED_TICKET_STATUSES);
        paramCount += CLOSED_TICKET_STATUSES.length;
      }

      if (priority) {
        sql += ` AND priority = $${paramCount}`;
        params.push(priority);
        paramCount++;
      }

      if (slaOverdue) {
        sql += ` AND EXISTS (
          SELECT 1
          FROM public.config_priorities cp
          WHERE cp.label = public.tickets.priority
            AND cp.sla_hours > 0
            AND public.tickets.created_at + make_interval(hours => cp.sla_hours) < NOW()
        )`;
      }

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
        attachments: t.attachments_data || [],
        createdAt: t.created_at,
        updatedAt: t.updated_at
      }));

      return NextResponse.json({
        tickets,
        total,
        page,
        pageSize,
        hasMore: offset + tickets.length < total
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
