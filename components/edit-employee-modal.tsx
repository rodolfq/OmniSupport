'use client';

import React, { useState, useEffect } from 'react';
import { StyledSelect } from '@/components/styled-select';
import { X, Save, Mail, Phone, Shield, Lock, Eye, EyeOff, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { UserRole, type User, type Company } from '@/lib/types';
import { UserService } from '@/lib/services/user-service';
import { maskPhone } from '@/lib/utils';
import { Globe } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export function EditEmployeeModal({ isOpen, onClose, user, onSuccess }: { isOpen: boolean, onClose: () => void, user: User | null, onSuccess?: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(UserRole.EMPLOYEE);
  const [phones, setPhones] = useState<string[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [viewAllCompanyTickets, setViewAllCompanyTickets] = useState(false);

  const [loading, setLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    supabase.from('companies').select('id, name').then(({ data }) => {
      if (data) setCompanies(data as Company[]);
    });
  }, []);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setEmail(user.email || '');
      setRole(user.role as any || UserRole.EMPLOYEE);
      setCompanyId(user.companyId || '');
      
      const userPhones = user.phones || (user.phone ? [user.phone] : []);
      setPhones(userPhones);
      
      setViewAllCompanyTickets(user.viewAllCompanyTickets || false);
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    
    try {
      const updatedUser = {
        ...user,
        name,
        email,
        phones,
        phone: phones[0] || '', // Keep single phone for compatibility
        companyId,
        viewAllCompanyTickets
      };
      await UserService.save(updatedUser);
      setSaveSuccess(true);
      if (onSuccess) onSuccess();
      
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 1500);
    } catch (error) {
      console.error(error);
      alert('Erro ao atualizar usuário.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!user) return;
    try {
      setLoading(true);
      console.log('Resetting password for:', user.email);

      const response = await fetch('/api/users/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId: user.id })
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || 'Erro ao reiniciar senha.');
      }

      console.log('Password reset successful.');
      setGeneratedPassword(result.password);
      if (onSuccess) onSuccess();
    } catch (e: any) {
      console.error('Erro ao reiniciar senha:', e);
      alert('Erro ao reiniciar senha: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!user) return;
    setDeleteLoading(true);
    try {
      await UserService.delete(user.id);
      if (onSuccess) onSuccess();
      onClose();
    } catch (error: any) {
      console.error(error);
      alert(error.message || 'Erro ao excluir usuário.');
    } finally {
      setDeleteLoading(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && user && (
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
            className="relative bg-white dark:bg-[var(--surface-card)] w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-slate-200 dark:border-[var(--border-default)]"
          >
            <div className="bg-slate-900 px-8 py-6 text-white flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black tracking-tight text-white m-0">Editar Colaborador</h3>
                <p className="text-[10px] text-slate-400 dark:text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">Configure as permissões de {user.name}</p>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors text-slate-400 dark:text-[var(--text-tertiary)] hover:text-white">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-8 space-y-5">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-[var(--text-tertiary)] ml-1">Nome Completo</label>
                <input 
                  type="text" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nome do colaborador"
                  className="w-full bg-slate-50 dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-[var(--accent)]/20 focus:border-indigo-500 dark:focus:border-[var(--accent)] outline-none transition-all"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-[var(--text-tertiary)] ml-1">Email</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[var(--text-tertiary)]" size={16} />
                  <input 
                    type="email" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@empresa.com"
                    className="w-full bg-slate-50 dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-xl pl-12 pr-4 py-3 text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-[var(--accent)]/20 focus:border-indigo-500 dark:focus:border-[var(--accent)] outline-none transition-all"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-[var(--text-tertiary)] ml-1">Empresa</label>
                  <div className="relative">
                    <Globe className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[var(--text-tertiary)]" size={16} />
                    <StyledSelect 
                      value={companyId}
                      onChange={(e) => setCompanyId(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-xl pl-12 pr-4 py-3 text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-[var(--accent)]/20 focus:border-indigo-500 dark:focus:border-[var(--accent)] outline-none transition-all appearance-none"
                      required
                    >
                      <option value="">Selecione uma empresa</option>
                      {companies.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </StyledSelect>
                  </div>
                </div>

                <div className="space-y-2">
                   <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-[var(--text-tertiary)] ml-1">Perfil de Acesso</label>
                   <div className="bg-indigo-50 dark:bg-[var(--accent)]/10 border border-indigo-100 dark:border-[var(--accent)]/20 rounded-xl px-4 py-3 flex items-center gap-2">
                      <Shield size={14} className="text-indigo-600 dark:text-[var(--accent-text)]" />
                      <span className="text-xs font-black text-indigo-700 dark:text-[var(--accent-text)] uppercase tracking-widest">Colaborador</span>
                   </div>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-[var(--text-tertiary)] ml-1">Telefones (WhatsApp)</label>
                {phones.map((p, idx) => (
                  <div key={idx} className="relative flex items-center gap-2">
                    <div className="relative flex-1">
                      <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[var(--text-tertiary)]" size={16} />
                      <input 
                        type="text" 
                        value={maskPhone(p)}
                        onChange={(e) => {
                          const newPhones = [...phones];
                          newPhones[idx] = e.target.value;
                          setPhones(newPhones);
                        }}
                        placeholder="(xx) xxxxx-xxxx"
                        maxLength={15}
                        className="w-full bg-slate-50 dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-xl pl-12 pr-4 py-3 text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-[var(--accent)]/20 focus:border-indigo-500 dark:focus:border-[var(--accent)] outline-none transition-all"
                      />
                    </div>
                    {phones.length > 1 && (
                      <button 
                        type="button"
                        onClick={() => setPhones(phones.filter((_, i) => i !== idx))}
                        className="p-3 text-rose-500 dark:text-[var(--text-danger)] hover:bg-rose-50 dark:hover:bg-[var(--surface-danger)] rounded-xl transition-all"
                      >
                        <X size={18} />
                      </button>
                    )}
                  </div>
                ))}
                <button 
                  type="button"
                  onClick={() => setPhones([...phones, ''])}
                  className="w-full py-2.5 border-2 border-dashed border-slate-200 dark:border-[var(--border-default)] rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-[var(--text-tertiary)] hover:border-indigo-300 hover:text-indigo-600 dark:hover:text-[var(--accent-text)] transition-all flex items-center justify-center gap-2"
                >
                  <Plus size={14} /> Adicionar outro número
                </button>
              </div>

              <div className="p-4 bg-slate-50 dark:bg-[var(--surface-card)] rounded-2xl border border-slate-100 dark:border-[var(--border-default)] space-y-4">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-white dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] flex items-center justify-center text-slate-600 dark:text-[var(--text-secondary)] shadow-sm">
                        <Lock size={14} />
                      </div>
                      <div>
                        <p className="text-[11px] font-black text-slate-800 dark:text-[var(--text-primary)] uppercase tracking-wider">Acesso ao Login</p>
                        <p className="text-[10px] text-slate-400 dark:text-[var(--text-tertiary)] font-bold uppercase tracking-widest">Segurança da conta</p>
                      </div>
                    </div>
                    <button 
                      type="button" 
                      onClick={handleResetPassword}
                      className="px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all shadow-sm bg-white dark:bg-[var(--surface-card)] text-slate-600 dark:text-[var(--text-secondary)] border border-slate-200 dark:border-[var(--border-default)] hover:bg-slate-50 dark:hover:bg-[var(--surface-card)]"
                    >
                      Reiniciar Senha
                    </button>
                  </div>
                  {generatedPassword && (
                    <div className="bg-emerald-50 dark:bg-[var(--surface-success)] text-emerald-700 dark:text-[var(--text-success)] border border-emerald-200 dark:border-[var(--text-success)]/30 px-3 py-2 rounded-lg flex items-center justify-center font-mono text-xs font-bold shadow-sm mt-2">
                      Nova senha: {generatedPassword}
                    </div>
                  )}
                </div>

                <div className="h-px bg-slate-200 dark:bg-[var(--border-default)] w-full" />

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-white dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] flex items-center justify-center text-slate-600 dark:text-[var(--text-secondary)] shadow-sm">
                      {viewAllCompanyTickets ? <Eye size={14} /> : <EyeOff size={14} />}
                    </div>
                    <div>
                      <p className="text-[11px] font-black text-slate-800 dark:text-[var(--text-primary)] uppercase tracking-wider">Visibilidade de Chamados</p>
                      <p className="text-[10px] text-slate-400 dark:text-[var(--text-tertiary)] font-bold uppercase tracking-widest">Controles de acesso</p>
                    </div>
                  </div>
                  <div 
                    onClick={() => setViewAllCompanyTickets(!viewAllCompanyTickets)}
                    className={`w-12 h-6 rounded-full p-1 cursor-pointer transition-all ${viewAllCompanyTickets ? 'bg-indigo-600 dark:bg-[var(--accent)] translate-z-0' : 'bg-slate-200 dark:bg-[var(--border-default)]'}`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white dark:bg-[var(--surface-card)] shadow-sm transition-transform ${viewAllCompanyTickets ? 'translate-x-6' : 'translate-x-0'}`} />
                  </div>
                </div>
                <p className="text-[9px] text-slate-400 dark:text-[var(--text-tertiary)] font-bold uppercase leading-relaxed">
                  {viewAllCompanyTickets 
                    ? "Visualizar todos os chamados da empresa." 
                    : "Apenas visualizar os próprios chamados."}
                </p>
              </div>

              {/* Danger Zone */}
              <div className="p-4 bg-rose-50/50 dark:bg-[var(--surface-danger)]/50 rounded-2xl border border-rose-100 dark:border-[var(--text-danger)]/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white dark:bg-[var(--surface-card)] border border-rose-200 dark:border-[var(--text-danger)]/30 flex items-center justify-center text-rose-500 dark:text-[var(--text-danger)] shadow-sm">
                    <Trash2 size={14} />
                  </div>
                  <div>
                    <p className="text-[11px] font-black text-rose-900 dark:text-[var(--text-danger)] uppercase tracking-wider">Excluir Conta</p>
                    <p className="text-[10px] text-rose-400 dark:text-[var(--text-danger)] font-bold uppercase tracking-widest leading-tight">Remover acesso permanentemente</p>
                  </div>
                </div>
                
                <button 
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-4 py-2 hover:bg-rose-100 dark:hover:bg-[var(--surface-danger)] text-rose-600 dark:text-[var(--text-danger)] rounded-lg text-[10px] font-black uppercase tracking-widest transition-all border border-rose-200 dark:border-[var(--text-danger)]/30 bg-white dark:bg-[var(--surface-card)] shadow-sm"
                >
                  Excluir
                </button>
              </div>

              <div className="pt-2 flex gap-4">
                <button 
                  type="button" 
                  onClick={onClose}
                  className="flex-1 px-6 py-3.5 rounded-xl text-sm font-bold text-slate-500 dark:text-[var(--text-tertiary)] hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] transition-all border border-slate-200 dark:border-[var(--border-default)]"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  disabled={loading || saveSuccess}
                  className={`flex-1 px-6 py-3.5 rounded-xl text-sm font-black uppercase tracking-widest shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${saveSuccess ? 'bg-emerald-500 dark:bg-[var(--text-success)] text-white' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
                >
                  {loading ? 'Salvando...' : saveSuccess ? 'Salvo!' : 'Salvar'} <Save size={16} />
                </button>
              </div>
            </form>
          </motion.div>

          {/* Delete Confirmation Overlay */}
          <AnimatePresence>
            {showDeleteConfirm && (
              <div className="absolute inset-0 z-[110] flex items-center justify-center p-6">
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-rose-900/40 backdrop-blur-md"
                  onClick={() => !deleteLoading && setShowDeleteConfirm(false)}
                />
                <motion.div
                  initial={{ scale: 0.9, opacity: 0, y: 10 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.9, opacity: 0, y: 10 }}
                  className="relative bg-white dark:bg-[var(--surface-card)] w-full max-w-sm rounded-3xl shadow-2xl p-8 border border-rose-100 dark:border-[var(--text-danger)]/20"
                >
                  <div className="w-16 h-16 bg-rose-100 dark:bg-[var(--surface-danger)] rounded-2xl flex items-center justify-center text-rose-500 dark:text-[var(--text-danger)] mx-auto mb-6">
                    <AlertTriangle size={32} />
                  </div>
                  <h4 className="text-xl font-black text-slate-900 dark:text-[var(--text-primary)] text-center mb-2">Excluir Funcionário?</h4>
                  <p className="text-sm text-slate-500 dark:text-[var(--text-tertiary)] text-center mb-8 font-medium">
                    Esta ação não pode ser desfeita. O colaborador <span className="font-bold text-slate-900 dark:text-[var(--text-primary)]">{user.name}</span> perderá acesso imediato ao sistema.
                  </p>
                  
                  <div className="space-y-3">
                    <button
                      type="button"
                      disabled={deleteLoading}
                      onClick={handleDelete}
                      className="w-full py-4 bg-rose-500 dark:bg-[var(--text-danger)] hover:bg-rose-600 dark:hover:bg-[var(--text-danger)] text-white rounded-2xl text-sm font-black uppercase tracking-widest shadow-lg shadow-rose-200 transition-all disabled:opacity-50"
                    >
                      {deleteLoading ? 'Excluindo...' : 'Sim, Excluir permanentemente'}
                    </button>
                    <button
                      type="button"
                      disabled={deleteLoading}
                      onClick={() => setShowDeleteConfirm(false)}
                      className="w-full py-4 bg-slate-100 dark:bg-[var(--surface-pill)] hover:bg-slate-200 dark:hover:bg-[var(--border-default)] text-slate-600 dark:text-[var(--text-secondary)] rounded-2xl text-sm font-black uppercase tracking-widest transition-all"
                    >
                      Cancelar
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>
      )}
    </AnimatePresence>
  );
}


