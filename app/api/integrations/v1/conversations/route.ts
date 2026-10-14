import { query } from '@/lib/db';
import {
  authenticateApiKey,
  isAuthError,
  authErrorResponse,
  requireScope,
  integrationJson,
  integrationError,
} from '@/lib/integration-auth';

// Leitura de conversas (sessões de chat, incluindo WhatsApp) para a
// plataforma externa. chat_sessions só guarda customer_id/assignee_id
// diretamente — nome de quem atendeu e empresa do cliente vêm de JOIN com
// profiles/companies (ver ENRICHMENT_JOINS).
//
// Boa prática de consulta: colunas explícitas, não `SELECT *` — evita que uma
// coluna nova/interna (ex.: awaiting_survey_until, um detalhe de timing da
// pesquisa de satisfação) vaze pra fora sem decisão deliberada.
const SESSION_COLUMNS = `
  id, type, customer_id, customer_name, customer_phone, assignee_id, queue_id,
  status, ticket_id, ticket_number, tags, created_at, updated_at, last_message_at
`;

// Enriquecimento adicionado a pedido do usuário (2026-10-12): nome de quem
// atendeu e empresa do cliente — antes só o `assigneeId`/filtro por
// `companyId` chegavam, sem o nome resolvido. Mesmos dois JOINs em toda
// consulta (detalhe e lista), pra não duplicar a lógica — `cust`/`co`
// também substituem o JOIN que só existia quando `companyId` era usado
// como filtro (ver mais abaixo).
const ENRICHMENT_JOINS = `
  LEFT JOIN public.profiles assignee ON assignee.id = cs.assignee_id
  LEFT JOIN public.profiles cust ON cust.id = cs.customer_id
  LEFT JOIN public.companies co ON co.id = cust.company_id
`;
const ENRICHMENT_COLUMNS = `assignee.name AS assignee_name, co.id AS company_id, co.name AS company_name`;

