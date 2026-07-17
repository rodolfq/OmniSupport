'use client';

import React, { useState } from 'react';
import { X, Building2, Phone, Briefcase, Mail, Lock, UserPlus, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { saveCompany } from '@/app/actions';
import { Company } from '@/lib/types';
import { maskPhone } from '@/lib/utils';

function generateTemporaryPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export function NewCompanyModal({ isOpen, onClose, onSuccess, company }: { isOpen: boolean, onClose: () => void, onSuccess?: () => void, company?: Company | null }) {
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [phone, setPhone] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [adminPhone, setAdminPhone] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const isEditing = !!company;

  // Update input fields when company prop changes
  React.useEffect(() => {
    if (company) {
      setName(company.name || '');
      setIndustry(company.industry || '');
      setPhone(company.phone || '');
    } else {
      setName('');
      setIndustry('');
      setPhone('');
      setAdminName('');
      setAdminEmail('');
      setAdminPassword(generateTemporaryPassword());
      setAdminPhone('');
    }
  }, [company, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setIsLoading(true);
    
    try {
      const result = await saveCompany(
        company?.id || null,
        name,
        industry,
        phone,
        isEditing ? undefined : {
          name: adminName,
          email: adminEmail,
          password: adminPassword,
          phone: adminPhone
        }
      );
      
      if (result.error) {
        throw new Error(result.error);
      }
      
      if (onSuccess) onSuccess();
      
      onClose();
      if (!company) {
        setName('');
        setIndustry('');
        setPhone('');
        setAdminName('');
        setAdminEmail('');
        setAdminPassword(generateTemporaryPassword());
        setAdminPhone('');
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

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Setor / Indústria</label>
                  <div className="relative">
                    <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={16} />
                    <input
                      type="text"
                      value={industry}
                      onChange={(e) => setIndustry(e.target.value)}
                      placeholder="Ex: Tecnologia"
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl pl-12 pr-4 py-3 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
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
              </div>

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

              <div className="pt-4 flex gap-4">
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


