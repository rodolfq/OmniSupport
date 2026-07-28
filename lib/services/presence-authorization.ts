import { query } from '@/lib/db';
import { Permission } from '@/lib/types';

// Regra única, aplicada nos dois pontos que gravam presença (app/actions.ts
// #updateUserStatus e app/api/chats/route.ts #log-status-change): ninguém —
// nem admin — pode colocar OUTRA pessoa como Online. Só o próprio usuário
// decide isso de si mesmo. Colegas só podem forçar alguém para Offline (ex.:
// "derrubar login" de quem ficou preso como disponível sem estar), e mesmo
// isso exige uma das permissões abaixo. Sem essa trava, dava pra fraudar o
// rodízio de atendimento (lib/services/queue-routing.ts) marcando um colega
// como disponível sem ele estar de fato.
const FORCE_OFFLINE_PERMISSIONS: string[] = [
  Permission.OUTSIDE_QUEUE_VIEW,
  Permission.QUEUES_MANAGE,
  Permission.TEAM_STATUS_MANAGE
];

export async function canForceOthersOffline(actor: { id: string; role: string }): Promise<boolean> {
  if (actor.role === 'Administrador') return true;

  const res = await query(
    `SELECT COALESCE(rp.permissions, '{}'::text[]) AS permissions
     FROM public.profiles p LEFT JOIN public.role_permissions rp ON rp.id = p.access_profile_id
     WHERE p.id = $1`,
    [actor.id]
  );
  const permissions: string[] = res.rows[0]?.permissions || [];
  return FORCE_OFFLINE_PERMISSIONS.some(p => permissions.includes(p));
}
