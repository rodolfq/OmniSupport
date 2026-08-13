import { CategoryConfig, PriorityConfig, StatusConfig, TagConfig, QuickNote, SurveySettings, EmailSettings, ProductConfig, EffortConfig, OutcomeConfig } from '../types';
import { registerClosedStatusLabels } from '../ticket-status';

// Listas de rótulo simples, referenciadas por id no chamado — as únicas em
// que renomear não exige migrar dado.
export type SimpleListType = 'categories' | 'request-types' | 'products';

// /api/config manda Cache-Control nas listas de referência (categorias,
// produtos, status, tags...) — o que é bom para as telas que só LEEM, mas
// venenoso aqui: quem chama o ConfigService é a tela de Configurações, que
// relê a lista logo depois de gravar. Com o cache do navegador no caminho, a
// releitura devolvia a lista ANTIGA e o item recém-criado sumia da tela mesmo
// tendo sido gravado — sem erro nenhum, porque o POST tinha funcionado.
// `no-store` só aqui: quem lê por lib/query-hooks.ts continua aproveitando o
// cache HTTP.
async function fetchConfig(type: string, extraQuery = ''): Promise<Response> {
  return fetch(`/api/config?type=${type}${extraQuery}`, { cache: 'no-store' });
}

export class ConfigService {
  static async getCategories(): Promise<CategoryConfig[]> {
    const res = await fetchConfig('categories');
    return res.json();
  }

  static async getProducts(): Promise<ProductConfig[]> {
    const res = await fetchConfig('products');
    return res.json();
  }

