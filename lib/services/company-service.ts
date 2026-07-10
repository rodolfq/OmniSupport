import { Company } from '../types';

export class CompanyService {
  static async getAll(): Promise<Company[]> {
    const res = await fetch('/api/companies');
    return res.json();
  }

  static async getById(id: string): Promise<Company | null> {
    const res = await fetch(`/api/companies?id=${id}`);
    if (!res.ok) return null;
    return res.json();
  }

  static async create(company: Company): Promise<Company> {
    const res = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(company)
    });
    if (!res.ok) throw new Error('Error creating company via API');
    return res.json();
  }

  static async update(id: string, company: Partial<Company>): Promise<void> {
    const res = await fetch(`/api/companies?id=${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(company)
    });
    if (!res.ok) throw new Error('Error updating company via API');
  }

  static async delete(id: string): Promise<void> {
    const res = await fetch(`/api/companies?id=${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error deleting company via API');
  }
}