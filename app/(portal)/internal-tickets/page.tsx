"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { useApp } from "@/app/app-context";
import { InternalTicket, Permission } from "@/lib/types";
import { InternalTicketService } from "@/lib/services/ticket-service";
import { Plus, Search, Lock, Loader2 } from "lucide-react";

interface InternalTicketItem extends InternalTicket {
  linkedTicketTitles?: string[];
}

const ITEMS_PER_PAGE = 20;

export default function InternalTicketsPage() {
  const { currentUser, hasPermission, refreshTrigger } = useApp();
  const [internalTickets, setInternalTickets] = useState<InternalTicketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [showNewModal, setShowNewModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Form state for new internal ticket
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newTeam, setNewTeam] = useState("Desenvolvimento");
  const [newPriority, setNewPriority] = useState(1);

  const isInitialMount = useRef(true);

  const fetchInternalTickets = useCallback(async (page = 1, searchTerm = "", isLoadMore = false) => {
    if (!currentUser) return;
    if (isLoadMore) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    try {
      const from = (page - 1) * ITEMS_PER_PAGE;
      const to = from + ITEMS_PER_PAGE - 1;

      let query = supabase
        .from("internal_tickets")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);

      if (searchTerm) {
        query = query.ilike("title", `%${searchTerm}%`);
      }

      const { data: internalData, error: internalError, count } = await query;

      if (internalError) throw internalError;

      const total = count || 0;
      setTotalPages(Math.ceil(total / ITEMS_PER_PAGE));

      const { data: links } = await supabase
        .from("ticket_internal_links")
        .select("ticket_id, internal_ticket_id");

      const { data: tickets } = await supabase.from("tickets").select("id, title");
      const ticketMap = new Map((tickets || []).map((t: any) => [t.id, t.title]));

      const items = (internalData || []).map((it: any) => {
        const linkedIds = (links || [])
          .filter((l: any) => l.internal_ticket_id === it.id)
          .map((l: any) => l.ticket_id);
        return {
          ...it,
          internalTicketNumber: it.internal_ticket_number,
          parentTicketIds: linkedIds,
          linkedTicketTitles: linkedIds.map((id: string) => ticketMap.get(id) || "Ticket removido").filter(Boolean),
        };
      });

      setInternalTickets(items);
    } catch (error) {
      console.error("Error loading internal tickets:", error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [currentUser]);

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      setCurrentPage(1);
      fetchInternalTickets(1, search);
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [search, fetchInternalTickets]);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      fetchInternalTickets(1, "");
    }
  }, [fetchInternalTickets]);

  useEffect(() => {
    if (!isInitialMount.current && currentPage > 1) {
      fetchInternalTickets(currentPage, search, true);
    }
  }, [currentPage]);

  useEffect(() => {
    if (refreshTrigger > 0 && !isInitialMount.current) {
      setCurrentPage(1);
      setSearch("");
      fetchInternalTickets(1, "");
    }
  }, [refreshTrigger]);

  const handleLoadMore = () => {
    if (currentPage < totalPages) {
      setCurrentPage(prev => prev + 1);
    }
  };

  const handleCreateInternalTicket = async () => {
    if (!currentUser || !newTitle) return;

    try {
      await InternalTicketService.save({
        title: newTitle,
        description: newDescription || '',
        teamId: newTeam,
        priority: newPriority,
        creatorId: currentUser.id,
        tags: [],
      });

      setNewTitle("");
      setNewDescription("");
      setShowNewModal(false);
      fetchInternalTickets(1, "");
    } catch (error) {
      console.error("Error creating internal ticket:", error);
    }
  };

  if (!hasPermission(Permission.INTERNAL_TICKETS_VIEW)) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8 bg-white rounded-2xl shadow-lg">
          <Lock size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-xl font-bold text-slate-700 mb-2">Acesso Negado</h2>
          <p className="text-slate-500">Você não tem permissão para visualizar tickets internos.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-50/30">
      {/* Header */}
      <div className="p-6 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-black text-slate-800">Tickets Internos</h1>
            <p className="text-sm text-slate-500 mt-1">Gerencie tickets internos de desenvolvimento e manutenção</p>
          </div>
          {hasPermission(Permission.INTERNAL_TICKETS_EDIT) && (
            <button
              onClick={() => setShowNewModal(true)}
              className="px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-amber-600 transition-all flex items-center gap-2"
            >
              <Plus size={16} />
              Novo Ticket Interno
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar tickets internos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:border-amber-400 outline-none text-sm font-medium"
          />
        </div>
      </div>

      {/* Tickets List */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
          </div>
        ) : internalTickets.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-slate-200">
            <Lock size={48} className="mx-auto text-slate-300 mb-4" />
            <h3 className="text-lg font-bold text-slate-700 mb-2">Nenhum ticket interno encontrado</h3>
            <p className="text-slate-500 text-sm">Crie um novo ticket interno ou aguarde atribuição.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {internalTickets.map((it) => (
              <motion.div
                key={it.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl border border-slate-200 p-5 hover:border-amber-300 transition-all cursor-pointer"
              >
<div className="flex items-start justify-between">
                   <div className="flex-1">
                     <div className="flex items-baseline gap-2">
                       <span className="text-[10px] font-black text-amber-600 uppercase">#{it.internalTicketNumber?.toString().padStart(4, '0') || '----'}</span>
                       <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">{it.title}</h3>
                     </div>
                     <p className="text-xs text-slate-500 mt-1 line-clamp-2">{it.description}</p>

                    {it.linkedTicketTitles && it.linkedTicketTitles.length > 0 && (
                      <div className="mt-3">
                        <span className="text-[10px] font-black text-slate-400 uppercase">Tickets vinculados:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {it.linkedTicketTitles.map((title, idx) => (
                            <span key={idx} className="text-[10px] bg-slate-100 px-2 py-0.5 rounded">
                              {title}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-[10px] font-black px-2 py-1 rounded uppercase",
                      it.priority === 3 ? "bg-red-100 text-red-700" :
                      it.priority === 2 ? "bg-amber-100 text-amber-700" :
                      "bg-slate-100 text-slate-700"
                    )}>
                      P{it.priority}
                    </span>
                    <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-1 rounded uppercase font-black">
                      {it.teamId || "Dev"}
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Load More Button */}
      {!loading && totalPages > 1 && currentPage < totalPages && (
        <div className="p-6 pt-0">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="w-full px-4 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loadingMore ? <Loader2 size={16} className="animate-spin" /> : null}
            Carregar Mais
          </button>
        </div>
      )}

      {/* New Internal Ticket Modal */}
      <AnimatePresence>
        {showNewModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowNewModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-black text-slate-800 mb-4 uppercase">Novo Ticket Interno</h2>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-slate-600 uppercase mb-1 block">Título</label>
                  <input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Título do ticket interno"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-amber-400 outline-none text-sm"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-600 uppercase mb-1 block">Descrição</label>
                  <textarea
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="Detalhes técnicos..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-amber-400 outline-none text-sm min-h-[100px]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-black text-slate-600 uppercase mb-1 block">Equipe</label>
                    <select
                      value={newTeam}
                      onChange={(e) => setNewTeam(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                    >
                      <option value="Desenvolvimento">Desenvolvimento</option>
                      <option value="Infraestrutura">Infraestrutura</option>
                      <option value="QA">QA / Testes</option>
                      <option value="Produto">Produto</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-slate-600 uppercase mb-1 block">Prioridade</label>
                    <select
                      value={newPriority}
                      onChange={(e) => setNewPriority(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                    >
                      <option value={1}>Baixa</option>
                      <option value={2}>Média</option>
                      <option value={3}>Alta</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowNewModal(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all text-sm font-bold"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCreateInternalTicket}
                  disabled={!newTitle}
                  className="flex-1 px-4 py-2 rounded-lg bg-amber-500 text-white font-black uppercase tracking-widest hover:bg-amber-600 transition-all disabled:opacity-50 text-sm"
                >
                  Criar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}