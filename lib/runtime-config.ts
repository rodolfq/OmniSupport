/**
 * Endereços e credenciais dos serviços, em um lugar só.
 *
 * Existe por causa da separação do projeto em duas imagens (front e back).
 * Antes tudo era o mesmo processo, então endereço não era assunto: o navegador
 * chamava `/api/...` e caía no mesmo servidor que entregou a página. Com as
 * partes separadas, cada endereço vira configuração — e configuração espalhada
 * pelo código é o que torna esse tipo de migração dolorosa.
 *
 * REGRA IMPORTANTE: todo valor aqui tem padrão que preserva o comportamento
 * atual (um container só). Enquanto as variáveis não forem definidas, nada
 * muda. A separação só entra em vigor quando o ambiente for configurado, e
 * pode ser revertida tirando as variáveis — sem tocar em código.
 */

// ---------------------------------------------------------------------------
// Endereço da API (usado pelo NAVEGADOR)
// ---------------------------------------------------------------------------

/**
 * Base da API. Vazio = mesma origem da página (comportamento de hoje).
 * Preenchido = o navegador chama o back direto, ex.: https://api.empresa.com
 *
 * ATENÇÃO: `NEXT_PUBLIC_*` é embutida no bundle em tempo de BUILD, não lida em
 * runtime (ver CLAUDE.md, seção 11). Ou seja, esta variável precisa ir como
 * build arg no Dockerfile do FRONT — defini-la só no `env_file` não tem efeito
 * nenhum, e a falha é muda: as chamadas continuam relativas e batem no próprio
 * front, que não tem as rotas.
 */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');

/** true quando front e back estão separados de fato. */
export const IS_SPLIT_DEPLOYMENT = API_BASE_URL.length > 0;

// ---------------------------------------------------------------------------
// Configuração do COOKIE de sessão (usado pelo BACK ao emitir o cookie)
// ---------------------------------------------------------------------------

/**
 * Domínio do cookie de sessão. Vazio = host da própria resposta (hoje).
 *
 * Com front e back em SUBDOMÍNIOS do mesmo domínio (desk.empresa.com e
 * api.empresa.com), definir `.empresa.com` faz o cookie valer para os dois —
 * e, por serem o mesmo site registrável, `SameSite=Lax` continua servindo.
 *
 * Com domínios DIFERENTES não existe cookie compartilhado por domínio: aí é
 * obrigatório `COOKIE_SAMESITE=none` (que exige HTTPS nos dois lados).
 */
export const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;

/**
 * 'lax' (padrão) serve para mesma origem e para subdomínios do mesmo domínio.
 * 'none' é necessário quando front e back estão em domínios distintos — e o
 * navegador só aceita 'none' junto de Secure, ou seja, HTTPS obrigatório.
 */
export const COOKIE_SAMESITE = ((): 'lax' | 'none' | 'strict' => {
  const v = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  return v === 'none' || v === 'strict' ? v : 'lax';
})();

/**
 * Opções do cookie de sessão, montadas num lugar só para login e logout não
 * divergirem — cookie criado com um Domain e apagado com outro simplesmente
 * não é apagado, e o usuário fica "logado" com uma sessão fantasma.
 */
export function sessionCookieOptions(maxAgeSeconds?: number) {
  const secure = process.env.NODE_ENV === 'production' || COOKIE_SAMESITE === 'none';
  return {
    httpOnly: true,
    secure,
    sameSite: COOKIE_SAMESITE,
    path: '/',
    ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
    ...(maxAgeSeconds !== undefined ? { maxAge: maxAgeSeconds } : {})
  } as const;
}

// ---------------------------------------------------------------------------
// CORS (usado pelo BACK, para aceitar o front)
// ---------------------------------------------------------------------------

/**
 * Origens autorizadas a chamar a API com credenciais, separadas por vírgula.
 * Ex.: `https://desk.empresa.com,https://admin.empresa.com`
 *
 * Vazio = nenhuma origem externa é liberada, que é o certo enquanto o deploy é
 * um container só (a página e a API têm a mesma origem e CORS nem entra em
 * jogo). Curinga `*` NÃO é usado de propósito: com `credentials: include` o
 * navegador recusa `*`, e aceitar qualquer origem em API autenticada por
 * cookie abriria a porta para requisição forjada a partir de outro site.
 */
export const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  return CORS_ALLOWED_ORIGINS.includes(origin.replace(/\/$/, ''));
}

// ---------------------------------------------------------------------------
// Papel do container
// ---------------------------------------------------------------------------

/**
 * 'monolith' (padrão) = uma imagem só, serve páginas e API — como hoje.
 * 'backend'  = só API, jobs, WhatsApp e acesso ao banco.
 * 'frontend' = só as páginas; não abre conexão com o banco.
 *
 * Serve principalmente para decidir o que sobe no boot: os schedulers e a
 * conexão do WhatsApp precisam de UM dono. Se as duas imagens iniciarem os
 * mesmos jobs, mensagem automática sai duplicada para o cliente
 * (ver instrumentation-node.ts e CLAUDE.md, seção 11).
 */
export type ServiceRole = 'monolith' | 'backend' | 'frontend';

export const SERVICE_ROLE: ServiceRole = ((): ServiceRole => {
  const v = (process.env.SERVICE_ROLE || 'monolith').toLowerCase();
  return v === 'backend' || v === 'frontend' ? v : 'monolith';
})();

/** Só o dono dos jobs sobe schedulers e WhatsApp. */
export const SHOULD_RUN_BACKGROUND_JOBS = SERVICE_ROLE !== 'frontend';
