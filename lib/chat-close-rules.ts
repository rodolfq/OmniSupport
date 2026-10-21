import { TagConfig } from '@/lib/types';

// Regras de encerramento de conversa compartilhadas entre o servidor
// (app/api/chat-sessions/route.ts, action 'close') e as telas que mostram o
// aviso (chat-widget.tsx, Central de Atendimento).

// Texto do erro devolvido pelo servidor quando falta tag — a tela reconhece por
// ele (o apiJson só repassa a mensagem) pra mostrar o seletor em vez de um
// erro genérico.
export const CHAT_TAG_REQUIRED_MESSAGE = 'Selecione ao menos 1 tag para finalizar a conversa.';

export function isChatTagRequiredError(result: unknown): boolean {
  return !!result && typeof result === 'object' && 'error' in (result as any)
    && (result as { error?: unknown }).error === CHAT_TAG_REQUIRED_MESSAGE;
}

/**
 * Conversa pronta pra encerrar do ponto de vista das tags: precisa ter ao menos
 * 1 tag PRINCIPAL de chat válida (sem `parentTagId`) e, se essa principal tiver
 * subtags cadastradas, ao menos uma delas também selecionada (hierarquia
 * introduzida em 2026-10-21 — ver RequiredChatTags). Se NÃO existe nenhuma tag
 * de chat cadastrada, não há o que exigir — senão ninguém conseguiria encerrar
 * nenhuma conversa. Mesma regra do servidor (`conversaTemTagParaEncerrar`),
 * usada na tela só pra decidir o que mostrar; quem barra de verdade é o servidor.
 */
export function chatHasRequiredTag(sessionTagIds: string[] | undefined | null, availableChatTags: TagConfig[]): boolean {
  if (availableChatTags.length === 0) return true;
  const selected = new Set(sessionTagIds || []);
  const principais = availableChatTags.filter(t => !t.parentTagId && selected.has(t.id));
  if (principais.length === 0) return false;
  return principais.every(p => {
    const subtags = availableChatTags.filter(t => t.parentTagId === p.id);
    return subtags.length === 0 || subtags.some(s => selected.has(s.id));
  });
}
