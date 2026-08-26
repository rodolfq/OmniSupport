import { query } from '../db';
import { notifyUser } from './push-service';
import { listConnectedUserIds, listUpcomingEvents } from './google-calendar-service';

/**
 * Lembrete de evento da Google Agenda — roda no servidor (setInterval), mesmo
 * padrão de lib/services/hotfix-scheduler.ts. Só existe porque o deploy hoje é
 * servidor dedicado (não serverless): um scheduler em memória de processo
 * depende de o processo continuar vivo entre as rodadas, o que não é garantido
 * numa função serverless (mesma ressalva já documentada pro WhatsApp/Baileys
 * no CLAUDE.md) mas é o normal aqui.
 */
declare global {
  var googleCalendarSchedulerStarted: boolean | undefined;
}

// 2 minutos dá precisão suficiente pra um lembrete de 10 min de antecedência
// sem bater na API do Google toda hora.
const POLL_INTERVAL_MS = 2 * 60_000;
const REMINDER_LEAD_MINUTES = 10;

async function processUser(userId: string): Promise<void> {
  // Janela um pouco maior que o lead time, pra não perder um evento que caiu
  // bem na borda entre duas rodadas do scheduler.
  const events = await listUpcomingEvents(userId, REMINDER_LEAD_MINUTES + 2);
  const now = Date.now();

  for (const event of events) {
    const minutesUntil = (new Date(event.start).getTime() - now) / 60_000;
    if (minutesUntil > REMINDER_LEAD_MINUTES || minutesUntil < 0) continue;

    // ON CONFLICT DO NOTHING é o que evita avisar duas vezes o mesmo evento
    // em rodadas seguidas do scheduler — só notifica quem de fato inseriu a
    // linha (RETURNING vazio = outra rodada, ou este mesmo evento, já
    // avisou antes).
    const inserted = await query(
      `INSERT INTO public.google_calendar_reminder_log (user_id, event_id, event_title, event_start, event_url)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, event_id, event_start) DO NOTHING
       RETURNING id`,
      [userId, event.id, event.title, event.start, event.url]
    );
    if (!inserted.rows[0]) continue;

    await notifyUser(userId, {
      title: 'Evento em breve',
      body: `"${event.title}" começa em ${Math.max(1, Math.round(minutesUntil))} min.`,
      url: event.url || '/dashboard',
      tag: `calendar_event:${event.id}`
    }).catch(err => console.error('[google-calendar-scheduler] Falha ao enviar push:', err));
  }
}

async function processAllUsers(): Promise<void> {
  const userIds = await listConnectedUserIds();
  for (const userId of userIds) {
    try {
      await processUser(userId);
    } catch (err) {
      console.error('[google-calendar-scheduler] Falha ao processar usuário:', userId, err);
    }
  }
}

export function startGoogleCalendarScheduler(): void {
  if (global.googleCalendarSchedulerStarted) return;
  global.googleCalendarSchedulerStarted = true;

  setInterval(() => {
    processAllUsers().catch(err => console.error('[google-calendar-scheduler] Falha na rodada:', err));
  }, POLL_INTERVAL_MS);
}
