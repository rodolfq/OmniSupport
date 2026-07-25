'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Trash2, ListChecks, CircleCheck, ChevronDown, ChevronRight, GripVertical, Lock } from 'lucide-react';
import { StatusConfig, UserRole } from '@/lib/types';
import { ConfigService } from '@/lib/services/config-service';
import { STATUS_COLOR_PALETTE, findStatusColor } from '@/lib/status-colors';
import { useApp } from '@/app/app-context';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type Scope = 'ticket' | 'internal_ticket';

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'ticket', label: 'Chamados' },
  { value: 'internal_ticket', label: 'Tickets Internos' },
];

export function StatusManager() {
  const { currentUser } = useApp();
  const isAdmin = currentUser?.role === UserRole.ADMIN;

  const [scope, setScope] = useState<Scope>('ticket');
  const [statuses, setStatuses] = useState<StatusConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null);

  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState(STATUS_COLOR_PALETTE[0]);
  const [newIsClosed, setNewIsClosed] = useState(false);
  const [newSubLabel, setNewSubLabel] = useState('');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await ConfigService.getStatuses(scope);
        if (!cancelled) setStatuses(data);
      } catch {
        toast.error('Erro ao carregar status.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [scope]);

  const topLevel = statuses.filter(s => !s.parentStatusId).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const childrenOf = (parentId: string) => statuses.filter(s => s.parentStatusId === parentId);

  const resetNewForm = () => {
    setNewLabel('');
    setNewColor(STATUS_COLOR_PALETTE[0]);
    setNewIsClosed(false);
  };

  const handleAddStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      toast.error('Apenas administradores podem cadastrar status.');
      return;
    }
    if (!newLabel.trim()) return;

    try {
      const created = await ConfigService.saveStatus({
        label: newLabel.trim(),
        color: `${newColor.bg} ${newColor.text}`,
        scope,
        isClosed: newIsClosed,
        sortOrder: topLevel.length,
      });
      setStatuses(prev => [...prev, created]);
      resetNewForm();
      toast.success('Status cadastrado!');
    } catch {
      toast.error('Erro ao cadastrar status.');
    }
  };

  const handleAddSubStatus = async (parentId: string) => {
    if (!isAdmin || !newSubLabel.trim()) return;
    try {
      const created = await ConfigService.saveStatus({
        label: newSubLabel.trim(),
        color: `${STATUS_COLOR_PALETTE[0].bg} ${STATUS_COLOR_PALETTE[0].text}`,
        scope,
        isClosed: false,
        sortOrder: childrenOf(parentId).length,
        parentStatusId: parentId,
      });
      setStatuses(prev => [...prev, created]);
      setNewSubLabel('');
      setAddingSubFor(null);
      setExpanded(prev => new Set(prev).add(parentId));
      toast.success('Sub-status cadastrado!');
    } catch {
      toast.error('Erro ao cadastrar sub-status.');
    }
  };

  const handleToggleClosed = async (status: StatusConfig) => {
    if (!isAdmin || status.label === 'Concluído') return;
    try {
      const updated = await ConfigService.saveStatus({ ...status, scope, isClosed: !status.isClosed });
      setStatuses(prev => prev.map(s => s.id === status.id ? updated : s));
    } catch {
      toast.error('Erro ao atualizar status.');
    }
  };

  const handleDelete = async (status: StatusConfig) => {
    if (!isAdmin) return;
    if (status.label === 'Concluído') {
      toast.error('O status "Concluído" não pode ser excluído.');
      return;
    }
    const hasChildren = childrenOf(status.id).length > 0;
    if (hasChildren && !confirm(`"${status.label}" tem sub-status vinculados — excluir também vai remover todos eles. Continuar?`)) {
      return;
    }
    try {
      await ConfigService.deleteStatus(status.id);
      setStatuses(prev => prev.filter(s => s.id !== status.id && s.parentStatusId !== status.id));
      toast.success('Status removido.');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao remover status.');
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = topLevel.findIndex(s => s.id === active.id);
    const newIndex = topLevel.findIndex(s => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(topLevel, oldIndex, newIndex);
    const childless = statuses.filter(s => s.parentStatusId);
    setStatuses([...reordered, ...childless]);

    try {
      await ConfigService.reorderStatuses(reordered.map((s, idx) => ({ id: s.id, sortOrder: idx })));
    } catch {
      toast.error('Erro ao salvar nova ordem.');
    }
  };

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-8 shadow-sm space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-2">
            <ListChecks className="text-[var(--accent-text)]" size={24} /> Gestão de Status
          </h3>
          <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">
            Cadastre os status que seu time usa em Chamados e Tickets Internos
          </p>
        </div>

        <div className="flex bg-[var(--surface-pill)] p-1 rounded-2xl gap-1 self-start">
          {SCOPES.map((s) => (
            <button
              key={s.value}
              onClick={() => setScope(s.value)}
              className={cn(
                "px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                scope === s.value ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-tertiary)] hover:bg-white/50 dark:hover:bg-[var(--surface-card)]"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {isAdmin && (
        <form onSubmit={handleAddStatus} className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-3xl p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Nome do Status</label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Ex: Em Homologação, Bloqueado..."
                className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all placeholder:text-slate-300"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Cor</label>
              <div className="flex flex-wrap gap-2">
                {STATUS_COLOR_PALETTE.map((color) => (
                  <button
                    key={color.key}
                    type="button"
                    onClick={() => setNewColor(color)}
                    className={cn(
                      "w-8 h-8 rounded-xl transition-all flex items-center justify-center",
                      color.bg,
                      newColor.key === color.key ? "ring-2 ring-[var(--accent)] ring-offset-2 scale-110" : "hover:scale-105"
                    )}
                    title={color.label}
                  >
                    {newColor.key === color.key && <div className={cn("w-1.5 h-1.5 rounded-full", color.dot)} />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-bold text-[var(--text-secondary)] cursor-pointer">
            <input type="checkbox" checked={newIsClosed} onChange={(e) => setNewIsClosed(e.target.checked)} className="rounded border-[var(--border-default)] text-[var(--accent-text)] focus:ring-[var(--accent)]" />
            Este status finaliza o chamado
          </label>

          <button
            type="submit"
            className="w-full py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-xl shadow-slate-200"
          >
            <Plus size={16} /> Cadastrar Status
          </button>
        </form>
      )}

      {loading ? (
        <div className="py-12 text-center">
          <p className="text-[var(--text-tertiary)] text-xs font-bold uppercase tracking-widest italic">Carregando...</p>
        </div>
      ) : topLevel.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-[var(--text-tertiary)] text-xs font-bold uppercase tracking-widest italic">Nenhum status cadastrado para este escopo.</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={topLevel.map(s => s.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {topLevel.map((status) => (
                <StatusRow
                  key={status.id}
                  status={status}
                  color={findStatusColor(status.color)}
                  isAdmin={isAdmin}
                  children={childrenOf(status.id)}
                  expanded={expanded.has(status.id)}
                  onToggleExpanded={() => toggleExpanded(status.id)}
                  onToggleClosed={() => handleToggleClosed(status)}
                  onDelete={() => handleDelete(status)}
                  onDeleteChild={(child) => handleDelete(child)}
                  addingSub={addingSubFor === status.id}
                  onStartAddSub={() => { setAddingSubFor(status.id); setNewSubLabel(''); }}
                  newSubLabel={newSubLabel}
                  onChangeSubLabel={setNewSubLabel}
                  onConfirmAddSub={() => handleAddSubStatus(status.id)}
                  onCancelAddSub={() => setAddingSubFor(null)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <div className="p-6 bg-[var(--accent)]/10 border border-[var(--accent)]/20 rounded-3xl flex gap-4">
        <div className="w-12 h-12 bg-[var(--accent)] rounded-2xl flex items-center justify-center text-white shrink-0 shadow-lg shadow-indigo-100">
          <CircleCheck size={24} />
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-black text-indigo-900 dark:text-[var(--accent-soft-text)] uppercase tracking-tight">Como funciona</h4>
          <p className="text-[10px] text-[var(--accent-text)] font-medium leading-relaxed uppercase tracking-widest">
            "Concluído" é fixo e sempre finaliza o chamado. Outros status também podem finalizar — marque "finaliza o chamado" ao cadastrar.
            Sub-status são só uma etiqueta informativa dentro do status pai (não mudam coluna do kanban nem SLA). Arraste pela alça pra reordenar.
          </p>
        </div>
      </div>
    </div>
  );
}

function StatusRow({
  status, color, isAdmin, children, expanded, onToggleExpanded, onToggleClosed, onDelete, onDeleteChild,
  addingSub, onStartAddSub, newSubLabel, onChangeSubLabel, onConfirmAddSub, onCancelAddSub,
}: {
  status: StatusConfig;
  color: ReturnType<typeof findStatusColor>;
  isAdmin: boolean;
  children: StatusConfig[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleClosed: () => void;
  onDelete: () => void;
  onDeleteChild: (child: StatusConfig) => void;
  addingSub: boolean;
  onStartAddSub: () => void;
  newSubLabel: string;
  onChangeSubLabel: (v: string) => void;
  onConfirmAddSub: () => void;
  onCancelAddSub: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: status.id });
  const isProtected = status.label === 'Concluído';

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] transition-all",
        isDragging && "opacity-60 shadow-lg"
      )}
    >
      <div className="flex items-center gap-3 p-3">
        {isAdmin && (
          <button type="button" {...attributes} {...listeners} className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] cursor-grab active:cursor-grabbing shrink-0">
            <GripVertical size={16} />
          </button>
        )}

        <button
          type="button"
          onClick={onToggleExpanded}
          className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] shrink-0"
          title={children.length > 0 ? (expanded ? 'Recolher sub-status' : 'Ver sub-status') : 'Sem sub-status'}
        >
          {children.length > 0 ? (expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : <span className="w-4 h-4 inline-block" />}
        </button>

        <span className={cn("px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-tight flex items-center gap-2", color.bg, color.text)}>
          <span className={cn("w-1.5 h-1.5 rounded-full", color.dot)} />
          {status.label}
          {isProtected && <Lock size={11} className="opacity-70" />}
        </span>

        {children.length > 0 && (
          <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">
            {children.length} sub-status
          </span>
        )}

        <div className="ml-auto flex items-center gap-4">
          <label className={cn("flex items-center gap-2 text-[10px] font-black uppercase tracking-widest", isProtected ? "text-[var(--text-tertiary)]" : "text-[var(--text-secondary)] cursor-pointer")}>
            <input
              type="checkbox"
              checked={!!status.isClosed}
              disabled={!isAdmin || isProtected}
              onChange={onToggleClosed}
              className="rounded border-[var(--border-default)] text-[var(--accent-text)] focus:ring-[var(--accent)] disabled:opacity-50"
            />
            Finaliza
          </label>

          {isAdmin && (
            <button
              type="button"
              onClick={onStartAddSub}
              className="text-[10px] font-black uppercase tracking-widest text-[var(--accent-text)] hover:underline"
            >
              + Sub-status
            </button>
          )}

          {isAdmin && !isProtected && (
            <button onClick={onDelete} className="p-1.5 hover:bg-[var(--surface-danger)] rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-danger)] transition-all">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {(expanded || addingSub) && (
        <div className="pl-12 pr-3 pb-3 space-y-2">
          {children.map((child) => (
            <div key={child.id} className="flex items-center gap-2 py-1.5">
              <span className="w-1 h-1 rounded-full bg-[var(--text-tertiary)]" />
              <span className="text-xs font-bold text-[var(--text-secondary)]">{child.label}</span>
              {isAdmin && (
                <button onClick={() => onDeleteChild(child)} className="ml-auto p-1 text-[var(--text-tertiary)] hover:text-[var(--text-danger)] transition-all">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}

          {addingSub && (
            <div className="flex items-center gap-2 pt-1">
              <input
                autoFocus
                type="text"
                value={newSubLabel}
                onChange={(e) => onChangeSubLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onConfirmAddSub(); } if (e.key === 'Escape') onCancelAddSub(); }}
                placeholder="Nome do sub-status..."
                className="flex-1 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-3 py-1.5 text-xs font-bold focus:ring-2 focus:ring-[var(--accent)]/20 outline-none"
              />
              <button onClick={onConfirmAddSub} className="px-3 py-1.5 bg-[var(--accent)] text-white rounded-xl text-[10px] font-black uppercase">Salvar</button>
              <button onClick={onCancelAddSub} className="px-3 py-1.5 text-[10px] font-black uppercase text-[var(--text-tertiary)]">Cancelar</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
