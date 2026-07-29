import { query } from '../db';
import { WhatsAppService } from './whatsapp-service';
import { EmailService } from './email-service';
import { plainTextToHtml } from './automation-service';
import { wrapEmailHtml, ticketRefBlock } from '../email-templates';

// Mesmo padrão de lib/services/whatsapp-service.ts: guarda estado em
// globalThis para sobreviver ao hot-reload do Next.js em dev e evitar
// múltiplos intervalos concorrentes.
declare global {
  var automationSchedulerStarted: boolean | undefined;
}

const POLL_INTERVAL_MS = 30_000;
const BATCH_SIZE = 50;

async function processDueDispatches(): Promise<void> {
  const due = await query(
    `SELECT d.id, d.channel, d.ticket_id, d.recipient_phone, d.recipient_email, d.subject, d.message,
            t.public_ticket_number, t.title AS ticket_title
     FROM public.automation_dispatches d
     LEFT JOIN public.tickets t ON t.id = d.ticket_id
     WHERE d.status = 'pending' AND d.send_at <= now()
     ORDER BY d.send_at ASC
     LIMIT $1`,
    [BATCH_SIZE]
  );

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;

  for (const row of due.rows) {
    try {
      if (row.channel === 'email') {
        // Usa o id (UUID) direto — app/(portal)/tickets/[id]/page.tsx aceita
        // tanto o número público quanto o UUID como fallback.
        const ctaUrl = baseUrl && row.ticket_id ? `${baseUrl}/tickets/${row.ticket_id}` : null;
        const ticketLabel = row.public_ticket_number ? `#${String(row.public_ticket_number).padStart(4, '0')}` : null;
        const bodyHtml = (ticketLabel ? ticketRefBlock(ticketLabel, row.ticket_title) : '') + plainTextToHtml(row.message);
        const html = wrapEmailHtml({ bodyHtml, ctaUrl, ctaLabel: 'Abrir chamado' });
        await EmailService.send(row.recipient_email, row.subject || row.message.slice(0, 80), html);
      } else {
        await WhatsAppService.sendMessage('default', row.recipient_phone, row.message);
      }
      await query(
        `UPDATE public.automation_dispatches SET status = 'sent', sent_at = now() WHERE id = $1`,
        [row.id]
      );
    } catch (err: any) {
      await query(
        `UPDATE public.automation_dispatches SET status = 'failed', error = $2 WHERE id = $1`,
        [row.id, err?.message || String(err)]
      );
    }
  }
}

export function startAutomationScheduler(): void {
  if (global.automationSchedulerStarted) return;
  global.automationSchedulerStarted = true;

  setInterval(() => {
    processDueDispatches().catch(err => console.error('[automation-scheduler] Falha ao processar fila:', err));
  }, POLL_INTERVAL_MS);
}
