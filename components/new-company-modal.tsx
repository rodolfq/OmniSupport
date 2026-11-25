'use client';

import React, { useState } from 'react';
import { useEscapeToClose } from '@/hooks/use-escape-to-close';
import { X, Building2, Phone, Mail, Lock, UserPlus, RefreshCw, Eye, EyeOff, GraduationCap, CheckCircle2, ShieldAlert, ShieldOff, ShieldCheck, Headset, Briefcase, Trash2, Hash } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { saveCompany, updateCompanyTraining } from '@/lib/services/company-service';
import { Company, User, Permission, type CompanyTrainingStatus } from '@/lib/types';
import { maskPhone, cn } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { StyledSelect } from '@/components/styled-select';
import { UserService } from '@/lib/services/user-service';

function generateTemporaryPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

const TRAINING_STATUS_OPTIONS: { value: CompanyTrainingStatus; label: string; activeClass: string }[] = [
  { value: null, label: 'Nenhum', activeClass: 'bg-[var(--surface-card)] text-[var(--text-secondary)] shadow-sm' },
  { value: 'em_treinamento', label: 'Em treinamento', activeClass: 'bg-[var(--accent)] text-white shadow-sm' },
  { value: 'treinamento_concluido', label: 'Concluído', activeClass: 'bg-[var(--text-success)] text-white shadow-sm' },
];

