'use client';

import { useEffect } from 'react';
import { MessageCircle } from 'lucide-react';
import { useApp } from '@/app/app-context';
import { useIsMobile } from '@/hooks/use-mobile';

// Rota dedicada para abrir o chat em tela cheia no celular (aba "Chat" da
// bottom nav). O componente global <ChatWidget/> (montado em
// app/(portal)/layout.tsx) é quem realmente renderiza a conversa — em telas
// <768px ele ocupa a tela inteira quando isOmniChatOpen=true; aqui só
// disparamos esse estado. No desktop essa rota apenas abre o widget flutuante
// de sempre, então mostramos uma mensagem no lugar do conteúdo da página.
export default function ChatPage() {
  const { setIsOmniChatOpen } = useApp();
  const isMobile = useIsMobile();

  useEffect(() => {
    setIsOmniChatOpen(true);
    return () => {
      if (isMobile) setIsOmniChatOpen(false);
    };
  }, [setIsOmniChatOpen, isMobile]);

  return (
    <div className="hidden md:flex flex-col items-center justify-center h-[60vh] text-center text-[var(--text-tertiary)]">
      <MessageCircle size={40} className="mb-4 opacity-30" />
      <p className="text-sm font-medium">O chat foi aberto no widget, no canto inferior direito da tela.</p>
    </div>
  );
}
