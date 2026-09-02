'use client';

import React, { useState } from 'react';
import { X, Building2, Phone, Mail, Lock, UserPlus, RefreshCw, Eye, EyeOff, GraduationCap, ShieldAlert, AlertTriangle, ShieldOff, ShieldCheck, Headset, Briefcase, Trash2, Hash } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { saveCompany, getCustomerEvaluationSummary, updateCompanyTraining, saveCustomerEvaluation } from '@/lib/services/company-service';
import { Company, User, type CustomerEvaluationScores, type CustomerEvaluationSummary, type CustomerProfileTag, MIN_RELIABLE_EVALUATION_COUNT } from '@/lib/types';
import { maskPhone, cn } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { StarRating } from '@/components/star-rating';
import { StyledSelect } from '@/components/styled-select';
import { UserService } from '@/lib/services/user-service';
import { toast } from 'sonner';

function generateTemporaryPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

const CRITERIA_LABELS: { key: keyof CustomerEvaluationScores; label: string }[] = [
  { key: 'knowledgeScore', label: 'Conhecimento do sistema' },
  { key: 'autonomyScore', label: 'Autonomia' },
  { key: 'learningScore', label: 'Facilidade de aprendizado' },
  { key: 'engagementScore', label: 'Engajamento' },
  { key: 'organizationScore', label: 'Organização das demandas' },
  { key: 'communicationScore', label: 'Comunicação' }
];

const TAG_INFO: Record<CustomerProfileTag, { emoji: string; label: string }> = {
  technical: { emoji: '👨‍💻', label: 'Cliente Técnico' },
  beginner: { emoji: '🙋‍♂️', label: 'Cliente com Pouco Conhecimento' },
  challenging: { emoji: '😤', label: 'Cliente com Atendimento Desafiador' }
};

const EMPTY_EVAL_SCORES: CustomerEvaluationScores = {
  knowledgeScore: null,
  autonomyScore: null,
  learningScore: null,
  engagementScore: null,
  organizationScore: null,
  communicationScore: null
};

