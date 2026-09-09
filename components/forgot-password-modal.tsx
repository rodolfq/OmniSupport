'use client';

import React, { useState } from 'react';
import { X, Mail, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface ForgotPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Modal de "Esqueci minha senha" na tela de login (app/login/page.tsx) — pede
// só o e-mail e sempre mostra a mesma confirmação genérica, exista ou não a
// conta (POST /api/auth/forgot-password já responde assim de propósito,
// enumeration-safe — mesmo princípio do login).
export function ForgotPasswordModal({ isOpen, onClose }: ForgotPasswordModalProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  if (!isOpen) return null;

  const handleClose = () => {
    if (loading) return;
    setEmail('');
    setSent(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Erro ao solicitar redefinição de senha.');
        return;
      }
      setSent(true);
    } catch {
      toast.error('Erro inesperado. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={handleClose}
    >
      <div
        className="w-full max-w-sm bg-[var(--surface-card)] rounded-3xl border border-[var(--border-default)] shadow-2xl p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black text-[var(--text-primary)] tracking-tight">Esqueci minha senha</h2>
          <button type="button" onClick={handleClose} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] transition-colors" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        {sent ? (
          <div className="space-y-4">
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Se esse e-mail estiver cadastrado, você vai receber um link para redefinir a senha em instantes. Confira também a caixa de spam.
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="w-full bg-[var(--accent)] text-white py-3 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-[var(--accent-hover)] transition-all"
            >
              Entendi
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Digite o e-mail cadastrado na sua conta. Vamos enviar um link para você escolher uma nova senha.
            </p>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={18} />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="exemplo@empresa.com"
                required
                autoFocus
                disabled={loading}
                className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] transition-all font-medium text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[var(--accent)] text-white py-3 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-[var(--accent-hover)] transition-all flex items-center justify-center gap-2 disabled:opacity-70"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {loading ? 'Enviando...' : 'Enviar link de redefinição'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
