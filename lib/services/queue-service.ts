import { apiJson, apiFetch } from '../api-client';

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
