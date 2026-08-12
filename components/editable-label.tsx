'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Pencil, Check, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Rótulo editável no lugar (Configurações > Geral do Sistema). Substitui o
// texto puro que as listas de configuração mostravam: antes só dava pra criar
// e excluir, então corrigir um nome errado significava apagar o item e criar
// outro — o que troca o id e desliga o item de todos os registros que já
// apontavam pra ele.
//
// Só deve ser usado em listas referenciadas por ID (categorias, tipos de
// solicitação, produtos, esforço, desfecho). NÃO usar em Prioridade nem
// Status: essas duas são referenciadas pelo RÓTULO em texto
// (tickets.priority / tickets.status), e renomear deixaria os registros
// existentes apontando pra um valor inexistente.
//
// Teclado: Enter grava, Esc cancela. Blur também grava — quem clicou fora
// depois de digitar quase sempre quis salvar, e perder a digitação por um
// clique acidental irrita mais do que gravar algo que ainda dá pra editar.

interface EditableLabelProps {
  value: string;
  onSave: (next: string) => Promise<void>;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
}

export function EditableLabel({ value, onSave, disabled, className, inputClassName }: EditableLabelProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Evita gravar duas vezes quando o Enter dispara o submit e o blur logo em
  // seguida (o input perde o foco ao sair do modo de edição).
  const committedRef = useRef(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const start = () => {
    if (disabled) return;
    committedRef.current = false;
    setDraft(value);
    setEditing(true);
  };

  const cancel = () => {
    committedRef.current = true;
    setDraft(value);
    setEditing(false);
  };

  const commit = async () => {
    if (committedRef.current) return;
    committedRef.current = true;

    const next = draft.trim();
    // Nome vazio ou inalterado não vira requisição — só sai do modo de edição.
    if (!next || next === value) {
      setDraft(value);
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      // Quem chama já mostra o toast do erro (nome duplicado, falha de rede).
      // Aqui só devolve o valor anterior pra tela não ficar exibindo um nome
      // que o banco recusou.
      setDraft(value);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <span className="flex items-center gap-1 flex-1 min-w-0">
        <input
          ref={inputRef}
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          className={cn(
            'flex-1 min-w-0 bg-[var(--surface-card)] border border-[var(--accent)] rounded-lg px-2 py-1',
            'text-sm font-medium outline-none focus:ring-2 focus:ring-[var(--accent)]/20 disabled:opacity-60',
            inputClassName
          )}
        />
        {saving ? (
          <Loader2 size={14} className="animate-spin text-[var(--text-tertiary)] shrink-0" />
        ) : (
          <>
            {/* onMouseDown em vez de onClick: o blur do input dispara antes do
                click e fecharia a edição antes do botão ser acionado. */}
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); commit(); }}
              className="p-1 rounded text-[var(--text-success)] hover:bg-[var(--surface-success)] transition-colors shrink-0"
              title="Salvar"
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); cancel(); }}
              className="p-1 rounded text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] transition-colors shrink-0"
              title="Cancelar"
            >
              <X size={14} />
            </button>
          </>
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={disabled}
      title={disabled ? undefined : 'Clique para renomear'}
      className={cn(
        'group flex items-center gap-1.5 flex-1 min-w-0 text-left rounded px-1 -mx-1',
        !disabled && 'hover:bg-[var(--surface-pill)] cursor-text',
        disabled && 'cursor-default',
        className
      )}
    >
      <span className="truncate">{value}</span>
      {!disabled && (
        <Pencil
          size={12}
          className="text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        />
      )}
    </button>
  );
}
