'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Tag, ChevronDown, X, Check, Search, FolderTree } from 'lucide-react';
import { TagConfig, UserRole } from '@/lib/types';
import { ConfigService } from '@/lib/services/config-service';
import { useApp } from '@/app/app-context';
import { cn, normalizeString } from '@/lib/utils';
import { toast } from 'sonner';
import { ConfirmModal } from '@/components/confirm-modal';

const TAG_COLORS = [
  { bg: 'bg-slate-100 dark:bg-[var(--surface-pill)]', text: 'text-slate-700 dark:text-[var(--text-secondary)]', label: 'Cinza' },
  { bg: 'bg-indigo-100 dark:bg-[var(--accent)]/20', text: 'text-indigo-700 dark:text-[var(--accent-text)]', label: 'Índigo' },
  { bg: 'bg-emerald-100 dark:bg-[var(--surface-success)]', text: 'text-emerald-700 dark:text-[var(--text-success)]', label: 'Esmeralda' },
  { bg: 'bg-amber-100 dark:bg-[var(--surface-warning)]', text: 'text-amber-700 dark:text-[var(--text-warning)]', label: 'Âmbar' },
  { bg: 'bg-rose-100 dark:bg-[var(--surface-danger)]', text: 'text-rose-700 dark:text-[var(--text-danger)]', label: 'Rosa' },
  { bg: 'bg-cyan-100 dark:bg-cyan-500/20', text: 'text-cyan-700 dark:text-cyan-300', label: 'Ciano' },
  { bg: 'bg-violet-100 dark:bg-violet-500/20', text: 'text-violet-700 dark:text-violet-300', label: 'Violeta' },
  { bg: 'bg-blue-100 dark:bg-blue-500/20', text: 'text-blue-700 dark:text-blue-300', label: 'Azul' },
  { bg: 'bg-red-100 dark:bg-red-500/20', text: 'text-red-700 dark:text-red-300', label: 'Vermelho' },
  { bg: 'bg-orange-100 dark:bg-orange-500/20', text: 'text-orange-700 dark:text-orange-300', label: 'Laranja' },
  { bg: 'bg-purple-100 dark:bg-purple-500/20', text: 'text-purple-700 dark:text-purple-300', label: 'Roxo' },
  { bg: 'bg-teal-100 dark:bg-teal-500/20', text: 'text-teal-700 dark:text-teal-300', label: 'Verde-água' },
  { bg: 'bg-lime-100 dark:bg-lime-500/20', text: 'text-lime-700 dark:text-lime-300', label: 'Lima' },
  { bg: 'bg-fuchsia-100 dark:bg-fuchsia-500/20', text: 'text-fuchsia-700 dark:text-fuchsia-300', label: 'Fúcsia' },
  { bg: 'bg-sky-100 dark:bg-sky-500/20', text: 'text-sky-700 dark:text-sky-300', label: 'Céu' },
];

function colorKey(tag: Pick<TagConfig, 'color'>) {
  return tag.color;
}

// Reconstrói o objeto de cor a partir da string salva ("bg-x text-y") — usado
// pra pré-selecionar o swatch certo ao abrir o seletor numa tag existente.
function findColor(colorStr: string) {
  return TAG_COLORS.find(c => `${c.bg} ${c.text}` === colorStr) || TAG_COLORS[0];
}

