'use client';

import React, { useState, useEffect } from 'react';
import { Rocket, Plus, Search, Trash2, Pencil, CheckCircle2, XCircle, Clock, AlertTriangle, CalendarDays, History as HistoryIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Hotfix, Permission, User } from '@/lib/types';
import { UserService } from '@/lib/services/user-service';
import { getHotfixes, saveHotfix, deleteHotfix, markHotfixPublished } from '@/app/actions';
import { StyledSelect } from '@/components/styled-select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useApp } from '@/app/app-context';
import { cn } from '@/lib/utils';

const todayIso = () => new Date().toISOString().slice(0, 10);

function isOverdue(hotfix: Hotfix): boolean {
  if (hotfix.publishedAt) return false;
  return hotfix.expectedDate < todayIso();
}

// Semana corrente (segunda a domingo), calculada no fuso do navegador —
// mesmo nível de precisão do resto do app (ClientTime etc).
function getCurrentWeekRange(): { monday: Date; sunday: Date } {
  const now = new Date();
  const day = now.getDay(); // 0 = domingo
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6, 23, 59, 59, 999);
  return { monday, sunday };
}

function isInCurrentWeek(expectedDate: string): boolean {
  const { monday, sunday } = getCurrentWeekRange();
  const d = new Date(`${expectedDate}T00:00:00`);
  return d >= monday && d <= sunday;
}

