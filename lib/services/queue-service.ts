import { apiJson, apiFetch } from '../api-client';
import type { ReleaseTemplate, ReleaseCycle, ReleaseItemType } from '../types';

/**
 * Filas e Hotfixes, do lado do cliente — substituem as Server Actions
 * homônimas na separação front/back (ver lib/services/permission-service.ts).
 *
 * Formato de retorno mantido igual ao das actions (`{ error }` em vez de
 * exceção) para as telas não precisarem mudar o tratamento de erro no mesmo
 * passo em que mudam de transporte.
 */

export interface MutationResult {
  success?: true;
  error?: string;
  id?: string;
}

async function mutate(path: string, init: RequestInit, fallback: string): Promise<MutationResult> {
  try {
    return await apiJson(path, { ...init, fallbackError: fallback });
  } catch (err: any) {
    return { error: err?.message || fallback };
  }
}

// --------------------------------------------------------------------- filas

export interface QueueRecord {
  id: string;
  name: string;
  description: string | null;
  whatsappInstanceId: string | null;
  memberIds: string[];
  includeInternalChats: boolean;
  routingStrategy: string;
}

export async function getQueues(): Promise<QueueRecord[]> {
  try {
    return await apiJson<QueueRecord[]>('/api/queues');
  } catch (err) {
    console.error('Erro ao carregar filas:', err);
    return [];
  }
}

export async function saveQueue(
  id: string | null,
  name: string,
  description: string | null,
  whatsappInstanceId: string | null,
  memberIds: string[],
  includeInternalChats: boolean = true,
  routingStrategy: string = 'round_robin'
): Promise<MutationResult> {
  return mutate('/api/queues', {
    method: 'POST',
    body: JSON.stringify({ id, name, description, whatsappInstanceId, memberIds, includeInternalChats, routingStrategy })
  }, 'Erro ao salvar fila.');
}

export async function deleteQueue(id: string): Promise<MutationResult> {
  try {
    const res = await apiFetch(`/api/queues?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return { error: data?.error || 'Erro ao excluir fila.' };
    }
    return { success: true };
  } catch (err: any) {
    return { error: err?.message || 'Erro ao excluir fila.' };
  }
}

// ------------------------------------------------------------------ hotfixes

export interface HotfixRecord {
  id: string;
  name: string;
  description: string | null;
  responsibleId: string | null;
  productId: string | null;
  expectedDate: string;
  publishedAt?: string;
  releaseCycleId?: string | null;
  releaseItemId?: string | null;
  createdAt?: string;
}

export async function getHotfixes(): Promise<HotfixRecord[]> {
  try {
    return await apiJson<HotfixRecord[]>('/api/hotfixes');
  } catch (err) {
    console.error('Erro ao carregar hotfixes:', err);
    return [];
  }
}

export async function saveHotfix(
  id: string | null,
  name: string,
  description: string | null,
  responsibleId: string | null,
  expectedDate: string,
  productId: string | null = null
): Promise<MutationResult> {
  return mutate('/api/hotfixes', {
    method: 'POST',
    body: JSON.stringify({ id, name, description, responsibleId, expectedDate, productId })
  }, 'Erro ao salvar hotfix.');
}

export async function markHotfixPublished(id: string): Promise<MutationResult> {
  return mutate('/api/hotfixes', {
    method: 'POST',
    body: JSON.stringify({ action: 'publish', id })
  }, 'Erro ao marcar hotfix como publicado.');
}

export async function deleteHotfix(id: string): Promise<MutationResult> {
  try {
    const res = await apiFetch(`/api/hotfixes?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return { error: data?.error || 'Erro ao excluir hotfix.' };
    }
    return { success: true };
  } catch (err: any) {
    return { error: err?.message || 'Erro ao excluir hotfix.' };
  }
}

// ------------------------------------------------------- ciclo de publicação
// (/api/release-cycles — reestruturado em 2026-10-19: Ciclo é o intervalo
// com a timeline compartilhada; Hotfix/Publicação são ITENS dentro dele.)

export async function getReleaseTemplates(): Promise<ReleaseTemplate[]> {
  try {
    return await apiJson<ReleaseTemplate[]>('/api/release-cycles?action=templates');
  } catch (err) {
    console.error('Erro ao carregar modelos de ciclo:', err);
    return [];
  }
}

