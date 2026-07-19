import webpush from 'web-push';
import { query } from '@/lib/db';

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:suporte@ssxresolve.com.br';

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

// Dispara uma notificação push para todos os dispositivos assinados do
// usuário. Chamado nos mesmos pontos que já alimentam o polling de
// notificações (app/api/notifications/check/route.ts), mas na escrita em vez
// de esperar o próximo ciclo de poll do cliente.
export async function notifyUser(userId: string, payload: PushPayload): Promise<void> {
  if (!vapidPublicKey || !vapidPrivateKey) {
    // VAPID não configurado (.env) — silenciosamente não envia, não quebra o fluxo principal.
    return;
  }

  const subsRes = await query(
    'SELECT id, endpoint, p256dh, auth FROM public.push_subscriptions WHERE user_id = $1',
    [userId]
  );

  if (subsRes.rowCount === 0) return;

  await Promise.all(subsRes.rows.map(async (sub: any) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        },
        JSON.stringify(payload)
      );
    } catch (err: any) {
      const statusCode = err?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // Assinatura expirada/revogada — remove para não tentar de novo.
        await query('DELETE FROM public.push_subscriptions WHERE id = $1', [sub.id]).catch(() => {});
      } else {
        console.error('[push-service] Falha ao enviar push:', err?.message || err);
      }
    }
  }));
}
