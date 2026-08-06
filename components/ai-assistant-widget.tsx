'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, X, Send, Loader2, RotateCcw } from 'lucide-react';
import { AiAssistantIcon } from '@/components/ai-assistant-icon';
import { AiAssistantAvatarSource, AvatarCrop, DEFAULT_AI_ASSISTANT_AVATAR, getAvatarOption } from '@/lib/ai-assistant-avatar-options';
import { cn } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { Permission } from '@/lib/types';
import { toast } from 'sonner';

// Widget flutuante do Agente de IA — busca em chamados, tickets internos,
// chat com cliente e chat de grupo interno (ver lib/services/ai-assistant-
// service.ts). Posicionado acima do ChatWidget (bottom-6) pra não colidir
// com ele; z-index abaixo da faixa 200-250 do ChatWidget de propósito — se
// os dois algum dia se sobrepuserem numa tela pequena, o chat de
// atendimento ao cliente continua por cima.

interface AssistantMessage {
  role: 'user' | 'model';
  text: string;
}

interface EmbeddingStatus {
  enabled: boolean;
  total: number;
  processed: number;
  pending: number;
  percent: number;
}

// Poll só enquanto o painel está aberto — não faz sentido consultar isso
// com o widget minimizado, e evita mais uma requisição de fundo por
// usuário logado.
const EMBEDDING_STATUS_POLL_MS = 10_000;