function formatDate(dateOnly: string): string {
  return new Date(`${dateOnly}T00:00:00`).toLocaleDateString('pt-BR');
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function HotfixesPage() {
  const { hasPermission } = useApp();
  const [hotfixes, setHotfixes] = useState<Hotfix[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedHotfix, setSelectedHotfix] = useState<Hotfix | null>(null);
  const [deletingHotfix, setDeletingHotfix] = useState<Hotfix | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [responsibleId, setResponsibleId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [dbHotfixes, analysts] = await Promise.all([
      getHotfixes(),
      UserService.getAnalysts()
    ]);
    setHotfixes(dbHotfixes as Hotfix[]);
    setUsers(analysts);
  };

  const handleOpenModal = (hotfix?: Hotfix) => {
    if (hotfix) {
      setSelectedHotfix(hotfix);
      setName(hotfix.name);
      setDescription(hotfix.description || '');
      setResponsibleId(hotfix.responsibleId || '');
      setExpectedDate(hotfix.expectedDate);
    } else {
      setSelectedHotfix(null);
      setName('');
      setDescription('');
      setResponsibleId('');
      setExpectedDate('');
    }
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!name || !expectedDate) return;

    const res = await saveHotfix(
      selectedHotfix?.id || null,
      name,
      description || null,
      responsibleId || null,
      expectedDate
    );

    if (res && (res as any).error) {
      alert((res as any).error);
      return;
    }

    setIsModalOpen(false);
    loadData();
  };

  const handleMarkPublished = async (hotfix: Hotfix) => {
    const res = await markHotfixPublished(hotfix.id);
    if (res && (res as any).error) {
      alert((res as any).error);
      return;
    }
    loadData();
  };

  if (!hasPermission(Permission.HOTFIXES_MANAGE)) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-center">
        <XCircle size={48} className="text-[var(--text-danger)] mb-4" />
        <h2 className="text-2xl font-black text-[var(--text-primary)] uppercase tracking-tight">Acesso Negado</h2>
        <p className="text-[var(--text-tertiary)]">Você não tem permissão para gerenciar hotfixes.</p>
      </div>
    );
  }

  const q = search.toLowerCase();
  const visibleHotfixes = hotfixes.filter(h =>
    h.name.toLowerCase().includes(q) || (h.description || '').toLowerCase().includes(q)
  );
  const published = visibleHotfixes
    .filter(h => h.publishedAt)
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  const unpublished = visibleHotfixes.filter(h => !h.publishedAt);
  const weekHighlight = unpublished
    .filter(h => isInCurrentWeek(h.expectedDate))
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  const upcoming = unpublished
    .filter(h => !isInCurrentWeek(h.expectedDate))
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));

  const resolveResponsible = (hotfix: Hotfix) => users.find(u => u.id === hotfix.responsibleId);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-[var(--text-primary)] tracking-tight flex items-center gap-3">
            <Rocket className="text-[var(--accent-text)]" size={32} />
            Hotfixes
          </h2>
          <p className="text-[var(--text-tertiary)] font-medium">Janela de release do time — o que já foi publicado, o que vem por aí e o que é desta semana</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={16} />
            <input
              type="text"
              placeholder="Buscar hotfix..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl pl-11 pr-4 py-3 text-sm font-medium focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all w-56"
            />
          </div>
          <button
            onClick={() => handleOpenModal()}
            className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white px-6 py-3 rounded-2xl text-sm font-black uppercase tracking-widest shadow-lg shadow-indigo-200 transition-all flex items-center gap-2 shrink-0"
          >
            <Plus size={18} />
            Novo Hotfix
          </button>
        </div>
      </div>

      {/* Destaque: hotfix(es) da semana */}
      <div className="space-y-3">
        <h3 className="text-xs font-black uppercase tracking-widest text-[var(--text-tertiary)] flex items-center gap-2">
          <CalendarDays size={15} className="text-[var(--accent-text)]" /> Hotfix da Semana
        </h3>
        {weekHighlight.length === 0 ? (
          <div className="rounded-[2rem] border-2 border-dashed border-[var(--border-default)] p-8 text-center">
            <Rocket className="mx-auto text-slate-200 mb-2" size={32} />
            <p className="text-sm font-bold text-[var(--text-tertiary)] uppercase tracking-widest">Nenhum hotfix agendado para esta semana</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {weekHighlight.map(hotfix => {
              const overdue = isOverdue(hotfix);
              const responsible = resolveResponsible(hotfix);
              return (
                <div
                  key={hotfix.id}
                  className={cn(
                    "relative overflow-hidden rounded-[2rem] p-7 text-white shadow-xl",
                    overdue
                      ? "bg-gradient-to-br from-[#7A1F1F] to-[#B92C2C] shadow-red-200"
                      : "bg-gradient-to-br from-[#0D3A69] to-[#15558A] shadow-indigo-100"
                  )}
                >
                  <Rocket className="absolute -right-6 -bottom-6 w-32 h-32 text-white/10" />
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-3">
                      <span className={cn(
                        "text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full",
                        overdue ? "bg-white/20" : "bg-[#18C7A8]/25 text-[#B9F3E7]"
                      )}>
                        {overdue ? 'Atrasado — ainda esta semana' : 'Agendado para esta semana'}
                      </span>
                    </div>
                    <h4 className="text-xl font-black tracking-tight uppercase leading-tight mb-2">{hotfix.name}</h4>
                    {hotfix.description && (
                      <p className="text-xs text-white/70 font-medium mb-4 line-clamp-2">{hotfix.description}</p>
                    )}
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-white/60 mb-0.5">Publicação prevista</p>
                        <p className="text-2xl font-black tracking-tight">{formatDate(hotfix.expectedDate)}</p>
                      </div>
                      {responsible && (
                        <p className="text-[10px] font-bold uppercase tracking-widest text-white/70 text-right">{responsible.name}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-5">
                      <button
                        onClick={() => handleMarkPublished(hotfix)}
                        className="flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white text-[#0D3A69] hover:bg-white/90 transition-all"
                      >
                        Marcar como Publicado
                      </button>
                      <button
                        onClick={() => handleOpenModal(hotfix)}
                        className="p-2.5 rounded-xl bg-white/15 hover:bg-white/25 transition-all"
                        title="Editar"
                      >
                        <Pencil size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Próximos */}
      <div className="space-y-3">
        <h3 className="text-xs font-black uppercase tracking-widest text-[var(--text-tertiary)] flex items-center gap-2">
          <Clock size={15} className="text-[var(--accent-text)]" /> Próximos ({upcoming.length})
        </h3>
        <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2.5rem] shadow-sm overflow-hidden">
          {upcoming.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-bold text-[var(--text-tertiary)] uppercase tracking-widest">Nenhum outro hotfix agendado</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-default)]">
              {upcoming.map(hotfix => {
                const overdue = isOverdue(hotfix);
                const responsible = resolveResponsible(hotfix);
                return (
                  <div key={hotfix.id} className="p-6 hover:bg-[var(--surface-card)]/50 transition-colors group">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-start gap-4 min-w-0">
                        <div className={cn(
                          "w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 transition-colors",
                          overdue
                            ? "bg-[var(--surface-danger)] border-[var(--text-danger)]/20 text-[var(--text-danger)]"
                            : "bg-[var(--surface-card)] border-[var(--border-default)] text-[var(--text-tertiary)] group-hover:text-[var(--accent-text)]"
                        )}>
                          <Rocket size={20} />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-base font-black text-[var(--text-primary)] tracking-tight uppercase leading-none mb-1.5 truncate">{hotfix.name}</h4>
                          <div className="flex flex-wrap gap-2">
                            {overdue ? (
                              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--surface-danger)] text-[var(--text-danger)] border border-[var(--text-danger)]/20 text-[9px] font-semibold uppercase tracking-widest">
                                <AlertTriangle size={11} /> Atrasado
                              </span>
                            ) : (
                              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--surface-card)] text-[var(--text-tertiary)] border border-[var(--border-default)] text-[9px] font-semibold uppercase tracking-widest">
                                <Clock size={11} /> Agendado
                              </span>
                            )}
                            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--accent)]/10 text-[var(--accent-text)] border border-[var(--accent)]/20 text-[9px] font-black uppercase tracking-widest">
                              📅 {formatDate(hotfix.expectedDate)}
                            </span>
                            {responsible && (
                              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--surface-card)] text-[var(--text-tertiary)] border border-[var(--border-default)] text-[9px] font-semibold uppercase tracking-widest">
                                {responsible.name}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleMarkPublished(hotfix)}
                          className="px-3.5 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest bg-[var(--surface-success)] text-[var(--text-success)] border border-[var(--text-success)]/20 hover:bg-[var(--text-success)] hover:text-white transition-all"
                        >
                          Publicado
                        </button>
                        <button onClick={() => handleOpenModal(hotfix)} className="p-2 rounded-xl border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all" title="Editar">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setDeletingHotfix(hotfix)} className="p-2 rounded-xl border border-[var(--border-default)] text-[var(--text-danger)] hover:bg-[var(--surface-danger)] transition-all" title="Excluir">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Histórico */}
      <div className="space-y-3">
        <h3 className="text-xs font-black uppercase tracking-widest text-[var(--text-tertiary)] flex items-center gap-2">
          <HistoryIcon size={15} className="text-[var(--accent-text)]" /> Histórico ({published.length})
        </h3>
        <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2.5rem] shadow-sm overflow-hidden">
          {published.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-bold text-[var(--text-tertiary)] uppercase tracking-widest">Nenhum hotfix publicado ainda</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-default)]">
              {published.map(hotfix => {
                const responsible = resolveResponsible(hotfix);
                return (
                  <div key={hotfix.id} className="p-6 hover:bg-[var(--surface-card)]/50 transition-colors group">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-start gap-4 min-w-0">
                        <div className="w-12 h-12 rounded-2xl border bg-[var(--surface-success)] border-[var(--text-success)]/20 text-[var(--text-success)] flex items-center justify-center shrink-0">
                          <CheckCircle2 size={20} />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-base font-black text-[var(--text-primary)] tracking-tight uppercase leading-none mb-1.5 truncate">{hotfix.name}</h4>
                          <div className="flex flex-wrap gap-2">
                            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--surface-success)] text-[var(--text-success)] border border-[var(--text-success)]/20 text-[9px] font-semibold uppercase tracking-widest">
                              <CheckCircle2 size={11} /> Publicado em {formatDateTime(hotfix.publishedAt!)}
                            </span>
                            {responsible && (
                              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--surface-card)] text-[var(--text-tertiary)] border border-[var(--border-default)] text-[9px] font-semibold uppercase tracking-widest">
                                {responsible.name}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => handleOpenModal(hotfix)} className="p-2 rounded-xl border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all" title="Editar">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setDeletingHotfix(hotfix)} className="p-2 rounded-xl border border-[var(--border-default)] text-[var(--text-danger)] hover:bg-[var(--surface-danger)] transition-all" title="Excluir">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[var(--surface-card)] w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-[var(--border-default)] flex items-center gap-4">
                <div className="w-12 h-12 bg-[var(--accent)] rounded-2xl flex items-center justify-center text-white shrink-0">
                  <Rocket size={22} />
                </div>
                <h3 className="text-xl font-black text-[var(--text-primary)] tracking-tight uppercase">
                  {selectedHotfix ? 'Editar Hotfix' : 'Novo Hotfix'}
                </h3>
              </div>

              <div className="p-8 space-y-5">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Nome do Hotfix</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-5 py-4 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                    placeholder="Ex: Correção do cálculo de SLA"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Responsável</label>
                    <StyledSelect
                      value={responsibleId}
                      onChange={(e) => setResponsibleId(e.target.value)}
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-5 py-4 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all appearance-none"
                    >
                      <option value="">Sem responsável</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </StyledSelect>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Data Prevista</label>
                    <input
                      type="date"
                      value={expectedDate}
                      onChange={(e) => setExpectedDate(e.target.value)}
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-5 py-4 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Descrição / Notas</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-5 py-4 text-sm font-medium focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all resize-none h-24"
                    placeholder="O que esse hotfix corrige ou entrega?"
                  />
                </div>
              </div>

              <div className="p-8 pt-0 flex gap-3">
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="px-8 py-4 rounded-2xl text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={!name || !expectedDate}
                  className="flex-1 px-8 py-4 bg-[var(--accent)] text-white rounded-2xl text-[10px] font-semibold uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all shadow-xl shadow-indigo-100 disabled:opacity-50"
                >
                  Salvar Hotfix
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        isOpen={!!deletingHotfix}
        onClose={() => setDeletingHotfix(null)}
        onConfirm={async () => {
          if (deletingHotfix) {
            const res = await deleteHotfix(deletingHotfix.id);
            if (res && (res as any).error) {
              alert((res as any).error);
              return;
            }
            setDeletingHotfix(null);
            loadData();
          }
        }}
        title="Excluir Hotfix"
        description={`Tem certeza que deseja remover o hotfix "${deletingHotfix?.name}"?`}
        confirmLabel="Excluir"
        variant="danger"
      />
    </div>
  );
}
