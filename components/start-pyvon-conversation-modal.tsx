"use client";

import React, { useEffect, useState } from 'react';
import { X, MessageCircle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getPyvonTemplates, sendPyvonTemplate, PyvonTemplate } from '@/lib/services/pyvon-template-service';
import { StyledSelect } from '@/components/styled-select';
import { toast } from 'sonner';

/**
 * Inicia conversa por WhatsApp fora da janela de 24h, via template aprovado
 * (Pyvon, §7 do contrato) — usado no chamado e na tela da empresa. Sem
 * telefone válido não tem o que fazer: o Pyvon precisa dele (ou de um
 * cadastro_id já existente) pra resolver ou criar o contato.
 */
export function StartPyvonConversationModal({
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
  onSuccess?: () => void;
}) {
  const [templates, setTemplates] = useState<PyvonTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [templateId, setTemplateId] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setPhone(defaultPhone?.replace(/\D/g, '') || '');
    setName(defaultName || '');
    setVariableValues({});
    setTemplateId('');
    setIsLoadingTemplates(true);
    getPyvonTemplates().then(list => {
      setTemplates(list.filter(t => t.isActive));
      setIsLoadingTemplates(false);
    });
  }, [isOpen, defaultPhone, defaultName]);

  const selectedTemplate = templates.find(t => t.id === templateId);

  const handleSend = async () => {
    if (!selectedTemplate) {
      toast.error('Escolha um template.');
      return;
    }
    if (!phone.trim()) {
      toast.error('Informe o telefone do cliente.');
      return;
    }
    const missing = selectedTemplate.variablesSchema.filter(v => !variableValues[v.key]?.trim());
    if (missing.length > 0) {
      toast.error(`Preencha: ${missing.map(v => v.label).join(', ')}.`);
      return;
    }

    setIsSending(true);
    try {
      // Junta os valores das variáveis pra usar como texto exibido no NOSSO
      // chat (contentPreview) — sem isso a conversa aparecia só com
      // "[template <nome>]", mesmo com as variáveis preenchidas certinho.
      const contentPreview = Object.values(variableValues).filter(Boolean).join(' — ');
      const result = await sendPyvonTemplate({
        templateName: selectedTemplate.templateName,
        phone: phone.trim(),
        name: name.trim() || undefined,
        language: selectedTemplate.language,
        variables: variableValues,
        contentPreview: contentPreview || undefined
      });
      if (result.error) throw new Error(result.error);
      toast.success('Conversa iniciada — a mensagem foi enviada pelo WhatsApp.');
      onSuccess?.();
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
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-[var(--surface-card)] w-full max-w-lg max-h-[92vh] rounded-3xl shadow-2xl overflow-hidden border border-[var(--border-default)] flex flex-col"
          >
            <div className="bg-slate-900 px-8 py-6 text-white flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black tracking-tight text-white m-0">Iniciar Conversa por WhatsApp</h3>
                <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">Fora da janela de 24h — via template aprovado</p>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors text-[var(--text-tertiary)] hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-5 overflow-y-auto">
              {isLoadingTemplates ? (
                <p className="text-xs font-bold text-[var(--text-tertiary)] text-center py-6">Carregando templates...</p>
              ) : templates.length === 0 ? (
                <p className="text-xs font-bold text-[var(--text-tertiary)] text-center py-6">
                  Nenhum template cadastrado ainda — cadastre em Configurações {'>'} WhatsApp.
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Template</label>
                    <StyledSelect
                      value={templateId}
                      onChange={(e) => { setTemplateId(e.target.value); setVariableValues({}); }}
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
                    >
                      <option value="">Selecione...</option>
                      {templates.map(t => (
                        <option key={t.id} value={t.id}>{t.templateName}{t.description ? ` — ${t.description}` : ''}</option>
                      ))}
                    </StyledSelect>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Telefone</label>
                      <input
                        type="text"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="5511999998888"
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

                  {selectedTemplate && selectedTemplate.variablesSchema.length > 0 && (
                    <div className="space-y-3 p-4 bg-[var(--surface-pill)]/40 rounded-2xl border border-[var(--border-default)]">
                      <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">Variáveis do template</p>
                      {selectedTemplate.variablesSchema.map(v => (
                        <div key={v.key} className="space-y-1.5">
                          <label className="text-[10px] font-bold text-[var(--text-tertiary)] ml-1">{v.label}</label>
                          <input
                            type="text"
                            value={variableValues[v.key] || ''}
                            onChange={(e) => setVariableValues(prev => ({ ...prev, [v.key]: e.target.value }))}
                            className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={isSending || !templateId}
                    className="w-full py-3 bg-[var(--accent)] text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-md hover:bg-[var(--accent-hover)] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {isSending ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
                    Enviar e Iniciar Conversa
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
