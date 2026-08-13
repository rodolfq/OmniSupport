// Este arquivo não usa mais o shim de compatibilidade Supabase: tudo passa
// por /api/tickets e /api/internal-tickets. Não reintroduza `lib/supabase`
// aqui — o tradutor genérico de SQL está sendo desativado (ver CLAUDE.md).
import { Ticket, Message, InternalTicket } from '../types';
import { Permission } from '../types';

export class TicketService {
  static async getById(id: string, signal?: AbortSignal): Promise<Ticket | null> {
    try {
      const res = await fetch(`/api/tickets?id=${encodeURIComponent(id)}`, { signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Falha ao buscar chamado (HTTP ${res.status}).`);
      // A rota já devolve camelCase (inclusive customerName/assigneeName), o
      // que o caminho antigo montava aqui a partir da linha crua.
      return (await res.json()) as Ticket;
    } catch (err: any) {
      // Aborto é fluxo normal (o modal cancela a busca ao trocar de chamado),
      // não erro — mesmo tratamento que existia antes.
      if (err?.name === 'AbortError') return null;
      throw err;
    }
  }

  // Envia SÓ as chaves presentes: a rota trata ausente como "não mexe" e
  // null/'' como "limpa" (ver o PUT em app/api/tickets/route.ts). Enviar o
  // objeto inteiro com undefined funcionaria igual, porque JSON.stringify
  // descarta undefined — mas deixar explícito evita que uma mudança futura
  // no formato quebre a limpeza de campo em silêncio.
  static async update(ticket: Partial<Ticket> & { id: string }): Promise<void> {
    const { id, ...fields } = ticket;
    const res = await fetch(`/api/tickets?id=${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || 'Erro ao salvar o chamado.');
    }
  }

  // Lista curta e só informativa dos outros chamados recentes da mesma
  // empresa — aba "Chamados Recentes" em ticket-detail-modal.tsx, e base de
  // busca do modal "Vincular Chamado" em chat-widget.tsx (via `search`).
  static async getRecentByCompany(companyId: string, excludeTicketId?: string, limit = 5, search?: string): Promise<Ticket[]> {
    const qs = new URLSearchParams({ action: 'recent-by-company', companyId, limit: String(limit) });
    if (excludeTicketId) qs.set('excludeId', excludeTicketId);
    if (search) qs.set('search', search);
    const res = await fetch(`/api/tickets?${qs.toString()}`);
    if (!res.ok) return [];
    return res.json();
  }

  // Lista completa paginada de chamados de uma empresa — tela dedicada
  // /customers/[id] (item 13 do roadmap). Diferente de getRecentByCompany:
  // suporta offset real e retorna o total pra "carregar mais".
  static async getByCompanyPaginated(companyId: string, limit = 15, offset = 0): Promise<{ tickets: Ticket[]; total: number }> {
    const qs = new URLSearchParams({ action: 'by-company', companyId, limit: String(limit), offset: String(offset) });
    const res = await fetch(`/api/tickets?${qs.toString()}`);
    if (!res.ok) return { tickets: [], total: 0 };
    return res.json();
  }

  static calculateSLA(createdAt: string, priorityLabel: string): string | undefined {
    const prioritySLA: Record<string, number> = {
      'Baixa': 120,
      'Média': 72,
      'Alta': 24,
      'Urgente': 12
    };
    
    const slaHours = prioritySLA[priorityLabel];
    if (!slaHours) return undefined;

    const date = new Date(createdAt);
    date.setHours(date.getHours() + slaHours);
    return date.toISOString();
  }
}

export class MessageService {
  static async getByTicket(ticketId: string, signal?: AbortSignal): Promise<Message[]> {
    try {
      const res = await fetch(`/api/tickets?action=messages&ticketId=${encodeURIComponent(ticketId)}`, { signal });
      if (!res.ok) throw new Error(`Falha ao buscar mensagens (HTTP ${res.status}).`);
      // Mesma ordenação (created_at DESC) e mesmo formato que este método
      // montava antes — a rota já devolve camelCase.
      return (await res.json()) as Message[];
    } catch (err: any) {
      if (err?.name === 'AbortError') return [];
      throw err;
    }
  }

  static async create(message: Message): Promise<void> {
    // O `id` é omitido de propósito. Quem chama (ticket-detail-modal) gera um
    // id curto de random() para a mensagem de sistema, que NÃO é UUID válido —
    // o caminho antigo simplesmente não enviava a coluna e deixava o default
    // do banco agir. A rota usa `message.id` quando ele vem, então mandá-lo
    // faria o insert falhar no tipo uuid.
    const { id, ...rest } = message;
    void id;

    const res = await fetch('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create-message', message: rest })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || 'Erro ao gravar a mensagem.');
    }
  }

  static async getByInternalTicket(internalTicketId: string, signal?: AbortSignal): Promise<Message[]> {
    try {
      const res = await fetch(
        `/api/internal-tickets?action=messages&internalTicketId=${encodeURIComponent(internalTicketId)}`,
        { signal }
      );
      if (!res.ok) throw new Error(`Falha ao buscar mensagens (HTTP ${res.status}).`);
      return (await res.json()) as Message[];
    } catch (err: any) {
      if (err?.name === 'AbortError') return [];
      throw err;
    }
  }

  static async createInternal(message: Message, internalTicketId: string): Promise<void> {
    const res = await fetch('/api/internal-tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'message', internalTicketId, message })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || 'Erro ao gravar a mensagem.');
    }
  }
}

