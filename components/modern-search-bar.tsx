"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { StyledSelect } from '@/components/styled-select';
import { Search, X, Filter, ChevronDown, Star, Clock, Tag, Users, Building2, Calendar, Save, Bookmark, Trash2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { TicketStatus, SavedFilter, UserRole } from "@/lib/types";
import { useApp } from "@/app/app-context";
import { supabase } from "@/lib/supabase";
import { searchTickets, SearchFilters, getSavedViews, saveCustomView, saveSearchHistory } from "@/lib/search";

interface ModernSearchBarProps {
  onSearch: (filters: SearchFilters, page: number) => void;
  loading?: boolean;
}

export function ModernSearchBar({ onSearch, loading }: ModernSearchBarProps) {
  const { currentUser } = useApp();
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeFilters, setActiveFilters] = useState<SearchFilters>({});
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedFilter[]>([]);
  const [showSaveView, setShowSaveView] = useState(false);
  const [newViewName, setNewViewName] = useState("");

  // Local filter states
  const [status, setStatus] = useState<TicketStatus | "">("");
  const [priority, setPriority] = useState<string>("");
  const [company, setCompany] = useState<string>("");
  const [assignee, setAssignee] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [slaOverdue, setSlaOverdue] = useState(false);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [companies, setCompanies] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const lastSubmittedFiltersRef = useRef(JSON.stringify({}));

  // Load companies and users for filter dropdowns
  useEffect(() => {
    supabase.from('companies').select('id, name').then(({ data }) => setCompanies(data || []));
    supabase.from('profiles').select('id, name').then(({ data }) => setUsers(data || []));
  }, []);

  // Consolidate search and filter changes into a single request.
  useEffect(() => {
    const newFilters: SearchFilters = {
      query: query || undefined,
      status: status || undefined,
      priority: priority || undefined,
      companyId: company || undefined,
      assigneeId: assignee || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      slaOverdue: slaOverdue || undefined,
      includeClosed: includeClosed || undefined,
    };
    const serializedFilters = JSON.stringify(newFilters);
    if (serializedFilters === lastSubmittedFiltersRef.current) return;
    lastSubmittedFiltersRef.current = serializedFilters;

    const handler = setTimeout(() => {
      setActiveFilters(newFilters);
      onSearch(newFilters, 1);

      // Save to history if user is logged in and query exists
      if (currentUser?.id && query.trim()) {
        saveSearchHistory(currentUser.id, query.trim()).catch(err => {
          console.warn('Search history not available (run schema migration):', err);
        });
      }
    }, 300);

    return () => clearTimeout(handler);
  }, [query, status, priority, company, assignee, startDate, endDate, slaOverdue, includeClosed]);

// Load saved views on mount
  useEffect(() => {
    if (currentUser?.id) {
      getSavedViews(currentUser.id).then(setSavedViews).catch(err => {
        console.warn('Saved views not available (run schema migration):', err);
      });
    }
  }, [currentUser?.id]);

  const hasActiveFilters = Object.values(activeFilters).some(v => v !== undefined && v !== "");

  const removeFilter = (key: keyof SearchFilters) => {
    const newFilters = { ...activeFilters };
    delete newFilters[key];
    setActiveFilters(newFilters);

    // Reset local state
    switch (key) {
      case "status": setStatus(""); break;
      case "priority": setPriority(""); break;
      case "companyId": setCompany(""); break;
      case "assigneeId": setAssignee(""); break;
      case "startDate": setStartDate(""); break;
      case "endDate": setEndDate(""); break;
      case "slaOverdue": setSlaOverdue(false); break;
      case "includeClosed": setIncludeClosed(false); break;
    }
  };

  const clearAllFilters = () => {
    setQuery("");
    setStatus("");
    setPriority("");
    setCompany("");
    setAssignee("");
    setStartDate("");
    setEndDate("");
    setSlaOverdue(false);
    setIncludeClosed(false);
    setActiveFilters({});
  };

  const saveCurrentView = async () => {
    if (!currentUser?.id || !newViewName.trim()) return;

    const view: SavedFilter = {
      id: Math.random().toString(36).substr(2, 9),
      name: newViewName,
      filters: activeFilters,
    };

    try {
      await saveCustomView(currentUser.id, newViewName, activeFilters);
      setSavedViews([...savedViews, view]);
    } catch (err) {
      console.warn('Save custom view not available (run schema migration):', err);
    }
    setNewViewName("");
    setShowSaveView(false);
  };

  const loadView = (filters: SearchFilters) => {
    setQuery(filters.query || "");
    setStatus(filters.status || "");
    setPriority(filters.priority || "");
    setCompany(filters.companyId || "");
    setAssignee(filters.assigneeId || "");
    setStartDate(filters.startDate || "");
    setEndDate(filters.endDate || "");
    setSlaOverdue(filters.slaOverdue || false);
    setIncludeClosed(filters.includeClosed || false);
    setActiveFilters(filters);
    setShowFilterPanel(false);
  };

  return (
    <div className="space-y-4">
      {/* Main Search Bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-2xl">
          <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Buscar chamados, clientes, IDs, descrições..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            className="w-full pl-12 pr-12 py-3.5 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] text-sm font-medium focus:ring-4 focus:ring-[var(--accent)]/10 focus:border-[var(--accent)] outline-none transition-all shadow-sm"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            >
              <X size={16} />
            </button>
          )}

          {/* Suggestions Dropdown */}
          <AnimatePresence>
            {showSuggestions && suggestions.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute top-full left-0 right-0 mt-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl shadow-lg p-2 z-50"
              >
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setQuery(s);
                      setShowSuggestions(false);
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-card)] rounded-lg"
                  >
                    {s}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button
          onClick={() => setShowFilterPanel(!showFilterPanel)}
          className={cn(
            "flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-semibold uppercase tracking-widest transition-all border shadow-sm",
            showFilterPanel || hasActiveFilters
              ? "bg-[var(--accent)] text-white border-[var(--accent)]"
              : "bg-[var(--surface-card)] text-[var(--text-secondary)] border-[var(--border-default)] hover:border-indigo-300"
          )}
        >
          <Filter size={18} />
          Filtros {hasActiveFilters && <span className="w-5 h-5 bg-[var(--surface-card)] text-[var(--accent-text)] rounded-full text-[10px] font-bold flex items-center justify-center">{Object.keys(activeFilters).filter(k => activeFilters[k as keyof SearchFilters] !== undefined && activeFilters[k as keyof SearchFilters] !== "").length}</span>}
        </button>

        {hasActiveFilters && (
          <button
            onClick={clearAllFilters}
            className="px-4 py-3 rounded-2xl text-sm font-semibold uppercase tracking-widest text-[var(--text-tertiary)] border border-[var(--border-default)] hover:bg-[var(--surface-card)] transition-all"
          >
            Limpar
          </button>
        )}

        {/* Saved Views */}
        <div className="relative">
          <button
            onClick={() => setShowSaveView(!showSaveView)}
            className="p-3 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:border-[var(--accent)]/30 transition-all"
            title="Visualizações salvas"
          >
            <Bookmark size={20} />
          </button>

          <AnimatePresence>
            {showSaveView && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute top-full right-0 mt-2 w-72 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl shadow-lg p-4 z-50"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold uppercase text-[var(--text-tertiary)]">Visualizações</span>
                  {savedViews.length > 0 && (
                    <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">{savedViews.length} salvas</span>
                  )}
                </div>
                {savedViews.length === 0 ? (
                  <p className="text-xs text-[var(--text-tertiary)] italic mb-3">Nenhuma visualização salva</p>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto mb-3">
                    {savedViews.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => loadView(v.filters)}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--surface-card)] text-xs font-bold flex items-center justify-between group"
                      >
                        <span>{v.name}</span>
                        <span className="text-[var(--accent-text)] opacity-0 group-hover:opacity-100 transition-opacity">Aplicar</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="border-t border-[var(--border-default)] pt-3">
                  <input
                    type="text"
                    placeholder="Nome da visualização..."
                    value={newViewName}
                    onChange={(e) => setNewViewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveCurrentView()}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] text-xs font-bold outline-none focus:border-indigo-400"
                  />
                  <button
                    onClick={saveCurrentView}
                    disabled={!newViewName.trim()}
                    className="w-full mt-2 py-2 rounded-lg bg-[var(--accent)] text-white text-xs font-semibold uppercase disabled:opacity-50"
                  >
                    Salvar como visualização
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Filter Chips */}
      <AnimatePresence>
        {hasActiveFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-wrap gap-2 items-center"
          >
            {activeFilters.status && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--accent)]/10 text-[var(--accent-text)] rounded-full text-xs font-bold">
                Status: {activeFilters.status}
                <button onClick={() => removeFilter("status")}><X size={12} /></button>
              </span>
            )}
            {activeFilters.priority && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--surface-warning)] text-[var(--text-warning)] rounded-full text-xs font-bold">
                Prioridade: {activeFilters.priority}
                <button onClick={() => removeFilter("priority")}><X size={12} /></button>
              </span>
            )}
            {activeFilters.slaOverdue && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--surface-danger)] text-[var(--text-danger)] rounded-full text-xs font-bold">
                SLA Vencido
                <button onClick={() => removeFilter("slaOverdue")}><X size={12} /></button>
              </span>
            )}
            {activeFilters.companyId && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--surface-success)] text-[var(--text-success)] rounded-full text-xs font-bold">
                Cliente: {companies.find(c => c.id === activeFilters.companyId)?.name || activeFilters.companyId}
                <button onClick={() => removeFilter("companyId")}><X size={12} /></button>
              </span>
            )}
            {activeFilters.assigneeId && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 rounded-full text-xs font-bold">
                Responsável: {users.find(u => u.id === activeFilters.assigneeId)?.name || activeFilters.assigneeId}
                <button onClick={() => removeFilter("assigneeId")}><X size={12} /></button>
              </span>
            )}
            {activeFilters.startDate && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--surface-info)] text-[var(--text-info)] rounded-full text-xs font-bold">
                De: {new Date(activeFilters.startDate!).toLocaleDateString()}
                <button onClick={() => removeFilter("startDate")}><X size={12} /></button>
              </span>
            )}
            {activeFilters.endDate && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--surface-info)] text-[var(--text-info)] rounded-full text-xs font-bold">
                Até: {new Date(activeFilters.endDate!).toLocaleDateString()}
                <button onClick={() => removeFilter("endDate")}><X size={12} /></button>
              </span>
            )}
            {activeFilters.includeClosed && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--surface-success)] text-[var(--text-success)] rounded-full text-xs font-bold">
                Mostrando encerrados
                <button onClick={() => removeFilter("includeClosed")}><X size={12} /></button>
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Advanced Filter Panel */}
      <AnimatePresence>
        {showFilterPanel && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-3xl p-6 shadow-lg">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Status */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] flex items-center gap-1">
                    <Tag size={12} /> Status
                  </label>
                  <StyledSelect
                    value={status}
                    onChange={(e) => setStatus(e.target.value as TicketStatus)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] text-xs font-bold bg-[var(--surface-card)] focus:border-indigo-400 outline-none"
                  >
                    <option value="">Qualquer Status</option>
                    {Object.values(TicketStatus).map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </StyledSelect>
                </div>

                {/* Priority */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] flex items-center gap-1">
                    <Star size={12} /> Prioridade
                  </label>
                  <StyledSelect
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] text-xs font-bold bg-[var(--surface-card)] focus:border-indigo-400 outline-none"
                  >
                    <option value="">Qualquer Prioridade</option>
                    <option>Baixa</option>
                    <option>Média</option>
                    <option>Alta</option>
                    <option>Urgente</option>
                  </StyledSelect>
                </div>

                {/* Company (Cliente) */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] flex items-center gap-1">
                    <Building2 size={12} /> Cliente
                  </label>
                  <StyledSelect
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] text-xs font-bold bg-[var(--surface-card)] focus:border-indigo-400 outline-none"
                  >
                    <option value="">Qualquer Cliente</option>
                    {companies.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </StyledSelect>
                </div>

                {/* Assignee (Responsável) */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] flex items-center gap-1">
                    <Users size={12} /> Responsável
                  </label>
                  <StyledSelect
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] text-xs font-bold bg-[var(--surface-card)] focus:border-indigo-400 outline-none"
                  >
                    <option value="">Qualquer Responsável</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </StyledSelect>
                </div>

                {/* Date Range */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] flex items-center gap-1">
                    <Calendar size={12} /> Criado De
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] text-xs font-bold bg-[var(--surface-card)] focus:border-indigo-400 outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] flex items-center gap-1">
                    <Calendar size={12} /> Criado Até
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] text-xs font-bold bg-[var(--surface-card)] focus:border-indigo-400 outline-none"
                  />
                </div>

                {/* SLA Overdue */}
                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    id="slaOverdue"
                    checked={slaOverdue}
                    onChange={(e) => setSlaOverdue(e.target.checked)}
                    className="w-4 h-4 rounded border-[var(--border-default)]"
                  />
                  <label htmlFor="slaOverdue" className="text-xs font-bold text-[var(--text-secondary)] flex items-center gap-1">
                    <Clock size={12} /> SLA Vencido
                  </label>
                </div>

                {/* Include Closed Tickets */}
                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    id="includeClosed"
                    checked={includeClosed}
                    onChange={(e) => setIncludeClosed(e.target.checked)}
                    className="w-4 h-4 rounded border-[var(--border-default)]"
                  />
                  <label htmlFor="includeClosed" className="text-xs font-bold text-[var(--text-secondary)] flex items-center gap-1">
                    <Check size={12} /> Mostrar chamados encerrados
                  </label>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
