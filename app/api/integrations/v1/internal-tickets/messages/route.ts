import { query } from '@/lib/db';
import {
  authenticateApiKey,
  isAuthError,
  authErrorResponse,
  requireScope,
  requireAnyScope,
  integrationJson,
  integrationError,
} from '@/lib/integration-auth';
import { logAudit } from '@/lib/audit-log';
import { externalizeInlineImages } from '@/lib/services/attachment-storage';
import { queueInternalTicketChangeEmail } from '@/lib/services/internal-ticket-notifications';

// Notas de ticket interno (internal_ticket_messages), como recurso próprio —
// mesmo padrão "flat" das demais rotas v1 (ver training-stages: sub-item de
// companies, mas em arquivo/caminho próprio, nunca rota dinâmica aninhada).
//
// Sem is_visible_to_customer aqui (ticket interno não tem isso) — TODA nota é
// devolvida. Esta rota é o caminho para o sistema externo "ver as notas
// internas também, além de adicionar novas notas" (pedido explícito do
// usuário) sem precisar reler o ticket inteiro via GET /internal-tickets?id=.

function serializeInternalMessage(row: any) {
  return {
    id: row.id,
    internalTicketId: row.internal_ticket_id,
    authorId: row.author_id,
    content: row.content,
    type: row.type,
    attachments: row.attachments_data || [],
    createdAt: row.created_at,
  };
}

export async function GET(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);
  const scopeError = requireAnyScope(auth, ['internal-tickets:read', 'internal-tickets:write']);
  if (scopeError) return scopeError;

  const { searchParams } = new URL(request.url);
  const internalTicketId = searchParams.get('internalTicketId');
  if (!internalTicketId) {
    return integrationError(auth, 'VALIDATION_ERROR', 'Parâmetro internalTicketId é obrigatório.', 400);
  }

  try {
    const ticketCheck = await query('SELECT id FROM public.internal_tickets WHERE id = $1', [internalTicketId]);
    if (ticketCheck.rowCount === 0) {
      return integrationError(auth, 'NOT_FOUND', 'Ticket interno não encontrado.', 404);
    }
    const res = await query(
      `SELECT id, internal_ticket_id, author_id, content, type, attachments_data, created_at
         FROM public.internal_ticket_messages
        WHERE internal_ticket_id = $1
        ORDER BY created_at ASC`,
      [internalTicketId]
    );
    return integrationJson(auth, { data: res.rows.map(serializeInternalMessage), meta: { total: res.rowCount } });
  } catch (error: any) {
    console.error('[integrations/v1/internal-tickets/messages] Erro no GET:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao listar notas do ticket interno.', 500);
  }
}

export async function POST(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);
  const scopeError = requireScope(auth, 'internal-tickets:write');
  if (scopeError) return scopeError;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return integrationError(auth, 'VALIDATION_ERROR', 'JSON inválido.', 400);
  }

  const { internalTicketId, content } = body;
  if (!internalTicketId || !content) {
    return integrationError(auth, 'VALIDATION_ERROR', 'Campos obrigatórios: internalTicketId, content.', 400);
  }

  try {
    const ticketCheck = await query('SELECT id FROM public.internal_tickets WHERE id = $1', [internalTicketId]);
    if (ticketCheck.rowCount === 0) {
      return integrationError(auth, 'NOT_FOUND', 'Ticket interno não encontrado.', 404);
    }
    if (body.authorId) {
      const authorCheck = await query('SELECT id FROM public.profiles WHERE id = $1', [body.authorId]);
      if (authorCheck.rowCount === 0) {
        return integrationError(auth, 'VALIDATION_ERROR', 'authorId informado não existe.', 400);
      }
    }

    // Imagem colada em base64 dentro do HTML vai pro disco, como em toda
    // gravação de texto rico do sistema (ver attachment-storage.ts) — sem
    // isso o base64 infla o banco (foi o que travou produção em 2026-11-11).
    const persistedContent = await externalizeInlineImages(content);

    const res = await query(
      `INSERT INTO public.internal_ticket_messages (internal_ticket_id, author_id, content, type)
       VALUES ($1, $2, $3, 'text')
       RETURNING id, internal_ticket_id, author_id, content, type, attachments_data, created_at`,
      [internalTicketId, body.authorId || null, persistedContent]
    );
    const newMessage = res.rows[0];

    queueInternalTicketChangeEmail({
      internalTicketId,
      actorId: body.authorId || null,
      actorName: `Integração: ${auth.name}`,
      kind: 'note',
      text: persistedContent,
    });

    logAudit({
      actorId: null,
      actorName: `Integração: ${auth.name}`,
      action: 'create',
      entityType: 'internal_ticket',
      entityId: internalTicketId,
      entityLabel: 'Nota via integração',
      changes: { messageId: newMessage.id },
    });

    return integrationJson(auth, { data: serializeInternalMessage(newMessage) }, 201);
  } catch (error: any) {
    console.error('[integrations/v1/internal-tickets/messages] Erro no POST:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao criar nota do ticket interno.', 500);
  }
}
