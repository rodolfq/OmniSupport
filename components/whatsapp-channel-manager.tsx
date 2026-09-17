"use client";

import React, { useEffect, useState } from 'react';
import { Plus, QrCode, Radio } from 'lucide-react';
import { getWhatsappInstances } from '@/lib/services/whatsapp-instance-service';
import { WhatsappInstance } from '@/lib/types';
import { WhatsAppConnect } from '@/components/whatsapp-connect';
import { PyvonChannelForm } from '@/components/pyvon-channel-form';
import { PyvonTemplatesManager } from '@/components/pyvon-templates-manager';

// Duas famílias de canal, lado a lado: o canal Baileys fixo ('default', QR
// Code — já existia) e a lista de canais Pyvon (BSP/CRM que já cuida do WABA
// oficial) — as duas reaproveitando a mesma tabela whatsapp_instances via
// provider. A integração Meta Cloud API existiu aqui antes e foi removida
// (2026-09-17, pedido do usuário) — só Baileys e Pyvon em produção.
export function WhatsAppChannelManager() {
  const [instances, setInstances] = useState<WhatsappInstance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddingPyvon, setIsAddingPyvon] = useState(false);

  const load = async () => {
    const data = await getWhatsappInstances();
    setInstances(data as WhatsappInstance[]);
    setIsLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const pyvonInstances = instances.filter(i => i.provider === 'pyvon');

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
          <QrCode size={14} />
          <p className="text-[10px] font-black uppercase tracking-widest">QR Code (WhatsApp Web)</p>
        </div>
        <WhatsAppConnect instanceId="default" />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
            <Radio size={14} />
            <p className="text-[10px] font-black uppercase tracking-widest">WhatsApp via Pyvon</p>
          </div>
          {!isAddingPyvon && pyvonInstances.length === 0 && (
            <button
              onClick={() => setIsAddingPyvon(true)}
              className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[var(--accent-text)] bg-[var(--accent)]/10 px-3 py-1.5 rounded-lg hover:bg-[var(--accent)]/20 transition-all"
            >
              <Plus size={13} /> Adicionar Canal
            </button>
          )}
        </div>

        {isLoading ? (
          <p className="text-xs text-[var(--text-tertiary)] font-medium">Carregando canais...</p>
        ) : (
          <div className="space-y-4">
            {pyvonInstances.map(inst => (
              <PyvonChannelForm key={inst.id} instance={inst} onSaved={load} />
            ))}

            {isAddingPyvon && (
              <PyvonChannelForm
                instance={null}
                onSaved={() => { setIsAddingPyvon(false); load(); }}
                onCancel={() => setIsAddingPyvon(false)}
              />
            )}

            {!isAddingPyvon && pyvonInstances.length === 0 && (
              <div className="p-6 text-center bg-[var(--surface-card)] rounded-2xl border border-dashed border-[var(--border-default)]">
                <p className="text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-widest">Nenhum canal Pyvon configurado</p>
                <p className="text-[10px] text-[var(--text-tertiary)] mt-1">Um único tenant/número por conta — o Pyvon já cuida da conexão oficial (WABA) do outro lado.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {pyvonInstances.length > 0 && <PyvonTemplatesManager />}
    </div>
  );
}
