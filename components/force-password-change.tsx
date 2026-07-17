'use client';

import React, { useState } from 'react';
import { useApp } from '@/app/app-context';
import { motion } from 'motion/react';
import { Lock, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';

export function ForcePasswordChange() {
  const { currentUser, setCurrentUser } = useApp();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const [isUpdating, setIsUpdating] = useState(false);

  if (!currentUser || !currentUser.mustChangePassword) return null;

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsUpdating(true);

    try {
      if (newPassword.length < 6) {
        throw new Error('A senha deve ter pelo menos 6 caracteres.');
      }

      if (newPassword !== confirmPassword) {
        throw new Error('As senhas não coincidem.');
      }

      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: newPassword })
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || 'Erro ao atualizar a senha.');
      }

      const updatedUser = {
        ...currentUser,
        ...(result.user || {}),
        mustChangePassword: false
      };

      setCurrentUser(updatedUser);
      setIsSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Ocorreu um erro ao atualizar a senha.');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-[var(--surface-card)] w-full max-w-md rounded-[3rem] shadow-2xl overflow-hidden"
      >
        <div className="bg-[var(--accent)] p-8 text-white text-center">
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
            <Lock size={32} />
          </div>
          <h2 className="text-2xl font-black uppercase tracking-tight">Alteração Obrigatória</h2>
          <p className="text-indigo-100 dark:text-[var(--accent-soft-text)] text-sm mt-2 font-medium opacity-80">Por segurança, você deve definir uma nova senha no seu primeiro acesso.</p>
        </div>

        <div className="p-10">
          {isSuccess ? (
            <div className="text-center py-4">
              <div className="w-20 h-20 bg-[var(--surface-success)] text-[var(--text-success)] rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 size={40} />
              </div>
              <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">Senha alterada!</h3>
              <p className="text-[var(--text-tertiary)] text-sm mb-8">Agora você já pode acessar todos os recursos do portal.</p>
              <button 
                onClick={() => window.location.reload()}
                className="w-full bg-slate-900 text-white py-4 rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl shadow-slate-100 hover:bg-slate-800 transition-all"
              >
                Começar agora
              </button>
            </div>
          ) : (
            <form onSubmit={handleUpdatePassword} className="space-y-6">
              {error && (
                <div className="bg-[var(--surface-danger)] border border-[var(--text-danger)]/20 p-4 rounded-2xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                  <AlertCircle className="text-[var(--text-danger)] mt-0.5" size={18} />
                  <p className="text-[13px] text-[var(--text-danger)] font-bold leading-tight">{error}</p>
                </div>
              )}

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Nova Senha</label>
                  <div className="relative">
                    <input 
                      type={showPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-5 py-4 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                      placeholder="••••••••"
                      required
                    />
                    <button 
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Confirmar Senha</label>
                  <input 
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-5 py-4 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>

              <div className="pt-2">
                <button 
                  type="submit"
                  disabled={isUpdating}
                  className="w-full bg-[var(--accent)] text-white py-4 rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl shadow-indigo-100 hover:bg-[var(--accent-hover)] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isUpdating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Atualizando...
                    </>
                  ) : (
                    'Definir Nova Senha'
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}


