import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { startAutomationScheduler } from './lib/services/automation-scheduler';
import { startHotfixScheduler } from './lib/services/hotfix-scheduler';
import { startReleaseCycleScheduler } from './lib/services/release-cycle-scheduler';
import { startGoogleCalendarScheduler } from './lib/services/google-calendar-scheduler';
import { startEmbeddingScheduler } from './lib/services/embedding-scheduler';
import { startDissatisfactionScheduler } from './lib/services/dissatisfaction-scheduler';
import { startPyvonInboundRetryScheduler } from './lib/services/pyvon-inbound-events';
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

  startAutomationScheduler();
  startHotfixScheduler();
  startReleaseCycleScheduler();
  startEmbeddingScheduler();
  startDissatisfactionScheduler();
  startGoogleCalendarScheduler();
  // Reprocessa mensagens recebidas do Pyvon que falharam (pyvon_inbound_events).
  // Fica com os outros schedulers: dono único, por SERVICE_ROLE.
  startPyvonInboundRetryScheduler();
})();