  // As três listas simples de rótulo (categoria, tipo de solicitação,
  // produto). Um único conjunto de métodos porque a rota trata as três no
  // mesmo branch — ver o comentário lá sobre por que Prioridade e Status
  // ficam de fora do rename simples.
  private static async postSimpleItem(
    type: SimpleListType,
    body: Record<string, unknown>,
    fallbackError: string
  ) {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...body })
    });
    if (!res.ok) {
      // A rota devolve mensagem pronta para nome duplicado (409); repassá-la
      // é o que permite a tela mostrar "Já existe um item com esse nome."
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || fallbackError);
    }
    return res.json().catch(() => null);
  }

  static async createSimpleItem(type: SimpleListType, label: string): Promise<{ id: string; label: string }> {
    return ConfigService.postSimpleItem(type, { action: 'save', item: { label } }, 'Erro ao criar o item.');
  }

  static async renameSimpleItem(type: SimpleListType, id: string, label: string): Promise<void> {
    await ConfigService.postSimpleItem(type, { action: 'save', item: { id, label } }, 'Erro ao renomear o item.');
  }

  // Excluir de verdade. A rota recusa com 409 quando algum chamado usa o item
  // — nesse caso o caminho é arquivar, e a mensagem de erro já diz isso.
  static async deleteSimpleItem(type: SimpleListType, id: string): Promise<void> {
    await ConfigService.postSimpleItem(type, { action: 'delete', item: { id } }, 'Erro ao remover o item.');
  }

  // Aposenta a opção sem apagá-la: some dos seletores de chamado novo, mas o
  // chamado antigo continua exibindo o rótulo. Ver ArchivableConfig.
  static async archiveSimpleItem(type: SimpleListType, id: string): Promise<void> {
    await ConfigService.postSimpleItem(type, { action: 'archive', item: { id } }, 'Erro ao arquivar o item.');
  }

  static async restoreSimpleItem(type: SimpleListType, id: string): Promise<void> {
    await ConfigService.postSimpleItem(type, { action: 'restore', item: { id } }, 'Erro ao restaurar o item.');
  }

  // `withUsage` traz quantos registros usam cada item — só a tela de
  // Configurações precisa, para escolher entre arquivar e excluir.
  static async getSimpleList(
    type: SimpleListType,
    withUsage = false
  ): Promise<(CategoryConfig & { usageCount?: number })[]> {
    const res = await fetchConfig(type, withUsage ? '&usage=1' : '');
    if (!res.ok) throw new Error('Erro ao carregar a lista.');
    return res.json();
  }

  // Renomear status/sub-status. Endpoint separado do saveStatus porque a
  // operação não é só trocar o rótulo: o servidor migra na mesma transação
  // toda coluna de texto que guarda esse nome (tickets.status, sub_status,
  // internal_tickets.status, automation_settings.trigger_status). Devolve
  // quantos registros foram migrados, pra tela poder informar.
  static async renameStatus(id: string, label: string): Promise<{ label: string; migrated: number }> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'statuses', action: 'rename', status: { id, label } })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || 'Erro ao renomear o status.');
    }
    return res.json();
  }

  // Classificação de solução do ticket interno — duas listas independentes,
  // ambas editáveis em Configurações
  // (ver migrations/internal_ticket_effort_outcome.sql).
  static async getEfforts(withUsage = false): Promise<EffortConfig[]> {
    const res = await fetchConfig('efforts', withUsage ? '&usage=1' : '');
    return res.json();
  }

  static async archiveEffort(id: string, archived: boolean): Promise<EffortConfig> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'efforts', action: archived ? 'archive' : 'restore', effort: { id } })
    });
    if (!res.ok) throw new Error(archived ? 'Erro ao arquivar.' : 'Erro ao restaurar.');
    return res.json();
  }

  static async saveEffort(effort: Partial<EffortConfig> & { label: string }): Promise<EffortConfig> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'efforts', action: 'save', effort })
    });
    if (!res.ok) throw new Error('Erro ao salvar nível de esforço.');
    return res.json();
  }

  static async deleteEffort(id: string): Promise<void> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'efforts', action: 'delete', effort: { id } })
    });
    if (!res.ok) throw new Error('Erro ao remover nível de esforço.');
  }

  static async getOutcomes(withUsage = false): Promise<OutcomeConfig[]> {
    const res = await fetchConfig('outcomes', withUsage ? '&usage=1' : '');
    return res.json();
  }

  static async archiveOutcome(id: string, archived: boolean): Promise<OutcomeConfig> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'outcomes', action: archived ? 'archive' : 'restore', outcome: { id } })
    });
    if (!res.ok) throw new Error(archived ? 'Erro ao arquivar.' : 'Erro ao restaurar.');
    return res.json();
  }

  static async saveOutcome(outcome: Partial<OutcomeConfig> & { label: string }): Promise<OutcomeConfig> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'outcomes', action: 'save', outcome })
    });
    if (!res.ok) throw new Error('Erro ao salvar desfecho.');
    return res.json();
  }

  static async deleteOutcome(id: string): Promise<void> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'outcomes', action: 'delete', outcome: { id } })
    });
    if (!res.ok) throw new Error('Erro ao remover desfecho.');
  }

  static async saveCategory(category: CategoryConfig): Promise<void> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'categories', category })
    });
    if (!res.ok) throw new Error('Error saving category via API');
  }

  static async getPriorities(): Promise<PriorityConfig[]> {
    const res = await fetchConfig('priorities');
    return res.json();
  }

  // Devolve a linha gravada: a tela de Configurações confere o SLA persistido
  // contra o que enviou antes de considerar a operação concluída.
  static async savePriority(priority: Partial<PriorityConfig> & { label: string }): Promise<any> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'priorities', priority })
    });
    if (!res.ok) throw new Error('Erro ao salvar a prioridade.');
    return res.json();
  }

  static async getStatuses(scope?: 'ticket' | 'internal_ticket'): Promise<StatusConfig[]> {
    const qs = scope ? `&scope=${scope}` : '';
    const res = await fetchConfig('statuses', qs);
    const data = await res.json();
    const normalized: StatusConfig[] = (data || []).map((s: any) => ({
      ...s,
      isClosed: s.isClosed ?? s.is_closed ?? false,
      sortOrder: s.sortOrder ?? s.sort_order ?? 0,
      parentStatusId: s.parentStatusId ?? s.parent_status_id ?? null,
    }));
    registerClosedStatusLabels(normalized);
    return normalized;
  }

  static async saveStatus(status: Partial<StatusConfig> & { label: string; color: string; scope: string }): Promise<StatusConfig> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'statuses',
        action: 'save',
        status: {
          id: status.id,
          label: status.label,
          color: status.color,
          scope: status.scope,
          isClosed: status.isClosed,
          sortOrder: status.sortOrder,
          parentStatusId: status.parentStatusId ?? null,
        }
      })
    });
    if (!res.ok) throw new Error('Error saving status via API');
    const saved = await res.json();
    // Resposta crua da API vem no formato do Postgres (snake_case) — sem
    // normalizar aqui, o item recém-criado/editado ficava sem parentStatusId
    // no estado local (só corrigia sozinho depois de um refresh, que passa
    // por getStatuses() — esse sim já normalizava).
    return {
      ...saved,
      isClosed: saved.isClosed ?? saved.is_closed ?? false,
      sortOrder: saved.sortOrder ?? saved.sort_order ?? 0,
      parentStatusId: saved.parentStatusId ?? saved.parent_status_id ?? null,
    };
  }

  static async deleteStatus(id: string): Promise<void> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'statuses', action: 'delete', status: { id } })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Error deleting status via API');
    }
  }

  static async reorderStatuses(items: { id: string; sortOrder: number }[]): Promise<void> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'statuses', action: 'reorder', items })
    });
    if (!res.ok) throw new Error('Error reordering statuses via API');
  }

  static async getTags(): Promise<TagConfig[]> {
    const res = await fetchConfig('tags');
    return res.json();
  }

  static async saveTag(tag: TagConfig): Promise<TagConfig> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'tags', action: 'save', tag })
    });
    if (!res.ok) throw new Error('Error saving tag via API');
    return res.json();
  }

  static async deleteTag(id: string): Promise<void> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'tags', action: 'delete', tag: { id } })
    });
    if (!res.ok) throw new Error('Error deleting tag via API');
  }

  static async getQuickNotes(): Promise<QuickNote[]> {
    const res = await fetch('/api/config?type=quick-notes');
    return res.json();
  }

  static async saveQuickNote(note: QuickNote): Promise<void> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'quick-notes', action: 'save', note })
    });
    if (!res.ok) throw new Error('Error saving quick note via API');
  }

  static async deleteQuickNote(id: string): Promise<void> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'quick-notes', action: 'delete', note: { id } })
    });
    if (!res.ok) throw new Error('Error deleting quick note via API');
  }

  static async getSurveySettings(): Promise<SurveySettings> {
    const res = await fetch('/api/config?type=survey-settings');
    const data = await res.json();
    return {
      enabled: data?.enabled ?? true,
      message: data?.message ?? '',
      responseWindowHours: data?.response_window_hours ?? data?.responseWindowHours ?? 24
    };
  }

  static async saveSurveySettings(settings: SurveySettings): Promise<any> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'survey-settings', settings })
    });
    if (!res.ok) throw new Error('Erro ao salvar a pesquisa de satisfação.');
    return res.json();
  }

  static async getEmailSettings(): Promise<EmailSettings> {
    const res = await fetch('/api/config?type=email-settings');
    const data = await res.json();
    return {
      enabled: data?.enabled ?? false,
      smtpHost: data?.smtpHost ?? data?.smtp_host ?? '',
      smtpPort: data?.smtpPort ?? data?.smtp_port ?? null,
      smtpSecure: data?.smtpSecure ?? data?.smtp_secure ?? true,
      smtpUser: data?.smtpUser ?? data?.smtp_user ?? '',
      smtpPassword: data?.smtpPassword ?? data?.smtp_password ?? '',
      fromName: data?.fromName ?? data?.from_name ?? '',
      fromEmail: data?.fromEmail ?? data?.from_email ?? ''
    };
  }

  static async saveEmailSettings(settings: EmailSettings): Promise<void> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'email-settings', settings })
    });
    if (!res.ok) throw new Error('Error saving email settings via API');
  }
}

