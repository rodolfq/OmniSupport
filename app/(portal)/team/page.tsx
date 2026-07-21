'use client';

import React, { useState, useEffect } from 'react';
import { StyledSelect } from '@/components/styled-select';
import { 
  Search, Mail, Shield, Key, Trash2, Edit2, CheckCircle2, XCircle, Bell, UserPlus, Eye, EyeOff
} from 'lucide-react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '@/app/app-context';
import { NotificationSettingsContent } from '@/components/notification-settings';
import { getUsers, createUser, updateUser, deleteUser, getCompanies, getRolePermissions } from '@/app/actions';
import { Permission, UserRole, type User, type RolePermission } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

interface TeamOption {
  id: string;
  name: string;
}

// Mesma regra usada no servidor (app/actions.ts createUser/updateUser): o
// tipo estrutural do usuário segue o Perfil de Acesso escolhido, não é mais
// uma escolha separada — perfil de equipe sempre vira 'Time Interno'.
function deriveStructuralRole(profile?: RolePermission | null): string {
  if (!profile) return 'Equipe';
  if (profile.isSystem && (profile.name === 'Administrador' || profile.name === 'Equipe' || profile.name === 'Time Interno')) {
    return profile.name;
  }
  if (profile.internalTeamId) return 'Time Interno';
  return 'Equipe';
}

