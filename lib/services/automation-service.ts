import { query } from '../db';
import { isClosedTicketStatus } from '../ticket-status';
import { AUTOMATION_EVENTS, renderTemplate } from '../automation-events';
import { WhatsAppService } from './whatsapp-service';
import { EmailService } from './email-service';
import { wrapEmailHtml } from '../email-templates';

// Linha crua de public.tickets (snake_case), como vem de SELECT/RETURNING —
// os 7 pontos de disparo (ver app/api/tickets/route.ts e
// app/api/compat/supabase/route.ts) sempre têm essa forma disponível sem
// precisar converter para o tipo Ticket (camelCase) do resto do app.
export interface TicketRow {
  id: string;
  public_ticket_number: number;
  title: string;
  description?: string;
  status: string;
  priority: string;
  category_id: string | null;
  company_id: string | null;
  customer_id: string | null;
  assignee_id: string | null;
  employee_ids?: string[] | null;
  created_at: string;
  updated_at?: string;
}

interface TicketMessageRow {
  ticket_id: string;
  is_visible_to_customer: boolean;
  type: string;
  content: string;
}

const STATUS_KEYED_EVENTS = ['solicitacao_informacoes', 'aguardando_aprovacao', 'aguardando_nota', 'chamado_finalizado'];

let seeded = false;

export async function ensureAutomationSettingsSeeded(): Promise<void> {
  if (seeded) return;
  for (const ev of AUTOMATION_EVENTS) {
    await query(
      `INSERT INTO public.automation_settings (event_key, message, trigger_status)
       VALUES ($1, $2, $3) ON CONFLICT (event_key) DO NOTHING`,
      [ev.key, ev.defaultMessage, ev.defaultTriggerStatus || null]
    );
  }
  seeded = true;
}

export async function getAutomationSettings(): Promise<any[]> {
  await ensureAutomationSettingsSeeded();
  const res = await query('SELECT * FROM public.automation_settings ORDER BY event_key');
  return res.rows;
}

export async function saveAutomationSetting(eventKey: string, updates: {
  enabled: boolean;
  message: string;
  delayMinutes: number;
  firstOccurrenceOnly: boolean;
  triggerStatus?: string | null;
  emailEnabled?: boolean;
  emailSubject?: string | null;
}): Promise<any> {
  await ensureAutomationSettingsSeeded();
  const res = await query(
    `UPDATE public.automation_settings
     SET enabled = $1, message = $2, delay_minutes = $3, first_occurrence_only = $4, trigger_status = $5,
         email_enabled = $6, email_subject = $7, updated_at = now()
     WHERE event_key = $8
     RETURNING *`,
    [updates.enabled, updates.message, updates.delayMinutes, updates.firstOccurrenceOnly, updates.triggerStatus || null,
     !!updates.emailEnabled, updates.emailSubject || null, eventKey]
  );
  return res.rows[0];
}

