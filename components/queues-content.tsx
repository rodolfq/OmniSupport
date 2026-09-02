'use client';

import React, { useState, useEffect } from 'react';
import { StyledSelect } from '@/components/styled-select';
import { UserAvatar } from '@/components/user-avatar';
import { User, Queue, WhatsappInstance, Permission, AnalystStatus } from '@/lib/types';
import { UserService } from '@/lib/services/user-service';
import { fetchAnalystStatuses } from '@/lib/services/config-service';
import { deriveLiveStatus } from '@/lib/presence';
import { updateUserStatus } from '@/lib/services/user-actions-service';
import { getWhatsappInstances } from '@/lib/services/whatsapp-instance-service';
// Migrado para rota HTTP (/api/queues) na separação front/back.
import { getQueues, saveQueue, deleteQueue } from '@/lib/services/queue-service';
import {
  Library,
  Plus,
  Search,
  Users,
  Globe,
  Trash2,
  Edit2,
  XCircle,
  Smartphone,
  CheckCircle2,
  Settings2,
  AlertTriangle,
  Power,
  X,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useApp } from '@/app/app-context';
import { toast } from 'sonner';

/**
 * Conteúdo da aba "Filas" em Configurações. Era a página /queues — migrada
 * pra dentro de Configurações (ver app/(portal)/settings/page.tsx); a rota
 * antiga agora só redireciona pra cá.
 */
