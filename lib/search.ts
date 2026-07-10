import type { Ticket, SavedFilter } from './types';
import { TicketStatus } from './types';

export interface SearchFilters {
  query?: string;
  status?: TicketStatus | '';
  priority?: string;
  companyId?: string;
  assigneeId?: string;
  categoryId?: string;
  startDate?: string;
  endDate?: string;
  slaOverdue?: boolean;
  tags?: string[];
  customerId?: string;
  includeClosed?: boolean;
}

export interface SearchResult {
  tickets: Ticket[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export async function searchTickets(
  filters: SearchFilters,
  page: number = 1,
  pageSize: number = 25,
  signal?: AbortSignal
): Promise<SearchResult> {
  const qParams = new URLSearchParams({
    action: 'tickets',
    query: filters.query || '',
    status: filters.status || '',
    priority: filters.priority || '',
    includeClosed: String(filters.includeClosed || false),
    page: String(page),
    pageSize: String(pageSize)
  });
  
  const res = await fetch(`/api/search?${qParams.toString()}`);
  return res.json();
}

export async function getSearchSuggestions(
  userId: string,
  limit: number = 5
): Promise<string[]> {
  const res = await fetch(`/api/search?action=suggestions&userId=${userId}&limit=${limit}`);
  return res.json();
}

export async function saveSearchHistory(
  userId: string,
  q: string
): Promise<void> {
  const res = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'save-history', userId, query: q })
  });
  if (!res.ok) throw new Error('Error saving search history via API');
}

export async function saveCustomView(
  userId: string,
  name: string,
  filters: SearchFilters
): Promise<void> {
  const res = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'save-view', userId, name, filters })
  });
  if (!res.ok) throw new Error('Error saving custom view via API');
}

export async function getSavedViews(userId: string): Promise<SavedFilter[]> {
  const res = await fetch(`/api/search?action=views&userId=${userId}`);
  return res.json();
}

export async function getTicketStats(filters: Partial<SearchFilters> = {}): Promise<{
  total: number;
  open: number;
  inProgress: number;
  closed: number;
  overdue: number;
}> {
  const res = await fetch('/api/search?action=stats');
  return res.json();
}