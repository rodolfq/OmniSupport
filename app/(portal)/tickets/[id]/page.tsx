'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useApp } from '@/app/app-context';
import { supabase } from '@/lib/supabase';
import { UserRole } from '@/lib/types';
import { Loader2, SearchX } from 'lucide-react';

// Resolvedor de link direto pro chamado — /tickets/1234 (número público, o
// que aparece na tela e nos e-mails) redireciona pra onde o chamado
// realmente abre (modal sobre /dashboard ou /my-tickets, dependendo do
// papel de quem clicou). Aceita também o id interno (UUID) por compat com
// o único link que já apontava pra esta rota (customers/[id]/page.tsx).
// Substitui a página de detalhe standalone que existia aqui antes — nunca
// foi ligada a dados reais (e-mail/empresa fixos no código) e duplicava o
// que o modal já faz completo.
export default function TicketLinkResolverPage() {
  const params = useParams();
  const router = useRouter();
  const { currentUser, authInitialized } = useApp();
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!authInitialized || !currentUser) return;
    const raw = String(params.id || '');
    if (!raw) { setNotFound(true); return; }

    async function resolve() {
      const isNumeric = /^\d+$/.test(raw);
      const { data } = await supabase
        .from('tickets')
        .select('id')
        .eq(isNumeric ? 'public_ticket_number' : 'id', isNumeric ? Number(raw) : raw)
        .maybeSingle();

      if (!data?.id) {
        setNotFound(true);
        return;
      }

      const isCompanyUser = [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser!.role as UserRole);
      const base = isCompanyUser ? '/my-tickets' : '/dashboard';
      router.replace(`${base}?ticket=${data.id}`);
    }

    resolve();
  }, [params.id, authInitialized, currentUser, router]);

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-20">
        <SearchX size={40} className="text-slate-300" />
        <h2 className="text-lg font-bold text-[var(--text-primary)]">Chamado não encontrado</h2>
        <p className="text-sm text-[var(--text-tertiary)]">Confira o número do chamado ou se você tem acesso a ele.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-tertiary)]">
      <Loader2 size={28} className="animate-spin" />
      <p className="text-sm font-medium">Abrindo chamado...</p>
    </div>
  );
}