export async function saveReleaseTemplate(template: {
  id?: string | null;
  name: string;
  description?: string | null;
  isActive?: boolean;
  stages: Array<{
    name: string;
    description?: string | null;
    color?: string;
    icon?: string | null;
    offsetStartDays: number;
    offsetEndDays: number;
    defaultTeamId?: string | null;
    defaultResponsibleIds?: string[];
  }>;
}): Promise<MutationResult> {
  return mutate('/api/release-cycles', { method: 'POST', body: JSON.stringify({ action: 'save-template', ...template }) }, 'Erro ao salvar modelo.');
}

export async function deleteReleaseTemplate(id: string): Promise<MutationResult> {
  return mutate('/api/release-cycles', { method: 'POST', body: JSON.stringify({ action: 'delete-template', id }) }, 'Erro ao excluir modelo.');
}

export async function createReleaseCycle(data: {
  name: string;
  description?: string | null;
  responsibleId?: string | null;
  templateId?: string | null;
  anchorDate?: string | null;
  /** Por templateStageId — personaliza a cor de cada etapa gerada só neste ciclo. */
  stageColorOverrides?: Record<string, string>;
  /** Vincula hotfix(es) soltos ao ciclo recém-criado, já como item do tipo escolhido. */
  linkHotfixIds?: Array<{ hotfixId: string; itemType: ReleaseItemType; currentStageId?: string | null }>;
}): Promise<MutationResult & { cycle?: ReleaseCycle; linkErrors?: string[] }> {
  return mutate('/api/release-cycles', { method: 'POST', body: JSON.stringify({ action: 'create-cycle', ...data }) }, 'Erro ao criar ciclo.') as Promise<MutationResult & { cycle?: ReleaseCycle; linkErrors?: string[] }>;
}

/**
 * Vincula um hotfix SOLTO (fluxo achatado legado) a um ciclo já existente,
 * criando um release_item espelho do tipo escolhido — pedido do usuário,
 * 2026-10-21. ⚠️ Depende de migrations/hotfix_cycle_link.sql, ainda NÃO
 * aplicada em produção (moratória de banco) — a rota devolve 503 com
 * mensagem clara até lá.
 */
export async function linkHotfixToCycle(data: {
  hotfixId: string; cycleId: string; itemType: ReleaseItemType; currentStageId?: string | null;
}): Promise<MutationResult> {
  return mutate('/api/release-cycles', { method: 'POST', body: JSON.stringify({ action: 'link-hotfix', ...data }) }, 'Erro ao vincular hotfix ao ciclo.');
}

export async function addCycleStage(data: {
  cycleId: string; name: string; description?: string | null; color?: string; startDate: string; endDate: string;
}): Promise<MutationResult> {
  return mutate('/api/release-cycles', { method: 'POST', body: JSON.stringify({ action: 'add-stage', ...data }) }, 'Erro ao adicionar etapa.');
}

export async function updateCycleStage(stageId: string, data: {
  name?: string; description?: string | null; color?: string; startDate?: string; endDate?: string;
  teamId?: string | null; responsibleIds?: string[]; notes?: string | null;
}): Promise<MutationResult> {
  return mutate('/api/release-cycles', { method: 'POST', body: JSON.stringify({ action: 'update-stage', stageId, ...data }) }, 'Erro ao atualizar etapa.');
}

export async function deleteCycleStage(stageId: string): Promise<MutationResult> {
  return mutate('/api/release-cycles', { method: 'POST', body: JSON.stringify({ action: 'delete-stage', stageId }) }, 'Erro ao excluir etapa.');
}

export async function completeCycleStage(stageId: string): Promise<MutationResult & { locked?: boolean }> {
  return mutate('/api/release-cycles', { method: 'POST', body: JSON.stringify({ action: 'complete-stage', stageId }) }, 'Erro ao concluir etapa.') as Promise<MutationResult & { locked?: boolean }>;
}

export async function reopenCycleStage(stageId: string): Promise<MutationResult> {
  return mutate('/api/release-cycles', { method: 'POST', body: JSON.stringify({ action: 'reopen-stage', stageId }) }, 'Erro ao reabrir etapa.');
}

