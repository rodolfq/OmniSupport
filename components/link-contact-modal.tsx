'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { StyledSelect } from '@/components/styled-select';
import { 
  ChatSession, 
  User, 
  UserRole,
  Company
} from '@/lib/types';
import { UserService, createUser } from '@/lib/services/user-service';
import { CompanyService } from '@/lib/services/company-service';
import { useQueuesQuery } from '@/lib/query-hooks';
import { 
  Search, 
  X,
  Check,
  Loader2,
} from 'lucide-react';
import { cn, normalizeString, maskPhone } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

// Resposta de 'set-history-contact' (ver app/api/chats/route.ts): o que a tela
// de histórico precisa pra atualizar as linhas sem recarregar tudo.
export interface HistoryLinkResult {
  customerId: string;
  customerProfileName: string;
  companyId: string | null;
  companyName: string | null;
  historyIds: string[];
}

export function LinkContactModal({ 
  isOpen, 
  onClose, 
  session, 
  onSuccess,
  historyId,
  otherUnlinkedCount = 0,
  onHistoryLinked
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  session: ChatSession | null,
  onSuccess: () => void,
  // Modo "histórico" (/chat-history): vincula uma conversa JÁ ENCERRADA (linha
  // de chat_histories) em vez de uma conversa em andamento. `session` só
  // empresta o telefone/nome pra exibição e pro "Criar Novo".
  historyId?: string,
  // Outras conversas do mesmo número ainda sem cliente — habilita a opção de
  // vincular todas de uma vez (só no modo histórico).
  otherUnlinkedCount?: number,
  // Só no modo histórico: recebe o resultado do vínculo (o `onSuccess` de
  // sempre não é chamado nesse modo — ele recarrega a lista de conversas vivas).
  onHistoryLinked?: (result: HistoryLinkResult) => void
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const { data: queuesData } = useQueuesQuery();
  const queues = useMemo(() => queuesData || [], [queuesData]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newCompanyId, setNewCompanyId] = useState('');
  const [isCreatingNewCompany, setIsCreatingNewCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [applyToSamePhone, setApplyToSamePhone] = useState(false);
  // Vincular/criar faz várias idas ao servidor: enquanto roda, os botões ficam
  // travados e o clicado mostra o spinner (evita o duplo clique e deixa claro
  // que o clique pegou).
  const [busy, setBusy] = useState<null | 'create' | string>(null);
  const runBusy = async (key: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    try { await fn(); } finally { setBusy(null); }
  };

  useEffect(() => {
    if (isOpen) {
      // O modal fica sempre MONTADO por quem o abre (só o JSX interno depende
      // de `isOpen` — ver comentário equivalente em edit-employee-modal.tsx),
      // então nenhum estado daqui zera sozinho ao fechar. Achado em
      // 2026-09-28: só newName/newEmail/applyToSamePhone eram limpos aqui —
      // busca digitada, aba "Criar Novo" e a empresa escolhida nela ficavam
      // do jeito que a última vinculação deixou, e reapareciam ao abrir de
      // novo pra um contato diferente (parecia "o cliente de antes ainda
      // selecionado"). Começa limpo a cada abertura, sempre.
      setNewName('');
      setNewEmail('');
      setApplyToSamePhone(false);
      setSearchTerm('');
      setIsCreatingNew(false);
      setIsCreatingNewCompany(false);
      setNewCompanyId('');
      setNewCompanyName('');
      async function loadData() {
        try {
          const emps = await UserService.getEmployees();
          setUsers(emps);
          const comps = await CompanyService.getAll();
          setCompanies(comps);
        } catch (e) {
          console.error("Error loading LinkContactModal data:", e);
        }
      }
      loadData();
      setNewName(session?.customerName || '');
    }
    // Só reinicia ao ABRIR (depende de isOpen, não de session). O objeto
    // `session` vem de customerSessions.find(...) no chat-widget, e essa lista
    // é recriada a cada atualização (polling de 30s e eventos em tempo real) —
    // com `session` nas dependências, cada atualização zerava o que a pessoa
    // estava digitando (nome, busca, aba "Criar Novo") e voltava pra primeira
    // aba. Achado em 2026-10-06.
  }, [isOpen]);

  // Foto de perfil do WhatsApp do contato, para sincronizar com o cadastro
  // (profiles.avatar_url) assim que ele é vinculado/criado.
  const fetchWhatsappContactPhoto = async (): Promise<string | null> => {
    if (!session?.customerPhone) return null;
    const queue = queues.find((q: any) => q.id === session.queueId);
    const instanceId = queue?.whatsapp_instance_id || queue?.whatsappInstanceId || 'default';
    try {
      const res = await fetch(`/api/whatsapp/contact-photo?instanceId=${encodeURIComponent(instanceId)}&phone=${encodeURIComponent(session.customerPhone)}`);
      const data = await res.json();
      return data.url || null;
    } catch {
      return null;
    }
  };

  const filteredUsers = users.filter(u => 
    normalizeString(u.name).includes(normalizeString(searchTerm)) ||
    (u.phone && u.phone.includes(searchTerm)) ||
    (u.phones && u.phones.some(p => p.includes(searchTerm)))
  );

  const handleLink = async (user: User) => {
    if (!session) return;

    try {
      // Modo histórico: uma ação só no servidor (que já confere a permissão
      // chat:history_link_contact e completa o telefone do cadastro). Não passa
      // pelo UserService.save abaixo — quem só tem a permissão de vincular não
      // teria acesso a editar cadastro, e o vínculo falharia no meio.
      if (historyId) {
        const res = await fetch('/api/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'set-history-contact',
            historyId,
            customerId: user.id,
            applyToSamePhone: applyToSamePhone && otherUnlinkedCount > 0
          })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Erro ao vincular o contato à conversa.');
        onHistoryLinked?.(data as HistoryLinkResult);
        onClose();
        return;
      }

      const currentPhones = user.phones || (user.phone ? [user.phone] : []);
      const needsPhone = !!session.customerPhone && !currentPhones.includes(session.customerPhone);

      // Sincroniza a foto do WhatsApp com o cadastro, só se ele ainda não tiver avatar
      // (não sobrescreve uma foto definida manualmente).
      let newAvatarUrl: string | null = null;
      if (!user.avatarUrl) {
        newAvatarUrl = await fetchWhatsappContactPhoto();
      }

      if (needsPhone || newAvatarUrl) {
        await UserService.save({
          ...user,
          phones: needsPhone ? [...currentPhones, session.customerPhone!] : currentPhones,
          phone: user.phone || session.customerPhone,
          avatarUrl: newAvatarUrl || user.avatarUrl
        });
      }

      // Update chat session
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set-session-contact',
          sessionId: session.id,
          customerId: user.id,
          customerName: user.name
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Erro ao vincular o contato à conversa.');
      }

      onSuccess();
      onClose();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error && e.message ? e.message : 'Erro ao associar contato.');
    }
  };

  const handleCreateAndLink = async () => {
    if (!session || !newName) return;

    // E-mail é opcional, mas quando preenchido precisa ser válido — e o
    // contato já nasce com ele (login e avisos por e-mail).
    const emailToSave = newEmail.trim();
    if (emailToSave && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailToSave)) {
      toast.error('Informe um e-mail válido ou deixe o campo em branco.');
      return;
    }
    
    let finalCompanyId = newCompanyId;
    
    try {
      if (isCreatingNewCompany && newCompanyName) {
        const newCompany = await CompanyService.create({
          id: crypto.randomUUID(),
          name: newCompanyName,
          industry: '',
          phone: ''
        });
        finalCompanyId = newCompany.id;
      }

      if (!finalCompanyId) {
        toast.error("Selecione ou crie uma empresa.");
        return;
      }

      // E-mail opcional (vazio vira NULL na rota). Antes gerava-se um
      // endereço fictício `contact_${Date.now()}@placeholder.com` só para
      // satisfazer a coluna obrigatória — e como ele nunca se repetia, o
      // sistema NUNCA avisava que a pessoa já estava cadastrada: cada
      // vinculação criava mais um perfil da mesma pessoa, espalhando histórico
      // de chamados e conversas entre cadastros diferentes.
      // A coluna passou a ser opcional (migrations/profiles_email_opcional.sql).
      const { id: newUserId, error } = await createUser(
        emailToSave,
        newName,
        UserRole.EMPLOYEE,
        finalCompanyId,
        session.customerPhone ? [session.customerPhone] : [],
        false
      );

      if (error) {
        throw new Error(error);
      }

      if (newUserId) {
        // Re-load employees list e usa o resultado fresco (o estado `users`
        // só seria atualizado no próximo render, tarde demais para o find abaixo).
        const emps = await UserService.getEmployees();
        setUsers(emps);
        const newUser = emps.find(u => u.id === newUserId);
        if (!newUser) {
          throw new Error('Usuário criado, mas não foi possível localizá-lo para vincular.');
        }
        await handleLink(newUser);
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Erro ao criar e associar contato: ' + e.message);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-[var(--surface-card)] w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden border border-[var(--border-default)]"
          >
            <div className="bg-slate-900 px-8 py-6 text-white flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black tracking-tight">Vincular Contato</h3>
                <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">
                  Número: {maskPhone(session?.customerPhone || '')}
                </p>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors text-[var(--text-tertiary)]">
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-6">
              {historyId && otherUnlinkedCount > 0 && (
                <label className="flex items-start gap-3 p-3 bg-[var(--surface-pill)] rounded-2xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyToSamePhone}
                    onChange={(e) => setApplyToSamePhone(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                  />
                  <span className="text-xs font-bold text-[var(--text-secondary)] leading-relaxed">
                    Vincular também as outras {otherUnlinkedCount} {otherUnlinkedCount === 1 ? 'conversa' : 'conversas'} deste número que ainda não têm cliente
                  </span>
                </label>
              )}

              <div className="flex bg-[var(--surface-pill)] p-1 rounded-2xl">
                <button
                  onClick={() => setIsCreatingNew(false)}
                  className={cn(
                    "flex-1 py-2 text-[10px] font-semibold uppercase tracking-widest rounded-xl transition-all",
                    !isCreatingNew ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-tertiary)]"
                  )}
                >
                  Pesquisar Existente
                </button>
                <button
                  onClick={() => setIsCreatingNew(true)}
                  className={cn(
                    "flex-1 py-2 text-[10px] font-semibold uppercase tracking-widest rounded-xl transition-all",
                    isCreatingNew ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-tertiary)]"
                  )}
                >
                  Criar Novo
                </button>
              </div>

              {isCreatingNew ? (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Nome</label>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Nome completo"
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">E-mail (opcional)</label>
                    <input
                      type="email"
                      inputMode="email"
                      autoComplete="off"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="contato@empresa.com.br"
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between ml-1">
                      <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Empresa</label>
                      <button
                        onClick={() => setIsCreatingNewCompany(!isCreatingNewCompany)}
                        className="text-[9px] font-semibold uppercase text-[var(--accent-text)] hover:underline"
                      >
                        {isCreatingNewCompany ? 'Selecionar Existente' : '+ Nova Empresa'}
                      </button>
                    </div>
                    {isCreatingNewCompany ? (
                      <input
                        type="text"
                        value={newCompanyName}
                        onChange={(e) => setNewCompanyName(e.target.value)}
                        placeholder="Nome da nova empresa"
                        className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                      />
                    ) : (
                      <StyledSelect
                        value={newCompanyId}
                        onChange={(e) => setNewCompanyId(e.target.value)}
                        className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all appearance-none"
                      >
                        <option value="">Selecione uma empresa</option>
                        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </StyledSelect>
                    )}
                  </div>
                  <button
                    onClick={() => runBusy('create', handleCreateAndLink)}
                    disabled={!!busy || !newName || (isCreatingNewCompany ? !newCompanyName : !newCompanyId)}
                    className="w-full py-4 bg-[var(--text-success)] text-white text-[10px] font-semibold uppercase tracking-widest rounded-2xl shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {busy === 'create' && <Loader2 size={14} className="animate-spin" />}
                    {busy === 'create' ? 'Vinculando...' : 'Criar e Vincular'}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={18} />
                    <input
                      type="text"
                      placeholder="Buscar por nome ou telefone..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl pl-12 pr-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                    />
                  </div>

                  <div className="max-h-60 overflow-y-auto space-y-2 pr-2 scrollbar-thin scrollbar-thumb-slate-200">
                    {filteredUsers.map(u => (
                      <button
                        key={u.id}
                        onClick={() => runBusy(u.id, () => handleLink(u))}
                        disabled={!!busy}
                        className="w-full flex items-center justify-between p-3 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 transition-all group disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-[var(--surface-pill)] flex items-center justify-center text-[var(--text-tertiary)] font-bold text-xs uppercase tracking-tighter group-hover:bg-[var(--accent)] group-hover:text-white transition-all">
                            {u.name.charAt(0)}
                          </div>
                          <div className="text-left">
                            <p className="text-xs font-black text-[var(--text-secondary)]">{u.name}</p>
                            <p className="text-[10px] font-bold text-[var(--text-tertiary)] truncate w-40">
                               {companies.find(c => c.id === u.companyId)?.name}
                            </p>
                          </div>
                        </div>
                        {busy === u.id
                          ? <Loader2 size={16} className="text-[var(--accent-text)] animate-spin" />
                          : <Check size={16} className="text-[var(--accent-text)] opacity-0 group-hover:opacity-100" />}
                      </button>
                    ))}
                    {filteredUsers.length === 0 && (
                      <p className="text-xs text-[var(--text-tertiary)] italic text-center py-4">Nenhum colaborador encontrado.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}


