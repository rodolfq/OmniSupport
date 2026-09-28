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
 * 1 tag de chat válida (que ainda exista no cadastro). Se NÃO existe nenhuma tag
 * de chat cadastrada, não há o que exigir — senão ninguém conseguiria encerrar
 * nenhuma conversa. Mesma regra do servidor (`conversaTemTagParaEncerrar`),
 * usada na tela só pra decidir o que mostrar; quem barra de verdade é o servidor.
 */
export function chatHasRequiredTag(sessionTagIds: string[] | undefined | null, availableChatTagIds: string[]): boolean {
  if (availableChatTagIds.length === 0) return true;
  return (sessionTagIds || []).some(id => availableChatTagIds.includes(id));
}
