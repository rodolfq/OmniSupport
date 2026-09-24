import { query } from '../db';

// Mesmo formato de ChatReplyQuote (lib/types.ts) — declarado à mão pra este
// arquivo não puxar o alias "@/" e poder ser exercitado fora do Next.
export interface ReplyQuote {
  messageId: string;
  senderName: string | null;
  text: string;
  kind: 'text' | 'image' | 'audio' | 'video' | 'file';
}

const MAX_QUOTE_TEXT = 200;

/**
 * Monta a citação de uma mensagem A PARTIR DO BANCO (nunca do que o navegador
 * mandou) — o cliente só diz "quero citar a mensagem X"; nome e texto que vão
 * gravados na resposta vêm daqui. A mensagem precisa ser da MESMA conversa e
 * não estar apagada; senão devolve null e a resposta sai sem citação.
 */
export async function resolveReplyQuote(sessionId: string, quotedMessageId: string): Promise<ReplyQuote | null> {
  if (!sessionId || !quotedMessageId) return null;

  const res = await query(
    `SELECT id, sender_name, text, metadata
       FROM public.chat_messages
      WHERE id::text = $1 AND session_id::text = $2 AND deleted_at IS NULL`,
    [quotedMessageId, sessionId]
  );
  const row = res.rows[0];
  if (!row) return null;

  const attachment = Array.isArray(row.metadata?.attachments) ? row.metadata.attachments[0] : undefined;
  let kind: ReplyQuote['kind'] = 'text';
  if (attachment) {
    const type: string = attachment.type || '';
    kind = type.startsWith('image/') ? 'image'
      : type.startsWith('audio/') ? 'audio'
      : type.startsWith('video/') ? 'video'
      : 'file';
  }

  return {
    messageId: row.id,
    senderName: row.sender_name || null,
    text: String(row.text || '').trim().slice(0, MAX_QUOTE_TEXT),
    kind
  };
}
