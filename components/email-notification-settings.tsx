'use client';

import React, { useEffect, useState } from 'react';
import { Mail, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { UserRole } from '@/lib/types';
import { EMAIL_PREF_GROUPS, EmailPrefKey, EmailPrefs, isEmailPrefOn } from '@/lib/email-notification-prefs';

/**
 * Configurações > Notificações > "Notificações por e-mail" (2026-11-25,
 * pedido do usuário). Cada pessoa escolhe quais avisos recebe por e-mail;
 * tudo começa ligado. Salva a cada clique (PUT /api/users/email-notification-prefs).
 * Só para a equipe: cliente/funcionário não recebe estes avisos.
 */
export function EmailNotificationSettings() {
  const { currentUser } = useApp();
  const isTeam = !!currentUser && [UserRole.ADMIN, UserRole.SUPPORT, UserRole.INTERNAL].includes(currentUser.role as UserRole);
  const [prefs, setPrefs] = useState<EmailPrefs>({});
  const [email, setEmail] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<EmailPrefKey | null>(null);

  useEffect(() => {
    if (!isTeam) return;
    let cancelled = false;
    fetch('/api/users/email-notification-prefs')
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        setPrefs(data?.prefs || {});
        setEmail(data?.email || null);
        setAvailable(data?.available !== false);
      })
      .catch(() => { if (!cancelled) toast.error('Não foi possível carregar as notificações por e-mail.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isTeam]);

  if (!isTeam) return null;

  const toggle = async (key: EmailPrefKey) => {
    const next = !isEmailPrefOn(prefs, key);
    const previous = prefs;
    setPrefs({ ...prefs, [key]: next });
    setSaving(key);
    try {
      const res = await fetch('/api/users/email-notification-prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefs: { [key]: next } })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Erro ao salvar.');
      setPrefs(data.prefs || {});
    } catch (err: any) {
      setPrefs(previous);
      toast.error(err?.message || 'Erro ao salvar.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h4 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-2">
          <Mail size={16} className="text-[var(--accent-text)]" /> Notificações por e-mail
        </h4>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Escolha o que você quer receber por e-mail{email ? <> em <strong className="text-[var(--text-secondary)]">{email}</strong></> : ''}. Os avisos dentro do sistema (sininho) não mudam.
        </p>
        {!available && (
          <p className="text-xs text-[var(--text-warning)] mt-2">Ainda não disponível neste ambiente — por enquanto você recebe todos os e-mails.</p>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]"><Loader2 size={14} className="animate-spin" /> Carregando...</div>
      ) : (
        EMAIL_PREF_GROUPS.map(group => (
          <div key={group.title} className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">{group.title}</p>
            <div className="rounded-2xl border border-[var(--border-default)] divide-y divide-[var(--border-default)]">
              {group.items.map(item => {
                const on = isEmailPrefOn(prefs, item.key);
                return (
                  <div key={item.key} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[var(--text-primary)]">{item.label}</p>
                      <p className="text-xs text-[var(--text-tertiary)]">{item.desc}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={item.label}
                      disabled={!available || saving === item.key}
                      onClick={() => toggle(item.key)}
                      className={cn(
                        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
                        on ? 'bg-[var(--accent)]' : 'bg-[var(--border-default)]'
                      )}
                    >
                      <span className={cn('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform', on ? 'translate-x-5' : 'translate-x-0.5')} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
