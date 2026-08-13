import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { query } from './lib/db';
import { WhatsAppService } from './lib/services/whatsapp-service';
import { startAutomationScheduler } from './lib/services/automation-scheduler';
import { startHotfixScheduler } from './lib/services/hotfix-scheduler';
import { startEmbeddingScheduler } from './lib/services/embedding-scheduler';
import { startDissatisfactionScheduler } from './lib/services/dissatisfaction-scheduler';
import { SHOULD_RUN_BACKGROUND_JOBS, SERVICE_ROLE } from './lib/runtime-config';

(async () => {
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return;

  // Com o projeto dividido em duas imagens, este arquivo roda nas DUAS — e
  // trabalho de fundo não pode ter dois donos. Dois processos rodando os mesmos
  // schedulers enviam a MESMA mensagem automática duas vezes ao cliente, e duas
  // conexões Baileys brigam pela mesma sessão de WhatsApp, derrubando uma à
  // outra em ciclo. Por isso o container do front não sobe nada disto.
  //
  // A trava é por SERVICE_ROLE, não por sorte de ordem de boot: precisa ser
  // explícito qual container é o dono.
  if (!SHOULD_RUN_BACKGROUND_JOBS) {
    console.log(`[boot] SERVICE_ROLE=${SERVICE_ROLE}: schedulers e WhatsApp não sobem neste container (dono é o backend).`);
    return;
  }

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
  startEmbeddingScheduler();
  startDissatisfactionScheduler();
})();
