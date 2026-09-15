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
  // Texto literal aprovado na Meta, com {{1}}, {{2}}... — usado pra montar um
  // preview fiel da mensagem enviada (ver renderTemplateBody em pyvon-service.ts).
  bodyText: string;
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
  bodyText: string;
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
/**
 * Só transparência (ver app/api/whatsapp/pyvon/outbound-status/route.ts) —
 * mostra ANTES de enviar se este telefone está dentro da janela de 24h.
 * Quem decide de verdade é sempre o servidor, na hora de startPyvonConversation.
 */
export async function checkPyvonOutboundStatus(phone: string): Promise<{ withinWindow: boolean } | { error: string }> {
  try {
    return await apiJson<{ withinWindow: boolean }>(`/api/whatsapp/pyvon/outbound-status?phone=${encodeURIComponent(phone)}`);
  } catch (err: any) {
    return { error: err?.message || 'Erro ao checar a janela de 24h.' };
  }
}

/**
 * Inicia conversa por telefone (canal Pyvon) — o servidor decide sozinho se
 * abre normal ou se precisa do template contato_pos_vendas antes (ver
 * app/api/whatsapp/pyvon/start-conversation/route.ts).
 */
export async function startPyvonConversation(params: {
  phone: string;
  name?: string;
}): Promise<{ sessionId: string; usedTemplate: boolean } | { error: string }> {
  try {
    return await apiJson<{ sessionId: string; usedTemplate: boolean }>('/api/whatsapp/pyvon/start-conversation', {
      method: 'POST',
      body: JSON.stringify(params)
    });
  } catch (err: any) {
    return { error: err?.message || 'Erro ao iniciar conversa.' };
  }
}

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
