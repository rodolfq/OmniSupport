// Notificação em UMA aba só (2026-11-13, pedido do usuário: "notificação
// acontecendo em todas as abas abertas, precisa ser só na ativa").
//
// Cada aba do portal consulta /api/notifications/check (e ouve o tempo real
// do chat) por conta própria, então o mesmo aviso chegava em todas: som,
// toast e notificação do Windows repetidos N vezes. A coordenação é toda no
// navegador, via localStorage (compartilhado entre abas do mesmo site):
//
// - Toda aba VISÍVEL marca a presença (heartbeat) a cada poucos segundos.
// - Aba visível avisa normalmente e "reivindica" o aviso.
// - Aba em segundo plano NÃO avisa enquanto houver alguma aba visível — a
//   visível vai receber o mesmo aviso pela própria consulta e avisar ela.
// - Sem nenhuma aba visível (janela minimizada / outro programa em foco), as
//   abas disputam a reivindicação e só a primeira avisa (notificação do SO).
//
// As consultas das abas não são sincronizadas — por isso a aba escondida não
// "ganha" de uma visível: ela simplesmente não avisa se há uma visível.
// A reivindicação roda sob navigator.locks quando disponível (atômico entre
// abas); sem ele, localStorage puro (raríssima duplicata possível).

const VISIBLE_KEY = 'omni_visible_tab_at';
const CLAIMS_KEY = 'omni_notif_claims';
const VISIBLE_FRESH_MS = 6000;
const CLAIM_TTL_MS = 10 * 60 * 1000;
const HIDDEN_DELAY_MS = 1200;

function now() { return Date.now(); }

function isThisTabVisible(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'visible';
}

// Id desta aba (só em memória): o registro de presença é um mapa aba → hora,
// pra que a aba que ficou escondida possa tirar SÓ a própria marca na hora —
// senão as outras achariam por alguns segundos que ainda há aba visível e
// ninguém avisaria.
const TAB_ID = Math.random().toString(36).slice(2);

function readVisible(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(VISIBLE_KEY) || '{}') || {}; } catch { return {}; }
}

function writeVisible(map: Record<string, number>) {
  try { localStorage.setItem(VISIBLE_KEY, JSON.stringify(map)); } catch { /* sem storage: segue sem coordenação */ }
}

function anotherTabIsVisible(): boolean {
  const t = now();
  return Object.entries(readVisible()).some(([id, at]) => id !== TAB_ID && t - at < VISIBLE_FRESH_MS);
}

function markVisible() {
  const map = readVisible();
  const t = now();
  for (const id of Object.keys(map)) if (t - map[id] > VISIBLE_FRESH_MS) delete map[id];
  if (isThisTabVisible()) map[TAB_ID] = t;
  else delete map[TAB_ID];
  writeVisible(map);
}

/** Liga o heartbeat de "tem aba visível". Chamar uma vez por aba; devolve a limpeza. */
export function startVisibleTabHeartbeat(): () => void {
  if (typeof window === 'undefined') return () => {};
  markVisible();
  const timer = setInterval(markVisible, 2000);
  const onChange = () => markVisible();
  document.addEventListener('visibilitychange', onChange);
  window.addEventListener('focus', onChange);
  const onUnload = () => { const map = readVisible(); delete map[TAB_ID]; writeVisible(map); };
  window.addEventListener('pagehide', onUnload);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onChange);
    window.removeEventListener('focus', onChange);
    window.removeEventListener('pagehide', onUnload);
    onUnload();
  };
}

function tryClaim(key: string): boolean {
  try {
    const raw = localStorage.getItem(CLAIMS_KEY);
    const claims: Record<string, number> = raw ? JSON.parse(raw) : {};
    const t = now();
    for (const k of Object.keys(claims)) if (t - claims[k] > CLAIM_TTL_MS) delete claims[k];
    if (claims[key]) return false;
    claims[key] = t;
    localStorage.setItem(CLAIMS_KEY, JSON.stringify(claims));
    return true;
  } catch {
    return true;
  }
}

async function claim(key: string): Promise<boolean> {
  const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined;
  if (locks?.request) {
    try {
      return await locks.request('omni-notif-claim', () => tryClaim(key));
    } catch {
      return tryClaim(key);
    }
  }
  return tryClaim(key);
}

/**
 * true = ESTA aba deve avisar (som/toast/notificação do SO) o aviso `key`.
 * O aviso no sininho é gravado em todas as abas, independente disto.
 */
export async function shouldThisTabAlert(key: string): Promise<boolean> {
  if (typeof window === 'undefined') return true;
  if (isThisTabVisible()) {
    markVisible();
    return claim(key);
  }
  // Escondida: espera um pouco (dá tempo de uma aba visível marcar presença)
  // e só avisa se não houver nenhuma visível.
  await new Promise(r => setTimeout(r, HIDDEN_DELAY_MS));
  if (anotherTabIsVisible()) return false;
  return claim(key);
}
