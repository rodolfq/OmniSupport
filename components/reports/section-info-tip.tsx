'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';

// Ícone "i" discreto que explica o que uma seção/gráfico significa — clique
// pra abrir, clique fora fecha. Não usa portal (diferente do StyledSelect/
// AssignChatMenu): os cards de relatório (ReportSection) não ficam dentro de
// containers com overflow-hidden, então o popover simples não corre o mesmo
// risco de ser cortado.
export function SectionInfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="O que significa"
        className="flex items-center justify-center w-4 h-4 rounded-full text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:bg-[var(--surface-pill)] transition-colors"
      >
        <Info size={13} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 w-64 z-20 p-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-xl text-[11px] font-medium text-[var(--text-secondary)] leading-relaxed">
          {text}
        </div>
      )}
    </div>
  );
}
