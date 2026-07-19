"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { StyledSelect } from '@/components/styled-select';
import {
  Ticket,
  TicketStatus,
  Permission,
  UserRole,
} from "@/lib/types";

import { SearchFilters, searchTickets } from "@/lib/search";
import { isClosedTicketStatus, isInProgressTicketStatus } from "@/lib/ticket-status";
import {
  FileText,
  ChevronLeft,
  ChevronRight,
  Star,
  ArrowUpDown,
  GripVertical,
  Loader2,
  CheckSquare,
  Square,
  Trash2,
  Users,
  RefreshCw,
  X,
  GitMerge,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { ModernSearchBar } from "@/components/modern-search-bar";
import { TicketDetailModal } from "@/components/ticket-detail-modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useApp } from "@/app/app-context";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";

interface Column {
  id: string;
  label: string;
  sortable?: boolean;
}

function SortableHeader({
  column,
  sortConfig,
  onSort,
}: {
  column: Column;
  sortConfig: { key: string; direction: "asc" | "desc" } | null;
  onSort: (key: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 0,
    position: "relative" as const,
  };

  return (
    <th
      ref={setNodeRef}
      style={style}
      className={cn(
        "px-6 py-5 text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest transition-colors",
        column.sortable && "cursor-pointer hover:text-[var(--accent-text)]",
        isDragging && "bg-[var(--surface-card)] shadow-lg opacity-80",
      )}
    >
      <div className="flex items-center gap-2">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 -ml-2 text-slate-300 hover:text-[var(--text-tertiary)]"
        >
          <GripVertical size={10} />
        </div>
        <div
          className="flex-1 flex items-center gap-2"
          onClick={() => column.sortable && onSort(column.id)}
        >
          {column.label}
          {column.sortable && (
            <ArrowUpDown
              size={12}
              className={cn(
                "transition-colors",
                sortConfig?.key === column.id
                  ? "text-[var(--accent-text)]"
                  : "text-slate-200",
              )}
            />
          )}
        </div>
      </div>
    </th>
  );
}

export default function TicketsPage() {
  const { currentUser, hasPermission } = useApp();
  const [filteredTickets, setFilteredTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [ticketToDelete, setTicketToDelete] = useState<Ticket | null>(null);
  const [isDeletingTicket, setIsDeletingTicket] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [pageSize] = useState(10);
  const [searchFilters, setSearchFilters] = useState<SearchFilters>({});
  const [sortConfig, setSortConfig] = useState<{
    key: string;
    direction: "asc" | "desc";
  } | null>(null);

  // Bulk actions state
  const [selectedTickets, setSelectedTickets] = useState<string[]>([]);
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [isTitleModalOpen, setIsTitleModalOpen] = useState(false);
  const [isTagsModalOpen, setIsTagsModalOpen] = useState(false);
  const [isPriorityModalOpen, setIsPriorityModalOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string>('');
  const [selectedMasterTicketId, setSelectedMasterTicketId] = useState<string>('');
  const [newBulkTitle, setNewBulkTitle] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);

  const [columns, setColumns] = useState<Column[]>([
    { id: "id", label: "ID", sortable: true },
    { id: "title", label: "Assunto", sortable: true },
    { id: "company", label: "Cliente", sortable: true },
    { id: "assignee", label: "Responsável", sortable: true },
    { id: "status", label: "Status", sortable: true },
    { id: "priority", label: "Prioridade", sortable: true },
    { id: "sla", label: "Vencimento", sortable: true },
    { id: "action", label: "Ação", sortable: false },
  ]);

  const [loading, setLoading] = useState(true);
  const [priorities, setPriorities] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const lastAutomaticRequestKeyRef = useRef('');
  const referenceDataUserIdRef = useRef('');
  const canDeleteTickets = hasPermission(Permission.TICKETS_DELETE) || currentUser?.role === UserRole.ADMIN;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const applyRoleBasedFilters = async (tickets: Ticket[]): Promise<Ticket[]> => {
    if (!currentUser) return tickets;

    let filtered = [...tickets];

    if (currentUser.role === UserRole.CUSTOMER) {
      filtered = filtered.filter((t) => t.companyId === currentUser.companyId);

      if (!currentUser.viewAllCompanyTickets) {
        filtered = filtered.filter(
          (t) =>
            t.customerId === currentUser.id ||
            t.employeeIds?.includes(currentUser.id),
        );
      }
    } else {
      const canViewOutsideQueue =
        hasPermission(Permission.OUTSIDE_QUEUE_VIEW) ||
        currentUser.role === UserRole.ADMIN;
      const hasFullRead = hasPermission(Permission.TICKETS_READ);
      const hasInternalView = hasPermission(Permission.INTERNAL_TICKETS_VIEW);

      if (hasInternalView && !hasFullRead) {
        const res = await fetch('/api/tickets?action=internal-links');
        const links = res.ok ? await res.json() : [];
        const ticketsWithInternal = new Set((links || []).map((l: any) => l.ticket_id));
        filtered = filtered.filter((t) => ticketsWithInternal.has(t.id));
      } else if (!canViewOutsideQueue) {
        filtered = filtered.filter(
          (t) =>
            !t.assigneeId ||
            t.assigneeId === currentUser.id ||
            t.employeeIds?.includes(currentUser.id),
        );
      }
    }

    return filtered;
  };

  const bulkUpdateTickets = async (ids: string[], updates: any) => {
    const res = await fetch('/api/tickets', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, updates })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Erro na atualização em lote');
    }
  };

  const loadTickets = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const result = await searchTickets(searchFilters, currentPage, pageSize);
      const roleFilteredTickets = await applyRoleBasedFilters(result.tickets);

      setFilteredTickets(roleFilteredTickets);
      setTotalCount(result.total);
      setTotalPages(Math.ceil(result.total / pageSize));
    } catch (error) {
      console.error("Error loading tickets:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (filters: SearchFilters, page: number) => {
    setSearchFilters(filters);
    setCurrentPage(page);
  };

  const handlePagination = (newPage: number) => {
    setCurrentPage(newPage);
  };

  useEffect(() => {
    if (!currentUser?.id) return;
    const requestKey = `${currentUser.id}:${currentPage}:${JSON.stringify(searchFilters)}`;
    if (lastAutomaticRequestKeyRef.current === requestKey) return;
    lastAutomaticRequestKeyRef.current = requestKey;
    loadTickets();
  }, [currentUser?.id, currentPage, searchFilters]);

  useEffect(() => {
    if (!currentUser?.id) return;
    if (referenceDataUserIdRef.current === currentUser.id) return;
    referenceDataUserIdRef.current = currentUser.id;

    const loadReferenceData = async () => {
      try {
        const [pRes, cRes, uRes] = await Promise.all([
          fetch('/api/config?type=priorities').then(r => r.json()),
          fetch('/api/companies').then(r => r.json()),
          fetch('/api/users?type=all').then(r => r.json()),
        ]);
        setPriorities(pRes);
        setCompanies(cRes);
        setUsers(uRes);
      } catch (error) {
        console.error('Error loading ticket reference data:', error);
      }
    };

    loadReferenceData();
  }, [currentUser?.id]);

  const handleDeleteTicket = async () => {
    if (!ticketToDelete || isDeletingTicket) return;

    setIsDeletingTicket(true);
    try {
      const res = await fetch(`/api/tickets?id=${encodeURIComponent(ticketToDelete.id)}`, {
        method: 'DELETE'
      });

      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(result.error || 'Erro ao excluir chamado.');
      }

      toast.success('Chamado excluído com sucesso!', {
        description: `#${ticketToDelete.ticketNumber ? String(ticketToDelete.ticketNumber).padStart(4, '0') : ticketToDelete.id.slice(0, 8)} foi removido do banco.`
      });
      setSelectedTickets(prev => prev.filter(id => id !== ticketToDelete.id));
      if (selectedTicket?.id === ticketToDelete.id) {
        setSelectedTicket(null);
      }
      setTicketToDelete(null);
      await loadTickets();
    } catch (error: any) {
      toast.error(error.message || 'Erro ao excluir chamado.');
    } finally {
      setIsDeletingTicket(false);
    }
  };

  // Bulk actions functions
  const toggleSelectAll = () => {
    if (selectedTickets.length === filteredTickets.length) {
      setSelectedTickets([]);
    } else {
      setSelectedTickets(filteredTickets.map(t => t.id));
    }
  };

  const toggleSelectTicket = (ticketId: string) => {
    setSelectedTickets(prev => 
      prev.includes(ticketId) 
        ? prev.filter(id => id !== ticketId)
        : [...prev, ticketId]
    );
  };

  const handleBulkTransfer = async () => {
    if (!selectedAssigneeId || selectedTickets.length === 0) return;
    
    try {
      await bulkUpdateTickets(selectedTickets, { assigneeId: selectedAssigneeId });
      
      toast.success(`${selectedTickets.length} chamado(s) transferido(s) com sucesso!`);
      setSelectedTickets([]);
      setIsTransferModalOpen(false);
      loadTickets();
    } catch (error: any) {
      toast.error('Erro ao transferir: ' + error.message);
    }
  };

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedTickets.length === 0) return;
    
    try {
      await bulkUpdateTickets(selectedTickets, { status: newStatus });
      
      toast.success(`${selectedTickets.length} chamado(s) atualizado(s) para "${newStatus}"`);
      setSelectedTickets([]);
      setIsStatusModalOpen(false);
      loadTickets();
    } catch (error: any) {
      toast.error('Erro ao alterar status: ' + error.message);
    }
  };

  const handleMergeTickets = async () => {
    if (!selectedMasterTicketId || selectedTickets.length < 2) return;
    
    const ticketsToMerge = selectedTickets.filter(id => id !== selectedMasterTicketId);
    const masterTicket = filteredTickets.find(t => t.id === selectedMasterTicketId);
    
    if (!masterTicket) {
      toast.error('Chamado principal não encontrado');
      return;
    }
    
    try {
      await bulkUpdateTickets(ticketsToMerge, { status: TicketStatus.CLOSED });
      
      toast.success(`${ticketsToMerge.length} chamado(s) mesclado(s) ao chamado #${masterTicket.ticketNumber || masterTicket.id.slice(0, 8)}`);
      setSelectedTickets([]);
      setIsMergeModalOpen(false);
      loadTickets();
    } catch (error: any) {
      toast.error('Erro ao mesclar: ' + error.message);
    }
  };

  const handleBulkTitleChange = async () => {
    if (!newBulkTitle.trim() || selectedTickets.length === 0) return;
    
    try {
      await bulkUpdateTickets(selectedTickets, { title: newBulkTitle });
      
      toast.success(`${selectedTickets.length} título(s) atualizado(s)`);
      setSelectedTickets([]);
      setIsTitleModalOpen(false);
      setNewBulkTitle('');
      loadTickets();
    } catch (error: any) {
      toast.error('Erro ao alterar título: ' + error.message);
    }
  };

  const handleBulkTagsChange = async () => {
    if (selectedTickets.length === 0) return;
    
    try {
      const existingTags = [...new Set(filteredTickets.filter(t => selectedTickets.includes(t.id)).flatMap(t => t.tags || []))];
      const allTags = [...new Set([...existingTags, ...selectedTags])];
      
      await bulkUpdateTickets(selectedTickets, { tags: allTags });
      
      toast.success(`${selectedTickets.length} marcador(es) atualizado(s)`);
      setSelectedTickets([]);
      setIsTagsModalOpen(false);
      setSelectedTags([]);
      loadTickets();
    } catch (error: any) {
      toast.error('Erro ao alterar marcadores: ' + error.message);
    }
  };

  const handleBulkPriorityChange = async (priority: string) => {
    if (!priority || selectedTickets.length === 0) return;
    
    try {
      await bulkUpdateTickets(selectedTickets, { priority });
      
      toast.success(`${selectedTickets.length} prioridade(s) atualizada(s)`);
      setSelectedTickets([]);
      setIsPriorityModalOpen(false);
      loadTickets();
    } catch (error: any) {
      toast.error('Erro ao alterar prioridade: ' + error.message);
    }
  };

  // Load teams and their members
  useEffect(() => {
    if (!isTransferModalOpen) return;
    
    const loadTeams = async () => {
      const res = await fetch('/api/tickets?action=teams');
      const data = res.ok ? await res.json() : [];
      setTeams(data);
    };
    loadTeams();
  }, [isTransferModalOpen]);

  useEffect(() => {
    if (!selectedTeamId) {
      setTeamMembers([]);
      return;
    }
    
    const loadMembers = async () => {
      const team = teams.find(t => t.id === selectedTeamId);
      if (team?.member_ids) {
        const res = await fetch(`/api/users?type=all`);
        const allUsers = res.ok ? await res.json() : [];
        const members = allUsers.filter((u: any) => team.member_ids.includes(u.id));
        setTeamMembers(members);
      }
    };
    loadMembers();
  }, [selectedTeamId, teams]);

  useEffect(() => {
    setShowBulkActions(selectedTickets.length > 0);
  }, [selectedTickets]);

  const loadTags = async () => {
    const res = await fetch('/api/config?type=tags');
    const data = res.ok ? await res.json() : [];
    setTags(data);
  };

  const handleSort = (key: string) => {
    let direction: "asc" | "desc" = "asc";
    if (
      sortConfig &&
      sortConfig.key === key &&
      sortConfig.direction === "asc"
    ) {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const sortedTickets = useMemo(() => {
    if (!sortConfig) return filteredTickets;

    return [...filteredTickets].sort((a, b) => {
      let aValue: any = "";
      let bValue: any = "";

      switch (sortConfig.key) {
        case "id":
          aValue = a.ticketNumber || 0;
          bValue = b.ticketNumber || 0;
          break;
        case "title":
          aValue = a.title;
          bValue = b.title;
          break;
        case "company":
          aValue = companies.find((c) => c.id === a.companyId)?.name || "";
          bValue = companies.find((c) => c.id === b.companyId)?.name || "";
          break;
        case "assignee":
          aValue = users.find((u) => u.id === a.assigneeId)?.name || "";
          bValue = users.find((u) => u.id === b.assigneeId)?.name || "";
          break;
        case "status":
          aValue = a.status;
          bValue = b.status;
          break;
        case "priority":
          const priorityOrder = ["Baixa", "Média", "Alta", "Urgente"];
          aValue = priorityOrder.indexOf(a.priority as string);
          bValue = priorityOrder.indexOf(b.priority as string);
          break;
        case "sla":
          const slaValue = (ticket: Ticket) => {
            if (isClosedTicketStatus(ticket.status)) return "";
            const config = priorities.find((p) => p.label === ticket.priority);
            if (!config || !config.sla_hours) return "";
            return new Date(ticket.createdAt).getTime() + config.sla_hours * 60 * 60 * 1000;
          };
          aValue = slaValue(a);
          bValue = slaValue(b);
          break;
      }

      if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [filteredTickets, sortConfig, companies, users]);

  const visibleTickets = useMemo(() => {
    return sortedTickets;
  }, [sortedTickets]);

  const paginationPages = useMemo(() => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const start = Math.min(Math.max(1, currentPage - 2), totalPages - 4);
    return Array.from({ length: 5 }, (_, index) => start + index);
  }, [currentPage, totalPages]);

  const getSLAStatus = (ticket: Ticket) => {
    const config = priorities.find((p) => p.label === ticket.priority);
    if (!config || !config.sla_hours)
      return { label: "---", color: "text-[var(--text-tertiary)]", isOverdue: false };

    const createdAt = new Date(ticket.createdAt);
    const limit = new Date(
      createdAt.getTime() + config.sla_hours * 60 * 60 * 1000,
    );
    const now = new Date();
    const isOverdue = now > limit;

    const diff = limit.getTime() - now.getTime();
    const isNear = diff > 0 && diff < 4 * 60 * 60 * 1000;

    return {
      label: limit.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
      color: isOverdue
        ? "text-[var(--text-danger)] font-semibold"
        : isNear
          ? "text-orange-600 dark:text-orange-400 font-bold"
          : "text-[var(--text-tertiary)] font-medium",
      isOverdue,
    };
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setColumns((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const renderCell = (columnId: string, ticket: Ticket) => {
    switch (columnId) {
      case "id":
        // ID column - checkbox is rendered separately in the row
        return (
          <td key="id" className="px-6 py-5">
            <span className="font-mono text-[10px] font-semibold text-[var(--accent-text)] bg-[var(--accent)]/10 px-2 py-1 rounded">
              #{ticket.ticketNumber ? String(ticket.ticketNumber).padStart(4, '0') : ticket.id.slice(0, 8)}
            </span>
          </td>
        );
      case "title":
        return (
          <td key="title" className="px-6 py-5">
            <div className="flex flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-[var(--text-primary)] text-sm italic">
                  {ticket.title}
                </span>
                {ticket.id === "ex-ticket-payment-error" && (
                  <span className="text-[9px] font-semibold uppercase tracking-tight text-[var(--accent-text)] bg-[var(--accent)]/10 border border-[var(--accent)]/30 px-1.5 py-0.5 rounded shadow-sm animate-pulse select-none">
                    Chamado Exemplo (Sem Banco)
                  </span>
                )}
              </div>
              <span className="text-[10px] text-[var(--text-tertiary)] font-medium">
                {ticket.category}
              </span>
            </div>
          </td>
        );
      case "company":
        const company = companies.find((c) => c.id === ticket.companyId);
        return (
          <td key="company" className="px-6 py-5">
            <span className="text-sm font-bold text-[var(--text-secondary)]">
              {company?.name || "---"}
            </span>
          </td>
        );
      case "assignee":
        const assignee = users.find((u) => u.id === ticket.assigneeId);
        return (
          <td key="assignee" className="px-6 py-5">
            <div className="flex items-center gap-2">
              {assignee ? (
                <>
                  <div className="w-5 h-5 rounded-full bg-[var(--border-default)] flex items-center justify-center text-[8px] font-semibold text-[var(--text-secondary)]">
                    {assignee.name.charAt(0)}
                  </div>
                  <span className="text-sm font-medium text-[var(--text-secondary)]">
                    {assignee.name}
                  </span>
                </>
              ) : (
                <span className="text-xs text-slate-300 italic">
                  Dísponivel
                </span>
              )}
            </div>
          </td>
        );
      case "status":
        return (
          <td key="status" className="px-6 py-5">
            <span
              className={cn(
                "px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-tighter",
                ticket.status === TicketStatus.NEW
                  ? "bg-[var(--surface-info)] text-[var(--text-info)]"
                  : isInProgressTicketStatus(ticket.status)
                    ? "bg-[var(--surface-warning)] text-[var(--text-warning)]"
                    : isClosedTicketStatus(ticket.status)
                      ? "bg-[var(--surface-success)] text-[var(--text-success)]"
                      : "bg-[var(--surface-pill)] text-[var(--text-secondary)]",
              )}
            >
              {ticket.status}
            </span>
          </td>
        );
      case "priority":
        return (
          <td key="priority" className="px-6 py-5">
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4].map((star) => {
                const priorityLabels = ["Baixa", "Média", "Alta", "Urgente"];
                const currentPriority =
                  priorityLabels.indexOf(ticket.priority as string) + 1;
                return (
                  <Star
                    key={star}
                    size={12}
                    className={cn(
                      star <= currentPriority
                        ? "fill-amber-400 text-[var(--text-warning)]"
                        : "text-slate-200",
                    )}
                  />
                );
              })}
            </div>
          </td>
        );
      case "sla":
        const sla = getSLAStatus(ticket);
        return (
          <td key="sla" className="px-6 py-5">
            <div className="flex flex-col">
              <span className={cn("text-[10px] uppercase", sla.color)}>
                {sla.label}
              </span>
              {sla.isOverdue && (
                <span className="text-[8px] font-semibold text-[var(--text-danger)] uppercase tracking-tighter">
                  SLA Vencido
                </span>
              )}
            </div>
          </td>
        );
      case "action":
        return (
          <td key="action" className="px-6 py-5 text-right">
            <div className="flex items-center justify-end gap-1">
              {canDeleteTickets && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setTicketToDelete(ticket);
                  }}
                  className="p-2 text-slate-300 hover:text-[var(--text-danger)] hover:bg-[var(--surface-danger)] rounded-xl transition-all"
                  title="Excluir chamado"
                >
                  <Trash2 size={16} />
                </button>
              )}
              <button
                type="button"
                className="p-2 text-slate-300 group-hover:text-[var(--accent-text)] transition-colors"
                title="Abrir chamado"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </td>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-black text-[var(--text-primary)] tracking-tight">
            Chamados
          </h2>
          <p className="text-[var(--text-tertiary)] font-medium">
            Gerenciamento completo de solicitações
          </p>
        </div>
        {showBulkActions && (
          <div className="flex items-center gap-3 bg-[var(--accent)]/10 px-4 py-2 rounded-2xl border border-[var(--accent)]/20">
            <span className="text-xs font-bold text-[var(--accent-text)]">
              {selectedTickets.length} selecionado(s)
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={() => setIsTransferModalOpen(true)}
                className="px-3 py-1.5 bg-[var(--surface-card)] text-[var(--accent-text)] rounded-xl text-[10px] font-semibold uppercase tracking-widest border border-[var(--accent)]/30 hover:bg-[var(--accent)] hover:text-white transition-all flex items-center gap-1.5"
              >
                <Users size={12} /> Transferir
              </button>
              <button
                onClick={() => setIsStatusModalOpen(true)}
                className="px-3 py-1.5 bg-[var(--surface-card)] text-[var(--text-secondary)] rounded-xl text-[10px] font-semibold uppercase tracking-widest border border-[var(--border-default)] hover:bg-slate-600 hover:text-white transition-all flex items-center gap-1.5"
              >
                <RefreshCw size={12} /> Status
              </button>
              <button
                onClick={() => setIsMergeModalOpen(true)}
                className="px-3 py-1.5 bg-[var(--surface-card)] text-[var(--text-success)] rounded-xl text-[10px] font-semibold uppercase tracking-widest border border-[var(--text-success)]/30 hover:bg-[var(--text-success)] hover:text-white transition-all flex items-center gap-1.5"
              >
                <GitMerge size={12} /> Mesclar
              </button>
              <button
                onClick={() => setIsTitleModalOpen(true)}
                className="px-3 py-1.5 bg-[var(--surface-card)] text-[var(--text-info)] rounded-xl text-[10px] font-semibold uppercase tracking-widest border border-[var(--text-info)]/30 hover:bg-[var(--text-info)] hover:text-white transition-all flex items-center gap-1.5"
              >
                <FileText size={12} /> Título
              </button>
              <button
                onClick={() => setIsPriorityModalOpen(true)}
                className="px-3 py-1.5 bg-[var(--surface-card)] text-[var(--text-warning)] rounded-xl text-[10px] font-semibold uppercase tracking-widest border border-[var(--border-alert)] hover:bg-[var(--accent-warning-hover)] hover:text-white transition-all flex items-center gap-1.5"
              >
                <Star size={12} /> Prioridade
              </button>
              <button
                onClick={() => {
                  setIsTagsModalOpen(true);
                  loadTags();
                }}
                className="px-3 py-1.5 bg-[var(--surface-card)] text-purple-600 dark:text-purple-400 rounded-xl text-[10px] font-semibold uppercase tracking-widest border border-purple-200 dark:border-purple-500/30 hover:bg-purple-600 dark:hover:bg-purple-500 hover:text-white transition-all flex items-center gap-1.5"
              >
                <Tag size={12} /> Marcadores
              </button>
              <button
                onClick={() => setSelectedTickets([])}
                className="p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-danger)] transition-all"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      <ModernSearchBar
        onSearch={handleSearch}
        loading={loading}
      />

      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-3xl overflow-hidden shadow-sm shadow-slate-200/50">
        <div className="hidden md:block overflow-x-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-[var(--surface-card)]/50 border-b border-[var(--border-default)]">
                <th className="px-4 py-5 w-12">
                  <button
                    onClick={toggleSelectAll}
                    className="p-1 hover:text-[var(--accent-text)] transition-colors"
                  >
                    {selectedTickets.length === filteredTickets.length && filteredTickets.length > 0 ? (
                      <CheckSquare size={16} className="text-[var(--accent-text)]" />
                    ) : (
                      <Square size={16} className="text-slate-300" />
                    )}
                  </button>
                </th>
                <SortableContext
                  items={columns.map((column) => column.id)}
                  strategy={horizontalListSortingStrategy}
                >
                  {columns.map((col) => (
                    <SortableHeader
                      key={col.id}
                      column={col}
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                  ))}
                </SortableContext>
              </tr>
            </thead>
<tbody className="divide-y divide-[var(--border-default)]">
              {loading ? (
                <tr>
                  <td
                    colSpan={columns.length + 1}
                    className="px-6 py-12 text-center"
                  >
                    <div className="flex flex-col items-center gap-4 text-[var(--text-tertiary)]">
                      <Loader2
                        size={32}
                        className="animate-spin text-[var(--accent-text)]"
                      />
                      <p className="text-sm font-bold uppercase tracking-widest text-[10px]">
                        Carregando chamados...
                      </p>
                    </div>
                  </td>
                </tr>
              ) : visibleTickets.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length + 1}
                    className="px-6 py-12 text-center"
                  >
                    <div className="flex flex-col items-center gap-2 text-[var(--text-tertiary)]">
                      <FileText size={48} className="opacity-20" />
                      <p className="text-sm font-bold">
                        Nenhum chamado encontrado com esses filtros
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                visibleTickets.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedTicket(t)}
                    className={cn(
                      "hover:bg-[var(--surface-card)]/80 cursor-pointer transition-colors group",
                      getSLAStatus(t).isOverdue && "bg-[var(--surface-danger)]/30",
                    )}
                  >
                    <td className="px-4 py-5 w-12">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelectTicket(t.id);
                        }}
                        className="p-1 hover:text-[var(--accent-text)] transition-colors"
                      >
                        {selectedTickets.includes(t.id) ? (
                          <CheckSquare size={16} className="text-[var(--accent-text)]" />
                        ) : (
                          <Square size={16} className="text-slate-300" />
                        )}
                      </button>
                    </td>
                    {columns.map((col) => renderCell(col.id, t))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </DndContext>
        </div>

        {/* Lista em cards <md — a tabela com colunas reordenáveis por
            arrasto não é uma boa experiência de toque numa tela estreita. */}
        <div className="md:hidden divide-y divide-[var(--border-default)]">
          {loading ? (
            <div className="flex flex-col items-center gap-4 text-[var(--text-tertiary)] px-6 py-12">
              <Loader2 size={32} className="animate-spin text-[var(--accent-text)]" />
              <p className="text-sm font-bold uppercase tracking-widest text-[10px]">Carregando chamados...</p>
            </div>
          ) : visibleTickets.length === 0 ? (
            <div className="flex flex-col items-center gap-2 text-[var(--text-tertiary)] px-6 py-12">
              <FileText size={48} className="opacity-20" />
              <p className="text-sm font-bold">Nenhum chamado encontrado com esses filtros</p>
            </div>
          ) : (
            visibleTickets.map((t) => {
              const company = companies.find((c) => c.id === t.companyId);
              const assignee = users.find((u) => u.id === t.assigneeId);
              const sla = getSLAStatus(t);
              const priorityLabels = ["Baixa", "Média", "Alta", "Urgente"];
              const currentPriority = priorityLabels.indexOf(t.priority as string) + 1;

              return (
                <div
                  key={t.id}
                  onClick={() => setSelectedTicket(t)}
                  className={cn(
                    "px-5 py-4 active:bg-[var(--surface-card)]/80 transition-colors",
                    sla.isOverdue && "bg-[var(--surface-danger)]/30"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSelectTicket(t.id); }}
                      className="p-1 mt-0.5 shrink-0 text-slate-300"
                    >
                      {selectedTickets.includes(t.id) ? (
                        <CheckSquare size={18} className="text-[var(--accent-text)]" />
                      ) : (
                        <Square size={18} />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] font-semibold text-[var(--accent-text)] bg-[var(--accent)]/10 px-2 py-0.5 rounded shrink-0">
                          #{t.ticketNumber ? String(t.ticketNumber).padStart(4, '0') : t.id.slice(0, 8)}
                        </span>
                        <span
                          className={cn(
                            "px-2.5 py-1 rounded-full text-[9px] font-semibold uppercase tracking-tighter shrink-0",
                            t.status === TicketStatus.NEW
                              ? "bg-[var(--surface-info)] text-[var(--text-info)]"
                              : isInProgressTicketStatus(t.status)
                                ? "bg-[var(--surface-warning)] text-[var(--text-warning)]"
                                : isClosedTicketStatus(t.status)
                                  ? "bg-[var(--surface-success)] text-[var(--text-success)]"
                                  : "bg-[var(--surface-pill)] text-[var(--text-secondary)]"
                          )}
                        >
                          {t.status}
                        </span>
                      </div>
                      <p className="font-bold text-[var(--text-primary)] text-sm italic mt-1.5 truncate">{t.title}</p>
                      <p className="text-[10px] text-[var(--text-tertiary)] font-medium">{company?.name || t.category}</p>
                      <div className="flex items-center justify-between mt-2.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {assignee ? (
                            <>
                              <div className="w-5 h-5 rounded-full bg-[var(--border-default)] flex items-center justify-center text-[8px] font-semibold text-[var(--text-secondary)] shrink-0">
                                {assignee.name.charAt(0)}
                              </div>
                              <span className="text-[11px] font-medium text-[var(--text-secondary)] truncate">{assignee.name}</span>
                            </>
                          ) : (
                            <span className="text-[11px] text-slate-300 italic">Disponível</span>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          {[1, 2, 3, 4].map((star) => (
                            <Star
                              key={star}
                              size={11}
                              className={cn(star <= currentPriority ? "fill-amber-400 text-[var(--text-warning)]" : "text-slate-200")}
                            />
                          ))}
                        </div>
                      </div>
                      {sla.isOverdue && (
                        <p className="text-[9px] font-semibold text-[var(--text-danger)] uppercase tracking-tighter mt-1.5">SLA Vencido</p>
                      )}
                    </div>
                    <ChevronRight size={18} className="text-slate-300 shrink-0 mt-1" />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {!loading && (
          <div className="flex flex-col gap-4 border-t border-[var(--border-default)] px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-bold text-[var(--text-tertiary)]">
              {totalCount === 0
                ? 'Nenhum chamado'
                : `Exibindo ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, totalCount)} de ${totalCount} chamados`}
            </p>

            {totalPages > 1 && (
              <div className="flex items-center gap-1.5" aria-label="Paginação de chamados">
                <button
                  type="button"
                  title="Página anterior"
                  aria-label="Página anterior"
                  disabled={currentPage === 1}
                  onClick={() => handlePagination(currentPage - 1)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-default)] text-[var(--text-tertiary)] transition-colors hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/10 hover:text-[var(--accent-text)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft size={16} />
                </button>

                {paginationPages.map((pageNumber) => (
                  <button
                    key={pageNumber}
                    type="button"
                    onClick={() => handlePagination(pageNumber)}
                    aria-label={`Ir para a página ${pageNumber}`}
                    aria-current={currentPage === pageNumber ? 'page' : undefined}
                    className={cn(
                      "h-9 min-w-9 rounded-lg px-2 text-xs font-black transition-colors",
                      currentPage === pageNumber
                        ? "bg-[var(--accent)] text-white shadow-md shadow-indigo-200"
                        : "border border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/10 hover:text-[var(--accent-text)]"
                    )}
                  >
                    {pageNumber}
                  </button>
                ))}

                <button
                  type="button"
                  title="Próxima página"
                  aria-label="Próxima página"
                  disabled={currentPage === totalPages}
                  onClick={() => handlePagination(currentPage + 1)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-default)] text-[var(--text-tertiary)] transition-colors hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/10 hover:text-[var(--accent-text)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedTicket && (
          <TicketDetailModal
            ticket={selectedTicket}
            onClose={() => {
              setSelectedTicket(null);
            }}
          />
        )}
      </AnimatePresence>

      <ConfirmDialog
        isOpen={!!ticketToDelete}
        onClose={() => {
          if (!isDeletingTicket) setTicketToDelete(null);
        }}
        onConfirm={handleDeleteTicket}
        title="Excluir chamado"
        description={`Tem certeza que deseja excluir o chamado #${ticketToDelete?.ticketNumber ? String(ticketToDelete.ticketNumber).padStart(4, '0') : ticketToDelete?.id.slice(0, 8)}? Essa ação removerá o registro do banco.`}
        confirmLabel={isDeletingTicket ? "Excluindo..." : "Excluir"}
        cancelLabel="Cancelar"
        variant="danger"
      />

      {/* Transfer Modal */}
      <AnimatePresence>
        {isTransferModalOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setIsTransferModalOpen(false)}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[var(--surface-card)] w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-[var(--border-default)]">
                <h3 className="text-xl font-black text-[var(--text-primary)]">Transferir Chamados</h3>
                <p className="text-sm text-[var(--text-tertiary)] mt-1">{selectedTickets.length} chamado(s) selecionado(s)</p>
              </div>
              
              <div className="p-8 space-y-4">
                <div>
                  <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] mb-2 block">Equipe</label>
                  <StyledSelect
                    value={selectedTeamId}
                    onChange={(e) => {
                      setSelectedTeamId(e.target.value);
                      setSelectedAssigneeId('');
                    }}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-bold outline-none"
                  >
                    <option value="">Selecione uma equipe</option>
                    {teams.map(team => (
                      <option key={team.id} value={team.id}>{team.name}</option>
                    ))}
                  </StyledSelect>
                </div>
                
                {selectedTeamId && (
                  <div>
                    <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] mb-2 block">Analista</label>
                    <StyledSelect
                      value={selectedAssigneeId}
                      onChange={(e) => setSelectedAssigneeId(e.target.value)}
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-bold outline-none"
                    >
                      <option value="">Selecione um analista</option>
                      {teamMembers.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </StyledSelect>
                  </div>
                )}
              </div>
              
              <div className="p-8 bg-[var(--surface-card)]/50 flex gap-4">
                <button
                  onClick={() => setIsTransferModalOpen(false)}
                  className="flex-1 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] rounded-2xl transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleBulkTransfer}
                  disabled={!selectedAssigneeId}
                  className="flex-1 py-3 bg-[var(--accent)] text-white text-[10px] font-semibold uppercase tracking-widest rounded-2xl hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-all"
                >
                  Transferir
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Status Modal */}
      <AnimatePresence>
        {isStatusModalOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setIsStatusModalOpen(false)}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[var(--surface-card)] w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-[var(--border-default)]">
                <h3 className="text-xl font-black text-[var(--text-primary)]">Alterar Status</h3>
                <p className="text-sm text-[var(--text-tertiary)] mt-1">{selectedTickets.length} chamado(s) selecionado(s)</p>
              </div>
              
              <div className="p-8 grid grid-cols-2 gap-3">
                {[
                  { value: TicketStatus.NEW, label: 'Novo', color: 'bg-[var(--surface-info)] text-[var(--text-info)]' },
                  { value: TicketStatus.IN_PROGRESS, label: 'Em Atendimento', color: 'bg-[var(--surface-warning)] text-[var(--text-warning)]' },
                  { value: 'Aguardando Cliente', label: 'Aguardando Cliente', color: 'bg-[var(--surface-pill)] text-[var(--text-secondary)]' },
                  { value: TicketStatus.CLOSED, label: 'Concluído/Fechado', color: 'bg-[var(--surface-success)] text-[var(--text-success)]' },
                ].map(status => (
                  <button
                    key={status.value}
                    onClick={() => {
                      handleBulkStatusChange(status.value);
                      setIsStatusModalOpen(false);
                    }}
                    className={cn(
                      "py-3 rounded-xl text-[10px] font-semibold uppercase tracking-widest border transition-all",
                      status.color
                    )}
                  >
                    {status.label}
                  </button>
                ))}
              </div>
              
              <div className="p-8 bg-[var(--surface-card)]/50">
                <button
                  onClick={() => setIsStatusModalOpen(false)}
                  className="w-full py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] rounded-2xl transition-all"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Merge Modal */}
      <AnimatePresence>
        {isMergeModalOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setIsMergeModalOpen(false)}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[var(--surface-card)] w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-[var(--border-default)]">
                <h3 className="text-xl font-black text-[var(--text-primary)]">Mesclar Chamados</h3>
                <p className="text-sm text-[var(--text-tertiary)] mt-1">Selecione o chamado principal</p>
              </div>
              
              <div className="p-8 max-h-80 overflow-y-auto space-y-2">
                {selectedTickets.map(id => {
                  const ticket = filteredTickets.find(t => t.id === id);
                  return ticket ? (
                    <button
                      key={id}
                      onClick={() => setSelectedMasterTicketId(id)}
                      className={cn(
                        "w-full p-4 rounded-xl border text-left transition-all",
                        selectedMasterTicketId === id
                          ? "border-[var(--text-success)]/30 bg-[var(--surface-success)]"
                          : "border-[var(--border-default)] hover:bg-[var(--surface-card)]"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <div className={cn(
                          "w-4 h-4 rounded-full border-2",
                          selectedMasterTicketId === id ? "border-[var(--text-success)] bg-[var(--text-success)]" : "border-[var(--border-default)]"
                        )} />
                        <span className="font-bold text-[var(--text-primary)] text-sm">#{ticket.ticketNumber || ticket.id.slice(0, 8)}</span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mt-1 truncate">{ticket.title}</p>
                    </button>
                  ) : null;
                })}
              </div>
              
              <div className="p-8 bg-[var(--surface-card)]/50 flex gap-4">
                <button
                  onClick={() => setIsMergeModalOpen(false)}
                  className="flex-1 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] rounded-2xl transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleMergeTickets}
                  disabled={!selectedMasterTicketId}
                  className="flex-1 py-3 bg-[var(--text-success)] text-white text-[10px] font-semibold uppercase tracking-widest rounded-2xl hover:bg-emerald-700 disabled:opacity-50 transition-all"
                >
                  Mesclar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Title Modal */}
      <AnimatePresence>
        {isTitleModalOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setIsTitleModalOpen(false)}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[var(--surface-card)] w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-[var(--border-default)]">
                <h3 className="text-xl font-black text-[var(--text-primary)]">Alterar Título</h3>
                <p className="text-sm text-[var(--text-tertiary)] mt-1">{selectedTickets.length} chamado(s) selecionado(s)</p>
              </div>
              
              <div className="p-8">
                <input
                  type="text"
                  value={newBulkTitle}
                  onChange={(e) => setNewBulkTitle(e.target.value)}
                  placeholder="Novo título..."
                  className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-bold outline-none"
                />
              </div>
              
              <div className="p-8 bg-[var(--surface-card)]/50 flex gap-4">
                <button
                  onClick={() => setIsTitleModalOpen(false)}
                  className="flex-1 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] rounded-2xl transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleBulkTitleChange}
                  disabled={!newBulkTitle.trim()}
                  className="flex-1 py-3 bg-[var(--text-info)] text-white text-[10px] font-semibold uppercase tracking-widest rounded-2xl hover:bg-blue-700 disabled:opacity-50 transition-all"
                >
                  Alterar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Priority Modal */}
      <AnimatePresence>
        {isPriorityModalOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setIsPriorityModalOpen(false)}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[var(--surface-card)] w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-[var(--border-default)]">
                <h3 className="text-xl font-black text-[var(--text-primary)]">Alterar Prioridade</h3>
                <p className="text-sm text-[var(--text-tertiary)] mt-1">{selectedTickets.length} chamado(s) selecionado(s)</p>
              </div>
              
              <div className="p-8 grid grid-cols-2 gap-3">
                {["Baixa", "Média", "Alta", "Urgente"].map(priority => (
                  <button
                    key={priority}
                    onClick={() => handleBulkPriorityChange(priority)}
                    className={cn(
                      "py-3 rounded-xl text-[10px] font-semibold uppercase tracking-widest border transition-all",
                      priority === "Baixa" ? "bg-[var(--surface-pill)] text-[var(--text-secondary)]" :
                      priority === "Média" ? "bg-[var(--surface-info)] text-[var(--text-info)]" :
                      priority === "Alta" ? "bg-[var(--surface-warning)] text-[var(--text-warning)]" :
                      "bg-[var(--surface-danger)] text-[var(--text-danger)]"
                    )}
                  >
                    {priority}
                  </button>
                ))}
              </div>
              
              <div className="p-8 bg-[var(--surface-card)]/50">
                <button
                  onClick={() => setIsPriorityModalOpen(false)}
                  className="w-full py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] rounded-2xl transition-all"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Tags Modal */}
      <AnimatePresence>
        {isTagsModalOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setIsTagsModalOpen(false)}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[var(--surface-card)] w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-[var(--border-default)]">
                <h3 className="text-xl font-black text-[var(--text-primary)]">Adicionar Marcadores</h3>
                <p className="text-sm text-[var(--text-tertiary)] mt-1">{selectedTickets.length} chamado(s) selecionado(s)</p>
              </div>
              
              <div className="p-8 max-h-60 overflow-y-auto space-y-2">
                {tags.map(tag => (
                  <button
                    key={tag.id}
                    onClick={() => {
                      setSelectedTags([tag.id]);
                      handleBulkTagsChange();
                    }}
                    className="w-full p-3 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl text-left hover:bg-[var(--surface-pill)] transition-all"
                  >
                    <span className="text-sm font-bold text-[var(--text-secondary)]">{tag.label}</span>
                  </button>
                ))}
              </div>
              
              <div className="p-8 bg-[var(--surface-card)]/50">
                <button
                  onClick={() => setIsTagsModalOpen(false)}
                  className="w-full py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] rounded-2xl transition-all"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
