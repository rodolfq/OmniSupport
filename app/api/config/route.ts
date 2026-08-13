import { NextResponse } from 'next/server';
import { query, pool } from '@/lib/db';
import { getAutomationSettings, saveAutomationSetting } from '@/lib/services/automation-service';
import { getCurrentActionUser, getActorEffectivePermissions } from '@/lib/server-auth';

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
// Sem stale-while-revalidate: ele deixava o navegador servir a lista velha por
// até 5 minutos DEPOIS dos 30s, e quem acabara de cadastrar um item em
// Configurações via a tela "não atualizar" mesmo recarregando. Quem escreve lê
// por lib/services/config-service.ts, que manda no-store; aqui o teto de
// defasagem para as telas de leitura fica em 30s.
const REFERENCE_CACHE_HEADER = 'private, max-age=30';

// As três listas de rótulo simples, referenciadas por id no chamado.
const SIMPLE_LISTS: Record<string, { table: string; noun: string }> = {
  'categories': { table: 'config_categories', noun: 'categoria' },
  'request-types': { table: 'config_request_types', noun: 'tipo de solicitação' },
  'products': { table: 'config_products', noun: 'produto' }
};

// Onde cada lista é referenciada. É o que decide se um item pode ser excluído
// de verdade ou só arquivado: com uso > 0, excluir dispararia o ON DELETE SET
// NULL e esvaziaria o campo desses registros sem possibilidade de recuperar.
// Produto aparece em duas tabelas (chamado e hotfix) — as duas contam.
const USAGE_REFS: Record<string, Array<{ table: string; column: string }>> = {
  'categories': [{ table: 'tickets', column: 'category_id' }],
  'request-types': [{ table: 'tickets', column: 'request_type_id' }],
  'products': [
    { table: 'tickets', column: 'product_id' },
    { table: 'hotfixes', column: 'product_id' }
  ],
  'efforts': [{ table: 'internal_tickets', column: 'effort_id' }],
  'outcomes': [{ table: 'internal_tickets', column: 'outcome_id' }]
};

// Subconsulta correlacionada com a linha `c` da lista — usada tanto na
// listagem (usage=1) quanto na checagem antes de excluir.
function usageCountSql(type: string, alias = 'c'): string {
  const refs = USAGE_REFS[type] || [];
  if (refs.length === 0) return '0';
  return refs
    .map(r => `(SELECT COUNT(*) FROM public.${r.table} x WHERE x.${r.column} = ${alias}.id)`)
    .join(' + ');
}

