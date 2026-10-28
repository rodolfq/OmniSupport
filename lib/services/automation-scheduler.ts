import { query } from '../db';
import { PyvonService } from './pyvon-service';
import { EmailService } from './email-service';
import { plainTextToHtml, resolveTicketWhatsappInstance } from './automation-service';
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
            t.public_ticket_number, t.title AS ticket_title, t.queue_id
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
        // WhatsApp não-oficial (Baileys/QR Code) foi removido — este caminho
        // (disparo com atraso) era o único gap que ainda saía por ele
        // (ver CLAUDE.md, dívida técnica item 2). Resolve pela Fila do
        // chamado, mesma regra de dispatchEvent em automation-service.ts.
        const queueInstance = await resolveTicketWhatsappInstance({ queue_id: row.queue_id });
        const pyvonInstanceId = queueInstance?.provider === 'pyvon' ? queueInstance.id : await PyvonService.getSoleInstanceId();
        if (!pyvonInstanceId) {
          throw new Error('Nenhuma instância Pyvon configurada para enviar esta mensagem.');
        }
        const result = await PyvonService.sendMessage(pyvonInstanceId, { phone: row.recipient_phone }, row.message);
        if (result.skipped || (result.delivery && result.delivery !== 'sent')) {
          throw new Error(result.delivery_error || result.skipped || 'Pyvon não entregou a mensagem.');
        }
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