export function TagManager() {
  const { currentUser } = useApp();
  const isAdmin = currentUser?.role === UserRole.ADMIN;

  const [tags, setTags] = useState<TagConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [domainFilter, setDomainFilter] = useState<'all' | 'chat' | 'ticket'>('chat');
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Edição inline de nome — vale tanto pra tag principal quanto pra subtag,
  // sempre clicando direto no rótulo (sem reabrir um formulário separado).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const editingInputRef = useRef<HTMLInputElement>(null);

  const [colorPickerId, setColorPickerId] = useState<string | null>(null);

  // Campo de "+ Subtag" embutido na própria linha da principal — fica aberto
  // depois de cada Enter, pra cadastrar várias em sequência sem reabrir nada.
  const [addingSubtagFor, setAddingSubtagFor] = useState<string | null>(null);
  const [newSubtagLabel, setNewSubtagLabel] = useState('');
  const newSubtagInputRef = useRef<HTMLInputElement>(null);

  const [creatingPrincipal, setCreatingPrincipal] = useState(false);
  const [newPrincipalLabel, setNewPrincipalLabel] = useState('');
  const [newPrincipalColor, setNewPrincipalColor] = useState(TAG_COLORS[0]);
  const newPrincipalInputRef = useRef<HTMLInputElement>(null);

  const [deleteTarget, setDeleteTarget] = useState<TagConfig | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function loadTags() {
      try {
        setTags(await ConfigService.getTags());
      } catch {
        toast.error('Erro ao carregar tags.');
      } finally {
        setLoading(false);
      }
    }
    loadTags();
  }, []);

  useEffect(() => {
    if (editingId) editingInputRef.current?.focus();
  }, [editingId]);

  useEffect(() => {
    if (addingSubtagFor) newSubtagInputRef.current?.focus();
  }, [addingSubtagFor, newSubtagLabel]);

  useEffect(() => {
    if (creatingPrincipal) newPrincipalInputRef.current?.focus();
  }, [creatingPrincipal]);

  // Fecha o seletor de cor ao clicar fora (mesmo padrão de ChatTagPicker).
  useEffect(() => {
    if (!colorPickerId) return;
    function handleClick(e: MouseEvent) {
      if (!(e.target as Element).closest('[data-color-picker]')) setColorPickerId(null);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setColorPickerId(null);
    }
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [colorPickerId]);

  const effectiveDomain: 'chat' | 'ticket' | null = domainFilter === 'all' ? null : domainFilter;

  const filteredTags = useMemo(
    () => tags.filter(t => domainFilter === 'all' || t.domain === domainFilter),
    [tags, domainFilter]
  );
  const principals = useMemo(
    () => filteredTags.filter(t => !t.parentTagId).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    [filteredTags]
  );
  const childrenByParent = useMemo(() => {
    const map = new Map<string, TagConfig[]>();
    for (const t of filteredTags) {
      if (!t.parentTagId) continue;
      const list = map.get(t.parentTagId) || [];
      list.push(t);
      map.set(t.parentTagId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
    return map;
  }, [filteredTags]);

  const query = normalizeString(search.trim());
  const matchesQuery = (t: TagConfig) => !query || normalizeString(t.label).includes(query);
  const visiblePrincipals = principals.filter(p => matchesQuery(p) || (childrenByParent.get(p.id) || []).some(matchesQuery));
  const isExpanded = (p: TagConfig) =>
    expandedIds.has(p.id) || addingSubtagFor === p.id || (!!query && (childrenByParent.get(p.id) || []).some(matchesQuery));

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const startEditing = (tag: TagConfig) => {
    if (!isAdmin) return;
    setEditingId(tag.id);
    setEditingLabel(tag.label);
  };

  const commitEditing = async (tag: TagConfig) => {
    const label = editingLabel.trim();
    setEditingId(null);
    if (!label || label === tag.label) return;
    try {
      const updated = await ConfigService.saveTag({ ...tag, label });
      setTags(prev => prev.map(t => (t.id === tag.id ? updated : t)));
    } catch {
      toast.error('Erro ao renomear tag.');
    }
  };

  const commitColor = async (tag: TagConfig, color: typeof TAG_COLORS[number]) => {
    setColorPickerId(null);
    const colorStr = `${color.bg} ${color.text}`;
    if (colorStr === tag.color) return;
    try {
      const updated = await ConfigService.saveTag({ ...tag, color: colorStr });
      setTags(prev => prev.map(t => (t.id === tag.id ? updated : t)));
    } catch {
      toast.error('Erro ao alterar cor.');
    }
  };

  const handleAddSubtag = async (principal: TagConfig, e: React.FormEvent) => {
    e.preventDefault();
    const label = newSubtagLabel.trim();
    if (!label) return;
    try {
      const created = await ConfigService.saveTag({
        label,
        color: principal.color,
        domain: principal.domain,
        parentTagId: principal.id,
      } as TagConfig);
      setTags(prev => [...prev, created]);
      setNewSubtagLabel('');
    } catch {
      toast.error('Erro ao criar subtag.');
    }
  };

  const handleCreatePrincipal = async (e: React.FormEvent) => {
    e.preventDefault();
    const label = newPrincipalLabel.trim();
    if (!label || !effectiveDomain) return;
    try {
      const created = await ConfigService.saveTag({
        label,
        color: `${newPrincipalColor.bg} ${newPrincipalColor.text}`,
        domain: effectiveDomain,
        parentTagId: null,
      } as TagConfig);
      setTags(prev => [...prev, created]);
      setNewPrincipalLabel('');
      setNewPrincipalColor(TAG_COLORS[0]);
      setCreatingPrincipal(false);
      // Abre direto pronta pra receber subtags — é o caminho mais comum
      // depois de criar uma principal nova.
      setExpandedIds(prev => new Set(prev).add(created.id));
      setAddingSubtagFor(created.id);
    } catch {
      toast.error('Erro ao criar tag principal.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const children = childrenByParent.get(deleteTarget.id) || [];
    setDeleting(true);
    try {
      for (const child of children) await ConfigService.deleteTag(child.id);
      await ConfigService.deleteTag(deleteTarget.id);
      setTags(prev => prev.filter(t => t.id !== deleteTarget.id && t.parentTagId !== deleteTarget.id));
      toast.success(children.length > 0 ? 'Tag e subtags removidas.' : 'Tag removida.');
    } catch {
      toast.error('Erro ao remover tag.');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-6">
          <div>
            <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-2">
              <Tag className="text-[var(--accent-text)]" size={24} /> Gestão de Tags
            </h3>
            <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">
              Organize em tag principal e subtags — categorização rápida e consistente
            </p>
          </div>

          <div className="flex bg-[var(--surface-pill)] p-1 rounded-2xl gap-1 self-start">
            {(['chat', 'ticket', 'all'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDomainFilter(d)}
                className={cn(
                  "px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                  domainFilter === d ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-tertiary)] hover:bg-white/50 dark:hover:bg-[var(--surface-card)]"
                )}
              >
                {d === 'all' ? 'Todos' : d === 'chat' ? 'Chats' : 'Chamados'}
              </button>
            ))}
          </div>
        </div>

        {tags.length > 6 && (
          <div className="relative mb-6">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar tag ou subtag..."
              className="w-full bg-[var(--surface-pill)]/60 border border-[var(--border-default)] rounded-xl pl-10 pr-4 py-2.5 text-xs font-semibold text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:ring-4 focus:ring-[var(--accent)]/10 focus:border-[var(--accent)]/40 transition-all"
            />
          </div>
        )}

        {!effectiveDomain && isAdmin && (
          <p className="mb-5 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest bg-[var(--surface-pill)]/60 border border-dashed border-[var(--border-default)] rounded-xl px-4 py-3">
            Selecione &ldquo;Chats&rdquo; ou &ldquo;Chamados&rdquo; acima para cadastrar ou editar tags — &ldquo;Todos&rdquo; é só visualização.
          </p>
        )}

        {loading ? (
          <div className="py-16 text-center">
            <div className="w-6 h-6 border-2 border-[var(--accent)]/30 border-t-[var(--accent)] rounded-full animate-spin mx-auto" />
          </div>
        ) : visiblePrincipals.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-[var(--text-tertiary)] text-xs font-bold uppercase tracking-widest italic">
              {search ? 'Nenhuma tag encontrada.' : 'Nenhuma tag cadastrada para este domínio.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {visiblePrincipals.map(principal => (
              <PrincipalRow
                key={principal.id}
                principal={principal}
                subtags={childrenByParent.get(principal.id) || []}
                expanded={isExpanded(principal)}
                isAdmin={isAdmin}
                editingId={editingId}
                editingLabel={editingLabel}
                editingInputRef={editingInputRef}
                colorPickerId={colorPickerId}
                addingSubtag={addingSubtagFor === principal.id}
                newSubtagLabel={newSubtagLabel}
                newSubtagInputRef={newSubtagInputRef}
                onToggleExpand={() => toggleExpanded(principal.id)}
                onStartAddSubtag={() => {
                  setExpandedIds(prev => new Set(prev).add(principal.id));
                  setAddingSubtagFor(principal.id);
                }}
                onStopAddSubtag={() => { setAddingSubtagFor(null); setNewSubtagLabel(''); }}
                onNewSubtagLabelChange={setNewSubtagLabel}
                onSubmitSubtag={(e) => handleAddSubtag(principal, e)}
                onStartEdit={startEditing}
                onEditingLabelChange={setEditingLabel}
                onCommitEdit={commitEditing}
                onCancelEdit={() => setEditingId(null)}
                onOpenColorPicker={setColorPickerId}
                onCommitColor={commitColor}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        )}

        {isAdmin && effectiveDomain && (
          <div className="mt-4">
            {creatingPrincipal ? (
              <form
                onSubmit={handleCreatePrincipal}
                className="flex flex-wrap items-center gap-3 bg-[var(--surface-pill)]/50 border border-dashed border-[var(--accent)]/40 rounded-2xl p-4"
              >
                <ColorSwatchButton color={newPrincipalColor} onClick={() => setColorPickerId('__new_principal__')} size={28} />
                {colorPickerId === '__new_principal__' && (
                  <ColorSwatchPopover
                    current={newPrincipalColor}
                    onPick={(c) => { setNewPrincipalColor(c); setColorPickerId(null); }}
                  />
                )}
                <input
                  ref={newPrincipalInputRef}
                  type="text"
                  value={newPrincipalLabel}
                  onChange={(e) => setNewPrincipalLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setCreatingPrincipal(false); setNewPrincipalLabel(''); } }}
                  placeholder="Nome da nova tag principal..."
                  className="flex-1 min-w-[180px] bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:ring-4 focus:ring-[var(--accent)]/10 transition-all"
                />
                <button
                  type="submit"
                  className="px-4 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 hover:bg-slate-800 transition-all"
                >
                  <Check size={14} /> Criar
                </button>
                <button
                  type="button"
                  onClick={() => { setCreatingPrincipal(false); setNewPrincipalLabel(''); }}
                  className="p-2.5 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] rounded-xl transition-all"
                >
                  <X size={16} />
                </button>
              </form>
            ) : (
              <button
                onClick={() => setCreatingPrincipal(true)}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border-2 border-dashed border-[var(--border-default)] text-[var(--text-tertiary)] text-[10px] font-black uppercase tracking-widest hover:border-[var(--accent)]/50 hover:text-[var(--accent-text)] hover:bg-[var(--accent)]/5 transition-all"
              >
                <Plus size={15} /> Nova tag principal
              </button>
            )}
          </div>
        )}
      </div>

      <div className="p-6 bg-[var(--accent)]/10 border border-[var(--accent)]/20 rounded-3xl flex gap-4">
        <div className="w-12 h-12 bg-[var(--accent)] rounded-2xl flex items-center justify-center text-white shrink-0 shadow-lg shadow-indigo-100">
          <FolderTree size={22} />
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-black text-indigo-900 dark:text-[var(--accent-soft-text)] uppercase tracking-tight">Como funciona a hierarquia</h4>
          <p className="text-[10px] text-[var(--accent-text)] font-medium leading-relaxed uppercase tracking-widest">
            Cada tag principal pode ter subtags — ao encerrar um atendimento ou marcar a conversa, o analista escolhe a principal e, se houver, uma subtag dela. Clique no nome pra renomear e na bolinha de cor pra trocar a cor; novas subtags herdam a cor da principal, mas pode ajustar à vontade.
          </p>
        </div>
      </div>

      <ConfirmModal
        isOpen={!!deleteTarget}
        title={deleteTarget ? `Excluir "${deleteTarget.label}"?` : ''}
        message={
          deleteTarget && (childrenByParent.get(deleteTarget.id) || []).length > 0
            ? `Esta tag tem ${(childrenByParent.get(deleteTarget.id) || []).length} subtag(s) — todas serão excluídas junto. Conversas e chamados já marcados com elas deixam de mostrar essa classificação.`
            : 'Conversas e chamados já marcados com esta tag deixam de mostrar essa classificação.'
        }
        onConfirm={handleConfirmDelete}
        onCancel={() => { if (!deleting) setDeleteTarget(null); }}
      />
    </div>
  );
}

function ColorSwatchButton({ color, onClick, size = 22 }: { color: typeof TAG_COLORS[number]; onClick: () => void; size?: number }) {
  return (
    <button
      type="button"
      data-color-picker
      onClick={onClick}
      title="Alterar cor"
      style={{ width: size, height: size }}
      className={cn('rounded-full shrink-0 ring-2 ring-offset-2 ring-offset-[var(--surface-card)] ring-transparent hover:ring-[var(--border-default)] transition-all', color.bg)}
    />
  );
}

function ColorSwatchPopover({ current, onPick }: { current: typeof TAG_COLORS[number]; onPick: (c: typeof TAG_COLORS[number]) => void }) {
  return (
    <div
      data-color-picker
      className="absolute z-30 top-full mt-2 left-0 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-xl p-3 grid grid-cols-5 gap-2 w-[200px]"
    >
      {TAG_COLORS.map(c => (
        <button
          key={c.label}
          type="button"
          onClick={() => onPick(c)}
          title={c.label}
          className={cn(
            'w-7 h-7 rounded-xl flex items-center justify-center transition-all',
            c.bg,
            current.label === c.label ? 'ring-2 ring-[var(--accent)] ring-offset-1' : 'hover:scale-110'
          )}
        >
          {current.label === c.label && <Check size={13} className={c.text} />}
        </button>
      ))}
    </div>
  );
}

interface PrincipalRowProps {
  principal: TagConfig;
  subtags: TagConfig[];
  expanded: boolean;
  isAdmin: boolean;
  editingId: string | null;
  editingLabel: string;
  editingInputRef: React.RefObject<HTMLInputElement | null>;
  colorPickerId: string | null;
  addingSubtag: boolean;
  newSubtagLabel: string;
  newSubtagInputRef: React.RefObject<HTMLInputElement | null>;
  onToggleExpand: () => void;
  onStartAddSubtag: () => void;
  onStopAddSubtag: () => void;
  onNewSubtagLabelChange: (v: string) => void;
  onSubmitSubtag: (e: React.FormEvent) => void;
  onStartEdit: (tag: TagConfig) => void;
  onEditingLabelChange: (v: string) => void;
  onCommitEdit: (tag: TagConfig) => void;
  onCancelEdit: () => void;
  onOpenColorPicker: (id: string | null) => void;
  onCommitColor: (tag: TagConfig, color: typeof TAG_COLORS[number]) => void;
  onDelete: (tag: TagConfig) => void;
}

function PrincipalRow({
  principal, subtags, expanded, isAdmin,
  editingId, editingLabel, editingInputRef,
  colorPickerId, addingSubtag, newSubtagLabel, newSubtagInputRef,
  onToggleExpand, onStartAddSubtag, onStopAddSubtag, onNewSubtagLabelChange, onSubmitSubtag,
  onStartEdit, onEditingLabelChange, onCommitEdit, onCancelEdit,
  onOpenColorPicker, onCommitColor, onDelete,
}: PrincipalRowProps) {
  const isEditingThis = editingId === principal.id;

  return (
    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden group/row">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={onToggleExpand}
          className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-all shrink-0"
          title={expanded ? 'Recolher' : 'Expandir'}
        >
          <ChevronDown size={16} className={cn('transition-transform', expanded ? 'rotate-0' : '-rotate-90')} />
        </button>

        <div className="relative shrink-0">
          <ColorSwatchButton color={findColor(colorKey(principal))} onClick={() => isAdmin && onOpenColorPicker(colorPickerId === principal.id ? null : principal.id)} />
          {colorPickerId === principal.id && (
            <ColorSwatchPopover current={findColor(colorKey(principal))} onPick={(c) => onCommitColor(principal, c)} />
          )}
        </div>

        {isEditingThis ? (
          <input
            ref={editingInputRef}
            value={editingLabel}
            onChange={(e) => onEditingLabelChange(e.target.value)}
            onBlur={() => onCommitEdit(principal)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); onCommitEdit(principal); }
              if (e.key === 'Escape') onCancelEdit();
            }}
            className="flex-1 min-w-0 bg-[var(--surface-pill)]/60 border border-[var(--accent)]/40 rounded-lg px-2 py-1 text-sm font-black uppercase tracking-tight outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
          />
        ) : (
          <button
            onClick={() => isAdmin && onStartEdit(principal)}
            className={cn(
              "flex-1 min-w-0 text-left text-sm font-black uppercase tracking-tight text-[var(--text-primary)] truncate",
              isAdmin && "hover:underline underline-offset-2 decoration-dashed cursor-text"
            )}
            title={isAdmin ? 'Clique para renomear' : undefined}
          >
            {principal.label}
          </button>
        )}

        {subtags.length > 0 && (
          <span className="shrink-0 text-[9px] font-black text-[var(--text-tertiary)] bg-[var(--surface-pill)] px-2 py-0.5 rounded-full">
            {subtags.length} subtag{subtags.length > 1 ? 's' : ''}
          </span>
        )}

        {isAdmin && (
          <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-all shrink-0">
            <button
              onClick={onStartAddSubtag}
              title="Adicionar subtag"
              className="p-1.5 hover:bg-[var(--surface-pill)] rounded-lg text-[var(--text-tertiary)] hover:text-[var(--accent-text)] transition-all"
            >
              <Plus size={15} />
            </button>
            <button
              onClick={() => onDelete(principal)}
              title="Excluir tag"
              className="p-1.5 hover:bg-[var(--surface-pill)] rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-danger)] transition-all"
            >
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-4 pl-[52px]">
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-dashed border-[var(--border-default)]/80 pt-3">
            {subtags.map(child => (
              <SubtagChip
                key={child.id}
                tag={child}
                isAdmin={isAdmin}
                isEditing={editingId === child.id}
                editingLabel={editingLabel}
                editingInputRef={editingInputRef}
                colorPickerOpen={colorPickerId === child.id}
                onOpenColorPicker={() => onOpenColorPicker(colorPickerId === child.id ? null : child.id)}
                onCommitColor={(c) => onCommitColor(child, c)}
                onStartEdit={() => onStartEdit(child)}
                onEditingLabelChange={onEditingLabelChange}
                onCommitEdit={() => onCommitEdit(child)}
                onCancelEdit={onCancelEdit}
                onDelete={() => onDelete(child)}
              />
            ))}

            {isAdmin && (
              addingSubtag ? (
                <form onSubmit={onSubmitSubtag} className="flex items-center gap-1.5">
                  <input
                    ref={newSubtagInputRef}
                    value={newSubtagLabel}
                    onChange={(e) => onNewSubtagLabelChange(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') onStopAddSubtag(); }}
                    placeholder="Nome da subtag..."
                    className="w-[160px] bg-[var(--surface-pill)]/60 border border-[var(--accent)]/40 rounded-full px-3 py-1.5 text-[11px] font-semibold outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                  />
                  <button type="submit" className="p-1.5 rounded-full bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-all" title="Adicionar (Enter)">
                    <Check size={12} />
                  </button>
                  <button type="button" onClick={onStopAddSubtag} className="p-1.5 rounded-full text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] transition-all" title="Fechar (Esc)">
                    <X size={12} />
                  </button>
                </form>
              ) : (
                <button
                  onClick={onStartAddSubtag}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full border border-dashed border-[var(--border-default)] text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] hover:border-[var(--accent)]/50 hover:text-[var(--accent-text)] transition-all"
                >
                  <Plus size={11} /> Subtag
                </button>
              )
            )}

            {subtags.length === 0 && !addingSubtag && (
              <span className="text-[10px] font-medium text-[var(--text-tertiary)] italic">Sem subtags cadastradas.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SubtagChip({
  tag, isAdmin, isEditing, editingLabel, editingInputRef,
  colorPickerOpen, onOpenColorPicker, onCommitColor,
  onStartEdit, onEditingLabelChange, onCommitEdit, onCancelEdit, onDelete,
}: {
  tag: TagConfig;
  isAdmin: boolean;
  isEditing: boolean;
  editingLabel: string;
  editingInputRef: React.RefObject<HTMLInputElement | null>;
  colorPickerOpen: boolean;
  onOpenColorPicker: () => void;
  onCommitColor: (c: typeof TAG_COLORS[number]) => void;
  onStartEdit: () => void;
  onEditingLabelChange: (v: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  const color = findColor(colorKey(tag));

  if (isEditing) {
    return (
      <input
        ref={editingInputRef}
        value={editingLabel}
        onChange={(e) => onEditingLabelChange(e.target.value)}
        onBlur={onCommitEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onCommitEdit(); }
          if (e.key === 'Escape') onCancelEdit();
        }}
        className="w-[160px] bg-[var(--surface-pill)]/60 border border-[var(--accent)]/40 rounded-full px-3 py-1.5 text-[11px] font-semibold outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
      />
    );
  }

  return (
    <span className={cn('relative group/chip inline-flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-full text-[11px] font-semibold', color.bg, color.text)}>
      <button
        type="button"
        onClick={isAdmin ? onOpenColorPicker : undefined}
        title={isAdmin ? 'Alterar cor' : undefined}
        className={cn('w-3.5 h-3.5 rounded-full shrink-0', color.bg, 'ring-1 ring-black/10 dark:ring-white/10', isAdmin && 'hover:ring-2 hover:ring-black/20')}
      />
      {colorPickerOpen && <ColorSwatchPopover current={color} onPick={onCommitColor} />}
      <button
        type="button"
        onClick={isAdmin ? onStartEdit : undefined}
        className={isAdmin ? 'hover:underline underline-offset-2 decoration-dashed cursor-text' : undefined}
        title={isAdmin ? 'Clique para renomear' : undefined}
      >
        {tag.label}
      </button>
      {isAdmin && (
        <button
          type="button"
          onClick={onDelete}
          className="opacity-0 group-hover/chip:opacity-100 hover:opacity-100 transition-opacity -mr-0.5"
          title="Excluir subtag"
        >
          <X size={11} />
        </button>
      )}
    </span>
  );
}
