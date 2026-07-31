'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Hooks de dado de REFERÊNCIA (muda pouco: empresas, analistas, listas de
// config) compartilhados entre filter-bar.tsx, modern-search-bar.tsx e
// ticket-detail-modal.tsx — a mesma queryKey faz os três reaproveitarem o
// MESMO resultado do TanStack Query em vez de cada um buscar sua própria
// cópia via supabase.from(...) (POST /api/compat/supabase, não cacheável
// por Cache-Control — por isso não foi resolvido na Fase 1, só aqui).
// Não usar pra dado "vivo" (chamados, mensagens, presença) — esses
// continuam com seu próprio fetch/polling/SSE, sem passar por aqui.

async function selectAll(table: string, columns = '*') {
  const { data, error } = await supabase.from(table).select(columns);
  if (error) throw new Error(error.message || `Falha ao buscar ${table}`);
  return data ?? [];
}

export function useCompaniesQuery() {
  return useQuery({ queryKey: ['ref', 'companies'], queryFn: () => selectAll('companies') });
}

export function useProfilesQuery() {
  return useQuery({ queryKey: ['ref', 'profiles'], queryFn: () => selectAll('profiles', '*, internal_team_ids') });
}

export function useConfigStatusesQuery(scope: 'ticket' | 'internal_ticket' = 'ticket') {
  return useQuery({
    queryKey: ['ref', 'config_statuses', scope],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('config_statuses')
        .select('*')
        .eq('scope', scope)
        .order('sort_order', { ascending: true });
      if (error) throw new Error(error.message || 'Falha ao buscar status');
      return data ?? [];
    }
  });
}

export function useConfigCategoriesQuery() {
  return useQuery({ queryKey: ['ref', 'config_categories'], queryFn: () => selectAll('config_categories') });
}

export function useConfigRequestTypesQuery() {
  return useQuery({ queryKey: ['ref', 'config_request_types'], queryFn: () => selectAll('config_request_types') });
}

export function useConfigProductsQuery() {
  return useQuery({ queryKey: ['ref', 'config_products'], queryFn: () => selectAll('config_products') });
}

export function useConfigPrioritiesQuery() {
  return useQuery({ queryKey: ['ref', 'config_priorities'], queryFn: () => selectAll('config_priorities') });
}

export function useInternalTeamsQuery() {
  return useQuery({ queryKey: ['ref', 'internal_teams'], queryFn: () => selectAll('internal_teams') });
}

export function useQueuesQuery() {
  return useQuery({ queryKey: ['ref', 'queues'], queryFn: () => selectAll('queues') });
}
