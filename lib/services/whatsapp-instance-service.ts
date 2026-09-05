import { apiJson, apiFetch } from '../api-client';
import type { MutationResult } from './queue-service';
import type { WhatsappInstance } from '../types';

/**
 * Canais de WhatsApp, do lado do cliente — substitui getWhatsappInstances /
 * saveWhatsappInstance / deleteWhatsappInstance na separação front/back.
 */

/**
 * Usa o tipo de domínio (lib/types.ts) em vez de declarar um próprio: o
 * `status` lá é uma união fechada ('connected' | 'disconnected' | ...), e um
 * tipo local com `status: string` faria a tela recusar o retorno. Tipo de
 * domínio tem um dono só — ver a convenção na seção 9 do CLAUDE.md.
 */
export async function getWhatsappInstances(): Promise<WhatsappInstance[]> {
  try {
    return await apiJson<WhatsappInstance[]>('/api/whatsapp/instances');
  } catch (err) {
    console.error('Erro ao carregar canais de WhatsApp:', err);
    return [];
  }
}

export async function saveWhatsappInstance(
  id: string | null,
  name: string,
  phone: string,
  status: string,
  provider: 'baileys' | 'meta' | 'pyvon' = 'baileys',
  meta?: { phoneNumberId?: string; accessToken?: string; verifyToken?: string; pyvonEnvironment?: 'prod' | 'dev' }
): Promise<MutationResult> {
  try {
    return await apiJson('/api/whatsapp/instances', {
      method: 'POST',
      body: JSON.stringify({ id, name, phone, status, provider, meta })
    });
  } catch (err: any) {
    return { error: err?.message || 'Erro ao salvar canal de WhatsApp.' };
  }
}

export async function deleteWhatsappInstance(id: string): Promise<MutationResult> {
  try {
    const res = await apiFetch(`/api/whatsapp/instances?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return { error: data?.error || 'Erro ao excluir canal de WhatsApp.' };
    }
    return { success: true };
  } catch (err: any) {
    return { error: err?.message || 'Erro ao excluir canal de WhatsApp.' };
  }
}