async function countUsage(type: string, id: string): Promise<number> {
  const refs = USAGE_REFS[type] || [];
  if (refs.length === 0) return 0;
  const sql = refs.map(r => `(SELECT COUNT(*) FROM public.${r.table} WHERE ${r.column} = $1)`).join(' + ');
  const res = await query(`SELECT ${sql} AS total`, [id]);
  return Number(res.rows[0]?.total || 0);
}
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
    } else if (type === 'categories' || type === 'request-types' || type === 'products') {
      // Devolve ATIVOS E ARQUIVADOS, com a marca isArchived — de propósito.
      // Se a rota escondesse os arquivados, um chamado antigo classificado com
      // uma opção aposentada apareceria com o campo em branco na tela, que é
      // exatamente a perda de informação que o arquivamento existe pra evitar.
      // Quem monta seletor de chamado NOVO é que filtra os arquivados fora
      // (ver components/new-ticket-modal.tsx); assim o erro, se houver, é
      // visível (item a mais na lista) em vez de silencioso (rótulo sumido).
      //
      // usage=1 acrescenta quantos registros usam cada item — só a tela de
      // Configurações pede, porque é ela que decide entre arquivar e excluir.
      const withUsage = searchParams.get('usage') === '1';
      const { table } = SIMPLE_LISTS[type];
      const res = withUsage
        ? await query(`SELECT c.id, c.label, c.archived_at, ${usageCountSql(type)} AS usage_count
                       FROM public.${table} c ORDER BY c.label`)
        : await query(`SELECT id, label, archived_at FROM public.${table} ORDER BY label`);
      return cacheableJson(res.rows.map((r: any) => ({
        id: r.id,
        label: r.label,
        isArchived: r.archived_at !== null,
        archivedAt: r.archived_at,
        ...(withUsage ? { usageCount: Number(r.usage_count) } : {})
      })));
    } else if (type === 'internal-teams') {
      // Lista de referência das equipes internas (seletor de equipe no ticket
      // interno e filtro por equipe da tela de Tickets Internos): TODAS, para
      // qualquer sessão.
      //
      // Esta lista já foi recortada pelas equipes do usuário, junto com a
      // trava de visibilidade do ticket interno. As duas coisas foram
      // revertidas juntas de propósito: com o ticket aberto a todo o time
      // (ver app/api/internal-tickets/route.ts), devolver menos equipes aqui
      // só deixaria o filtro incompleto — daria para ver o ticket de uma
      // equipe mas não para filtrar por ela.
      const res = await query('SELECT * FROM public.internal_teams ORDER BY name ASC');
      return cacheableJson(res.rows);
    } else if (type === 'efforts') {
      // camelCase já daqui: os consumidores (modal do chamado, relatório de
      // carga) leem weight/sortOrder, e devolver a linha crua faria esses
      // campos chegarem undefined — mesmo tropeço já corrigido em
      // analyst-statuses logo abaixo.
      const withUsage = searchParams.get('usage') === '1';
      const res = await query(
        `SELECT c.*${withUsage ? `, ${usageCountSql('efforts')} AS usage_count` : ''}
         FROM public.config_effort_levels c ORDER BY c.sort_order ASC, c.label ASC`
      );
      return cacheableJson(res.rows.map((r: any) => ({
        id: r.id,
        label: r.label,
        weight: Number(r.weight),
        color: r.color,
        sortOrder: r.sort_order,
        isArchived: r.archived_at !== null,
        archivedAt: r.archived_at,
        ...(withUsage ? { usageCount: Number(r.usage_count) } : {})
      })));
    } else if (type === 'outcomes') {
      const withUsage = searchParams.get('usage') === '1';
      const res = await query(
        `SELECT c.*${withUsage ? `, ${usageCountSql('outcomes')} AS usage_count` : ''}
         FROM public.config_outcomes c ORDER BY c.sort_order ASC, c.label ASC`
      );
      return cacheableJson(res.rows.map((r: any) => ({
        id: r.id,
        label: r.label,
        countsAsDefect: r.counts_as_defect,
        color: r.color,
        sortOrder: r.sort_order,
        isArchived: r.archived_at !== null,
        archivedAt: r.archived_at,
        ...(withUsage ? { usageCount: Number(r.usage_count) } : {})
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

/**
 * Tipos de configuração que são ADMINISTRAÇÃO do sistema e exigem permissão.
 *
 * Nenhuma escrita desta rota conferia permissão: qualquer sessão autenticada
 * podia renomear status, mexer em SLA, alterar a pesquisa de satisfação e as
 * mensagens automáticas (que são DISPARADAS ao cliente). A tela escondia os
 * controles, o que não é barreira para quem chama a rota direto.
 *
 * `quick-notes` fica FORA da lista de propósito: notas rápidas são ferramenta
 * de produtividade do atendente, criadas na própria tela de atendimento — o
 * perfil "Equipe" não tem settings:write, e exigi-la ali tiraria dos 20
 * analistas algo que eles usam todo dia.
 */
const TIPOS_ADMINISTRATIVOS = new Set([
  'tags', 'efforts', 'outcomes', 'categories', 'request-types', 'products',
  'priorities', 'statuses', 'survey-settings', 'email-settings',
  'automation-settings', 'metric-thresholds'
]);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, action } = body;

    if (TIPOS_ADMINISTRATIVOS.has(type)) {
      const actor = await getCurrentActionUser();
      if (!actor) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });

      if (actor.role !== 'Administrador') {
        const permissions = await getActorEffectivePermissions(actor.id);
        // Aceita as duas: `settings:write` é a permissão da tela de
        // Configurações e `settings:system` é a de "Geral do sistema" — o
        // perfil "Acesso", que administra hoje, tem só a segunda. Exigir
        // apenas uma delas tiraria acesso de quem já administra.
        const pode = permissions.includes('settings:write') || permissions.includes('settings:system');
        if (!pode) {
          return NextResponse.json(
            { error: 'Você não tem permissão para alterar configurações do sistema.' },
            { status: 403 }
          );
        }
      }
    }

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
      if (action === 'archive' || action === 'restore') {
        const res = await query(
          `UPDATE public.config_effort_levels SET archived_at = ${action === 'archive' ? 'NOW()' : 'NULL'}
           WHERE id = $1 RETURNING *`,
          [effort.id]
        );
        if (res.rowCount === 0) return NextResponse.json({ error: 'Item não encontrado.' }, { status: 404 });
        const row = res.rows[0];
        return NextResponse.json({
          id: row.id, label: row.label, weight: Number(row.weight), color: row.color,
          sortOrder: row.sort_order, isArchived: row.archived_at !== null, archivedAt: row.archived_at
        });
      }
      if (action === 'delete') {
        // internal_tickets.effort_id é ON DELETE SET NULL: excluir um nível em
        // uso apagaria a classificação desses tickets sem recuperação. Só
        // exclui quem ninguém usa; o resto se arquiva.
        const usage = await countUsage('efforts', effort.id);
        if (usage > 0) {
          return NextResponse.json({
            error: `${usage} ticket(s) interno(s) usam este nível de esforço. Arquive em vez de excluir.`,
            usageCount: usage
          }, { status: 409 });
        }
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
      // isArchived vai junto em TODA resposta de gravação: a tela substitui o
      // item no estado local pelo que volta daqui, e sem este campo um simples
      // rename faria um item arquivado voltar a parecer ativo na tela.
      return NextResponse.json({
        id: row.id, label: row.label, weight: Number(row.weight), color: row.color,
        sortOrder: row.sort_order, isArchived: row.archived_at !== null, archivedAt: row.archived_at
      });
    } else if (type === 'outcomes') {
      const { outcome } = body;
      if (action === 'archive' || action === 'restore') {
        const res = await query(
          `UPDATE public.config_outcomes SET archived_at = ${action === 'archive' ? 'NOW()' : 'NULL'}
           WHERE id = $1 RETURNING *`,
          [outcome.id]
        );
        if (res.rowCount === 0) return NextResponse.json({ error: 'Item não encontrado.' }, { status: 404 });
        const row = res.rows[0];
        return NextResponse.json({
          id: row.id, label: row.label, countsAsDefect: row.counts_as_defect, color: row.color,
          sortOrder: row.sort_order, isArchived: row.archived_at !== null, archivedAt: row.archived_at
        });
      }
      if (action === 'delete') {
        // Mesma regra do esforço: desfecho em uso se arquiva, não se exclui.
        const usage = await countUsage('outcomes', outcome.id);
        if (usage > 0) {
          return NextResponse.json({
            error: `${usage} ticket(s) interno(s) usam este desfecho. Arquive em vez de excluir.`,
            usageCount: usage
          }, { status: 409 });
        }
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
        id: row.id, label: row.label, countsAsDefect: row.counts_as_defect, color: row.color,
        sortOrder: row.sort_order, isArchived: row.archived_at !== null, archivedAt: row.archived_at
      });
    } else if (type === 'categories' || type === 'request-types' || type === 'products') {
      // As três listas simples de rótulo. Criar, renomear e excluir passam por
      // aqui — antes a tela de Configurações escrevia direto nessas tabelas
      // pelo shim, escolhendo o nome da tabela no próprio client.
      //
      // Renomear é seguro nestas três porque o chamado aponta pra elas por id
      // (tickets.category_id / request_type_id / product_id). Prioridade e
      // Status não têm rename simples: guardam o RÓTULO em texto em
      // tickets.priority/status — ver o branch de statuses, que migra os
      // registros junto.
      const { table, noun } = SIMPLE_LISTS[type];
      // `category` aceito por compatibilidade com o formato antigo do body.
      const item = body.item || body.category || {};

      if (action === 'archive' || action === 'restore') {
        if (!item.id) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });
        const res = await query(
          `UPDATE public.${table} SET archived_at = ${action === 'archive' ? 'NOW()' : 'NULL'}
           WHERE id = $1 RETURNING id, label, archived_at`,
          [item.id]
        );
        if (res.rowCount === 0) return NextResponse.json({ error: 'Item não encontrado.' }, { status: 404 });
        const row = res.rows[0];
        return NextResponse.json({
          id: row.id, label: row.label,
          isArchived: row.archived_at !== null, archivedAt: row.archived_at
        });
      }

      if (action === 'delete') {
        if (!item.id) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });

        // Exclusão de verdade só para item que ninguém usa. Com uso > 0 o
        // ON DELETE SET NULL esvaziaria o campo desses registros em silêncio,
        // sem como recuperar — para esse caso existe o arquivamento.
        const usage = await countUsage(type, item.id);
        if (usage > 0) {
          return NextResponse.json({
            error: `${usage} registro(s) usam esta ${noun}. Arquive em vez de excluir — assim eles continuam mostrando a classificação.`,
            usageCount: usage
          }, { status: 409 });
        }

        await query(`DELETE FROM public.${table} WHERE id = $1`, [item.id]);
        return NextResponse.json({ success: true });
      }

      const label = (item.label || '').trim();
      if (!label) return NextResponse.json({ error: 'O nome não pode ficar vazio.' }, { status: 400 });

      // Sem id = criação; com id = renomeação.
      const res = item.id
        ? await query(
            `UPDATE public.${table} SET label = $2 WHERE id = $1 RETURNING id, label, archived_at`,
            [item.id, label]
          )
        : await query(
            `INSERT INTO public.${table} (label) VALUES ($1) RETURNING id, label, archived_at`,
            [label]
          );

      if (res.rowCount === 0) return NextResponse.json({ error: 'Item não encontrado.' }, { status: 404 });
      const saved = res.rows[0];
      return NextResponse.json({
        id: saved.id, label: saved.label,
        isArchived: saved.archived_at !== null, archivedAt: saved.archived_at
      });
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
      // RETURNING para o chamador poder conferir o que ficou gravado — a tela
      // de Configurações compara o SLA persistido com o que enviou antes de
      // dar a operação como concluída.
      const res = id
        ? await query(
            `INSERT INTO public.config_priorities (id, label, sla_hours, color)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO UPDATE SET
               label = EXCLUDED.label,
               sla_hours = EXCLUDED.sla_hours,
               color = EXCLUDED.color
             RETURNING *`,
            [id, priority.label, priority.slaHours, priority.color]
          )
        : await query(
            `INSERT INTO public.config_priorities (label, sla_hours, color)
             VALUES ($1, $2, $3) RETURNING *`,
            [priority.label, priority.slaHours, priority.color]
          );
      return NextResponse.json(res.rows[0]);
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
