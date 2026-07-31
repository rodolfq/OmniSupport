import Groq from 'groq-sdk';

// Fábrica compartilhada do cliente Groq — usada pelo Agente de IA
// (lib/services/ai-assistant-service.ts) e pelo resumo de conversa
// (lib/services/chat-summary-service.ts). Extraído pra um lugar só pra não
// duplicar a checagem de configuração/erro entre os dois.

export class AssistantNotConfiguredError extends Error {}

export const GROQ_MODEL_NAME = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

export function getGroqClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new AssistantNotConfiguredError('GROQ_API_KEY não configurada — ver seção 4 do CLAUDE.md.');
  }
  return new Groq({ apiKey });
}

// Extrai "25m51.744s" do texto de erro 429 do Groq e devolve algo tipo "26
// minutos" — bem mais legível que o texto cru da API pra quem só quer saber
// quando pode tentar de novo.
export function parseGroqRetryWait(message: string): string | null {
  const match = /try again in\s+(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i.exec(message);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  const totalMinutes = Number(match[1] || 0) * 60 + Number(match[2] || 0) + Number(match[3] || 0) / 60;
  if (totalMinutes < 1) return 'menos de 1 minuto';
  const rounded = Math.ceil(totalMinutes);
  if (rounded >= 60) {
    const h = Math.floor(rounded / 60);
    const m = rounded % 60;
    return m > 0 ? `${h}h${m}min` : `${h}h`;
  }
  return `${rounded} minuto${rounded > 1 ? 's' : ''}`;
}
