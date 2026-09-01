'use client';

import React from 'react';
import { Plus, Trash2, Star, Archive, ArchiveRestore, ChevronDown, ChevronRight } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { EditableLabel } from '@/components/editable-label';
import { ConfirmModal } from '@/components/confirm-modal';
import { ConfigService, SimpleListType } from '@/lib/services/config-service';

interface SimpleItem {
  id: string;
  label: string;
  isArchived?: boolean;
  usageCount?: number;
}

// Uma lista de rótulo simples (Categorias, Tipos de Solicitação, Produtos) —
// as três são idênticas em comportamento, então existe um componente só.
//
// A distinção entre ARQUIVAR e EXCLUIR é o ponto central desta tela: a FK
// dessas colunas é ON DELETE SET NULL, ou seja, excluir um item em uso
// esvaziaria a classificação dos chamados que apontam pra ele, sem aviso e sem
// recuperação. Por isso o botão de excluir só aparece para item com uso zero;
// o resto se arquiva, e aí some dos seletores de chamado novo mas continua
// aparecendo no chamado antigo.
function SimpleListSection({
  title, placeholder, items, value, onChange, onAdd, onRename, onArchive, onDelete
}: {
  title: string;
  placeholder: string;
  items: SimpleItem[];
  value: string;
  onChange: (v: string) => void;
  onAdd: () => void;
  onRename: (id: string, label: string) => Promise<void>;
  onArchive: (id: string, archived: boolean) => void;
  onDelete: (item: SimpleItem) => void;
}) {
  const [showArchived, setShowArchived] = React.useState(false);
  const active = items.filter(i => !i.isArchived);
  const archived = items.filter(i => i.isArchived);

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-tight">{title}</h4>
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } }}
          placeholder={placeholder}
          className="flex-1 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2 text-sm"
        />
        <button onClick={onAdd} className="shrink-0 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white p-2 rounded-xl transition-colors" title="Adicionar"><Plus size={18}/></button>
      </div>

      <div className="bg-[var(--surface-card)] rounded-2xl p-4 space-y-2">
        {active.length === 0 && (
          <p className="text-sm text-[var(--text-tertiary)] py-2">Nenhum item cadastrado.</p>
        )}
        {active.map(item => (
          <div key={item.id} className="flex justify-between items-center gap-2 bg-[var(--surface-card)] p-3 rounded-lg border border-[var(--border-default)] text-sm font-medium">
            <EditableLabel value={item.label} onSave={(next) => onRename(item.id, next)} />
            <div className="flex items-center gap-1 shrink-0">
              {(item.usageCount ?? 0) > 0 && (
                <span
                  className="text-[11px] font-semibold text-[var(--text-tertiary)] bg-[var(--surface-pill)] px-2 py-0.5 rounded-full tabular-nums"
                  title={`${item.usageCount} registro(s) usam este item`}
                >
                  {item.usageCount}
                </span>
              )}
              <button
                onClick={() => onArchive(item.id, true)}
                title="Arquivar — deixa de ser oferecido em chamados novos, mas continua aparecendo nos antigos"
                className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors p-1"
              >
                <Archive size={16}/>
              </button>
              {(item.usageCount ?? 0) === 0 && (
                <button
                  onClick={() => onDelete(item)}
                  title="Excluir definitivamente — disponível porque nenhum registro usa este item"
                  className="text-[var(--text-danger)] hover:opacity-70 transition-opacity p-1"
                >
                  <Trash2 size={16}/>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {archived.length > 0 && (
        <div>
          <button
            onClick={() => setShowArchived(v => !v)}
            className="flex items-center gap-1 text-xs font-semibold text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          >
            {showArchived ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
            Arquivados ({archived.length})
          </button>
          {showArchived && (
            <div className="mt-2 space-y-2">
              {archived.map(item => (
                <div key={item.id} className="flex justify-between items-center gap-2 p-3 rounded-lg border border-dashed border-[var(--border-default)] text-sm">
                  <span className="text-[var(--text-tertiary)] line-through truncate">{item.label}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {(item.usageCount ?? 0) > 0 && (
                      <span className="text-[11px] text-[var(--text-tertiary)] tabular-nums">
                        em uso por {item.usageCount}
                      </span>
                    )}
                    <button
                      onClick={() => onArchive(item.id, false)}
                      title="Restaurar — volta a ser oferecido em chamados novos"
                      className="text-[var(--text-tertiary)] hover:text-[var(--accent-text)] transition-colors p-1"
                    >
                      <ArchiveRestore size={16}/>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SystemConfigContent({ categories, priorities, requestTypes, products, setCategories, setPriorities, setRequestTypes, setProducts, surveySettings, setSurveySettings }: any) {
  // Esta tela lê e escreve nessas mesmas tabelas via estado elevado (props
  // set*), então continua gerenciando sua própria lista local como sempre —
  // só avisa o cache compartilhado (lib/query-hooks.ts, usado por
  // new-ticket-modal.tsx/ticket-detail-modal.tsx/etc.) depois de cada escrita
  // bem-sucedida, pra essas outras telas não ficarem até 60s vendo uma
  // categoria/prioridade/produto/tipo desatualizado.
  const queryClient = useQueryClient();
  const [newCatLabel, setNewCatLabel] = React.useState('');
  const [newProductLabel, setNewProductLabel] = React.useState('');
  // Exclusão definitiva só é oferecida para item sem uso (o botão nem aparece
  // nos demais), mas ainda assim é irreversível — daí a confirmação.
  const [pendingDelete, setPendingDelete] = React.useState<{ type: SimpleListType; id: string; label: string } | null>(null);

  // Estado local, setter, chave do cache compartilhado e o substantivo usado
  // nas mensagens — um lugar só, para as três listas. O setter é o setState do
  // pai (settings/page.tsx), então aceita forma funcional: as três operações
  // abaixo usam `prev => ...` em vez da lista capturada na renderização, senão
  // dois cliques rápidos fariam o segundo partir da lista antiga e desfazer o
  // primeiro na tela.
  const LIST_META: Record<string, [any[], React.Dispatch<React.SetStateAction<any[]>>, string, string]> = {
    'categories': [categories, setCategories, 'config_categories', 'Categoria'],
    'request-types': [requestTypes, setRequestTypes, 'config_request_types', 'Tipo de solicitação'],
    'products': [products, setProducts, 'config_products', 'Produto']
  };

  // As três listas simples usam o mesmo par de funções: a rota trata
  // categories/request-types/products no mesmo branch, então não há motivo
  // para três cópias de "insere, reconsulta, avisa o cache".
  const addSimpleItem = async (
    type: 'categories' | 'request-types' | 'products',
    label: string,
    clear: () => void
  ) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const [, setList, queryKey, noun] = LIST_META[type];
    try {
      // A rota devolve a linha gravada (RETURNING id, label), então o item novo
      // entra direto na lista em memória — aparece na hora, sem reconsultar a
      // lista inteira. Só cai na reconsulta se a resposta vier sem id (não
      // deveria acontecer), pra tela nunca ficar mostrando um item sem chave.
      const created = await ConfigService.createSimpleItem(type, trimmed);
      if (created?.id) {
        setList(prev => [...prev, created]);
      } else {
        setList(await ConfigService.getSimpleList(type));
      }
      clear();
      queryClient.invalidateQueries({ queryKey: ['ref', queryKey] });
      toast.success(`${noun} adicionado`);
    } catch (err: any) {
      toast.error(err?.message || `Erro ao adicionar ${noun.toLowerCase()}`);
    }
  };

  // Arquivar/restaurar. Só muda a marca do item — nenhum chamado é tocado, por
  // isso não pede confirmação: a ação é reversível pelo botão de restaurar.
  const archiveItem = async (type: SimpleListType, id: string, archived: boolean) => {
    const [, setList, queryKey, noun] = LIST_META[type];
    try {
      if (archived) await ConfigService.archiveSimpleItem(type, id);
      else await ConfigService.restoreSimpleItem(type, id);
      setList(prev => prev.map((i: any) => (i.id === id ? { ...i, isArchived: archived } : i)));
      queryClient.invalidateQueries({ queryKey: ['ref', queryKey] });
      toast.success(archived ? `${noun} arquivado` : `${noun} restaurado`);
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao arquivar.');
    }
  };

  const deleteSimpleItem = async (
    type: 'categories' | 'request-types' | 'products',
    id: string
  ) => {
    const [, setList, queryKey, noun] = LIST_META[type];
    try {
      await ConfigService.deleteSimpleItem(type, id);
      setList(prev => prev.filter((i: any) => i.id !== id));
      queryClient.invalidateQueries({ queryKey: ['ref', queryKey] });
      toast.success(`${noun} removido`);
    } catch (err: any) {
      toast.error(err?.message || `Erro ao remover ${noun.toLowerCase()}`);
    }
  };

  // Renomear (ver components/editable-label.tsx). Só vale para estas três
  // listas porque o chamado aponta pra elas por id — trocar o rótulo não
  // desliga nada. Propaga o erro para o EditableLabel voltar ao valor antigo.
  const renameItem = async (
    type: 'categories' | 'request-types' | 'products',
    id: string,
    label: string
  ) => {
    const [, setList, queryKey, noun] = LIST_META[type];
    try {
      await ConfigService.renameSimpleItem(type, id, label);
      // Só o label muda: preservar o resto do item (isArchived, usageCount)
      // em vez de substituir pela resposta, que não traz a contagem de uso.
      setList(prev => prev.map((i: any) => (i.id === id ? { ...i, label } : i)));
      queryClient.invalidateQueries({ queryKey: ['ref', queryKey] });
      toast.success(`${noun} renomeado.`);
    } catch (err: any) {
      toast.error(err?.message || `Erro ao renomear ${noun.toLowerCase()}.`);
      throw err;
    }
  };

  const addCategory = () => addSimpleItem('categories', newCatLabel, () => setNewCatLabel(''));
  const deleteCategory = (id: string) => deleteSimpleItem('categories', id);

  const [newReqTypeLabel, setNewReqTypeLabel] = React.useState('');

  const addRequestType = () => addSimpleItem('request-types', newReqTypeLabel, () => setNewReqTypeLabel(''));
  const deleteRequestType = (id: string) => deleteSimpleItem('request-types', id);

  const addProduct = () => addSimpleItem('products', newProductLabel, () => setNewProductLabel(''));
  const deleteProduct = (id: string) => deleteSimpleItem('products', id);

  const [slaValues, setSlaValues] = React.useState<Record<string, number>>({});

  React.useEffect(() => {
    const initialValues: Record<string, number> = {};
    priorities.forEach((p: any) => {
      initialValues[p.label] = Math.round(p.sla_hours / 24);
    });
    setSlaValues(initialValues);
  }, [priorities]);

  const handleSaveSLA = async (label: string) => {
    const days = slaValues[label] || 1;
    const hours = days * 24;
    const priority = priorities.find((p: any) => p.label === label);

    try {
      // A rota devolve a linha gravada, então dá pra conferir que o SLA
      // persistido é o que foi enviado — sem essa checagem, uma gravação que
      // não chegou ao banco apareceria como sucesso na tela.
      const saved = await ConfigService.savePriority({
        id: priority?.id,
        label,
        slaHours: hours,
        color: priority?.color || 'bg-[var(--surface-pill)] text-[var(--text-secondary)]'
      } as any);

      const persistedHours = Number(saved?.sla_hours);
      if (persistedHours !== hours) {
        toast.error('O SLA não foi confirmado no banco. Tente novamente.');
        return;
      }

      setPriorities(
        priority
          ? priorities.map((p: any) => (p.id === saved.id ? saved : p))
          : [...priorities, saved]
      );
      toast.success(
        priority ? `SLA de ${label} atualizado para ${days} dias` : `${label} ativado com ${days} dias`
      );
      queryClient.invalidateQueries({ queryKey: ['ref', 'config_priorities'] });
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao salvar a prioridade');
    }
  };

  const priorityLabels = ['Baixa', 'Média', 'Alta', 'Urgente'];

  const [surveyEnabled, setSurveyEnabled] = React.useState(true);
  const [surveyMessage, setSurveyMessage] = React.useState('');
  const [surveyWindowHours, setSurveyWindowHours] = React.useState(24);

  React.useEffect(() => {
    if (surveySettings) {
      setSurveyEnabled(surveySettings.enabled ?? true);
      setSurveyMessage(surveySettings.message ?? '');
      setSurveyWindowHours(surveySettings.response_window_hours ?? surveySettings.responseWindowHours ?? 24);
    }
  }, [surveySettings]);

  const handleSaveSurvey = async () => {
    try {
      const saved = await ConfigService.saveSurveySettings({
        enabled: surveyEnabled,
        message: surveyMessage,
        responseWindowHours: surveyWindowHours
      });
      setSurveySettings(saved || null);
      toast.success('Pesquisa de satisfação atualizada');
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao salvar pesquisa de satisfação');
    }
  };

  return (
    <>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border-t border-[var(--border-default)] pt-8 mt-8">
      <SimpleListSection
        title="Categorias"
        placeholder="Nova categoria..."
        items={categories}
        value={newCatLabel}
        onChange={setNewCatLabel}
        onAdd={addCategory}
        onRename={(id, next) => renameItem('categories', id, next)}
        onArchive={(id, archived) => archiveItem('categories', id, archived)}
        onDelete={(item) => setPendingDelete({ type: 'categories', id: item.id, label: item.label })}
      />

      <SimpleListSection
        title="Tipos de Solicitação"
        placeholder="Novo tipo de solicitação..."
        items={requestTypes}
        value={newReqTypeLabel}
        onChange={setNewReqTypeLabel}
        onAdd={addRequestType}
        onRename={(id, next) => renameItem('request-types', id, next)}
        onArchive={(id, archived) => archiveItem('request-types', id, archived)}
        onDelete={(item) => setPendingDelete({ type: 'request-types', id: item.id, label: item.label })}
      />

      <SimpleListSection
        title="Produtos"
        placeholder="Novo produto..."
        items={products}
        value={newProductLabel}
        onChange={setNewProductLabel}
        onAdd={addProduct}
        onRename={(id, next) => renameItem('products', id, next)}
        onArchive={(id, archived) => archiveItem('products', id, archived)}
        onDelete={(item) => setPendingDelete({ type: 'products', id: item.id, label: item.label })}
      />

      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-tight">Prioridades (SLA)</h4>
        <div className="bg-[var(--surface-card)] rounded-2xl p-4 space-y-3">
          {priorityLabels.map((label, index) => {
            const priority = priorities.find((p: any) => p.label === label);
            const rawSlaHours = priority ? (priority.sla_hours || 24) : 24;
            const currentVal = slaValues[label] ?? Math.round(rawSlaHours / 24);

            return (
              <div key={label} className="bg-[var(--surface-card)] p-4 rounded-xl border border-[var(--border-default)] flex flex-wrap items-center justify-between gap-4 shadow-sm">
                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex">
                    {[0, 1, 2, 3].map((s) => (
                      <Star
                        key={s}
                        size={14}
                        className={index >= s ? "fill-amber-400 text-[var(--text-warning)]" : "text-[var(--border-strong)]"}
                      />
                    ))}
                  </div>
                  <span className="text-xs font-bold text-[var(--text-secondary)]">{label}</span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex items-center gap-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg px-2.5 py-1.5">
                    <input
                       type="number"
                       step="1"
                       min="1"
                       value={currentVal}
                       onChange={(e) => {
                         const val = parseInt(e.target.value) || 1;
                         setSlaValues(prev => ({ ...prev, [label]: val }));
                       }}
                       className="w-8 bg-transparent text-xs font-bold focus:outline-none"
                    />
                    <span className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase">dias</span>
                  </div>

                  <button
                    onClick={() => handleSaveSLA(label)}
                    className="text-[10px] font-semibold uppercase text-[var(--accent-text)] hover:bg-[var(--accent)]/10 px-3 py-1.5 rounded-lg border border-[var(--accent)]/20 transition-colors"
                  >
                    Salvar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-[var(--text-tertiary)] font-medium px-2 italic">
          * O SLA define o tempo máximo para atendimento em dias inteiros.
        </p>
      </div>
    </div>

    <div className="border-t border-[var(--border-default)] pt-8 mt-8 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-tight">Pesquisa de Satisfação</h4>
        <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={surveyEnabled}
            onChange={(e) => setSurveyEnabled(e.target.checked)}
            className="w-4 h-4 accent-[var(--accent)]"
          />
          Ativar ao finalizar conversa
        </label>
      </div>
      <div className="bg-[var(--surface-card)] rounded-2xl p-4 space-y-4 border border-[var(--border-default)]">
        <div className="space-y-2">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">Mensagem enviada ao cliente</label>
          <textarea
            value={surveyMessage}
            onChange={(e) => setSurveyMessage(e.target.value)}
            rows={4}
            className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm resize-y"
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg px-2.5 py-1.5">
            <input
              type="number"
              step="1"
              min="1"
              value={surveyWindowHours}
              onChange={(e) => setSurveyWindowHours(parseInt(e.target.value) || 1)}
              className="w-14 bg-transparent text-xs font-bold focus:outline-none"
            />
            <span className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase">horas para aceitar resposta</span>
          </div>
          <button
            onClick={handleSaveSurvey}
            className="text-[10px] font-semibold uppercase text-[var(--accent-text)] hover:bg-[var(--accent)]/10 px-3 py-1.5 rounded-lg border border-[var(--accent)]/20 transition-colors"
          >
            Salvar
          </button>
        </div>
      </div>
      <p className="text-[10px] text-[var(--text-tertiary)] font-medium px-2 italic">
        * Enviada por WhatsApp junto com o aviso de encerramento. O cliente responde "1" (satisfeito) ou "0" (poderia ser melhor) dentro do prazo configurado.
      </p>
    </div>

    <ConfirmModal
      isOpen={!!pendingDelete}
      title="Excluir definitivamente?"
      message={
        pendingDelete
          ? `"${pendingDelete.label}" será apagado e não poderá ser recuperado. Nenhum chamado usa este item, então nada perde classificação.`
          : ''
      }
      onConfirm={() => {
        if (pendingDelete) deleteSimpleItem(pendingDelete.type, pendingDelete.id);
        setPendingDelete(null);
      }}
      onCancel={() => setPendingDelete(null)}
    />
    </>
  );
}


