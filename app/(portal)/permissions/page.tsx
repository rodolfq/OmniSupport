'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Permission, RolePermission, User } from '@/lib/types';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/app/app-context';
import {
  ShieldCheck,
  Lock,
  Shield,
  ChevronRight,
  Info,
  Save,
  Undo2,
  Plus,
  X,
  Trash2,
  Search,
  Check,
  Users,
  UserCog,
  Pencil
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import {
  getRolePermissions, saveRolePermissionsById, renameAccessProfile, createAccessProfile,
  deleteRolePermission, updateUser,
  getInternalTeamsPageData, createInternalTeam, updateInternalTeamMeta, deleteInternalTeam,
  applyTeamMembership
} from '@/app/actions';
import { StyledSelect } from '@/components/styled-select';
import { toast } from 'sonner';

// Mesma regra usada no servidor (app/actions.ts createUser/updateUser): o
// tipo estrutural do usuário segue o Perfil de Acesso escolhido, não é uma
// escolha separada — perfil de equipe sempre vira 'Time Interno'. Espelha a
// função de mesmo nome em app/(portal)/team/page.tsx.
function deriveStructuralRole(profile?: RolePermission | null): string {
  if (!profile) return 'Equipe';
  if (profile.isSystem && (profile.name === 'Administrador' || profile.name === 'Equipe' || profile.name === 'Time Interno')) {
    return profile.name;
  }
  if (profile.internalTeamId) return 'Time Interno';
  return 'Equipe';
}

// Varredura completa de telas e funções do sistema — cada permissão daqui
// corresponde a uma tela ou ação real e checada em código (não é lista
// decorativa). Ver AUDITORIA no fim do arquivo pra rastrear onde cada uma é
// aplicada.
const permissionGroups = [
  {
    id: 'tickets',
    title: 'Chamados',
    permissions: [
      { id: Permission.TICKETS_READ, label: 'Visualizar chamados', desc: 'Permite ver a lista e detalhes de chamados (/tickets) — também libera a chave "Chamados" no Dashboard Geral' },
      { id: Permission.TICKETS_WRITE, label: 'Responder/Editar chamados', desc: 'Permite enviar respostas e editar campos de um chamado' },
      { id: Permission.TICKETS_ASSIGN, label: 'Atribuir responsável', desc: 'Permite mudar o analista responsável por um chamado' },
      { id: Permission.TICKETS_DELETE, label: 'Excluir chamados', desc: 'Permite remover chamados permanentemente' },
      { id: Permission.OUTSIDE_QUEUE_VIEW, label: 'Central de Atendimento', desc: 'Permite ver e atender a fila de chats do WhatsApp — widget flutuante e /chat-management' },
    ]
  },
  {
    id: 'internal',
    title: 'Tickets Internos',
    permissions: [
      { id: Permission.INTERNAL_TICKETS_VIEW, label: 'Visualizar ticket interno', desc: 'Permite ver tickets de operação interna da própria equipe — também libera a chave "Tickets Internos" no Dashboard Geral e em Meus Chamados' },
      { id: Permission.INTERNAL_TICKETS_EDIT, label: 'Criar/Editar ticket interno', desc: 'Permite criar tickets internos e editar os existentes' },
      { id: Permission.INTERNAL_TICKETS_VIEW_ALL, label: 'Ver de todas as equipes', desc: 'Sem isso, só vê tickets internos da(s) própria(s) equipe(s) — use para Suporte/Administração' },
    ]
  },
  {
    id: 'customers',
    title: 'Clientes',
    permissions: [
      { id: Permission.CUSTOMERS_READ, label: 'Visualizar clientes', desc: 'Permite ver a lista de empresas e contatos (/customers)' },
      { id: Permission.CUSTOMERS_WRITE, label: 'Gerenciar clientes', desc: 'Permite criar, editar e remover empresas clientes' },
    ]
  },
  {
    id: 'communication',
    title: 'Comunicação',
    permissions: [
      { id: Permission.CHAT_INTERNAL_VIEW, label: 'Chat interno', desc: 'Permite visualizar e participar das conversas internas da equipe' },
      { id: Permission.WHATSAPP_MANAGE, label: 'Conectar canais de WhatsApp', desc: 'Permite parear QR Code / configurar Meta API — mais sensível que só atender chats' },
    ]
  },
  {
    id: 'team',
    title: 'Equipe & Acessos',
    permissions: [
      { id: Permission.TEAM_READ, label: 'Visualizar equipe', desc: 'Permite ver a lista de analistas (/team)' },
      { id: Permission.TEAM_WRITE, label: 'Gerenciar analistas', desc: 'Permite criar, editar e remover analistas' },
      { id: Permission.TEAM_STATUS_MANAGE, label: 'Ausência / Histórico de status', desc: 'Permite ver o histórico de status e ausência de outros analistas' },
      { id: Permission.SETTINGS_WRITE, label: 'Equipes & Permissões', desc: 'Acesso a esta própria tela — perfis de acesso e administração de equipes' },
    ]
  },
  {
    id: 'settings',
    title: 'Configurações do Sistema',
    permissions: [
      { id: Permission.SETTINGS_SYSTEM, label: 'Geral do sistema', desc: 'Categorias, prioridades, SLAs e marcadores globais' },
      { id: Permission.SETTINGS_AUTOMATION, label: 'Mensagens automáticas', desc: 'Configurar respostas e disparos automáticos' },
      { id: Permission.SETTINGS_INTEGRATIONS, label: 'Integrações', desc: 'Gerenciar chaves e integrações externas' },
      { id: Permission.SETTINGS_EMAIL, label: 'E-mail (SMTP)', desc: 'Configurar servidor de envio de e-mail e testar conexão' },
      { id: Permission.QUEUES_MANAGE, label: 'Filas de atendimento', desc: 'Criar e configurar filas do WhatsApp (/queues)' },
      { id: Permission.HOTFIXES_MANAGE, label: 'Hotfixes / Janela de release', desc: 'Criar e gerenciar hotfixes, marcar publicação, ver alertas de atraso (/hotfixes)' },
    ]
  },
  {
    id: 'stats',
    title: 'Análise & Dados',
    permissions: [
      { id: Permission.DASHBOARD_VIEW, label: 'Dashboard principal', desc: 'Permite acessar a tela inicial com indicadores gerais — o conteúdo (Chamados/Tickets Internos) depende de ter também as permissões correspondentes' },
      { id: Permission.REPORTS_READ, label: 'Relatórios', desc: 'Permite acessar dashboards e dados estatísticos (/reports)' },
      { id: Permission.DASHBOARD_MANAGEMENT, label: 'Dashboard Gerencial', desc: 'Acesso à visão gerencial de métricas de atendimento (/dashboard/management) — nível acima do dashboard de time' },
      { id: Permission.REPORTS_INDIVIDUAL, label: 'Dados nominais por analista', desc: 'Permite ver relatórios com nome do analista associado, não só números agregados do time' },
      { id: Permission.REPORTS_EXPORT, label: 'Exportar relatórios', desc: 'Permite exportar relatórios em CSV/PDF' },
    ]
  }
];

interface Team {
  id: string;
  name: string;
  description?: string;
  memberIds: string[];
  adminIds: string[];
}

// Hoisted pra fora do componente de página de propósito: definir isso ali
// dentro fazia o React tratar como um componente novo a cada re-render do
// pai (ex: cada tecla digitada em qualquer campo da tela) e desmontar/remontar
// esse pedaço da árvore — com o motion.div do AddProfileForm isso repetia a
// animação de entrada sem parar, piscando o formulário mesmo parado.
function ProfileButton({
  rp,
  selectedProfileId,
  selectProfile,
  isSystemAdmin,
  myAdminTeamIds,
  setProfileToDelete,
}: {
  rp: RolePermission;
  selectedProfileId: string | null;
  selectProfile: (id: string) => void;
  isSystemAdmin: boolean;
  myAdminTeamIds: string[];
  setProfileToDelete: (rp: RolePermission) => void;
}) {
  const canDelete = rp.name !== 'Administrador' && (isSystemAdmin || (!!rp.internalTeamId && myAdminTeamIds.includes(rp.internalTeamId)));
  return (
    <div className="relative group/role">
      <button
        onClick={() => selectProfile(rp.id)}
        className={cn(
          "w-full flex items-center justify-between p-4 rounded-2xl border transition-all text-left",
          // Reserva espaço pro botão de excluir (absoluto, por cima) não cair
          // em cima da seta de "selecionado" — sem isso os dois ícones
          // ocupavam o mesmo canto e ficavam misturados.
          canDelete && "pr-12",
          selectedProfileId === rp.id
            ? "bg-[var(--accent)] border-[var(--accent)] text-white shadow-lg shadow-indigo-100"
            : "bg-[var(--surface-card)] border-transparent hover:bg-[var(--surface-card)] text-[var(--text-secondary)]"
        )}
      >
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center transition-all",
            selectedProfileId === rp.id ? "bg-white/20 text-white" : "bg-[var(--surface-pill)] text-[var(--text-tertiary)]"
          )}>
            {rp.name === 'Administrador' ? <Shield size={16} /> : <div className="text-[10px] font-black">{(rp.name || 'P')[0]}</div>}
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-black uppercase tracking-tight">{rp.name || 'Perfil sem nome'}</span>
            <span className={cn("text-[10px] font-medium", selectedProfileId === rp.id ? "text-indigo-100 dark:text-[var(--accent-soft-text)]" : "text-[var(--text-tertiary)]")}>
              {rp.permissions.length} permissões
            </span>
          </div>
        </div>
        {selectedProfileId === rp.id && <ChevronRight size={16} className="shrink-0" />}
      </button>
      {canDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); setProfileToDelete(rp); }}
          className={cn(
            // pointer-events-none enquanto invisível — antes o botão continuava
            // capturando clique mesmo em opacity 0, "roubando" o clique de quem
            // queria selecionar o perfil (sem nunca abrir a confirmação de
            // exclusão, então parecia só que "não dava pra selecionar").
            "absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-xl transition-all opacity-0 pointer-events-none group-hover/role:opacity-100 group-hover/role:pointer-events-auto",
            selectedProfileId === rp.id ? "text-white/40 hover:text-white hover:bg-white/10" : "text-slate-300 hover:text-[var(--text-danger)] hover:bg-[var(--surface-danger)]"
          )}
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
}

