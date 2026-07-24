import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { query } from './lib/db';
import { WhatsAppService } from './lib/services/whatsapp-service';
import { startAutomationScheduler } from './lib/services/automation-scheduler';
import { startHotfixScheduler } from './lib/services/hotfix-scheduler';

(async () => {
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return;

  try {
    const res = await query('SELECT id FROM public.whatsapp_instances');
    const instanceIds = new Set(['default', ...res.rows.map((r: any) => r.id)]);

    for (const instanceId of instanceIds) {
      WhatsAppService.ensureConnection(instanceId).catch((err) => {
        console.error(`[WhatsApp:${instanceId}] Falha ao reconectar no boot do servidor:`, err);
      });
    }
  } catch (err) {
    console.error('[WhatsApp] Falha ao carregar instâncias para reconexão automática:', err);
  }

  startAutomationScheduler();
  startHotfixScheduler();
})();
