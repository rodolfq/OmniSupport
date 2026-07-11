"use client";

import React, { useState, useEffect, useCallback } from "react";
import { StyledSelect } from '@/components/styled-select';
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { useApp } from "@/app/app-context";
import { InternalTicket, Permission, User } from "@/lib/types";
import { InternalTicketService } from "@/lib/services/ticket-service";
import { Plus, Search, Filter, Tag, Clock, Edit3, Lock, Loader2, Grid3X3, List, LayoutDashboard, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface InternalTicketItem extends InternalTicket {
  linkedTicketTitles?: string[];
  assigneeName?: string;
  slaRemaining?: string | null;
  commentCount?: number;
}

const ITEMS_PER_PAGE = 20;

const priorityConfig = {
  1: { label: "Baixa", color: "bg-slate-100 text-slate-700", icon: "●" },
  2: { label: "Média", color: "bg-amber-100 text-amber-700", icon: "●●" },
  3: { label: "Alta", color: "bg-red-100 text-red-700", icon: "●●●" },
};

const KANBAN_STATUSES = [
  { value: "Novo", label: "Novo", color: "bg-blue-100 text-blue-700", icon: "●" },
  { value: "Em Andamento", label: "Em Andamento", color: "bg-amber-100 text-amber-700", icon: "●●" },
  { value: "Em Espera", label: "Em Espera", color: "bg-slate-100 text-slate-700", icon: "●●●" },
  { value: "Concluído", label: "Concluído", color: "bg-emerald-100 text-emerald-700", icon: "✓" },
];

// Default team options (will be replaced by DB values)
const DEFAULT_TEAM_OPTIONS = [
  { value: "Desenvolvimento", label: "Desenvolvimento", color: "bg-indigo-100 text-indigo-700" },
  { value: "Infraestrutura", label: "Infraestrutura", color: "bg-emerald-100 text-emerald-700" },
  { value: "QA / Testes", label: "QA / Testes", color: "bg-amber-100 text-amber-700" },
  { value: "Produto", label: "Produto", color: "bg-purple-100 text-purple-700" },
];

export default function InternalTicketsPage() {
  const router = useRouter();
  const { currentUser, hasPermission, triggerRefresh } = useApp();
  const [tickets, setTickets] = useState<InternalTicketItem[]>([]);
  const [analysts, setAnalysts] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  
// Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [filterTeam, setFilterTeam] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  
  // Teams state (fetched from DB)
  const [teams, setTeams] = useState(DEFAULT_TEAM_OPTIONS);
  
// Modal states
  const [showNewModal, setShowNewModal] = useState(false);
 
  // Form state
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formTeam, setFormTeam] = useState("Desenvolvimento");
  const [formPriority, setFormPriority] = useState(1);
  const [formAssignee, setFormAssignee] = useState("");

  // View mode state
  const [viewMode, setViewMode] = useState<"cards" | "table" | "kanban">("cards");

  const fetchTickets = useCallback(async (page = 1, isLoadMore = false) => {
    if (!currentUser) return;
    
    if (isLoadMore) setLoadingMore(true);
    else setLoading(true);

    try {
      const from = (page - 1) * ITEMS_PER_PAGE;
      const to = from + ITEMS_PER_PAGE - 1;

      let query = supabase
        .from("internal_tickets")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);

      if (searchTerm) query = query.ilike("title", `%${searchTerm}%`);
      if (filterTeam) query = query.eq("team_id", filterTeam);
if (filterAssignee) query = query.eq("assignee_id", filterAssignee);
       if (filterStatus) query = query.eq("status", filterStatus);
       if (filterPriority) query = query.eq("priority", parseInt(filterPriority));
       if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00`);
       if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59`);

      const { data: internalData, error, count } = await query;

      console.log("Internal tickets query result:", { data: internalData?.length, error, count });

      if (error) {
        console.error("Query error:", error);
        throw error;
      }

      setTotalPages(Math.ceil((count || 0) / ITEMS_PER_PAGE));

      // Get assignee names separately
      const assigneeIds = [...new Set((internalData || []).map((t: any) => t.assignee_id).filter(Boolean))];
      const { data: assignees } = await supabase
        .from("profiles")
        .select("id, name")
        .in("id", assigneeIds);
      const assigneeMap = new Map((assignees || []).map((a: any) => [a.id, a.name]));

      // Get linked tickets
      const { data: links } = await supabase
        .from("ticket_internal_links")
        .select("ticket_id, internal_ticket_id");

      const { data: regularTickets } = await supabase.from("tickets").select("id, title, public_ticket_number");
      const ticketMap = new Map((regularTickets || []).map((t: any) => [t.id, `#${t.public_ticket_number || t.id.slice(0, 8)}`]));

      setTickets((internalData || []).map((it: any) => {
        const linkedIds = (links || [])
          .filter((l: any) => l.internal_ticket_id === it.id)
          .map((l: any) => l.ticket_id);
        
        // Calculate SLA remaining
        let slaRemaining = null;
        if (it.sla_limit) {
          const slaDate = new Date(it.sla_limit);
          const now = new Date();
          const diff = slaDate.getTime() - now.getTime();
          const hours = Math.floor(diff / (1000 * 60 * 60));
          const days = Math.floor(hours / 24);
          if (diff > 0) {
            slaRemaining = days > 0 ? `${days}d ${hours % 24}h` : `${hours}h`;
          } else {
            slaRemaining = "Expirado";
          }
        }
        
        // Determine if this is a linked internal ticket (created from parent ticket)
        const isLinkedToParent = linkedIds.length > 0;
        
        // ID format: "int-XXXX" for standalone, "XXXX" for linked
        const formattedId = isLinkedToParent
          ? it.internal_ticket_number?.toString().padStart(4, '0') || it.id.slice(0, 8)
          : `int-${it.internal_ticket_number?.toString().padStart(4, '0') || it.id.slice(0, 8)}`;

        return {
          ...it,
          uuid: it.id,
          id: formattedId,
          internalTicketNumber: it.internal_ticket_number,
          parentTicketIds: linkedIds,
          linkedTicketTitles: linkedIds.map((id: string) => ticketMap.get(id) || "Ticket removido").filter(Boolean),
          assigneeName: it.assignee_id ? assigneeMap.get(it.assignee_id) || null : null,
          slaRemaining,
          status: it.status || "Novo",
        };
      }));
    } catch (error) {
      console.error("Error loading tickets:", error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [currentUser, searchTerm, filterTeam, filterAssignee, filterPriority, dateFrom, dateTo]);

  const fetchAnalysts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, email, avatar_url, role")
        .or("role.eq.Equipe,role.eq.Administrador");
      if (error) throw error;
      setAnalysts(data || []);
    } catch (error) {
      console.error("Error loading analysts:", error);
    }
  }, []);

  const fetchTeams = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("internal_teams")
        .select("id, name, description")
        .order("name");
      if (error) throw error;
      if (data && data.length > 0) {
        setTeams(data.map((t: any) => ({ 
          value: t.name, 
          label: t.name, 
          color: "bg-indigo-100 text-indigo-700" 
        })));
      }
    } catch (error) {
      console.error("Error loading teams:", error);
    }
  }, []);

  useEffect(() => {
    fetchTickets(1);
  }, [fetchTickets, triggerRefresh]);

  useEffect(() => {
    fetchAnalysts();
  }, [fetchAnalysts]);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const resetFilters = () => {
    setSearchTerm("");
    setFilterTeam("");
    setFilterAssignee("");
    setFilterStatus("");
    setFilterPriority("");
    setDateFrom("");
    setDateTo("");
  };

  const handleCreateOrUpdate = async () => {
    console.log("handleCreateOrUpdate called", { 
      currentUser: currentUser?.id, 
      formTitle,
      formDescription: formDescription?.substring(0, 50),
      hasUser: !!currentUser 
    });
    
    if (!currentUser || !formTitle) {
      console.error("Missing required: currentUser or formTitle");
      return;
    }

    try {
      const ticketData = {
        title: formTitle,
        description: formDescription,
        teamId: formTeam,
        priority: formPriority,
        assigneeId: formAssignee || undefined,
        creatorId: currentUser.id,
        tags: [],
      };

      console.log("Creating internal ticket:", ticketData);
      const savedId = await InternalTicketService.save(ticketData);
      console.log("Internal ticket saved with ID:", savedId);
      setShowNewModal(false);
      resetForm();
      fetchTickets(1);
    } catch (error) {
      console.error("Error saving ticket:", error);
      alert("Erro ao salvar: " + (error as any)?.message || "Unknown error");
    }
};

  const resetForm = () => {
    setFormTitle("");
    setFormDescription("");
    setFormTeam("Desenvolvimento");
    setFormPriority(1);
    setFormAssignee("");
  };

