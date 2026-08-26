import { apiJson, apiResourceUrl } from '../api-client';

/** Integração com Google Agenda, do lado do cliente. Mesmo contrato dos
 * demais services de tela: erro volta como `{ error }`, nunca exceção. */

export interface GoogleCalendarStatus {
  connected: boolean;
  email: string | null;
}

export async function getGoogleCalendarStatus(): Promise<GoogleCalendarStatus | { error: string }> {
  try {
    return await apiJson<GoogleCalendarStatus>('/api/integrations/google-calendar?action=status');
  } catch (err: any) {
    return { error: err?.message || 'Erro ao consultar a conexão com o Google Agenda.' };
  }
}

/** Link de navegação de verdade (não fetch) — o navegador precisa sair pro
 * Google e voltar, o que só um `<a href>`/redirect faz. */
export function googleCalendarConnectUrl(): string {
  return apiResourceUrl('/api/integrations/google-calendar?action=connect');
}

export async function disconnectGoogleCalendar(): Promise<{ success?: true; error?: string }> {
  try {
    return await apiJson('/api/integrations/google-calendar', {
      method: 'POST',
      body: JSON.stringify({ action: 'disconnect' }),
      fallbackError: 'Erro ao desvincular o Google Agenda.'
    });
  } catch (err: any) {
    return { error: err?.message || 'Erro ao desvincular o Google Agenda.' };
  }
}
