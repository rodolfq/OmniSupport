'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Ticket, TicketStatus, Permission, UserRole, MockDB } from '@/lib/mock-db';
import { fetchAllTickets } from '@/lib/tickets';
import { supabase } from '@/lib/supabase';
import { Search, Filter, MoreHorizontal, FileText, ChevronRight, Star, ArrowUpDown, GripVertical, Loader2 } from 'lucide-react';
import { cn, safeJsonStringify } from '@/lib/utils';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import { FilterBar } from '@/components/filter-bar';
import { TicketDetailModal } from '@/components/ticket-detail-modal';
import { useApp } from '@/app/app-context';
import { 
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface Column {
  id: string;
  label: string;
  sortable?: boolean;
}

function SortableHeader({ 
  column, 
  sortConfig, 
  onSort 
}: { 
  column: Column; 
  sortConfig: { key: string; direction: 'asc' | 'desc' } | null;
  onSort: (key: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: column.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 0,
    position: 'relative' as const,
  };

  return (
    <th 
      ref={setNodeRef} 
      style={style}
      className={cn(
        "px-6 py-5 text-[10px] font-black uppercase text-slate-400 tracking-widest transition-colors",
        column.sortable && "cursor-pointer hover:text-indigo-600",
        isDragging && "bg-white shadow-lg opacity-80"
      )}
    >
      <div className="flex items-center gap-2">
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 -ml-2 text-slate-300 hover:text-slate-400">
          <GripVertical size={10} />
        </div>
        <div className="flex-1 flex items-center gap-2" onClick={() => column.sortable && onSort(column.id)}>
          {column.label}
          {column.sortable && (
            <ArrowUpDown 
              size={12} 
              className={cn(
                "transition-colors",
                sortConfig?.key === column.id ? "text-indigo-600" : "text-slate-200"
              )} 
            />
          )}
        </div>
      </div>
    </th>
  );
}

export default function TicketsPage() {
  const { currentUser, hasPermission, refreshTrigger } = useApp();
  const [allTickets, setAllTickets] = useState<Ticket[]>([]);
  const [filteredTickets, setFilteredTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [visibleCount, setVisibleCount] = useState(25);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  
  const [columns, setColumns] = useState<Column[]>([
    { id: 'id', label: 'ID', sortable: true },
    { id: 'title', label: 'Assunto', sortable: true },
    { id: 'company', label: 'Cliente', sortable: true },
    { id: 'assignee', label: 'Responsável', sortable: true },
    { id: 'status', label: 'Status', sortable: true },
    { id: 'priority', label: 'Prioridade', sortable: true },
    { id: 'sla', label: 'Vencimento', sortable: true },
    { id: 'action', label: 'Ação', sortable: false },
  ]);

  const [loading, setLoading] = useState(true);
  const [priorities, setPriorities] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const loadTickets = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      // Fetch config and data
      const [pRes, cRes, uRes] = await Promise.all([
        supabase.from('config_priorities').select('*'),
        supabase.from('companies').select('*'),
        supabase.from('profiles').select('*')
      ]);

      if (pRes.data) setPriorities(pRes.data);
      if (cRes.data) setCompanies(cRes.data);
      if (uRes.data) setUsers(uRes.data);

      let tickets = await fetchAllTickets();

      // Update selected ticket if it exists to reflect latest changes from DB
      if (selectedTicket) {
        const latest = tickets.find(t => t.id === selectedTicket.id);
        if (latest && safeJsonStringify(latest) !== safeJsonStringify(selectedTicket)) {
          setSelectedTicket(latest);
        }
      }
      
      // Role based filtering
      if (currentUser.role === UserRole.CUSTOMER) {
        // Customers only see tickets from their company
        tickets = tickets.filter(t => t.companyId === currentUser.companyId);
        
        // If not marked to view all company tickets, filter by their own tickets or where they are collaborators
        if (!currentUser.viewAllCompanyTickets) {
          tickets = tickets.filter(t => t.customerId === currentUser.id || t.employeeIds?.includes(currentUser.id));
        }
      } else {
        // Platform team filtering
        const canViewOutsideQueue = hasPermission(Permission.OUTSIDE_QUEUE_VIEW) || currentUser.role === UserRole.ADMIN;
        const hasFullRead = hasPermission(Permission.TICKETS_READ);
        const hasInternalView = hasPermission(Permission.INTERNAL_TICKETS_VIEW);

        // Se marcado para ver apenas internos, remove chamados com empresa vinculada
        if (currentUser.viewAllCompanyTickets) {
          tickets = tickets.filter(t => !t.companyId);
        }

        if (!canViewOutsideQueue) {
          tickets = tickets.filter(t => 
            !t.assigneeId || 
            t.assigneeId === currentUser.id || 
            t.employeeIds?.includes(currentUser.id)
          );
        }

        // If they don't have full read but have internal view, only show tickets with internal tickets they can access
        if (!hasFullRead && hasInternalView) {
          const internalTickets = MockDB.getInternalTickets();
          const ticketsWithInternal = new Set(internalTickets.map(it => it.parentTicketId));
          tickets = tickets.filter(t => ticketsWithInternal.has(t.id));
        }
      }
      
      setAllTickets(tickets);
      setFilteredTickets(tickets);
    } catch (error) {
      console.error("Error loading tickets:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTickets();
  }, [currentUser, refreshTrigger]);

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedTickets = useMemo(() => {
    if (!sortConfig) return filteredTickets;

    return [...filteredTickets].sort((a, b) => {
      let aValue: any = '';
      let bValue: any = '';

      switch (sortConfig.key) {
        case 'id':
          aValue = a.ticketNumber || 0;
          bValue = b.ticketNumber || 0;
          break;
        case 'title':
          aValue = a.title;
          bValue = b.title;
          break;
        case 'company':
          aValue = companies.find(c => c.id === a.companyId)?.name || '';
          bValue = companies.find(c => c.id === b.companyId)?.name || '';
          break;
        case 'assignee':
          aValue = users.find(u => u.id === a.assigneeId)?.name || '';
          bValue = users.find(u => u.id === b.assigneeId)?.name || '';
          break;
        case 'status':
          aValue = a.status;
          bValue = b.status;
          break;
        case 'priority':
          const priorityOrder = ['Baixa', 'Média', 'Alta', 'Urgente'];
          aValue = priorityOrder.indexOf(a.priority as string);
          bValue = priorityOrder.indexOf(b.priority as string);
          break;
        case 'sla':
          const slaA = MockDB.calculateSLA(a.createdAt, a.priority as string) || '';
          const slaB = MockDB.calculateSLA(b.createdAt, b.priority as string) || '';
          aValue = slaA;
          bValue = slaB;
          break;
      }

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredTickets, sortConfig, companies, users]);

  const visibleTickets = useMemo(() => {
    return sortedTickets.slice(0, visibleCount);
  }, [sortedTickets, visibleCount]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const getSLAStatus = (ticket: Ticket) => {
    if (ticket.status === TicketStatus.CLOSED) return { label: '---', color: 'text-slate-400', isOverdue: false };
    
    const config = priorities.find(p => p.label === ticket.priority);
    if (!config || !config.sla_hours) return { label: '---', color: 'text-slate-400', isOverdue: false };

    const createdAt = new Date(ticket.createdAt);
    const limit = new Date(createdAt.getTime() + config.sla_hours * 60 * 60 * 1000);
    const now = new Date();
    const isOverdue = now > limit;
    
    const diff = limit.getTime() - now.getTime();
    const isNear = diff > 0 && diff < 4 * 60 * 60 * 1000;
    
    return {
      label: limit.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
      color: isOverdue ? 'text-red-600 font-black' : isNear ? 'text-orange-600 font-bold' : 'text-slate-500 font-medium',
      isOverdue
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
      case 'id':
        return (
          <td key="id" className="px-6 py-5">
            <span className="font-mono text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded">
              #{ticket.ticketNumber || ticket.id.slice(0, 8)}
            </span>
          </td>
        );
      case 'title':
        return (
          <td key="title" className="px-6 py-5">
            <div className="flex flex-col">
              <span className="font-bold text-slate-800 text-sm italic">{ticket.title}</span>
              <span className="text-[10px] text-slate-400 font-medium">{ticket.category}</span>
            </div>
          </td>
        );
      case 'company':
        const company = companies.find(c => c.id === ticket.companyId);
        return (
          <td key="company" className="px-6 py-5">
            <span className="text-sm font-bold text-slate-600">
              {company?.name || '---'}
            </span>
          </td>
        );
      case 'assignee':
        const assignee = users.find(u => u.id === ticket.assigneeId);
        return (
          <td key="assignee" className="px-6 py-5">
            <div className="flex items-center gap-2">
              {assignee ? (
                <>
                  <div className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-[8px] font-black text-slate-600">
                    {assignee.name.charAt(0)}
                  </div>
                  <span className="text-sm font-medium text-slate-600">{assignee.name}</span>
                </>
              ) : (
                <span className="text-xs text-slate-300 italic">Dísponivel</span>
              )}
            </div>
          </td>
        );
      case 'status':
        return (
          <td key="status" className="px-6 py-5">
            <span className={cn(
              "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter",
              ticket.status === TicketStatus.NEW ? "bg-blue-100 text-blue-700" :
              ticket.status === TicketStatus.IN_PROGRESS ? "bg-amber-100 text-amber-700" :
              ticket.status === TicketStatus.CLOSED ? "bg-emerald-100 text-emerald-700" :
              "bg-slate-100 text-slate-600"
            )}>
              {ticket.status}
            </span>
          </td>
        );
      case 'priority':
        return (
          <td key="priority" className="px-6 py-5">
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4].map((star) => {
                const priorityLabels = ['Baixa', 'Média', 'Alta', 'Urgente'];
                const currentPriority = priorityLabels.indexOf(ticket.priority as string) + 1;
                return (
                  <Star 
                    key={star} 
                    size={12} 
                    className={cn(
                      star <= currentPriority ? "fill-amber-400 text-amber-400" : "text-slate-200"
                    )} 
                  />
                );
              })}
            </div>
          </td>
        );
      case 'sla':
        const sla = getSLAStatus(ticket);
        return (
          <td key="sla" className="px-6 py-5">
            <div className="flex flex-col">
              <span className={cn("text-[10px] uppercase", sla.color)}>{sla.label}</span>
              {sla.isOverdue && ticket.status !== TicketStatus.CLOSED && (
                <span className="text-[8px] font-black text-red-500 uppercase tracking-tighter">SLA Vencido</span>
              )}
            </div>
          </td>
        );
      case 'action':
        return (
          <td key="action" className="px-6 py-5 text-right">
            <button className="p-2 text-slate-300 group-hover:text-indigo-600 transition-colors">
              <ChevronRight size={18} />
            </button>
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
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">Chamados</h2>
          <p className="text-slate-500 font-medium">Gerenciamento completo de solicitações</p>
        </div>
      </div>

      <FilterBar 
        originalTickets={allTickets} 
        onFilterChange={(filtered) => {
          setFilteredTickets(filtered);
          setVisibleCount(25);
        }} 
      />

      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm shadow-slate-200/50 overflow-x-auto">
        <DndContext 
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <SortableContext 
                  items={columns.map(c => c.id)}
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
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr>
                  <td colSpan={columns.length} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-4 text-slate-400">
                      <Loader2 size={32} className="animate-spin text-indigo-600" />
                      <p className="text-sm font-bold uppercase tracking-widest text-[10px]">Carregando chamados...</p>
                    </div>
                  </td>
                </tr>
              ) : visibleTickets.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-6 py-12 text-center">
                     <div className="flex flex-col items-center gap-2 text-slate-400">
                        <FileText size={48} className="opacity-20" />
                        <p className="text-sm font-bold">Nenhum chamado encontrado com esses filtros</p>
                     </div>
                  </td>
                </tr>
              ) : (
                visibleTickets.map((t) => (
                  <tr 
                    key={t.id} 
                    onClick={() => setSelectedTicket(t)}
                    className={cn(
                      "hover:bg-slate-50/80 cursor-pointer transition-colors group",
                      getSLAStatus(t).isOverdue && t.status !== TicketStatus.CLOSED && "bg-red-50/30"
                    )}
                  >
                    {columns.map(col => renderCell(col.id, t))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </DndContext>

        
        {filteredTickets.length > visibleCount && (
          <div className="p-6 text-center border-t border-slate-100">
            <button 
              onClick={() => setVisibleCount(prev => prev + 25)}
              className="text-xs font-black uppercase tracking-widest text-indigo-600 hover:text-indigo-700 transition-colors"
            >
              Carregar mais chamados ({filteredTickets.length - visibleCount} restantes)
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedTicket && (
          <TicketDetailModal 
            ticket={selectedTicket} 
            onClose={() => {
              setSelectedTicket(null);
              loadTickets();
            }} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}
