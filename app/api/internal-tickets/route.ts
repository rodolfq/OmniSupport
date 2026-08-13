import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { computeInternalTicketSla } from '@/lib/sla';
import { persistAttachments } from '@/lib/services/attachment-storage';

// Rota dos tickets internos — criada para tirar o InternalTicketService do
// shim de compatibilidade Supabase (ver lib/services/ticket-service.ts).
//
// Antes, esse serviço montava a operação no client e mandava pro tradutor
// genérico /api/compat/supabase, que virava SQL. Aqui cada operação tem
// escopo fechado: o client não escolhe mais tabela nem coluna.
//
// Sessão é garantida pelo middleware.ts, como nas demais rotas do portal.

function formatId(number: number | null, uuid: string): string {
  return `int-${number ? String(number).padStart(4, '0') : uuid}`;
}

function toInternalTicket(row: any, parentTicketId?: string) {
  return {
    uuid: row.id,
    id: formatId(row.internal_ticket_number, row.id),
    internalTicketNumber: row.internal_ticket_number,
    ...(parentTicketId ? { parentTicketIds: [parentTicketId] } : {}),
    title: row.title,
    teamId: row.team_id,
    internalTeamId: row.internal_team_id,
    assigneeId: row.assignee_id,
    priority: row.priority,
    tags: row.tags || [],
    creatorId: row.creator_id,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    slaLimit: row.sla_limit,
    expectedPublishDate: row.expected_publish_date,
    hotfixId: row.hotfix_id,
    effortId: row.effort_id,
    outcomeId: row.outcome_id
  };
}

function toMessage(row: any) {
  return {
    id: row.id,
    ticketId: row.internal_ticket_id,
    senderId: row.author_id,
    text: row.content,
    timestamp: row.created_at,
    // Ticket interno nunca é visível ao cliente — o campo existe só porque a
    // interface Message é compartilhada com as mensagens de chamado.
    isVisibleToCustomer: false,
    type: row.type,
    attachments: row.attachments_data || []
  };
}

// Usuário da sessão, para os recortes "meus" e "das minhas equipes" serem
// decididos no servidor. O client mandava esses ids na query pelo shim; passar
// a derivá-los do cookie evita que trocar o parâmetro liste o que não é seu.
async function getSessionUser(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  if (!token) return null;
  const decoded = await verifyJWT(token);
  if (!decoded?.id) return null;
  const res = await query(
    'SELECT id, role, internal_team_ids FROM public.profiles WHERE id = $1',
    [decoded.id]
  );
  return res.rows[0] || null;
}

/**
 * Escopo de equipe do usuário — decidido AQUI, no servidor.
 *
 * Antes, o recorte por equipe dependia de a TELA mandar `scope=my-teams`, e ela
 * só mandava quando o usuário não tinha `internal:view_all`. Ou seja: bastava
 * chamar a rota sem esse parâmetro para receber os tickets de todas as
 * equipes. Testado: um usuário sem equipe nenhuma recebia a lista inteira, e o
 * `detail` entregava qualquer ticket pelo número (int-0001 é enumerável).
 *
 * Regra do produto: só quem pertence à equipe do ticket enxerga o ticket.
 *
 * Duas exceções deliberadas:
 *   - `internal:view_all` (e Administrador do sistema) enxerga tudo — é a
 *     permissão que existe justamente para isso;
 *   - responsável e criador enxergam o próprio ticket mesmo fora da equipe.
 *     Sem isso, alguém atribuído a um ticket de outra equipe não conseguiria
 *     abrir o que precisa resolver.
 */
async function getEscopoEquipes(actor: any): Promise<{ verTudo: boolean; equipes: string[] }> {
  if (!actor) return { verTudo: false, equipes: [] };
  if (actor.role === 'Administrador') return { verTudo: true, equipes: [] };

  const res = await query(
    `SELECT COALESCE(rp.permissions, '{}'::text[]) AS permissions
       FROM public.profiles p
       LEFT JOIN public.role_permissions rp ON rp.id = p.access_profile_id
      WHERE p.id = $1`,
    [actor.id]
  );
  const permissions: string[] = res.rows[0]?.permissions || [];
  if (permissions.includes('internal:view_all')) return { verTudo: true, equipes: [] };

  return { verTudo: false, equipes: actor.internal_team_ids || [] };
}

