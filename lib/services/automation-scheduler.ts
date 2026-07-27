import { query } from '../db';
import { WhatsAppService } from './whatsapp-service';
import { EmailService } from './email-service';
import { plainTextToHtml } from './automation-service';
import { wrapEmailHtml } from '../email-templates';

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
    `SELECT id, channel, ticket_id, recipient_phone, recipient_email, subject, message FROM public.automation_dispatches
     WHERE status = 'pending' AND send_at <= now()
     ORDER BY send_at ASC
     LIMIT $1`,
    [BATCH_SIZE]
  );

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;

  for (const row of due.rows) {
    try {
      if (row.channel === 'email') {
        const ctaUrl = baseUrl && row.ticket_id ? `${baseUrl}/my-tickets?ticket=${row.ticket_id}` : null;
        const html = wrapEmailHtml({ bodyHtml: plainTextToHtml(row.message), ctaUrl, ctaLabel: 'Abrir chamado' });
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
