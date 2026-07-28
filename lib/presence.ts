// Deriva o status "de verdade" de um analista a partir de analyst_status —
// sem heartbeat de verdade (fechar a aba sem logout explícito não grava
// nada), um status "online"/"away" salvo há muito tempo ficava para sempre
// disponível na tela, mesmo com o sistema fechado há dias. Qualquer lugar
// que exiba a bolinha de presença deve passar por aqui em vez de ler
// isOnline/status crus.
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutos sem heartbeat = offline

export function isStalePresence(lastActive?: string | null): boolean {
  if (!lastActive) return true;
  const last = new Date(lastActive).getTime();
  if (Number.isNaN(last)) return true;
  return Date.now() - last > STALE_THRESHOLD_MS;
}

export function deriveLiveStatus(entry?: { status?: string | null; isOnline?: boolean; lastActive?: string | null } | null): 'online' | 'away' | 'offline' {
  if (!entry) return 'offline';
  if (isStalePresence(entry.lastActive)) return 'offline';
  if (entry.status === 'away') return 'away';
  if (entry.status === 'online' || entry.isOnline) return 'online';
  return 'offline';
}
