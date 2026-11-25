// Regras de link do texto rico (chamado e ticket interno, 2026-11-25).
// Sem import de React/Next/pg: usado no editor (navegador) e na conversão
// para WhatsApp/e-mail (servidor).
//
// O HTML das notas e descrições é exibido com dangerouslySetInnerHTML, sem
// sanitização. Por isso o editor só aceita estes esquemas — `javascript:`,
// `data:`, `vbscript:`, `file:` etc. nunca viram href.
export const ALLOWED_LINK_PROTOCOLS = ['http', 'https', 'mailto', 'tel'] as const;

const ALLOWED_SCHEME_RE = /^(https?:\/\/|mailto:|tel:)/i;
const ANY_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s().-]{8,}$/;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?([/?#].*)?$/;

/** href pode ser gravado? (usado também pela extensão Link ao ler HTML antigo) */
export function isAllowedLinkHref(href: string | null | undefined): boolean {
  const value = (href || '').replace(/\s/g, '');
  if (!value) return false;
  if (!ANY_SCHEME_RE.test(value)) return true; // relativo (/api/files/...) ou âncora
  return ALLOWED_SCHEME_RE.test(value);
}

/**
 * Normaliza o que a pessoa digitou no campo de endereço:
 * "site.com.br" → "https://site.com.br", "fulano@x.com" → "mailto:...",
 * "+55 11 99999-9999" → "tel:+5511999999999". Devolve null se não for um
 * endereço aceitável (esquema proibido, espaço no meio, sem domínio).
 */
export function normalizeLinkUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  if (ALLOWED_SCHEME_RE.test(value)) {
    if (/^https?:\/\//i.test(value)) {
      try {
        const url = new URL(value);
        return url.hostname.includes('.') || url.hostname === 'localhost' ? value : null;
      } catch {
        return null;
      }
    }
    if (/^mailto:/i.test(value)) return EMAIL_RE.test(value.slice(7).split('?')[0]) ? value : null;
    const digits = value.slice(4).replace(/[^\d+]/g, '');
    return digits.replace('+', '').length >= 8 ? `tel:${digits}` : null;
  }
  // Outro esquema qualquer (javascript:, data:, ftp:...) não entra.
  if (ANY_SCHEME_RE.test(value) && !/^[^:]+:\d/.test(value)) return null;

  if (EMAIL_RE.test(value)) return `mailto:${value}`;
  // IP de equipamento (DVR, rastreador) vira endereço web, nunca telefone.
  // http:// e não https://: equipamento em rede local raramente tem certificado.
  if (IPV4_RE.test(value)) return `http://${value}`;
  // Telefone só com separador típico (+, espaço, parênteses, hífen) ou só
  // dígitos — nunca quando o único separador é o ponto.
  if (PHONE_RE.test(value) && !/[a-z]/i.test(value) && !/\./.test(value)) return `tel:${value.replace(/[^\d+]/g, '')}`;

  if (/\s/.test(value)) return null;
  try {
    const url = new URL(`https://${value}`);
    return url.hostname.includes('.') ? `https://${value}` : null;
  } catch {
    return null;
  }
}

/** Endereço para mostrar a uma pessoa (sem "mailto:"/"tel:"). */
export function displayLinkUrl(href: string): string {
  return href.replace(/^(mailto|tel):/i, '');
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Troca cada <a href="X">texto</a> por "texto (X)" — para destinos que não
 * renderizam HTML (WhatsApp, e-mail de texto). Sem isso o link virava só o
 * texto e o destino se perdia. Quando o texto já é o próprio endereço, sai só
 * o endereço, sem repetir. O conteúdo de dentro (ex.: <strong>) é mantido para
 * a conversão seguinte cuidar dele. Âncora com href proibido vira só o texto.
 */
export function htmlLinksToText(html: string): string {
  if (!html) return html;
  return html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs: string, inner: string) => {
    const hrefMatch = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const href = decodeBasicEntities((hrefMatch?.[2] ?? hrefMatch?.[3] ?? hrefMatch?.[4] ?? '').trim());
    if (!href || !isAllowedLinkHref(href) || href.startsWith('/') || href.startsWith('#')) return inner;
    const shown = displayLinkUrl(href);
    const innerText = decodeBasicEntities(inner.replace(/<[^>]*>/g, '')).trim();
    const same = (a: string) => a.replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
    if (!innerText || same(innerText) === same(shown)) return shown;
    return `${inner} (${shown})`;
  });
}
