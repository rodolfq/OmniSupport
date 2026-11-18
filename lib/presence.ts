// Deriva o status "de verdade" de um analista a partir de analyst_status —
// sem heartbeat de verdade (fechar a aba sem logout explícito não grava
// nada), um status "online"/"away" salvo há muito tempo ficava para sempre
// disponível na tela, mesmo com o sistema fechado há dias. Qualquer lugar
// que exiba a bolinha de presença deve passar por aqui em vez de ler
// isOnline/status crus.
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutos sem heartbeat = offline (status "online")
// "Ausente" ganha uma janela bem mais larga que "Online" antes de também
// cair pra offline — de propósito, não é o mesmo prazo. Durante o próprio
// motivo de estar Ausente (almoço, reunião fora, etc.) é comum fechar a tampa
// do notebook ou travar a tela, o que já para o heartbeat de 60s (ele só roda
// com a aba "visible", ver app-context.tsx) — um limite de 5 min trataria
// "foi almoçar" como "desapareceu" antes mesmo da pessoa voltar, e quebraria
// o Giro de Atendimento, que depende de "Ausente > Almoço" continuar valendo
// durante o almoço inteiro (lib/services/giro-service.ts, pedido do usuário
// 2026-09-28: "o usuário em almoço não faz parte do giro"). 4h cobre almoço/
// reunião/pausa longa com folga de sobra, e ainda assim resolve o que foi
// relatado (2026-11-18): alguém que ficou Ausente e nunca mais voltou
// (fechou o notebook de vez, trocou de computador, saiu da empresa) não fica
// aparecendo pra sempre como alvo de transferência — só não desaparece no
// mesmo instante em que qualquer "online" desapareceria.
const AWAY_STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 horas sem heartbeat = offline (status manual "Ausente")

export function isStalePresence(lastActive?: string | null, thresholdMs: number = STALE_THRESHOLD_MS): boolean {
  if (!lastActive) return true;
  const last = new Date(lastActive).getTime();
  if (Number.isNaN(last)) return true;
  return Date.now() - last > thresholdMs;
}

export function deriveLiveStatus(entry?: { status?: string | null; isOnline?: boolean; lastActive?: string | null } | null): 'online' | 'away' | 'offline' {
  if (!entry) return 'offline';
  // "Ausente" (ou qualquer status manual) foi escolha do próprio usuário e
  // continua valendo até ele mesmo trocar OU até ficar realmente velho demais
  // (AWAY_STALE_THRESHOLD_MS) — nunca reverte sozinho pra "Online" por falta
  // de batimento (2026-10-08, decisão preservada: só "online" cai direto pra
  // offline por heartbeat perdido; "Ausente" tem a janela mais larga acima,
  // não é imune pra sempre).
  if (entry.status === 'away') {
    return isStalePresence(entry.lastActive, AWAY_STALE_THRESHOLD_MS) ? 'offline' : 'away';
  }
  if (isStalePresence(entry.lastActive)) return 'offline';
  if (entry.status === 'online' || entry.isOnline) return 'online';
  return 'offline';
}
