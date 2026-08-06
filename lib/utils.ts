import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function normalizeString(str: string) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizePhone(phone: string) {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

// Alguns contatos digitam um "0" de tronco antes do DDD (convenção antiga
// de discagem, ex.: "021991778567", "(021) 99177-8567") — nenhum DDD
// brasileiro de verdade começa com 0 (vão de 11 a 99), então um "0" líder
// aqui só pode ser esse prefixo, nunca parte do DDD. Removido antes de
// decidir se falta o "55" na frente (ver resolveChatSessionForPhone em
// lib/services/chat-service.ts e phoneLookupVariants em
// app/api/chats/route.ts) — sem isso, o número normalizado ficava com um
// dígito a mais e nunca batia com o telefone de verdade cadastrado.
export function stripTrunkPrefix(digits: string): string {
  if (digits.startsWith('0') && (digits.length === 11 || digits.length === 12)) {
    return digits.slice(1);
  }
  return digits;
}

// Forma canônica de um telefone brasileiro pra busca/criação de conversa —
// sempre "55" + DDD(2) + assinante(8 ou 9), a partir de dígitos já
// limpos (ver normalizePhone). Junta duas correções, nessa ordem:
// 1) stripTrunkPrefix (o "0" de tronco antes do DDD).
// 2) Dígitos a mais logo depois do "55" — alguém copia/cola um número já
//    com DDI e ainda sobra um DDD/prefixo redundante na frente (ex.:
//    "551121991778567" → o número de verdade é só os últimos 11 dígitos,
//    "21991778567"). Só corrige até 4 dígitos de excesso (total ≤ 17): além
//    disso é bem mais provável ser outra coisa (ID interno do WhatsApp,
//    protocolo) do que telefone de verdade, então preferimos deixar
//    "grande demais" pro chamador rejeitar em vez de inventar um número.
// Quando ainda não tem "55" e cabe em 11 dígitos (DDD+assinante sozinho),
// completa o prefixo.
export function normalizeBrazilianPhoneDigits(rawDigits: string): string {
  let digits = stripTrunkPrefix(rawDigits);

  if (digits.startsWith('55') && digits.length > 13 && digits.length <= 17) {
    const excess = digits.length - 13;
    digits = `55${digits.slice(2 + excess)}`;
  }

  if (digits.length <= 11 && !digits.startsWith('55')) {
    digits = `55${digits}`;
  }

  return digits;
}

export function matchPhones(p1: string | undefined, p2: string | undefined): boolean {
  if (!p1 || !p2) return false;
  
  const n1 = normalizePhone(p1);
  const n2 = normalizePhone(p2);
  
  if (n1 === n2) return true;
  
  // Handle Brazilian 55 prefix differences
  const s1 = n1.startsWith('55') ? n1.slice(2) : n1;
  const s2 = n2.startsWith('55') ? n2.slice(2) : n2;
  
  if (s1 === s2) return true;

  // Handle 9-digit mobile vs 8-digit landline (common in Brazil)
  // If one has 11 digits (DD9XXXXXXXX) and other has 10 (DDXXXXXXXX)
  if (s1.length === 11 && s2.length === 10) {
    return s1.slice(0, 2) === s2.slice(0, 2) && s1.slice(3) === s2.slice(2);
  }
  if (s2.length === 11 && n1.length === 10) {
    return s2.slice(0, 2) === s1.slice(0, 2) && s2.slice(3) === s1.slice(2);
  }

  return false;
}

export function maskPhone(value: string) {
  if (!value) return ""
  let v = value.replace(/\D/g, "")
  if (v.length > 11) v = v.slice(0, 11)
  
  if (v.length <= 10) {
    v = v.replace(/^(\d{2})(\d)/g, "($1) $2")
    v = v.replace(/(\d{4})(\d)/, "$1-$2")
  } else {
    v = v.replace(/^(\d{2})(\d)/g, "($1) $2")
    v = v.replace(/(\d{5})(\d)/, "$1-$2")
  }
  return v
}

export function stripNotificationHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function safeJsonStringify(obj: any) {
  const cache = new Set();
  try {
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        // 1. Handle circular references first
        if (cache.has(value)) {
          return '[Circular]';
        }
        
        // 2. Filter out DOM nodes, react internal keys, and Event objects
        try {
          // Identify if it's a DOM element or React internal node
          const isDom = typeof value.nodeType === 'number' && typeof value.nodeName === 'string';
          const isReactInternal = typeof key === 'string' && (
            key.startsWith('__reactFiber') || 
            key.startsWith('__reactProps') || 
            key.startsWith('__reactInternal') ||
            key.startsWith('_react') ||
            key === 'stateNode'
          );
          
          if (isDom || isReactInternal) {
            return isDom ? `[DOM ${value.nodeName}]` : '[React Internal]';
          }
          
          // Constructor check
          if (value.constructor && typeof value.constructor.name === 'string') {
            const name = value.constructor.name;
            if (['FiberNode', 'HTMLElement', 'HTMLDivElement', 'Window', 'Document', 'Event'].some(n => name.includes(n))) {
              return `[${name}]`;
            }
          }
        } catch (e) {
          return '[Unsafe Object]';
        }
        
        // 3. Mark as visited
        cache.add(value);
      }
      return value;
    });
  } catch (err) {
    console.error('safeJsonStringify failed:', err);
    return '"[Serialization Failed]"';
  }
}
