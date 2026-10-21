'use client';

import { useCallback, useState } from 'react';

/**
 * Lembra a escolha de visualização (Kanban/Tabela/Cards etc.) do usuário no
 * navegador — pedido do usuário, 2026-10-21: "não precisa criar sempre".
 * `localStorage`, não banco: é preferência de tela, por dispositivo/navegador,
 * sem motivo pra virar coluna/sincronizar entre aparelhos.
 *
 * SSR-safe (lê `window` só no cliente, lazy initializer) e defensivo contra
 * `localStorage` indisponível (aba privada, política do navegador) ou valor
 * salvo que não é mais uma opção válida (versão antiga do código) — nesses
 * casos cai no padrão, nunca quebra a tela.
 */
export function usePersistedViewMode<T extends string>(storageKey: string, defaultValue: T, allowed: readonly T[]): [T, (next: T | ((prev: T) => T)) => void] {
  const key = `ssx:view-mode:${storageKey}`;

  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const raw = window.localStorage.getItem(key);
      return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  // Mesma assinatura do setter do useState (aceita valor direto OU função
  // atualizadora) — alguns chamadores já usavam a forma funcional antes
  // desta persistência existir.
  const setPersisted = useCallback((next: T | ((prev: T) => T)) => {
    setValue(prev => {
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
      try {
        window.localStorage.setItem(key, resolved);
      } catch {
        // localStorage indisponível — a escolha só não sobrevive a um F5, sem quebrar a troca de visualização.
      }
      return resolved;
    });
  }, [key]);

  return [value, setPersisted];
}
