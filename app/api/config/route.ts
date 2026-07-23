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
      const res = await query('SELECT * FROM public.config_statuses');
      return NextResponse.json(res.rows);
    } else if (type === 'categories') {
      const res = await query('SELECT * FROM public.config_categories');
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
      const res = await query('SELECT * FROM public.analyst_status');
      return NextResponse.json(res.rows.map(r => ({
        userId: r.user_id,
        isOnline: r.is_online,
        lastActive: r.last_active,
        currentLoad: r.current_load,
        currentReason: r.current_reason,
        status: r.status
      })));
    } else if (type === 'survey-settings') {
      const res = await query('SELECT * FROM public.config_survey_settings WHERE id = 1');
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
