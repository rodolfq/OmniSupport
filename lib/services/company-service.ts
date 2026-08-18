import { Company, CustomerEvaluationScores, CustomerProfileTag, CustomerEvaluationSummary, CustomerEvaluationOrigin } from '../types';
import { apiJson, apiFetch } from '../api-client';
import type { MutationResult } from './queue-service';

/**
 * Empresas-cliente, do lado do cliente.
 *
 * Além do CRUD que já existia aqui, passou a concentrar o que eram as Server
 * Actions saveCompany / setCompanyActive / deleteCompany / getCompanies /
 * updateCompanyTraining / saveCustomerEvaluation / getCustomerEvaluationSummary
 * — separação front/back.
 *
 * Tudo por apiFetch/apiJson (lib/api-client.ts): é o que faz a chamada apontar
 * para o back quando NEXT_PUBLIC_API_URL estiver definida e o cookie de sessão
 * viajar entre origens diferentes.
 */

export class CompanyService {
  static async getAll(): Promise<Company[]> {
    return apiJson<Company[]>('/api/companies');
  }

  static async getById(id: string): Promise<Company | null> {
    const res = await apiFetch(`/api/companies?id=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return res.json();
  }

  /** Criação simples (nome/setor/telefone) — usada pelo "Criar e vincular". */
  static async create(company: Partial<Company>): Promise<Company> {
    return apiJson<Company>('/api/companies', {
      method: 'POST',
      body: JSON.stringify(company),
      fallbackError: 'Erro ao criar empresa.'
    });
  }

  static async update(id: string, company: Partial<Company>): Promise<void> {
    // Vai por POST com id (e não PUT): o id é o que faz a rota exigir
    // Administrador, e concentrar criação e edição no mesmo ponto evita duas
    // regras de autorização para a mesma tabela.
    await apiJson('/api/companies', {
      method: 'POST',
      body: JSON.stringify({ ...company, id }),
      fallbackError: 'Erro ao atualizar empresa.'
    });
  }

  static async delete(id: string): Promise<void> {
    const res = await apiFetch(`/api/companies?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || 'Erro ao excluir empresa.');
    }
  }
}

// ---------------------------------------------------------------------------
// Substitutos diretos das Server Actions (mesmas assinaturas)
// ---------------------------------------------------------------------------

export async function getCompanies(): Promise<Company[]> {
  try {
    return await apiJson<Company[]>('/api/companies');
  } catch (err) {
    console.error('Erro ao carregar empresas:', err);
    return [];
  }
}

async function post(body: Record<string, unknown>, fallback: string): Promise<MutationResult> {
  try {
    return await apiJson('/api/companies', { method: 'POST', body: JSON.stringify(body) });
  } catch (err: any) {
    return { error: err?.message || fallback };
  }
}

export async function saveCompany(
  id: string | null,
  name: string,
  industry: string,
  phone: string,
  adminUser?: { name: string; email: string; password: string; phone?: string },
  csResponsavelId?: string | null,
  comercialResponsavelId?: string | null
): Promise<MutationResult> {
  return post(
    { id, name, industry, phone, adminUser, csResponsavelId, comercialResponsavelId },
    'Erro ao salvar empresa no servidor.'
  );
}

export async function setCompanyActive(id: string, active: boolean): Promise<MutationResult & { isActive?: boolean }> {
  return post({ action: 'set-active', id, active }, 'Não foi possível alterar a situação da empresa.');
}

export async function updateCompanyTraining(companyId: string, isInTraining: boolean): Promise<MutationResult> {
  return post({ action: 'training', companyId, isInTraining }, 'Erro ao atualizar status de treinamento.');
}

/** logoUrl: `data:` URL da imagem nova, ou null para remover a logo atual. */
export async function updateCompanyLogo(companyId: string, logoUrl: string | null): Promise<MutationResult & { logoThumbUrl?: string | null }> {
  return post({ action: 'logo', companyId, logoUrl }, 'Erro ao salvar a logo da empresa.');
}

export async function saveCustomerEvaluation(
  companyId: string,
  analystId: string,
  scores: CustomerEvaluationScores,
  profileTag: CustomerProfileTag | null,
  chatSessionId?: string | null,
  origin: CustomerEvaluationOrigin = 'manual',
  contactId?: string | null
): Promise<MutationResult> {
  return post(
    { action: 'evaluation', companyId, analystId, scores, profileTag, chatSessionId, origin, contactId },
    'Erro ao salvar avaliação do cliente.'
  );
}

export async function getCustomerEvaluationSummary(
  companyId: string
): Promise<CustomerEvaluationSummary | { error: string }> {
  try {
    return await apiJson(`/api/companies?tipo=evaluation-summary&companyId=${encodeURIComponent(companyId)}`);
  } catch (err: any) {
    return { error: err?.message || 'Erro ao carregar avaliações do cliente.' };
  }
}

export async function deleteCompany(id: string): Promise<MutationResult> {
  try {
    const res = await apiFetch(`/api/companies?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return { error: data?.error || 'Erro ao excluir empresa no servidor.' };
    }
    return { success: true };
  } catch (err: any) {
    return { error: err?.message || 'Erro ao excluir empresa no servidor.' };
  }
}
