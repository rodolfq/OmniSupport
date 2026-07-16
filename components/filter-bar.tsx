'use client';

import React, { useState, useEffect } from 'react';
import { StyledSelect } from '@/components/styled-select';
import { Search, Filter, X, ChevronDown, Save, Bookmark, Trash2 } from 'lucide-react';
import { TicketStatus, User, Company, SavedFilter, UserRole } from '@/lib/types';
import { cn, normalizeString } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '@/app/app-context';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface FilterBarProps {
  onFilterChange: (filteredTickets: any[]) => void;
  originalTickets: any[];
}

export function FilterBar({ onFilterChange, originalTickets }: FilterBarProps) {
  const { currentUser } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [compStartDate, setCompStartDate] = useState('');
  const [compEndDate, setCompEndDate] = useState('');
  const [contentSearch, setContentSearch] = useState('');
  const [ticketId, setTicketId] = useState('');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [analysts, setAnalysts] = useState<User[]>([]);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [newFilterName, setNewFilterName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function fetchData() {
      const { data: compList } = await supabase.from('companies').select('*');
      const { data: profiles } = await supabase.from('profiles').select('*');
      
      if (compList) setCompanies(compList);
      if (profiles) setAnalysts(profiles.filter(u => u.role === 'Equipe' || u.is_admin) as any);
    }
    fetchData();
  }, []);

  useEffect(() => {
    async function fetchSavedFilters() {
      if (!currentUser?.id) return;
      const { data: savedViews } = await supabase
        .from('saved_views')
        .select('id, name, filters')
        .eq('user_id', currentUser.id);
      
      if (savedViews) {
        setSavedFilters(savedViews.map(sv => ({
          id: sv.id,
          name: sv.name,
          filters: sv.filters as any
        })));
      }
    }
    fetchSavedFilters();
  }, [currentUser?.id]);

  useEffect(() => {
    applyFilters();
  }, [search, status, priority, companyId, assigneeId, startDate, endDate, compStartDate, compEndDate, contentSearch, ticketId, originalTickets]);

  const applyFilters = () => {
    let filtered = [...originalTickets];

    if (search) {
      const normalSearch = normalizeString(search);
      filtered = filtered.filter(t => normalizeString(t.title).includes(normalSearch));
    }

    if (ticketId) {
      const normalTicketId = normalizeString(ticketId);
      filtered = filtered.filter(t => normalizeString(t.id).includes(normalTicketId));
    }

    if (status) {
      filtered = filtered.filter(t => t.status === status);
    }

    if (priority) {
      filtered = filtered.filter(t => t.priority === priority);
    }

    if (companyId) {
      filtered = filtered.filter(t => t.companyId === companyId);
    }

    if (assigneeId) {
      filtered = filtered.filter(t => t.assigneeId === assigneeId);
    }

    if (startDate) {
      filtered = filtered.filter(t => new Date(t.createdAt) >= new Date(startDate));
    }

    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filtered = filtered.filter(t => new Date(t.createdAt) <= end);
    }

    if (compStartDate) {
      filtered = filtered.filter(t => t.completedAt && new Date(t.completedAt) >= new Date(compStartDate));
    }

    if (compEndDate) {
      const end = new Date(compEndDate);
      end.setHours(23, 59, 59, 999);
      filtered = filtered.filter(t => t.completedAt && new Date(t.completedAt) <= end);
    }

    if (contentSearch) {
      const normalContentSearch = normalizeString(contentSearch);
      filtered = filtered.filter(t => normalizeString(t.description).includes(normalContentSearch));
    }

    onFilterChange(filtered);
  };

  const handleSaveFilter = async () => {
    if (!newFilterName) return;
    if (!currentUser?.id) {
      toast.error("Você precisa estar logado para salvar buscas.");
      return;
    }
    
    const filterData = { search, status, priority, companyId, assigneeId, startDate, endDate, contentSearch, ticketId };
    
    const { data, error } = await supabase
      .from('saved_views')
      .insert({
        user_id: currentUser.id,
        name: newFilterName,
        filters: filterData
      })
      .select('id, name, filters')
      .single();

    if (error) {
      console.error("Error saving view:", error);
      toast.error("Erro ao salvar busca.");
      return;
    }

    if (data) {
      setSavedFilters(prev => [...prev, {
        id: data.id,
        name: data.name,
        filters: data.filters as any
      }]);
      toast.success("Busca salva com sucesso!");
    }
    setNewFilterName('');
    setIsSaving(false);
  };

  const loadSavedFilter = (f: SavedFilter) => {
    const { filters } = f;
    setSearch(filters.search || '');
    setStatus(filters.status || '');
    setPriority(filters.priority || '');
    setCompanyId(filters.companyId || '');
    setAssigneeId(filters.assigneeId || '');
    setStartDate(filters.startDate || '');
    setEndDate(filters.endDate || '');
    setCompStartDate(filters.compStartDate || '');
    setCompEndDate(filters.compEndDate || '');
    setContentSearch(filters.contentSearch || '');
    setTicketId(filters.ticketId || '');
  };

  const clearFilters = () => {
    setSearch('');
    setStatus('');
    setPriority('');
    setCompanyId('');
    setAssigneeId('');
    setStartDate('');
    setEndDate('');
    setCompStartDate('');
    setCompEndDate('');
    setContentSearch('');
    setTicketId('');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div className="flex-1 w-full max-w-2xl relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[var(--text-tertiary)]" size={18} />
          <input 
            type="text" 
            placeholder="Pesquisar por assunto..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-2xl pl-12 pr-4 py-3 text-sm focus:ring-4 focus:ring-indigo-500/10 dark:focus:ring-[var(--accent)]/10 focus:border-indigo-500 dark:focus:border-[var(--accent)] outline-none transition-all shadow-sm font-medium"
          />
        </div>
        
        <div className="flex items-center gap-3 w-full md:w-auto">
          <button 
            onClick={() => setIsOpen(!isOpen)}
            className={cn(
              "flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-sm font-black uppercase tracking-widest transition-all border shadow-sm",
              isOpen ? "bg-indigo-600 dark:bg-[var(--accent)] text-white border-indigo-600 dark:border-[var(--accent)]" : "bg-white dark:bg-[var(--surface-card)] text-slate-700 dark:text-[var(--text-secondary)] border-slate-200 dark:border-[var(--border-default)] hover:border-indigo-300"
            )}
          >
            <Filter size={18} /> Filtros {isOpen ? <X size={16} /> : <ChevronDown size={16} />}
          </button>
          
          <div className="relative group">
            <button 
              className="p-3 bg-white dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-2xl text-slate-500 dark:text-[var(--text-tertiary)] hover:text-indigo-600 dark:hover:text-[var(--accent-text)] hover:border-indigo-200 dark:hover:border-[var(--accent)]/30 transition-all shadow-sm"
              title="Filtros Salvos"
            >
              <Bookmark size={20} />
            </button>
            <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-2xl shadow-xl p-4 hidden group-hover:block z-[100]">
               <p className="text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest mb-3">Buscas Salvas</p>
               <div className="space-y-1 max-h-48 overflow-y-auto">
                  {savedFilters.length === 0 && <p className="text-[10px] text-slate-400 dark:text-[var(--text-tertiary)] italic">Nenhuma busca salva</p>}
                  {savedFilters.map(f => (
                    <button 
                      key={f.id} 
                      onClick={() => loadSavedFilter(f)}
                      className="w-full text-left p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] text-xs font-bold text-slate-700 dark:text-[var(--text-secondary)] flex items-center justify-between group/item"
                    >
                      {f.name}
                      <span className="text-indigo-600 dark:text-[var(--accent-text)] text-[8px] opacity-0 group-hover/item:opacity-100 uppercase">Carregar</span>
                    </button>
                  ))}
               </div>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden bg-white dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-3xl shadow-xl shadow-slate-200/50"
          >
            <div className="p-8 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest ml-1">ID do Ticket</label>
                  <input 
                    type="text" 
                    value={ticketId}
                    onChange={(e) => setTicketId(e.target.value)}
                    placeholder="T-1001"
                    className="w-full bg-slate-50 dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-[var(--accent)]/20 outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest ml-1">Status</label>
                  <StyledSelect 
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-[var(--accent)]/20 outline-none appearance-none"
                  >
                    <option value="">Qualquer Status</option>
                    {Object.values(TicketStatus).map(s => <option key={s} value={s}>{s}</option>)}
                  </StyledSelect>
                </div>

                {currentUser?.role !== UserRole.CUSTOMER && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest ml-1">Cliente / Empresa</label>
                      <StyledSelect 
                        value={companyId}
                        onChange={(e) => setCompanyId(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-[var(--accent)]/20 outline-none appearance-none"
                      >
                        <option value="">Qualquer Empresa</option>
                        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </StyledSelect>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest ml-1">Analista Responsável</label>
                      <StyledSelect 
                        value={assigneeId}
                        onChange={(e) => setAssigneeId(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-[var(--accent)]/20 outline-none appearance-none"
                      >
                        <option value="">Qualquer Analista</option>
                        {analysts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </StyledSelect>
                    </div>
                  </>
                )}

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest ml-1">Criado (Início)</label>
                  <input 
                    type="date" 
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-[var(--accent)]/20 outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest ml-1">Criado (Fim)</label>
                  <input 
                    type="date" 
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-[var(--accent)]/20 outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest ml-1">Finalizado (Início)</label>
                  <input 
                    type="date" 
                    value={compStartDate}
                    onChange={(e) => setCompStartDate(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-[var(--accent)]/20 outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest ml-1">Finalizado (Fim)</label>
                  <input 
                    type="date" 
                    value={compEndDate}
                    onChange={(e) => setCompEndDate(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-[var(--accent)]/20 outline-none"
                  />
                </div>

                <div className="col-span-1 md:col-span-2 space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest ml-1">Trecho da Descrição</label>
                  <input 
                    type="text" 
                    value={contentSearch}
                    onChange={(e) => setContentSearch(e.target.value)}
                    placeholder="Procure palavras-chave dentro dos chamados..."
                    className="w-full bg-slate-50 dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-[var(--accent)]/20 outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-col md:flex-row items-center justify-between pt-6 border-t border-slate-100 dark:border-[var(--border-default)] gap-4">
                <div className="flex items-center gap-4 w-full md:w-auto">
                   {isSaving ? (
                     <div className="flex items-center gap-2">
                        <input 
                          type="text" 
                          placeholder="Nome do filtro..." 
                          value={newFilterName}
                          onChange={(e) => setNewFilterName(e.target.value)}
                          className="bg-slate-50 dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-lg px-3 py-2 text-xs font-bold outline-none"
                        />
                        <button onClick={handleSaveFilter} className="bg-indigo-600 dark:bg-[var(--accent)] text-white p-2 rounded-lg hover:bg-indigo-700 dark:hover:bg-[var(--accent-hover)] transition-all"><Save size={16} /></button>
                        <button onClick={() => setIsSaving(false)} className="text-slate-400 dark:text-[var(--text-tertiary)] hover:text-slate-600 dark:hover:text-[var(--text-secondary)]"><X size={16} /></button>
                     </div>
                   ) : (
                     <button 
                       onClick={() => setIsSaving(true)}
                       className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest hover:text-indigo-600 dark:hover:text-[var(--accent-text)] transition-colors"
                     >
                        <Save size={14} /> Salvar como nova busca
                     </button>
                   )}
                </div>

                <div className="flex gap-3 w-full md:w-auto">
                   <button 
                    onClick={clearFilters}
                    className="flex-1 md:flex-none px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-[var(--text-tertiary)] hover:bg-slate-100 dark:hover:bg-[var(--surface-pill)] transition-all"
                   >
                     Limpar Todos
                   </button>
                   <button 
                    onClick={() => setIsOpen(false)}
                    className="flex-1 md:flex-none px-8 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg"
                   >
                     Aplicar Filtros
                   </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


