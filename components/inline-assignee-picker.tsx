'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { Check, Search, UserPlus, UserX } from 'lucide-react';
import { UserAvatar } from '@/components/user-avatar';
import { cn, normalizeString } from '@/lib/utils';

/**
 * Troca de responsável direto na LISTA, sem abrir o registro.
 *
 * Motivo: redistribuir trabalho era uma operação de vários passos — abrir o
 * chamado, achar o campo, trocar, fechar, repetir. Numa lista de dezenas de
 * itens isso é o trabalho inteiro do supervisor.
 *
 * Duas decisões de implementação que não são estética:
 *
 * 1. O painel é renderizado em PORTAL, com posição calculada a partir do
 *    botão. A célula fica dentro de uma tabela com `overflow` e empilhamento
 *    próprio — um dropdown posicionado no fluxo normal seria cortado pela
 *    borda da tabela ou apareceria atrás da linha seguinte.
 *
 * 2. A troca é OTIMISTA: a lista mostra o novo responsável na hora e desfaz se
 *    o servidor recusar. Numa fila de redistribuição, esperar o ida-e-volta a
 *    cada clique torna a tarefa penosa; e o caso de erro é raro o bastante
 *    para valer o desfazer.
 */

export interface AssigneeOption {
  id: string;
  name: string;
  avatarThumbUrl?: string | null;
}

interface InlineAssigneePickerProps {
  currentAssigneeId?: string | null;
  options: AssigneeOption[];
  onChange: (assigneeId: string | null) => Promise<void> | void;
  /** Falso desenha só o texto, sem interação (ex.: sem permissão). */
  editable?: boolean;
  /** Rótulo quando não há ninguém. */
  emptyLabel?: string;
  size?: number;
  className?: string;
}

