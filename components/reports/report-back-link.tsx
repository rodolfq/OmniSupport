'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

// Mesmo padrão já usado em customer-evaluations/page.tsx — reaproveitado
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
