import { query } from '@/lib/db';
import { PyvonService, PyvonInboundPayload } from '@/lib/services/pyvon-service';

// Guarda e reprocessamento das mensagens recebidas do Pyvon (ver
// migrations/pyvon_inbound_events.sql). Regra: nenhum evento some. Ele é
// gravado ANTES de processar, e só sai de 'pending'/'failed' quando a
// conversa e a mensagem estão no banco.
//
// Ciclo de vida:
//   pending  → recebido, processamento em andamento (ou travado por queda do processo)
//   processed → conversa e mensagem gravadas
//   ignored  → payload sem message_id ou cadastro_id: não há como ligar a um contato
//   failed   → falhou; o agendador retenta com espera crescente
//   dead     → falhou MAX_ATTEMPTS vezes; fica para conferência manual
//
// Para reprocessar manualmente um 'dead' depois de corrigir a causa:
//   UPDATE public.pyvon_inbound_events SET status = 'failed', attempts = 0 WHERE status = 'dead';

const MAX_ATTEMPTS = 10;
// Espera antes da próxima tentativa: attempts × 2 min (2, 4, 6... min).
const BACKOFF_MINUTES_PER_ATTEMPT = 2;
// Um 'pending' mais antigo que isto não está mais em processamento: o processo caiu no meio.
const STALE_PENDING_MINUTES = 3;
const POLL_INTERVAL_MS = 60_000;
const BATCH_SIZE = 20;

declare global {
  var pyvonInboundRetrySchedulerStarted: boolean | undefined;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : JSON.stringify(err);
}

// Primeira gravação. Se isto falhar, o chamador responde erro — o evento não
// pode ser processado sem ter sido guardado antes.
export async function storeInboundEvent(payload: PyvonInboundPayload | null, instanceId: string): Promise<number> {
  const messageId = payload?.message_id != null ? String(payload.message_id) : null;
  const res = await query(
    `INSERT INTO public.pyvon_inbound_events (instance_id, pyvon_message_id, payload, status, attempts)
     VALUES ($1, $2, $3::jsonb, 'pending', 1)
     RETURNING id`,
    [instanceId, messageId, JSON.stringify(payload ?? null)]
  );
  return Number(res.rows[0].id);
}

export async function markInboundIgnored(id: number, reason: string): Promise<void> {
  await query(
    `UPDATE public.pyvon_inbound_events SET status = 'ignored', last_error = $2, updated_at = now() WHERE id = $1`,
    [id, reason]
  );
}

// Processa um evento já guardado. Nunca lança: o resultado vai para o banco.
export async function processInboundEvent(id: number, instanceId: string, payload: PyvonInboundPayload): Promise<void> {
  try {
    await PyvonService.handleWebhook(payload, instanceId);
    await query(
      `UPDATE public.pyvon_inbound_events
          SET status = 'processed', processed_at = now(), updated_at = now(), last_error = NULL
        WHERE id = $1`,
      [id]
    );
  } catch (err) {
    const message = errorMessage(err).slice(0, 1000);
    await query(
      `UPDATE public.pyvon_inbound_events
          SET status = CASE WHEN attempts >= $2 THEN 'dead' ELSE 'failed' END,
              last_error = $3,
              updated_at = now()
        WHERE id = $1`,
      [id, MAX_ATTEMPTS, message]
    ).catch(dbErr => console.error('[Pyvon] Falha ao registrar erro do evento recebido:', dbErr));
    console.error(`[Pyvon] Mensagem recebida (evento ${id}) não processada — será retentada:`, message);
  }
}

// Uma rodada do agendador: marca os travados como 'dead' e pega um lote de
// eventos vencidos para retentar. FOR UPDATE SKIP LOCKED evita que duas
// rodadas peguem o mesmo evento.
async function retryDueInboundEvents(): Promise<number> {
  await query(
    `UPDATE public.pyvon_inbound_events
        SET status = 'dead', last_error = COALESCE(last_error, 'processo caiu antes de concluir'), updated_at = now()
      WHERE status = 'pending' AND attempts >= $1 AND updated_at < now() - make_interval(mins => $2)`,
    [MAX_ATTEMPTS, STALE_PENDING_MINUTES]
  );

  const claimed = await query(
    `UPDATE public.pyvon_inbound_events
        SET attempts = attempts + 1, status = 'pending', updated_at = now()
      WHERE id IN (
        SELECT id FROM public.pyvon_inbound_events
         WHERE attempts < $1
           AND (
             (status = 'pending' AND updated_at < now() - make_interval(mins => $2))
             OR (status = 'failed' AND updated_at < now() - make_interval(mins => attempts * $3))
           )
         ORDER BY received_at
         LIMIT $4
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, instance_id, payload`,
    [MAX_ATTEMPTS, STALE_PENDING_MINUTES, BACKOFF_MINUTES_PER_ATTEMPT, BATCH_SIZE]
  );

  for (const row of claimed.rows) {
    await processInboundEvent(Number(row.id), row.instance_id, row.payload as PyvonInboundPayload);
  }
  return claimed.rows.length;
}

export function startPyvonInboundRetryScheduler(): void {
  if (global.pyvonInboundRetrySchedulerStarted) return;
  global.pyvonInboundRetrySchedulerStarted = true;

  setInterval(() => {
    retryDueInboundEvents().catch(err => {
      console.error('[Pyvon] Falha no reprocessamento de mensagens recebidas:', err);
    });
  }, POLL_INTERVAL_MS);
}
