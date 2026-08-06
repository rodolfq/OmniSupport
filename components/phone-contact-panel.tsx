'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Phone, Building2, UserPlus, MessageCirclePlus, MessagesSquare, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ClientTime } from '@/components/client-time';
import { NewEmployeeModal } from '@/components/new-employee-modal';
import { ContactConversationsModal } from '@/components/contact-conversations-modal';
import { getContactLookup, resolveChatSessionForPhone, closeAndStartFreshSession, ContactLookupResult } from '@/lib/services/chat-service';

interface PhoneContactPanelProps {
  // null/undefined = painel fechado. Cada clique num telefone (ver
  // components/linked-chat-text.tsx) passa o número aqui em vez de abrir o
  // chat direto — o analista decide o próximo passo depois de ver se o
  // número já tem cadastro.
  phone: string | null;
  onClose: () => void;
  onOpenChat: (sessionId: string) => void;
  currentUserId: string;
}

// Painel de confirmação ao clicar num telefone dentro de uma mensagem —
// substitui o antigo comportamento de abrir/criar a conversa direto. Regra
// pedida: sempre mostrar se o número já tem cadastro (nome/empresa) antes de
// fazer qualquer coisa, e nunca encerrar uma conversa em andamento sem
// perguntar — só "expande" o aviso e deixa o analista decidir.
export function PhoneContactPanel({ phone, onClose, onOpenChat, currentUserId }: PhoneContactPanelProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ContactLookupResult | null>(null);
  const [showActiveWarning, setShowActiveWarning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showConversations, setShowConversations] = useState(false);
  const [showRegister, setShowRegister] = useState(false);

  useEffect(() => {
    if (!phone) return;
    setLoading(true);
    setResult(null);
    setShowActiveWarning(false);
    getContactLookup(phone).then(setResult).finally(() => setLoading(false));
  }, [phone]);

  if (!phone) return null;

  const createFresh = async () => {
    setStarting(true);
    try {
      const res = await resolveChatSessionForPhone(phone, result?.profile?.name);
      if ('error' in res) {
        toast.error(res.error);
        return;
      }
      onOpenChat(res.sessionId);
      onClose();
    } finally {
      setStarting(false);
    }
  };

  const handleStartNewClick = () => {
    if (result?.activeSession) {
      setShowActiveWarning(true);
      return;
    }
    createFresh();
  };

  const handleOpenActive = () => {
    if (!result?.activeSession) return;
    onOpenChat(result.activeSession.id);
    onClose();
  };

  const handleCloseAndStartFresh = async () => {
    if (!result?.activeSession) return;
    setStarting(true);
    try {
      const newId = await closeAndStartFreshSession(result.activeSession, currentUserId);
      toast.success('Conversa anterior encerrada — novo atendimento aberto.');
      onOpenChat(newId);
      onClose();
    } catch (err) {
      console.error('Erro ao encerrar/iniciar conversa:', err);
      toast.error('Erro ao encerrar a conversa anterior.');
    } finally {
      setStarting(false);
    }
  };

  // Depois de cadastrar, atualiza o painel pro estado "localizado" em vez de
  // simplesmente fechar — o analista acabou de resolver o motivo de não
  // achar nada, faz sentido já oferecer "Ver conversas"/"Iniciar nova".
  const handleRegisterSuccess = async () => {
    setShowRegister(false);
    setLoading(true);
    try {
      setResult(await getContactLookup(phone));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Escondido enquanto um sub-modal está aberto (Cadastrar contato /
          Ver conversas) — sem isso, este card ficava por cima (z-index
          maior) bloqueando cliques no modal de baixo, mesmo com `phone`
          continuando "aberto" só pra manter o estado (result, etc.) vivo
          pros dois sub-modais consultarem. */}
      <AnimatePresence>
        {!showRegister && !showConversations && (
        <div className="fixed inset-0 z-[255] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-[var(--surface-card)] w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden border border-[var(--border-default)]"
          >
            <div className="p-6 flex items-center justify-between border-b border-[var(--border-default)]">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">
                <Phone size={14} /> {phone}
              </div>
              <button onClick={onClose} className="p-1.5 hover:bg-[var(--surface-pill)] rounded-lg transition-colors text-[var(--text-tertiary)]">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={22} className="animate-spin text-[var(--text-tertiary)]" />
                </div>
              ) : showActiveWarning && result?.activeSession ? (
                // "Iniciar nova conversa" clicado com uma conversa já em
                // andamento — nunca encerra sozinho, só avisa e deixa o
                // analista escolher o próximo passo (ver pedido do usuário).
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-4 rounded-2xl bg-[var(--surface-warning)] border border-[var(--border-alert)]">
                    <AlertTriangle size={18} className="text-[var(--text-warning)] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs font-black text-[var(--text-warning)]">Já existe uma conversa em andamento</p>
                      <p className="text-[11px] font-semibold text-[var(--text-warning)]/80 mt-1">
                        {result.activeSession.assigneeName ? `Com ${result.activeSession.assigneeName} · ` : ''}
                        última mensagem <ClientTime date={result.activeSession.lastMessageAt} showDate showTime />
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <button
                      onClick={handleOpenActive}
                      disabled={starting}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[var(--accent)] text-white text-xs font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all disabled:opacity-60"
                    >
                      <MessagesSquare size={15} /> Abrir conversa atual
                    </button>
                    <button
                      onClick={handleCloseAndStartFresh}
                      disabled={starting}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-[var(--border-default)] text-[var(--text-secondary)] text-xs font-black uppercase tracking-widest hover:bg-[var(--surface-danger)] hover:text-[var(--text-danger)] hover:border-[var(--text-danger)]/30 transition-all disabled:opacity-60"
                    >
                      {starting ? <Loader2 size={15} className="animate-spin" /> : <MessageCirclePlus size={15} />}
                      Encerrar e iniciar nova
                    </button>
                    <button
                      onClick={() => setShowActiveWarning(false)}
                      className="w-full text-center py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                    >
                      Voltar
                    </button>
                  </div>
                </div>
              ) : result?.profile ? (
                <div className="space-y-5">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-[var(--accent)] flex items-center justify-center text-white text-xl font-black shrink-0">
                      {result.profile.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-base font-black text-[var(--text-primary)] truncate">{result.profile.name}</p>
                      <p className="text-[11px] font-bold text-[var(--text-tertiary)] uppercase tracking-tighter truncate flex items-center gap-1.5">
                        <Building2 size={12} className="shrink-0" />
                        {result.profile.companyName || 'Sem empresa cadastrada'}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <button
                      onClick={() => setShowConversations(true)}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[var(--accent)] text-white text-xs font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all"
                    >
                      <MessagesSquare size={15} /> Ver conversas
                    </button>
                    <button
                      onClick={handleStartNewClick}
                      disabled={starting}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-[var(--border-default)] text-[var(--text-secondary)] text-xs font-black uppercase tracking-widest hover:bg-[var(--surface-pill)] transition-all disabled:opacity-60"
                    >
                      {starting ? <Loader2 size={15} className="animate-spin" /> : <MessageCirclePlus size={15} />}
                      Iniciar nova conversa
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <p className="text-sm text-[var(--text-tertiary)] font-medium text-center py-2">
                    Nenhum cadastro encontrado para este número.
                  </p>
                  <div className="space-y-2">
                    <button
                      onClick={() => setShowRegister(true)}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[var(--accent)] text-white text-xs font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all"
                    >
                      <UserPlus size={15} /> Cadastrar contato
                    </button>
                    <button
                      onClick={handleStartNewClick}
                      disabled={starting}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-[var(--border-default)] text-[var(--text-secondary)] text-xs font-black uppercase tracking-widest hover:bg-[var(--surface-pill)] transition-all disabled:opacity-60"
                    >
                      {starting ? <Loader2 size={15} className="animate-spin" /> : <MessageCirclePlus size={15} />}
                      Iniciar nova conversa
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
        )}
      </AnimatePresence>

      <NewEmployeeModal
        isOpen={showRegister}
        onClose={() => setShowRegister(false)}
        initialPhone={phone}
        onSuccess={handleRegisterSuccess}
      />

      {result?.profile && (
        <ContactConversationsModal
          isOpen={showConversations}
          onClose={() => setShowConversations(false)}
          phone={phone}
          contactName={result.profile.name}
          activeSession={result.activeSession}
          onOpenActiveSession={(sessionId) => {
            setShowConversations(false);
            onOpenChat(sessionId);
            onClose();
          }}
        />
      )}
    </>
  );
}
