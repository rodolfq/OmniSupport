'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Building2, Phone, Ticket as TicketIcon, MessageCircle, Loader2, ThumbsUp, ThumbsDown, Circle, GraduationCap, CheckCircle2, Clock } from 'lucide-react';
import { Company, Ticket, User, UserRole } from '@/lib/types';
import { CompanyService, TrainingStage, getCompanyTrainingStages } from '@/lib/services/company-service';
import { TicketService } from '@/lib/services/ticket-service';
import { UserService } from '@/lib/services/user-service';
import { getActiveSessionsByCompany, getChatHistoriesByCompany, CompanyActiveSession, PreviousChatHistoriesResult } from '@/lib/services/chat-service';
import { isClosedTicketStatus } from '@/lib/ticket-status';
import { ClientTime } from '@/components/client-time';
import { cn } from '@/lib/utils';
import { useApp } from '@/app/app-context';

const TICKETS_PAGE_SIZE = 15;
const HISTORIES_PAGE_SIZE = 10;

// Tela dedicada por empresa (item 13 do roadmap) — aberta a partir do nome
// da empresa no cabeçalho do chat (components/chat-widget.tsx). Reúne, numa
// visão só de leitura, os chamados e os atendimentos (em andamento e
// finalizados) daquela empresa, reaproveitando as queries dos itens 7/8.
export default function CompanyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const companyId = params.id as string;
  const { currentUser } = useApp();
  const isCompanyPortalUser = [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser?.role as UserRole);

  const [company, setCompany] = useState<Company | null>(null);
  const [loadingCompany, setLoadingCompany] = useState(true);
  const [internalUsers, setInternalUsers] = useState<User[]>([]);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketsTotal, setTicketsTotal] = useState(0);
  const [loadingTickets, setLoadingTickets] = useState(true);

  const [activeSessions, setActiveSessions] = useState<CompanyActiveSession[]>([]);
  const [loadingActiveSessions, setLoadingActiveSessions] = useState(true);

  const [histories, setHistories] = useState<PreviousChatHistoriesResult['histories']>([]);
  const [historiesTotal, setHistoriesTotal] = useState(0);
  const [loadingHistories, setLoadingHistories] = useState(true);

  const [trainingStages, setTrainingStages] = useState<TrainingStage[]>([]);
  const [loadingTrainingStages, setLoadingTrainingStages] = useState(false);

  // companyId (o param da URL) pode ser o UUID interno OU o slug bonito
  // "idCentral-nome" (ver lib/utils.ts, companyDetailHref) — resolveBySlug
  // aceita os dois. Tickets/sessões/histórico/etapas de treinamento
  // precisam do id INTERNO de verdade (é o que as FKs usam), por isso só
  // disparam depois que a empresa resolve, no efeito seguinte — nunca com o
  // param cru.
  useEffect(() => {
    if (!companyId) return;
    setLoadingCompany(true);
    CompanyService.resolveBySlug(companyId)
      .then(setCompany)
      .finally(() => setLoadingCompany(false));

    // CS/Comercial Responsável são perfil interno — Cliente/Funcionário não
    // tem acesso a /api/users?type=analysts (403), nem precisa ver esse dado
    // (mesma regra de app/(portal)/customers/page.tsx).
    if (!isCompanyPortalUser) {
      UserService.getAnalysts().then(setInternalUsers).catch(() => setInternalUsers([]));
    }
  }, [companyId]);

  useEffect(() => {
    const resolvedId = company?.id;
    if (!resolvedId) return;

    setLoadingTickets(true);
    TicketService.getByCompanyPaginated(resolvedId, TICKETS_PAGE_SIZE, 0)
      .then(res => { setTickets(res.tickets); setTicketsTotal(res.total); })
      .finally(() => setLoadingTickets(false));

    setLoadingActiveSessions(true);
    getActiveSessionsByCompany(resolvedId)
      .then(setActiveSessions)
      .finally(() => setLoadingActiveSessions(false));

    setLoadingHistories(true);
    getChatHistoriesByCompany(resolvedId, HISTORIES_PAGE_SIZE, 0)
      .then(res => { setHistories(res.histories); setHistoriesTotal(res.total); })
      .finally(() => setLoadingHistories(false));

    if (company?.isInTraining && !isCompanyPortalUser) {
      setLoadingTrainingStages(true);
      getCompanyTrainingStages(resolvedId)
        .then(setTrainingStages)
        .finally(() => setLoadingTrainingStages(false));
    } else {
      setTrainingStages([]);
    }
  }, [company?.id, company?.isInTraining, isCompanyPortalUser]);

  const resolveInternalUser = (id?: string | null) => internalUsers.find(u => u.id === id);

  const handleLoadMoreTickets = async () => {
    if (!company?.id) return;
    setLoadingTickets(true);
    try {
      const res = await TicketService.getByCompanyPaginated(company.id, TICKETS_PAGE_SIZE, tickets.length);
      setTickets(prev => [...prev, ...res.tickets]);
      setTicketsTotal(res.total);
    } finally {
      setLoadingTickets(false);
    }
  };

  const handleLoadMoreHistories = async () => {
    if (!company?.id) return;
    setLoadingHistories(true);
    try {
      const res = await getChatHistoriesByCompany(company.id, HISTORIES_PAGE_SIZE, histories.length);
      setHistories(prev => [...prev, ...res.histories]);
      setHistoriesTotal(res.total);
    } finally {
      setLoadingHistories(false);
    }
  };

  return (
    <div className="h-full flex flex-col gap-6 overflow-y-auto">
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="p-2 hover:bg-[var(--surface-pill)] rounded-xl transition-all text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
          <ChevronLeft size={24} />
        </button>
        <div className="w-12 h-12 rounded-2xl bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent-text)] shrink-0 overflow-hidden">
          {company?.logoThumbUrl ? (
            <img src={company.logoThumbUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <Building2 size={22} />
          )}
        </div>
        <div className="min-w-0">
          {loadingCompany ? (
            <div className="h-6 w-48 rounded bg-[var(--surface-pill)] animate-pulse" />
          ) : !company ? (
            <h1 className="text-xl font-black text-[var(--text-primary)]">Empresa não encontrada</h1>
          ) : (
            <>
              <h1 className="text-2xl font-black text-[var(--text-primary)] tracking-tight truncate">{company.name}</h1>
              <p className="text-xs text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1 flex items-center gap-3">
                {company.industry && <span>{company.industry}</span>}
                {company.phone && <span className="flex items-center gap-1"><Phone size={11} /> {company.phone}</span>}
              </p>
              {!isCompanyPortalUser && company.isInTraining && (
                <span className="inline-flex items-center gap-1.5 mt-2 text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg bg-[var(--surface-info)] text-[var(--text-info)]">
                  <GraduationCap size={12} /> Em treinamento
                </span>
              )}
              {!isCompanyPortalUser && (
                <p className="text-xs text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1.5 flex items-center gap-3">
                  <span>CS: <span className="text-[var(--text-secondary)] normal-case">{resolveInternalUser(company.csResponsavelId)?.name || 'Não definido'}</span></span>
                  <span>Comercial: <span className="text-[var(--text-secondary)] normal-case">{resolveInternalUser(company.comercialResponsavelId)?.name || 'Não definido'}</span></span>
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {!isCompanyPortalUser && company?.isInTraining && (
        <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] shadow-sm p-5 space-y-3">
          <h2 className="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2">
            <GraduationCap size={15} className="text-[var(--text-tertiary)]" /> Etapas de Treinamento
          </h2>
          {loadingTrainingStages ? (
            <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] font-medium py-1">
              <Loader2 size={14} className="animate-spin" /> Carregando...
            </div>
          ) : trainingStages.length === 0 ? (
            <p className="text-xs text-[var(--text-tertiary)] font-medium italic">Nenhuma etapa cadastrada.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {trainingStages.map(stage => {
                const meta = stage.status === 'Concluído'
                  ? { icon: CheckCircle2, color: 'text-[var(--text-success)]', chip: 'bg-[var(--surface-success)] text-[var(--text-success)]' }
                  : stage.status === 'Em andamento'
                  ? { icon: Clock, color: 'text-[var(--text-warning)]', chip: 'bg-[var(--surface-warning)] text-[var(--text-warning)]' }
                  : { icon: Circle, color: 'text-[var(--text-tertiary)]', chip: 'bg-[var(--surface-pill)] text-[var(--text-tertiary)]' };
                return (
                  <div key={stage.id} className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-[var(--border-default)]">
                    <div className="flex items-center gap-2 min-w-0">
                      <meta.icon size={14} className={cn('shrink-0', meta.color)} />
                      <span className="text-xs font-bold text-[var(--text-primary)] truncate">{stage.name}</span>
                    </div>
                    <span className={cn('shrink-0 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-lg', meta.chip)}>
                      {stage.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">
        {/* Chamados */}
        <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] shadow-sm flex flex-col overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--border-default)] flex items-center gap-2">
            <TicketIcon size={16} className="text-[var(--text-tertiary)]" />
            <h2 className="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)]">
              Chamados {ticketsTotal > 0 && `(${ticketsTotal})`}
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {tickets.length === 0 && !loadingTickets ? (
              <div className="text-center py-16">
                <TicketIcon className="mx-auto text-slate-200 mb-2" size={28} />
                <p className="text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-widest">Nenhum chamado desta empresa</p>
              </div>
            ) : (
              tickets.map(t => (
                <a
                  key={t.id}
                  href={`/tickets/${t.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-4 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 transition-all"
                >
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <span className="text-[10px] font-black text-[var(--accent-text)] bg-[var(--accent)]/10 px-2 py-0.5 rounded tracking-widest">
                      #{t.ticketNumber ? String(t.ticketNumber).padStart(4, '0') : t.id.slice(0, 8)}
                    </span>
                    <span className={cn(
                      "text-[9px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full",
                      isClosedTicketStatus(t.status) ? "bg-[var(--surface-success)] text-[var(--text-success)]" : "bg-[var(--surface-info)] text-[var(--text-info)]"
                    )}>
                      {t.status}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-[var(--text-primary)] truncate mb-1">{t.title}</p>
                  <p className="text-[10px] text-[var(--text-tertiary)] font-medium">
                    {t.priority} · <ClientTime date={t.createdAt} showDate showTime />
                  </p>
                </a>
              ))
            )}
            {loadingTickets && (
              <div className="flex items-center justify-center py-4 text-[var(--text-tertiary)]">
                <Loader2 size={18} className="animate-spin" />
              </div>
            )}
            {!loadingTickets && tickets.length < ticketsTotal && (
              <button
                onClick={handleLoadMoreTickets}
                className="w-full py-2.5 text-[10px] font-black uppercase tracking-widest text-[var(--accent-text)] hover:bg-[var(--accent)]/5 rounded-xl transition-all"
              >
                Carregar mais
              </button>
            )}
          </div>
        </div>

        {/* Atendimentos */}
        <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] shadow-sm flex flex-col overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--border-default)] flex items-center gap-2">
            <MessageCircle size={16} className="text-[var(--text-tertiary)]" />
            <h2 className="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)]">Atendimentos</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {/* Em andamento */}
            <div className="space-y-2">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] px-1">Em andamento</h3>
              {loadingActiveSessions ? (
                <div className="flex items-center justify-center py-4 text-[var(--text-tertiary)]">
                  <Loader2 size={16} className="animate-spin" />
                </div>
              ) : activeSessions.length === 0 ? (
                <p className="text-[11px] text-[var(--text-tertiary)] font-medium px-1 py-2">Nenhum atendimento em andamento agora.</p>
              ) : (
                activeSessions.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    // Abre a conversa ao vivo no widget flutuante — mesmo
                    // mecanismo de ?chat= já usado por notificações/links de
                    // chat (ver components/chat-widget.tsx), que existe desde
                    // que este comentário de "sem link pronto" foi escrito.
                    onClick={() => router.push(`/customers/${companyId}?chat=${s.id}`)}
                    className="w-full p-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] flex items-center gap-2.5 text-left hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 transition-all"
                  >
                    <Circle size={8} className="text-[var(--text-success)] fill-current shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-[var(--text-secondary)] truncate">{s.customerName || 'Sem nome'}</p>
                      <p className="text-[10px] text-[var(--text-tertiary)] font-medium">
                        {s.status} {s.assigneeName ? `· ${s.assigneeName}` : '· Sem atendente'}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Finalizados */}
            <div className="space-y-2">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] px-1">
                Finalizados {historiesTotal > 0 && `(${historiesTotal})`}
              </h3>
              {histories.length === 0 && !loadingHistories ? (
                <p className="text-[11px] text-[var(--text-tertiary)] font-medium px-1 py-2">Nenhum atendimento finalizado ainda.</p>
              ) : (
                histories.map(h => {
                  const durationLabel = h.durationSeconds != null
                    ? `${Math.floor(h.durationSeconds / 60)}m ${h.durationSeconds % 60}s`
                    : null;
                  return (
                    // Mesmo destino de "Ver conversa" em reports/satisfaction —
                    // abre a conversa fechada na íntegra (transcript completo,
                    // com download TXT/PDF) em vez de só o resumo desta lista.
                    <Link
                      key={h.id}
                      href={`/chat-history?historyId=${h.id}`}
                      className="block p-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 transition-all"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-[var(--text-secondary)] truncate">{h.customerName || 'Sem nome'}</p>
                        {h.rating === 1 && (
                          <ThumbsUp size={11} className="text-[var(--text-success)] shrink-0" />
                        )}
                        {h.rating === -1 && (
                          <ThumbsDown size={11} className="text-[var(--text-danger)] shrink-0" />
                        )}
                      </div>
                      <p className="text-[10px] text-[var(--text-tertiary)] font-medium mt-0.5">
                        <ClientTime date={h.finishedAt} showDate showTime />
                        {h.assigneeName ? ` · ${h.assigneeName}` : ''}
                        {durationLabel ? ` · ${durationLabel}` : ''}
                      </p>
                    </Link>
                  );
                })
              )}
              {loadingHistories && (
                <div className="flex items-center justify-center py-4 text-[var(--text-tertiary)]">
                  <Loader2 size={18} className="animate-spin" />
                </div>
              )}
              {!loadingHistories && histories.length < historiesTotal && (
                <button
                  onClick={handleLoadMoreHistories}
                  className="w-full py-2.5 text-[10px] font-black uppercase tracking-widest text-[var(--accent-text)] hover:bg-[var(--accent)]/5 rounded-xl transition-all"
                >
                  Carregar mais
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
