'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

// Mesmo padrão da antiga tela de Avaliações de Clientes (removida em 2026-11-24) — reaproveitado
// pelos 5 relatórios do roadmap "Time x Gerencial" pra voltar à tela
// principal de relatórios (/reports).
export function ReportBackLink() {
  return (
    <Link
      href="/reports"
      className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--text-tertiary)] hover:text-[var(--accent-text)] transition-colors mb-3"
    >
      <ArrowLeft size={14} /> Relatórios
    </Link>
  );
}
