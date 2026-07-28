import { CategoryConfig, PriorityConfig, StatusConfig, TagConfig, QuickNote, SurveySettings, MetricThresholds } from '../types';
import { registerClosedStatusLabels } from '../ticket-status';

export class ConfigService {
  static async getCategories(): Promise<CategoryConfig[]> {
    const res = await fetch('/api/config?type=categories');
    return res.json();
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
    const res = await fetch('/api/config?type=priorities');
    return res.json();
  }

  static async savePriority(priority: PriorityConfig): Promise<void> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'priorities', priority })
    });
    if (!res.ok) throw new Error('Error saving priority via API');
  }

  static async getStatuses(scope?: 'ticket' | 'internal_ticket'): Promise<StatusConfig[]> {
    const qs = scope ? `&scope=${scope}` : '';
    const res = await fetch(`/api/config?type=statuses${qs}`);
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
    const res = await fetch('/api/config?type=tags');
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

  static async saveSurveySettings(settings: SurveySettings): Promise<void> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'survey-settings', settings })
    });
    if (!res.ok) throw new Error('Error saving survey settings via API');
  }

  // Dashboard Gerencial (Etapa 3) — só leitura por enquanto, sem tela de
  // edição ainda (ver comentário em migrations/config_metric_thresholds.sql).
  static async getMetricThresholds(): Promise<MetricThresholds> {
    const res = await fetch('/api/config?type=metric-thresholds');
    const data = await res.json();
    return {
      firstResponseGoodSeconds: Number(data?.first_response_good_seconds ?? 120),
      firstResponseWarningSeconds: Number(data?.first_response_warning_seconds ?? 300),
      pct2minGoodPercentage: Number(data?.pct_2min_good_percentage ?? 80),
      pct2minWarningPercentage: Number(data?.pct_2min_warning_percentage ?? 60),
      durationGoodMinutes: Number(data?.duration_good_minutes ?? 10),
      durationWarningMinutes: Number(data?.duration_warning_minutes ?? 20),
      satisfactionGoodPercentage: Number(data?.satisfaction_good_percentage ?? 85),
      satisfactionWarningPercentage: Number(data?.satisfaction_warning_percentage ?? 70),
      individualPeakGood: Number(data?.individual_peak_good ?? 3),
      individualPeakWarning: Number(data?.individual_peak_warning ?? 5),
      waitingNowGood: Number(data?.waiting_now_good ?? 2),
      waitingNowWarning: Number(data?.waiting_now_warning ?? 5),
      volumeMinExpected: Number(data?.volume_min_expected ?? 1),
      capacityRatioGood: Number(data?.capacity_ratio_good ?? 2),
      capacityRatioWarning: Number(data?.capacity_ratio_warning ?? 4),
      riskSatisfactionDropPoints: Number(data?.risk_satisfaction_drop_points ?? 15),
      riskRecurrenceRateWarning: Number(data?.risk_recurrence_rate_warning ?? 20)
    };
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
    const res = await fetch('/api/config?type=queues');
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