// Converte o texto puro (com \n, emojis) do template já usado pelo
// WhatsApp num HTML simples pro corpo do e-mail — evita duplicar o texto de
// cada evento por canal.
export function plainTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<div style="font-family:sans-serif;white-space:pre-wrap;">${escaped.replace(/\n/g, '<br>')}</div>`;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days} dia${days > 1 ? 's' : ''} e ${hours} hora${hours > 1 ? 's' : ''}` : `${days} dia${days > 1 ? 's' : ''}`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours} hora${hours > 1 ? 's' : ''} e ${minutes} minuto${minutes !== 1 ? 's' : ''}` : `${hours} hora${hours > 1 ? 's' : ''}`;
  }
  return `${minutes} minuto${minutes !== 1 ? 's' : ''}`;
}

export async function buildPlaceholderContext(ticket: TicketRow, extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const namesRes = await query(
    `SELECT
       (SELECT name FROM public.profiles WHERE id = $1) AS customer_name,
       (SELECT name FROM public.companies WHERE id = $2) AS company_name,
       (SELECT name FROM public.profiles WHERE id = $3) AS assignee_name,
       (SELECT label FROM public.config_categories WHERE id = $4) AS category_label`,
    [ticket.customer_id, ticket.company_id, ticket.assignee_id, ticket.category_id]
  );
  const names = namesRes.rows[0] || {};
  const now = new Date();
  const createdAt = new Date(ticket.created_at);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;

  return {
    numero_chamado: String(ticket.public_ticket_number ?? '').padStart(4, '0'),
    titulo: ticket.title || '',
    cliente: names.customer_name || '',
    empresa: names.company_name || '',
    analista: names.assignee_name || '',
    status: ticket.status || '',
    prioridade: ticket.priority || '',
    categoria: names.category_label || '',
    data: now.toLocaleDateString('pt-BR'),
    hora: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    link: baseUrl ? `${baseUrl}/my-tickets?ticket=${ticket.id}` : '',
    tempo_atendimento: formatDuration(now.getTime() - createdAt.getTime()),
    nota: extra.nota || '',
    motivo: extra.motivo || ''
  };
}

interface TicketRecipient { id: string; name: string; phone: string; email: string; }

// profiles.email é NOT NULL/UNIQUE — ao contrário do telefone, nunca falta,
// então todo perfil encontrado vira um destinatário válido pro canal de
// e-mail; o de WhatsApp continua exigindo telefone (missingPhone).
async function resolveTicketRecipients(ticket: TicketRow): Promise<{ recipients: TicketRecipient[]; missingPhone: TicketRecipient[] }> {
  const employeeIds = ticket.employee_ids || [];
  const res = await query(
    `SELECT DISTINCT id, name, phone, email FROM public.profiles
     WHERE id = $1
        OR id = ANY($2::uuid[])
        OR (company_id = $3 AND view_all_company_tickets = true)`,
    [ticket.customer_id, employeeIds, ticket.company_id]
  );

  const seenIds = new Set<string>();
  const recipients: TicketRecipient[] = [];
  const missingPhone: TicketRecipient[] = [];

  for (const row of res.rows) {
    if (!row.id || seenIds.has(row.id)) continue;
    seenIds.add(row.id);
    const normalizedPhone = (row.phone || '').replace(/\D/g, '');
    const recipient: TicketRecipient = { id: row.id, name: row.name || '', phone: normalizedPhone, email: row.email || '' };
    if (!normalizedPhone) missingPhone.push(recipient);
    recipients.push(recipient);
  }

  return { recipients, missingPhone };
}

async function logDispatch(fields: {
  eventKey: string; ticketId: string; recipientId?: string | null; recipientName?: string;
  channel?: 'whatsapp' | 'email'; recipientPhone?: string; recipientEmail?: string; subject?: string;
  message: string; status: 'sent' | 'failed' | 'skipped'; error?: string;
}): Promise<void> {
  await query(
    `INSERT INTO public.automation_dispatches
       (event_key, ticket_id, recipient_id, recipient_name, channel, recipient_phone, recipient_email, subject, message, status, error, send_at, sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), CASE WHEN $10 = 'sent' THEN now() ELSE NULL END)`,
    [fields.eventKey, fields.ticketId, fields.recipientId || null, fields.recipientName || '', fields.channel || 'whatsapp',
     fields.recipientPhone || '', fields.recipientEmail || null, fields.subject || null, fields.message, fields.status, fields.error || null]
  );
}

const DEFAULT_EMAIL_SUBJECT = 'Chamado {{numero_chamado}} — {{titulo}}';

export async function dispatchEvent(eventKey: string, ticket: TicketRow, extra: Record<string, string> = {}): Promise<void> {
  try {
    await ensureAutomationSettingsSeeded();
    const settingRes = await query('SELECT * FROM public.automation_settings WHERE event_key = $1', [eventKey]);
    const setting = settingRes.rows[0];
    if (!setting || (!setting.enabled && !setting.email_enabled)) return;

    if (setting.first_occurrence_only) {
      const already = await query(
        `SELECT 1 FROM public.automation_dispatches WHERE ticket_id = $1 AND event_key = $2 AND status = 'sent' LIMIT 1`,
        [ticket.id, eventKey]
      );
      if ((already.rowCount ?? 0) > 0) return;
    }

    const context = await buildPlaceholderContext(ticket, extra);
    const renderedMessage = renderTemplate(setting.message, context);
    const renderedSubject = renderTemplate(setting.email_subject || DEFAULT_EMAIL_SUBJECT, context);
    const { recipients, missingPhone } = await resolveTicketRecipients(ticket);

    const delayMinutes = Number(setting.delay_minutes) || 0;

    // WhatsApp — igual antes, só que agora protegido explicitamente contra
    // duas pessoas diferentes com o mesmo telefone (a lista de recipients já
    // não dedupa mais por telefone, já que precisa incluir todo mundo pro
    // e-mail — sem isso o mesmo número levaria a mensagem em dobro).
    if (setting.enabled) {
      for (const r of missingPhone) {
        await logDispatch({ eventKey, ticketId: ticket.id, recipientId: r.id, recipientName: r.name, channel: 'whatsapp', message: renderedMessage, status: 'failed', error: 'Sem telefone cadastrado' });
      }

      const sentPhones = new Set<string>();
      for (const r of recipients) {
        if (!r.phone || sentPhones.has(r.phone)) continue;
        sentPhones.add(r.phone);

        if (delayMinutes > 0) {
          await query(
            `INSERT INTO public.automation_dispatches (event_key, ticket_id, recipient_id, recipient_name, channel, recipient_phone, message, status, send_at)
             VALUES ($1,$2,$3,$4,'whatsapp',$5,$6,'pending', now() + ($7 || ' minutes')::interval)`,
            [eventKey, ticket.id, r.id, r.name, r.phone, renderedMessage, String(delayMinutes)]
          );
        } else {
          try {
            await WhatsAppService.sendMessage('default', r.phone, renderedMessage);
            await logDispatch({ eventKey, ticketId: ticket.id, recipientId: r.id, recipientName: r.name, channel: 'whatsapp', recipientPhone: r.phone, message: renderedMessage, status: 'sent' });
          } catch (err: any) {
            await logDispatch({ eventKey, ticketId: ticket.id, recipientId: r.id, recipientName: r.name, channel: 'whatsapp', recipientPhone: r.phone, message: renderedMessage, status: 'failed', error: err?.message || String(err) });
          }
        }
      }
    }

    // E-mail — canal novo, independente do WhatsApp acima. profiles.email é
    // sempre presente, então todo recipient resolvido recebe.
    if (setting.email_enabled) {
      const html = wrapEmailHtml({ bodyHtml: plainTextToHtml(renderedMessage), ctaUrl: context.link || null, ctaLabel: 'Abrir chamado' });
      for (const r of recipients) {
        if (!r.email) continue;

        if (delayMinutes > 0) {
          await query(
            `INSERT INTO public.automation_dispatches (event_key, ticket_id, recipient_id, recipient_name, channel, recipient_email, subject, message, status, send_at)
             VALUES ($1,$2,$3,$4,'email',$5,$6,$7,'pending', now() + ($8 || ' minutes')::interval)`,
            [eventKey, ticket.id, r.id, r.name, r.email, renderedSubject, renderedMessage, String(delayMinutes)]
          );
        } else {
          try {
            await EmailService.send(r.email, renderedSubject, html);
            await logDispatch({ eventKey, ticketId: ticket.id, recipientId: r.id, recipientName: r.name, channel: 'email', recipientEmail: r.email, subject: renderedSubject, message: renderedMessage, status: 'sent' });
          } catch (err: any) {
            await logDispatch({ eventKey, ticketId: ticket.id, recipientId: r.id, recipientName: r.name, channel: 'email', recipientEmail: r.email, subject: renderedSubject, message: renderedMessage, status: 'failed', error: err?.message || String(err) });
          }
        }
      }
    }
  } catch (err) {
    console.error(`[automation] Falha ao processar evento "${eventKey}" no chamado ${ticket?.id}:`, err);
  }
}

// Notificação de atribuição por e-mail pro responsável interno — separada do
// disparo de WhatsApp acima (que notifica o CLIENTE de que um analista foi
// atribuído, não o analista). Texto fixo (não passa por automation_settings/
// AUTOMATED_EVENTS, por decisão — mesma simplicidade das notificações push
// existentes). Falha aqui nunca deve derrubar o disparo de WhatsApp que já
// aconteceu antes no mesmo handleTicketUpdated.
async function notifyAssigneeByEmail(ticket: TicketRow): Promise<void> {
  if (!ticket.assignee_id) return;
  const res = await query('SELECT email, name FROM public.profiles WHERE id = $1', [ticket.assignee_id]);
  const assignee = res.rows[0];
  if (!assignee?.email) return;

  const ticketLabel = `#${String(ticket.public_ticket_number ?? '').padStart(4, '0')}`;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  const link = baseUrl ? `${baseUrl}/dashboard?ticket=${ticket.id}` : null;

  const html = `
    <p>Olá, ${assignee.name || ''}.</p>
    <p>O chamado <strong>${ticketLabel} — ${ticket.title || ''}</strong> foi atribuído a você.</p>
    ${link ? `<p><a href="${link}">Abrir chamado</a></p>` : ''}
  `.trim();

  await EmailService.send(assignee.email, `Chamado ${ticketLabel} atribuído a você — SSX Desk`, html);
}

