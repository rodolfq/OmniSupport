import { query } from '../db';
import { WhatsAppService } from './whatsapp-service';

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
    `SELECT id, recipient_phone, message FROM public.automation_dispatches
     WHERE status = 'pending' AND send_at <= now()
     ORDER BY send_at ASC
     LIMIT $1`,
    [BATCH_SIZE]
  );

  for (const row of due.rows) {
    try {
      await WhatsAppService.sendMessage('default', row.recipient_phone, row.message);
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
