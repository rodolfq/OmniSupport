'use client';

import React, { useState } from 'react';
import { Plus, Trash2, Tag, Hash } from 'lucide-react';
import { MockDB, TagConfig } from '@/lib/mock-db';
import { UserRole } from '@/lib/types';
import { useApp } from '@/app/app-context';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const TAG_COLORS = [
  { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Cinza' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'Índigo' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Esmeralda' },
  { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Âmbar' },
  { bg: 'bg-rose-100', text: 'text-rose-700', label: 'Rosa' },
  { bg: 'bg-cyan-100', text: 'text-cyan-700', label: 'Ciano' },
  { bg: 'bg-violet-100', text: 'text-violet-700', label: 'Violeta' },
];

export function TagManager() {
  const { currentUser } = useApp();
  const isAdmin = currentUser?.role === UserRole.ADMIN;

  const [tags, setTags] = useState<TagConfig[]>(MockDB.getTags());
  const [newTagLabel, setNewTagLabel] = useState('');
  const [selectedColor, setSelectedColor] = useState(TAG_COLORS[0]);
  const [domainFilter, setDomainFilter] = useState<'all' | 'chat' | 'ticket'>('all');

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      toast.error('Apenas administradores podem cadastrar tags.');
      return;
    }
    if (!newTagLabel.trim()) return;

    try {
      const domain = domainFilter === 'all' ? 'ticket' : domainFilter;
      const newTag = await MockDB.saveTag({
        label: newTagLabel.trim(),
        color: `${selectedColor.bg} ${selectedColor.text}`,
        domain
      });
      setTags([...tags, newTag]);
      setNewTagLabel('');
      toast.success('Tag personalizada criada!');
    } catch {
      toast.error('Erro ao criar tag.');
    }
  };

  const handleDeleteTag = async (id: string) => {
    if (!isAdmin) return;
    try {
      await MockDB.deleteTag(id);
      setTags(tags.filter(t => t.id !== id));
      toast.success('Tag removida.');
    } catch {
      toast.error('Erro ao remover tag.');
    }
  };

  const filteredTags = tags.filter(t => domainFilter === 'all' || t.domain === domainFilter);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
          <div>
            <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
              <Tag className="text-indigo-600" size={24} /> Gestão de Tags
            </h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
              Organize seus atendimentos com marcadores personalizados
            </p>
          </div>

          <div className="flex bg-slate-100 p-1 rounded-2xl gap-1 self-start">
            {(['all', 'chat', 'ticket'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDomainFilter(d)}
                className={cn(
                  "px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                  domainFilter === d ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:bg-white/50"
                )}
              >
                {d === 'all' ? 'Todos' : d === 'chat' ? 'Chats' : 'Chamados'}
              </button>
            ))}
          </div>
        </div>

        {isAdmin && (
          <form onSubmit={handleAddTag} className="bg-slate-50 border border-slate-100 rounded-3xl p-6 mb-8 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Nome da Tag</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                    <Hash size={16} />
                  </span>
                  <input
                    type="text"
                    value={newTagLabel}
                    onChange={(e) => setNewTagLabel(e.target.value)}
                    placeholder="Ex: Urgente, Retorno, Comercial..."
                    className="w-full bg-white border border-slate-200 rounded-2xl pl-10 pr-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all placeholder:text-slate-300"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Cor</label>
                <div className="flex flex-wrap gap-2">
                  {TAG_COLORS.map((color) => (
                    <button
                      key={color.label}
                      type="button"
                      onClick={() => setSelectedColor(color)}
                      className={cn(
                        "w-8 h-8 rounded-xl transition-all flex items-center justify-center",
                        color.bg,
                        selectedColor.label === color.label ? "ring-2 ring-indigo-500 ring-offset-2 scale-110" : "hover:scale-105"
                      )}
                      title={color.label}
                    >
                      {selectedColor.label === color.label && <div className={cn("w-1.5 h-1.5 rounded-full", color.text.replace('text', 'bg'))} />}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-xl shadow-slate-200"
            >
              <Plus size={16} /> Criar Nova Tag Personalizada
            </button>
          </form>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filteredTags.length === 0 ? (
            <div className="col-span-full py-12 text-center">
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest italic">Nenhuma tag cadastrada para este domínio.</p>
            </div>
          ) : (
            filteredTags.map((tag) => (
              <div
                key={tag.id}
                className={cn(
                  "p-4 rounded-3xl border flex flex-col gap-3 group transition-all hover:shadow-md h-32",
                  tag.color.split(' ')[0],
                  tag.color.split(' ')[1],
                  "border-transparent hover:border-slate-200"
                )}
              >
                <div className="flex justify-between items-start">
                  <div className="w-8 h-8 rounded-xl bg-white/50 backdrop-blur-sm flex items-center justify-center">
                    <Hash size={14} />
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => handleDeleteTag(tag.id)}
                      className="p-1.5 hover:bg-white/50 rounded-lg text-slate-400 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <div className="mt-auto">
                  <span className="text-xs font-black uppercase tracking-tight block truncate">{tag.label}</span>
                  <span className="text-[8px] font-black uppercase opacity-60 tracking-widest">
                    {tag.domain === 'chat' ? 'WhatsApp' : 'Chamados'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="p-6 bg-indigo-50 border border-indigo-100 rounded-3xl flex gap-4">
        <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shrink-0 shadow-lg shadow-indigo-100">
           <Tag size={24} />
        </div>
        <div className="space-y-1">
           <h4 className="text-sm font-black text-indigo-900 uppercase tracking-tight">Para que servem as tags?</h4>
           <p className="text-[10px] text-indigo-700 font-medium leading-relaxed uppercase tracking-widest">
             Tags ajudam na categorização rápida, filtragem em relatórios e identificação visual instantânea do tipo de atendimento que está sendo realizado.
           </p>
        </div>
      </div>
    </div>
  );
}
