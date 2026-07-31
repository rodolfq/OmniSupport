'use client';

import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Cache client-side compartilhado entre componentes — resolve o problema
// medido de companies/profiles/config sendo buscados de novo (via
// supabase.from(...) → POST /api/compat/supabase, que não é cacheável por
// Cache-Control) toda vez que um novo filtro/modal monta. staleTime
// generoso por padrão porque a maior parte do que passa por aqui é dado de
// referência (empresas, analistas, categorias) — telas com dado "vivo"
// (chamados, chat) continuam com seu próprio polling/SSE, sem depender
// disto. new QueryClient() dentro de useState (não no módulo) evita
// compartilhar client entre requisições diferentes no server.
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1
      }
    }
  }));

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
