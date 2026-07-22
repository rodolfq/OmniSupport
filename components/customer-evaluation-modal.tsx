'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ShieldCheck, BellOff } from 'lucide-react';
import { useApp } from '@/app/app-context';
import { saveCustomerEvaluation } from '@/app/actions';
import { CustomerEvaluationScores, CustomerProfileTag } from '@/lib/types';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { StarRating } from '@/components/star-rating';
import { snoozeEvaluation } from '@/lib/evaluation-snooze';

const CRITERIA: { key: keyof CustomerEvaluationScores; label: string }[] = [
  { key: 'knowledgeScore', label: 'Conhecimento do sistema' },
  { key: 'autonomyScore', label: 'Autonomia' },
  { key: 'learningScore', label: 'Facilidade de aprendizado' },
  { key: 'engagementScore', label: 'Engajamento' },
  { key: 'organizationScore', label: 'Organização das demandas' },
  { key: 'communicationScore', label: 'Comunicação' }
];

const TAGS: { value: CustomerProfileTag; emoji: string; label: string; description: string }[] = [
  {
    value: 'technical',
    emoji: '👨‍💻',
    label: 'Cliente Técnico',
    description: 'Entende de tecnologia, aprende rápido e resolve boa parte das dúvidas sozinho.'
  },
  {
    value: 'beginner',
    emoji: '🙋‍♂️',
    label: 'Cliente com Pouco Conhecimento',
    description: 'Precisa de explicações simples, passo a passo e maior acompanhamento.'
  },
  {
    value: 'challenging',
    emoji: '😤',
    label: 'Cliente com Atendimento Desafiador',
    description: 'Costuma demonstrar insatisfação, faz muitas cobranças ou exige mais atenção durante o atendimento.'
  }
];

const EMPTY_SCORES: Record<keyof CustomerEvaluationScores, number> = {
  knowledgeScore: 0,
  autonomyScore: 0,
  learningScore: 0,
  engagementScore: 0,
  organizationScore: 0,
  communicationScore: 0
};

// Modal global (estado em app-context.tsx) — disparado ao encerrar um chat,
// ou pelo clique na notificação do sino. Sempre uma avaliação interna da
// empresa-cliente, nunca visível a ela (edição direta fica no cadastro da
// empresa, ver new-company-modal.tsx).
export function CustomerEvaluationModal() {
  const { evaluationModalTarget, closeEvaluationModal, currentUser } = useApp();
  const [scores, setScores] = useState(EMPTY_SCORES);
  const [tag, setTag] = useState<CustomerProfileTag | null>(null);
  const [saving, setSaving] = useState(false);

  const isOpen = !!evaluationModalTarget;

  useEffect(() => {
    if (isOpen) {
      setScores(EMPTY_SCORES);
      setTag(null);
    }
  }, [isOpen, evaluationModalTarget?.companyId]);

  const allFilled = CRITERIA.every(c => scores[c.key] > 0);

  const handleSave = async () => {
    if (!currentUser || !evaluationModalTarget || !allFilled || saving) return;
    setSaving(true);
    try {
      const result = await saveCustomerEvaluation(
        evaluationModalTarget.companyId,
        currentUser.id,
        scores,
        tag,
        evaluationModalTarget.chatSessionId,
        'chat_close',
        evaluationModalTarget.contactId
      );
      if ('error' in result) {
        toast.error('Erro ao salvar avaliação.');
        return;
      }
      toast.success('Avaliação registrada — obrigado!');
      closeEvaluationModal();
    } finally {
      setSaving(false);
    }
  };

  const handleSnooze = () => {
    if (!currentUser || !evaluationModalTarget) return;
    snoozeEvaluation(currentUser.id, evaluationModalTarget.companyId, 7);
    toast.success(`Você não será mais avisado sobre ${evaluationModalTarget.companyName} por 1 semana.`);
    closeEvaluationModal();
  };

  return (
    <AnimatePresence>
      {isOpen && evaluationModalTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeEvaluationModal}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-[var(--surface-card)] w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-[var(--border-default)] max-h-[90vh] flex flex-col"
          >
            <div className="bg-slate-900 px-8 py-6 text-white flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-lg font-black tracking-tight m-0">
                  Avaliar {evaluationModalTarget.companyName}
                </h3>
                {evaluationModalTarget.contactName && (
                  <p className="text-[10px] text-white/60 font-semibold mt-0.5">
                    Atendimento com {evaluationModalTarget.contactName}
                  </p>
                )}
                <p className="text-[10px] text-white/60 font-bold uppercase tracking-widest mt-1 flex items-center gap-1.5">
                  <ShieldCheck size={12} /> Uso interno — o cliente nunca vê isso
                </p>
              </div>
              <button
                onClick={closeEvaluationModal}
                className="p-2 hover:bg-white/10 rounded-xl transition-colors text-white/70 hover:text-white shrink-0"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-6 overflow-y-auto">
              <div className="space-y-3">
                {CRITERIA.map(c => (
                  <div key={c.key} className="flex items-center justify-between gap-4">
                    <span className="text-xs font-bold text-[var(--text-secondary)]">{c.label}</span>
                    <StarRating value={scores[c.key]} onChange={(v) => setScores(prev => ({ ...prev, [c.key]: v }))} />
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">
                  Perfil do cliente (opcional)
                </p>
                <div className="space-y-2">
                  {TAGS.map(t => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setTag(prev => prev === t.value ? null : t.value)}
                      className={cn(
                        "w-full text-left p-3 rounded-2xl border transition-all flex items-start gap-3",
                        tag === t.value
                          ? "border-[var(--accent)] bg-[var(--accent)]/10"
                          : "border-[var(--border-default)] hover:border-[var(--accent)]/40"
                      )}
                    >
                      <span className="text-lg leading-none shrink-0">{t.emoji}</span>
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-[var(--text-primary)]">{t.label}</span>
                        <span className="block text-[10px] text-[var(--text-tertiary)] leading-snug mt-0.5">{t.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-8 py-5 border-t border-[var(--border-default)] flex flex-wrap items-center justify-between gap-3 shrink-0 bg-[var(--surface-card)]">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  onClick={closeEvaluationModal}
                  className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-all"
                >
                  Não quero responder
                </button>
                <button
                  onClick={handleSnooze}
                  className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--text-danger)] transition-all flex items-center gap-1.5"
                  title={`Não perguntar sobre ${evaluationModalTarget.companyName} pelos próximos 7 dias`}
                >
                  <BellOff size={12} /> Recusar por 1 semana
                </button>
              </div>
              <button
                onClick={handleSave}
                disabled={!allFilled || saving}
                className="px-5 py-2.5 bg-[var(--accent)] text-white rounded-xl text-[10px] font-semibold uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'Salvando...' : 'Salvar avaliação'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
