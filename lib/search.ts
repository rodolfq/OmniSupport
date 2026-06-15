import { supabase } from './supabase';
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
}

export interface SearchResult {
  tickets: Ticket[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// Search tickets with server-side pagination and filtering
export async function searchTickets(
  filters: SearchFilters,
  page: number = 1,
  pageSize: number = 25,
  signal?: AbortSignal
): Promise<SearchResult> {
  // Fallback to fetchAllTickets if supabase not available
  if (!supabase) {
    return { tickets: [], total: 0, page, pageSize, hasMore: false };
  }

  try {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query: any = supabase.from('tickets').select('*');

    if (filters.query) {
      query = query.ilike('title', `%${filters.query}%`);
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.priority) {
      query = query.eq('priority', filters.priority);
    }

    query = query.order('created_at', { ascending: false }).range(from, to);

    const { data, error } = await query;

    if (error) {
      console.error('Supabase query error:', { message: error?.message, details: error?.details, hint: error?.hint, code: error?.code });
      return { tickets: [], total: 0, page, pageSize, hasMore: false };
    }

    const tickets = (data || []).map((t: any) => ({
      ...t,
      ticketNumber: t.public_ticket_number,
      companyId: t.company_id,
      customerId: t.customer_id,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    })) as Ticket[];

    return {
      tickets,
      total: tickets.length,
      page,
      pageSize,
      hasMore: false,
    };
  } catch (err: any) {
    console.error('Unexpected error in searchTickets:', err);
    return { tickets: [], total: 0, page, pageSize, hasMore: false };
  }
}

// Get search suggestions (recent searches)
export async function getSearchSuggestions(
  userId: string,
  limit: number = 5
): Promise<string[]> {
  if (!supabase) return [];

  const { data } = await supabase
    .from('user_search_history')
    .select('query')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data || []).map((h: any) => h.query);
}

// Save search to history
export async function saveSearchHistory(
  userId: string,
  query: string
): Promise<void> {
  if (!supabase) return;

  // Remove duplicates first
  await supabase
    .from('user_search_history')
    .delete()
    .eq('user_id', userId)
    .eq('query', query);

  // Add new search
  await supabase.from('user_search_history').insert({
    user_id: userId,
    query,
    created_at: new Date().toISOString(),
  });
}

// Save a custom view/filter
export async function saveCustomView(
  userId: string,
  name: string,
  filters: SearchFilters
): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase.from('saved_views').insert({
    user_id: userId,
    name,
    filters: filters as any,
    created_at: new Date().toISOString(),
  });

  if (error) throw error;
}

// Get saved views
export async function getSavedViews(userId: string): Promise<SavedFilter[]> {
  if (!supabase) return [];

  const { data } = await supabase
    .from('saved_views')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  return (data || []).map((v: any) => ({
    id: v.id,
    name: v.name,
    filters: v.filters,
  }));
}

// Get quick stats for counters
export async function getTicketStats(filters: Partial<SearchFilters> = {}): Promise<{
  total: number;
  open: number;
  inProgress: number;
  closed: number;
  overdue: number;
}> {
  if (!supabase) {
    return { total: 0, open: 0, inProgress: 0, closed: 0, overdue: 0 };
  }

  // Total count
  let totalQuery = supabase.from('tickets').select('*', { count: 'exact', head: true });
  
  // Open count
  let openQuery = supabase.from('tickets').select('*', { count: 'exact', head: true })
    .eq('status', TicketStatus.NEW);

  // In progress count
  let inProgressQuery = supabase.from('tickets').select('*', { count: 'exact', head: true })
    .eq('status', TicketStatus.IN_PROGRESS);

  // Closed count
  let closedQuery = supabase.from('tickets').select('*', { count: 'exact', head: true })
    .eq('status', TicketStatus.CLOSED);

  const [{ count: total }, { count: open }, { count: inProgress }, { count: closed }] = 
    await Promise.all([totalQuery, openQuery, inProgressQuery, closedQuery]);

  // Overdue would need join with priorities
  const overdue = 0;

  return {
    total: total || 0,
    open: open || 0,
    inProgress: inProgress || 0,
    closed: closed || 0,
    overdue,
  };
}