/** Este usuário pode ver ESTE ticket? Usada nas ações que leem um só. */
async function podeVerTicket(actor: any, ticket: any): Promise<boolean> {
  const { verTudo, equipes } = await getEscopoEquipes(actor);
  if (verTudo) return true;
  if (ticket.assignee_id === actor?.id || ticket.creator_id === actor?.id) return true;
  return !!ticket.internal_team_id && equipes.includes(ticket.internal_team_id);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    if (action === 'list') {
      // scope: 'all' (padrão) | 'mine' | 'my-teams'
      const scope = searchParams.get('scope') || 'all';
      const search = (searchParams.get('search') || '').trim();
      const teamId = searchParams.get('teamId');
      const limit = Math.min(Number(searchParams.get('limit')) || 200, 500);

      const conditions: string[] = [];
      const params: any[] = [];

      if (scope === 'mine' || scope === 'my-teams') {
        const user = await getSessionUser(request);
        if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

        if (scope === 'mine') {
          params.push(user.id);
          conditions.push(`(assignee_id = $${params.length} OR creator_id = $${params.length})`);
        } else {
          const teams: string[] = user.internal_team_ids || [];
          // Sem equipe nenhuma, não há o que listar — devolver tudo aqui seria
          // justamente o vazamento que este recorte existe para evitar.
          if (teams.length === 0) return NextResponse.json([]);
          params.push(teams);
          conditions.push(`internal_team_id = ANY($${params.length})`);
        }
      }

      if (teamId) {
        params.push(teamId);
        conditions.push(`internal_team_id = $${params.length}`);
      }
      if (search) {
        params.push(`%${search}%`);
        conditions.push(`title ILIKE $${params.length}`);
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const res = await query(
        `SELECT * FROM public.internal_tickets ${where} ORDER BY updated_at DESC LIMIT ${limit}`,
        params
      );
      // Linha crua (snake_case) de propósito, diferente das outras actions:
      // as telas que consomem esta listagem (dashboard, meus chamados, modal
      // de vincular) já fazem o próprio mapeamento, incluindo campos derivados
      // como displayId e tempo restante de SLA. Devolver camelCase aqui
      // obrigaria a reescrever os três mapeamentos junto — e esta etapa é
      // troca de transporte, não de formato.
      return NextResponse.json(res.rows);
    }

    if (action === 'board') {
      // Listagem paginada da tela de Tickets Internos. Resolve numa ida o que
      // eram CINCO consultas saindo do navegador: a página, a contagem total,
      // os responsáveis, os vínculos com chamado e o número de comentários.
      const page = Math.max(1, Number(searchParams.get('page')) || 1);
      const pageSize = Math.min(Number(searchParams.get('pageSize')) || 20, 100);
      const offset = (page - 1) * pageSize;

      const conditions: string[] = [];
      const params: any[] = [];
      const addCondition = (sql: string, value: any) => {
        params.push(value);
        conditions.push(sql.replace('$?', `$${params.length}`));
      };

      const search = (searchParams.get('search') || '').trim();
      if (search) addCondition('title ILIKE $?', `%${search}%`);
      // team_id é a coluna de TEXTO (nome da equipe), diferente de
      // internal_team_id, que é a FK — a tela filtra pela primeira.
      const teamId = searchParams.get('teamId');
      if (teamId) addCondition('team_id = $?', teamId);
      const assigneeId = searchParams.get('assigneeId');
      if (assigneeId) addCondition('assignee_id = $?', assigneeId);
      const status = searchParams.get('status');
      if (status) addCondition('status = $?', status);
      const priority = searchParams.get('priority');
      if (priority) addCondition('priority = $?', Number(priority));
      const dateFrom = searchParams.get('dateFrom');
      if (dateFrom) addCondition('created_at >= $?', `${dateFrom}T00:00:00`);
      const dateTo = searchParams.get('dateTo');
      if (dateTo) addCondition('created_at <= $?', `${dateTo}T23:59:59`);

      // Recorte por equipe SEMPRE aplicado no servidor, independente do que o
      // cliente pediu. Antes isso dependia de `scope=my-teams` vir na URL — a
      // tela mandava, mas quem chamasse a rota direto sem esse parâmetro
      // recebia os tickets de todas as equipes.
      const boardUser = await getSessionUser(request);
      if (!boardUser) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

      const { verTudo, equipes } = await getEscopoEquipes(boardUser);
      if (!verTudo) {
        // Escrito direto (sem addCondition) porque a condição usa o mesmo
        // parâmetro duas vezes — responsável E criador —, e o ajudante só
        // sabe lidar com um valor por condição.
        //
        // Responsável/criador entram no OU de propósito: quem foi atribuído a
        // um ticket de outra equipe precisa continuar enxergando o que tem de
        // resolver.
        params.push(boardUser.id);
        const pUser = `$${params.length}`;
        if (equipes.length === 0) {
          conditions.push(`(assignee_id = ${pUser} OR creator_id = ${pUser})`);
        } else {
          params.push(equipes);
          conditions.push(
            `(internal_team_id = ANY($${params.length}) OR assignee_id = ${pUser} OR creator_id = ${pUser})`
          );
        }
      }

      // Concluídos ficam FORA por padrão — mesmo comportamento da lista de
      // chamados. Sem isso a tela abre carregando todo o histórico encerrado,
      // que é justamente o que ninguém procura ao abrir "Todos".
      //
      // Duas exceções, ambas intencionais:
      //   - filtro de status explícito (o usuário escolheu "Concluído"): esse
      //     manda, senão escolher o status não traria nada;
      //   - includeClosed=1, para relatórios e para um "mostrar encerrados".
      //
      // A lista de status fechados sai de config_statuses (is_closed), não de
      // um rótulo fixo: status é configurável, e amarrar em 'Concluído'
      // quebraria assim que alguém criasse outro status final.
      const includeClosed = searchParams.get('includeClosed') === '1';
      if (!includeClosed && !status) {
        const fechadosRes = await query(
          `SELECT label FROM public.config_statuses WHERE scope = 'internal_ticket' AND is_closed = true`
        );
        const fechados = fechadosRes.rows.map((r: any) => r.label);
        if (fechados.length > 0) {
          params.push(fechados);
          conditions.push(`status <> ALL($${params.length})`);
        }
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const [rowsRes, countRes] = await Promise.all([
        query(
          `SELECT * FROM public.internal_tickets ${where}
            ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
          params
        ),
        query(`SELECT COUNT(*)::int AS total FROM public.internal_tickets ${where}`, params)
      ]);

      const rows = rowsRes.rows;
      const pageIds = rows.map((r: any) => r.id);
      const assigneeIds = [...new Set(rows.map((r: any) => r.assignee_id).filter(Boolean))];

      const [assigneesRes, linksRes, labelsRes, commentsRes] = await Promise.all([
        assigneeIds.length
          ? query('SELECT id, name, avatar_thumb_url FROM public.profiles WHERE id = ANY($1)', [assigneeIds])
          : Promise.resolve({ rows: [] as any[] }),
        query('SELECT ticket_id, internal_ticket_id FROM public.ticket_internal_links'),
        query('SELECT id, public_ticket_number FROM public.tickets'),
        pageIds.length
          ? query(
              `SELECT internal_ticket_id, COUNT(*)::int AS total
                 FROM public.internal_ticket_messages
                WHERE internal_ticket_id = ANY($1)
                GROUP BY internal_ticket_id`,
              [pageIds]
            )
          : Promise.resolve({ rows: [] as any[] })
      ]);

      const assignees: Record<string, { name: string; avatarThumbUrl: string | null }> = {};
      for (const a of assigneesRes.rows) {
        assignees[a.id] = { name: a.name, avatarThumbUrl: a.avatar_thumb_url };
      }
      const ticketLabels: Record<string, string> = {};
      for (const t of labelsRes.rows) {
        ticketLabels[t.id] = `#${t.public_ticket_number || String(t.id).slice(0, 8)}`;
      }
      // A contagem agora vem agrupada no SQL — antes o navegador recebia uma
      // linha por mensagem só para contá-las em memória.
      const commentCounts: Record<string, number> = {};
      for (const c of commentsRes.rows) commentCounts[c.internal_ticket_id] = c.total;

      return NextResponse.json({
        tickets: rows,
        total: countRes.rows[0]?.total || 0,
        assignees,
        links: linksRes.rows,
        ticketLabels,
        commentCounts
      });
    }

    if (action === 'detail') {
      // Aceita o id interno ou o número formatado (int-0001), como a URL da
      // tela de detalhe. Devolve numa ida o ticket, os chamados vinculados e
      // os nomes de responsável/criador — antes eram quatro consultas soltas
      // saindo do navegador.
      const ref = (searchParams.get('ref') || '').trim();
      if (!ref) return NextResponse.json({ error: 'ref é obrigatório.' }, { status: 400 });

      const isFormatted = ref.startsWith('int-');
      const ticketRes = isFormatted
        ? await query('SELECT * FROM public.internal_tickets WHERE internal_ticket_number = $1', [
            parseInt(ref.replace('int-', ''), 10)
          ])
        : await query('SELECT * FROM public.internal_tickets WHERE id = $1', [ref]);

      if (ticketRes.rowCount === 0) return NextResponse.json({ error: 'Ticket interno não encontrado.' }, { status: 404 });
      const row = ticketRes.rows[0];

      // Checagem de equipe: sem ela, qualquer sessão lia qualquer ticket pelo
      // número, que é sequencial e portanto trivial de enumerar (int-0001,
      // int-0002...). Devolve 404 e não 403 de propósito — 403 confirmaria
      // que o ticket existe, e a existência já é informação.
      const detailUser = await getSessionUser(request);
      if (!(await podeVerTicket(detailUser, row))) {
        return NextResponse.json({ error: 'Ticket interno não encontrado.' }, { status: 404 });
      }

      const [linkedRes, profilesRes] = await Promise.all([
        query(
          `SELECT t.id, t.title, t.public_ticket_number
             FROM public.ticket_internal_links l
             JOIN public.tickets t ON t.id = l.ticket_id
            WHERE l.internal_ticket_id = $1`,
          [row.id]
        ),
        query('SELECT id, name FROM public.profiles WHERE id = ANY($1)', [
          [row.assignee_id, row.creator_id].filter(Boolean)
        ])
      ]);

      const names = new Map(profilesRes.rows.map((p: any) => [p.id, p.name]));
      return NextResponse.json({
        ticket: row,
        linkedTickets: linkedRes.rows.map((t: any) => ({
          id: t.id,
          title: t.title,
          ticketNumber: t.public_ticket_number
        })),
        assigneeName: row.assignee_id ? names.get(row.assignee_id) || null : null,
        creatorName: row.creator_id ? names.get(row.creator_id) || null : null
      });
    }

    if (action === 'by-parent') {
      const ticketId = searchParams.get('ticketId');
      if (!ticketId) return NextResponse.json({ error: 'ticketId é obrigatório.' }, { status: 400 });

      // Um JOIN só, em vez das duas idas que o caminho antigo fazia (buscar
      // os vínculos, depois buscar os tickets pelos ids).
      const res = await query(
        `SELECT it.*
         FROM public.ticket_internal_links l
         JOIN public.internal_tickets it ON it.id = l.internal_ticket_id
         WHERE l.ticket_id = $1
         ORDER BY it.internal_ticket_number ASC`,
        [ticketId]
      );
      return NextResponse.json(res.rows.map(r => toInternalTicket(r, ticketId)));
    }

    if (action === 'messages') {
      const internalTicketId = searchParams.get('internalTicketId');
      if (!internalTicketId) return NextResponse.json({ error: 'internalTicketId é obrigatório.' }, { status: 400 });

      // Mesma trava do detail: sem ela, bloquear só o `detail` seria inútil —
      // dava para ler a discussão inteira do ticket por aqui.
      const msgUser = await getSessionUser(request);
      const donoRes = await query('SELECT internal_team_id, assignee_id, creator_id FROM public.internal_tickets WHERE id = $1', [internalTicketId]);
      if (donoRes.rowCount === 0 || !(await podeVerTicket(msgUser, donoRes.rows[0]))) {
        return NextResponse.json({ error: 'Ticket interno não encontrado.' }, { status: 404 });
      }

      const res = await query(
        `SELECT * FROM public.internal_ticket_messages
         WHERE internal_ticket_id = $1
         ORDER BY created_at DESC`,
        [internalTicketId]
      );
      return NextResponse.json(res.rows.map(toMessage));
    }

    return NextResponse.json({ error: `Action não suportada: ${action}` }, { status: 400 });
  } catch (error: any) {
    console.error('[internal-tickets GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'save') {
      const { ticket, parentTicketId } = body;
      if (!ticket?.title) return NextResponse.json({ error: 'O título é obrigatório.' }, { status: 400 });
      if (!ticket?.creatorId) return NextResponse.json({ error: 'creatorId é obrigatório.' }, { status: 400 });

      const priorityRes = await query('SELECT label, sla_hours FROM public.config_priorities');
      const priority = ticket.priority || 1;

      if (ticket.uuid) {
        // O prazo é recalculado a cada gravação, ancorado na CRIAÇÃO do
        // ticket (não em "agora"): sem isso, mudar a prioridade deixaria o
        // prazo congelado no valor calculado quando ele nasceu. Mesma regra do
        // handleUpdateTicket em app/(portal)/internal-tickets/[id]/page.tsx.
        const slaLimit = computeInternalTicketSla(
          priority,
          ticket.createdAt || new Date().toISOString(),
          priorityRes.rows
        );
        const res = await query(
          `UPDATE public.internal_tickets
              SET title = $1, team_id = $2, internal_team_id = $3, assignee_id = $4,
                  priority = $5, tags = $6, creator_id = $7, description = $8,
                  sla_limit = $9, updated_at = NOW()
            WHERE id = $10
        RETURNING id, internal_ticket_number`,
          [
            ticket.title,
            ticket.teamId || null,
            ticket.internalTeamId || null,
            ticket.assigneeId || null,
            priority,
            ticket.tags || [],
            ticket.creatorId,
            ticket.description || '',
            slaLimit,
            ticket.uuid
          ]
        );
        if (res.rowCount === 0) return NextResponse.json({ error: 'Ticket interno não encontrado.' }, { status: 404 });
        const row = res.rows[0];
        return NextResponse.json({ uuid: row.id, id: formatId(row.internal_ticket_number, row.id) });
      }

      const slaLimit = computeInternalTicketSla(priority, new Date().toISOString(), priorityRes.rows);

      // O número sai de MAX+1 calculado DENTRO do INSERT. O caminho antigo
      // lia o maior número numa consulta e escrevia em outra: duas criações
      // simultâneas pegavam o mesmo número e a segunda batia no UNIQUE.
      //
      // Não se usa o DEFAULT nextval('internal_ticket_seq') da coluna de
      // propósito: a sequência ficou para trás dos números já gravados (há
      // registros como 111 e 11111 vindos de criação manual), então confiar
      // nela hoje geraria colisão.
      const res = await query(
        `INSERT INTO public.internal_tickets
           (title, team_id, internal_team_id, assignee_id, priority, tags, creator_id, description,
            sla_limit, internal_ticket_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                 (SELECT COALESCE(MAX(internal_ticket_number), 0) + 1 FROM public.internal_tickets))
         RETURNING id, internal_ticket_number`,
        [
          ticket.title,
          ticket.teamId || null,
          ticket.internalTeamId || null,
          ticket.assigneeId || null,
          priority,
          ticket.tags || [],
          ticket.creatorId,
          ticket.description || '',
          slaLimit
        ]
      );

      const row = res.rows[0];

      if (parentTicketId) {
        // ON CONFLICT DO NOTHING no lugar do "ignora se a mensagem contém
        // 'duplicate'" que o caminho antigo fazia — o vínculo já existir é
        // resultado esperado, não erro a ser interpretado por texto.
        await query(
          `INSERT INTO public.ticket_internal_links (ticket_id, internal_ticket_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [parentTicketId, row.id]
        );
      }

      return NextResponse.json({ uuid: row.id, id: formatId(row.internal_ticket_number, row.id) });
    }

    if (action === 'update') {
      // Edição pela tela de detalhe. SET dinâmico pelas chaves enviadas:
      // ausente não toca a coluna, null limpa — mesma semântica do PUT de
      // chamado. `save` não serve aqui porque não cobre status, prazo,
      // hotfix nem a classificação.
      const { id, fields } = body;
      if (!id || !fields) return NextResponse.json({ error: 'id e fields são obrigatórios.' }, { status: 400 });

      // Escrita também passa pela trava de equipe: ler foi bloqueado acima, e
      // sem esta checagem ainda daria para ALTERAR (status, responsável) um
      // ticket de outra equipe sem nunca conseguir vê-lo.
      const updUser = await getSessionUser(request);
      const atualRes = await query(
        'SELECT internal_team_id, assignee_id, creator_id FROM public.internal_tickets WHERE id = $1',
        [id]
      );
      if (atualRes.rowCount === 0 || !(await podeVerTicket(updUser, atualRes.rows[0]))) {
        return NextResponse.json({ error: 'Ticket interno não encontrado.' }, { status: 404 });
      }

      const COLUMNS: Record<string, string> = {
        title: 'title',
        description: 'description',
        teamId: 'team_id',
        internalTeamId: 'internal_team_id',
        assigneeId: 'assignee_id',
        status: 'status',
        priority: 'priority',
        tags: 'tags',
        slaLimit: 'sla_limit',
        expectedPublishDate: 'expected_publish_date',
        hotfixId: 'hotfix_id',
        effortId: 'effort_id',
        outcomeId: 'outcome_id'
      };
      const ARRAY_FIELDS = new Set(['tags']);

      const sets: string[] = [];
      const params: any[] = [];
      for (const [key, column] of Object.entries(COLUMNS)) {
        if (!(key in fields) || fields[key] === undefined) continue;
        const raw = fields[key];
        params.push(ARRAY_FIELDS.has(key) ? (raw ?? []) : (raw === '' ? null : (raw ?? null)));
        sets.push(`${column} = $${params.length}`);
      }
      if (sets.length === 0) return NextResponse.json({ error: 'Nenhum campo informado.' }, { status: 400 });

      sets.push('updated_at = NOW()');
      params.push(id);
      const res = await query(
        `UPDATE public.internal_tickets SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`,
        params
      );
      if (res.rowCount === 0) return NextResponse.json({ error: 'Ticket interno não encontrado.' }, { status: 404 });
      return NextResponse.json({ success: true });
    }

    if (action === 'link') {
      const { ticketId, internalTicketId } = body;
      if (!ticketId || !internalTicketId) {
        return NextResponse.json({ error: 'ticketId e internalTicketId são obrigatórios.' }, { status: 400 });
      }
      await query(
        `INSERT INTO public.ticket_internal_links (ticket_id, internal_ticket_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [ticketId, internalTicketId]
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'message') {
      const { internalTicketId, message } = body;
      // Comentar num ticket que não se pode ver seria um jeito de escrever
      // dentro da discussão de outra equipe.
      if (internalTicketId) {
        const msgUser = await getSessionUser(request);
        const donoRes = await query(
          'SELECT internal_team_id, assignee_id, creator_id FROM public.internal_tickets WHERE id = $1',
          [internalTicketId]
        );
        if (donoRes.rowCount === 0 || !(await podeVerTicket(msgUser, donoRes.rows[0]))) {
          return NextResponse.json({ error: 'Ticket interno não encontrado.' }, { status: 404 });
        }
      }
      if (!internalTicketId || !message) {
        return NextResponse.json({ error: 'internalTicketId e message são obrigatórios.' }, { status: 400 });
      }

      // Anexo chega como data: URL e vai pro volume aqui — o caminho antigo
      // ganhava isso de graça pelo tradutor. Sem esta linha, o base64 voltaria
      // a inflar o banco (ver lib/services/attachment-storage.ts).
      const attachments = await persistAttachments(message.attachments || []);

      const res = await query(
        `INSERT INTO public.internal_ticket_messages
           (internal_ticket_id, author_id, content, type, attachments_data)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          internalTicketId,
          message.senderId || null,
          message.text,
          message.type || 'text',
          JSON.stringify(attachments)
        ]
      );
      return NextResponse.json(toMessage(res.rows[0]));
    }

    return NextResponse.json({ error: `Action não suportada: ${action}` }, { status: 400 });
  } catch (error: any) {
    console.error('[internal-tickets POST]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticketId = searchParams.get('ticketId');
  const internalTicketId = searchParams.get('internalTicketId');

  if (!ticketId || !internalTicketId) {
    return NextResponse.json({ error: 'ticketId e internalTicketId são obrigatórios.' }, { status: 400 });
  }

  try {
    // Desfaz só o vínculo — o ticket interno continua existindo, porque ele
    // pode estar ligado a outros chamados (N:N).
    await query(
      'DELETE FROM public.ticket_internal_links WHERE ticket_id = $1 AND internal_ticket_id = $2',
      [ticketId, internalTicketId]
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[internal-tickets DELETE]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
