import { query } from '../db';
import { notifyUser } from './push-service';
import { EmailService } from './email-service';
import { addDaysToIsoDate, todayIsoDate } from '../release-stage-logic';

/**
 * Notificação por etapa do ciclo de publicação. Mesmo padrão de
 * lib/services/hotfix-scheduler.ts (setInterval + guarda em globalThis),
 * só que por ETAPA do CICLO (release_cycle_stages) em vez de por hotfix
 * inteiro: avisa o(s) responsável(is) da etapa (pessoas em
 * responsible_ids + membros da equipe em team_id, quando houver) 2 dias
 * antes do início e no dia em que vence sem ter sido concluída — por push
 * E por e-mail (`EmailService.send` já falha graciosamente, lançando, se
 * o SMTP estiver desligado/incompleto; por isso cada envio individual tem
 * seu próprio catch, e um e-mail não configurado nunca impede o push).
 *
 * Renomeado de release-stage-scheduler.ts em 2026-10-19 (reestruturação
 * Ciclo/Item) — mesma lógica, só a tabela de origem mudou de hotfix_stages
 * pra release_cycle_stages.
 */
declare global {
  var releaseCycleSchedulerStarted: boolean | undefined;
}

const POLL_INTERVAL_MS = 5 * 60_000;
const BATCH_SIZE = 50;
const START_WARNING_DAYS = 2;

interface Recipient { id: string; email: string | null }

async function resolveRecipients(stage: { responsible_ids: string[]; team_id: string | null }): Promise<Recipient[]> {
  const ids = new Set<string>(stage.responsible_ids || []);
  if (stage.team_id) {
    const teamRes = await query('SELECT id FROM public.profiles WHERE $1 = ANY(internal_team_ids)', [stage.team_id]);
    for (const row of teamRes.rows) ids.add(row.id);
  }
  if (ids.size === 0) return [];
  const res = await query('SELECT id, email FROM public.profiles WHERE id = ANY($1)', [Array.from(ids)]);
  return res.rows.map((r: any) => ({ id: r.id, email: r.email || null }));
}

// stage.start_date/end_date vêm do pg como Date (coluna DATE, meia-noite
// UTC) — .toISOString().slice(0,10) recupera o dia calendário certo antes de
// formatar, mesmo cuidado de formatDate() em components/hotfixes-content.tsx.
function formatPgDate(value: any): string {
  const iso = new Date(value).toISOString().slice(0, 10);
  return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR');
}

async function notifyStage(stage: any, title: string, body: string): Promise<void> {
  const recipients = await resolveRecipients(stage);
  await Promise.all(recipients.flatMap(r => [
    notifyUser(r.id, { title, body, url: '/settings?tab=hotfixes' }).catch(err =>
      console.error('[release-cycle-scheduler] Falha ao enviar push:', err)
    ),
    r.email
      ? EmailService.send(r.email, title, `<p>${body}</p><p><a href="/settings?tab=hotfixes">Abrir Publicações</a></p>`).catch(err =>
          console.error('[release-cycle-scheduler] Falha ao enviar e-mail:', err)
        )
      : Promise.resolve()
  ]));
}

async function processUpcomingStages(): Promise<void> {
  const threshold = addDaysToIsoDate(todayIsoDate(), START_WARNING_DAYS);
  const upcoming = await query(
    `SELECT rcs.*, rc.name AS cycle_name FROM public.release_cycle_stages rcs
       JOIN public.release_cycles rc ON rc.id = rcs.cycle_id
      WHERE rcs.completed_at IS NULL AND rcs.notified_start_at IS NULL
        AND rcs.start_date <= $1 AND rc.published_at IS NULL
      ORDER BY rcs.start_date ASC
      LIMIT $2`,
    [threshold, BATCH_SIZE]
  );

  for (const stage of upcoming.rows) {
    try {
      await query('UPDATE public.release_cycle_stages SET notified_start_at = now() WHERE id = $1', [stage.id]);
      await notifyStage(
        stage,
        'Etapa de ciclo se aproxima',
        `"${stage.name}" (${stage.cycle_name}) começa em ${formatPgDate(stage.start_date)}.`
      );
    } catch (err) {
      console.error('[release-cycle-scheduler] Falha ao processar etapa próxima:', stage.id, err);
    }
  }
}

async function processOverdueStages(): Promise<void> {
  const today = todayIsoDate();
  const overdue = await query(
    `SELECT rcs.*, rc.name AS cycle_name FROM public.release_cycle_stages rcs
       JOIN public.release_cycles rc ON rc.id = rcs.cycle_id
      WHERE rcs.completed_at IS NULL AND rcs.notified_overdue_at IS NULL
        AND rcs.end_date < $1 AND rc.published_at IS NULL
      ORDER BY rcs.end_date ASC
      LIMIT $2`,
    [today, BATCH_SIZE]
  );

  for (const stage of overdue.rows) {
    try {
      await query('UPDATE public.release_cycle_stages SET notified_overdue_at = now() WHERE id = $1', [stage.id]);
      await notifyStage(stage, 'Etapa de ciclo atrasada', `"${stage.name}" (${stage.cycle_name}) passou da data prevista e ainda não foi concluída.`);
    } catch (err) {
      console.error('[release-cycle-scheduler] Falha ao processar etapa atrasada:', stage.id, err);
    }
  }
}

export function startReleaseCycleScheduler(): void {
  if (global.releaseCycleSchedulerStarted) return;
  global.releaseCycleSchedulerStarted = true;

  setInterval(() => {
    processUpcomingStages().catch(err => console.error('[release-cycle-scheduler] Falha ao processar etapas próximas:', err));
    processOverdueStages().catch(err => console.error('[release-cycle-scheduler] Falha ao processar etapas atrasadas:', err));
  }, POLL_INTERVAL_MS);
}
