// Parsing do transcript salvo em chat_histories.transcript (formato de texto
// gerado em handleGenerateTicket/finishSession: "[HH:MM] Remetente: texto",
// com marcadores "===== ... =====" de início/fim). Usado tanto pra destacar
// os nomes na tela quanto pra montar o PDF, sem duplicar a lógica de parsing.
export interface TranscriptLine {
  type: 'message' | 'note';
  time?: string;
  sender?: string;
  text: string;
  isCustomer: boolean;
}

const MESSAGE_LINE = /^\[(\d{2}:\d{2})\]\s(.+?):\s([\s\S]*)$/;

export function parseTranscript(transcript: string | null | undefined, customerName?: string | null): TranscriptLine[] {
  if (!transcript) return [];
  const normalizedCustomer = customerName?.trim().toLowerCase();

  return transcript
    .split('\n')
    .filter(line => line.trim() && !line.startsWith('====='))
    .map((line): TranscriptLine => {
      const match = MESSAGE_LINE.exec(line);
      if (!match) return { type: 'note', text: line, isCustomer: false };

      const [, time, sender, text] = match;
      return {
        type: 'message',
        time,
        sender,
        text,
        isCustomer: !!normalizedCustomer && sender.trim().toLowerCase() === normalizedCustomer
      };
    });
}
