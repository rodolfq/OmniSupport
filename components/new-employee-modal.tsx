'use client';

import React, { useState } from 'react';
import { X, UserPlus, Mail, Phone, Shield, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { createUser } from '@/app/actions';
import { UserRole } from '@/lib/types';
import { maskPhone } from '@/lib/utils';
import { useApp } from '@/app/app-context';

export function NewEmployeeModal({ isOpen, onClose, companyId, onSuccess }: { isOpen: boolean, onClose: () => void, companyId?: string, onSuccess?: () => void }) {
  const { currentUser } = useApp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phones, setPhones] = useState<string[]>(['']);
  const [viewAllCompanyTickets, setViewAllCompanyTickets] = useState(false);

  const [loading, setLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // Adjust role: if companyId is present, it's a employee (Funcionário), otherwise it's support (Equipe)
      const role = companyId ? UserRole.EMPLOYEE : UserRole.SUPPORT;
      const result = await createUser(
        email,
        name,
        role,
        companyId || null,
        phones,
        currentUser?.role === UserRole.CUSTOMER ? false : viewAllCompanyTickets
      );
      
      if (result.error) {
        if (result.error.includes('Email already exists')) {
          setError('Este email já está em uso.');
        } else {
          setError(result.error);
        }
        return; // Stop here if there's an error
      }
      
      if (result.id) {
        // Trigger success callback immediately to refresh parent list
        if (onSuccess) await onSuccess();
      }
      
      setSaveSuccess(true);
      
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
        setName('');
        setEmail('');
        setPhones(['']);
      }, 1500);
    } catch (error: any) {
      console.error('Erro ao criar funcionário:', error);
      setError('Erro ao criar funcionário. Por favor, tente novamente.');
    } finally {
      setLoading(false);
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
            className="relative bg-white dark:bg-[var(--surface-card)] w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-slate-200 dark:border-[var(--border-default)]"
          >
            <div className="bg-slate-900 px-8 py-6 text-white flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black tracking-tight text-white m-0">Novo Funcionário</h3>
                <p className="text-[10px] text-slate-400 dark:text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">Adicione um novo usuário do cliente para abrir chamados</p>
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
                  placeholder="Nome do funcionário"
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

              {currentUser?.role !== UserRole.CUSTOMER && (
              <div className="p-4 bg-indigo-50/50 dark:bg-[var(--accent)]/10 rounded-2xl border border-indigo-100 dark:border-[var(--accent)]/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white dark:bg-[var(--surface-card)] border border-indigo-100 dark:border-[var(--accent)]/20 flex items-center justify-center text-indigo-600 dark:text-[var(--accent-text)] shadow-sm transition-transform group-hover:scale-110">
                    <Shield size={14} />
                  </div>
                  <div>
                    <p className="text-[11px] font-black text-indigo-900 dark:text-[var(--accent-soft-text)] uppercase tracking-tight">Visualizar apenas chamados internos</p>
                  </div>
                </div>
                <div 
                  onClick={() => setViewAllCompanyTickets(!viewAllCompanyTickets)}
                  className={`w-12 h-6 rounded-full p-1 cursor-pointer transition-all ${viewAllCompanyTickets ? 'bg-indigo-600 dark:bg-[var(--accent)] translate-z-0' : 'bg-slate-200 dark:bg-[var(--border-default)]'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white dark:bg-[var(--surface-card)] shadow-sm transition-transform ${viewAllCompanyTickets ? 'translate-x-6' : 'translate-x-0'}`} />
                </div>
              </div>
              )}

              {error && (
                <div className="p-3 bg-rose-50 dark:bg-[var(--surface-danger)] text-rose-600 dark:text-[var(--text-danger)] text-xs font-bold rounded-xl border border-rose-100 dark:border-[var(--text-danger)]/20">
                  {error}
                </div>
              )}

              <div className="pt-4 flex gap-4">
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
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Salvando...
                    </>
                  ) : saveSuccess ? (
                    'Salvo'
                  ) : (
                    <>
                      Confirmar <UserPlus size={16} />
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