async function handleStatusChange(oldTicket: TicketRow, newTicket: TicketRow): Promise<void> {
  if (isClosedTicketStatus(oldTicket.status) && !isClosedTicketStatus(newTicket.status)) {
    await dispatchEvent('chamado_reaberto', newTicket);
    return;
  }

  await ensureAutomationSettingsSeeded();
  const settingsRes = await query(
    `SELECT event_key, trigger_status FROM public.automation_settings WHERE event_key = ANY($1) AND (enabled = true OR email_enabled = true)`,
    [STATUS_KEYED_EVENTS]
  );
  const match = settingsRes.rows.find((r: any) => r.trigger_status === newTicket.status);
  if (match) {
    await dispatchEvent(match.event_key, newTicket);
    return;
  }

  await dispatchEvent('mudanca_status', newTicket);
}

/** Chamar sem await (fire-and-forget) nos pontos de criação de chamado. */
export function handleTicketCreated(ticket: TicketRow): void {
  dispatchEvent('novo_chamado', ticket).catch(err => console.error('[automation] handleTicketCreated:', err));
}

/** Chamar sem await (fire-and-forget) nos pontos de atualização de chamado. */
export function handleTicketUpdated(oldTicket: TicketRow | null | undefined, newTicket: TicketRow | null | undefined): void {
  if (!oldTicket || !newTicket) return;
  (async () => {
    try {
      if (oldTicket.category_id !== newTicket.category_id) {
        await dispatchEvent('chamado_classificado', newTicket);
      }
      if (oldTicket.priority !== newTicket.priority) {
        await dispatchEvent('mudanca_prioridade', newTicket);
      }
      if (oldTicket.assignee_id !== newTicket.assignee_id && newTicket.assignee_id) {
        await dispatchEvent('analista_atribuido', newTicket);
        notifyAssigneeByEmail(newTicket).catch(err => console.error('[email] notifyAssigneeByEmail:', err));
      }
      if (oldTicket.status !== newTicket.status) {
        await handleStatusChange(oldTicket, newTicket);
      }
    } catch (err) {
      console.error('[automation] handleTicketUpdated:', err);
    }
  })();
}

/** Chamar sem await (fire-and-forget) ao criar uma ticket_message. `ticket` já deve ter sido buscado pelo chamador. */
export function handleTicketMessageCreated(message: TicketMessageRow, ticket: TicketRow | null | undefined): void {
  if (!ticket || !message.is_visible_to_customer || message.type === 'internal') return;
  dispatchEvent('resposta_analista', ticket, { nota: message.content || '' })
    .catch(err => console.error('[automation] handleTicketMessageCreated:', err));
}
