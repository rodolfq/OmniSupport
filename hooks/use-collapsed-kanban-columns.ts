'use client';

import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/app/app-context';

/**
 * Colunas recolhidas de um Kanban (2026-11-24, "como no Odoo"): a coluna vira
 * uma faixa vertical estreita com o nome e a contagem. É preferência de
 * VISUALIZAÇÃO de cada pessoa, por quadro — fica no navegador (localStorage),
 * chaveada pelo usuário, e some sem prejuízo se o navegador limpar os dados.
 * A chave da coluna é o rótulo do status, então recolher "Concluído" vale em
 * todas as filas do mesmo quadro.
 */
export function useCollapsedKanbanColumns(boardKey: string) {
  const { currentUser } = useApp();
  const storageKey = `kanban-collapsed:${currentUser?.id || 'anon'}:${boardKey}`;
  const [collapsed, setCollapsed] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setCollapsed(Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []);
    } catch {
      setCollapsed([]);
    }
  }, [storageKey]);

  const toggleCollapsed = useCallback((column: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(column) ? prev.filter((c) => c !== column) : [...prev, column];
      try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* sem storage: vale só nesta visita */ }
      return next;
    });
  }, [storageKey]);

  const isCollapsed = useCallback((column: string) => collapsed.includes(column), [collapsed]);

  return { isCollapsed, toggleCollapsed };
}
