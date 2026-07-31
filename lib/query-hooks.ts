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

async function selectAll(table: string) {
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw new Error(error.message || `Falha ao buscar ${table}`);
  return data ?? [];
}

async function getJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao buscar ${url} (${res.status})`);
  return res.json();
}

export function useCompaniesQuery() {
  return useQuery({ queryKey: ['ref', 'companies'], queryFn: () => selectAll('companies') });
}

// "Lite": sem avatar_url. A tabela profiles tem ~51MB de fotos em base64
// (sync do Bitrix24, ver bitrix24-service.ts) — supabase.from('profiles')
// SEMPRE traz a linha inteira (o shim ignora a lista de colunas pedida em
// .select(), ver lib/supabase.ts), então buscar profiles por ali pra um
// simples dropdown de filtro custava o payload inteiro. Via /api/users
// dá pra escolher as colunas de verdade. Use esta para dropdown de
// filtro/responsável (filter-bar.tsx, modern-search-bar.tsx) — não serve
// pra quem precisa mostrar foto (ver useProfilesWithAvatarQuery).
export function useProfilesLiteQuery() {
  return useQuery({ queryKey: ['ref', 'profiles-lite'], queryFn: () => getJson('/api/users?type=lite') });
}

// Linha completa (com avatarUrl) — só para quem realmente precisa exibir
// foto (ticket-detail-modal.tsx). QueryKey separada da "lite" de propósito:
// nunca force os consumidores mais leves a pagar o payload de 51MB.
export function useProfilesWithAvatarQuery() {
  return useQuery({ queryKey: ['ref', 'profiles-full'], queryFn: () => getJson('/api/users?type=all') });
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
