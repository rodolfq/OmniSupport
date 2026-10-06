'use client';

import React, { useEffect, useState } from 'react';
import { MessageCircle, Monitor } from 'lucide-react';
import { getPyvonPortalEligibility, PyvonStartChannel } from '@/lib/services/pyvon-template-service';
import { cn } from '@/lib/utils';

export interface PortalEligibility {
  portalProfileId: string | null;
  portalEligible: boolean;
  portalProfileName: string | null;
}

/**
 * Escolha de canal ao iniciar uma conversa com o cliente: WhatsApp (padrão,
 * via Pyvon) ou Portal (chat do portal). "Portal" só fica habilitado quando o
 * contato já usa o portal (perfil com a senha provisória trocada) — quem nunca
 * entrou só recebe pelo WhatsApp. Consulta a elegibilidade pelo telefone e
 * avisa o pai pelo onEligibility, que precisa do profileId para o canal portal.
 */
export function PyvonChannelChoice({
  phone,
  value,
  onChange,
  onEligibility,
  disabled = false
}: {
  phone: string;
  value: PyvonStartChannel;
  onChange: (channel: PyvonStartChannel) => void;
  onEligibility?: (result: PortalEligibility | null) => void;
  disabled?: boolean;
}) {
  const [eligibility, setEligibility] = useState<PortalEligibility | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) {
      setEligibility(null);
      onEligibility?.(null);
      return;
    }
    let active = true;
    setChecking(true);
    const timer = setTimeout(async () => {
      const result = await getPyvonPortalEligibility(digits);
      if (!active) return;
      setChecking(false);
      if ('error' in result) {
        setEligibility(null);
        onEligibility?.(null);
        return;
      }
      setEligibility(result);
      onEligibility?.(result);
      // Sem portal, não deixa ficar preso na opção indisponível.
      if (!result.portalEligible && value === 'portal') onChange('whatsapp');
    }, 400);
    return () => { active = false; clearTimeout(timer); };
    // onEligibility/onChange são funções de cada tela; não entram na chave para
    // não refazer a consulta a cada render do pai.
  }, [phone]);

  const portalAvailable = !!eligibility?.portalEligible;
  const portalHint = checking
    ? 'Verificando se o contato usa o portal...'
    : !eligibility
      ? 'Informe o telefone para ver as opções de canal.'
      : portalAvailable
        ? 'Contato já usa o portal.'
        : 'Contato ainda não usa o portal — só WhatsApp.';

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Canal</label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange('whatsapp')}
          aria-pressed={value === 'whatsapp'}
          className={cn(
            'flex items-center justify-center gap-2 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-60',
            value === 'whatsapp'
              ? 'bg-[var(--accent)] border-[var(--accent)] text-white shadow-sm'
              : 'bg-[var(--surface-card)] border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--accent)]/60'
          )}
        >
          <MessageCircle size={14} /> WhatsApp
        </button>
        <button
          type="button"
          disabled={disabled || !portalAvailable}
          onClick={() => onChange('portal')}
          aria-pressed={value === 'portal'}
          title={portalAvailable ? undefined : 'Este contato ainda não usa o portal'}
          className={cn(
            'flex items-center justify-center gap-2 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed',
            value === 'portal'
              ? 'bg-[var(--accent)] border-[var(--accent)] text-white shadow-sm'
              : 'bg-[var(--surface-card)] border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--accent)]/60'
          )}
        >
          <Monitor size={14} /> Portal
        </button>
      </div>
      <p className="text-[10px] text-[var(--text-tertiary)] font-medium ml-1">{portalHint}</p>
    </div>
  );
}