export async function saveCycleAsTemplate(cycleId: string, name: string): Promise<MutationResult> {
  return mutate('/api/release-cycles', { method: 'POST', body: JSON.stringify({ action: 'save-as-template', cycleId, name }) }, 'Erro ao transformar em modelo.');
}

// ---- Itens (Hotfix / Publicação) dentro de um ciclo ----

export async function createReleaseItem(data: {
  cycleId: string; itemType: ReleaseItemType; name: string; description?: string | null;
  responsibleId?: string | null; currentStageId?: string | null;
}): Promise<MutationResult> {
  return mutate('/api/release-cycles', { method: 'POST', body: JSON.stringify({ action: 'create-item', ...data }) }, 'Erro ao criar item.');
}

export async function updateReleaseItem(itemId: string, data: {
  name?: string; description?: string | null; responsibleId?: string | null; currentStageId?: string | null;
}): Promise<MutationResult> {
  return mutate('/api/release-cycles', { method: 'POST', body: JSON.stringify({ action: 'update-item', itemId, ...data }) }, 'Erro ao atualizar item.');
}

export async function deleteReleaseItem(itemId: string): Promise<MutationResult> {
  return mutate('/api/release-cycles', { method: 'POST', body: JSON.stringify({ action: 'delete-item', itemId }) }, 'Erro ao excluir item.');
}

export async function completeReleaseItem(itemId: string): Promise<MutationResult> {
  return mutate('/api/release-cycles', { method: 'POST', body: JSON.stringify({ action: 'complete-item', itemId }) }, 'Erro ao concluir item.');
}

export async function reopenReleaseItem(itemId: string): Promise<MutationResult> {
  return mutate('/api/release-cycles', { method: 'POST', body: JSON.stringify({ action: 'reopen-item', itemId }) }, 'Erro ao reabrir item.');
}

export async function linkItemTicket(itemId: string, kind: 'internal' | 'client', ticketId: string): Promise<MutationResult> {
  return mutate('/api/release-cycles', { method: 'POST', body: JSON.stringify({ action: 'link-ticket', itemId, kind, ticketId }) }, 'Erro ao vincular chamado.');
}

export async function unlinkItemTicket(itemId: string, kind: 'internal' | 'client', ticketId: string): Promise<MutationResult> {
  return mutate('/api/release-cycles', { method: 'POST', body: JSON.stringify({ action: 'unlink-ticket', itemId, kind, ticketId }) }, 'Erro ao desvincular chamado.');
}

export interface ItemLinkedTickets {
  internalTickets: { id: string; title: string; internalTicketNumber: number | null }[];
  clientTickets: { id: string; title: string; publicTicketNumber: number | null }[];
}

export async function getItemTickets(itemId: string): Promise<ItemLinkedTickets> {
  try {
    return await apiJson<ItemLinkedTickets>(`/api/release-cycles?action=item-tickets&itemId=${encodeURIComponent(itemId)}`);
  } catch (err) {
    console.error('Erro ao carregar chamados vinculados ao item:', err);
    return { internalTickets: [], clientTickets: [] };
  }
}

export interface StageAuditEntry {
  actorName: string;
  action: string;
  changes: any;
  createdAt?: string;
}

export async function getCycleStageAudit(stageId: string): Promise<StageAuditEntry[]> {
  try {
    return await apiJson<StageAuditEntry[]>(`/api/release-cycles?action=stage-audit&stageId=${encodeURIComponent(stageId)}`);
  } catch (err) {
    console.error('Erro ao carregar histórico da etapa:', err);
    return [];
  }
}

export async function getReleaseCycles(): Promise<ReleaseCycle[]> {
  try {
    return await apiJson<ReleaseCycle[]>('/api/release-cycles');
  } catch (err) {
    console.error('Erro ao carregar ciclos de publicação:', err);
    return [];
  }
}

export async function deleteReleaseCycle(id: string): Promise<MutationResult> {
  try {
    const res = await apiFetch(`/api/release-cycles?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return { error: data?.error || 'Erro ao excluir ciclo.' };
    }
    return { success: true };
  } catch (err: any) {
    return { error: err?.message || 'Erro ao excluir ciclo.' };
  }
}
