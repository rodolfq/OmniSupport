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

  /**
   * Resolve o param de app/(portal)/customers/[id]/page.tsx, que aceita dois
   * formatos: o UUID interno de sempre (links antigos continuam
   * funcionando), ou o slug "idCentral-nome-da-empresa" (ver
   * lib/utils.ts, companyDetailHref) — o link "bonito" usado a partir de
   * 2026-10-28. O servidor desempata por nome quando o idCentral é
   * compartilhado por mais de uma empresa (não é único).
   */
  static async resolveBySlug(param: string): Promise<Company | null> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(param);
    if (isUuid) return this.getById(param);

    const match = param.match(/^(\d+)(?:-(.+))?$/);
    if (!match) return this.getById(param); // formato desconhecido: tenta como id mesmo, devolve null se não achar

    const [, idCentral, nameHint] = match;
    const qs = nameHint ? `idCentral=${encodeURIComponent(idCentral)}&nameHint=${encodeURIComponent(nameHint)}` : `idCentral=${encodeURIComponent(idCentral)}`;
    const res = await apiFetch(`/api/companies?${qs}`);
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
  comercialResponsavelId?: string | null,
  decisorNome?: string | null,
  decisorTelefone?: string | null
): Promise<MutationResult> {
  return post(
    { id, name, industry, phone, adminUser, csResponsavelId, comercialResponsavelId, decisorNome, decisorTelefone },
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

export interface TrainingStage {
  id: string;
  name: string;
  status: 'Em andamento' | 'Concluído' | 'Não concluído';
  sortOrder: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// Cadastradas/atualizadas por um sistema externo via API de integração
// (app/api/integrations/v1/training-stages) — aqui é só leitura, pra exibir
// a trilha dentro do SSX Desk.
export async function getCompanyTrainingStages(companyId: string): Promise<TrainingStage[]> {
  try {
    return await apiJson<TrainingStage[]>(`/api/companies?tipo=training-stages&companyId=${encodeURIComponent(companyId)}`);
  } catch (err) {
    console.error('Erro ao carregar etapas de treinamento:', err);
    return [];
  }
}

// confirm=false (padrão) para o primeiro clique: se a empresa tiver chamados
// ou avaliações vinculados (apagados em cascata pelo schema), o servidor
// recusa com requiresConfirmation=true + as contagens exatas, em vez de
// apagar direto — a tela mostra esse aviso e só chama de novo com
// confirm=true se quem administra confirmar mesmo assim.
export async function deleteCompany(id: string, confirm = false): Promise<MutationResult & {
  requiresConfirmation?: boolean;
  ticketCount?: number;
  evaluationCount?: number;
}> {
  try {
    const qs = confirm ? `&confirm=1` : '';
    const res = await apiFetch(`/api/companies?id=${encodeURIComponent(id)}${qs}`, { method: 'DELETE' });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (data?.requiresConfirmation) {
        return {
          error: data.error,
          requiresConfirmation: true,
          ticketCount: data.ticketCount,
          evaluationCount: data.evaluationCount
        };
      }
      return { error: data?.error || 'Erro ao excluir empresa no servidor.' };
    }
    return { success: true };
  } catch (err: any) {
    return { error: err?.message || 'Erro ao excluir empresa no servidor.' };
  }
}
