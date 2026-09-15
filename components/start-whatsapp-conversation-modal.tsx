"use client";

import React, { useEffect, useRef, useState } from 'react';
import { X, MessageCircle, Loader2, CheckCircle2, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { checkPyvonOutboundStatus, startPyvonConversation } from '@/lib/services/pyvon-template-service';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type WindowStatus = 'unknown' | 'checking' | 'open' | 'closed';

/**
 * Único ponto de "iniciar conversa por telefone" no canal Pyvon — usado tanto
 * pelo botão "Iniciar Conversa" (Empresas > Decisor) quanto pelo "+ Novo
 * WhatsApp" do chat widget. O servidor (app/api/whatsapp/pyvon/start-conversation)
 * decide sozinho se abre a conversa normal (dentro da janela de 24h) ou se
 * precisa mandar o template contato_pos_vendas antes (fora dela) — aqui só
 * mostramos ANTES qual dos dois vai acontecer, checando
 * /api/whatsapp/pyvon/outbound-status enquanto o analista digita o telefone.
 */
export function StartWhatsAppConversationModal({
  isOpen,
  onClose,
  defaultPhone,
  defaultName,
  onSuccess
}: {
  isOpen: boolean;
  onClose: () => void;
  defaultPhone?: string;
  defaultName?: string;
  onSuccess?: (sessionId: string, usedTemplate: boolean) => void;
}) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [windowStatus, setWindowStatus] = useState<WindowStatus>('unknown');
  const [isSending, setIsSending] = useState(false);
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkSeqRef = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    setPhone(defaultPhone?.replace(/\D/g, '') || '');
    setName(defaultName || '');
    setWindowStatus('unknown');
    setIsSending(false);
  }, [isOpen, defaultPhone, defaultName]);

  // Checa a janela 500ms depois de parar de digitar — só com dígito
  // suficiente pra ser um telefone de verdade, senão fica martelando a API
  // a cada tecla de um número ainda incompleto.
  useEffect(() => {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) {
      setWindowStatus('unknown');
      return;
    }
    setWindowStatus('checking');
    const seq = ++checkSeqRef.current;
    checkTimerRef.current = setTimeout(async () => {
      const result = await checkPyvonOutboundStatus(digits);
      if (seq !== checkSeqRef.current) return; // resposta de uma checagem já obsoleta
      if ('error' in result) { setWindowStatus('unknown'); return; }
      setWindowStatus(result.withinWindow ? 'open' : 'closed');
    }, 500);
    return () => { if (checkTimerRef.current) clearTimeout(checkTimerRef.current); };
  }, [phone]);

  const handleClose = () => {
    if (isSending) return;
    onClose();
  };

  const handleSend = async () => {
    if (!phone.trim()) {
      toast.error('Informe o telefone do cliente.');
      return;
    }
    setIsSending(true);
    try {
      const result = await startPyvonConversation({ phone: phone.trim(), name: name.trim() || undefined });
      if ('error' in result) throw new Error(result.error);
      toast.success(result.usedTemplate
        ? 'Fora da janela de 24h — mensagem inicial enviada e conversa aberta.'
        : 'Conversa aberta — o contato já pode ser respondido normalmente.');
      onSuccess?.(result.sessionId, result.usedTemplate);
      onClose();
    } catch (e: any) {
      toast.error(e.message || 'Falha ao iniciar conversa.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-[var(--surface-card)] w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-[var(--border-default)] flex flex-col"
          >
            <div className="bg-slate-900 px-8 py-6 text-white flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black tracking-tight text-white m-0">Iniciar Conversa por WhatsApp</h3>
                <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">Canal Pyvon</p>
              </div>
              <button onClick={handleClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors text-[var(--text-tertiary)] hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Telefone</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="5511999998888"
                    autoFocus
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Nome do cliente</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Nome"
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
                  />
                </div>
              </div>

              {/* Transparência do que vai acontecer ao clicar em enviar — nunca
                  decide nada aqui, só antecipa o que o servidor vai decidir. */}
              {windowStatus !== 'unknown' && (
                <div className={cn(
                  "flex items-start gap-2.5 p-3.5 rounded-xl text-xs font-semibold leading-snug",
                  windowStatus === 'checking' && "bg-[var(--surface-pill)] text-[var(--text-tertiary)]",
                  windowStatus === 'open' && "bg-[var(--surface-success)] text-[var(--text-success)]",
                  windowStatus === 'closed' && "bg-[var(--surface-warning)] text-[var(--text-warning)]"
                )}>
                  {windowStatus === 'checking' && <Loader2 size={15} className="shrink-0 mt-0.5 animate-spin" />}
                  {windowStatus === 'open' && <CheckCircle2 size={15} className="shrink-0 mt-0.5" />}
                  {windowStatus === 'closed' && <Clock size={15} className="shrink-0 mt-0.5" />}
                  <span>
                    {windowStatus === 'checking' && 'Verificando se este contato já respondeu nas últimas 24h...'}
                    {windowStatus === 'open' && 'Dentro da janela de 24h — a conversa abre normal, sem template.'}
                    {windowStatus === 'closed' && 'Fora da janela de 24h (ou contato novo) — vamos enviar a mensagem inicial do modelo aprovado ("contato_pos_vendas") pra poder falar com ele.'}
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={handleSend}
                disabled={isSending || !phone.trim()}
                className="w-full py-3 bg-[var(--accent)] text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-md hover:bg-[var(--accent-hover)] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {isSending ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
                {windowStatus === 'closed' ? 'Enviar Mensagem e Abrir Conversa' : 'Iniciar Conversa'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
