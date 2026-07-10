import { CategoryConfig, PriorityConfig, StatusConfig, TagConfig, QuickNote } from '../types';

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

  static async getStatuses(): Promise<StatusConfig[]> {
    const res = await fetch('/api/config?type=statuses');
    return res.json();
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
}

// Migrated compatibility functions for app/actions and components

export async function fetchPriorities(signal?: AbortSignal): Promise<any[]> {
  try {
    const data = await ConfigService.getPriorities();
    return data.map(p => ({
      ...p,
      sla_hours: p.slaHours
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

export async function fetchStatuses(signal?: AbortSignal): Promise<any[]> {
  try {
    return await ConfigService.getStatuses();
  } catch (err) {
    console.error("Error fetching statuses:", err);
    return [];
  }
}