'use client';

import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Eye, EyeOff, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { MockDB } from '@/lib/mock-db';
import { useApp } from '@/app/app-context';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

export function ChangePasswordModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const { currentUser, setCurrentUser } = useApp();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    if (!currentUser) return;
    
    // First, update Auth password
    if (!supabase) {
      setError('Erro de configuração: Supabase não inicializado.');
      return;
    }
    const { error: authError } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (authError) {
      setError('Erro ao atualizar senha no servidor: ' + authError.message);
      return;
    }

    const updatedUser = { 
      ...currentUser, 
      password: newPassword, 
      mustChangePassword: false 
    };
    
    await MockDB.saveUser(updatedUser);
    setCurrentUser(updatedUser);
    setIsSuccess(true);
    toast.success('Senha alterada com sucesso!');
    setTimeout(onClose, 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl p-8 overflow-hidden">
        <button onClick={onClose} className="absolute right-6 top-6 text-slate-400 hover:text-slate-600 transition-all p-2">
            <X size={20} />
        </button>
        
        <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight mb-2">Alterar Senha</h3>
        <p className="text-xs text-slate-400 font-medium mb-6">Defina uma nova senha para sua conta.</p>

        {isSuccess ? (
          <div className="py-8 text-center animate-in zoom-in-95">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={32} />
            </div>
            <p className="font-bold text-slate-800">Senha atualizada com sucesso!</p>
          </div>
        ) : (
          <form onSubmit={handleUpdatePassword} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-100 p-3 rounded-xl flex items-start gap-2">
                <AlertCircle className="text-red-600 mt-0.5" size={14} />
                <p className="text-[11px] text-red-700 font-bold">{error}</p>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Nova Senha</label>
              <div className="relative">
                <input 
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
                  placeholder="Mínimo 6 caracteres"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Confirmar Senha</label>
              <input 
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none"
              />
            </div>
            <button className="w-full mt-4 py-4 bg-indigo-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all">
              Atualizar Senha
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
