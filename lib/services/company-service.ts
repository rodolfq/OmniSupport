import { supabase } from '../supabase';
import { Company } from '../types';

export class CompanyService {
  static async getAll(): Promise<Company[]> {
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, industry, phone')
      .order('name', { ascending: true });

    if (error) throw error;
    return (data || []).map(c => ({
      id: c.id,
      name: c.name,
      industry: c.industry || '',
      phone: c.phone || ''
    }));
  }

  static async getById(id: string): Promise<Company | null> {
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, industry, phone')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data ? {
      id: data.id,
      name: data.name,
      industry: data.industry || '',
      phone: data.phone || ''
    } : null;
  }

  static async create(company: Company): Promise<Company> {
    const { data, error } = await supabase
      .from('companies')
      .insert({
        id: company.id,
        name: company.name,
        industry: company.industry || null,
        phone: company.phone || null
      })
      .select('id, name, industry, phone')
      .single();

    if (error) throw error;
    return {
      id: data.id,
      name: data.name,
      industry: data.industry || '',
      phone: data.phone || ''
    };
  }

  static async update(id: string, company: Partial<Company>): Promise<void> {
    const { error } = await supabase
      .from('companies')
      .update({
        name: company.name,
        industry: company.industry,
        phone: company.phone
      })
      .eq('id', id);

    if (error) throw error;
  }

  static async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from('companies')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
}