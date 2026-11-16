import { query } from '../db';

// Menções com @ nas notas do ticket interno (2026-11-16).
//
// O editor grava <span data-type="mention" data-id="<uuid>" ...> (ver
// components/rich-editor-mention.ts). Aqui o servidor descobre quem foi
// marcado — nunca confia numa lista vinda do navegador — e o marca como
// SEGUIDOR do ticket (internal_tickets.follower_ids): passa a receber por e-mail
// todas as atualizações, até o ticket fechar (ver internal-ticket-notifications.ts).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids marcados no HTML (sem repetição, só formato de uuid). */
export function extractMentionIds(html: string | null | undefined): string[] {
  if (!html) return [];
  const ids = new Set<string>();
  const tags = html.match(/<span\b[^>]*data-type="mention"[^>]*>/gi) || [];
  for (const tag of tags) {
    const id = /data-id="([^"]+)"/i.exec(tag)?.[1];
    if (id && UUID.test(id)) ids.add(id.toLowerCase());
  }
  return [...ids];
}

/**
 * Filtra para gente da equipe (mesmo critério do Responsável) e acrescenta como
 * seguidor do ticket. Devolve os ids válidos marcados. Nunca lança: menção é
 * complemento da nota, falhar aqui não pode desfazer a nota já gravada.
 */
export async function registerMentions(internalTicketId: string, html: string | null | undefined): Promise<string[]> {
  const raw = extractMentionIds(html);
  if (raw.length === 0) return [];
  try {
    const valid = (await query(
      `SELECT id FROM public.profiles WHERE id = ANY($1::uuid[]) AND role IN ('Administrador','Equipe','Time Interno')`,
      [raw]
    )).rows.map((r: any) => r.id as string);
    if (valid.length === 0) return [];
    await query(
      `UPDATE public.internal_tickets
          SET follower_ids = ARRAY(SELECT DISTINCT unnest(COALESCE(follower_ids, '{}') || $2::uuid[]))
        WHERE id = $1`,
      [internalTicketId, valid]
    );
    return valid;
  } catch (err: any) {
    // 42703: coluna follower_ids ainda não existe (código publicado antes da
    // migration internal_ticket_followers.sql) — a menção ainda notifica.
    if (err?.code !== '42703') console.error('[mentions] Falha ao registrar seguidores:', err);
    return raw;
  }
}