const openEditModal = (ticket: InternalTicketItem) => {
     router.push(`/internal-tickets/${ticket.id}`);
   };
   
   const handleStatusChange = async (ticketUuid: string, newStatus: string) => {
     try {
       const { error } = await supabase
         .from('internal_tickets')
         .update({ status: newStatus, updated_at: new Date().toISOString() })
         .eq('id', ticketUuid);
       if (error) throw error;
       fetchTickets(1);
     } catch (error) {
       console.error('Error updating status:', error);
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
          <div className="flex items-center gap-3">
            {hasPermission(Permission.INTERNAL_TICKETS_EDIT) && (
              <button
                onClick={() => {
                  resetForm();
                  setShowNewModal(true);
                }}
                className="px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-amber-600 transition-all flex items-center gap-2"
              >
                <Plus size={16} />
                Novo Ticket
              </button>
            )}
          </div>
        </div>

        {/* Search + View Switcher */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por título..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:border-amber-400 outline-none text-sm font-medium"
            />
          </div>
          
          {/* View Switcher */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setViewMode("cards")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all",
                viewMode === "cards" ? "bg-white text-amber-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
              title="Cards"
            >
              <Grid3X3 size={16} />
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all",
                viewMode === "table" ? "bg-white text-amber-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
              title="Tabela"
            >
              <List size={16} />
            </button>
            <button
              onClick={() => setViewMode("kanban")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all",
                viewMode === "kanban" ? "bg-white text-amber-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
              title="Kanban"
            >
              <LayoutDashboard size={16} />
            </button>
          </div>
          
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
              showFilters ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            <Filter size={16} />
            Filtros
          </button>
        </div>

        {/* Advanced Filters */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 pt-3 border-t border-slate-100">
                <StyledSelect
                  value={filterTeam}
                  onChange={(e) => setFilterTeam(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium bg-white"
                >
                  <option value="">Todas Equipes</option>
                  {teams.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </StyledSelect>

                <StyledSelect
                  value={filterAssignee}
                  onChange={(e) => setFilterAssignee(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium bg-white"
                >
                  <option value="">Todos Responsáveis</option>
                  {analysts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </StyledSelect>

<StyledSelect
                   value={filterPriority}
                   onChange={(e) => setFilterPriority(e.target.value)}
                   className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium bg-white"
                 >
                   <option value="">Todas Prioridades</option>
                   <option value="3">Alta</option>
                   <option value="2">Média</option>
                   <option value="1">Baixa</option>
                 </StyledSelect>

                 <StyledSelect
                   value={filterStatus}
                   onChange={(e) => setFilterStatus(e.target.value)}
                   className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium bg-white"
                 >
                   <option value="">Todos Status</option>
                   {KANBAN_STATUSES.map((s) => (
                     <option key={s.value} value={s.value}>{s.label}</option>
                   ))}
                 </StyledSelect>

                 <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium"
                  placeholder="Data início"
                />

                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium"
                  placeholder="Data fim"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
{loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
              </div>
            ) : tickets.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-2xl border border-slate-200">
                <Lock size={48} className="mx-auto text-slate-300 mb-4" />
                <h3 className="text-lg font-bold text-slate-700 mb-2">Nenhum ticket interno encontrado</h3>
                <p className="text-slate-500 text-sm">Crie um novo ticket ou ajuste os filtros.</p>
              </div>
            ) : viewMode === "cards" ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {tickets.map((it) => (
                  <TicketCard key={it.id} ticket={it} onEdit={() => openEditModal(it)} teams={teams} />
                ))}
              </div>
            ) : viewMode === "table" ? (
              <TicketTable tickets={tickets} onEdit={openEditModal} teams={teams} />
            ) : (
              <KanbanBoard tickets={tickets} onEdit={openEditModal} onStatusChange={handleStatusChange} />
            )}
          </div>

          {/* Modal - Only for creating new tickets */}
          <AnimatePresence>
            {showNewModal && (
<TicketModal
                 isOpen={showNewModal}
                 onClose={() => {
                   setShowNewModal(false);
                   resetForm();
                 }}
                 onSubmit={handleCreateOrUpdate}
                 formTitle={formTitle}
                 setFormTitle={setFormTitle}
                 formDescription={formDescription}
                 setFormDescription={setFormDescription}
                 formTeam={formTeam}
                 setFormTeam={setFormTeam}
                 formPriority={formPriority}
                 setFormPriority={setFormPriority}
                 formAssignee={formAssignee}
                 setFormAssignee={setFormAssignee}
                 analysts={analysts}
                 teams={teams}
                 isEdit={false}
               />
            )}
          </AnimatePresence>
        </div>
      );
    }

// Ticket Card Component
function TicketCard({ ticket, onEdit, teams = DEFAULT_TEAM_OPTIONS }: { ticket: InternalTicketItem; onEdit: () => void; teams?: typeof DEFAULT_TEAM_OPTIONS }) {
  const teamOption = teams.find((t) => t.value === ticket.teamId) || teams[0];
  const priorityInfo = priorityConfig[ticket.priority as keyof typeof priorityConfig] || priorityConfig[1];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-lg hover:border-amber-300 transition-all group cursor-pointer"
      onClick={onEdit}
    >
      <div className="flex items-start justify-between mb-3">
<div className="flex items-center gap-2">
           <span className="text-[10px] font-black text-amber-600 uppercase">{ticket.id?.startsWith("int-") ? ticket.id : `#${ticket.internalTicketNumber?.toString().padStart(4, "0")}`}</span>
           <span className={cn("text-[10px] font-black px-2 py-1 rounded-full", priorityInfo.color)}>
             {priorityInfo.icon}
           </span>
         </div>
<button
           onClick={(e) => {
             e.stopPropagation();
             onEdit();
           }}
           className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-slate-100 transition-all"
         >
           <Edit3 size={14} className="text-slate-500" />
        </button>
      </div>

      <h3 className="text-sm font-black text-slate-800 mb-2 line-clamp-2">{ticket.title}</h3>
      
      <p className="text-xs text-slate-500 mb-3 line-clamp-2">
        {(() => {
          const html = ticket.description || '';
          return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
        })()}
      </p>

      {/* Meta row */}
      <div className="flex items-center justify-between text-[10px] font-medium">
        <span className={cn("px-2 py-1 rounded-full font-black uppercase", teamOption.color)}>
          {teamOption.label}
        </span>
        {ticket.slaRemaining && (
          <span className={cn(
            "flex items-center gap-1 font-bold",
            ticket.slaRemaining === "Expirado" ? "text-red-600" : "text-slate-600"
          )}>
            <Clock size={12} />
            {ticket.slaRemaining}
          </span>
        )}
      </div>

      {/* Linked tickets */}
      {ticket.linkedTicketTitles && ticket.linkedTicketTitles.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="flex items-center gap-1 text-[10px] text-slate-500 mb-1">
            <Tag size={12} />
            <span className="font-black uppercase">Vinculados:</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {ticket.linkedTicketTitles.map((title, idx) => (
              <span key={idx} className="text-[10px] bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                {title}
              </span>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// Ticket Table Component
function TicketTable({ tickets, onEdit, teams = DEFAULT_TEAM_OPTIONS }: { tickets: InternalTicketItem[]; onEdit: (t: InternalTicketItem) => void; teams?: typeof DEFAULT_TEAM_OPTIONS }) {
   const priorityInfo = priorityConfig[1];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <table className="w-full">
        <thead className="bg-slate-50/50 border-b border-slate-200">
          <tr>
            <th className="px-4 py-3 text-left text-[10px] font-black uppercase text-slate-400">Número</th>
            <th className="px-4 py-3 text-left text-[10px] font-black uppercase text-slate-400">Título</th>
            <th className="px-4 py-3 text-left text-[10px] font-black uppercase text-slate-400">Equipe</th>
            <th className="px-4 py-3 text-left text-[10px] font-black uppercase text-slate-400">Prioridade</th>
            <th className="px-4 py-3 text-left text-[10px] font-black uppercase text-slate-400">Responsável</th>
            <th className="px-4 py-3 text-left text-[10px] font-black uppercase text-slate-400">SLA</th>
            <th className="px-4 py-3 text-left text-[10px] font-black uppercase text-slate-400">Vinculados</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
{tickets.map((it) => {
             const teamOpt = teams.find((t) => t.value === it.teamId) || teams[0];
             const prio = priorityConfig[it.priority as keyof typeof priorityConfig] || priorityConfig[1];
            return (
              <tr key={it.id} className="hover:bg-slate-50/50 transition-colors cursor-pointer" onClick={() => onEdit(it)}>
                <td className="px-4 py-3 text-[10px] font-black text-amber-600">{it.id?.startsWith("int-") ? it.id : `#${it.internalTicketNumber?.toString().padStart(4, "0")}`}</td>
                <td className="px-4 py-3 text-sm font-bold text-slate-800">{it.title}</td>
                <td className="px-4 py-3">
                  <span className={cn("text-[10px] font-black px-2 py-1 rounded-full uppercase", teamOpt.color)}>
                    {teamOpt.label}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={cn("text-[10px] font-black px-2 py-1 rounded-full", prio.color)}>
                    {prio.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{it.assigneeName || "-"}</td>
                <td className={cn("px-4 py-3 text-[10px] font-bold", 
                  it.slaRemaining === "Expirado" ? "text-red-600" : "text-slate-600")}>
                  {it.slaRemaining || "-"}
                </td>
                <td className="px-4 py-3 text-sm text-slate-500">
                  {it.linkedTicketTitles?.length || 0} ticket(s)
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Ticket Modal Component
function TicketModal({
  isOpen,
  onClose,
  onSubmit,
  formTitle,
  setFormTitle,
  formDescription,
  setFormDescription,
  formTeam,
  setFormTeam,
  formPriority,
  setFormPriority,
  formAssignee,
  setFormAssignee,
  analysts,
  teams = DEFAULT_TEAM_OPTIONS,
  isEdit,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: () => void;
  formTitle: string;
  setFormTitle: (v: string) => void;
  formDescription: string;
  setFormDescription: (v: string) => void;
  formTeam: string;
  setFormTeam: (v: string) => void;
  formPriority: number;
  setFormPriority: (v: number) => void;
  formAssignee: string;
  setFormAssignee: (v: string) => void;
  analysts: User[];
  teams?: typeof DEFAULT_TEAM_OPTIONS;
  isEdit: boolean;
}) {
  if (!isOpen) return null;
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-2xl p-6 max-w-lg w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-black text-slate-800 mb-4 uppercase">
          {isEdit ? "Editar Ticket" : "Novo Ticket Interno"}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-black text-slate-600 uppercase mb-1 block">Título *</label>
            <input
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder="Título do ticket"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-amber-400 outline-none text-sm font-medium"
            />
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-600 uppercase mb-1 block">Descrição</label>
            <textarea
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Detalhes técnicos..."
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-amber-400 outline-none text-sm min-h-[100px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-600 uppercase mb-1 block">Equipe</label>
<StyledSelect
                 value={formTeam}
                 onChange={(e) => setFormTeam(e.target.value)}
                 className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium bg-white"
               >
                 {teams.map((t) => (
                   <option key={t.value} value={t.value}>{t.label}</option>
                 ))}
               </StyledSelect>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-600 uppercase mb-1 block">Prioridade</label>
              <StyledSelect
                value={formPriority}
                onChange={(e) => setFormPriority(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium bg-white"
              >
                <option value={1}>Baixa</option>
                <option value={2}>Média</option>
                <option value={3}>Alta</option>
              </StyledSelect>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-600 uppercase mb-1 block">Responsável</label>
            <StyledSelect
              value={formAssignee}
              onChange={(e) => setFormAssignee(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium bg-white"
            >
              <option value="">Não atribuído</option>
              {analysts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </StyledSelect>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all text-sm font-bold"
          >
            Cancelar
          </button>
          <button
            onClick={onSubmit}
            disabled={!formTitle}
            className="flex-1 px-4 py-2 rounded-lg bg-amber-500 text-white font-black uppercase tracking-widest hover:bg-amber-600 transition-all disabled:opacity-50 text-sm"
          >
            {isEdit ? "Salvar" : "Criar"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Kanban Board Component
function KanbanBoard({ 
  tickets, 
  onEdit,
  onStatusChange
}: { 
  tickets: InternalTicketItem[]; 
  onEdit: (t: InternalTicketItem) => void;
  onStatusChange?: (ticketId: string, newStatus: string) => void;
}) {
  const handleStatusChange = async (ticketUuid: string, newStatus: string) => {
    if (!onStatusChange) return;
    onStatusChange(ticketUuid, newStatus);
  };

  const columns = KANBAN_STATUSES.map(status => ({
    ...status,
    tickets: tickets.filter(t => (t.status || "Novo") === status.value)
  }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {columns.map((col) => (
        <div key={col.value} className="bg-slate-50 rounded-2xl p-3">
          <div className="flex items-center gap-2 mb-3 px-2">
            <span className={cn("text-xs font-black px-2 py-1 rounded-full", col.color)}>
              {col.icon}
            </span>
            <h3 className="text-sm font-bold text-slate-700">{col.label}</h3>
            <span className="text-xs text-slate-400 ml-auto">({col.tickets.length})</span>
          </div>
          
          <div className="space-y-3 min-h-[200px]">
            {col.tickets.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <p className="text-xs">Vazio</p>
              </div>
            ) : (
              col.tickets.map((ticket) => (
                <KanbanCard 
                  key={ticket.id} 
                  ticket={ticket} 
                  onEdit={onEdit}
                  onStatusChange={handleStatusChange}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
  }

  // KanbanCard Component
  function KanbanCard({
  ticket, 
  onEdit,
  onStatusChange
}: { 
  ticket: InternalTicketItem; 
  onEdit: (t: InternalTicketItem) => void;
  onStatusChange?: (ticketUuid: string, newStatus: string) => void;
}) {
  const priorityInfo = priorityConfig[ticket.priority as keyof typeof priorityConfig] || priorityConfig[1];

  return (
    <div 
      className="bg-white rounded-xl p-4 border border-slate-200 hover:shadow-md hover:border-amber-300 transition-all cursor-pointer group"
      onClick={() => onEdit(ticket)}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-[10px] font-black text-amber-600">
          {ticket.id?.startsWith("int-") ? ticket.id : `#${ticket.internalTicketNumber?.toString().padStart(4, "0")}`}
        </span>
        <button 
          onClick={(e) => {
            e.stopPropagation();
            onEdit(ticket);
          }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-100 transition-all"
        >
          <ChevronRight size={14} className="text-slate-500" />
        </button>
      </div>
      
      <h4 className="font-bold text-slate-800 text-sm mb-2 line-clamp-2" title={ticket.title}>
        {ticket.title}
      </h4>
      
      <div className="flex items-center justify-between">
        <span className={cn("text-[10px] font-black px-2 py-1 rounded-full", priorityInfo.color)}>
          {priorityInfo.icon}
        </span>
        
        {ticket.assigneeName && (
          <span className="text-[10px] text-slate-500 truncate max-w-[100px]" title={ticket.assigneeName}>
            {ticket.assigneeName}
          </span>
        )}
      </div>
      
      {/* Status dropdown for quick change */}
      {onStatusChange && (
        <StyledSelect
          value={ticket.status || 'Novo'}
          onChange={(e) => {
            e.stopPropagation();
            onStatusChange(ticket.uuid || '', e.target.value);
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-full mt-2 text-[10px] border border-slate-200 rounded px-2 py-1 bg-slate-50"
        >
          {KANBAN_STATUSES.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </StyledSelect>
      )}
      
      {ticket.linkedTicketTitles && ticket.linkedTicketTitles.length > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-100">
          <span className="text-[10px] text-slate-400 truncate" title={ticket.linkedTicketTitles.join(", ")}>
            {ticket.linkedTicketTitles[0]}
          </span>
        </div>
      )}
    </div>
  );
}