export class InternalTicketService {
  // Erro aqui devolve lista vazia / null em vez de propagar: o consumidor é
  // uma aba secundária do chamado, e derrubar a tela inteira por causa dela
  // seria pior. Mesmo comportamento de antes.
  private static async fetchByParent(parentTicketId: string): Promise<InternalTicket[]> {
    try {
      const res = await fetch(`/api/internal-tickets?action=by-parent&ticketId=${encodeURIComponent(parentTicketId)}`);
      if (!res.ok) {
        console.error('Erro ao buscar tickets internos do chamado:', res.status);
        return [];
      }
      return (await res.json()) as InternalTicket[];
    } catch (err) {
      console.error('Erro ao buscar tickets internos do chamado:', err);
      return [];
    }
  }

  static async getByParent(parentTicketId: string): Promise<InternalTicket | null> {
    const all = await InternalTicketService.fetchByParent(parentTicketId);
    return all[0] || null;
  }

  static async getByParentAll(parentTicketId: string): Promise<InternalTicket[]> {
    return InternalTicketService.fetchByParent(parentTicketId);
  }

  // Açúcar sobre saveWithDetails, devolvendo só o id formatado (int-0001).
  // O antigo terceiro parâmetro (parentTicketNumber) saiu: nenhum chamador o
  // passava e ele só aparecia num console.log — o número do ticket interno
  // nunca veio do chamado pai (ver a rota).
  static async save(ticket: InternalTicket, parentTicketId?: string): Promise<string> {
    const result = await InternalTicketService.saveWithDetails(ticket, parentTicketId);
    return result.id;
  }
  
  static async saveWithDetails(ticket: InternalTicket, parentTicketId?: string): Promise<{ uuid: string; id: string }> {
    if (!ticket.title) throw new Error('O título é obrigatório.');
    if (!ticket.creatorId) throw new Error('creatorId é obrigatório.');

    // Criação e edição usam a mesma action: quem decide é a presença do uuid,
    // igual ao que este método já fazia. O cálculo do prazo (SLA) e a geração
    // do número mudaram de lugar para o servidor — ver os comentários em
    // app/api/internal-tickets/route.ts sobre a corrida no número.
    const res = await fetch('/api/internal-tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', ticket, parentTicketId })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || 'Erro ao salvar o ticket interno.');
    }
    return res.json();
  }

  // Vincula um ticket interno já existente (criado solto ou por outro
  // chamado) a mais um chamado — é o que sustenta o N:N: um ticket interno
  // pode cobrir vários chamados, e este é o segundo (ou terceiro...) vínculo.
  static async linkExisting(ticketId: string, internalTicketId: string): Promise<void> {
    const res = await fetch('/api/internal-tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'link', ticketId, internalTicketId })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || 'Erro ao vincular o ticket interno.');
    }
  }

  static async unlink(ticketId: string, internalTicketId: string): Promise<void> {
    const qs = new URLSearchParams({ ticketId, internalTicketId });
    const res = await fetch(`/api/internal-tickets?${qs}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || 'Erro ao desvincular o ticket interno.');
    }
  }

  // Registra uma entrada de sistema (status mudou, responsável mudou...) na
  // própria thread de mensagens do ticket interno — mesma ideia do type
  // 'system' já usado no chat (ver assignChatSession em app/actions.ts).
  // Isso faz o histórico do ticket interno ficar unificado (comentário e
  // evento no mesmo feed) e alimenta a notificação de status sem precisar
  // de nenhuma tabela nova.
  static async logEvent(internalTicketId: string, authorId: string | undefined, text: string, type: 'system' | 'system_log' = 'system'): Promise<void> {
    try {
      const res = await fetch('/api/internal-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'message',
          internalTicketId,
          message: { senderId: authorId || null, text, type }
        })
      });
      // Falha aqui nunca interrompe quem chamou: o registro é histórico, e
      // perder a linha do histórico é melhor do que abortar a gravação do
      // ticket que acabou de acontecer. Mesmo comportamento de antes.
      if (!res.ok) console.error('InternalTicketService.logEvent falhou:', res.status);
    } catch (err) {
      console.error('InternalTicketService.logEvent falhou:', err);
    }
  }
}
