// Freio de força bruta no login.
//
// Antes não havia nenhum: /api/auth/login aceitava tentativas ilimitadas, o que
// torna viável varrer senhas fracas de qualquer conta cujo e-mail se conheça —
// e os e-mails são previsíveis (nome@empresa). O hash é PBKDF2 com 10.000
// iterações, então cada tentativa custa CPU do servidor: sem freio, isso também
// é um vetor de sobrecarga.
//
// Estado em MEMÓRIA, por processo — mesma escolha (e mesma limitação) do
// limitador da API de integração em lib/integration-auth.ts. Funciona porque o
// deploy roda um container só, de propósito (ver CLAUDE.md seção 11). Com mais
// de uma réplica o limite afrouxa proporcionalmente, e a saída é a mesma:
// mover o contador para o Postgres ou Redis. Reiniciar o container zera os
// contadores; é aceitável para conter varredura, não para punir.
//
// Duas chaves independentes, e o pedido é barrado se QUALQUER uma estourar:
//
//   por IP     — contém quem varre muitas contas a partir de um ponto só;
//   por e-mail — contém quem varre uma conta a partir de muitos pontos
//                (proxy/botnet), caso que a chave por IP não pega.
//
// Só tentativa FALHA conta. Login certo limpa o contador daquela chave, então
// quem acerta a senha nunca é barrado por ter errado antes.

interface Bucket {
  failures: number;
  // Momento até o qual está bloqueado (epoch ms). 0 = liberado.
  blockedUntil: number;
  // Última falha — usado para expirar o registro por inatividade.
  lastFailureAt: number;
}

const buckets = new Map<string, Bucket>();

/** Falhas toleradas antes do primeiro bloqueio. */
const MAX_FAILURES = 5;
/** Falhas sem bloqueio são esquecidas depois disto. */
const FAILURE_TTL_MS = 15 * 60 * 1000;
/** Bloqueio inicial; dobra a cada nova falha durante o bloqueio. */
const BASE_BLOCK_MS = 60 * 1000;
const MAX_BLOCK_MS = 30 * 60 * 1000;
/** Teto de chaves guardadas, para o Map não virar vazamento de memória. */
const MAX_BUCKETS = 10_000;

function now(): number {
  return Date.now();
}

// Limpeza preguiçosa: roda junto das checagens em vez de num setInterval, para
// não segurar o processo vivo nem depender de agendador.
function evictStale(): void {
  const t = now();
  for (const [key, b] of buckets) {
    if (b.blockedUntil <= t && t - b.lastFailureAt > FAILURE_TTL_MS) {
      buckets.delete(key);
    }
  }
  // Ainda cheio depois da limpeza (varredura ativa em curso): descarta os mais
  // antigos. Perder contador de quem parou de tentar é preferível a crescer sem
  // limite.
  if (buckets.size > MAX_BUCKETS) {
    const ordered = [...buckets.entries()].sort((a, b) => a[1].lastFailureAt - b[1].lastFailureAt);
    for (const [key] of ordered.slice(0, buckets.size - MAX_BUCKETS)) {
      buckets.delete(key);
    }
  }
}

export interface LoginThrottleResult {
  blocked: boolean;
  /** Segundos até liberar — vira o header Retry-After. */
  retryAfterSeconds: number;
}

/**
 * Consulta, sem registrar nada. Chamar ANTES de tocar no banco: uma tentativa
 * barrada não deve custar consulta nem cálculo de hash.
 */
export function checkLoginThrottle(keys: string[]): LoginThrottleResult {
  evictStale();
  const t = now();
  let longest = 0;
  for (const key of keys) {
    const b = buckets.get(key);
    if (b && b.blockedUntil > t) longest = Math.max(longest, b.blockedUntil - t);
  }
  return {
    blocked: longest > 0,
    retryAfterSeconds: Math.ceil(longest / 1000)
  };
}

/** Registra uma tentativa malsucedida e devolve o estado resultante. */
export function registerLoginFailure(keys: string[]): LoginThrottleResult {
  const t = now();
  let longest = 0;

  for (const key of keys) {
    const b = buckets.get(key) || { failures: 0, blockedUntil: 0, lastFailureAt: t };

    // Falhas antigas e sem bloqueio não se acumulam com as de agora: quem errou
    // duas vezes hoje de manhã não deve começar a tarde já perto do limite.
    if (b.blockedUntil <= t && t - b.lastFailureAt > FAILURE_TTL_MS) {
      b.failures = 0;
    }

    b.failures += 1;
    b.lastFailureAt = t;

    if (b.failures >= MAX_FAILURES) {
      // Dobra a cada falha além do limite: 1min, 2, 4, 8, 16, 30 (teto). Torna
      // varredura inviável sem trancar de vez quem só esqueceu a senha.
      const excess = b.failures - MAX_FAILURES;
      const duration = Math.min(BASE_BLOCK_MS * Math.pow(2, excess), MAX_BLOCK_MS);
      b.blockedUntil = t + duration;
    }

    buckets.set(key, b);
    if (b.blockedUntil > t) longest = Math.max(longest, b.blockedUntil - t);
  }

  evictStale();
  return {
    blocked: longest > 0,
    retryAfterSeconds: Math.ceil(longest / 1000)
  };
}

/** Login bem-sucedido: zera os contadores das chaves envolvidas. */
export function clearLoginFailures(keys: string[]): void {
  for (const key of keys) buckets.delete(key);
}

/**
 * Monta as chaves do pedido. O e-mail entra normalizado para que variações de
 * caixa e espaço não contem como alvos diferentes.
 *
 * Atrás de proxy reverso o IP real vem em X-Forwarded-For (o primeiro da
 * lista); sem ele, cai numa chave fixa, e nesse caso o limite por IP vira
 * global — por isso a chave por e-mail existe, ela continua valendo.
 */
export function buildLoginKeys(request: Request, email: string): string[] {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || 'desconhecido';
  const normalizedEmail = (email || '').trim().toLowerCase();
  return [`ip:${ip}`, `email:${normalizedEmail}`];
}
