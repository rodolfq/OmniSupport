import { apiJson, apiResourceUrl } from '../api-client';
import type {
  GiroDay,
  GiroChecklistItem,
  GiroParticipant,
  GiroRow,
  GiroHistoryEntry,
  GiroServiceType
} from '../types';

/**
 * Giro de Atendimento, do lado do cliente. Mesmo contrato dos demais services
 * de tela (ver lib/services/queue-service.ts): erro volta como `{ error }` em
 * vez de exceção, para a tela mostrar um toast sem try/catch em cada chamada.
 */

export interface MutationResult {
  success?: true;
  error?: string;
  reinserted?: boolean;
  /** Só preenchido por saveGiroChecklistItem ao criar um item novo. */
  id?: string;
}

async function mutate(path: string, body: any, fallback: string): Promise<MutationResult> {
  try {
    return await apiJson(path, { method: 'POST', body: JSON.stringify(body), fallbackError: fallback });
  } catch (err: any) {
    return { error: err?.message || fallback };
  }
}

// ------------------------------------------------------------------ leitura

/**
 * Sem `date`, a API devolve o dia de hoje segundo o fuso do Brasil — é assim
 * que a tela descobre a data corrente, em vez de confiar no relógio da máquina
 * de quem está olhando.
 */
export async function getGiroDay(date?: string): Promise<GiroDay | { error: string }> {
  try {
    return await apiJson<GiroDay>(date ? `/api/giro?date=${encodeURIComponent(date)}` : '/api/giro');
  } catch (err: any) {
    return { error: err?.message || 'Erro ao carregar o Giro.' };
  }
}

export interface GiroSummary {
  date: string;
  exists: boolean;
  current: GiroRow | null;
  handoffName: string | null;
  rows: GiroRow[];
  history: GiroHistoryEntry[];
  myRowId: string | null;
  meetUrl: string | null;
}

export async function getGiroSummary(): Promise<GiroSummary | { error: string }> {
  try {
    return await apiJson<GiroSummary>('/api/giro?action=summary');
  } catch (err: any) {
    return { error: err?.message || 'Erro ao carregar o Giro de hoje.' };
  }
}

// Escala de fim de semana: ver useWeekendScheduleQuery/refreshWeekendSchedule
// em lib/query-hooks.ts — passou a usar o cache do TanStack Query (mesma
// chave compartilhada entre a tela cheia e o popover do Giro), em vez de um
// fetch avulso por componente como as outras leituras deste arquivo.

/** sheetId null = usando o link padrão embutido no código (ninguém trocou ainda). */
export interface WeekendScheduleConfig {
  sheetId: string | null;
}

export async function getWeekendScheduleConfig(): Promise<WeekendScheduleConfig | { error: string }> {
  try {
    return await apiJson<WeekendScheduleConfig>('/api/giro/weekend-schedule/config');
  } catch (err: any) {
    return { error: err?.message || 'Erro ao carregar a configuração da escala.' };
  }
}

/** sheetLink vazio/null volta a usar o link padrão. Aceita a URL inteira ou só o ID. */
export async function saveWeekendScheduleConfig(sheetLink: string | null): Promise<MutationResult> {
  return mutate('/api/giro/weekend-schedule/config', { sheetLink }, 'Erro ao salvar o link da planilha.');
}

// ---------------------------------------------------------------- operação

export interface UpdateRowPatch {
  serviceType?: GiroServiceType;
  serviceTime?: string | null;
  note?: string | null;
  lunchTime?: string | null;
  checklist?: Record<string, boolean>;
}

export function updateGiroRow(rowId: string, patch: UpdateRowPatch): Promise<MutationResult> {
  return mutate('/api/giro', { action: 'update-row', rowId, ...patch }, 'Erro ao salvar a linha.');
}

export function completeGiroService(rowId: string): Promise<MutationResult> {
  return mutate('/api/giro', { action: 'complete', rowId }, 'Erro ao concluir o atendimento.');
}

/**
 * Chamado pelo botão "Assumir" de um chamado Sem Analista — nunca pela tela
 * do Giro. Sempre fire-and-forget e silencioso: assumir o chamado não pode
 * falhar por causa do Giro, e não participar do Giro hoje não é um erro.
 */
export async function claimGiroTurnForTicket(ticketNumber: number | null, ticketId: string): Promise<void> {
  try {
    await apiJson('/api/giro', {
      method: 'POST',
      body: JSON.stringify({ action: 'claim-ticket', ticketNumber, ticketId })
    });
  } catch {
    // silencioso de propósito — ver comentário acima
  }
}

