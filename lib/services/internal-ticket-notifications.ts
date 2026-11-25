import { query } from '../db';
import { EmailService } from './email-service';
import { wrapEmailHtml, ticketRefBlock } from '../email-templates';
import { notifyUser } from './push-service';
import { htmlLinksToText } from '../rich-link';

// Os antigos avisos por e-mail para a EQUIPE INTEIRA do ticket
// (notifyInternalTeamByEmail / handleInternalTicketCreated / Updated) foram
// removidos em 2026-11-13: não eram chamados por nenhuma rota desde a
// mudança abaixo, e a regra do usuário é avisar só criador e responsável.

// ---------------------------------------------------------------------------
// Toda mudança em ticket interno avisa por e-mail o CRIADOR e o RESPONSÁVEL
// do momento (2026-11-12, pedido do usuário) — nota nova, alteração de campo,
// descrição, edição em massa, criação com responsável. Quem fez a mudança não
// recebe. O aviso dentro da plataforma (sininho/toast) sai do polling de
// app/api/notifications/check, que lê as mesmas mensagens gravadas.
//
// Chamado pela rota (app/api/internal-tickets/route.ts) logo depois de gravar
// — fire-and-forget: SMTP desligado/fora do ar nunca atrapalha a gravação.
//
// SEGUIDORES (2026-11-16, pedido do usuário): quem foi marcado com @ numa nota
// (internal_tickets.follower_ids) também recebe o e-mail de toda atualização,
// enquanto o ticket estiver aberto. Com o ticket concluído/fechado deixa de
// receber — só a mudança que FECHA o ticket ainda chega a eles (closingNow),
// pra saberem que terminou. Quem é marcado NESTA nota recebe um e-mail próprio
// ("mencionou você") + push, no lugar do aviso comum.

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Texto da mensagem sem HTML (nota vem do editor rico), em parágrafos.
function textToEmailHtml(text: string): string {
  // Link vira "texto (endereço)" — o e-mail é montado em texto puro aqui.
  const plain = htmlLinksToText(text)
    .replace(/<img[^>]*>/gi, ' [imagem] ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .trim()
    .slice(0, 1500);
  return plain.split(/\n+/).map(l => l.trim()).filter(Boolean)
    .map(l => `<p style="margin:0 0 6px;">${escapeHtml(l)}</p>`).join('');
}

export type InternalTicketChangeKind = 'note' | 'change' | 'created';

export async function notifyInternalTicketChange(params: {
  internalTicketId: string;
  actorId: string | null;
  actorName?: string | null;
  kind: InternalTicketChangeKind;
  text?: string;
  // Nomes dos arquivos anexados à nota — nota só com anexo ia por e-mail
  // sem nada além do título.
  attachmentNames?: string[];
  // Marcados com @ NESTA nota: recebem o aviso "mencionou você" (e-mail + push).
  mentionedIds?: string[];
  // Esta mudança acabou de fechar o ticket — seguidores ainda recebem esta.
  closingNow?: boolean;
  // Só avisa os marcados (edição de nota que acrescentou alguém).
  onlyMentioned?: boolean;
}): Promise<void> {
  const { internalTicketId, actorId, kind } = params;
  let t: any;
  try {
    t = (await query(
      `SELECT it.id, it.internal_ticket_number, it.title, it.creator_id, it.assignee_id, it.status,
              COALESCE(it.follower_ids, '{}') AS follower_ids,
              EXISTS (SELECT 1 FROM public.config_statuses cs
                       WHERE cs.scope = 'internal_ticket' AND cs.is_closed AND cs.label = it.status) AS is_closed
         FROM public.internal_tickets it WHERE it.id = $1`,
      [internalTicketId]
    )).rows[0];
  } catch (err: any) {
    // 42703: follower_ids ainda não existe (código publicado antes da migration).
    if (err?.code !== '42703') throw err;
    t = (await query(
      `SELECT it.id, it.internal_ticket_number, it.title, it.creator_id, it.assignee_id, '{}'::uuid[] AS follower_ids, false AS is_closed
         FROM public.internal_tickets it WHERE it.id = $1`,
      [internalTicketId]
    )).rows[0];
  }
  if (!t) return;

  const mentioned = [...new Set((params.mentionedIds || []).filter(id => id && id !== actorId))];
  const followers: string[] = (!t.is_closed || params.closingNow) ? (t.follower_ids || []) : [];
  const recipientIds = params.onlyMentioned ? [] : [...new Set([t.creator_id, t.assignee_id, ...followers].filter(Boolean) as string[])]
    .filter(id => id !== actorId && !mentioned.includes(id));
  if (recipientIds.length === 0 && mentioned.length === 0) return;
  const peopleRes = await query(`SELECT id, name, email FROM public.profiles WHERE id = ANY($1) AND email IS NOT NULL`, [[...recipientIds, ...mentioned]]);

  let actorName = params.actorName || null;
  if (!actorName && actorId) {
    actorName = (await query('SELECT name FROM public.profiles WHERE id = $1', [actorId])).rows[0]?.name || null;
  }
  const quem = escapeHtml(actorName || 'Alguém');
  const label = `int-${String(t.internal_ticket_number ?? '').padStart(4, '0')}`;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  const link = baseUrl ? `${baseUrl}/internal-tickets/${t.internal_ticket_number}` : null;

  const subject = kind === 'note'
    ? `Nova nota no ticket interno ${label} — SSX Desk`
    : kind === 'created'
      ? `Ticket interno ${label} atribuído a você — SSX Desk`
      : `Ticket interno ${label} atualizado — SSX Desk`;
  const intro = kind === 'note'
    ? `<strong>${quem}</strong> adicionou uma nota ao ticket interno:`
    : kind === 'created'
      ? `<strong>${quem}</strong> abriu um ticket interno com você como responsável:`
      : `<strong>${quem}</strong> alterou o ticket interno:`;
  const anexos = (params.attachmentNames || []).filter(Boolean).slice(0, 10);
  const detalhe = (params.text ? textToEmailHtml(params.text) : '')
    + (anexos.length
      ? `<p style="margin:6px 0 0;"><strong>Anexo${anexos.length > 1 ? 's' : ''}:</strong> ${anexos.map(escapeHtml).join(', ')}</p>`
      : '');
  const bodyHtml = `
    <p style="margin:0 0 10px;">${intro}</p>
    ${ticketRefBlock(label, t.title)}
    ${detalhe ? `<div style="margin:12px 0 0;padding:12px;border-radius:8px;background:#f5f5f5;">${detalhe}</div>` : ''}
  `.trim();
  const html = wrapEmailHtml({ bodyHtml, ctaUrl: link, ctaLabel: 'Abrir ticket interno' });

  // Aviso de MENÇÃO: mesmo conteúdo, com assunto e abertura próprios.
  const mentionSubject = `${actorName || 'Alguém'} mencionou você no ticket interno ${label} — SSX Desk`;
  const mentionHtml = wrapEmailHtml({
    bodyHtml: `
      <p style="margin:0 0 10px;"><strong>${quem}</strong> mencionou você numa nota do ticket interno. Você passa a receber as atualizações dele por e-mail até ele ser concluído.</p>
      ${ticketRefBlock(label, t.title)}
      ${detalhe ? `<div style="margin:12px 0 0;padding:12px;border-radius:8px;background:#f5f5f5;">${detalhe}</div>` : ''}
    `.trim(),
    ctaUrl: link,
    ctaLabel: 'Abrir ticket interno'
  });

  for (const person of peopleRes.rows) {
    const isMention = mentioned.includes(person.id);
    try {
      await EmailService.send(person.email, isMention ? mentionSubject : subject, isMention ? mentionHtml : html);
    } catch (err: any) {
      // SMTP desligado é o caso comum em dev — uma linha só, sem stack.
      console.error(`[email] Ticket interno ${label}: aviso a ${person.email} não enviado — ${err?.message || err}`);
    }
  }

  // Push imediato só para quem foi marcado (o resto já recebe pelo sino).
  await Promise.all(mentioned.map(id => notifyUser(id, {
    title: `${actorName || 'Alguém'} mencionou você em ${label}`,
    body: t.title || 'Ticket interno',
    url: `/internal-tickets/${t.internal_ticket_number}`,
    tag: `internal_ticket_mention:${t.id}`
  }).catch(() => {})));
}

/** Fire-and-forget: nunca lança, nunca atrasa quem chamou. */
export function queueInternalTicketChangeEmail(params: Parameters<typeof notifyInternalTicketChange>[0]): void {
  notifyInternalTicketChange(params).catch(err => console.error('[email] notifyInternalTicketChange:', err));
}
