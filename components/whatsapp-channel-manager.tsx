"use client";

import React, { useEffect, useState } from 'react';
import { Plus, QrCode, Sparkles } from 'lucide-react';
import { getWhatsappInstances } from '@/lib/services/whatsapp-instance-service';
import { WhatsappInstance } from '@/lib/types';
import { WhatsAppConnect } from '@/components/whatsapp-connect';
import { MetaWhatsAppChannelForm } from '@/components/meta-whatsapp-channel-form';

// Duas famílias de canal, lado a lado: o canal Baileys fixo ('default', QR
// Code — já existia) e a lista de canais Meta Cloud API (oficial, 0..N),
// que reaproveita a mesma tabela whatsapp_instances via provider.
export function WhatsAppChannelManager() {
  const [instances, setInstances] = useState<WhatsappInstance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddingMeta, setIsAddingMeta] = useState(false);

  const load = async () => {
    const data = await getWhatsappInstances();
    setInstances(data as WhatsappInstance[]);
    setIsLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const metaInstances = instances.filter(i => i.provider === 'meta');

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
            <Sparkles size={14} />
            <p className="text-[10px] font-black uppercase tracking-widest">WhatsApp Oficial (Meta Cloud API)</p>
          </div>
          {!isAddingMeta && (
            <button
              onClick={() => setIsAddingMeta(true)}
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
            {metaInstances.map(inst => (
              <MetaWhatsAppChannelForm
                key={inst.id}
                instance={inst}
                onSaved={load}
              />
            ))}

            {isAddingMeta && (
              <MetaWhatsAppChannelForm
                instance={null}
                onSaved={() => { setIsAddingMeta(false); load(); }}
                onCancel={() => setIsAddingMeta(false)}
              />
            )}

            {!isAddingMeta && metaInstances.length === 0 && (
              <div className="p-6 text-center bg-[var(--surface-card)] rounded-2xl border border-dashed border-[var(--border-default)]">
                <p className="text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-widest">Nenhum canal Meta configurado</p>
                <p className="text-[10px] text-[var(--text-tertiary)] mt-1">Recomendado para produção — não depende de manter uma sessão conectada, e sobrevive a reinício do servidor.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
