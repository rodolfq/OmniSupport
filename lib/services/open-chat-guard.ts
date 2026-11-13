import { query } from '@/lib/db';
import { phoneVariants } from '@/lib/services/pyvon-service';

// Trava de "iniciar conversa" (2026-11-12, pedido do usuário): ao tentar abrir
// um chat novo com um contato que JÁ tem conversa aberta, o sistema não abre
// outra e avisa quem está com ela. Vale para qualquer canal — WhatsApp (Pyvon)
// ou portal — e substitui a decisão de 2026-10-06 de permitir uma conversa de
// WhatsApp em paralelo a uma do portal.
//
// O contato é reconhecido pelo telefone (todas as variantes: com/sem 55, com/
// sem o 9º dígito — mesmas de phoneVariants) e, quando informado, pelo perfil
// vinculado (conversa do portal guarda customer_id, nem sempre o telefone).
// Roda ANTES de qualquer envio ao Pyvon: barrar depois deixaria o template
// enviado ao cliente com a conversa recusada.

export interface OpenChatConflict {
  sessionId: string;
  publicSessionNumber: number | null;
  channel: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
}

export async function findOpenChatForContact(params: {
  phone?: string | null;
  profileIds?: (string | null | undefined)[];
}): Promise<OpenChatConflict | null> {
  const variants = params.phone ? phoneVariants(params.phone) : [];
  const profileIds = (params.profileIds || []).filter((id): id is string => !!id);
  if (!variants.length && !profileIds.length) return null;

  const res = await query(
    `SELECT s.id, s.public_session_number, s.channel, s.assignee_id, p.name AS assignee_name
       FROM public.chat_sessions s
       LEFT JOIN public.profiles p ON p.id = s.assignee_id
      WHERE s.status <> 'closed'
        AND (
          regexp_replace(COALESCE(s.customer_phone, ''), '\\D', '', 'g') = ANY($1::text[])
          OR s.customer_id = ANY($2::uuid[])
        )
      ORDER BY s.updated_at DESC
      LIMIT 1`,
    [variants, profileIds]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    sessionId: row.id,
    publicSessionNumber: row.public_session_number ?? null,
    channel: row.channel ?? null,
    assigneeId: row.assignee_id ?? null,
    assigneeName: row.assignee_name ?? null
  };
}

export function openChatConflictMessage(conflict: OpenChatConflict, actorId: string): string {
  const numero = conflict.publicSessionNumber ? ` (#${conflict.publicSessionNumber})` : '';
  const canal = conflict.channel === 'widget' ? ' pelo portal' : conflict.channel === 'pyvon' ? ' pelo WhatsApp' : '';
  if (conflict.assigneeId && conflict.assigneeId === actorId) {
    return `Você já tem uma conversa aberta${canal} com este contato${numero}. Continue o atendimento nela em vez de abrir outra.`;
  }
  if (conflict.assigneeName) {
    return `Já existe uma conversa aberta${canal} com este contato${numero}, em atendimento por ${conflict.assigneeName}. Não é possível abrir outra enquanto ela estiver aberta.`;
  }
  return `Já existe uma conversa aberta${canal} com este contato${numero}, aguardando na fila. Não é possível abrir outra enquanto ela estiver aberta.`;
}
