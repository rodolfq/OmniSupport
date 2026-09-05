import { apiJson, apiFetch } from '../api-client';
import type { MutationResult } from './queue-service';

export interface PyvonTemplateVariable {
  key: string;
  label: string;
}

export interface PyvonTemplate {
  id: string;
  templateName: string;
  language: string;
  description: string;
  variablesSchema: PyvonTemplateVariable[];
  isActive: boolean;
}

export async function getPyvonTemplates(): Promise<PyvonTemplate[]> {
  try {
    return await apiJson<PyvonTemplate[]>('/api/pyvon-templates');
  } catch (err) {
    console.error('Erro ao carregar templates do Pyvon:', err);
    return [];
  }
}

export async function savePyvonTemplate(template: {
  id?: string | null;
  templateName: string;
  language: string;
  description: string;
  variablesSchema: PyvonTemplateVariable[];
  isActive: boolean;
}): Promise<MutationResult> {
  try {
    return await apiJson('/api/pyvon-templates', { method: 'POST', body: JSON.stringify(template) });
  } catch (err: any) {
    return { error: err?.message || 'Erro ao salvar template.' };
  }
}

export async function deletePyvonTemplate(id: string): Promise<MutationResult> {
  try {
    const res = await apiFetch(`/api/pyvon-templates?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return { error: data?.error || 'Erro ao excluir template.' };
    }
    return { success: true };
  } catch (err: any) {
    return { error: err?.message || 'Erro ao excluir template.' };
  }
}

/**
 * Inicia conversa fora da janela de 24h via template — POST bot-template. Não
 * leva instanceId: só existe um canal Pyvon por conta hoje, resolvido no
 * servidor (ver app/api/whatsapp/pyvon/send-template/route.ts).
 */
export async function sendPyvonTemplate(params: {
  templateName: string;
  cadastroId?: number;
  phone?: string;
  name?: string;
  language?: string;
  variables?: Record<string, string>;
  channelId?: number;
  contentPreview?: string;
}): Promise<MutationResult & { cadastroId?: number }> {
  try {
    const data: any = await apiJson('/api/whatsapp/pyvon/send-template', {
      method: 'POST',
      body: JSON.stringify(params)
    });
    return { success: true, cadastroId: data.cadastro_id };
  } catch (err: any) {
    return { error: err?.message || 'Erro ao iniciar conversa via template.' };
  }
}
