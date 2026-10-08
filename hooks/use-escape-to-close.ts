import { useEffect } from 'react';

// Fecha popup/modal com Esc — convenção do app (todo modal fecha com Esc,
// prende o foco e devolve ao elemento de origem; aqui cobre só o fechar).
// `active` liga o listener só enquanto o modal está aberto (normalmente o
// próprio isOpen). `blocked` é pra quando este modal pode abrir OUTRO por
// cima (ex.: confirmação de exclusão): o Esc deve fechar só o que está em
// cima, então quem usa isso passa `blocked = true` enquanto o filho estiver
// aberto, e o modal de baixo fica inerte até o de cima fechar.
export function useEscapeToClose(active: boolean, onClose: () => void, blocked = false) {
  useEffect(() => {
    if (!active || blocked) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, blocked, onClose]);
}
