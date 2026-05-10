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
          // Basic DOM check
          if (typeof value.nodeType === 'number' && typeof value.nodeName === 'string') {
            return `[DOM ${value.nodeName}]`;
          }
          
          // Key based filtering for React internals
          if (typeof key === 'string' && (
            key.startsWith('__reactFiber') || 
            key.startsWith('__reactProps') || 
            key.startsWith('__reactInternal') ||
            key.startsWith('_react') ||
            key === 'stateNode'
          )) {
            return '[React Internal]';
          }
          
          // Constructor name check is very effective
          if (value.constructor && typeof value.constructor.name === 'string') {
            const name = value.constructor.name;
            const forbiddenNames = [
              'FiberNode', 'Fiber', 'HTMLElement', 'HTMLDivElement', 
              'HTMLButtonElement', 'HTMLSpanElement', 'Window', 'Document', 
              'Event', 'SyntheticEvent', 'SyntheticBaseEvent'
            ];
            if (forbiddenNames.some(forbidden => name.includes(forbidden))) {
              return `[${name}]`;
            }
          }

          // Recursive check for event-like properties
          if (typeof value.preventDefault === 'function' && typeof value.stopPropagation === 'function') {
            return '[Event]';
          }
          
          // Check for window/global to avoid huge dumps
          if (value === window || (typeof global !== 'undefined' && value === global)) {
             return '[Global Object]';
          }
        } catch (e) {
          // If we can't inspect the object, it's safer to just represent it as a string
          return '[Unsafe Object]';
        }
        
        // 3. Mark as visited
        cache.add(value);
      }
      return value;
    });
  } catch (err) {
    console.error('Final fallback in safeJsonStringify:', err);
    try {
      // One last desperate attempt: just stringify the type and constructor
      return JSON.stringify(`[Serialization Failed: ${err instanceof Error ? err.message : String(err)}]`);
    } catch {
      return '"[Serialization Failed]"';
    }
  }
}
