'use client';

import React, { useState } from 'react';
import { Star } from 'lucide-react';

// Widget de 1-5 estrelas clicáveis, usado tanto no modal de avaliação
// (components/customer-evaluation-modal.tsx) quanto direto no cadastro do
// cliente (components/edit-employee-modal.tsx) — mesmo componente pra manter
// os dois editáveis do mesmo jeito.
export function StarRating({ value, onChange, size = 20 }: { value: number; onChange: (v: number) => void; size?: number }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          className="p-0.5 text-amber-400 hover:scale-110 transition-transform"
        >
          <Star size={size} fill={(hover || value) >= n ? 'currentColor' : 'none'} strokeWidth={1.75} />
        </button>
      ))}
    </div>
  );
}
