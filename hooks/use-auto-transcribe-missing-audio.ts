import { useEffect, useRef } from 'react';
import { ChatMessage } from '@/lib/types';
import { transcribeChatAudio } from '@/lib/services/chat-service';
import { isAudioAttachment } from '@/lib/attachment-kind';

// Garante que todo áudio sem transcrição ainda apareça transcrito no
// histórico mesmo sem clique manual em nada — cobre mensagens antigas (de
// antes da transcrição automática existir) e tentativas automáticas que
// falharam. Ao abrir uma conversa (Histórico de Conversas, aba "Conversa" do
// chamado), qualquer anexo de áudio sem `transcription` é transcrito na
// hora; o resultado é gravado de volta em chat_messages pela própria rota
// (mesma usada pelo botão "Transcrever"), então da próxima vez que alguém
// abrir essa conversa já vem pronto.
export function useAutoTranscribeMissingAudio(
  sessionId: string | undefined | null,
  messages: ChatMessage[] | undefined,
  setMessages: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void
) {
  const attemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!sessionId || !messages || messages.length === 0) return;

    messages.forEach((m: any) => {
      const attachments: any[] = m.attachments || m.metadata?.attachments || [];
      attachments.forEach((attachment) => {
        if (!attachment?.id || attachment.transcription) return;
        if (!isAudioAttachment(attachment)) return;

        const key = `${m.id}:${attachment.id}`;
        if (attemptedRef.current.has(key)) return;
        attemptedRef.current.add(key);

        transcribeChatAudio(sessionId, m.id, attachment.id)
          .then((text) => {
            setMessages(prev => prev.map((msg: any) => {
              if (msg.id !== m.id) return msg;
              const msgAttachments: any[] = msg.attachments || msg.metadata?.attachments || [];
              return {
                ...msg,
                attachments: msgAttachments.map((a: any) => a.id === attachment.id ? { ...a, transcription: text } : a)
              };
            }));
          })
          .catch((err) => {
            console.error('[use-auto-transcribe-missing-audio] Falha ao transcrever áudio pendente:', err);
          });
      });
    });
    // Só precisa reagir a troca de conversa/lista de mensagens — não à
    // função setMessages em si (o setState do componente pai é estável o
    // bastante em todos os usos atuais).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, messages]);
}
