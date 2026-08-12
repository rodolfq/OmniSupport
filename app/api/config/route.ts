import { NextResponse } from 'next/server';
import { query, pool } from '@/lib/db';
import { getAutomationSettings, saveAutomationSetting } from '@/lib/services/automation-service';

// Rótulos de status que o código compara literalmente — renomear qualquer um
// deles quebra comportamento mesmo com o dado migrado:
//   lib/ticket-status.ts (CLOSED_TICKET_STATUSES) decide o que conta como
//   fechado (SLA, dashboards, relatórios); mergeTickets grava 'Mesclado';
//   o botão FINALIZAR do ticket interno grava 'Concluído'.
// Para liberá-los seria preciso antes tornar essas regras dinâmicas.
const RESERVED_STATUS_LABELS = ['Concluído', 'Fechado', 'Encerrado', 'Mesclado'];

// Só nas listas de referência que mudam raramente (editadas manualmente em
// Configurações, não a cada minuto) — NUNCA em analyst-statuses (presença
// ao vivo) nem nas configurações administrativas (survey/email/automation/
// metric-thresholds), que precisam refletir edição imediatamente.
const REFERENCE_CACHE_HEADER = 'private, max-age=30, stale-while-revalidate=300';
const cacheableJson = (data: unknown) => NextResponse.json(data, { headers: { 'Cache-Control': REFERENCE_CACHE_HEADER } });

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');

  try {
    if (type === 'priorities') {
      const res = await query('SELECT * FROM public.config_priorities');
      return cacheableJson(res.rows);
    } else if (type === 'statuses') {
      const scope = searchParams.get('scope');
      const res = scope
        ? await query('SELECT * FROM public.config_statuses WHERE scope = $1 ORDER BY sort_order, created_at', [scope])
        : await query('SELECT * FROM public.config_statuses ORDER BY sort_order, created_at');
      return cacheableJson(res.rows);
    } else if (type === 'categories') {
      const res = await query('SELECT * FROM public.config_categories');
      return cacheableJson(res.rows);
    } else if (type === 'request-types') {
      const res = await query('SELECT * FROM public.config_request_types');
      return cacheableJson(res.rows);
    } else if (type === 'products') {
      const res = await query('SELECT * FROM public.config_products');
      return cacheableJson(res.rows);
    } else if (type === 'efforts') {
      // camelCase já daqui: os consumidores (modal do chamado, relatório de
      // carga) leem weight/sortOrder, e devolver a linha crua faria esses
      // campos chegarem undefined — mesmo tropeço já corrigido em
      // analyst-statuses logo abaixo.
      const res = await query('SELECT * FROM public.config_effort_levels ORDER BY sort_order ASC, label ASC');
      return cacheableJson(res.rows.map((r: any) => ({
        id: r.id,
        label: r.label,
        weight: Number(r.weight),
        color: r.color,
        sortOrder: r.sort_order
      })));
    } else if (type === 'outcomes') {
      const res = await query('SELECT * FROM public.config_outcomes ORDER BY sort_order ASC, label ASC');
      return cacheableJson(res.rows.map((r: any) => ({
        id: r.id,
        label: r.label,
        countsAsDefect: r.counts_as_defect,
        color: r.color,
        sortOrder: r.sort_order
      })));
    } else if (type === 'tags') {
      const res = await query('SELECT * FROM public.config_tags');
      return cacheableJson(res.rows);
    } else if (type === 'quick-notes') {
      const res = await query('SELECT * FROM public.quick_notes');
      return NextResponse.json(res.rows);
    } else if (type === 'queues') {
      const res = await query('SELECT * FROM public.queues');
      return cacheableJson(res.rows);
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
    } else if (type === 'metric-thresholds') {
      const res = await query('SELECT * FROM public.config_metric_thresholds WHERE id = 1');
      return NextResponse.json(res.rows[0] || null);
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
    } else if (type === 'efforts') {
      const { effort } = body;
      if (action === 'delete') {
        // tickets.effort_id é ON DELETE SET NULL: o chamado sobrevive e só
        // perde a classificação. Não bloqueia a exclusão do rótulo.
        await query('DELETE FROM public.config_effort_levels WHERE id = $1', [effort.id]);
        return NextResponse.json({ success: true });
      }
      const res = effort.id
        ? await query(
            `INSERT INTO public.config_effort_levels (id, label, weight, color, sort_order)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO UPDATE SET
               label = EXCLUDED.label, weight = EXCLUDED.weight,
               color = EXCLUDED.color, sort_order = EXCLUDED.sort_order
             RETURNING *`,
            [effort.id, effort.label, effort.weight ?? 1, effort.color || '#64748b', effort.sortOrder ?? 0]
          )
        : await query(
            `INSERT INTO public.config_effort_levels (label, weight, color, sort_order)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [effort.label, effort.weight ?? 1, effort.color || '#64748b', effort.sortOrder ?? 0]
          );
      const row = res.rows[0];
      return NextResponse.json({
        id: row.id, label: row.label, weight: Number(row.weight), color: row.color, sortOrder: row.sort_order
      });
    } else if (type === 'outcomes') {
      const { outcome } = body;
      if (action === 'delete') {
        await query('DELETE FROM public.config_outcomes WHERE id = $1', [outcome.id]);
        return NextResponse.json({ success: true });
      }
      const res = outcome.id
        ? await query(
            `INSERT INTO public.config_outcomes (id, label, counts_as_defect, color, sort_order)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO UPDATE SET
               label = EXCLUDED.label, counts_as_defect = EXCLUDED.counts_as_defect,
               color = EXCLUDED.color, sort_order = EXCLUDED.sort_order
             RETURNING *`,
            [outcome.id, outcome.label, !!outcome.countsAsDefect, outcome.color || '#64748b', outcome.sortOrder ?? 0]
          )
        : await query(
            `INSERT INTO public.config_outcomes (label, counts_as_defect, color, sort_order)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [outcome.label, !!outcome.countsAsDefect, outcome.color || '#64748b', outcome.sortOrder ?? 0]
          );
      const row = res.rows[0];
      return NextResponse.json({
        id: row.id, label: row.label, countsAsDefect: row.counts_as_defect, color: row.color, sortOrder: row.sort_order
      });
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
    } else if (type === 'request-types' || type === 'products') {
      // Renomear é seguro nestas duas listas (e em categories acima) porque o
      // chamado aponta pra elas por id — tickets.request_type_id /
      // tickets.product_id. Prioridade e Status NÃO têm endpoint de rename de
      // propósito: tickets.priority e tickets.status guardam o RÓTULO em
      // texto, então renomear lá deixaria todo registro existente apontando
      // pra um valor que não existe mais.
      const table = type === 'products' ? 'config_products' : 'config_request_types';
      const item = body.item;
      if (!item?.id) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });

      if (action === 'delete') {
        await query(`DELETE FROM public.${table} WHERE id = $1`, [item.id]);
        return NextResponse.json({ success: true });
      }

      const label = (item.label || '').trim();
      if (!label) return NextResponse.json({ error: 'O nome não pode ficar vazio.' }, { status: 400 });
      const res = await query(
        `UPDATE public.${table} SET label = $2 WHERE id = $1 RETURNING id, label`,
        [item.id, label]
      );
      if (res.rowCount === 0) return NextResponse.json({ error: 'Item não encontrado.' }, { status: 404 });
      return NextResponse.json(res.rows[0]);
    } else if (type === 'priorities') {
      // Sem rename aqui de propósito. Além de tickets.priority guardar o
      // rótulo em texto (o que a migração resolveria), os quatro nomes estão
      // fixos no código em mais de dez pontos — enum TicketPriority, mapa de
      // SLA em ticket-service, ordenação e filtros do Kanban, e
      // `priority IN ('Alta','Urgente')` na API de busca. Renomear quebraria
      // esses caminhos mesmo com o dado migrado; liberar exige antes tornar
      // essas regras dinâmicas.
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
    } else if (type === 'statuses' && action === 'rename') {
      // Renomear status/sub-status exige migrar junto TODA coluna de texto que
      // guarda o rótulo — config_statuses é referenciada por LABEL, não por id:
      //   tickets.status, tickets.sub_status  (escopo 'ticket')
      //   automation_settings.trigger_status  (escopo 'ticket')
      //   internal_tickets.status             (escopo 'internal_ticket')
      // Tudo numa transação: renomear o rótulo e deixar os registros pra trás
      // significaria chamado sumindo de filtro, SLA parando de contar e
      // automação deixando de disparar, sem erro nenhum aparecer.
      const { status } = body;
      const label = (status?.label || '').trim();
      if (!status?.id || !label) {
        return NextResponse.json({ error: 'id e nome são obrigatórios.' }, { status: 400 });
      }

      const current = await query(
        'SELECT label, scope FROM public.config_statuses WHERE id = $1',
        [status.id]
      );
      if (current.rowCount === 0) return NextResponse.json({ error: 'Status não encontrado.' }, { status: 404 });
      const { label: oldLabel, scope } = current.rows[0];
      if (oldLabel === label) return NextResponse.json({ id: status.id, label, migrated: 0 });

      // Rótulos que o CÓDIGO compara literalmente (lib/ticket-status.ts,
      // botão FINALIZAR do ticket interno, ranking do Kanban). Migrar o dado
      // não bastaria: o comportamento continuaria preso ao texto antigo.
      if (RESERVED_STATUS_LABELS.includes(oldLabel)) {
        return NextResponse.json(
          { error: `"${oldLabel}" não pode ser renomeado: o sistema usa esse nome em regras internas (fechamento, mesclagem, SLA).` },
          { status: 409 }
        );
      }

      // config_statuses não tem UNIQUE(label) — dois status com o mesmo nome
      // no mesmo escopo tornariam tickets.status ambíguo.
      const clash = await query(
        'SELECT 1 FROM public.config_statuses WHERE scope = $1 AND label = $2 AND id <> $3',
        [scope, label, status.id]
      );
      if ((clash.rowCount ?? 0) > 0) {
        return NextResponse.json({ error: 'Já existe um status com esse nome neste escopo.' }, { status: 409 });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('UPDATE public.config_statuses SET label = $2 WHERE id = $1', [status.id, label]);

        let migrated = 0;
        if (scope === 'internal_ticket') {
          const r = await client.query(
            'UPDATE public.internal_tickets SET status = $2 WHERE status = $1',
            [oldLabel, label]
          );
          migrated += r.rowCount ?? 0;
        } else {
          const r1 = await client.query('UPDATE public.tickets SET status = $2 WHERE status = $1', [oldLabel, label]);
          const r2 = await client.query('UPDATE public.tickets SET sub_status = $2 WHERE sub_status = $1', [oldLabel, label]);
          const r3 = await client.query(
            'UPDATE public.automation_settings SET trigger_status = $2 WHERE trigger_status = $1',
            [oldLabel, label]
          );
          migrated += (r1.rowCount ?? 0) + (r2.rowCount ?? 0) + (r3.rowCount ?? 0);
        }

        await client.query('COMMIT');
        return NextResponse.json({ id: status.id, label, migrated });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
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
    // Todas as listas de configuração têm UNIQUE(label). Sem tratar aqui, o
    // usuário que tenta renomear para um nome já existente recebia a mensagem
    // crua do Postgres ("duplicate key value violates unique constraint
    // config_products_label_key"), que não diz o que fazer.
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'Já existe um item com esse nome.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
