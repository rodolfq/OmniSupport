'use client';

import React, { useState } from 'react';
import { WhatsAppConnect } from '@/components/whatsapp-connect';
import { MessageSquare, Code, Key } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function WhatsAppPage() {
  const [activeTab, setActiveTab] = useState<'baileys' | 'meta'>('baileys');
  
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-[var(--text-primary)]">WhatsApp</h2>
          <p className="text-[var(--text-tertiary)] font-medium">Gerencie as conexões do WhatsApp</p>
        </div>

        <div className="flex gap-1.5 p-1.5 bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)]">
          <button
            onClick={() => setActiveTab('baileys')}
            className={cn(
              "px-4 py-2 rounded-xl text-[10px] font-semibold uppercase tracking-widest transition-all flex items-center gap-2",
              activeTab === 'baileys' ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-md" : "text-[var(--text-tertiary)]"
            )}
          >
            <Code size={16} /> QR Code
          </button>
          <button
            onClick={() => setActiveTab('meta')}
            className={cn(
              "px-4 py-2 rounded-xl text-[10px] font-semibold uppercase tracking-widest transition-all flex items-center gap-2",
              activeTab === 'meta' ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-md" : "text-[var(--text-tertiary)]"
            )}
          >
            <Key size={16} /> Meta API
          </button>
        </div>
      </div>

      {activeTab === 'baileys' ? (
        <div className="grid gap-6">
          <WhatsAppConnect instanceId="default" />
          <div className="bg-[var(--surface-warning)] border border-[var(--border-alert)] rounded-2xl p-4">
            <p className="text-xs font-bold text-[var(--text-warning)]">⚠️ Requer servidor persistente (não funciona no Vercel)</p>
            <p className="text-[10px] text-[var(--text-warning)] mt-1">A conexão é gerenciada automaticamente pelo próprio servidor — não é necessário rodar nenhum processo separado.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-3xl p-6">
            <h3 className="text-lg font-black text-[var(--text-primary)] mb-4">Configuração Meta API</h3>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] block mb-1">Access Token</label>
                <input
                  type="text"
                  placeholder="Token de acesso da Meta"
                  className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-bold outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] block mb-1">Phone Number ID</label>
                <input
                  type="text"
                  placeholder="ID do número de telefone"
                  className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-bold outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] block mb-1">Verify Token</label>
                <input
                  type="text"
                  placeholder="Token de verificação"
                  className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-bold outline-none"
                />
              </div>
              <button className="px-6 py-3 bg-[var(--accent)] text-white rounded-xl text-[10px] font-semibold uppercase tracking-widest">
                Salvar Configurações
              </button>
            </div>
          </div>

          <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-4">
            <p className="text-xs font-bold text-[var(--text-secondary)] mb-2">Webhook URL:</p>
            <code className="text-[10px] bg-[var(--surface-card)] px-3 py-2 rounded font-mono">https://seu-dominio.com/api/whatsapp/webhook</code>
          </div>
        </div>
      )}
    </div>
  );
}