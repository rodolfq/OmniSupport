import { query } from '../db';
import { notifyUser } from './push-service';

// Item 17 do roadmap: alerta automático quando a data prevista de publicação
// de um hotfix é ultrapassada sem ele ter sido marcado como publicado. Mesmo
// padrão de lib/services/automation-scheduler.ts (setInterval + guarda em
// globalThis pra sobreviver ao hot-reload do Next.js em dev).
declare global {
  var hotfixSchedulerStarted: boolean | undefined;
}

// Menos agressivo que os 30s do automation-scheduler — atraso de hotfix não
// é tempo real, checar a cada 5 minutos é suficiente.
const POLL_INTERVAL_MS = 5 * 60_000;
const BATCH_SIZE = 50;

async function processOverdueHotfixes(): Promise<void> {
  const overdue = await query(
    `SELECT id, name, responsible_id, expected_date FROM public.hotfixes
     WHERE published_at IS NULL AND alerted_at IS NULL AND expected_date < CURRENT_DATE
     ORDER BY expected_date ASC
     LIMIT $1`,
    [BATCH_SIZE]
  );

  for (const row of overdue.rows) {
    try {
      // Marca antes de notificar: se o push falhar, não queremos tentar de
      // novo a cada rodada — o alerta já vale como "disparado" (é também o
      // que faz esse evento aparecer no polling do sino, ver
      // app/api/notifications/check/route.ts).
      await query(`UPDATE public.hotfixes SET alerted_at = now() WHERE id = $1`, [row.id]);

      if (row.responsible_id) {
        await notifyUser(row.responsible_id, {
          title: 'Hotfix atrasado',
          body: `"${row.name}" era esperado para ${new Date(`${row.expected_date}T00:00:00`).toLocaleDateString('pt-BR')} e ainda não foi publicado.`,
          url: '/hotfixes'
        }).catch(err => console.error('[hotfix-scheduler] Falha ao enviar push:', err));
      }
    } catch (err) {
      console.error('[hotfix-scheduler] Falha ao processar hotfix atrasado:', row.id, err);
    }
  }
}

export function startHotfixScheduler(): void {
  if (global.hotfixSchedulerStarted) return;
  global.hotfixSchedulerStarted = true;

  setInterval(() => {
    processOverdueHotfixes().catch(err => console.error('[hotfix-scheduler] Falha ao processar hotfixes atrasados:', err));
  }, POLL_INTERVAL_MS);
}