export function InlineAssigneePicker({
  currentAssigneeId,
  options,
  onChange,
  editable = true,
  emptyLabel = 'Disponível',
  size = 20,
  className
}: InlineAssigneePickerProps) {
  const [aberto, setAberto] = React.useState(false);
  const [busca, setBusca] = React.useState('');
  const [salvando, setSalvando] = React.useState(false);
  const [posicao, setPosicao] = React.useState<{ top: number; left: number } | null>(null);
  const botaoRef = React.useRef<HTMLButtonElement>(null);
  const painelRef = React.useRef<HTMLDivElement>(null);

  const atual = options.find(o => o.id === currentAssigneeId);

  const abrir = () => {
    const r = botaoRef.current?.getBoundingClientRect();
    if (!r) return;
    // Abre para cima quando não há espaço abaixo — sem isso, as últimas linhas
    // da lista abrem um painel que fica fora da tela.
    const alturaPainel = 320;
    const abreParaCima = r.bottom + alturaPainel > window.innerHeight && r.top > alturaPainel;
    setPosicao({
      top: abreParaCima ? r.top - alturaPainel - 4 : r.bottom + 4,
      left: Math.min(r.left, window.innerWidth - 280)
    });
    setBusca('');
    setAberto(true);
  };

  // Fecha ao clicar fora, ao rolar a lista e com Esc. O scroll importa: o
  // painel está posicionado em coordenadas de tela, então rolar deixaria ele
  // "solto" longe do botão de origem.
  React.useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (painelRef.current?.contains(e.target as Node)) return;
      if (botaoRef.current?.contains(e.target as Node)) return;
      setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    const rolou = () => setAberto(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    window.addEventListener('scroll', rolou, true);
    window.addEventListener('resize', rolou);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla);
      window.removeEventListener('scroll', rolou, true);
      window.removeEventListener('resize', rolou);
    };
  }, [aberto]);

  const filtradas = React.useMemo(() => {
    const q = normalizeString(busca);
    if (!q) return options;
    return options.filter(o => normalizeString(o.name).includes(q));
  }, [options, busca]);

  const escolher = async (id: string | null) => {
    setAberto(false);
    if (id === (currentAssigneeId || null)) return;
    setSalvando(true);
    try {
      await onChange(id);
    } finally {
      setSalvando(false);
    }
  };

  // Sem texto de vazio (emptyLabel = ''), o alvo de clique seria um espaço em
  // branco — e num card de kanban não haveria como atribuir alguém. Nesse
  // caso desenha o marcador tracejado, que é o mesmo símbolo de "sem
  // responsável" já usado nas listas e serve de área clicável.
  const conteudo = atual ? (
    <>
      <UserAvatar name={atual.name} thumbUrl={atual.avatarThumbUrl} size={size} />
      {emptyLabel !== '' && (
        <span className="text-sm font-medium text-[var(--text-secondary)] truncate">{atual.name}</span>
      )}
    </>
  ) : (
    <>
      <div
        className="rounded-full bg-[var(--surface-pill)] border border-dashed border-[var(--border-default)] flex items-center justify-center text-[var(--text-tertiary)] shrink-0"
        style={{ width: size, height: size }}
        title="Sem responsável — clique para atribuir"
      >
        <UserPlus size={Math.round(size * 0.55)} />
      </div>
      {emptyLabel !== '' && (
        <span className="text-xs italic text-[var(--text-tertiary)]">{emptyLabel}</span>
      )}
    </>
  );

  if (!editable) {
    return <div className={cn('flex items-center gap-2 min-w-0', className)}>{conteudo}</div>;
  }

  return (
    <>
      <button
        ref={botaoRef}
        type="button"
        // stopPropagation: a linha inteira abre o registro ao ser clicada —
        // sem isto, trocar o responsável abriria o chamado junto.
        onClick={(e) => { e.stopPropagation(); aberto ? setAberto(false) : abrir(); }}
        // pointerdown também: no kanban o card é arrastável (dnd-kit escuta
        // pointerdown no elemento pai). Sem barrar aqui, pressionar o seletor e
        // mover um pouco arrastaria o card em vez de abrir a lista.
        onPointerDown={(e) => e.stopPropagation()}
        disabled={salvando}
        title="Clique para trocar o responsável"
        className={cn(
          'flex items-center gap-2 min-w-0 -mx-1.5 px-1.5 py-1 rounded-lg transition-all text-left',
          'hover:bg-[var(--surface-pill)] disabled:opacity-50',
          aberto && 'bg-[var(--surface-pill)] ring-1 ring-[var(--accent)]/30',
          className
        )}
      >
        {conteudo}
      </button>

      {aberto && posicao && createPortal(
        <div
          ref={painelRef}
          style={{ top: posicao.top, left: posicao.left, width: 272 }}
          className="fixed z-[100] bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-2 border-b border-[var(--border-default)]">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar responsável..."
                className="w-full bg-[var(--surface-pill)] rounded-lg pl-8 pr-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
              />
            </div>
          </div>

          <div className="max-h-60 overflow-y-auto p-1.5">
            <button
              type="button"
              onClick={() => escolher(null)}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left hover:bg-[var(--surface-pill)] transition-colors"
            >
              <div className="w-5 h-5 rounded-full bg-[var(--surface-pill)] flex items-center justify-center shrink-0">
                <UserX size={12} className="text-[var(--text-tertiary)]" />
              </div>
              <span className="text-xs font-medium text-[var(--text-tertiary)] italic flex-1">Sem responsável</span>
              {!currentAssigneeId && <Check size={13} className="text-[var(--accent-text)] shrink-0" />}
            </button>

            {filtradas.map(o => (
              <button
                key={o.id}
                type="button"
                onClick={() => escolher(o.id)}
                className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left hover:bg-[var(--surface-pill)] transition-colors"
              >
                <UserAvatar name={o.name} thumbUrl={o.avatarThumbUrl} size={20} />
                <span className="text-xs font-medium text-[var(--text-primary)] truncate flex-1">{o.name}</span>
                {o.id === currentAssigneeId && <Check size={13} className="text-[var(--accent-text)] shrink-0" />}
              </button>
            ))}

            {filtradas.length === 0 && (
              <p className="text-[11px] text-[var(--text-tertiary)] text-center py-4">Ninguém encontrado.</p>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
