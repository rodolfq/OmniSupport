'use client';

import React, { useEffect, useState } from 'react';
import { UserPlus, Search, ChevronLeft, ChevronRight, ShieldCheck, Loader2 } from 'lucide-react';

// Rótulos da origem gravada em user_creation_log.source.
const SOURCE_LABELS: Record<string, string> = {
  'portal-cliente': 'Portal do cliente',
  'portal-equipe': 'Portal da equipe',
  'chat-vincular': 'Vincular contato no chat',
  'cadastro-empresa': 'Cadastro de empresa',
  'api-integracao': 'API de integração',
  'sincronizacao-planilha-cs': 'Sincronização da planilha de CS',
  'sincronizacao-bitrix24': 'Sincronização do Bitrix24',
  'chamado-perfil-automatico': 'Perfil criado ao abrir chamado',
  'desconhecido': 'Não identificada'
};

interface CreationEntry {
  id: string;
  createdAt: string;
  createdUserName: string | null;
  createdUserEmail: string | null;
  createdUserRole: string | null;
  createdUserCompanyName: string | null;
  createdByName: string | null;
  createdByEmail: string | null;
  createdByRole: string | null;
  source: string;
  actorLabel: string | null;
  ip: string | null;
}

const PAGE_SIZE = 20;

// Registro RÍGIDO de criação de usuários: cada usuário criado no sistema e o
// login que o criou. Gravado por gatilho no banco, na mesma transação da
// criação (migrations/user_creation_log.sql) — não há como criar sem registrar,
// e o registro não pode ser alterado nem apagado. Só leitura, restrito a quem
// pode ver o Log de Alterações (API: /api/reports/user-creation-log).
export function UserCreationLogContent() {
  const [entries, setEntries] = useState<CreationEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (search.trim()) params.set('search', search.trim());
    if (source) params.set('source', source);
    fetch(`/api/reports/user-creation-log?${params}`, { signal: controller.signal })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Não foi possível carregar o registro.');
        setEntries(data.data || []);
        setTotal(data.meta?.total ?? 0);
      })
      .catch(err => {
        if (err?.name === 'AbortError') return;
        setError(err?.message || 'Não foi possível carregar o registro.');
      })
      // Só a requisição VIGENTE desliga o carregamento: uma cancelada (filtro
      // mudou) não pode acender a tela "vazia" enquanto a nova ainda está em voo.
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [search, source, offset]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div>
        <h3 className="text-2xl font-black text-[var(--text-primary)] tracking-tight flex items-center gap-2">
          <UserPlus size={22} className="text-[var(--accent-text)]" /> Criação de Usuários
        </h3>
        <p className="text-sm text-[var(--text-tertiary)] font-medium mt-1">
          Todo usuário criado no sistema e o login que o criou.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-pill)]/50 p-4">
        <ShieldCheck size={18} className="text-[var(--accent-text)] shrink-0 mt-0.5" />
        <p className="text-xs font-medium text-[var(--text-secondary)] leading-relaxed">
          Registro gravado pelo banco de dados junto com a criação: nenhum usuário é criado sem aparecer aqui, e as
          linhas não podem ser alteradas nem apagadas — nem se o usuário criado for excluído depois.
        </p>
      </div>

      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-[var(--border-default)] flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <input
              value={search}
              onChange={(e) => { setOffset(0); setSearch(e.target.value); }}
              placeholder="Buscar por usuário criado, quem criou, e-mail ou empresa..."
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-[var(--border-default)] text-sm bg-[var(--surface-card)] focus:ring-2 focus:ring-[var(--accent)]/20 outline-none"
            />
          </div>
          <select
            value={source}
            onChange={(e) => { setOffset(0); setSource(e.target.value); }}
            className="px-3 py-2.5 rounded-xl border border-[var(--border-default)] text-sm bg-[var(--surface-card)] focus:ring-2 focus:ring-[var(--accent)]/20 outline-none"
          >
            <option value="">Todas as origens</option>
            {Object.entries(SOURCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-[var(--text-tertiary)] flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" /> Carregando...
          </div>
        ) : error ? (
          <div className="p-10 text-center text-sm text-[var(--text-danger)]">{error}</div>
        ) : entries.length === 0 ? (
          <div className="p-10 text-center text-sm text-[var(--text-tertiary)]">
            {search || source
              ? 'Nenhum registro encontrado para esse filtro.'
              : 'Nenhum usuário foi criado desde que o registro foi ativado.'}
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-default)]">
            {entries.map(entry => (
              <div key={entry.id} className="p-4 space-y-1.5">
                <p className="text-sm text-[var(--text-primary)]">
                  <span className="font-bold">{entry.createdByName || entry.actorLabel || 'Sem login associado'}</span>
                  {entry.createdByRole && <span className="text-[var(--text-tertiary)]"> ({entry.createdByRole})</span>}{' '}
                  <span className="text-[var(--text-tertiary)]">criou</span>{' '}
                  <span className="font-semibold">{entry.createdUserName || 'usuário'}</span>
                  {entry.createdUserRole && <span className="text-[var(--text-tertiary)]"> — {entry.createdUserRole}</span>}
                  {entry.createdUserCompanyName && <span className="text-[var(--text-tertiary)]"> · {entry.createdUserCompanyName}</span>}
                </p>
                <p className="text-[11px] text-[var(--text-tertiary)] font-medium">
                  {entry.createdUserEmail ? `E-mail do novo usuário: ${entry.createdUserEmail}` : 'Sem e-mail'}
                  {entry.createdByEmail && ` · Login de quem criou: ${entry.createdByEmail}`}
                  {entry.ip && ` · IP ${entry.ip}`}
                </p>
                <p className="text-[10px] text-[var(--text-tertiary)] font-medium uppercase tracking-widest">
                  {new Date(entry.createdAt).toLocaleString('pt-BR')} · origem: {SOURCE_LABELS[entry.source] || entry.source}
                </p>
              </div>
            ))}
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="p-4 border-t border-[var(--border-default)] flex items-center justify-between text-xs font-bold text-[var(--text-tertiary)]">
            <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} de {total}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                disabled={offset === 0}
                title="Anterior"
                className="p-2 rounded-lg border border-[var(--border-default)] disabled:opacity-40 hover:bg-[var(--surface-pill)] transition-all"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setOffset(offset + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= total}
                title="Próxima"
                className="p-2 rounded-lg border border-[var(--border-default)] disabled:opacity-40 hover:bg-[var(--surface-pill)] transition-all"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
