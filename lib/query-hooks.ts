'use client';

import { useQuery, QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Hooks de dado de REFERÊNCIA (muda pouco: empresas, analistas, listas de
// config) compartilhados entre filter-bar.tsx, modern-search-bar.tsx e
// ticket-detail-modal.tsx — a mesma queryKey faz os três reaproveitarem o
// MESMO resultado do TanStack Query em vez de cada um buscar sua própria
// cópia via supabase.from(...) (POST /api/compat/supabase, não cacheável
// por Cache-Control — por isso não foi resolvido na Fase 1, só aqui).
// Não usar pra dado "vivo" (chamados, mensagens, presença) — esses
// continuam com seu próprio fetch/polling/SSE, sem passar por aqui.
//
// Cada recurso é um par {queryKey, queryFn} reaproveitado tanto pelo hook
// quanto pelo prefetch on-hover (ver prefetchTicketModalReferenceData) —
// só existe um lugar definindo "como buscar X", pra hook e prefetch nunca
// divergirem.

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

const companiesDef = { queryKey: ['ref', 'companies'], queryFn: () => selectAll('companies') };

// "Lite": sem avatar_url. A tabela profiles tem ~51MB de fotos em base64
// (sync do Bitrix24, ver bitrix24-service.ts) — supabase.from('profiles')
// SEMPRE traz a linha inteira (o shim ignora a lista de colunas pedida em
// .select(), ver lib/supabase.ts), então buscar profiles por ali pra um
// simples dropdown de filtro custava o payload inteiro. Via /api/users
// dá pra escolher as colunas de verdade. Use esta para dropdown de
// filtro/responsável (filter-bar.tsx, modern-search-bar.tsx) — não serve
// pra quem precisa mostrar foto (ver profilesWithAvatarDef).
const profilesLiteDef = { queryKey: ['ref', 'profiles-lite'], queryFn: () => getJson('/api/users?type=lite') };

// Linha completa (com avatarUrl) — só para quem realmente precisa exibir
// foto (ticket-detail-modal.tsx). QueryKey separada da "lite" de propósito:
// nunca force os consumidores mais leves a pagar o payload de 51MB.
const profilesWithAvatarDef = { queryKey: ['ref', 'profiles-full'], queryFn: () => getJson('/api/users?type=all') };

function configStatusesDef(scope: 'ticket' | 'internal_ticket') {
  return {
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
  };
}

const configCategoriesDef = { queryKey: ['ref', 'config_categories'], queryFn: () => selectAll('config_categories') };
const configRequestTypesDef = { queryKey: ['ref', 'config_request_types'], queryFn: () => selectAll('config_request_types') };
const configProductsDef = { queryKey: ['ref', 'config_products'], queryFn: () => selectAll('config_products') };
const configPrioritiesDef = { queryKey: ['ref', 'config_priorities'], queryFn: () => selectAll('config_priorities') };
// Classificação de solução do chamado. Vai por /api/config (não pelo shim
// supabase.from) porque a rota já devolve camelCase com weight numérico e
// ordenado por sort_order — código novo não deve reintroduzir o shim.
const configEffortsDef = { queryKey: ['ref', 'config_efforts'], queryFn: () => getJson('/api/config?type=efforts') };
const configOutcomesDef = { queryKey: ['ref', 'config_outcomes'], queryFn: () => getJson('/api/config?type=outcomes') };

const internalTeamsDef = { queryKey: ['ref', 'internal_teams'], queryFn: () => selectAll('internal_teams') };
const queuesDef = { queryKey: ['ref', 'queues'], queryFn: () => selectAll('queues') };

// Papéis "de equipe" (Administrador/Equipe/Time Interno) — mesmo filtro de
// /api/users?type=analysts. Só usar onde o consumidor precisar exatamente
// desses 3 papéis e não precisar de campo "vivo" (status/status_reason de
// presença) — esses continuam com fetch próprio, sem cache de 60s.
const analystsDef = { queryKey: ['ref', 'analysts'], queryFn: () => getJson('/api/users?type=analysts') };

// `enabled` (opcional, default true) existe pra componentes que ficam
// sempre montados mas só devem buscar quando realmente visíveis/abertos
// (ex: modais renderizados incondicionalmente no layout, só o JSX interno
// é condicional em `isOpen`/`isXModalOpen` — sem isso, os hooks disparam
// em toda navegação do portal, não só quando o modal abre de fato).
interface QueryOptions { enabled?: boolean }

export function useCompaniesQuery(options?: QueryOptions) {
  return useQuery({ ...companiesDef, enabled: options?.enabled });
}

export function useProfilesLiteQuery(options?: QueryOptions) {
  return useQuery({ ...profilesLiteDef, enabled: options?.enabled });
}

export function useProfilesWithAvatarQuery(options?: QueryOptions) {
  return useQuery({ ...profilesWithAvatarDef, enabled: options?.enabled });
}

export function useConfigStatusesQuery(scope: 'ticket' | 'internal_ticket' = 'ticket', options?: QueryOptions) {
  return useQuery({ ...configStatusesDef(scope), enabled: options?.enabled });
}

export function useConfigCategoriesQuery(options?: QueryOptions) {
  return useQuery({ ...configCategoriesDef, enabled: options?.enabled });
}

export function useConfigRequestTypesQuery(options?: QueryOptions) {
  return useQuery({ ...configRequestTypesDef, enabled: options?.enabled });
}

export function useConfigProductsQuery(options?: QueryOptions) {
  return useQuery({ ...configProductsDef, enabled: options?.enabled });
}

export function useConfigPrioritiesQuery(options?: QueryOptions) {
  return useQuery({ ...configPrioritiesDef, enabled: options?.enabled });
}

export function useConfigEffortsQuery(options?: QueryOptions) {
  return useQuery({ ...configEffortsDef, enabled: options?.enabled });
}

export function useConfigOutcomesQuery(options?: QueryOptions) {
  return useQuery({ ...configOutcomesDef, enabled: options?.enabled });
}

export function useInternalTeamsQuery(options?: QueryOptions) {
  return useQuery({ ...internalTeamsDef, enabled: options?.enabled });
}

export function useQueuesQuery(options?: QueryOptions) {
  return useQuery({ ...queuesDef, enabled: options?.enabled });
}

export function useAnalystsQuery(options?: QueryOptions) {
  return useQuery({ ...analystsDef, enabled: options?.enabled });
}

// Prefetch on hover — dispara ANTES do clique (ver tickets-view.tsx, linha
// da lista de chamados) tudo que o ticket-detail-modal.tsx vai precisar.
// Se o usuário só passou o mouse e não clicou, o resultado fica no cache
// (staleTime) sem custo — na pior hipótese um fetch a mais que não foi
// usado; na melhor, o modal abre com os dados já prontos.
export function prefetchTicketModalReferenceData(queryClient: QueryClient) {
  const defs = [
    companiesDef,
    profilesWithAvatarDef,
    configStatusesDef('ticket'),
    configCategoriesDef,
    configRequestTypesDef,
    configProductsDef,
    configPrioritiesDef,
    configEffortsDef,
    configOutcomesDef,
    internalTeamsDef,
    queuesDef
  ];
  for (const def of defs) {
    queryClient.prefetchQuery(def);
  }
}
