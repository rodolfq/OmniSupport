import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getAutomationSettings, saveAutomationSetting } from '@/lib/services/automation-service';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');

  try {
    if (type === 'priorities') {
      const res = await query('SELECT * FROM public.config_priorities');
      return NextResponse.json(res.rows);
    } else if (type === 'statuses') {
      const scope = searchParams.get('scope');
      const res = scope
        ? await query('SELECT * FROM public.config_statuses WHERE scope = $1 ORDER BY sort_order, created_at', [scope])
        : await query('SELECT * FROM public.config_statuses ORDER BY sort_order, created_at');
      return NextResponse.json(res.rows);
    } else if (type === 'categories') {
      const res = await query('SELECT * FROM public.config_categories');
      return NextResponse.json(res.rows);
    } else if (type === 'request-types') {
      const res = await query('SELECT * FROM public.config_request_types');
      return NextResponse.json(res.rows);
    } else if (type === 'products') {
      const res = await query('SELECT * FROM public.config_products');
      return NextResponse.json(res.rows);
    } else if (type === 'tags') {
      const res = await query('SELECT * FROM public.config_tags');
      return NextResponse.json(res.rows);
    } else if (type === 'quick-notes') {
      const res = await query('SELECT * FROM public.quick_notes');
      return NextResponse.json(res.rows);
    } else if (type === 'queues') {
      const res = await query('SELECT * FROM public.queues');
      return NextResponse.json(res.rows);
    } else if (type === 'analyst-statuses') {
      // Mapeado pra camelCase porque a interface AnalystStatus (lib/types.ts)
      // e todo consumidor (chat-widget.tsx, chat-management/page.tsx) leem
      // s.isOnline/s.userId/s.lastActive/s.currentLoad — devolver a linha
      // crua (is_online/user_id/...) fazia esses campos virem sempre
      // undefined, deixando a lista de "colegas online" pra transferir chat
      // e o badge Disponível/Ausente sempre vazios/errados.
      // changes_today ignora repetições do heartbeat de 60s (que regrava o
      // mesmo status): só conta uma linha quando o status é diferente da
      // anterior do mesmo usuário (LAG). Serve só de sinalização pro admin
      // notar padrão estranho — não bloqueia nada (ver plano de anti-fraude).
      const res = await query(
        `SELECT a.*, COALESCE(c.changes_today, 0) AS changes_today
         FROM public.analyst_status a
         LEFT JOIN (
           SELECT user_id, COUNT(*)::int AS changes_today FROM (
             SELECT user_id, status,
                    status IS DISTINCT FROM LAG(status) OVER (PARTITION BY user_id ORDER BY timestamp) AS changed
             FROM public.user_status_history
             WHERE timestamp >= CURRENT_DATE
           ) t WHERE changed IS TRUE GROUP BY user_id
         ) c ON c.user_id = a.user_id`
      );
      return NextResponse.json(res.rows.map(r => ({
        userId: r.user_id,
        isOnline: r.is_online,
        lastActive: r.last_active,
        currentLoad: r.current_load,
        currentReason: r.current_reason,
        status: r.status,
        statusChangesToday: r.changes_today,
        queueAnchorAt: r.queue_anchor_at
      })));
    } else if (type === 'survey-settings') {
      const res = await query('SELECT * FROM public.config_survey_settings WHERE id = 1');
      return NextResponse.json(res.rows[0] || null);
    } else if (type === 'email-settings') {
      const res = await query('SELECT * FROM public.config_email_settings WHERE id = 1');
      return NextResponse.json(res.rows[0] || null);
    } else if (type === 'automation-settings') {
      const settings = await getAutomationSettings();
      return NextResponse.json(settings);
    } else {
      return NextResponse.json({ error: 'Tipo não especificado ou inválido' }, { status: 400 });
    }
  } catch (error: any) {
    console.error(`Error fetching config ${type}:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, action } = body;

    if (type === 'tags') {
      const { tag } = body;
      if (action === 'save') {
        const id = tag.id || undefined;
        let res;
        if (id) {
          res = await query(
            `INSERT INTO public.config_tags (id, label, color, domain)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO UPDATE SET
               label = EXCLUDED.label,
               color = EXCLUDED.color,
               domain = EXCLUDED.domain
             RETURNING id, label, color, domain`,
            [id, tag.label, tag.color, tag.domain]
          );
        } else {
          res = await query(
            `INSERT INTO public.config_tags (label, color, domain)
             VALUES ($1, $2, $3)
             RETURNING id, label, color, domain`,
            [tag.label, tag.color, tag.domain]
          );
        }
        return NextResponse.json(res.rows[0]);
      } else if (action === 'delete') {
        await query('DELETE FROM public.config_tags WHERE id = $1', [tag.id]);
        return NextResponse.json({ success: true });
      }
    } else if (type === 'categories') {
      const { category } = body;
      const id = category.id || undefined;
      if (id) {
        await query(
          `INSERT INTO public.config_categories (id, label)
           VALUES ($1, $2)
           ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label`,
          [id, category.label]
        );
      } else {
        await query(
          `INSERT INTO public.config_categories (label)
           VALUES ($1)`,
          [category.label]
        );
      }
      return NextResponse.json({ success: true });
    } else if (type === 'priorities') {
      const { priority } = body;
      const id = priority.id || undefined;
      if (id) {
        await query(
          `INSERT INTO public.config_priorities (id, label, sla_hours, color)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET
             label = EXCLUDED.label,
             sla_hours = EXCLUDED.sla_hours,
             color = EXCLUDED.color`,
          [id, priority.label, priority.slaHours, priority.color]
        );
      } else {
        await query(
          `INSERT INTO public.config_priorities (label, sla_hours, color)
           VALUES ($1, $2, $3)`,
          [priority.label, priority.slaHours, priority.color]
        );
      }
      return NextResponse.json({ success: true });
    } else if (type === 'statuses') {
      const { status } = body;
      if (action === 'save') {
        const id = status.id || undefined;
        // "Concluído" é o status fixo que sempre finaliza o chamado — uma
        // vez criado (seed da migration), ninguém pode renomeá-lo nem tirar
        // a marcação de "finaliza", só trocar a cor.
        let existingLabel: string | null = null;
        if (id) {
          const existing = await query('SELECT label FROM public.config_statuses WHERE id = $1', [id]);
          existingLabel = existing.rows[0]?.label ?? null;
        }
        const isProtected = existingLabel === 'Concluído';
        const label = isProtected ? 'Concluído' : status.label;
        const isClosed = isProtected ? true : !!status.isClosed;
        const parentStatusId = status.parentStatusId || null;

        let res;
        if (id) {
          res = await query(
            `INSERT INTO public.config_statuses (id, label, color, scope, is_closed, sort_order, parent_status_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO UPDATE SET
               label = EXCLUDED.label,
               color = EXCLUDED.color,
               scope = EXCLUDED.scope,
               is_closed = EXCLUDED.is_closed,
               sort_order = EXCLUDED.sort_order,
               parent_status_id = EXCLUDED.parent_status_id
             RETURNING *`,
            [id, label, status.color, status.scope, isClosed, status.sortOrder ?? 0, parentStatusId]
          );
        } else {
          res = await query(
            `INSERT INTO public.config_statuses (label, color, scope, is_closed, sort_order, parent_status_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [label, status.color, status.scope, isClosed, status.sortOrder ?? 0, parentStatusId]
          );
        }
        return NextResponse.json(res.rows[0]);
      } else if (action === 'delete') {
        const existing = await query('SELECT label FROM public.config_statuses WHERE id = $1', [status.id]);
        if (existing.rows[0]?.label === 'Concluído') {
          return NextResponse.json({ error: 'O status "Concluído" não pode ser excluído.' }, { status: 400 });
        }
        await query('DELETE FROM public.config_statuses WHERE id = $1', [status.id]);
        return NextResponse.json({ success: true });
      } else if (action === 'reorder') {
        const { items } = body as { items: { id: string; sortOrder: number }[] };
        for (const item of items) {
          await query('UPDATE public.config_statuses SET sort_order = $1 WHERE id = $2', [item.sortOrder, item.id]);
        }
        return NextResponse.json({ success: true });
      }
    } else if (type === 'quick-notes') {
      const { note } = body;
      if (action === 'save') {
        const id = note.id || undefined;
        if (id) {
          await query(
            `INSERT INTO public.quick_notes (id, shortcut, content, category)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO UPDATE SET
               shortcut = EXCLUDED.shortcut,
               content = EXCLUDED.content,
               category = EXCLUDED.category`,
            [id, note.shortcut, note.content, note.category]
          );
        } else {
          await query(
            `INSERT INTO public.quick_notes (shortcut, content, category)
             VALUES ($1, $2, $3)`,
            [note.shortcut, note.content, note.category]
          );
        }
        return NextResponse.json({ success: true });
      } else if (action === 'delete') {
        await query('DELETE FROM public.quick_notes WHERE id = $1', [note.id]);
        return NextResponse.json({ success: true });
      }
    } else if (type === 'survey-settings') {
      const { settings } = body;
      const res = await query(
        `UPDATE public.config_survey_settings
         SET enabled = $1,
             message = $2,
             response_window_hours = $3,
             updated_at = now()
         WHERE id = 1
         RETURNING *`,
        [settings.enabled, settings.message, settings.responseWindowHours]
      );
      return NextResponse.json(res.rows[0]);
    } else if (type === 'email-settings') {
      const { settings } = body;
      const res = await query(
        `UPDATE public.config_email_settings
         SET enabled = $1,
             smtp_host = $2,
             smtp_port = $3,
             smtp_secure = $4,
             smtp_user = $5,
             smtp_password = $6,
             from_name = $7,
             from_email = $8,
             updated_at = now()
         WHERE id = 1
         RETURNING *`,
        [
          settings.enabled,
          settings.smtpHost || null,
          settings.smtpPort || null,
          settings.smtpSecure,
          settings.smtpUser || null,
          settings.smtpPassword || null,
          settings.fromName || null,
          settings.fromEmail || null,
        ]
      );
      return NextResponse.json(res.rows[0]);
    } else if (type === 'automation-settings') {
      const { eventKey, settings } = body;
      const saved = await saveAutomationSetting(eventKey, settings);
      return NextResponse.json(saved);
    }

    return NextResponse.json({ error: 'Action or type not supported' }, { status: 400 });
  } catch (error: any) {
    console.error('Error in config POST:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
