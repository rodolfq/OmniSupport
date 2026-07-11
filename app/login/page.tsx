'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/app/app-context';

import { Headset, Mail, Lock, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { UserRole } from '@/lib/types';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { currentUser, setCurrentUser, authInitialized } = useApp();
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
          companyId: data.user.companyId,
          phone: data.user.phone,
          viewAllCompanyTickets: data.user.viewAllCompanyTickets,
          mustChangePassword: data.user.mustChangePassword,
          isAdmin: data.user.isAdmin
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
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="bg-indigo-600 w-16 h-16 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-100 mx-auto mb-6">
            <Headset size={32} />
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Bem-vindo de volta</h1>
          <p className="text-slate-500 font-medium mt-2">Acesse sua conta OmniSupport</p>
        </div>

        <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl shadow-slate-200/50">
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Email Corporativo</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="exemplo@empresa.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Senha</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-xs font-bold px-1">
              <label className="flex items-center gap-2 text-slate-500 cursor-pointer">
                <input type="checkbox" className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" disabled={isLoading} />
                Lembrar-me
              </label>
              <button type="button" className="text-indigo-600 hover:underline" disabled={isLoading}>Esqueceu a senha?</button>
            </div>

            <button 
              type="submit" 
              disabled={isLoading}
              className="w-full bg-indigo-600 text-white py-4 rounded-xl font-black uppercase tracking-widest text-sm shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 group disabled:opacity-70 disabled:cursor-not-allowed"
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

          <div className="mt-8 pt-8 border-t border-slate-100 text-center">
            <p className="text-sm text-slate-500 font-medium">
              Não tem uma conta? <Link href="/" className="text-indigo-600 font-bold hover:underline">Solicite acesso</Link>
            </p>
          </div>
        </div>
        
        <p className="text-center mt-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">
          Ambiente Seguro & Criptografado
        </p>
      </div>
    </div>
  );
}

