import { supabase } from '../supabase';
import { CategoryConfig, PriorityConfig, StatusConfig, TagConfig, QuickNote } from '../types';

export class ConfigService {
  static async getCategories(): Promise<CategoryConfig[]> {
    const { data, error } = await supabase
      .from('config_categories')
      .select('id, label');

    if (error) throw error;
    return (data || []).map(c => ({ id: c.id, label: c.label })) as CategoryConfig[];
  }

  static async saveCategory(category: CategoryConfig): Promise<void> {
    const { error } = await supabase.from('config_categories').upsert({
      id: category.id,
      label: category.label
    });

    if (error) throw error;
  }

  static async getPriorities(): Promise<PriorityConfig[]> {
    const { data, error } = await supabase
      .from('config_priorities')
      .select('id, label, sla_hours, color');

    if (error) throw error;
    return (data || []).map(p => ({
      id: p.id,
      label: p.label,
      slaHours: p.sla_hours,
      slaDays: p.sla_hours ? p.sla_hours / 24 : undefined,
      color: p.color
    })) as PriorityConfig[];
  }

  static async savePriority(priority: PriorityConfig): Promise<void> {
    const { error } = await supabase.from('config_priorities').upsert({
      id: priority.id,
      label: priority.label,
      sla_hours: priority.slaHours,
      color: priority.color
    });

    if (error) throw error;
  }

  static async getStatuses(): Promise<StatusConfig[]> {
    const { data, error } = await supabase
      .from('config_statuses')
      .select('id, label, color');

    if (error) throw error;
    return (data || []).map(s => ({ id: s.id, label: s.label, color: s.color })) as StatusConfig[];
  }

  static async getTags(): Promise<TagConfig[]> {
    const { data, error } = await supabase
      .from('config_tags')
      .select('id, label, color, domain');

    if (error) throw error;
    return (data || []).map(t => ({
      id: t.id,
      label: t.label,
      color: t.color,
      domain: t.domain as 'chat' | 'ticket'
    })) as TagConfig[];
  }

  static async saveTag(tag: TagConfig): Promise<void> {
    const { error } = await supabase.from('config_tags').upsert({
      id: tag.id,
      label: tag.label,
      color: tag.color,
      domain: tag.domain
    });

    if (error) throw error;
  }

  static async deleteTag(id: string): Promise<void> {
    const { error } = await supabase.from('config_tags').delete().eq('id', id);
    if (error) throw error;
  }

  static async getQuickNotes(): Promise<QuickNote[]> {
    const { data, error } = await supabase
      .from('quick_notes')
      .select('id, shortcut, content, category');

    if (error) throw error;
    return (data || []).map(n => ({
      id: n.id,
      shortcut: n.shortcut,
      content: n.content,
      category: n.category
    })) as QuickNote[];
  }

  static async saveQuickNote(note: QuickNote): Promise<void> {
    const { error } = await supabase.from('quick_notes').upsert({
      id: note.id,
      shortcut: note.shortcut,
      content: note.content,
      category: note.category
    });

    if (error) throw error;
  }

  static async deleteQuickNote(id: string): Promise<void> {
    const { error } = await supabase.from('quick_notes').delete().eq('id', id);
    if (error) throw error;
  }
}