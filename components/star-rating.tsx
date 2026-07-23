'use client';

import React, { useState } from 'react';
import { Star } from 'lucide-react';

// Widget de 1-5 estrelas clicáveis, usado tanto no modal de avaliação
// (components/customer-evaluation-modal.tsx) quanto direto no cadastro da
// empresa (components/new-company-modal.tsx) — mesmo componente pra manter
// os dois editáveis do mesmo jeito.
//
// value === null representa "não avaliado" nesse critério — fica vazio (sem
// estrela preenchida) e não entra na média. Clicar na estrela que já está
// marcada como a nota atual limpa a avaliação de volta pra vazio, em vez de
// exigir um botão "não se aplica" à parte.
export function StarRating({ value, onChange, size = 20 }: { value: number | null; onChange: (v: number | null) => void; size?: number }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(value === n ? null : n)}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          className="p-0.5 text-amber-400 hover:scale-110 transition-transform"
        >
          <Star size={size} fill={(hover || (value ?? 0)) >= n ? 'currentColor' : 'none'} strokeWidth={1.75} />
        </button>
      ))}
    </div>
  );
}
