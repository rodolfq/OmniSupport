'use client';

import React, { useState, useEffect } from 'react';
import { Mail, Save, Send, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { EmailSettings, UserRole } from '@/lib/types';
import { ConfigService } from '@/lib/services/config-service';
import { useApp } from '@/app/app-context';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const EMPTY_SETTINGS: EmailSettings = {
  enabled: false,
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: true,
  smtpUser: '',
  smtpPassword: '',
  fromName: '',
  fromEmail: ''
};

export function EmailSettingsContent() {
  const { currentUser } = useApp();
  const isAdmin = currentUser?.role === UserRole.ADMIN;

  const [settings, setSettings] = useState<EmailSettings>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await ConfigService.getEmailSettings();
        setSettings(data);
      } catch {
        toast.error('Erro ao carregar configurações de e-mail.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleSave = async () => {
    if (!isAdmin) {
      toast.error('Apenas administradores podem alterar essa configuração.');
      return;
    }
    setSaving(true);
    try {
      await ConfigService.saveEmailSettings(settings);
      toast.success('Configurações de e-mail salvas!');
    } catch {
      toast.error('Erro ao salvar configurações de e-mail.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testEmail.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmail.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        setTestResult({ success: true, message: `E-mail de teste enviado para ${testEmail.trim()}.` });
      } else {
        setTestResult({ success: false, message: data.error || 'Falha ao enviar o e-mail de teste.' });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err?.message || 'Falha ao enviar o e-mail de teste.' });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-8 shadow-sm">
        <p className="text-[var(--text-tertiary)] text-xs font-bold uppercase tracking-widest italic">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-8 shadow-sm space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-2">
              <Mail className="text-[var(--accent-text)]" size={24} /> Configuração de E-mail (SMTP)
            </h3>
            <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">
              Usado para responder chamados por e-mail e notificar atribuições
            </p>
          </div>

          <label className={cn("flex items-center gap-2 text-xs font-bold", isAdmin ? "text-[var(--text-secondary)] cursor-pointer" : "text-[var(--text-tertiary)]")}>
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={!isAdmin}
              onChange={(e) => setSettings(prev => ({ ...prev, enabled: e.target.checked }))}
              className="rounded border-[var(--border-default)] text-[var(--accent-text)] focus:ring-[var(--accent)] disabled:opacity-50"
            />
            Ativo
          </label>
        </div>

        <fieldset disabled={!isAdmin} className="grid grid-cols-1 md:grid-cols-2 gap-6 disabled:opacity-70">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Host SMTP</label>
            <input
              type="text"
              value={settings.smtpHost}
              onChange={(e) => setSettings(prev => ({ ...prev, smtpHost: e.target.value }))}
              placeholder="smtp.exemplo.com.br"
              className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Porta</label>
            <input
              type="number"
              value={settings.smtpPort ?? ''}
              onChange={(e) => setSettings(prev => ({ ...prev, smtpPort: e.target.value ? parseInt(e.target.value, 10) : null }))}
              placeholder="587"
              className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Usuário</label>
            <input
              type="text"
              value={settings.smtpUser}
              onChange={(e) => setSettings(prev => ({ ...prev, smtpUser: e.target.value }))}
              placeholder="usuario@exemplo.com.br"
              className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Senha</label>
            <input
              type="password"
              value={settings.smtpPassword}
              onChange={(e) => setSettings(prev => ({ ...prev, smtpPassword: e.target.value }))}
              placeholder="••••••••"
              className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Nome do Remetente</label>
            <input
              type="text"
              value={settings.fromName}
              onChange={(e) => setSettings(prev => ({ ...prev, fromName: e.target.value }))}
              placeholder="SSX Desk"
              className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest ml-1">E-mail do Remetente</label>
            <input
              type="email"
              value={settings.fromEmail}
              onChange={(e) => setSettings(prev => ({ ...prev, fromEmail: e.target.value }))}
              placeholder="suporte@exemplo.com.br"
              className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
            />
          </div>

          <label className="flex items-center gap-2 text-xs font-bold text-[var(--text-secondary)] cursor-pointer md:col-span-2">
            <input
              type="checkbox"
              checked={settings.smtpSecure}
              onChange={(e) => setSettings(prev => ({ ...prev, smtpSecure: e.target.checked }))}
              className="rounded border-[var(--border-default)] text-[var(--accent-text)] focus:ring-[var(--accent)]"
            />
            Conexão segura (TLS/SSL) — desmarque só se o provedor exigir porta sem criptografia (ex: 25)
          </label>
        </fieldset>

        {isAdmin && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Salvar Configurações
          </button>
        )}
      </div>

      {isAdmin && (
        <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-8 shadow-sm space-y-4">
          <h4 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-tight">Enviar E-mail de Teste</h4>
          <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest">
            Salve as configurações antes de testar — o teste usa o que estiver salvo no banco
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="seu-email@exemplo.com.br"
              className="flex-1 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
            />
            <button
              onClick={handleTest}
              disabled={testing || !testEmail.trim()}
              className="px-6 py-3 bg-[var(--accent)] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-[var(--accent-hover)] transition-all shadow-lg shadow-indigo-100 disabled:opacity-60 whitespace-nowrap"
            >
              {testing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              Enviar Teste
            </button>
          </div>

          {testResult && (
            <div className={cn(
              "flex items-center gap-2 px-4 py-3 rounded-2xl text-xs font-bold",
              testResult.success ? "bg-[var(--surface-success)] text-[var(--text-success)]" : "bg-[var(--surface-danger)] text-[var(--text-danger)]"
            )}>
              {testResult.success ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {testResult.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