// DD/MM/AAAA (padrão brasileiro), no fuso do Brasil.
function formatDateBr(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function NewCompanyModal({ isOpen, onClose, onSuccess, company, showInternalSection = false, onRequestDeactivate, onRequestDelete }: { isOpen: boolean, onClose: () => void, onSuccess?: () => void, company?: Company | null, showInternalSection?: boolean, onRequestDeactivate?: () => void, onRequestDelete?: () => void }) {
  useEscapeToClose(isOpen, onClose);
  const { hasPermission } = useApp();
  // Adicionar/remover "Em treinamento" tem permissão própria (a checagem de
  // verdade é no servidor, action 'training' de /api/companies).
  const canManageTraining = hasPermission(Permission.CUSTOMERS_TRAINING);
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

  // Decisor (contato na empresa-cliente) e telefone dele — vêm da Planilha de
  // CS, mas ficam editáveis aqui; uma sincronização nova reescreve com o valor
  // da planilha (ver lib/services/customer-sheet-service.ts).
  const [decisorNome, setDecisorNome] = useState('');
  const [decisorTelefone, setDecisorTelefone] = useState('');

  // Perfil interno — nunca exposto ao cliente, só faz sentido pra uma
  // empresa que já existe (precisa de um id pra vincular as avaliações).
  // 3 estados (2026-11-19, substituiu o toggle booleano "Cliente em
  // Treinamento" a pedido do usuário): null = nenhum, 'em_treinamento',
  // 'treinamento_concluido'.
  const [trainingStatus, setTrainingStatus] = useState<CompanyTrainingStatus>(null);

  // Update input fields when company prop changes
  React.useEffect(() => {
    if (company) {
      setName(company.name || '');
      setPhone(company.phone || '');
      setTrainingStatus(company.trainingStatus ?? null);
      setCsResponsavelId(company.csResponsavelId || '');
      setComercialResponsavelId(company.comercialResponsavelId || '');
      setDecisorNome(company.decisorNome || '');
      setDecisorTelefone(company.decisorTelefone || '');
    } else {
      setName('');
      setPhone('');
      setAdminName('');
      setAdminEmail('');
      setAdminPassword(generateTemporaryPassword());
      setAdminPhone('');
      setTrainingStatus(null);
      setCsResponsavelId('');
      setComercialResponsavelId('');
      setDecisorNome('');
      setDecisorTelefone('');
    }
  }, [company, isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    UserService.getAnalysts().then(setInternalUsers).catch(() => setInternalUsers([]));
  }, [isOpen]);

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
        comercialResponsavelId || null,
        decisorNome || null,
        decisorTelefone || null
      );
      
      if (result.error) {
        throw new Error(result.error);
      }

      if (isEditing && showInternalSection && company) {
        // Só quando o status MUDOU e quem salva pode mexer nele: a ação exige
        // customers:training no servidor, e quem edita a empresa sem essa
        // permissão não pode tomar erro num "Salvar" comum.
        if (canManageTraining && trainingStatus !== (company.trainingStatus ?? null)) {
          const trainingResult = await updateCompanyTraining(company.id, trainingStatus);
          if ('error' in trainingResult && trainingResult.error) throw new Error(trainingResult.error);
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
            className="absolute inset-0 bg-slate-900/60"
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Decisor</label>
                  <div className="relative">
                    <UserPlus className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={16} />
                    <input
                      type="text"
                      value={decisorNome}
                      onChange={(e) => setDecisorNome(e.target.value)}
                      placeholder="Nome do contato decisor"
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl pl-12 pr-4 py-3 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Telefone do Decisor</label>
                  <div className="relative">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={16} />
                    <input
                      type="text"
                      value={maskPhone(decisorTelefone)}
                      onChange={(e) => setDecisorTelefone(e.target.value)}
                      placeholder="(xx) xxxxx-xxxx"
                      maxLength={15}
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl pl-12 pr-4 py-3 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
                    />
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

                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-[var(--surface-card)] border border-[var(--border-default)] flex items-center justify-center text-[var(--text-secondary)] shadow-sm shrink-0">
                        {trainingStatus === 'treinamento_concluido' ? <CheckCircle2 size={14} /> : <GraduationCap size={14} />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-black text-[var(--text-primary)] uppercase tracking-wider">Status de Treinamento</p>
                        <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest">Mostra um aviso pra equipe no chat com a empresa</p>
                        {/* De onde veio o status — a importação da planilha marca sozinha
                            (entrada de 2026 em diante) e, depois de sair de "Em
                            treinamento", nunca devolve sozinha. */}
                        {trainingStatus === 'em_treinamento' && company?.trainingOrigin === 'planilha' && (
                          <p className="text-[10px] text-[var(--text-info)] font-semibold mt-1">
                            Atribuído automaticamente pela importação da planilha{company.trainingStartedAt ? ` em ${formatDateBr(company.trainingStartedAt)}` : ''}.
                          </p>
                        )}
                        {trainingStatus === 'em_treinamento' && company?.trainingOrigin === 'manual' && (
                          <p className="text-[10px] text-[var(--text-tertiary)] font-semibold mt-1">
                            Marcado manualmente{company.trainingStartedAt ? ` em ${formatDateBr(company.trainingStartedAt)}` : ''}.
                          </p>
                        )}
                        {trainingStatus === 'treinamento_concluido' && (
                          <p className="text-[10px] text-[var(--text-success)] font-semibold mt-1">
                            Marcado manualmente como concluído.
                          </p>
                        )}
                        {trainingStatus !== 'em_treinamento' && company?.trainingRemovedAt && (
                          <p className="text-[10px] text-[var(--text-warning)] font-semibold mt-1">
                            Saiu de &quot;Em treinamento&quot; em {formatDateBr(company.trainingRemovedAt)} — a importação da planilha não marca de novo; só manualmente.
                          </p>
                        )}
                        {!canManageTraining && (
                          <p className="text-[10px] text-[var(--text-tertiary)] font-semibold mt-1">Você não tem permissão para alterar este status.</p>
                        )}
                      </div>
                    </div>
                    <div role="radiogroup" aria-label="Status de treinamento" className="flex items-center gap-1 p-1 rounded-xl bg-[var(--surface-pill)] shrink-0">
                      {TRAINING_STATUS_OPTIONS.map(opt => (
                        <button
                          key={opt.value ?? 'none'}
                          type="button"
                          role="radio"
                          aria-checked={trainingStatus === opt.value}
                          disabled={!canManageTraining}
                          onClick={() => setTrainingStatus(opt.value)}
                          className={cn(
                            'px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all disabled:opacity-50 disabled:cursor-not-allowed',
                            trainingStatus === opt.value ? opt.activeClass : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* "Indicadores rápidos" (avaliação interna do cliente, estrelas +
                      perfil) removidos em 2026-11-24, a pedido do usuário. O histórico
                      continua em public.customer_evaluations, só não aparece mais. */}
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