export function QueuesContent() {
  const [queues, setQueues] = useState<Queue[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [analystStatuses, setAnalystStatuses] = useState<Map<string, AnalystStatus>>(new Map());
  const [whatsappInstances, setWhatsappInstances] = useState<WhatsappInstance[]>([]);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedQueue, setSelectedQueue] = useState<Queue | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedWhatsappId, setSelectedWhatsappId] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [includeInternalChats, setIncludeInternalChats] = useState(true);
  const [routingStrategy, setRoutingStrategy] = useState('round_robin');
  const [deletingQueue, setDeletingQueue] = useState<Queue | null>(null);
  const [kickingMember, setKickingMember] = useState<{ id: string; name: string } | null>(null);

  // Seletor de membros do modal: busca paginada no servidor (com foto) em
  // vez de listar todos os analistas de uma vez — ver UserService.searchAnalysts.
  const MEMBER_PAGE_SIZE = 12;
  const [memberSearch, setMemberSearch] = useState('');
  const [debouncedMemberSearch, setDebouncedMemberSearch] = useState('');
  const [memberPage, setMemberPage] = useState(1);
  const [memberResults, setMemberResults] = useState<User[]>([]);
  const [memberTotal, setMemberTotal] = useState(0);
  const [memberSearchLoading, setMemberSearchLoading] = useState(false);
  // Cache de usuários já vistos (por busca ou pré-carregados por id), para
  // mostrar nome/foto de quem está selecionado mas não está na página atual.
  const [memberDetails, setMemberDetails] = useState<Record<string, User>>({});

  const { hasPermission, currentUser } = useApp();

  useEffect(() => {
    loadData();
  }, []);

  // A ordem do rodízio (queue_anchor_at) e a bolinha de status de cada
  // membro podem mudar a qualquer momento por causa de outra pessoa (login,
  // "Ausente", derrubar login) — sem isso, quem tem a tela de Filas aberta
  // só via a mudança ao navegar pra outro lugar e voltar. Só a chamada mais
  // leve (analyst-statuses) é repetida; filas/usuários/instâncias não mudam
  // com essa frequência e continuam recarregando via loadData() nas ações.
  useEffect(() => {
    const refreshStatuses = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const statuses: AnalystStatus[] = await fetchAnalystStatuses();
        setAnalystStatuses(new Map(statuses.map(s => [s.userId, s])));
      } catch (e) {
        console.error('Error refreshing analyst statuses:', e);
      }
    };
    const interval = setInterval(refreshStatuses, 10000);
    document.addEventListener('visibilitychange', refreshStatuses);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshStatuses);
    };
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedMemberSearch(memberSearch), 250);
    return () => clearTimeout(handler);
  }, [memberSearch]);

  useEffect(() => {
    if (!isModalOpen) return;
    let cancelled = false;
    const run = async () => {
      setMemberSearchLoading(true);
      try {
        const { items, total } = await UserService.searchAnalysts(debouncedMemberSearch, memberPage, MEMBER_PAGE_SIZE);
        if (cancelled) return;
        setMemberResults(items);
        setMemberTotal(total);
        setMemberDetails(prev => {
          const next = { ...prev };
          items.forEach(u => { next[u.id] = u; });
          return next;
        });
      } catch (e) {
        console.error('Error searching analysts:', e);
      } finally {
        if (!cancelled) setMemberSearchLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [isModalOpen, debouncedMemberSearch, memberPage]);

  const loadData = async () => {
    try {
      const dbQueues = await getQueues();
      // Única tela que exibe a foto dos membros (MemberAvatar), então aqui a
      // foto é pedida de propósito — nas demais ela não vem, ver UserService.
      const emps = await UserService.getAnalysts({ withAvatar: true });
      const dbInstances = await getWhatsappInstances();
      const statuses: AnalystStatus[] = await fetchAnalystStatuses();
      setAnalystStatuses(new Map(statuses.map(s => [s.userId, s])));

      if (dbQueues) {
        setQueues(dbQueues.map(q => ({
          id: q.id,
          name: q.name,
          description: q.description || '',
          whatsappInstanceId: q.whatsappInstanceId || '',
          memberIds: q.memberIds || [],
          includeInternalChats: q.includeInternalChats !== false,
          routingStrategy: q.routingStrategy || 'round_robin',
          createdAt: (q as any).createdAt
        })));
      }
      setUsers(emps);
      if (dbInstances) {
        setWhatsappInstances(dbInstances.map(i => ({
          id: i.id,
          name: i.name,
          phone: i.phone || '',
          status: i.status || 'disconnected',
          provider: i.provider || 'baileys'
        })));
      }
    } catch (e) {
      console.error("Error loading queues management data:", e);
    }
  };

  const handleOpenModal = (queue?: Queue) => {
    if (queue) {
      setSelectedQueue(queue);
      setName(queue.name);
      setDescription(queue.description || '');
      setSelectedWhatsappId(queue.whatsappInstanceId || '');
      setSelectedMemberIds(queue.memberIds);
      setIncludeInternalChats(queue.includeInternalChats !== false);
      setRoutingStrategy(queue.routingStrategy || 'round_robin');
    } else {
      setSelectedQueue(null);
      setName('');
      setDescription('');
      setSelectedWhatsappId('');
      setSelectedMemberIds([]);
      setIncludeInternalChats(true);
      setRoutingStrategy('round_robin');
    }

    // Reseta o seletor de membros e pré-carrega (com foto) só quem já está
    // na fila, pra aparecer nos chips de selecionados mesmo fora da 1ª página.
    setMemberSearch('');
    setDebouncedMemberSearch('');
    setMemberPage(1);
    setMemberResults([]);
    setMemberTotal(0);
    setMemberDetails({});
    if (queue && queue.memberIds.length > 0) {
      UserService.getAnalystsByIds(queue.memberIds).then(list => {
        setMemberDetails(prev => {
          const next = { ...prev };
          list.forEach(u => { next[u.id] = u; });
          return next;
        });
      });
    }

    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!name) return;

    const id = selectedQueue?.id || null;
    const res = await saveQueue(
      id,
      name,
      description,
      selectedWhatsappId || null,
      selectedMemberIds,
      includeInternalChats,
      routingStrategy
    );

    if (res && (res as any).error) {
      console.error("Error saving queue:", (res as any).error);
      toast.error((res as any).error || "Erro ao salvar fila.");
      return;
    }

    loadData();
    setIsModalOpen(false);
  };

  const toggleMember = (userId: string) => {
    setSelectedMemberIds(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  // "Derrubar login": tira alguém preso como Online/Ausente sem estar de
  // fato disponível, liberando a posição dele no rodízio. Só derruba pra
  // Offline — o backend (updateUserStatus) recusa qualquer tentativa de
  // colocar outra pessoa como Online, então isso nunca vira uma forma de
  // "furar" a fila colocando um colega disponível por ele.
  const handleKickOffline = async () => {
    if (!kickingMember) return;
    const res = await updateUserStatus(kickingMember.id, false);
    if (res && (res as any).error) {
      toast.error((res as any).error);
      setKickingMember(null);
      return;
    }
    toast.success(`${kickingMember.name} foi desconectado da fila.`);
    setKickingMember(null);
    loadData();
  };

  // Mesma bolinha de status usada no chat/equipe — verde pulsando (online),
  // âmbar (ausente/pausa), cinza (offline). "Ausente" não sai do lugar na
  // lista: continua na mesma posição do member_ids, só muda de cor (a
  // ordem-base nunca é reescrita por mudança de status, só pela edição da
  // fila em si — ver lib/services/queue-routing.ts).
  const statusDotClass = (status?: string) => {
    if (status === 'online') return 'bg-[var(--text-success)] animate-pulse';
    if (status === 'away') return 'bg-[var(--text-warning-strong)]';
    return 'bg-[var(--text-tertiary)]';
  };
  const statusLabel = (status?: string) => {
    if (status === 'online') return 'Disponível';
    if (status === 'away') return 'Ausente';
    return 'Offline';
  };

  // Sinalização pro admin de padrão estranho de troca de status (não bloqueia
  // nada — só chama atenção). Contagem já ignora repetição do heartbeat de
  // 60s (ver app/api/config/route.ts, type=analyst-statuses).
  const STATUS_CHANGES_ALERT_THRESHOLD = 8;

  // Ordem de exibição = ordem real do rodízio: quem ficou online primeiro
  // hoje aparece primeiro (queue_anchor_at), não mais a ordem de cadastro em
  // member_ids — ver lib/services/queue-routing.ts. Quem está ausente/offline
  // fica depois, na ordem de cadastro original.
  const orderedMemberIds = (memberIds: string[]) => {
    const online: string[] = [];
    const rest: string[] = [];
    for (const id of memberIds) {
      if (deriveLiveStatus(analystStatuses.get(id)) === 'online') online.push(id);
      else rest.push(id);
    }
    online.sort((a, b) => {
      const anchorA = analystStatuses.get(a)?.queueAnchorAt;
      const anchorB = analystStatuses.get(b)?.queueAnchorAt;
      return new Date(anchorA ?? 0).getTime() - new Date(anchorB ?? 0).getTime();
    });
    return [...online, ...rest];
  };

  // Sempre prefere a miniatura (avatar_thumb_url, ~1,3kB) à foto cheia — só
  // cai pra ela quando a pessoa ainda não tem miniatura gerada. Sem foto
  // nenhuma, cai pra inicial colorida.
  const MemberAvatar = ({ user, selected, className }: { user?: Pick<User, 'name' | 'avatarUrl' | 'avatarThumbUrl'>; selected?: boolean; className?: string }) => (
    (user?.avatarThumbUrl || user?.avatarUrl) ? (
      <img
        src={user!.avatarThumbUrl || user!.avatarUrl}
        alt={user?.name}
        className={cn("rounded-xl object-cover shrink-0", className)}
      />
    ) : (
      <div className={cn(
        "rounded-xl flex items-center justify-center font-black shrink-0",
        selected ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-card)] text-[var(--text-tertiary)]",
        className
      )}>
        {user?.name?.charAt(0) || '?'}
      </div>
    )
  );

  const filteredQueues = queues.filter(q =>
    q.name.toLowerCase().includes(search.toLowerCase()) ||
    q.description?.toLowerCase().includes(search.toLowerCase())
  );

  if (!hasPermission(Permission.QUEUES_MANAGE)) {
     return (
       <div className="flex flex-col items-center justify-center p-20 text-center">
         <XCircle size={48} className="text-[var(--text-danger)] mb-4" />
         <h2 className="text-2xl font-black text-[var(--text-primary)] uppercase tracking-tight">Acesso Negado</h2>
         <p className="text-[var(--text-tertiary)]">Você não tem permissão para gerenciar as filas de atendimento.</p>
       </div>
     );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-[var(--text-primary)] tracking-tight flex items-center gap-3">
            <Library className="text-[var(--accent-text)]" size={32} />
            Gestão de Filas
          </h2>
          <p className="text-[var(--text-tertiary)] font-medium">Configure departamentos e vincule instâncias de WhatsApp</p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white px-6 py-3 rounded-2xl text-sm font-black uppercase tracking-widest shadow-lg shadow-indigo-200 transition-all flex items-center gap-2"
        >
          <Plus size={18} />
          Nova Fila
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Statistics/Quick Actions */}
        <div className="xl:col-span-1 space-y-6">
           <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2.5rem] p-8 shadow-sm">
              <h3 className="text-xs font-black uppercase text-[var(--text-tertiary)] tracking-widest mb-6">Resumo de Ativos</h3>
              <div className="space-y-4">
                 <div className="flex items-center justify-between p-4 bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)]">
                    <div className="flex items-center gap-3">
                       <Library size={18} className="text-[var(--accent-text)]" />
                       <span className="text-sm font-bold text-[var(--text-secondary)]">Filas Ativas</span>
                    </div>
                    <span className="text-xl font-black text-[var(--text-primary)]">{queues.length}</span>
                 </div>
                 <div className="flex items-center justify-between p-4 bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)]">
                    <div className="flex items-center gap-3">
                       <Smartphone size={18} className="text-[var(--text-success)]" />
                       <span className="text-sm font-bold text-[var(--text-secondary)]">Conexões WhatsApp</span>
                    </div>
                    <span className="text-xl font-black text-[var(--text-primary)]">{whatsappInstances.length}</span>
                 </div>
                 <div className="flex items-center justify-between p-4 bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)]">
                    <div className="flex items-center gap-3">
                       <Users size={18} className="text-[var(--text-info)]" />
                       <span className="text-sm font-bold text-[var(--text-secondary)]">Equipe Alocada</span>
                    </div>
                    <span className="text-xl font-black text-[var(--text-primary)]">
                       {new Set(queues.flatMap(q => q.memberIds)).size}
                    </span>
                 </div>
              </div>
           </div>

           <div className="bg-[var(--accent)] rounded-[2.5rem] p-8 shadow-xl shadow-indigo-100 text-white relative overflow-hidden">
              <div className="relative z-10">
                 <h3 className="text-lg font-black uppercase tracking-tight mb-2">Multi-Instance</h3>
                 <p className="text-xs text-indigo-100 dark:text-[var(--accent-soft-text)] font-medium leading-relaxed mb-6 opacity-80">
                    Cada fila pode ter sua própria conexão WhatsApp independente, permitindo segregar atendimentos por DDD ou departamento.
                 </p>
                 <button className="w-full py-4 bg-white/20 hover:bg-white/30 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all backdrop-blur-md">
                    Ver logs de roteamento
                 </button>
              </div>
              <Globe className="absolute -right-10 -bottom-10 w-40 h-40 text-white/10" />
           </div>

           <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2.5rem] p-8 shadow-sm">
              <h3 className="text-xs font-black uppercase text-[var(--text-tertiary)] tracking-widest mb-4 flex items-center gap-2">
                 <Users size={16} className="text-[var(--accent-text)]" />
                 Como a fila distribui os atendimentos
              </h3>
              <div className="space-y-3 text-xs text-[var(--text-secondary)] font-medium leading-relaxed">
                 <p>
                    A estratégia de distribuição é configurável por fila (campo &quot;Estratégia de Distribuição&quot; no formulário). Duas opções hoje: <strong className="text-[var(--text-primary)]">Rodízio</strong>, descrita abaixo, e <strong className="text-[var(--text-primary)]">Equilíbrio diário</strong>, que manda cada novo atendimento pra quem tem menos chats recebidos no dia (todos os canais somados), nivelando a carga ao longo do turno em vez de seguir só a ordem fixa.
                 </p>
                 <p>
                    No <strong className="text-[var(--text-primary)]">Rodízio (round-robin)</strong>, a distribuição é entre quem está online agora dentro da equipe da fila — não existe fila de espera visual nem prioridade manual: quem vai ficando <strong className="text-[var(--text-primary)]">online vai entrando no rodízio</strong> e passa a receber a próxima conversa na sua vez.
                 </p>
                 <p>
                    A ordem é definida por quem ficou <strong className="text-[var(--text-primary)]">online primeiro no dia</strong>, não pela ordem de cadastro na fila. Cada novo atendimento vai para o próximo da vez depois de quem recebeu o último. Ficar Ausente ou fechar o navegador não manda a pessoa pro fim da fila — só a virada do dia reseta a posição de cada um.
                 </p>
                 <p>
                    <strong className="text-[var(--text-primary)]">Chat de WhatsApp e chat de login do funcionário (widget do portal) entram no mesmo rodízio</strong>: quem acabou de receber um pelo WhatsApp não é o próximo também a receber um de login, e vice-versa — os dois canais contam para a mesma vez na fila.
                 </p>
                 <p>
                    Marcar <strong className="text-[var(--text-primary)]">Ausente</strong> tira a pessoa do rodízio (não recebe chat novo) sem perder o lugar dela na ordem — ela volta a participar normalmente ao ficar Online de novo, sem ir pro fim da fila. Só some de vez da rotação ao ficar Offline (fim da jornada).
                 </p>
                 <p>
                    Se ninguém da equipe estiver online, o atendimento fica pendente para atribuição manual.
                 </p>
                 <p>
                    Chats do widget do portal (sem número de WhatsApp) não pertencem a uma fila só: quando &quot;Recebe chats internos&quot; está ativado, a fila entra num rodízio combinado com todas as outras filas que também ativaram essa opção.
                 </p>
              </div>
           </div>
        </div>

        {/* Queues List */}
        <div className="xl:col-span-2 space-y-6">
           <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2.5rem] shadow-sm overflow-hidden">
              <div className="p-6 border-b border-[var(--border-default)] bg-[var(--surface-card)]/30">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={18} />
                  <input
                    type="text"
                    placeholder="Filtrar filas por nome ou descrição..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl pl-12 pr-4 py-3 text-sm font-medium focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="divide-y divide-[var(--border-default)]">
                {filteredQueues.map((queue) => {
                  const instance = whatsappInstances.find(i => i.id === queue.whatsappInstanceId);
                  return (
                    <div key={queue.id} className="p-8 hover:bg-[var(--surface-card)]/50 transition-colors group">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div className="flex items-start gap-4">
                           <div className="w-16 h-16 bg-[var(--surface-card)] rounded-[1.5rem] border border-[var(--border-default)] flex items-center justify-center text-[var(--text-tertiary)] group-hover:text-[var(--accent-text)] transition-colors">
                              <Library size={32} />
                           </div>
                           <div>
                              <h4 className="text-xl font-black text-[var(--text-primary)] tracking-tight uppercase leading-none mb-2">{queue.name}</h4>
                              <p className="text-sm text-[var(--text-tertiary)] font-medium mb-3">{queue.description}</p>

                              <div className="flex flex-wrap gap-2">
                                 {instance ? (
                                   <div className={cn(
                                     "flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-semibold uppercase tracking-widest",
                                     instance.status === 'connected' ? "bg-[var(--surface-success)] text-[var(--text-success)] border border-[var(--text-success)]/20" : "bg-[var(--surface-danger)] text-[var(--text-danger)] border border-[var(--text-danger)]/20"
                                   )}>
                                      <Smartphone size={12} /> {instance.name} ({instance.phone})
                                   </div>
                                 ) : (
                                   <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--surface-card)] text-[var(--text-tertiary)] border border-[var(--border-default)] text-[10px] font-semibold uppercase tracking-widest">
                                      <Globe size={12} /> Sem WhatsApp Vinculado
                                   </div>
                                 )}
                                 <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent-text)] border border-[var(--accent)]/20 text-[10px] font-semibold uppercase tracking-widest">
                                    <Users size={12} /> {queue.memberIds.length} Analistas
                                 </div>
                                 {queue.includeInternalChats === false && (
                                   <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--surface-card)] text-[var(--text-tertiary)] border border-[var(--border-default)] text-[10px] font-semibold uppercase tracking-widest">
                                      <XCircle size={12} /> Sem Chat Interno
                                   </div>
                                 )}
                                 {queue.routingStrategy === 'daily_balance' && (
                                   <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--surface-warning)] text-[var(--text-warning)] border border-[var(--border-alert)] text-[10px] font-semibold uppercase tracking-widest">
                                      <Settings2 size={12} /> Equilíbrio Diário
                                   </div>
                                 )}
                              </div>
                           </div>
                        </div>

                        <div className="flex items-center gap-3">
                           <button
                             onClick={() => handleOpenModal(queue)}
                             className="p-3 text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:bg-[var(--accent)]/10 rounded-2xl transition-all"
                             title="Editar Fila"
                           >
                             <Edit2 size={20} />
                           </button>
