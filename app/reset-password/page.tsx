'use client';

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

// Tela pública (ver middleware.ts PUBLIC_PATHS) — chegada pelo link do e-mail
// de "Esqueci minha senha" (components/forgot-password-modal.tsx), sempre
// sem sessão. O token vem na própria URL, nunca em cookie.
export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    if (password.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('As senhas não coincidem.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, confirmPassword })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Não foi possível redefinir a senha.');
        setIsLoading(false);
        return;
      }
      setDone(true);
      toast.success('Senha redefinida com sucesso!');
      setTimeout(() => router.replace('/login'), 2000);
    } catch {
      toast.error('Erro inesperado. Tente novamente.');
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--surface-card)] p-6">
        <div className="w-full max-w-md bg-[var(--surface-card)] p-8 rounded-3xl border border-[var(--border-default)] shadow-xl text-center space-y-4">
          <h1 className="text-2xl font-black text-[var(--text-primary)] tracking-tight">Link inválido</h1>
          <p className="text-[var(--text-tertiary)] font-medium">
            Este link de redefinição de senha está incompleto ou já foi usado. Solicite um novo na tela de login.
          </p>
          <a href="/login" className="inline-block text-[var(--accent-text)] font-bold text-sm hover:underline">Voltar para o login</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--surface-card)] p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tight">Redefinir senha</h1>
          <p className="text-[var(--text-tertiary)] font-medium mt-2">Escolha uma nova senha para sua conta SSX Desk.</p>
        </div>

        <div className="bg-[var(--surface-card)] p-8 rounded-3xl border border-[var(--border-default)] shadow-xl">
          {done ? (
            <p className="text-sm text-[var(--text-secondary)] text-center">Senha redefinida! Levando você para o login...</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Nova senha</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={18} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    disabled={isLoading}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl py-3 pl-12 pr-12 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] transition-all font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--accent-text)]"
                    title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Confirmação de senha</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={18} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    disabled={isLoading}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] transition-all font-medium"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-[var(--accent)] text-white py-4 rounded-xl font-black uppercase tracking-widest text-sm shadow-lg hover:bg-[var(--accent-hover)] transition-all flex items-center justify-center gap-2 disabled:opacity-70"
              >
                {isLoading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    Redefinir senha
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
