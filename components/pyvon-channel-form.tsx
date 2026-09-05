"use client";

import React, { useState } from 'react';
import { Copy, Check, Eye, EyeOff, Trash2, PlugZap, Loader2, CheckCircle2 } from 'lucide-react';
import { saveWhatsappInstance, deleteWhatsappInstance } from '@/lib/services/whatsapp-instance-service';
import { WhatsappInstance } from '@/lib/types';
import { StyledSelect } from '@/components/styled-select';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { toast } from 'sonner';

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="space-y-1.5">
      {label && <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">{label}</label>}
      <div className="flex gap-2">
        <input
          readOnly
          value={value}
          onFocus={(e) => e.target.select()}
          className="flex-1 min-w-0 bg-[var(--surface-pill)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-xs font-mono text-[var(--text-secondary)] outline-none"
        />
        <button
          type="button"
          onClick={copy}
          className="px-3 rounded-xl bg-[var(--surface-pill)] border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:border-[var(--accent)] transition-all shrink-0"
          title="Copiar"
        >
          {copied ? <Check size={15} className="text-[var(--text-success)]" /> : <Copy size={15} />}
        </button>
      </div>
    </div>
  );
}

export function PyvonChannelForm({
  instance,
  onSaved,
  onCancel
}: {
  instance: WhatsappInstance | null;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const isEditing = !!instance;
  const [name, setName] = useState(instance?.name || 'Pyvon');
  const [environment, setEnvironment] = useState<'prod' | 'dev'>(instance?.pyvonEnvironment || 'dev');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [testResult, setTestResult] = useState<{ channels: any[] } | null>(null);

  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/whatsapp/pyvon-webhook` : '';

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Informe um nome para o canal.');
      return;
    }
    setIsSaving(true);
    try {
      const result = await saveWhatsappInstance(
        instance?.id || null,
        name.trim(),
        instance?.phone || '',
        instance?.status || 'connected',
        'pyvon',
        { accessToken: secret.trim(), pyvonEnvironment: environment }
      );
      if ('error' in result && result.error) throw new Error(result.error);
      toast.success('Canal Pyvon salvo!');
      setSecret('');
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Erro ao salvar canal Pyvon.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!instance) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/whatsapp/pyvon/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: instance.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao testar conexão.');
      setTestResult({ channels: data.channels || [] });
      toast.success(
        data.channels?.length
          ? `Conexão confirmada — ${data.channels.length} canal(is) oficial(is) encontrado(s).`
          : 'Conexão confirmada — mas o tenant ainda não tem canal oficial (WABA) ativo no Pyvon.'
      );
    } catch (e: any) {
      toast.error(e.message || 'Falha ao testar conexão.');
    } finally {
      setIsTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!instance) return;
    setIsDeleting(true);
    try {
      const result = await deleteWhatsappInstance(instance.id);
      if ('error' in result && result.error) throw new Error(result.error);
      toast.success('Canal excluído.');
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Erro ao excluir canal.');
    } finally {
      setIsDeleting(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-3xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            instance ? "bg-[var(--surface-success)] text-[var(--text-success)]" : "bg-[var(--surface-pill)] text-[var(--text-tertiary)]"
          )}>
            <PlugZap size={18} />
          </div>
          <div>
            <p className="text-xs font-black text-[var(--text-primary)] uppercase tracking-widest">WhatsApp via Pyvon</p>
            {instance && (
              <p className="text-[10px] font-bold text-[var(--text-success)] flex items-center gap-1">
                <CheckCircle2 size={11} /> {instance.pyvonEnvironment === 'prod' ? 'Produção' : 'Homologação/DEV'}
              </p>
            )}
          </div>
        </div>
        {isEditing && instance && (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="p-2 rounded-lg text-[var(--text-danger)] hover:bg-[var(--surface-danger)] transition-all"
            title="Excluir canal"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Nome do Canal</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Pyvon"
            className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">Ambiente</label>
          <StyledSelect
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as 'prod' | 'dev')}
            className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
          >
            <option value="dev">Homologação (api-dev.pyvon.io)</option>
            <option value="prod">Produção (api.pyvon.io)</option>
          </StyledSelect>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">X-Pyvon-Secret</label>
        <div className="relative">
          <input
            type={showSecret ? 'text' : 'password'}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={instance?.hasAccessToken ? '•••••••• (já configurado — deixe em branco para manter)' : 'Segredo do tenant, entregue pelo Pyvon'}
            className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 pr-11 py-3 text-sm font-mono focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
          />
          <button
            type="button"
            onClick={() => setShowSecret(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[var(--text-tertiary)] hover:text-[var(--accent-text)]"
          >
            {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <div className="p-4 bg-[var(--accent)]/5 border border-[var(--accent)]/15 rounded-2xl space-y-3">
        <p className="text-[10px] font-black text-[var(--accent-text)] uppercase tracking-widest">URL do webhook a cadastrar no Pyvon</p>
        <CopyField label="" value={webhookUrl} />
        <p className="text-[10px] text-[var(--text-tertiary)] font-medium leading-relaxed">
          Peça pra Pyvon cadastrar esta URL como o &quot;bot&quot; do tenant, com o bot ligado e o plugin de bot ativo — sem isso, mensagens do cliente nunca chegam aqui.
        </p>
      </div>

      {testResult && (
        <div className="p-3 bg-[var(--surface-success)] border border-[var(--text-success)]/20 rounded-xl text-xs font-bold text-[var(--text-success)]">
          {testResult.channels.length > 0
            ? testResult.channels.map(c => `${c.name} (${c.provider})`).join(', ')
            : 'Segredo válido — nenhum canal oficial ativo ainda no tenant.'}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="flex-1 py-3 bg-[var(--accent)] text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-md hover:bg-[var(--accent-hover)] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {isSaving && <Loader2 size={14} className="animate-spin" />}
          {isEditing ? 'Salvar Alterações' : 'Criar Canal'}
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={!isEditing || isTesting}
          title={!isEditing ? 'Salve o canal antes de testar' : 'Testar Conexão'}
          className="flex-1 py-3 bg-[var(--surface-pill)] border border-[var(--border-default)] text-[var(--text-secondary)] rounded-xl text-xs font-black uppercase tracking-widest hover:border-[var(--accent)] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isTesting ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />}
          Testar Conexão
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="py-3 px-4 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] text-xs font-black uppercase tracking-widest transition-all"
          >
            Cancelar
          </button>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={handleDelete}
        title="Excluir canal Pyvon?"
        description={`Isso remove o segredo salvo de "${instance?.name}". Se alguma Fila estiver usando esse canal, a exclusão será bloqueada até você desvincular.`}
        confirmLabel={isDeleting ? 'Excluindo...' : 'Excluir'}
        variant="danger"
      />
    </div>
  );
}