<button
                              onClick={() => setDeletingQueue(queue)}
                              className="p-3 text-[var(--text-tertiary)] hover:text-[var(--text-danger)] hover:bg-[var(--surface-danger)] rounded-2xl transition-all"
                              title="Excluir Fila"
                            >
                              <Trash2 size={20} />
                            </button>
                        </div>
                      </div>

                      {/* Ordem real do rodízio: quem ficou online primeiro hoje
                          aparece primeiro (queue_anchor_at) — não mais a ordem
                          de cadastro. Quem está "Ausente" continua contando pra
                          posição quando volta a ficar Online no mesmo dia, só
                          não recebe atendimento novo enquanto ausente. */}
                      <div className="mt-8 flex flex-col gap-2">
                         {orderedMemberIds(queue.memberIds).map((mid, idx) => {
                           const user = users.find(u => u.id === mid);
                           if (!user) return null;
                           const analystStatus = analystStatuses.get(mid);
                           const status = deriveLiveStatus(analystStatus);
                           const changesToday = analystStatus?.statusChangesToday ?? 0;
                           const flagged = changesToday >= STATUS_CHANGES_ALERT_THRESHOLD;
                           return (
                             <div key={mid} title={statusLabel(status)} className="flex items-center gap-3 p-2.5 bg-[var(--surface-card)] rounded-xl border border-[var(--border-default)] shadow-sm min-w-0">
                                <span className="text-[9px] font-black text-[var(--text-tertiary)] w-3 shrink-0 text-center">{status === 'online' ? idx + 1 : '–'}</span>
                                <div className="relative shrink-0">
                                   <UserAvatar
                                     name={user.name}
                                     thumbUrl={user.avatarThumbUrl}
                                     size={24}
                                     rounded="rounded-lg"
                                     className="text-[10px] font-black"
                                     fallbackClassName="bg-[var(--accent)]/10 text-[var(--accent-text)]"
                                   />
                                   <span className={cn("absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[var(--surface-card)]", statusDotClass(status))} />
                                </div>
                                <span className="text-[11px] font-bold text-[var(--text-secondary)] flex-1 min-w-0 break-words">{user.name}</span>
                                {flagged && (
                                  <span title={`${changesToday} trocas de status hoje`} className="shrink-0">
                                    <AlertTriangle size={12} className="text-[var(--text-warning-strong)]" />
                                  </span>
                                )}
                                {/* Derruba o login (força Offline) de quem ficou preso
                                    como Online/Ausente sem estar de fato disponível,
                                    liberando a vaga dele no rodízio. Também vale pra si
                                    mesmo (desconectar rápido sem trocar de tela). Nunca o
                                    contrário — só o próprio usuário pode se colocar
                                    Online, o backend recusa a troca inversa mesmo se
                                    tentada por outra pessoa. */}
                                {status !== 'offline' && (
                                  <button
                                    type="button"
                                    onClick={() => setKickingMember({ id: mid, name: user.name })}
                                    title={mid === currentUser?.id ? 'Desconectar (marca como Offline)' : 'Derrubar login (marca como Offline)'}
                                    className="shrink-0 p-1 text-[var(--text-tertiary)] hover:text-[var(--text-danger)] hover:bg-[var(--surface-danger)] rounded-md transition-all"
                                  >
                                    <Power size={12} />
                                  </button>
                                )}
                             </div>
                           );
                         })}
                      </div>
                    </div>
                  );
                })}
              </div>
           </div>
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[var(--surface-card)] w-full max-w-4xl rounded-[3rem] shadow-2xl overflow-hidden flex flex-col md:flex-row h-[90vh] md:h-auto md:max-h-[85vh]"
            >
              {/* Sidebar do Modal */}
              <div className="w-full md:w-72 bg-[var(--surface-card)] border-r border-[var(--border-default)] p-8 flex flex-col">
                 <div className="w-16 h-16 bg-[var(--accent)] rounded-[1.5rem] flex items-center justify-center text-white mb-6 shadow-xl shadow-indigo-100">
                    <Library size={32} />
                 </div>
                 <h3 className="text-2xl font-black text-[var(--text-primary)] tracking-tight uppercase leading-none mb-4">
                   {selectedQueue ? 'Editar Fila' : 'Nova Fila'}
                 </h3>
                 <p className="text-xs text-[var(--text-tertiary)] font-medium leading-relaxed mb-auto">
                   As filas organizam o fluxo de trabalho e permitem automatizar o roteamento de chats.
                 </p>
                 <div className="mt-8 space-y-4">
                    <div className="flex items-center gap-3 text-xs font-black uppercase text-[var(--accent-text)]">
                       <CheckCircle2 size={16} /> Identificação
                    </div>
                    <div className={cn("flex items-center gap-3 text-xs font-black uppercase", selectedWhatsappId ? "text-[var(--accent-text)]" : "text-[var(--text-tertiary)]")}>
                       <Smartphone size={16} /> WhatsApp
                    </div>
                    <div className={cn("flex items-center gap-3 text-xs font-black uppercase", selectedMemberIds.length > 0 ? "text-[var(--accent-text)]" : "text-[var(--text-tertiary)]")}>
                       <Users size={16} /> Equipe
                    </div>
                 </div>
              </div>

              {/* Form Content */}
              {/* Corners próprios (não só do motion.div pai) — em alguns
                  navegadores o overflow-hidden do ancestral não recorta com
                  precisão a barra de rolagem nativa de um filho que rola,
                  fazendo ela "vazar" por cima do canto arredondado. */}
              <div className="flex-1 p-8 overflow-y-auto overflow-x-hidden bg-[var(--surface-card)] flex flex-col rounded-b-[3rem] md:rounded-b-none md:rounded-tr-[3rem] md:rounded-br-[3rem]">
                <div className="space-y-8 flex-1">
                   {/* Geral */}
                   <section className="space-y-4">
                      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] border-b border-[var(--border-default)] pb-2">Informações Gerais</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                         <div className="space-y-1.5">
                            <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Nome da Fila</label>
                            <input
                              type="text"
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-5 py-4 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                              placeholder="Ex: Comercial SP"
                            />
                         </div>
                         <div className="space-y-1.5">
                            <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Instância WhatsApp</label>
                            <StyledSelect
                              value={selectedWhatsappId}
                              onChange={(e) => setSelectedWhatsappId(e.target.value)}
                              className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-5 py-4 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all appearance-none"
                            >
                               <option value="">Nenhuma (Chat Interno apenas)</option>
                               {whatsappInstances.map(i => (
                                 <option key={i.id} value={i.id}>{i.name} ({i.phone})</option>
                               ))}
                            </StyledSelect>
                         </div>
                      </div>
                      <div className="space-y-1.5">
                         <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Estratégia de Distribuição</label>
                         <StyledSelect
                           value={routingStrategy}
                           onChange={(e) => setRoutingStrategy(e.target.value)}
                           className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-5 py-4 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all appearance-none"
                         >
                            <option value="round_robin">Rodízio (ordem de login)</option>
                            <option value="daily_balance">Equilíbrio diário (nivela chats do dia)</option>
                         </StyledSelect>
                      </div>
                      <div className="space-y-1.5">
                         <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Chats Internos (Widget)</label>
                         <button
                           type="button"
                           onClick={() => setIncludeInternalChats(prev => !prev)}
                           className={cn(
                             "w-full flex items-center justify-between gap-3 p-4 rounded-2xl border text-left transition-all",
                             includeInternalChats
                               ? "bg-[var(--accent)]/10 border-[var(--accent)]/30"
                               : "bg-[var(--surface-card)] border-[var(--border-default)]"
                           )}
                         >
                            <div className="flex items-center gap-3">
                               <Globe size={18} className={includeInternalChats ? "text-[var(--accent-text)]" : "text-[var(--text-tertiary)]"} />
                               <div>
                                  <p className="text-xs font-black uppercase text-[var(--text-primary)] leading-none mb-1">Recebe chats internos</p>
                                  <p className="text-[10px] text-[var(--text-tertiary)] font-medium">Conversas de usuário logado no portal, além do WhatsApp vinculado</p>
                               </div>
                            </div>
                            {includeInternalChats ? <CheckCircle2 size={18} className="text-[var(--accent-text)] shrink-0" /> : <XCircle size={18} className="text-[var(--text-tertiary)] shrink-0" />}
                         </button>
                      </div>
                      <div className="space-y-1.5">
                         <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Descrição / Notas Internas</label>
                         <textarea
                           value={description}
                           onChange={(e) => setDescription(e.target.value)}
                           className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-5 py-4 text-sm font-medium focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all resize-none h-24"
                           placeholder="Para que serve esta fila?"
                         />
                      </div>
                   </section>

                   {/* Equipe */}
                   <section className="space-y-4">
                      <div className="flex items-center justify-between border-b border-[var(--border-default)] pb-2">
                        <h4 className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">Escala da Equipe ({selectedMemberIds.length})</h4>
                        <p className="text-[10px] text-[var(--text-tertiary)] font-bold italic">Busque quem fará parte desta fila</p>
                      </div>

                      {selectedMemberIds.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                           {selectedMemberIds.map(id => {
                             const user = memberDetails[id];
                             return (
                               <div key={id} className="flex items-center gap-2 pl-1.5 pr-1 py-1 rounded-full bg-[var(--accent)]/10 border border-[var(--accent)]/30">
                                  <MemberAvatar user={user} selected className="w-6 h-6 text-[10px]" />
                                  <span className="text-[10px] font-black uppercase text-[var(--text-primary)] max-w-[9rem] truncate">{user?.name || '...'}</span>
                                  <button
                                    type="button"
                                    onClick={() => toggleMember(id)}
                                    title="Remover da fila"
                                    className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-danger)] rounded-full transition-all"
                                  >
                                     <X size={12} />
                                  </button>
                               </div>
                             );
                           })}
                        </div>
                      )}

                      <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={16} />
                        <input
                          type="text"
                          value={memberSearch}
                          onChange={(e) => { setMemberSearch(e.target.value); setMemberPage(1); }}
                          placeholder="Buscar por nome ou e-mail..."
                          className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl pl-11 pr-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                        />
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 min-h-[9rem]">
                         {memberSearchLoading ? (
                           <p className="col-span-full text-center py-6 text-xs font-bold text-[var(--text-tertiary)]">Buscando...</p>
                         ) : memberResults.length === 0 ? (
                           <p className="col-span-full text-center py-6 text-xs font-bold text-[var(--text-tertiary)]">Nenhum usuário encontrado.</p>
                         ) : (
                           memberResults.map(user => {
                             const selected = selectedMemberIds.includes(user.id);
                             return (
                               <button
                                 key={user.id}
                                 onClick={() => toggleMember(user.id)}
                                 className={cn(
                                   "p-2.5 rounded-2xl border text-left transition-all relative flex items-center gap-2",
                                   selected
                                     ? "bg-[var(--accent)]/10 border-[var(--accent)]/30 ring-2 ring-[var(--accent)]/10"
                                     : "bg-[var(--surface-card)] border-[var(--border-default)] hover:border-[var(--border-default)]"
                                 )}
                               >
                                  <div className="relative shrink-0">
                                    <MemberAvatar user={user} selected={selected} className="w-8 h-8 text-xs" />
                                    <span
                                      title={statusLabel(deriveLiveStatus(analystStatuses.get(user.id)))}
                                      className={cn("absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[var(--surface-card)]", statusDotClass(deriveLiveStatus(analystStatuses.get(user.id))))}
                                    />
                                  </div>
                                  <div className="min-w-0 flex-1 pr-3">
                                     <p className="text-[11px] font-black uppercase text-[var(--text-primary)] leading-tight mb-1 break-words">{user.name}</p>
                                     <p className="text-[9px] text-[var(--text-tertiary)] font-bold truncate">{user.role}</p>
                                  </div>
                                  {selected && (
                                    <div className="absolute top-1.5 right-1.5 text-[var(--accent-text)] shrink-0">
                                       <CheckCircle2 size={14} />
                                    </div>
                                  )}
                               </button>
                             );
                           })
                         )}
                      </div>

                      {memberTotal > MEMBER_PAGE_SIZE && (
                        <div className="flex items-center justify-between pt-1">
                           <button
                             type="button"
                             disabled={memberPage <= 1}
                             onClick={() => setMemberPage(p => Math.max(1, p - 1))}
                             className="flex items-center gap-1 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                           >
                              <ChevronLeft size={14} /> Anterior
                           </button>
                           <span className="text-[10px] font-bold text-[var(--text-tertiary)]">
                              Página {memberPage} de {Math.max(1, Math.ceil(memberTotal / MEMBER_PAGE_SIZE))}
                           </span>
                           <button
                             type="button"
                             disabled={memberPage >= Math.ceil(memberTotal / MEMBER_PAGE_SIZE)}
                             onClick={() => setMemberPage(p => p + 1)}
                             className="flex items-center gap-1 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                           >
                              Próxima <ChevronRight size={14} />
                           </button>
                        </div>
                      )}
                   </section>
                </div>

                <div className="mt-8 flex gap-3">
                  <button
                    onClick={() => setIsModalOpen(false)}
                    className="px-8 py-4 rounded-2xl text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] transition-all"
                  >
                    Descartar
                  </button>
                  <button
                    onClick={handleSave}
                    className="flex-1 px-8 py-4 bg-[var(--accent)] text-white rounded-2xl text-[10px] font-semibold uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all shadow-xl shadow-indigo-100"
                  >
                    Salvar Fila de Atendimento
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        isOpen={!!deletingQueue}
        onClose={() => setDeletingQueue(null)}
        onConfirm={async () => {
          if (deletingQueue) {
            const res = await deleteQueue(deletingQueue.id);

            if (res && res.error) {
              console.error("Error deleting queue:", res.error);
              toast.error(res.error || "Erro ao excluir fila.");
              return;
            }

            loadData();
            setDeletingQueue(null);
          }
        }}
        title="Excluir Fila"
        description={`Tem certeza que deseja remover a fila "${deletingQueue?.name}"? Todos os atendimentos vinculados continuarão no sistema.`}
        confirmLabel="Excluir"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={!!kickingMember}
        onClose={() => setKickingMember(null)}
        onConfirm={handleKickOffline}
        title={kickingMember?.id === currentUser?.id ? 'Desconectar' : 'Derrubar Login'}
        description={
          kickingMember?.id === currentUser?.id
            ? 'Deseja se desconectar? Você sai do rodízio de atendimento até fazer login de novo.'
            : `Deseja marcar ${kickingMember?.name || 'este analista'} como Offline? Ele sai do rodízio de atendimento até fazer login de novo.`
        }
        confirmLabel={kickingMember?.id === currentUser?.id ? 'Desconectar' : 'Derrubar Login'}
        variant="danger"
      />
    </div>
  );
}
