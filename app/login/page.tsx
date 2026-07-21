'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/app/app-context';

import { Mail, Lock, ArrowRight, Eye, EyeOff, Sun, Moon } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { UserRole } from '@/lib/types';
import { useTheme } from '@/app/theme-provider';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { currentUser, setCurrentUser, authInitialized } = useApp();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const isSubmittingRef = React.useRef(false);

  React.useEffect(() => {
    // Só redireciona se auth já foi inicializado E tem usuário
    if (authInitialized && currentUser) {
      const isCompanyUser = [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser.role as UserRole);
      router.replace(isCompanyUser ? '/my-tickets' : '/dashboard');
    }
  }, [authInitialized, currentUser, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    // Prevent double submit
    if (isSubmittingRef.current || isLoading) {
      return;
    }
    isSubmittingRef.current = true;
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (!res.ok) {
        setIsLoading(false);
        isSubmittingRef.current = false;
        toast.error(data.error || 'Erro ao entrar. Por favor, tente novamente.');
        return;
      }

      if (data.user) {
        toast.success('Login realizado com sucesso!');
        localStorage.setItem('omni_session_active', 'true');
        
        setCurrentUser({
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          role: data.user.role,
          permissions: data.user.permissions,
          companyId: data.user.companyId,
          phone: data.user.phone,
          avatarUrl: data.user.avatarUrl,
          viewAllCompanyTickets: data.user.viewAllCompanyTickets,
          mustChangePassword: data.user.mustChangePassword,
          isAdmin: data.user.isAdmin,
          internalTeamIds: data.user.internalTeamIds,
          accessProfileId: data.user.accessProfileId,
          adminOfTeamIds: data.user.adminOfTeamIds
        });

        setIsLoading(false);
        isSubmittingRef.current = false;
        const isCompanyUser = [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(data.user.role as UserRole);
        router.replace(isCompanyUser ? '/my-tickets' : '/dashboard');
      }
    } catch (err: any) {
      setIsLoading(false);
      isSubmittingRef.current = false;
      toast.error('Erro inesperado: ' + (err?.message ?? 'Erro desconhecido'));
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--surface-card)] p-6 relative">
      <button
        type="button"
        onClick={toggleTheme}
        className="absolute top-6 right-6 p-2.5 rounded-xl text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-card)] transition-all"
        title={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
      >
        {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
      </button>
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="relative inline-flex mb-8">
            <div className="absolute -inset-8 bg-[var(--accent)]/25 blur-3xl rounded-full" aria-hidden="true" />
            <div className="relative inline-flex items-center justify-center bg-white rounded-[2rem] shadow-2xl shadow-slate-300/50 dark:shadow-black/40 ring-1 ring-black/5 px-10 py-8 sm:px-14 sm:py-10">
              <div
                className="logo-shine"
                style={{ ['--logo-shine-mask' as string]: "url('/branding/logo.png')" }}
              >
                <img src="/branding/logo.png" alt="SSX Resolve" className="h-20 sm:h-24 w-auto select-none" draggable={false} />
              </div>
            </div>
          </div>
          <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tight">Bem-vindo de volta</h1>
          <p className="text-[var(--text-tertiary)] font-medium mt-2">Acesse sua conta SSX Resolve</p>
        </div>

        <div className="bg-[var(--surface-card)] p-8 rounded-3xl border border-[var(--border-default)] shadow-xl shadow-slate-200/50">
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Email Corporativo</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={18} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="exemplo@empresa.com"
                  className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] transition-all font-medium"
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Senha</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={18} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl py-3 pl-12 pr-12 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] transition-all font-medium"
                  required
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(value => !value)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--accent-text)]"
                  title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs font-bold px-1">
              <label className="flex items-center gap-2 text-[var(--text-tertiary)] cursor-pointer">
                <input type="checkbox" className="rounded border-[var(--border-default)] text-[var(--accent-text)] focus:ring-[var(--accent)]" disabled={isLoading} />
                Lembrar-me
              </label>
              <button type="button" className="text-[var(--accent-text)] hover:underline" disabled={isLoading}>Esqueceu a senha?</button>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[var(--accent)] text-white py-4 rounded-xl font-black uppercase tracking-widest text-sm shadow-lg shadow-indigo-100 hover:bg-[var(--accent-hover)] transition-all flex items-center justify-center gap-2 group disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Autenticando...
                </>
              ) : (
                <>
                  Entrar no Sistema
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 pt-8 border-t border-[var(--border-default)] text-center">
            <p className="text-sm text-[var(--text-tertiary)] font-medium">
              Não tem uma conta? <Link href="/" className="text-[var(--accent-text)] font-bold hover:underline">Solicite acesso</Link>
            </p>
          </div>
        </div>

        <p className="text-center mt-8 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest">
          Ambiente Seguro & Criptografado
        </p>
      </div>
    </div>
  );
}