function AddProfileForm({
  scopeKey,
  isAddingProfile,
  newProfileName,
  setNewProfileName,
  handleAddProfile,
  setIsAddingProfile,
}: {
  scopeKey: string | 'system';
  isAddingProfile: string | 'system' | null;
  newProfileName: string;
  setNewProfileName: (v: string) => void;
  handleAddProfile: () => void;
  setIsAddingProfile: (v: string | 'system' | null) => void;
}) {
  return (
    <AnimatePresence>
      {isAddingProfile === scopeKey && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="p-4 bg-[var(--accent)]/10 border border-[var(--accent)]/20 rounded-2xl space-y-3"
        >
          <input
            autoFocus
            type="text"
            placeholder="Novo perfil..."
            value={newProfileName}
            onChange={e => setNewProfileName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddProfile()}
            className="w-full bg-[var(--surface-card)] border border-[var(--accent)]/30 rounded-xl px-4 py-2 text-xs font-bold focus:ring-2 focus:ring-[var(--accent)]/20 outline-none"
          />
          <div className="flex gap-2">
            <button onClick={handleAddProfile} className="flex-1 bg-[var(--accent)] text-white rounded-lg py-2 text-[10px] font-black uppercase">Criar</button>
            <button onClick={() => { setIsAddingProfile(null); setNewProfileName(''); }} className="px-4 py-2 text-[var(--text-tertiary)] hover:bg-[var(--surface-card)] rounded-lg transition-all"><X size={16} /></button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function PermissionsManagementPage() {
  // Cache compartilhado (lib/query-hooks.ts) — avisado depois de mutações em
  // internal_teams pra useInternalTeamsQuery (usada em outras telas) não
  // ficar até 60s desatualizada. Esta tela continua com seu próprio
  // loadAll(), sem mudança de comportamento aqui.
  const queryClient = useQueryClient();
  const { currentUser, hasPermission, authInitialized } = useApp();
  const isSystemAdmin = currentUser?.role === 'Administrador';
  const myAdminTeamIds = useMemo(() => currentUser?.adminOfTeamIds || [], [currentUser?.adminOfTeamIds]);
  const canAccessPage = isSystemAdmin || myAdminTeamIds.length > 0 || hasPermission(Permission.SETTINGS_WRITE);
  // Admin de equipe só pode ver e conceder permissões que ele próprio tem —
  // nem sequer enxerga o resto da lista. Administrador do sistema continua
  // vendo tudo. A mesma regra é aplicada de novo no servidor
  // (saveRolePermissionsById): isso aqui é só a experiência da tela, não a
  // barreira de segurança de verdade.
  const myPermissions = useMemo(() => currentUser?.permissions || [], [currentUser?.permissions]);

  const [loading, setLoading] = useState(true);
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);

  // O que está selecionado no painel da direita: um perfil (telas/permissões)
  // ou o painel de membros/administradores de uma equipe — nunca os dois.
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [selectedMembersTeamId, setSelectedMembersTeamId] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddingProfile, setIsAddingProfile] = useState<string | 'system' | null>(null);
  const [newProfileName, setNewProfileName] = useState('');
  const [profileToDelete, setProfileToDelete] = useState<RolePermission | null>(null);

  // Equipe: criar / renomear / excluir
  const [showNewTeamModal, setShowNewTeamModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDescription, setNewTeamDescription] = useState('');
  const [editingTeamMeta, setEditingTeamMeta] = useState<Team | null>(null);
  const [teamToDelete, setTeamToDelete] = useState<Team | null>(null);

  // Membros, administradores e perfil de acesso da equipe selecionada
  const [editSelectedMembers, setEditSelectedMembers] = useState<string[]>([]);
  const [editSelectedAdmins, setEditSelectedAdmins] = useState<string[]>([]);
  const [editMemberProfiles, setEditMemberProfiles] = useState<Record<string, string>>({});
  const [memberSearch, setMemberSearch] = useState('');
  const [savingMembers, setSavingMembers] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      // Equipes e membros vêm prontos da action (já em camelCase, com a
      // composição de cada equipe derivada no servidor).
      const [perms, pageData] = await Promise.all([
        getRolePermissions(),
        getInternalTeamsPageData()
      ]);
      setRolePermissions(perms as RolePermission[]);
      setAllUsers(pageData.users as unknown as User[]);
      setTeams(pageData.teams);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canAccessPage) loadAll();
  }, [canAccessPage]);

  const currentProfile = useMemo(() =>
    rolePermissions.find(rp => rp.id === selectedProfileId),
    [rolePermissions, selectedProfileId]
  );

  const selectedMembersTeam = useMemo(() =>
    teams.find(t => t.id === selectedMembersTeamId),
    [teams, selectedMembersTeamId]
  );

  // Admin de equipe só enxerga/edita perfis e equipes que administra.
  // Administrador do sistema vê tudo, agrupado em Sistema + por equipe.
  const systemProfiles = useMemo(() =>
    isSystemAdmin ? rolePermissions.filter(rp => rp.isSystem) : [],
    [rolePermissions, isSystemAdmin]
  );

  const teamsToShow = useMemo(() => {
    if (isSystemAdmin) return teams;
    return teams.filter(t => myAdminTeamIds.includes(t.id));
  }, [teams, isSystemAdmin, myAdminTeamIds]);

  const profilesByTeam = useMemo(() => {
    const map = new Map<string, RolePermission[]>();
    rolePermissions.forEach(rp => {
      if (!rp.internalTeamId) return;
      if (!isSystemAdmin && !myAdminTeamIds.includes(rp.internalTeamId)) return;
      if (!map.has(rp.internalTeamId)) map.set(rp.internalTeamId, []);
      map.get(rp.internalTeamId)!.push(rp);
    });
    return map;
  }, [rolePermissions, isSystemAdmin, myAdminTeamIds]);

  const canEditCurrent = currentProfile
    ? isSystemAdmin
      ? currentProfile.name !== 'Administrador'
      : !currentProfile.isSystem && !!currentProfile.internalTeamId && myAdminTeamIds.includes(currentProfile.internalTeamId)
    : false;

  const visiblePermissionGroups = useMemo(() => {
    if (isSystemAdmin) return permissionGroups;
    return permissionGroups
      .map(group => ({ ...group, permissions: group.permissions.filter(p => myPermissions.includes(p.id)) }))
      .filter(group => group.permissions.length > 0);
  }, [isSystemAdmin, myPermissions]);

  const filteredGroups = useMemo(() => {
    if (!searchQuery) return visiblePermissionGroups;
    return visiblePermissionGroups.map(group => ({
      ...group,
      permissions: group.permissions.filter(p =>
        p.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.desc.toLowerCase().includes(searchQuery.toLowerCase())
      )
    })).filter(group => group.permissions.length > 0);
  }, [visiblePermissionGroups, searchQuery]);

  const selectProfile = (id: string) => {
    setSelectedProfileId(id);
    setSelectedMembersTeamId(null);
  };

  const selectMembersPanel = (team: Team) => {
    setEditSelectedMembers([...team.memberIds]);
    setEditSelectedAdmins([...team.adminIds]);
    const profileMap: Record<string, string> = {};
    team.memberIds.forEach(id => {
      profileMap[id] = allUsers.find(u => u.id === id)?.accessProfileId || '';
    });
    setEditMemberProfiles(profileMap);
    setMemberSearch('');
    setSelectedMembersTeamId(team.id);
    setSelectedProfileId(null);
  };

  const setMemberProfile = (memberId: string, profileId: string) => {
    setEditMemberProfiles(prev => ({ ...prev, [memberId]: profileId }));
  };

  const togglePermission = (permissionId: Permission) => {
    if (!canEditCurrent || !currentProfile) return;
    if (!isSystemAdmin && !myPermissions.includes(permissionId)) return;
    setRolePermissions(prev => prev.map(rp => {
      if (rp.id !== currentProfile.id) return rp;
      const hasPerm = rp.permissions.includes(permissionId);
      const newPerms = hasPerm ? rp.permissions.filter(p => p !== permissionId) : [...rp.permissions, permissionId];
      return { ...rp, permissions: newPerms };
    }));
    setHasChanges(true);
  };

  const toggleGroup = (groupId: string) => {
    if (!canEditCurrent || !currentProfile) return;
    // Usa a lista já restrita à visão do ator — "Ativar Todos" não pode
    // ligar permissões que nem aparecem pra ele.
    const group = visiblePermissionGroups.find(g => g.id === groupId);
    if (!group) return;
    const groupPermIds = group.permissions.map(p => p.id);
    const allEnabled = groupPermIds.every(id => currentProfile.permissions.includes(id));

    setRolePermissions(prev => prev.map(rp => {
      if (rp.id !== currentProfile.id) return rp;
      const newPerms = allEnabled
        ? rp.permissions.filter(id => !groupPermIds.includes(id))
        : [...rp.permissions, ...groupPermIds.filter(id => !rp.permissions.includes(id))];
      return { ...rp, permissions: newPerms };
    }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!currentProfile) return;
    setIsSaving(true);
    try {
      const result = await saveRolePermissionsById(currentProfile.id, currentProfile.permissions);
      if (result?.error) {
        toast.error(result.error);
      } else {
        setHasChanges(false);
        toast.success('Permissões salvas');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    loadAll();
    setHasChanges(false);
  };

  const handleAddProfile = async () => {
    if (!newProfileName.trim() || !isAddingProfile) return;
    const teamId = isAddingProfile === 'system' ? null : isAddingProfile;
    const result = await createAccessProfile(newProfileName.trim(), teamId);
    if (result?.error) {
      toast.error(result.error);
      return;
    }
    await loadAll();
    if (result.id) selectProfile(result.id);
    setNewProfileName('');
    setIsAddingProfile(null);
  };

  const handleDeleteProfile = async () => {
    if (!profileToDelete) return;
    const result = await deleteRolePermission(profileToDelete.id);
    if (result?.error) {
      toast.error(result.error);
      setProfileToDelete(null);
      return;
    }
    if (selectedProfileId === profileToDelete.id) setSelectedProfileId(null);
    setProfileToDelete(null);
    await loadAll();
  };

  const updateProfileName = (name: string) => {
    if (!currentProfile) return;
    // Só atualiza o texto local aqui — o nome é salvo sozinho ao sair do
    // campo (commitProfileName), então não entra no fluxo de "Salvar
    // Alterações"/hasChanges, que é só pra permissões marcadas/desmarcadas.
    setRolePermissions(prev => prev.map(rp => rp.id === currentProfile.id ? { ...rp, name } : rp));
  };

  const commitProfileName = async () => {
    if (!currentProfile) return;
    const trimmed = currentProfile.name.trim();
    if (!trimmed) {
      toast.error('O nome do perfil não pode ficar em branco.');
      await loadAll();
      return;
    }
    const result = await renameAccessProfile(currentProfile.id, trimmed);
    if (result?.error) {
      toast.error(result.error);
      await loadAll();
    } else {
      toast.success('Nome do perfil atualizado');
    }
  };

  // ---- Equipe: criar / renomear / excluir (só Administrador do sistema) ----
  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) return;
    const res = await createInternalTeam(newTeamName, newTeamDescription);
    if (res?.error) {
      toast.error(res.error);
      return;
    }
    await loadAll();
    queryClient.invalidateQueries({ queryKey: ['ref', 'internal_teams'] });
    setShowNewTeamModal(false);
    setNewTeamName('');
    setNewTeamDescription('');
    toast.success('Equipe criada');
  };

  const handleSaveTeamMeta = async () => {
    if (!editingTeamMeta) return;
    const res = await updateInternalTeamMeta(editingTeamMeta.id, editingTeamMeta.name, editingTeamMeta.description);
    if (res?.error) {
      toast.error(res.error);
      return;
    }
    await loadAll();
    queryClient.invalidateQueries({ queryKey: ['ref', 'internal_teams'] });
    setEditingTeamMeta(null);
    toast.success('Equipe atualizada');
  };

  const handleDeleteTeam = async () => {
    if (!teamToDelete) return;
    // A action já tira a equipe de quem era membro, na mesma transação do
    // DELETE — antes isso eram duas etapas soltas aqui no client.
    const res = await deleteInternalTeam(teamToDelete.id);
    if (res?.error) {
      toast.error(res.error);
      setTeamToDelete(null);
      return;
    }
    if (selectedMembersTeamId === teamToDelete.id) setSelectedMembersTeamId(null);
    setTeamToDelete(null);
    await loadAll();
    queryClient.invalidateQueries({ queryKey: ['ref', 'internal_teams'] });
    toast.success('Equipe removida');
  };

  // ---- Membros, perfil de acesso & administradores ----
  const handleSaveMembers = async () => {
    if (!selectedMembersTeam) return;
    setSavingMembers(true);
    try {
      const teamId = selectedMembersTeam.id;
      const currentSet = new Set(selectedMembersTeam.memberIds);
      const newSet = new Set(editSelectedMembers);
      const toRemove = [...currentSet].filter(id => !newSet.has(id));
      // Entradas diretas na equipe (quem ficou sem Perfil de Acesso escolhido)
      // são acumuladas e aplicadas de uma vez no fim, junto da remoção e dos
      // administradores — uma transação só, em vez de uma escrita por pessoa.
      const toAddDirectly: string[] = [];

      // Pra quem continua (ou entrou agora): dar/trocar o perfil de acesso é
      // o que efetivamente coloca a pessoa na equipe (updateUser deriva
      // role + equipe a partir do perfil escolhido, com a mesma checagem de
      // permissão usada em /team). Quem fica sem perfil escolhido só entra
      // na lista de membros (sem acesso ainda) via escrita direta.
      for (const memberId of editSelectedMembers) {
        const u = allUsers.find(u => u.id === memberId);
        const currentTeams = u?.internalTeamIds || [];
        const previousProfileId = u?.accessProfileId || '';
        const chosenProfileId = editMemberProfiles[memberId] || '';

        if (chosenProfileId && chosenProfileId !== previousProfileId) {
          const chosenProfile = rolePermissions.find(rp => rp.id === chosenProfileId) || null;
          const result = await updateUser(
            memberId,
            u?.name || '',
            u?.email || '',
            deriveStructuralRole(chosenProfile),
            undefined,
            u?.viewAllCompanyTickets || false,
            chosenProfileId
          );
          if (result?.error) toast.error(`${u?.name || 'Membro'}: ${result.error}`);
        } else if (!chosenProfileId && previousProfileId) {
          // Perfil removido explicitamente — limpa o acesso sem mexer na equipe.
          await updateUser(memberId, u?.name || '', u?.email || '', u?.role || 'Equipe', undefined, u?.viewAllCompanyTickets || false, null);
        }

        if (!chosenProfileId && !currentTeams.includes(teamId)) {
          // Entrou na equipe agora mas ainda sem perfil — garante que apareça
          // como membro mesmo assim (updateUser não mexe na equipe quando
          // não há perfil escolhido).
          toAddDirectly.push(memberId);
        }
      }

      // Só quem continua sendo membro pode continuar sendo admin da equipe.
      const finalAdminIds = editSelectedAdmins.filter(id => editSelectedMembers.includes(id));
      const membershipRes = await applyTeamMembership(teamId, {
        add: toAddDirectly,
        remove: toRemove,
        adminIds: finalAdminIds
      });
      if (membershipRes?.error) {
        toast.error(membershipRes.error);
        return;
      }

      await loadAll();
      queryClient.invalidateQueries({ queryKey: ['ref', 'internal_teams'] });
      toast.success('Membros, acessos e administradores atualizados');
    } finally {
      setSavingMembers(false);
    }
  };

  // Quem já está selecionado pra esta equipe sobe pro topo — sem isso, achar
  // quem já é membro no meio de uma lista grande e alfabética é chato.
  const filteredCandidateUsers = useMemo(() => {
    const filtered = allUsers.filter(u =>
      (u.name?.toLowerCase().includes(memberSearch.toLowerCase()) ||
       u.email?.toLowerCase().includes(memberSearch.toLowerCase()))
    );
    return [...filtered].sort((a, b) => {
      const aSelected = editSelectedMembers.includes(a.id);
      const bSelected = editSelectedMembers.includes(b.id);
      if (aSelected !== bSelected) return aSelected ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [allUsers, memberSearch, editSelectedMembers]);

  if (!authInitialized || loading) {
    return (
      <div className="flex items-center justify-center h-full py-24">
        <div className="w-8 h-8 border-2 border-[var(--accent)]/30 border-t-[var(--accent)] rounded-full animate-spin" />
      </div>
    );
  }

  if (!canAccessPage) {
    return (
      <div className="flex items-center justify-center h-full py-24">
        <div className="text-center p-8 bg-[var(--surface-card)] rounded-2xl shadow-lg border border-[var(--border-default)]">
          <Lock size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-xl font-bold text-[var(--text-secondary)] mb-2">Acesso Negado</h2>
          <p className="text-[var(--text-tertiary)]">Você não tem permissão para gerenciar equipes e perfis de acesso.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto space-y-8 animate-in fade-in duration-500">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-[var(--surface-card)] p-8 rounded-[2.5rem] border border-[var(--border-default)] shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[var(--accent)]/10 rounded-2xl flex items-center justify-center text-[var(--accent-text)]">
              <ShieldCheck size={24} />
            </div>
            <h2 className="text-2xl font-black text-[var(--text-primary)] tracking-tight">Equipes & Permissões</h2>
          </div>
          <p className="text-[var(--text-tertiary)] font-medium text-sm ml-13">
            {isSystemAdmin
              ? 'Quem está em cada equipe, quem a administra, e o que cada perfil libera'
              : 'Membros, administradores e perfis de acesso da(s) sua(s) equipe(s)'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {selectedProfileId && hasChanges && (
            <button onClick={handleReset} disabled={isSaving} className="px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-card)] transition-all flex items-center gap-2">
              <Undo2 size={16} /> Descartar
            </button>
          )}
          {selectedProfileId && (
            <button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className={cn(
                "px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 shadow-2xl overflow-hidden relative",
                hasChanges && !isSaving
                  ? "bg-[var(--accent)] text-white shadow-indigo-200 hover:bg-[var(--accent-hover)] hover:-translate-y-0.5 active:translate-y-0"
                  : "bg-[var(--surface-pill)] text-[var(--text-tertiary)] shadow-none cursor-not-allowed"
              )}
            >
              {isSaving ? (
                <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /><span>Salvando...</span></>
              ) : (
                <><Save size={16} /> Salvar Alterações</>
              )}
            </button>
          )}
          {isSystemAdmin && !selectedProfileId && (
            <button
              onClick={() => setShowNewTeamModal(true)}
              className="px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-[var(--accent)] text-white shadow-lg shadow-indigo-200 hover:bg-[var(--accent-hover)] transition-all flex items-center gap-2"
            >
              <Plus size={16} /> Nova Equipe
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 sticky top-8">
        {/* Left: Teams + Profiles */}
        <div className="lg:col-span-3 space-y-6">
          {isSystemAdmin && (
            <div className="bg-[var(--surface-card)] p-6 rounded-[2.5rem] border border-[var(--border-default)] shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest flex items-center gap-1.5"><ShieldCheck size={12} /> Perfis do Sistema</span>
                <button onClick={() => setIsAddingProfile('system')} className="w-8 h-8 bg-[var(--accent)]/10 text-[var(--accent-text)] rounded-xl flex items-center justify-center hover:bg-[var(--accent)]/20 transition-all">
                  <Plus size={18} />
                </button>
              </div>
              <div className="space-y-2">
                <AddProfileForm
                  scopeKey="system"
                  isAddingProfile={isAddingProfile}
                  newProfileName={newProfileName}
                  setNewProfileName={setNewProfileName}
                  handleAddProfile={handleAddProfile}
                  setIsAddingProfile={setIsAddingProfile}
                />
                {systemProfiles.map(rp => (
                  <ProfileButton
                    key={rp.id}
                    rp={rp}
                    selectedProfileId={selectedProfileId}
                    selectProfile={selectProfile}
                    isSystemAdmin={isSystemAdmin}
                    myAdminTeamIds={myAdminTeamIds}
                    setProfileToDelete={setProfileToDelete}
                  />
                ))}
              </div>
            </div>
          )}

          {teamsToShow.map(team => {
            const profiles = profilesByTeam.get(team.id) || [];
            const iAdminThis = isSystemAdmin || myAdminTeamIds.includes(team.id);
            const membersWithoutProfile = team.memberIds.filter(id => !allUsers.find(u => u.id === id)?.accessProfileId).length;
            return (
              <div key={team.id} className="bg-[var(--surface-card)] p-6 rounded-[2.5rem] border border-[var(--border-default)] shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest flex items-center gap-1.5 min-w-0">
                    <Users size={12} className="shrink-0" /> <span className="truncate">{team.name}</span>
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {isSystemAdmin && (
                      <button onClick={() => setEditingTeamMeta(team)} className="w-8 h-8 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] rounded-xl flex items-center justify-center transition-all" title="Renomear/editar equipe">
                        <Pencil size={14} />
                      </button>
                    )}
                    {iAdminThis && (
                      <button onClick={() => setIsAddingProfile(team.id)} className="w-8 h-8 bg-[var(--accent)]/10 text-[var(--accent-text)] rounded-xl flex items-center justify-center hover:bg-[var(--accent)]/20 transition-all" title="Novo perfil para esta equipe">
                        <Plus size={18} />
                      </button>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => selectMembersPanel(team)}
                  className={cn(
                    "w-full flex items-center justify-between p-4 rounded-2xl border transition-all text-left",
                    selectedMembersTeamId === team.id
                      ? "bg-[var(--text-warning-strong)] border-[var(--text-warning-strong)] text-white shadow-lg"
                      : "bg-[var(--surface-pill)] border-transparent hover:bg-[var(--border-default)]/50 text-[var(--text-secondary)]"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", selectedMembersTeamId === team.id ? "bg-white/20 text-white" : "bg-[var(--surface-card)] text-[var(--text-tertiary)]")}>
                      <UserCog size={16} />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs font-black uppercase tracking-tight">Membros & Admins</span>
                      <span className={cn("text-[10px] font-medium", selectedMembersTeamId === team.id ? "text-white/80" : "text-[var(--text-tertiary)]")}>
                        {team.memberIds.length} membro{team.memberIds.length !== 1 ? 's' : ''} · {team.adminIds.length} admin{team.adminIds.length !== 1 ? 's' : ''}
                        {membersWithoutProfile > 0 && (
                          <span className={selectedMembersTeamId === team.id ? "text-white" : "text-[var(--text-warning-strong)]"}> · {membersWithoutProfile} sem perfil</span>
                        )}
                      </span>
                    </div>
                  </div>
                  {selectedMembersTeamId === team.id && <ChevronRight size={16} />}
                </button>

                <div className="space-y-2">
                  <AddProfileForm
                    scopeKey={team.id}
                    isAddingProfile={isAddingProfile}
                    newProfileName={newProfileName}
                    setNewProfileName={setNewProfileName}
                    handleAddProfile={handleAddProfile}
                    setIsAddingProfile={setIsAddingProfile}
                  />
                  {profiles.length === 0 && isAddingProfile !== team.id && (
                    <p className="text-[10px] text-[var(--text-tertiary)] font-medium px-1">Nenhum perfil de acesso ainda</p>
                  )}
                  {profiles.map(rp => (
                    <ProfileButton
                      key={rp.id}
                      rp={rp}
                      selectedProfileId={selectedProfileId}
                      selectProfile={selectProfile}
                      isSystemAdmin={isSystemAdmin}
                      myAdminTeamIds={myAdminTeamIds}
                      setProfileToDelete={setProfileToDelete}
                    />
                  ))}
                </div>

                {isSystemAdmin && (
                  <button
                    onClick={() => setTeamToDelete(team)}
                    className="w-full text-center text-[9px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--text-danger)] transition-colors pt-1"
                  >
                    Excluir equipe
                  </button>
                )}
              </div>
            );
          })}

          {!isSystemAdmin && teamsToShow.length === 0 && (
            <div className="bg-[var(--surface-card)] p-6 rounded-[2.5rem] border border-[var(--border-default)] shadow-sm text-center text-sm text-[var(--text-tertiary)]">
              Você não administra nenhuma equipe.
            </div>
          )}

          <div className="bg-slate-900 text-white p-8 rounded-[2.5rem] relative overflow-hidden shadow-xl">
             <div className="relative z-10 space-y-4">
                <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center text-[var(--accent-text)]">
                  <Info size={24} />
                </div>
                <div>
                  <h4 className="text-sm font-black uppercase tracking-widest mb-1">Dica de Segurança</h4>
                  <p className="text-xs text-[var(--text-tertiary)] font-medium leading-relaxed">
                    Evite conceder permissões de &quot;Excluir&quot; para perfis que não sejam de gestão técnica.
                  </p>
                </div>
             </div>
             <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-[var(--accent)]/20 blur-3xl rounded-full" />
          </div>
        </div>

        {/* Right: Detail panel */}
        <div className="lg:col-span-9 space-y-6">
          {selectedMembersTeam ? (
            <div className="space-y-6">
              <div className="bg-[var(--surface-card)] p-6 rounded-[2.5rem] border border-[var(--border-default)] shadow-sm flex items-center justify-between gap-6">
                <div>
                  <h3 className="text-lg font-black text-[var(--text-primary)] uppercase tracking-tight">{selectedMembersTeam.name}</h3>
                  <p className="text-xs text-[var(--text-tertiary)] font-medium">Membros e administradores da equipe</p>
                </div>
                <button
                  onClick={handleSaveMembers}
                  disabled={savingMembers}
                  className="px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-[var(--text-warning-strong)] text-white shadow-lg hover:bg-[var(--accent-warning-hover)] transition-all flex items-center gap-2 disabled:opacity-60"
                >
                  {savingMembers ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={16} />}
                  Salvar
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2.5rem] shadow-sm p-6 space-y-4">
                  <h4 className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest">Membros</h4>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                    <input
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Buscar por nome ou email..."
                      className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border-default)] text-sm focus:border-[var(--text-warning-strong)] outline-none"
                    />
                  </div>
                  <div className="max-h-96 overflow-y-auto space-y-1.5">
                    {filteredCandidateUsers.map(u => (
                      <button
                        key={u.id}
                        onClick={() => {
                          setEditSelectedMembers(prev => prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id]);
                          // Preserva o perfil atual da pessoa ao adicioná-la agora — sem
                          // isso, alguém que já tinha um perfil (de outra equipe, por
                          // exemplo) apareceria como "Sem perfil" e teria o acesso
                          // apagado sem querer ao salvar.
                          setEditMemberProfiles(prev => prev[u.id] !== undefined ? prev : { ...prev, [u.id]: u.accessProfileId || '' });
                        }}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all border",
                          editSelectedMembers.includes(u.id) ? "bg-[var(--surface-warning)] border-[var(--border-alert)]" : "hover:bg-[var(--surface-pill)] border-transparent"
                        )}
                      >
                        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs overflow-hidden shrink-0", editSelectedMembers.includes(u.id) ? "bg-[var(--text-warning-strong)] text-white" : "bg-[var(--surface-pill)] text-[var(--text-secondary)]")}>
                          {u.avatarUrl ? <img src={u.avatarUrl} alt={u.name} className="w-full h-full object-cover" /> : (u.name?.charAt(0) || '?')}
                        </div>
                        <div className="flex-1 text-left min-w-0">
                          <p className="font-bold text-[var(--text-primary)] truncate">{u.name || 'Sem nome'}</p>
                          <p className="text-[10px] text-[var(--text-tertiary)] font-medium truncate">{u.email}</p>
                        </div>
                        {editSelectedMembers.includes(u.id) && <Check size={16} className="text-[var(--text-warning-strong)] shrink-0" />}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2.5rem] shadow-sm p-6 space-y-4">
                  <h4 className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest flex items-center gap-1.5"><Shield size={12} /> Acesso de cada membro</h4>
                  <p className="text-xs text-[var(--text-tertiary)] font-medium">Dê um perfil de acesso pra cada membro — sem isso a pessoa fica na equipe mas sem nenhuma permissão. Administradores da equipe podem criar/editar usuários e perfis sem depender de um Administrador do sistema.</p>
                  {editSelectedMembers.length === 0 ? (
                    <p className="text-xs text-[var(--text-tertiary)] font-medium italic">Selecione membros ao lado primeiro.</p>
                  ) : (
                    <div className="space-y-2">
                      {editSelectedMembers.map(memberId => {
                        const member = allUsers.find(u => u.id === memberId);
                        const isAdmin = editSelectedAdmins.includes(memberId);
                        const teamProfiles = profilesByTeam.get(selectedMembersTeam.id) || [];
                        const chosenProfileId = editMemberProfiles[memberId] || '';
                        // Alguém pode chegar aqui já com um perfil de OUTRA equipe (ex:
                        // acabou de ser adicionado a esta equipe também) — mostra esse
                        // perfil "estrangeiro" como opção pra não sumir do seletor, com
                        // um aviso, em vez de dar a entender que a pessoa está sem nada.
                        const foreignProfile = chosenProfileId && !teamProfiles.some(p => p.id === chosenProfileId)
                          ? rolePermissions.find(rp => rp.id === chosenProfileId)
                          : null;
                        return (
                          <div key={memberId} className="flex items-center gap-2 p-2.5 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)]/50">
                            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs overflow-hidden shrink-0", chosenProfileId ? "bg-[var(--surface-pill)] text-[var(--text-secondary)]" : "bg-[var(--surface-warning)] text-[var(--text-warning)]")}>
                              {member?.avatarUrl ? <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover" /> : (member?.name?.charAt(0) || '?')}
                            </div>
                            <div className="min-w-0 shrink-0 w-28">
                              <p className="font-bold text-[var(--text-primary)] text-xs truncate">{member?.name || 'Membro'}</p>
                              {!chosenProfileId && <p className="text-[9px] text-[var(--text-warning)] font-bold uppercase tracking-wide">Sem perfil</p>}
                              {foreignProfile && <p className="text-[9px] text-[var(--text-tertiary)] font-medium truncate" title="Perfil de outra equipe">De outra equipe</p>}
                            </div>
                            <StyledSelect
                              value={chosenProfileId}
                              onChange={(e) => setMemberProfile(memberId, e.target.value)}
                              className="flex-1 min-w-0 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-[var(--text-warning-strong)]/20 outline-none"
                            >
                              <option value="">Sem perfil</option>
                              {foreignProfile && <option value={foreignProfile.id}>{foreignProfile.name} (outra equipe)</option>}
                              {teamProfiles.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </StyledSelect>
                            <button
                              onClick={() => setEditSelectedAdmins(prev => prev.includes(memberId) ? prev.filter(id => id !== memberId) : [...prev, memberId])}
                              title={isAdmin ? 'Remover como administrador da equipe' : 'Tornar administrador da equipe'}
                              className={cn(
                                "shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all border",
                                isAdmin ? "bg-[var(--text-warning-strong)] text-white border-[var(--text-warning-strong)]" : "bg-[var(--surface-pill)] text-[var(--text-tertiary)] border-transparent hover:border-[var(--border-default)]"
                              )}
                            >
                              <Shield size={14} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : !currentProfile ? (
            <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[3rem] p-20 flex flex-col items-center justify-center text-center space-y-4">
               <div className="w-20 h-20 bg-[var(--surface-card)] rounded-full flex items-center justify-center text-slate-200">
                  <ShieldCheck size={48} />
               </div>
               <h3 className="text-xl font-black text-[var(--text-primary)]">Selecione uma Equipe ou Perfil</h3>
               <p className="text-[var(--text-tertiary)] max-w-xs">Escolha &quot;Membros &amp; Admins&quot; pra gerenciar quem está na equipe, ou um perfil pra configurar telas e permissões.</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-[var(--surface-card)] p-6 rounded-[2.5rem] border border-[var(--border-default)] shadow-sm flex flex-col md:flex-row md:items-center gap-6">
                <div className="flex-1 space-y-1">
                  {!canEditCurrent ? (
                    <div className="flex items-center gap-3">
                       <h3 className="text-lg font-black text-[var(--text-primary)] uppercase tracking-tight">{currentProfile.name}</h3>
                       <span className="px-3 py-1 bg-[var(--surface-warning)] text-[var(--text-warning)] text-[10px] font-black uppercase tracking-widest rounded-full flex items-center gap-1">
                         <Lock size={10} /> {currentProfile.isSystem ? 'Sistema' : 'Somente leitura'}
                       </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 group/rename">
                      <input
                        type="text"
                        value={currentProfile.name}
                        onChange={e => updateProfileName(e.target.value)}
                        onBlur={commitProfileName}
                        onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                        title="Clique para renomear este perfil"
                        className="text-lg font-black text-[var(--text-primary)] uppercase tracking-tight bg-transparent border border-transparent hover:border-[var(--border-default)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20 outline-none transition-all rounded-lg px-2 py-1 -ml-2"
                      />
                      <Pencil size={14} className="text-[var(--text-tertiary)] opacity-0 group-hover/rename:opacity-100 transition-opacity shrink-0" />
                    </div>
                  )}
                  <p className="text-xs text-[var(--text-tertiary)] font-medium">Configurando {currentProfile.permissions.length} acessos ativos</p>
                </div>

                <div className="relative">
                  <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                  <input
                    type="text"
                    placeholder="Buscar permissão..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl pl-12 pr-6 py-3 text-xs font-bold w-full md:w-64 focus:ring-4 focus:ring-indigo-100 outline-none transition-all placeholder:text-[var(--text-tertiary)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <AnimatePresence mode="popLayout">
                  {filteredGroups.map((group) => {
                    const allEnabled = group.permissions.every(p => currentProfile.permissions.includes(p.id));

                    return (
                      <motion.div key={group.id} layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2.5rem] shadow-sm flex flex-col overflow-hidden">
                        <div className="p-6 bg-[var(--surface-card)]/50 border-b border-[var(--border-default)] flex items-center justify-between">
                          <h3 className="text-[10px] font-black uppercase text-[var(--text-primary)] tracking-widest">{group.title}</h3>
                          {canEditCurrent && (
                            <button onClick={() => toggleGroup(group.id)} className={cn("text-[10px] font-black uppercase tracking-widest ml-1 transition-colors", allEnabled ? "text-[var(--text-danger)] hover:text-[var(--text-danger)]" : "text-[var(--accent-text)] hover:text-[var(--accent-hover)]")}>
                              {allEnabled ? 'Remover Todos' : 'Ativar Todos'}
                            </button>
                          )}
                        </div>

                        <div className="p-6 space-y-3">
                          {group.permissions.map((perm) => {
                            const isEnabled = currentProfile.permissions.includes(perm.id);
                            return (
                              <button
                                key={perm.id}
                                disabled={!canEditCurrent}
                                onClick={() => togglePermission(perm.id)}
                                className={cn(
                                  "w-full text-left p-4 rounded-3xl border transition-all flex items-start gap-4 group relative",
                                  isEnabled ? "bg-[var(--surface-card)] border-[var(--accent)]/20 hover:border-[var(--accent)]/30" : "bg-[var(--surface-card)]/50 border-transparent hover:bg-[var(--surface-card)]"
                                )}
                              >
                                <div className={cn("mt-0.5 w-10 h-10 rounded-2xl flex items-center justify-center transition-all", isEnabled ? "bg-[var(--accent)] text-white shadow-xl shadow-indigo-100" : "bg-[var(--surface-card)] border border-[var(--border-default)] text-slate-300")}>
                                  {isEnabled ? <Check size={20} className="animate-in zoom-in duration-300" /> : <Shield size={18} />}
                                </div>
                                <div className="flex-1 pr-6">
                                  <p className={cn("text-xs font-black uppercase tracking-tight mb-1 transition-colors", isEnabled ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]")}>
                                    {perm.label}
                                  </p>
                                  <p className="text-[10px] text-[var(--text-tertiary)] font-medium leading-normal">{perm.desc}</p>
                                </div>
                                {!canEditCurrent && (
                                  <div className="absolute top-4 right-4 text-[var(--text-warning-strong)] opacity-30">
                                    <Lock size={12} />
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                {filteredGroups.length === 0 && (
                  <div className="md:col-span-2 py-20 text-center space-y-4">
                    <div className="w-16 h-16 bg-[var(--surface-card)] rounded-2xl flex items-center justify-center text-slate-200 mx-auto">
                      <Search size={32} />
                    </div>
                    <p className="text-[var(--text-tertiary)] font-medium">Nenhuma permissão encontrada para sua busca.</p>
                    <button onClick={() => setSearchQuery('')} className="text-[var(--accent-text)] text-xs font-black uppercase tracking-widest">Limpar busca</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal: nova equipe */}
      <AnimatePresence>
        {showNewTeamModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowNewTeamModal(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative bg-[var(--surface-card)] w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 space-y-5">
              <div>
                <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight">Nova Equipe</h3>
                <p className="text-xs text-[var(--text-tertiary)] font-medium">Adicione membros e perfis de acesso depois de criar</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] ml-1">Nome *</label>
                <input autoFocus value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="Desenvolvimento, Infraestrutura..." className="w-full px-4 py-3 rounded-xl border border-[var(--border-default)] focus:border-[var(--accent)] outline-none font-medium" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] ml-1">Descrição</label>
                <textarea value={newTeamDescription} onChange={(e) => setNewTeamDescription(e.target.value)} placeholder="Responsabilidades da equipe..." className="w-full px-4 py-3 rounded-xl border border-[var(--border-default)] focus:border-[var(--accent)] outline-none font-medium min-h-[90px]" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowNewTeamModal(false)} className="flex-1 py-3 rounded-xl text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] border border-[var(--border-default)] hover:bg-[var(--surface-pill)] transition-all">Cancelar</button>
                <button onClick={handleCreateTeam} disabled={!newTeamName.trim()} className="flex-1 py-3 rounded-xl bg-[var(--accent)] text-white font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all disabled:opacity-50">Criar Equipe</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: editar equipe (nome/descrição) */}
      <AnimatePresence>
        {editingTeamMeta && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingTeamMeta(null)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative bg-[var(--surface-card)] w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 space-y-5">
              <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight">Editar Equipe</h3>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] ml-1">Nome</label>
                <input value={editingTeamMeta.name} onChange={(e) => setEditingTeamMeta({ ...editingTeamMeta, name: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[var(--border-default)] focus:border-[var(--accent)] outline-none font-medium" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] ml-1">Descrição</label>
                <textarea value={editingTeamMeta.description || ''} onChange={(e) => setEditingTeamMeta({ ...editingTeamMeta, description: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[var(--border-default)] focus:border-[var(--accent)] outline-none font-medium min-h-[90px]" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setEditingTeamMeta(null)} className="flex-1 py-3 rounded-xl text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] border border-[var(--border-default)] hover:bg-[var(--surface-pill)] transition-all">Cancelar</button>
                <button onClick={handleSaveTeamMeta} disabled={!editingTeamMeta.name.trim()} className="flex-1 py-3 rounded-xl bg-[var(--accent)] text-white font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all disabled:opacity-50">Salvar</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmação: excluir equipe */}
      <AnimatePresence>
        {teamToDelete && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setTeamToDelete(null)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }} className="relative bg-[var(--surface-card)] w-full max-w-md rounded-[2.5rem] shadow-2xl p-10 overflow-hidden">
              <div className="space-y-6 text-center">
                <div className="w-20 h-20 bg-[var(--surface-danger)] text-[var(--text-danger)] rounded-3xl flex items-center justify-center mx-auto">
                  <Trash2 size={40} />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight">Excluir Equipe?</h3>
                  <p className="text-[var(--text-tertiary)] font-medium text-sm leading-relaxed">
                    Você está prestes a excluir a equipe <span className="font-bold text-[var(--text-primary)]">&quot;{teamToDelete.name}&quot;</span>.
                    Os perfis de acesso desta equipe também serão excluídos, e os membros perdem o vínculo com ela. Esta ação é irreversível.
                  </p>
                </div>
                <div className="flex gap-4 pt-2">
                  <button onClick={() => setTeamToDelete(null)} className="flex-1 px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-card)] transition-all border border-[var(--border-default)]">Cancelar</button>
                  <button onClick={handleDeleteTeam} className="flex-1 px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-[var(--text-danger)] text-white shadow-xl shadow-red-100 hover:bg-red-700 transition-all">Sim, Excluir</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmação: excluir perfil */}
      <AnimatePresence>
        {profileToDelete && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setProfileToDelete(null)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }} className="relative bg-[var(--surface-card)] w-full max-w-md rounded-[2.5rem] shadow-2xl p-10 overflow-hidden">
              <div className="space-y-6 text-center">
                <div className="w-20 h-20 bg-[var(--surface-danger)] text-[var(--text-danger)] rounded-3xl flex items-center justify-center mx-auto">
                  <Trash2 size={40} />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight">Excluir Perfil?</h3>
                  <p className="text-[var(--text-tertiary)] font-medium text-sm leading-relaxed">
                    Você está prestes a excluir o perfil <span className="font-bold text-[var(--text-primary)]">&quot;{profileToDelete.name}&quot;</span>.
                    Esta ação é irreversível e usuários vinculados a este perfil ficarão sem permissões até receberem outro perfil.
                  </p>
                </div>
                <div className="flex gap-4 pt-2">
                  <button onClick={() => setProfileToDelete(null)} className="flex-1 px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-card)] transition-all border border-[var(--border-default)]">
                    Cancelar
                  </button>
                  <button onClick={handleDeleteProfile} className="flex-1 px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-[var(--text-danger)] text-white shadow-xl shadow-red-100 hover:bg-red-700 transition-all">
                    Sim, Excluir
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