export function NewCompanyModal({ isOpen, onClose, onSuccess, company, showInternalSection = false, onRequestDeactivate, onRequestDelete }: { isOpen: boolean, onClose: () => void, onSuccess?: () => void, company?: Company | null, showInternalSection?: boolean, onRequestDeactivate?: () => void, onRequestDelete?: () => void }) {
  const { currentUser } = useApp();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [adminPhone, setAdminPhone] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const isEditing = !!company;
  const estaDesativada = company?.isActive === false;

  // CS/Comercial responsável — hoje um usuário da equipe interna escolhido
  // manualmente; pensado pra vir de uma API externa no futuro.
  const [csResponsavelId, setCsResponsavelId] = useState('');
  const [comercialResponsavelId, setComercialResponsavelId] = useState('');
  const [internalUsers, setInternalUsers] = useState<User[]>([]);

  // Perfil interno — nunca exposto ao cliente, só faz sentido pra uma
  // empresa que já existe (precisa de um id pra vincular as avaliações).
  const [isInTraining, setIsInTraining] = useState(false);
  const [evaluationSummary, setEvaluationSummary] = useState<CustomerEvaluationSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [evalScores, setEvalScores] = useState<CustomerEvaluationScores>(EMPTY_EVAL_SCORES);
  const [evalTag, setEvalTag] = useState<CustomerProfileTag | null>(null);
  const [baselineScores, setBaselineScores] = useState<CustomerEvaluationScores>(EMPTY_EVAL_SCORES);
  const [baselineTag, setBaselineTag] = useState<CustomerProfileTag | null>(null);

  // Update input fields when company prop changes
  React.useEffect(() => {
    if (company) {
      setName(company.name || '');
      setPhone(company.phone || '');
      setIsInTraining(company.isInTraining || false);
      setCsResponsavelId(company.csResponsavelId || '');
      setComercialResponsavelId(company.comercialResponsavelId || '');
    } else {
      setName('');
      setPhone('');
      setAdminName('');
      setAdminEmail('');
      setAdminPassword(generateTemporaryPassword());
      setAdminPhone('');
      setIsInTraining(false);
      setCsResponsavelId('');
      setComercialResponsavelId('');
    }
  }, [company, isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    UserService.getAnalysts().then(setInternalUsers).catch(() => setInternalUsers([]));
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen || !company || !showInternalSection) {
      setEvaluationSummary(null);
      setEvalScores(EMPTY_EVAL_SCORES);
      setBaselineScores(EMPTY_EVAL_SCORES);
      setEvalTag(null);
      setBaselineTag(null);
      return;
    }
    let cancelled = false;
    setLoadingSummary(true);
    getCustomerEvaluationSummary(company.id).then(result => {
      if (cancelled) return;
      if ('error' in result) {
        setEvaluationSummary(null);
        return;
      }
      setEvaluationSummary(result);
      // Ponto de partida pra edição: a última avaliação registrada (não a
      // média) — se ninguém avaliou ainda, começa zerado.
      const starting = result.latestScores || EMPTY_EVAL_SCORES;
      setEvalScores(starting);
      setBaselineScores(starting);
      setEvalTag(result.latestTag);
      setBaselineTag(result.latestTag);
    }).finally(() => {
      if (!cancelled) setLoadingSummary(false);
    });
    return () => { cancelled = true; };
  }, [isOpen, company, showInternalSection]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setIsLoading(true);
    
    try {
      const result = await saveCompany(
        company?.id || null,
        name,
        company?.industry || '',
        phone,
        isEditing ? undefined : {
          name: adminName,
          email: adminEmail,
          password: adminPassword,
          phone: adminPhone
        },
        csResponsavelId || null,
        comercialResponsavelId || null
      );
      
      if (result.error) {
        throw new Error(result.error);
      }

      if (isEditing && showInternalSection && company) {
        await updateCompanyTraining(company.id, isInTraining);

        const scoresChanged = JSON.stringify(evalScores) !== JSON.stringify(baselineScores);
        const tagChanged = evalTag !== baselineTag;
        // Pelo menos 1 critério avaliado — os demais podem ficar em branco
        // (não entram na média, ver StarRating).
        const hasAnyRating = Object.values(evalScores).some(v => v !== null);
        if ((scoresChanged || tagChanged) && currentUser) {
          if (hasAnyRating) {
            await saveCustomerEvaluation(company.id, currentUser.id, evalScores, evalTag, undefined, 'manual');
          } else {
            toast.warning('Avalie pelo menos um critério (⭐) para registrar a avaliação.');
          }
        }
      }

      if (onSuccess) onSuccess();
      
      onClose();
      if (!company) {
        setName('');
        setPhone('');
        setAdminName('');
        setAdminEmail('');
        setAdminPassword(generateTemporaryPassword());
        setAdminPhone('');
        setCsResponsavelId('');
        setComercialResponsavelId('');
      }
    } catch (e: any) {
      console.error('Error saving company:', e);
      setErrorMsg(e.message || 'Erro inesperado ao salvar empresa.');
    } finally {
      setIsLoading(false);
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
            className="relative bg-[var(--surface-card)] w-full max-w-2xl max-h-[92vh] rounded-3xl shadow-2xl overflow-hidden border border-[var(--border-default)] flex flex-col"
          >
            <div className="bg-slate-900 px-8 py-6 text-white flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black tracking-tight text-white m-0">{isEditing ? 'Editar Empresa' : 'Nova Empresa'}</h3>
                <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">{isEditing ? 'Atualize os dados da organização' : 'Cadastre a empresa e seu admin cliente'}</p>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors text-[var(--text-tertiary)] hover:text-white">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-8 space-y-5 overflow-y-auto">
              {errorMsg && (
                <div className="bg-[var(--surface-danger)] border border-[var(--text-danger)]/30 text-[var(--text-danger)] rounded-xl p-4 text-sm font-medium">
                  {errorMsg}
                </div>
              )}
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Nome da Empresa</label>
                <div className="relative">
                   <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={16} />
                   <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Razão social ou nome fantasia"
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl pl-12 pr-4 py-3 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Telefone Principal</label>
                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={16} />
                  <input
                    type="text"
                    value={maskPhone(phone)}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(xx) xxxx-xxxx"
                    maxLength={15}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl pl-12 pr-4 py-3 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">CS Responsável</label>
                  <div className="relative">
                    <Headset className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] z-10" size={16} />
                    <StyledSelect
                      value={csResponsavelId}
                      onChange={(e) => setCsResponsavelId(e.target.value)}
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl pl-12 pr-4 py-3 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
                    >
                      <option value="">Sem CS definido</option>
                      {internalUsers.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </StyledSelect>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Comercial Responsável</label>
                  <div className="relative">
                    <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] z-10" size={16} />
                    <StyledSelect
                      value={comercialResponsavelId}
                      onChange={(e) => setComercialResponsavelId(e.target.value)}
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl pl-12 pr-4 py-3 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
                    >
                      <option value="">Sem comercial definido</option>
                      {internalUsers.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </StyledSelect>
                  </div>
                </div>
              </div>

              {/* Só existe pra quem já veio da Planilha de CS — nunca editável
                  aqui, é sempre a importação que preenche (ver
                  lib/services/customer-sheet-service.ts). */}
              {isEditing && company?.idCentral && (
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Id Central</label>
                  <div className="relative">
                    <Hash className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={16} />
                    <p className="w-full bg-[var(--surface-pill)] border border-[var(--border-default)] rounded-xl pl-12 pr-4 py-3 text-sm font-medium text-[var(--text-secondary)]">
                      {company.idCentral}
                    </p>
                  </div>
                </div>
              )}

              {!isEditing && (
                <div className="rounded-2xl border border-[var(--accent)]/20 bg-[var(--accent)]/10 p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[var(--surface-card)] border border-[var(--accent)]/20 text-[var(--accent-text)] flex items-center justify-center shadow-sm">
                      <UserPlus size={18} />
                    </div>
                    <div>
                      <p className="text-xs font-black text-indigo-950 uppercase tracking-widest">Admin da Empresa</p>
                      <p className="text-[10px] font-bold text-[var(--accent-text)] uppercase tracking-widest">Perfil Cliente com acesso aos funcionários</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Nome do Admin</label>
                    <input
                      type="text"
                      value={adminName}
                      onChange={(e) => setAdminName(e.target.value)}
                      placeholder="Nome do responsável"
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Email de Login</label>
                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={16} />
                        <input
                          type="email"
                          value={adminEmail}
                          onChange={(e) => setAdminEmail(e.target.value)}
                          placeholder="admin@empresa.com"
                          className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl pl-12 pr-4 py-3 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Telefone do Admin</label>
                      <div className="relative">
                        <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={16} />
                        <input
                          type="text"
                          value={maskPhone(adminPhone)}
                          onChange={(e) => setAdminPhone(e.target.value)}
                          placeholder="(xx) xxxxx-xxxx"
                          maxLength={15}
                          className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl pl-12 pr-4 py-3 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Senha Inicial</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={16} />
                        <input
                          type={showAdminPassword ? 'text' : 'password'}
                          value={adminPassword}
                          onChange={(e) => setAdminPassword(e.target.value)}
                          placeholder="Senha de acesso"
                          minLength={6}
                          className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl pl-12 pr-11 py-3 text-sm font-mono font-bold focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowAdminPassword(value => !value)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[var(--text-tertiary)] hover:text-[var(--accent-text)]"
                          title={showAdminPassword ? 'Ocultar senha' : 'Mostrar senha'}
                        >
                          {showAdminPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAdminPassword(generateTemporaryPassword())}
                        className="px-4 rounded-xl bg-[var(--surface-card)] border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:border-[var(--accent)] transition-all"
                        title="Gerar nova senha"
                      >
                        <RefreshCw size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Perfil interno — nunca exposto ao cliente. Só aparece
                  editando uma empresa que já existe (precisa de id) e pra
                  quem tem Permission.CUSTOMERS_WRITE (ver showInternalSection
                  em customers/page.tsx). */}
              {isEditing && showInternalSection && (
                <div className="p-4 bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] space-y-4">
                  <div className="flex items-center gap-2">
                    <ShieldAlert size={14} className="text-[var(--text-warning)]" />
                    <p className="text-[10px] font-black text-[var(--text-warning)] uppercase tracking-widest">Perfil interno — só a equipe vê</p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[var(--surface-card)] border border-[var(--border-default)] flex items-center justify-center text-[var(--text-secondary)] shadow-sm">
                        <GraduationCap size={14} />
                      </div>
                      <div>
                        <p className="text-[11px] font-black text-[var(--text-primary)] uppercase tracking-wider">Cliente em Treinamento</p>
                        <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest">Mostra um aviso pra equipe no chat com a empresa</p>
                      </div>
                    </div>
                    <div
                      onClick={() => setIsInTraining(!isInTraining)}
                      className={`w-12 h-6 rounded-full p-1 cursor-pointer transition-all shrink-0 ${isInTraining ? 'bg-[var(--accent)]' : 'bg-[var(--border-default)]'}`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-[var(--surface-card)] shadow-sm transition-transform ${isInTraining ? 'translate-x-6' : 'translate-x-0'}`} />
                    </div>
                  </div>

                  <div className="h-px bg-[var(--border-default)] w-full" />

                  <div>
                    <p className="text-[11px] font-black text-[var(--text-primary)] uppercase tracking-wider">Indicadores rápidos</p>
                    <p className="text-[9px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest">Editável aqui — vira uma nova avaliação ao salvar</p>
                  </div>

                  {loadingSummary ? (
                    <p className="text-[10px] text-[var(--text-tertiary)] font-semibold uppercase tracking-widest">Carregando...</p>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-[9px] text-[var(--text-tertiary)] font-medium">
                        Deixe em branco o que não se aplica — clique na mesma estrela de novo pra limpar.
                      </p>
                      <div className="space-y-2">
                        {CRITERIA_LABELS.map(c => (
                          <div key={c.key} className="flex items-center justify-between gap-3">
                            <span className="text-[10px] font-semibold text-[var(--text-secondary)]">{c.label}</span>
                            <StarRating
                              size={15}
                              value={evalScores[c.key]}
                              onChange={(v) => setEvalScores(prev => ({ ...prev, [c.key]: v }))}
                            />
                          </div>
                        ))}
                      </div>

                      <div className="space-y-1.5">
                        <p className="text-[9px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">Perfil do cliente (opcional)</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(Object.keys(TAG_INFO) as CustomerProfileTag[]).map(t => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setEvalTag(prev => prev === t ? null : t)}
                              className={cn(
                                "text-[9px] font-semibold uppercase tracking-widest px-2 py-1.5 rounded-lg border transition-all",
                                evalTag === t
                                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-text)]"
                                  : "border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-[var(--accent)]/40"
                              )}
                            >
                              {TAG_INFO[t].emoji} {TAG_INFO[t].label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {evaluationSummary && evaluationSummary.count > 0 && (
                        <div className="space-y-1.5 pt-1">
                          <p className="text-[9px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest">
                            Média geral: {evaluationSummary.overallAverage.toFixed(1)} ⭐ · baseado em {evaluationSummary.count} avaliaç{evaluationSummary.count === 1 ? 'ão' : 'ões'}
                            {' '}({evaluationSummary.countByOrigin.chatClose} de atendimento, {evaluationSummary.countByOrigin.manual} manual{evaluationSummary.countByOrigin.manual === 1 ? '' : 'is'})
                          </p>
                          {evaluationSummary.count < MIN_RELIABLE_EVALUATION_COUNT && (
                            <p className="text-[9px] text-[var(--text-warning)] font-bold flex items-center gap-1.5">
                              <AlertTriangle size={11} className="shrink-0" />
                              Amostra pequena — a média ainda pode não ser representativa.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="pt-4 flex items-center gap-4">
                {/* Era um botão de EXCLUIR (lixeira vermelha). Virou
                    "Desativar": apagar a empresa deixava as pessoas dela sem
                    vínculo e invisíveis na tela, com chamados e conversas
                    ainda no banco. O nome do botão passou a dizer o que
                    acontece de fato, e a cor deixou de ser de perigo porque a
                    ação é reversível e não apaga nada.
                    Alterna com a situação atual: como este é o ÚNICO ponto da
                    interface que mexe nisso, sem o estado inverso uma empresa
                    desativada não teria como voltar. */}
                {isEditing && onRequestDeactivate && (
                  <button
                    type="button"
                    onClick={onRequestDeactivate}
                    disabled={isLoading}
                    title={estaDesativada
                      ? 'Reativar empresa — volta a aparecer nas listas'
                      : 'Desativar empresa — sai do uso corrente, nada é apagado'}
                    className={cn(
                      "flex items-center gap-2 px-4 py-3.5 rounded-xl text-sm font-bold border transition-all disabled:opacity-50",
                      estaDesativada
                        ? "text-[var(--accent-text)] bg-[var(--accent)]/10 border-[var(--accent)]/20 hover:bg-[var(--accent)]/20"
                        : "text-[var(--text-secondary)] bg-[var(--surface-pill)] border-[var(--border-default)] hover:bg-[var(--border-default)]"
                    )}
                  >
                    {estaDesativada
                      ? <><ShieldCheck size={18} /> Reativar</>
                      : <><ShieldOff size={18} /> Desativar</>}
                  </button>
                )}
                {/* Ação separada e destrutiva de verdade — diferente de
                    Desativar, esta apaga a empresa (e, se houver, chamados/
                    avaliações vinculados) sem volta. Confirmação própria em
                    customers/page.tsx, que mostra o que será apagado antes de
                    seguir. */}
                {isEditing && onRequestDelete && (
                  <button
                    type="button"
                    onClick={onRequestDelete}
                    disabled={isLoading}
                    title="Excluir empresa definitivamente — não pode ser desfeito"
                    className="flex items-center gap-2 px-4 py-3.5 rounded-xl text-sm font-bold border border-[var(--text-danger)]/30 text-[var(--text-danger)] bg-[var(--surface-card)] hover:bg-[var(--surface-danger)] transition-all disabled:opacity-50"
                  >
                    <Trash2 size={18} /> Excluir
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isLoading}
                  className="flex-1 px-6 py-3.5 rounded-xl text-sm font-bold text-[var(--text-tertiary)] hover:bg-[var(--surface-card)] transition-all border border-[var(--border-default)] disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex-1 bg-[var(--accent)] text-white px-6 py-3.5 rounded-xl text-sm font-black uppercase tracking-widest shadow-lg shadow-indigo-100 hover:bg-[var(--accent-hover)] transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Processando...
                    </>
                  ) : (
                    <>
                      {isEditing ? 'Salvar' : 'Cadastrar'} <Building2 size={16} />
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}


