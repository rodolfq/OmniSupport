"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { Search, X, Filter, ChevronDown, Star, Clock, Tag, Users, Building2, Calendar, Save, Bookmark, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { TicketStatus, SavedFilter, UserRole } from "@/lib/types";
import { useApp } from "@/app/app-context";
import { searchTickets, SearchFilters, getSavedViews, saveCustomView, saveSearchHistory } from "@/lib/search";

interface ModernSearchBarProps {
  onSearch: (filters: SearchFilters, page: number) => void;
  onFilterChange: (filters: SearchFilters) => void;
  loading?: boolean;
}

export function ModernSearchBar({ onSearch, onFilterChange, loading }: ModernSearchBarProps) {
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

  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce search
  useEffect(() => {
    const handler = setTimeout(() => {
      const newFilters: SearchFilters = {
        ...activeFilters,
        query: query || undefined,
      };
      onFilterChange(newFilters);
      onSearch(newFilters, 1);

      // Save to history if user is logged in and query exists
      if (currentUser?.id && query.trim()) {
        saveSearchHistory(currentUser.id, query.trim()).catch(err => {
          console.warn('Search history not available (run schema migration):', err);
        });
      }
    }, 300);

    return () => clearTimeout(handler);
  }, [query, activeFilters]);

// Load saved views on mount
  useEffect(() => {
    if (currentUser?.id) {
      getSavedViews(currentUser.id).then(setSavedViews).catch(err => {
        console.warn('Saved views not available (run schema migration):', err);
      });
    }
  }, [currentUser?.id]);

  // Update active filters when local states change
  useEffect(() => {
    const newFilters: SearchFilters = {
      ...activeFilters,
      status: status || undefined,
      priority: priority || undefined,
      companyId: company || undefined,
      assigneeId: assignee || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      slaOverdue: slaOverdue || undefined,
    };
    setActiveFilters(newFilters);
    onFilterChange(newFilters);
    onSearch(newFilters, 1);
  }, [status, priority, company, assignee, startDate, endDate, slaOverdue]);

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
    setActiveFilters({});
    onFilterChange({});
    onSearch({}, 1);
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
    setActiveFilters(filters);
    onFilterChange(filters);
    onSearch(filters, 1);
    setShowFilterPanel(false);
  };

  return (
    <div className="space-y-4">
      {/* Main Search Bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-2xl">
          <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Buscar chamados, clientes, IDs, descrições..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            className="w-full pl-12 pr-12 py-3.5 rounded-2xl border border-slate-200 bg-white text-sm font-medium focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all shadow-sm"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
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
                className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg p-2 z-50"
              >
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setQuery(s);
                      setShowSuggestions(false);
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 rounded-lg"
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
            "flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-black uppercase tracking-widest transition-all border shadow-sm",
            showFilterPanel || hasActiveFilters
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-white text-slate-700 border-slate-200 hover:border-indigo-300"
          )}
        >
          <Filter size={18} />
          Filtros {hasActiveFilters && <span className="w-5 h-5 bg-white text-indigo-600 rounded-full text-[10px] font-bold flex items-center justify-center">{Object.keys(activeFilters).filter(k => activeFilters[k as keyof SearchFilters] !== undefined && activeFilters[k as keyof SearchFilters] !== "").length}</span>}
        </button>

        {hasActiveFilters && (
          <button
            onClick={clearAllFilters}
            className="px-4 py-3 rounded-2xl text-sm font-black uppercase tracking-widest text-slate-500 border border-slate-200 hover:bg-slate-50 transition-all"
          >
            Limpar
          </button>
        )}

        {/* Saved Views */}
        <div className="relative">
          <button
            onClick={() => setShowSaveView(!showSaveView)}
            className="p-3 rounded-2xl border border-slate-200 bg-white text-slate-500 hover:text-indigo-600 hover:border-indigo-200 transition-all"
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
                className="absolute top-full right-0 mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-lg p-4 z-50"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-black uppercase text-slate-400">Visualizações</span>
                  {savedViews.length > 0 && (
                    <span className="text-[10px] font-bold text-slate-500">{savedViews.length} salvas</span>
                  )}
                </div>
                {savedViews.length === 0 ? (
                  <p className="text-xs text-slate-400 italic mb-3">Nenhuma visualização salva</p>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto mb-3">
                    {savedViews.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => loadView(v.filters)}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 text-xs font-bold flex items-center justify-between group"
                      >
                        <span>{v.name}</span>
                        <span className="text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity">Aplicar</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="border-t border-slate-100 pt-3">
                  <input
                    type="text"
                    placeholder="Nome da visualização..."
                    value={newViewName}
                    onChange={(e) => setNewViewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveCurrentView()}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold outline-none focus:border-indigo-400"
                  />
                  <button
                    onClick={saveCurrentView}
                    disabled={!newViewName.trim()}
                    className="w-full mt-2 py-2 rounded-lg bg-indigo-600 text-white text-xs font-black uppercase disabled:opacity-50"
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
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-full text-xs font-bold">
                Status: {activeFilters.status}
                <button onClick={() => removeFilter("status")}><X size={12} /></button>
              </span>
            )}
            {activeFilters.priority && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-full text-xs font-bold">
                Prioridade: {activeFilters.priority}
                <button onClick={() => removeFilter("priority")}><X size={12} /></button>
              </span>
            )}
            {activeFilters.slaOverdue && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 rounded-full text-xs font-bold">
                SLA Vencido
                <button onClick={() => removeFilter("slaOverdue")}><X size={12} /></button>
              </span>
            )}
            {activeFilters.companyId && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold">
                Empresa
                <button onClick={() => removeFilter("companyId")}><X size={12} /></button>
              </span>
            )}
            {activeFilters.assigneeId && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 text-purple-700 rounded-full text-xs font-bold">
                Responsável
                <button onClick={() => removeFilter("assigneeId")}><X size={12} /></button>
              </span>
            )}
            {activeFilters.startDate && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-xs font-bold">
                De: {new Date(activeFilters.startDate!).toLocaleDateString()}
                <button onClick={() => removeFilter("startDate")}><X size={12} /></button>
              </span>
            )}
            {activeFilters.endDate && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-xs font-bold">
                Até: {new Date(activeFilters.endDate!).toLocaleDateString()}
                <button onClick={() => removeFilter("endDate")}><X size={12} /></button>
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
            <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-lg">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Status */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
                    <Tag size={12} /> Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as TicketStatus)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold bg-slate-50 focus:border-indigo-400 outline-none"
                  >
                    <option value="">Qualquer Status</option>
                    {Object.values(TicketStatus).map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                {/* Priority */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
                    <Star size={12} /> Prioridade
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold bg-slate-50 focus:border-indigo-400 outline-none"
                  >
                    <option value="">Qualquer Prioridade</option>
                    <option>Baixa</option>
                    <option>Média</option>
                    <option>Alta</option>
                    <option>Urgente</option>
                  </select>
                </div>

                {/* Date Range */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
                    <Calendar size={12} /> Criado De
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold bg-slate-50 focus:border-indigo-400 outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
                    <Calendar size={12} /> Criado Até
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold bg-slate-50 focus:border-indigo-400 outline-none"
                  />
                </div>

                {/* SLA Overdue */}
                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    id="slaOverdue"
                    checked={slaOverdue}
                    onChange={(e) => setSlaOverdue(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300"
                  />
                  <label htmlFor="slaOverdue" className="text-xs font-bold text-slate-600 flex items-center gap-1">
                    <Clock size={12} /> SLA Vencido
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