// Migrated compatibility functions for app/actions and components

export async function fetchPriorities(signal?: AbortSignal): Promise<any[]> {
  try {
    const data = await ConfigService.getPriorities();
    // A API de config retorna a coluna do Postgres (sla_hours); alguns
    // consumidores esperam o nome do tipo PriorityConfig (slaHours).
    // Preenchemos os dois para não depender de qual já veio populado.
    return data.map((p: any) => ({
      ...p,
      slaHours: p.slaHours ?? p.sla_hours,
      sla_hours: p.sla_hours ?? p.slaHours
    }));
  } catch (err) {
    console.error("Error fetching priorities:", err);
    return [];
  }
}

export async function fetchQuickNotes(signal?: AbortSignal): Promise<any[]> {
  try {
    return await ConfigService.getQuickNotes();
  } catch (err) {
    console.error("Error fetching quick notes:", err);
    return [];
  }
}

export async function fetchAnalystStatuses(signal?: AbortSignal): Promise<any[]> {
  try {
    const res = await fetch('/api/config?type=analyst-statuses');
    return res.json();
  } catch (err) {
    console.error("Error fetching analyst statuses:", err);
    return [];
  }
}

export async function fetchSurveySettings(signal?: AbortSignal): Promise<SurveySettings | null> {
  try {
    return await ConfigService.getSurveySettings();
  } catch (err) {
    console.error("Error fetching survey settings:", err);
    return null;
  }
}

export async function fetchCompanies(signal?: AbortSignal): Promise<any[]> {
  try {
    const { CompanyService } = await import('./company-service');
    const data = await CompanyService.getAll();
    return data;
  } catch (err) {
    console.error("Error fetching companies:", err);
    return [];
  }
}

export async function fetchUsers(signal?: AbortSignal): Promise<any[]> {
  try {
    const { UserService } = await import('./user-service');
    return await UserService.getAllUsers();
  } catch (err) {
    console.error("Error fetching users:", err);
    return [];
  }
}

export async function fetchQueues(signal?: AbortSignal): Promise<any[]> {
  try {
    const res = await fetchConfig('queues');
    return res.json();
  } catch (err) {
    console.error("Error fetching queues:", err);
    return [];
  }
}

export async function fetchStatuses(signal?: AbortSignal, scope?: 'ticket' | 'internal_ticket'): Promise<any[]> {
  try {
    return await ConfigService.getStatuses(scope);
  } catch (err) {
    console.error("Error fetching statuses:", err);
    return [];
  }
}