export function reorderGiro(dayId: string, orderedRowIds: string[]): Promise<MutationResult> {
  return mutate('/api/giro', { action: 'reorder', dayId, orderedRowIds }, 'Erro ao reordenar o Giro.');
}

/**
 * Recebe a DATA (não o id do dia): o giro daquela data pode ainda não
 * existir — a API cria a linha internamente antes de inserir a pessoa.
 */
export function addGiroMember(date: string, userId: string): Promise<MutationResult> {
  return mutate('/api/giro', { action: 'add-member', date, userId }, 'Erro ao incluir no Giro do dia.');
}

export function removeGiroMember(dayId: string, rowId: string): Promise<MutationResult> {
  return mutate('/api/giro', { action: 'remove-member', dayId, rowId }, 'Erro ao remover do Giro do dia.');
}

export function setGiroHandoff(dayId: string, mode: 'auto' | 'pinned' | 'none', userId?: string | null): Promise<MutationResult> {
  return mutate('/api/giro', { action: 'set-handoff', dayId, mode, userId }, 'Erro ao definir a passagem de turno.');
}

export function reprocessGiro(date: string): Promise<MutationResult> {
  return mutate('/api/giro', { action: 'reprocess', date }, 'Erro ao reprocessar o Giro.');
}

export function deleteGiroHistory(historyId: string): Promise<MutationResult> {
  return mutate('/api/giro', { action: 'delete-history', historyId }, 'Erro ao excluir o registro.');
}

// ------------------------------------------------------------- configuração

export interface GiroCandidate {
  id: string;
  name: string;
  role: string;
  avatarUrl?: string | null;
  avatarThumbUrl?: string | null;
}

export interface GiroConfig {
  participants: GiroParticipant[];
  checklistItems: GiroChecklistItem[];
  candidates: GiroCandidate[];
  meetUrl: string | null;
}

export async function getGiroConfig(): Promise<GiroConfig | { error: string }> {
  try {
    return await apiJson<GiroConfig>('/api/giro/config');
  } catch (err: any) {
    return { error: err?.message || 'Erro ao carregar a configuração do Giro.' };
  }
}

export function saveGiroParticipant(input: {
  userId: string;
  workSchedule?: string | null;
  positionType?: 'free' | 'fixed';
  fixedPosition?: number | null;
  outOfRotation?: boolean;
  absentUntil?: string | null;
  absenceNote?: string | null;
}): Promise<MutationResult> {
  return mutate('/api/giro/config', { action: 'save-participant', ...input }, 'Erro ao salvar o participante.');
}

export function deleteGiroParticipant(userId: string): Promise<MutationResult> {
  return mutate('/api/giro/config', { action: 'delete-participant', userId }, 'Erro ao remover o participante.');
}

/**
 * Reordena os LIVRES — a "ordem programada" que os demais seguem quando não
 * há giro anterior pra herdar. Quem tem posição fixa não entra aqui: a ordem
 * dele é o número escolhido, não um índice de lista.
 */
export function reorderGiroParticipants(orderedUserIds: string[]): Promise<MutationResult> {
  return mutate('/api/giro/config', { action: 'reorder-participants', orderedUserIds }, 'Erro ao reordenar os participantes.');
}

export function saveGiroChecklistItem(input: {
  id?: string | null;
  label: string;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<MutationResult> {
  return mutate('/api/giro/config', { action: 'save-checklist-item', ...input }, 'Erro ao salvar o item.');
}

export function deleteGiroChecklistItem(id: string): Promise<MutationResult> {
  return mutate('/api/giro/config', { action: 'delete-checklist-item', id }, 'Erro ao excluir o item.');
}

/** Link fixo da sala de reunião (Meet) — passe null/vazio pra apagar. */
export function saveGiroMeetUrl(meetUrl: string | null): Promise<MutationResult> {
  return mutate('/api/giro/config', { action: 'save-meet-url', meetUrl }, 'Erro ao salvar o link da reunião.');
}

/**
 * URL do CSV. É um link normal (o navegador baixa direto) em vez de fetch +
 * Blob: o arquivo já vem pronto do servidor com o nome no Content-Disposition,
 * e montar o download na mão só duplicaria isso.
 */
export function giroExportUrl(startDate: string, endDate: string): string {
  return apiResourceUrl(`/api/giro/export?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
}
