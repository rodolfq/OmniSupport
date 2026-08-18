import { Ticket } from './types';

export async function fetchAllTickets(signal?: AbortSignal, options?: { includeClosed?: boolean }): Promise<Ticket[]> {
  let remoteTickets: Ticket[] = [];
  
  try {
    const url = options?.includeClosed ? '/api/tickets?includeClosed=true' : '/api/tickets';
    const res = await fetch(url, { signal });
    if (res.ok) {
      remoteTickets = await res.json();
    }
  } catch (e) {
    console.warn("Error fetching tickets on client:", e);
  }
  
  return remoteTickets;
}

export async function createTicket(ticket: Ticket): Promise<void> {
  let userId = ticket.customerId;
  
  const meRes = await fetch('/api/auth/me');
  if (meRes.ok) {
    const meData = await meRes.json();
    if (meData.user) {
      userId = meData.user.id;
    }
  }

  const res = await fetch('/api/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create', ticket, userId })
  });
  
  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.error || 'Erro ao criar ticket');
  }
}
