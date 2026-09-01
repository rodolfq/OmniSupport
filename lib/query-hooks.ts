'use client';

import { useQuery, QueryClient } from '@tanstack/react-query';
import type { WeekendScheduleResult } from '@/lib/services/weekend-schedule-service';

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

async function getJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao buscar ${url} (${res.status})`);
  return res.json();
}

// Toda lista de referência vem de rota própria. Antes vinham do shim
// (supabase.from(tabela).select('*')): além de aceitar nome de tabela como
// dado, ele responde por POST e portanto não é cacheável por HTTP. As rotas
// abaixo mandam Cache-Control, então o navegador também passa a ajudar.
const companiesDef = { queryKey: ['ref', 'companies'], queryFn: () => getJson('/api/companies') };

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
      // A rota já filtra por scope e ordena por sort_order.
      return getJson(`/api/config?type=statuses&scope=${scope}`);
    }
  };
}

const configCategoriesDef = { queryKey: ['ref', 'config_categories'], queryFn: () => getJson('/api/config?type=categories') };
const configRequestTypesDef = { queryKey: ['ref', 'config_request_types'], queryFn: () => getJson('/api/config?type=request-types') };
const configProductsDef = { queryKey: ['ref', 'config_products'], queryFn: () => getJson('/api/config?type=products') };
const configPrioritiesDef = { queryKey: ['ref', 'config_priorities'], queryFn: () => getJson('/api/config?type=priorities') };
// Classificação de solução do chamado. Vai por /api/config (não pelo shim
// supabase.from) porque a rota já devolve camelCase com weight numérico e
// ordenado por sort_order — código novo não deve reintroduzir o shim.
const configEffortsDef = { queryKey: ['ref', 'config_efforts'], queryFn: () => getJson('/api/config?type=efforts') };
const configOutcomesDef = { queryKey: ['ref', 'config_outcomes'], queryFn: () => getJson('/api/config?type=outcomes') };

const internalTeamsDef = { queryKey: ['ref', 'internal_teams'], queryFn: () => getJson('/api/config?type=internal-teams') };
const queuesDef = { queryKey: ['ref', 'queues'], queryFn: () => getJson('/api/config?type=queues') };

// Papéis "de equipe" (Administrador/Equipe/Time Interno) — mesmo filtro de
// /api/users?type=analysts. Só usar onde o consumidor precisar exatamente
// desses 3 papéis e não precisar de campo "vivo" (status/status_reason de
// presença) — esses continuam com fetch próprio, sem cache de 60s.
const analystsDef = { queryKey: ['ref', 'analysts'], queryFn: () => getJson('/api/users?type=analysts') };

// Escala de fim de semana (planilha do Google, ver
// lib/services/weekend-schedule-service.ts) — queryFn própria (não getJson)
// porque o erro 404 de "aba do mês não encontrada" carrega availableTabs no
// corpo, que a tela quer mostrar; getJson descarta o corpo no erro.
async function getWeekendScheduleJson(monthOffset = 0): Promise<WeekendScheduleResult> {
  const qs = monthOffset !== 0 ? `?month=${monthOffset}` : '';
  const res = await fetch(`/api/giro/weekend-schedule${qs}`);
  const body = await res.json();
  if (!res.ok) {
    const err = new Error(body?.error || `Falha ao buscar a escala de fim de semana (${res.status})`);
    (err as any).availableTabs = body?.availableTabs;
    throw err;
  }
  return body;
}

// monthOffset 0 usa a MESMA chave de sempre — é o que faz o popover do Giro
// (sempre mês atual) e a tela cheia (navegável) compartilharem cache quando
// a tela está no mês atual, ver comentário de refreshWeekendSchedule abaixo.
function weekendScheduleQueryKey(monthOffset: number) {
  return monthOffset === 0 ? ['ref', 'weekend-schedule'] : ['ref', 'weekend-schedule', monthOffset];
}

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

// staleTime próprio (mais generoso que o padrão de 60s): a planilha muda no
// máximo algumas vezes por dia, e o servidor já cacheia por 5 min (ver
// weekend-schedule-service.ts) — não faz sentido o cliente revalidar mais
// rápido que a própria fonte.
export function useWeekendScheduleQuery(options?: QueryOptions & { monthOffset?: number }) {
  const monthOffset = options?.monthOffset ?? 0;
  return useQuery({
    queryKey: weekendScheduleQueryKey(monthOffset),
    queryFn: () => getWeekendScheduleJson(monthOffset),
    staleTime: 5 * 60_000,
    enabled: options?.enabled,
  });
}

/**
 * Botão "Atualizar" (ver weekend-schedule-content.tsx) — ignora o cache do
 * servidor (?refresh=1) e escreve o resultado direto no cache do
 * TanStack Query, então popover e tela cheia atualizam juntos na hora (só
 * quando ambos estão no mês atual, monthOffset 0 — navegar pra outro mês na
 * tela cheia usa uma chave própria, sem interferir no popover).
 */
export async function refreshWeekendSchedule(queryClient: QueryClient, monthOffset = 0): Promise<WeekendScheduleResult> {
  const qs = monthOffset !== 0 ? `?refresh=1&month=${monthOffset}` : '?refresh=1';
  const res = await fetch(`/api/giro/weekend-schedule${qs}`);
  const body = await res.json();
  if (!res.ok) {
    const err = new Error(body?.error || `Falha ao atualizar a escala de fim de semana (${res.status})`);
    (err as any).availableTabs = body?.availableTabs;
    throw err;
  }
  queryClient.setQueryData(weekendScheduleQueryKey(monthOffset), body);
  return body;
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
