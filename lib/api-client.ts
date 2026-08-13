import { API_BASE_URL, IS_SPLIT_DEPLOYMENT } from './runtime-config';

/**
 * Ponto único por onde a tela fala com a API.
 *
 * Motivo de existir: com front e back em imagens separadas, o navegador passa a
 * chamar outro host, e requisição para outra origem só leva o cookie de sessão
 * com `credentials: 'include'`. Eram 159 chamadas `fetch('/api/...')` espalhadas
 * por 39 arquivos — repetir base de URL e credenciais em cada uma seria erro
 * garantido, e do tipo silencioso: a chamada volta 401 e a tela mostra "sessão
 * inválida" sem dizer que o cookie simplesmente não foi enviado.
 *
 * Enquanto NEXT_PUBLIC_API_URL não estiver definida, `apiUrl` devolve o caminho
 * relativo e tudo se comporta exatamente como antes.
 */

/** Resolve o caminho da API para URL completa (ou relativa, no monolito). */
export function apiUrl(path: string): string {
  if (!IS_SPLIT_DEPLOYMENT) return path;
  return path.startsWith('/') ? `${API_BASE_URL}${path}` : `${API_BASE_URL}/${path}`;
}

/**
 * `fetch` para a API, com o cookie de sessão sempre incluído.
 *
 * `credentials: 'include'` é obrigatório entre origens diferentes e inofensivo
 * na mesma origem — deixá-lo fixo evita que uma chamada nova esqueça dele e
 * falhe só em produção, onde as origens de fato divergem.
 */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), {
    credentials: 'include',
    ...init
  });
}

/**
 * Atalho para as chamadas que mandam e recebem JSON — a esmagadora maioria.
 * Repassa a mensagem de erro que a API devolveu, em vez de um "erro
 * inesperado" genérico que esconde a causa.
 */
export async function apiJson<T = any>(
  path: string,
  init?: RequestInit & { fallbackError?: string }
): Promise<T> {
  const { fallbackError, ...rest } = init || {};
  const res = await apiFetch(path, {
    ...rest,
    headers: {
      ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
      ...(rest.headers || {})
    }
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || fallbackError || `Falha ao chamar ${path} (${res.status})`);
  }
  return res.json();
}

/**
 * Endereço para SSE e outros recursos consumidos por APIs do navegador que não
 * passam por `fetch` (EventSource, <img src>, <a href> de download).
 *
 * EventSource entre origens diferentes precisa de `withCredentials: true` na
 * construção — quem usar este helper tem que lembrar disso; não dá para embutir
 * aqui porque a opção é do EventSource, não da URL.
 */
export function apiResourceUrl(path: string): string {
  return apiUrl(path);
}