export function AiAssistantWidget() {
  const { currentUser, hasPermission } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingStatus | null>(null);
  const [avatarSource, setAvatarSource] = useState<AiAssistantAvatarSource>(DEFAULT_AI_ASSISTANT_AVATAR);
  const [avatarCrop, setAvatarCrop] = useState<AvatarCrop>(() => getAvatarOption(DEFAULT_AI_ASSISTANT_AVATAR).defaultCrop);
  const conversationIdRef = useRef<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!conversationIdRef.current) {
      conversationIdRef.current = crypto.randomUUID();
    }
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isSending]);

  // Progresso da indexação (busca semântica) — só enquanto o painel está
  // aberto. Some sozinho da tela quando chega a 100% (ver render abaixo),
  // então não precisa parar de "pollar" por conta própria além de fechar
  // o widget.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const fetchStatus = () => {
      fetch('/api/ai-assistant/embedding-status')
        .then(res => res.ok ? res.json() : null)
        .then(data => { if (!cancelled && data) setEmbeddingStatus(data); })
        .catch(() => {});
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, EMBEDDING_STATUS_POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isOpen]);

  // Ícone configurado em Configurações > Agente de IA — busca uma vez ao
  // montar (não depende de isOpen: o botão flutuante já precisa do ícone
  // certo antes do painel ser aberto).
  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai-assistant/avatar')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (cancelled || !data?.avatarSource) return;
        setAvatarSource(data.avatarSource);
        if (data.crop) setAvatarCrop(data.crop);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!currentUser || !hasPermission(Permission.AI_ASSISTANT_USE)) return null;

  const startNewConversation = () => {
    setMessages([]);
    conversationIdRef.current = crypto.randomUUID();
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isSending) return;
    setInput('');
    const historyForRequest = messages;
    setMessages(prev => [...prev, { role: 'user', text }]);
    setIsSending(true);
    try {
      const res = await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId: conversationIdRef.current,
          history: historyForRequest
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Falha ao falar com o assistente.');
      setMessages(prev => [...prev, { role: 'model', text: data.text || '(sem resposta)' }]);
    } catch (err: any) {
      console.error('Erro no assistente de IA:', err);
      // Mensagem específica do servidor (ex.: chave rejeitada, limite
      // diário atingido) tem que aparecer na PRÓPRIA conversa, não só no
      // toast — toast some sozinho em poucos segundos, e um texto genérico
      // aqui escondia a causa real de quem não viu o toast a tempo.
      const errorMessage = err?.message || 'Não consegui responder agora — tenta de novo em instantes.';
      toast.error(errorMessage);
      setMessages(prev => [...prev, { role: 'model', text: errorMessage }]);
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="fixed bottom-28 right-6 z-[190] flex flex-col items-end">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            className="mb-3 w-[min(380px,calc(100vw-2rem))] h-[min(540px,calc(100vh-8rem))] bg-[var(--surface-card)] border border-[var(--border-default)] shadow-2xl rounded-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="bg-[var(--accent)] px-4 py-3 flex items-center justify-between text-white shrink-0 relative">
              <div className="flex items-center gap-2.5">
                {/* Spacer invisível: reserva o espaço horizontal do avatar
                    grande (64px) sem esticar a altura da barra — o avatar de
                    verdade é o próximo elemento, posicionado absoluto pra
                    poder vazar pra baixo sem afetar este fluxo. */}
                <div className="w-16 h-8 shrink-0" aria-hidden="true" />
                <div>
                  <h3 className="text-xs font-black uppercase tracking-widest text-white">Sasha</h3>
                  <p className="text-[9px] text-white/80 font-bold uppercase tracking-widest">Chamados · Tickets · Chats</p>
                </div>
              </div>
              <div className="absolute top-3 left-4 w-16 h-16 rounded-full overflow-hidden ring-4 ring-[var(--surface-card)] shadow-lg z-10">
                <AiAssistantIcon avatarSource={avatarSource} crop={avatarCrop} size={64} />
              </div>
              <div className="flex items-center gap-1">
                <button onClick={startNewConversation} title="Nova conversa" className="p-1.5 hover:bg-white/10 rounded-lg transition-all">
                  <RotateCcw size={15} />
                </button>
                <button onClick={() => setIsOpen(false)} title="Fechar" className="p-1.5 hover:bg-white/10 rounded-lg transition-all">
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Progresso da indexação (busca semântica) — só aparece
                enquanto está abaixo de 100%, some sozinho quando termina. */}
            {embeddingStatus?.enabled && embeddingStatus.percent < 100 && (
              <div className="px-4 py-2.5 border-b border-[var(--border-default)] bg-[var(--surface-pill)] shrink-0">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
                    Indexando histórico
                  </span>
                  <span className="text-[9px] font-black text-[var(--accent-text)]">
                    {embeddingStatus.percent}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--border-default)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] transition-all duration-500"
                    style={{ width: `${embeddingStatus.percent}%` }}
                  />
                </div>
                <p className="text-[9px] text-[var(--text-tertiary)] mt-1">
                  {embeddingStatus.processed} de {embeddingStatus.total} mensagens — busca semântica ainda não cobre tudo
                </p>
              </div>
            )}

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center px-4 gap-2">
                  <Sparkles size={28} className="text-[var(--text-tertiary)]" />
                  <p className="text-xs font-bold text-[var(--text-tertiary)]">Pergunte sobre chamados, tickets internos ou conversas.</p>
                  <p className="text-[10px] text-[var(--text-tertiary)]">Ex: &quot;o que está pendente da empresa Acme?&quot;</p>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap break-words',
                    m.role === 'user'
                      ? 'bg-[var(--accent)] text-white rounded-br-sm'
                      : 'bg-[var(--surface-pill)] text-[var(--text-primary)] rounded-bl-sm'
                  )}>
                    {m.text}
                  </div>
                </div>
              ))}
              {isSending && (
                <div className="flex justify-start">
                  <div className="bg-[var(--surface-pill)] rounded-2xl rounded-bl-sm px-3.5 py-2.5">
                    <Loader2 size={14} className="animate-spin text-[var(--text-tertiary)]" />
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="border-t border-[var(--border-default)] p-3 flex items-end gap-2 shrink-0">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Pergunte algo..."
                rows={1}
                className="flex-1 resize-none bg-[var(--surface-pill)] border border-[var(--border-default)] rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[var(--accent)]/20 max-h-24"
              />
              <button
                onClick={sendMessage}
                disabled={isSending || !input.trim()}
                className="w-9 h-9 shrink-0 bg-[var(--accent)] text-white rounded-xl flex items-center justify-center disabled:opacity-40 transition-all hover:bg-[var(--accent-hover)]"
              >
                <Send size={15} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Launcher */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="w-14 h-14 rounded-full overflow-hidden shadow-2xl hover:scale-110 active:scale-95 transition-all"
          title="Sasha"
        >
          <AiAssistantIcon avatarSource={avatarSource} crop={avatarCrop} size={56} />
        </button>
      )}
    </div>
  );
}