// Compara nome de tag sem diferenciar maiúscula/minúscula nem acento (mesma
// função de app/api/integrations/v1/training-conversations/route.ts — feita em
// JS porque o lower() do Postgres depende do locale do banco).
function normalizeLabel(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

function serializeSession(row: any, labelById: Map<string, string>) {
  return {
    id: row.id,
    type: row.type,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name ?? null,
    queueId: row.queue_id,
    status: row.status,
    ticketId: row.ticket_id,
    ticketNumber: row.ticket_number,
    // Resolvido pra {id,label} (pedido do usuário, 2026-10-14) — chat_sessions.tags
    // só guarda o ID, inútil sozinho pra quem consome de fora pra analisar
    // categorização. Mesmo formato de /api/integrations/v1/training-conversations.
    // Tag apagada do cadastro depois some da lista, sem erro.
    tags: ((row.tags || []) as string[])
      .filter(id => labelById.has(id))
      .map(id => ({ id, label: labelById.get(id) as string }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
    // null quando o contato não está vinculado a um cadastro com empresa
    // (ex.: WhatsApp ainda não vinculado) — mesma regra do endpoint de
    // training-conversations.
    company: row.company_id ? { id: row.company_id, name: row.company_name } : null,
  };
}

function serializeMessage(row: any) {
  const metadata = row.metadata || {};
  return {
    id: row.id,
    sessionId: row.session_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    text: row.text,
    type: row.type,
    attachments: metadata.attachments || [],
    createdAt: row.created_at,
  };
}

export async function GET(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);
  const scopeError = requireScope(auth, 'conversations:read');
  if (scopeError) return scopeError;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  try {
    const tagCatalogRes = await query(`SELECT id::text AS id, label FROM public.config_tags WHERE domain = 'chat'`);
    const labelById = new Map<string, string>(tagCatalogRes.rows.map((t: any) => [t.id, t.label]));

    if (id) {
      const sessionCols = SESSION_COLUMNS.split(',').map(c => `cs.${c.trim()}`).join(', ');
      const sessionRes = await query(
        `SELECT ${sessionCols}, ${ENRICHMENT_COLUMNS}
           FROM public.chat_sessions cs
           ${ENRICHMENT_JOINS}
          WHERE cs.id = $1`,
        [id]
      );
      if (sessionRes.rowCount === 0) {
        return integrationError(auth, 'NOT_FOUND', 'Conversa não encontrada.', 404);
      }
      // FALTAVA este filtro: chat_messages.type inclui 'internal' (nota
      // trocada entre atendentes dentro da própria conversa, não visível ao
      // cliente) — sem excluir, essa API vazava nota interna pra fora, a
      // mesma categoria de problema que o endpoint de chamados já evitava.
      const messagesRes = await query(
        `SELECT id, session_id, sender_id, sender_name, text, type, metadata, created_at
           FROM public.chat_messages
          WHERE session_id = $1 AND type != 'internal'
          ORDER BY created_at ASC`,
        [id]
      );
      return integrationJson(auth, {
        data: {
          ...serializeSession(sessionRes.rows[0], labelById),
          messages: messagesRes.rows.map(serializeMessage),
        },
      });
    }

    const companyId = searchParams.get('companyId');
    const customerId = searchParams.get('customerId');
    const customerPhone = searchParams.get('customerPhone');
    const status = searchParams.get('status');
    const assigneeId = searchParams.get('assigneeId');
    const queueId = searchParams.get('queueId');
    const ticketId = searchParams.get('ticketId');
    // Qualquer uma das tags bater já inclui a conversa (overlap, não exige todas).
    const tags = searchParams.get('tags');
    // Mesmo padrão de sincronização incremental do endpoint de chamados.
    const updatedSince = searchParams.get('updatedSince');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 500);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    const conditions: string[] = [];
    const params: any[] = [];
    if (companyId) {
      // JOIN de empresa agora é sempre presente (ENRICHMENT_JOINS, pro nome
      // da empresa ir em toda resposta) — o filtro só usa o alias `co` que já
      // existe, sem precisar de um JOIN à parte como antes.
      params.push(companyId);
      conditions.push(`co.id = $${params.length}`);
    }
    if (customerId) {
      params.push(customerId);
      conditions.push(`cs.customer_id = $${params.length}`);
    }
    if (customerPhone) {
      params.push(`%${customerPhone.replace(/\D/g, '')}%`);
      conditions.push(`regexp_replace(cs.customer_phone, '\\D', '', 'g') LIKE $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`cs.status = $${params.length}`);
    }
    if (assigneeId) {
      params.push(assigneeId);
      conditions.push(`cs.assignee_id = $${params.length}`);
    }
    if (queueId) {
      params.push(queueId);
      conditions.push(`cs.queue_id = $${params.length}`);
    }
    if (ticketId) {
      params.push(ticketId);
      conditions.push(`cs.ticket_id = $${params.length}`);
    }
    if (tags) {
      // Antes comparava contra o ID cru (que esta API nunca expôs em lugar
      // nenhum pra quem integra adivinhar) — passou a aceitar o NOME da tag,
      // mesmo padrão de training-conversations: resolve por label (sem
      // diferenciar maiúscula/acento) e devolve 400 com a lista válida se
      // algum nome não bater com nenhuma tag de domain='chat' cadastrada.
      const wanted = tags.split(',').map(normalizeLabel).filter(Boolean);
      if (wanted.length) {
        const known = new Map<string, string>(tagCatalogRes.rows.map((t: any) => [normalizeLabel(t.label), t.id]));
        const unknown = wanted.filter(w => !known.has(w));
        if (unknown.length > 0) {
          return integrationError(
            auth,
            'VALIDATION_ERROR',
            `Tag desconhecida no parâmetro "tags". Tags disponíveis: ${tagCatalogRes.rows.map((t: any) => t.label).join(', ') || '(nenhuma cadastrada)'}.`,
            400
          );
        }
        const ids = wanted.map(w => known.get(w) as string);
        params.push(ids);
        conditions.push(`cs.tags && $${params.length}::text[]`);
      }
    }
    if (updatedSince) {
      const parsed = new Date(updatedSince);
      if (Number.isNaN(parsed.getTime())) {
        return integrationError(auth, 'VALIDATION_ERROR', 'updatedSince precisa ser uma data ISO 8601 válida.', 400);
      }
      params.push(parsed.toISOString());
      conditions.push(`cs.updated_at >= $${params.length}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(
      `SELECT COUNT(*)::int AS total FROM public.chat_sessions cs ${ENRICHMENT_JOINS} ${whereClause}`,
      params
    );
    const total = countRes.rows[0]?.total ?? 0;

    const listParams = [...params, limit, offset];
    const sessionCols = SESSION_COLUMNS.split(',').map(c => `cs.${c.trim()}`).join(', ');
    const res = await query(
      `SELECT ${sessionCols}, ${ENRICHMENT_COLUMNS} FROM public.chat_sessions cs
       ${ENRICHMENT_JOINS}
       ${whereClause}
       ORDER BY cs.created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );
    return integrationJson(auth, {
      data: res.rows.map(row => serializeSession(row, labelById)),
      meta: { limit, offset, total, hasMore: offset + res.rows.length < total },
    });
  } catch (error: any) {
    console.error('[integrations/v1/conversations] Erro no GET:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao listar conversas.', 500);
  }
}