export default function TeamManagementPage() {
  const [analysts, setAnalysts] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isNotifModalOpen, setIsNotifModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  
  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('Funcionário');
  const [companyId, setCompanyId] = useState<string | undefined>();
  const [viewAllCompanyTickets, setViewAllCompanyTickets] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [companies, setCompanies] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [profiles, setProfiles] = useState<RolePermission[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [accessProfileId, setAccessProfileId] = useState<string>('');

  const { currentUser, authInitialized } = useApp();
  const router = useRouter();
  const isSystemAdmin = currentUser?.role === UserRole.ADMIN;
  const myAdminTeamIds = currentUser?.adminOfTeamIds || [];
  const canViewTeam = isSystemAdmin ||
    currentUser?.permissions?.includes(Permission.TEAM_READ) === true;
  // Mesma regra que já vale no servidor (createUser/updateUser/deleteUser em
  // app/actions.ts): Administrador e admin de equipe sempre podem; fora
  // isso, só quem tem TEAM_WRITE no perfil de acesso.
  const canManageTeam = isSystemAdmin || myAdminTeamIds.length > 0 ||
    currentUser?.permissions?.includes(Permission.TEAM_WRITE) === true;

  // Perfis que este usuário pode atribuir: Administrador do sistema escolhe
  // qualquer um; admin de equipe só os perfis da(s) própria(s) equipe(s) —
  // mesma regra aplicada (e reforçada) no servidor em createUser/updateUser.
  const assignableProfiles = isSystemAdmin
    ? profiles
    : profiles.filter(p => p.internalTeamId && myAdminTeamIds.includes(p.internalTeamId));

  const profileLabel = (p: RolePermission) => {
    const team = teams.find(t => t.id === p.internalTeamId);
    return team ? `${team.name} — ${p.name}` : `Sistema — ${p.name}`;
  };

  useEffect(() => {
    if (!authInitialized || !currentUser || canViewTeam) return;
    const isCompanyUser = [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser.role as UserRole);
    router.replace(isCompanyUser ? '/my-tickets' : '/dashboard');
  }, [authInitialized, currentUser?.id, currentUser?.role, canViewTeam, router]);

  const fetchUsers = async () => {
    try {
      const [users, companiesList, profilesList, teamsRes] = await Promise.all([
        getUsers(),
        getCompanies(),
        getRolePermissions(),
        supabase.from('internal_teams').select('id, name').order('name')
      ]);
      setAnalysts(users || []);
      setCompanies(companiesList || []);
      setProfiles((profilesList as RolePermission[]) || []);
      setTeams(teamsRes.data || []);
    } catch (e) {
      console.error("Erro ao buscar usuários/empresas:", e);
    }
  };

  useEffect(() => {
    if (authInitialized && canViewTeam) {
      fetchUsers();
    }
  }, [authInitialized, canViewTeam]);

  const filteredAnalysts = analysts.filter(a =>
    [UserRole.ADMIN, UserRole.SUPPORT, UserRole.INTERNAL].includes(a.role) &&
    // Admin de equipe só vê/gerencia o próprio setor; Administrador do
    // sistema vê todo mundo.
    (isSystemAdmin || (a.internalTeamIds || []).some((t: string) => myAdminTeamIds.includes(t))) &&
    (a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.email.toLowerCase().includes(search.toLowerCase()))
  );

  const handleOpenModal = (user?: User) => {
    if (user) {
      setSelectedUser(user);
      setName(user.name);
      setEmail(user.email);
      setRole(user.role);
      setCompanyId(user.companyId);
      setViewAllCompanyTickets(user.viewAllCompanyTickets || false);
      setAccessProfileId((user as any).accessProfileId || '');
    } else {
      setSelectedUser(null);
      setName('');
      setEmail('');
      setRole('Equipe');
      setCompanyId(undefined);
      setViewAllCompanyTickets(false);
      setAccessProfileId(assignableProfiles[0]?.id || '');
    }
    setPassword('');
    setShowPassword(false);
    setIsChangingPassword(false);
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    console.log('Iniciando salvamento:', { name, email, role, companyId, selectedUser: !!selectedUser });
    
    if (!name || name.trim() === '') {
      toast.error('Por favor, preencha o nome completo.');
      return;
    }
    if (!email || email.trim() === '') {
      toast.error('Por favor, preencha o e-mail corporativo.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      toast.error('Por favor, insira um e-mail válido.');
      return;
    }

    if (role !== UserRole.CUSTOMER && !accessProfileId) {
      toast.error('Selecione um Perfil de Acesso.');
      return;
    }

    // O tipo estrutural (role) segue o perfil escolhido — o servidor
    // reforça isso de qualquer forma (ver createUser/updateUser), isso é só
    // pra mandar um valor coerente quando quem está salvando é Administrador.
    const chosenProfile = profiles.find(p => p.id === accessProfileId);
    const effectiveRole = role === UserRole.CUSTOMER ? role : deriveStructuralRole(chosenProfile);

    setIsSaving(true);
    try {
      let result;
      if (selectedUser) {
        // Edit mode
        console.log('Modo edição para:', selectedUser.id);
        result = await updateUser(selectedUser.id, name.trim(), email.trim(), effectiveRole, companyId || null, viewAllCompanyTickets, accessProfileId || undefined);

        if (result && result.error) {
          console.error('Erro retornado de updateUser:', result.error);
          toast.error('Erro ao atualizar usuário', {
            description: result.error
          });
          setIsSaving(false);
          return;
        }

        toast.success('Usuário atualizado com sucesso!');
      } else {
        // Create mode
        console.log('Modo criação para:', email);
        result = await createUser(email.trim(), name.trim(), effectiveRole, companyId || null, [], viewAllCompanyTickets, accessProfileId || undefined);

        if (result && result.error) {
          console.error('Erro retornado de createUser:', result.error);
          toast.error('Erro ao criar usuário', {
            description: result.error
          });
          setIsSaving(false);
          return;
        }

        toast.success('Usuário criado com sucesso!', {
          description: `${name.trim()} foi adicionado à equipe.`
        });
      }

      // Refresh list immediately
      console.log('Limpando estado e fechando modal...');
      await fetchUsers();
      setIsModalOpen(false);
      resetForm();
    } catch (error) {
      console.error('Erro crítico ao salvar usuário:', error);
      toast.error('Erro inesperado ao salvar usuário. Verifique sua conexão e tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setSelectedUser(null);
    setName('');
    setEmail('');
    setRole('Equipe');
    setCompanyId(undefined);
    setViewAllCompanyTickets(false);
    setAccessProfileId('');
    setPassword('');
    setShowPassword(false);
    setIsChangingPassword(false);
  };

  const handlePasswordChange = async () => {
    if (!password || !selectedUser) return;
    if (password.length < 6) {
      toast.error('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }

    setIsSavingPassword(true);
    try {
      const response = await fetch('/api/users/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId: selectedUser.id, password })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Erro ao alterar senha.');

      setIsChangingPassword(false);
      setPassword('');
      setShowPassword(false);
      toast.success('Senha alterada com sucesso!', {
        description: `A nova senha de ${selectedUser.name} já está ativa.`
      });
    } catch (error: any) {
      toast.error('Erro ao alterar senha', { description: error.message });
    } finally {
      setIsSavingPassword(false);
    }
  };

  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeletingUserId(id);
  };

  const confirmDelete = async () => {
    const id = deletingUserId;
    if (!id) return;
    setDeletingUserId(null);
    try {
      await deleteUser(id);
      await fetchUsers();
      setIsModalOpen(false);
    } catch (error) {
      console.error('Erro ao excluir usuário:', error);
      alert('Não foi possível excluir o usuário. Verifique suas permissões no sistema.');
    }
  };

  if (!authInitialized || !currentUser || !canViewTeam) {
    return null;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-[var(--text-primary)] tracking-tight">
            Gestão da Equipe
          </h2>
          <p className="text-[var(--text-tertiary)] font-medium">
            Configure analistas, permissões e acessos do time interno
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsNotifModalOpen(true)}
            className="hidden md:flex items-center gap-2 px-6 py-3 bg-[var(--surface-card)] border border-[var(--border-default)] text-[var(--text-secondary)] rounded-2xl text-sm font-black uppercase tracking-widest hover:bg-[var(--surface-pill)] transition-all shadow-sm"
          >
            <Bell size={18} />
            Minhas Notificações
          </button>
          {canManageTeam && (
            <button
              onClick={() => handleOpenModal()}
              className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white px-6 py-3 rounded-2xl text-sm font-black uppercase tracking-widest shadow-lg shadow-indigo-200 transition-all flex items-center gap-2"
            >
              <UserPlus size={18} />
              Adicionar Analista
            </button>
          )}
        </div>
      </div>

      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] shadow-sm overflow-hidden">
        <div className="p-6 border-b border-[var(--border-default)] flex items-center gap-4 bg-[var(--surface-card)]/30">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={18} />
            <input
              type="text"
              placeholder="Buscar por nome ou e-mail..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl pl-12 pr-4 py-2.5 text-sm font-medium focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[var(--surface-card)]/50">
                <th className="px-8 py-5 text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">ID</th>
                <th className="px-8 py-5 text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">
                  Equipe / Analista
                </th>
                <th className="px-8 py-5 text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Perfil de Acesso</th>
                <th className="px-8 py-5 text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Status</th>
                <th className="px-8 py-5 text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-default)]">
              {filteredAnalysts.map((user, index) => (
                <tr key={user.id} className="hover:bg-[var(--surface-card)]/80 transition-colors group">
                  <td className="px-8 py-5 text-[var(--text-tertiary)] font-mono text-xs">
                    {index + 1}
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-[var(--accent)]/10 border border-[var(--accent)]/20 flex items-center justify-center text-[var(--accent-text)] font-black text-lg overflow-hidden">
                        {user.avatarUrl ? (
                          <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
                        ) : (
                          user.name.charAt(0)
                        )}
                      </div>
                      <div className="flex flex-col">
                        <span className="font-bold text-[var(--text-primary)]">{user.name}</span>
                        <span className="text-xs text-[var(--text-tertiary)] flex items-center gap-1">
                          <Mail size={12} /> {user.email}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    {(() => {
                      const profile = profiles.find(p => p.id === (user as any).accessProfileId);
                      return (
                        <div className="flex items-center gap-2">
                          <Shield size={14} className="text-[var(--accent-text)]" />
                          <div className="flex flex-col">
                            <span className="px-3 py-1 rounded-full bg-[var(--accent)]/10 text-[var(--accent-text)] text-[10px] font-semibold uppercase tracking-widest w-fit">
                              {profile ? profile.name : 'Sem perfil'}
                            </span>
                            {profile && (
                              <span className="text-[9px] text-[var(--text-tertiary)] font-medium mt-1 ml-1">
                                {profile.internalTeamId ? teams.find(t => t.id === profile.internalTeamId)?.name : 'Perfil do sistema'}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-8 py-5">
                    <div className={cn(
                      "flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest",
                      user.status === 'online' ? "text-[var(--text-success)]" :
                      user.status === 'away' ? "text-[var(--text-warning)]" : "text-[var(--text-tertiary)]"
                    )}>
                      {user.status === 'online' && <div className="w-2 h-2 rounded-full bg-[var(--text-success)] animate-pulse" />}
                      {user.status === 'away' && <div className="w-2 h-2 rounded-full bg-[var(--text-warning-strong)]" />}
                      {user.status === 'offline' && <div className="w-2 h-2 rounded-full bg-[var(--text-tertiary)]" />}
                      {!user.status && <CheckCircle2 size={14} />}
                      {user.status === 'online' ? 'Disponível' :
                       user.status === 'away' ? 'Ausente' :
                       user.status === 'offline' ? 'Offline' : 'Ativo'}
                    </div>
                  </td>
                  <td className="px-8 py-5 text-right">
                    {canManageTeam ? (
                      <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleOpenModal(user)}
                          className="p-2 text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:bg-[var(--accent)]/10 rounded-xl transition-all"
                          title="Editar"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button
                          onClick={() => handleDelete(user.id)}
                          className="p-2 text-[var(--text-tertiary)] hover:text-[var(--text-danger)] hover:bg-[var(--surface-danger)] rounded-xl transition-all"
                          title="Remover"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ) : (
                      <span className="text-[10px] text-[var(--text-tertiary)] uppercase font-semibold">Somente leitura</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
              className="relative bg-[var(--surface-card)] w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-[var(--border-default)] bg-[var(--surface-card)]/50 flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-black text-[var(--text-primary)] tracking-tight">
                    {selectedUser
                      ? (currentUser?.role === UserRole.CUSTOMER ? 'Editar Contato' : 'Editar Analista')
                      : (currentUser?.role === UserRole.CUSTOMER ? 'Novo Contato' : 'Novo Analista')}
                  </h3>
                  <p className="text-sm text-[var(--text-tertiary)] font-medium">Defina as credenciais do colaborador</p>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">
                  <XCircle size={28} />
                </button>
              </div>

              <div className="p-8 space-y-6">
                <div className="space-y-1.5">
                   <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Nome Completo</label>
                  <input
                    type="text"
                    value={name || ''}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                    placeholder="Ex: João da Silva"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">E-mail Corporativo</label>
                  <input
                    type="email"
                    value={email || ''}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                    placeholder="analista@systemsat.com.br"
                  />
                </div>

                {role === UserRole.CUSTOMER && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Empresa</label>
                    <StyledSelect
                      value={companyId || ''}
                      onChange={(e) => setCompanyId(e.target.value)}
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all appearance-none"
                    >
                      <option value="">Nenhuma Empresa</option>
                      {companies.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </StyledSelect>
                  </div>
                )}

                {role !== UserRole.CUSTOMER && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Perfil de Acesso</label>
                    <StyledSelect
                      value={accessProfileId}
                      onChange={(e) => setAccessProfileId(e.target.value)}
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
                    >
                      <option value="">Selecione um perfil...</option>
                      {assignableProfiles.map(p => (
                        <option key={p.id} value={p.id}>{profileLabel(p)}</option>
                      ))}
                    </StyledSelect>
                    {assignableProfiles.length === 0 && (
                      <p className="text-[10px] text-[var(--text-tertiary)] font-medium ml-1">Nenhum perfil disponível — peça a um Administrador para criar um perfil para sua equipe.</p>
                    )}
                  </div>
                )}

                {selectedUser && (
                  <div className="pt-4 border-t border-[var(--border-default)]">
                    {isChangingPassword ? (
                      <div className="space-y-3">
                        <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Nova Senha</label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <input
                              type={showPassword ? 'text' : 'password'}
                              value={password || ''}
                              onChange={(e) => setPassword(e.target.value)}
                              className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl pl-4 pr-11 py-2 text-sm font-bold focus:ring-2 focus:ring-[var(--accent)]/20 outline-none"
                              placeholder="********"
                              minLength={6}
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(value => !value)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[var(--text-tertiary)] hover:text-[var(--accent-text)]"
                              title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                            >
                              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          </div>
                          <button
                            onClick={handlePasswordChange}
                            disabled={isSavingPassword}
                            className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase disabled:opacity-60"
                          >
                            {isSavingPassword ? 'Salvando...' : 'Salvar'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setIsChangingPassword(true)}
                        className="flex items-center gap-2 text-[var(--accent-text)] text-[10px] font-semibold uppercase tracking-widest hover:underline"
                      >
                        <Key size={14} /> Redefinir Senha
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="p-8 bg-[var(--surface-card)]/50 flex gap-3">
                {selectedUser && (
                  <button
                    onClick={() => handleDelete(selectedUser.id)}
                    className="px-6 py-3 bg-[var(--surface-danger)] text-[var(--text-danger)] rounded-2xl text-[10px] font-semibold uppercase tracking-widest hover:bg-[var(--text-danger)] hover:text-white transition-all border border-[var(--text-danger)]/20"
                  >
                    Excluir
                  </button>
                )}
                <div className="flex-1" />
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="px-8 py-3 rounded-2xl text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className={cn(
                    "px-12 py-3 text-white rounded-2xl text-[10px] font-semibold uppercase tracking-widest transition-all shadow-lg",
                    isSaving
                      ? "bg-indigo-400 cursor-not-allowed opacity-70"
                      : "bg-[var(--accent)] hover:bg-[var(--accent-hover)] shadow-indigo-200"
                  )}
                >
                  {isSaving ? 'Salvando...' : (selectedUser ? 'Salvar Alterações' : 'Criar Conta')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isNotifModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsNotifModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[var(--surface-card)] w-full max-w-4xl rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-[var(--border-default)] bg-[var(--surface-card)]/50 flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-black text-[var(--text-primary)] tracking-tight uppercase">
                    Configurações de Alerta
                  </h3>
                  <p className="text-sm text-[var(--text-tertiary)] font-medium">Personalize seus alertas sonoros e notificações do sistema</p>
                </div>
                <button onClick={() => setIsNotifModalOpen(false)} className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">
                  <XCircle size={28} />
                </button>
              </div>

              <div className="p-8 max-h-[70vh] overflow-y-auto">
                 <NotificationSettingsContent />
              </div>

              <div className="p-8 bg-[var(--surface-card)]/50 flex justify-end">
                <button
                  onClick={() => setIsNotifModalOpen(false)}
                  className="px-12 py-3 bg-[var(--accent)] text-white rounded-2xl text-[10px] font-semibold uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all shadow-lg shadow-indigo-200"
                >
                  Confirmar e Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deletingUserId}
        onClose={() => setDeletingUserId(null)}
        onConfirm={confirmDelete}
        title="Remover Colaborador"
        description="Tem certeza que deseja remover este colaborador? Esta ação não pode ser desfeita."
        confirmLabel="Remover"
        variant="danger"
      />
    </div>
  );
}
