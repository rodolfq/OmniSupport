'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Permission, RolePermission } from '@/lib/types';
import { 
  ShieldCheck, 
  Lock, 
  Shield, 
  CheckCircle2, 
  ChevronRight,
  Info,
  Save,
  Undo2,
  Plus,
  X,
  Trash2,
  Search,
  Filter,
  Check,
  AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { getRolePermissions, saveRolePermissions, deleteRolePermission } from '@/app/actions';

const permissionGroups = [
  {
    id: 'tickets',
    title: 'Chamados',
    permissions: [
      { id: Permission.TICKETS_READ, label: 'Visualizar chamados', desc: 'Permite ver a lista e detalhes de chamados' },
      { id: Permission.TICKETS_WRITE, label: 'Criar/Editar chamados', desc: 'Permite criar novos chamados ou editar os existentes' },
      { id: Permission.TICKETS_ASSIGN, label: 'Atribuir analistas', desc: 'Permite mudar o analista responsável' },
      { id: Permission.TICKETS_DELETE, label: 'Excluir chamados', desc: 'Permite remover chamados permanentemente' },
      { id: Permission.INTERNAL_TICKETS_VIEW, label: 'Visualizar ticket interno', desc: 'Permite ver tickets de operação interna' },
      { id: Permission.OUTSIDE_QUEUE_VIEW, label: 'Chat Central de Atendimento', desc: 'Permite visualizar e atender chats da central de atendimento (WhatsApp Omni)' },
    ]
  },
  {
    id: 'customers',
    title: 'Clientes',
    permissions: [
      { id: Permission.CUSTOMERS_READ, label: 'Visualizar clientes', desc: 'Permite ver a lista de empresas e contatos' },
      { id: Permission.CUSTOMERS_WRITE, label: 'Gerenciar clientes', desc: 'Permite criar, editar e remover clientes' },
    ]
  },
  {
    id: 'communication',
    title: 'Comunicação',
    permissions: [
      { id: Permission.CHAT_INTERNAL_VIEW, label: 'Acessar chat interno', desc: 'Permite visualizar e participar das conversas internas da equipe' },
    ]
  },
  {
    id: 'admin',
    title: 'Equipe & Administração',
    permissions: [
      { id: Permission.TEAM_READ, label: 'Visualizar equipe', desc: 'Permite ver a lista de analistas' },
      { id: Permission.TEAM_WRITE, label: 'Gerenciar equipe', desc: 'Permite criar e gerenciar analistas' },
      { id: Permission.SETTINGS_READ, label: 'Visualizar configurações', desc: 'Permite acessar o menu de configurações' },
      { id: Permission.SETTINGS_WRITE, label: 'Alterar configurações', desc: 'Permite modificar parâmetros do sistema' },
      { id: Permission.SETTINGS_SYSTEM, label: 'Configurações gerais do sistema', desc: 'Permite alterar categorias, prioridades, SLAs e marcadores globais' },
    ]
  },
  {
    id: 'stats',
    title: 'Análise & Dados',
    permissions: [
      { id: Permission.DASHBOARD_VIEW, label: 'Visualizar dashboard principal', desc: 'Permite acessar a tela inicial com indicadores gerais' },
      { id: Permission.REPORTS_READ, label: 'Visualizar relatórios', desc: 'Permite acessar dashboards e dados estatísticos' },
    ]
  }
];

export default function PermissionsManagementPage() {
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('Administrador');
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddingRole, setIsAddingRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [roleToDelete, setRoleToDelete] = useState<RolePermission | null>(null);

  // Sincroniza com o Supabase no carregamento
  useEffect(() => {
    const loadPermissions = async () => {
      const perms = await getRolePermissions();
      setRolePermissions(perms);
    };
    loadPermissions();
  }, []);

  const currentRole = useMemo(() => 
    rolePermissions.find(rp => rp.name === selectedRoleId), 
    [rolePermissions, selectedRoleId]
  );

  // Filtro de permissões baseado na busca
  const filteredGroups = useMemo(() => {
    if (!searchQuery) return permissionGroups;

    return permissionGroups.map(group => ({
      ...group,
      permissions: group.permissions.filter(p => 
        p.label.toLowerCase().includes(searchQuery.toLowerCase()) || 
        p.desc.toLowerCase().includes(searchQuery.toLowerCase())
      )
    })).filter(group => group.permissions.length > 0);
  }, [searchQuery, permissionGroups]);

  const togglePermission = (permissionId: Permission) => {
    if (selectedRoleId === 'Administrador') return; 

    setRolePermissions(prev => prev.map(rp => {
      if (rp.name === selectedRoleId) {
        const hasPerm = rp.permissions.includes(permissionId);
        const newPerms = hasPerm 
          ? rp.permissions.filter(p => p !== permissionId)
          : [...rp.permissions, permissionId];
        return { ...rp, permissions: newPerms };
      }
      return rp;
    }));
    setHasChanges(true);
  };

  const toggleGroup = (groupId: string) => {
    if (selectedRoleId === 'Administrador') return;
    const group = permissionGroups.find(g => g.id === groupId);
    if (!group || !currentRole) return;

    const groupPermIds = group.permissions.map(p => p.id);
    const allEnabled = groupPermIds.every(id => currentRole.permissions.includes(id));

    setRolePermissions(prev => prev.map(rp => {
      if (rp.name === selectedRoleId) {
        let newPerms: Permission[];
        if (allEnabled) {
          // Remove all from this group
          newPerms = rp.permissions.filter(id => !groupPermIds.includes(id));
        } else {
          // Add all missing from this group
          const missing = groupPermIds.filter(id => !rp.permissions.includes(id));
          newPerms = [...rp.permissions, ...missing];
        }
        return { ...rp, permissions: newPerms };
      }
      return rp;
    }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const permsToSave = rolePermissions.find(rp => rp.name === selectedRoleId)?.permissions || [];
      console.log('Saving permissions for role:', selectedRoleId, 'perms:', permsToSave);
      const result = await saveRolePermissions(selectedRoleId, permsToSave);
      console.log('Save result:', result);
      setHasChanges(false);
    } catch (error) {
      console.error('Error saving permissions:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    const loadPermissions = async () => {
      const perms = await getRolePermissions();
      setRolePermissions(perms);
    };
    loadPermissions();
    setHasChanges(false);
  };

  const handleAddRole = async () => {
    if (!newRoleName.trim()) return;
    const newRole: RolePermission = {
      id: newRoleName.trim(),
      name: newRoleName.trim(),
      role: newRoleName.trim(),
      permissions: []
    };
    const updated = [...rolePermissions, newRole];
    setRolePermissions(updated);
    const result = await saveRolePermissions(newRole.name, []);
    console.log('saveRolePermissions result for new role:', result);
    setSelectedRoleId(newRole.name);
    setNewRoleName('');
    setIsAddingRole(false);
  };

  const handleDeleteRole = async (id: string) => {
    if (id === 'Administrador') return;
    const roleToDelete = rolePermissions.find(rp => rp.id === id || rp.name === id);
    if (!roleToDelete) return;
    
    // Delete from Supabase
    await deleteRolePermission(id);
    
    // Update local state
    const updated = rolePermissions.filter(rp => rp.id !== roleToDelete.id);
    setRolePermissions(updated);
    if (selectedRoleId === id) {
      setSelectedRoleId('Administrador');
    }
  };

  const updateRoleName = (id: string, name: string) => {
    setRolePermissions(prev => prev.map(rp => rp.id === id ? { ...rp, name } : rp));
    setHasChanges(true);
  };

  return (
    <div className="max-w-[1400px] mx-auto space-y-8 animate-in fade-in duration-500">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white dark:bg-[var(--surface-card)] p-8 rounded-[2.5rem] border border-slate-200 dark:border-[var(--border-default)] shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-50 dark:bg-[var(--accent)]/10 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-[var(--accent-text)]">
              <ShieldCheck size={24} />
            </div>
            <h2 className="text-2xl font-black text-slate-800 dark:text-[var(--text-primary)] tracking-tight">Níveis de Acesso</h2>
          </div>
          <p className="text-slate-500 dark:text-[var(--text-tertiary)] font-medium text-sm ml-13">Configure o que cada perfil pode ver e fazer na plataforma</p>
        </div>
        
        <div className="flex items-center gap-3">
          {hasChanges && (
            <button 
              onClick={handleReset}
              disabled={isSaving}
              className="px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-[var(--text-tertiary)] hover:text-slate-600 dark:hover:text-[var(--text-secondary)] hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] transition-all flex items-center gap-2"
            >
              <Undo2 size={16} /> Descartar
            </button>
          )}
          <button 
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className={cn(
              "px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 shadow-2xl overflow-hidden relative",
              hasChanges && !isSaving 
                ? "bg-indigo-600 dark:bg-[var(--accent)] text-white shadow-indigo-200 hover:bg-indigo-700 dark:hover:bg-[var(--accent-hover)] hover:-translate-y-0.5 active:translate-y-0" 
                : "bg-slate-100 dark:bg-[var(--surface-pill)] text-slate-400 dark:text-[var(--text-tertiary)] shadow-none cursor-not-allowed"
            )}
          >
            {isSaving ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Salvando...</span>
              </>
            ) : (
              <>
                <Save size={16} /> Salvar Alterações
              </>
            )}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 sticky top-8">
        {/* Left: Role List (3 columns) */}
        <div className="lg:col-span-3 space-y-6">
          <div className="bg-white dark:bg-[var(--surface-card)] p-6 rounded-[2.5rem] border border-slate-200 dark:border-[var(--border-default)] shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest">Perfis & Permissões</span>
              <button 
                onClick={() => setIsAddingRole(true)}
                className="w-8 h-8 bg-indigo-50 dark:bg-[var(--accent)]/10 text-indigo-600 dark:text-[var(--accent-text)] rounded-xl flex items-center justify-center hover:bg-indigo-100 dark:hover:bg-[var(--accent)]/20 transition-all"
              >
                <Plus size={18} />
              </button>
            </div>

            <div className="space-y-2">
              <AnimatePresence>
                {isAddingRole && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="p-4 bg-indigo-50/50 dark:bg-[var(--accent)]/10 border border-indigo-100 dark:border-[var(--accent)]/20 rounded-2xl space-y-3"
                  >
                    <input 
                      autoFocus
                      type="text"
                      placeholder="Novo perfil..."
                      value={newRoleName}
                      onChange={e => setNewRoleName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddRole()}
                      className="w-full bg-white dark:bg-[var(--surface-card)] border border-indigo-200 dark:border-[var(--accent)]/30 rounded-xl px-4 py-2 text-xs font-bold focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-[var(--accent)]/20 outline-none"
                    />
                    <div className="flex gap-2">
                      <button onClick={handleAddRole} className="flex-1 bg-indigo-600 dark:bg-[var(--accent)] text-white rounded-lg py-2 text-[10px] font-black uppercase">Criar</button>
                      <button onClick={() => setIsAddingRole(false)} className="px-4 py-2 text-slate-400 dark:text-[var(--text-tertiary)] hover:bg-white dark:hover:bg-[var(--surface-card)] rounded-lg transition-all"><X size={16} /></button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {rolePermissions.map(rp => (
                <div key={rp.id} className="relative group/role">
                  <button
                    onClick={() => setSelectedRoleId(rp.name)}
                    className={cn(
                      "w-full flex items-center justify-between p-4 rounded-2xl border transition-all text-left",
                      selectedRoleId === rp.name 
                        ? "bg-indigo-600 dark:bg-[var(--accent)] border-indigo-600 dark:border-[var(--accent)] text-white shadow-lg shadow-indigo-100" 
                        : "bg-white dark:bg-[var(--surface-card)] border-transparent hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] text-slate-600 dark:text-[var(--text-secondary)]"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center transition-all",
                        selectedRoleId === rp.name ? "bg-white/20 text-white" : "bg-slate-100 dark:bg-[var(--surface-pill)] text-slate-400 dark:text-[var(--text-tertiary)]"
                      )}>
                        {rp.name === 'Administrador' ? <Shield size={16} /> : <div className="text-[10px] font-black">{(rp.name || 'P')[0]}</div>}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs font-black uppercase tracking-tight">{rp.name || 'Perfil sem nome'}</span>
                        <span className={cn(
                          "text-[10px] font-medium",
                          selectedRoleId === rp.name ? "text-indigo-100 dark:text-[var(--accent-soft-text)]" : "text-slate-400 dark:text-[var(--text-tertiary)]"
                        )}>
                          {rp.permissions.length} permissões
                        </span>
                      </div>
                    </div>
                    {selectedRoleId === rp.name && (
                      <ChevronRight size={16} className="transition-all" />
                    )}
                  </button>

                  {rp.name !== 'Administrador' && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setRoleToDelete(rp);
                      }}
                      className={cn(
                        "absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-xl transition-all opacity-0 group-hover/role:opacity-100",
                        selectedRoleId === rp.name 
                          ? "text-white/40 hover:text-white hover:bg-white/10" 
                          : "text-slate-300 hover:text-red-500 dark:hover:text-[var(--text-danger)] hover:bg-red-50 dark:hover:bg-[var(--surface-danger)]"
                      )}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-900 text-white p-8 rounded-[2.5rem] relative overflow-hidden shadow-xl">
             <div className="relative z-10 space-y-4">
                <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center text-indigo-400 dark:text-[var(--accent-text)]">
                  <Info size={24} />
                </div>
                <div>
                  <h4 className="text-sm font-black uppercase tracking-widest mb-1">Dica de Segurança</h4>
                  <p className="text-xs text-slate-400 dark:text-[var(--text-tertiary)] font-medium leading-relaxed">
                    Evite conceder permissões de &quot;Excluir&quot; para perfis que não sejam de gestão técnica.
                  </p>
                </div>
             </div>
             <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-indigo-600/20 dark:bg-[var(--accent)]/20 blur-3xl rounded-full" />
          </div>
        </div>

        {/* Right: Permission Details (9 columns) */}
        <div className="lg:col-span-9 space-y-6">
          {!currentRole ? (
            <div className="bg-white dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-[3rem] p-20 flex flex-col items-center justify-center text-center space-y-4">
               <div className="w-20 h-20 bg-slate-50 dark:bg-[var(--surface-card)] rounded-full flex items-center justify-center text-slate-200">
                  <ShieldCheck size={48} />
               </div>
               <h3 className="text-xl font-black text-slate-800 dark:text-[var(--text-primary)]">Selecione um Perfil</h3>
               <p className="text-slate-400 dark:text-[var(--text-tertiary)] max-w-xs">Escolha um perfil na lateral para gerenciar suas permissões de acesso.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Internal Toolbar */}
              <div className="bg-white dark:bg-[var(--surface-card)] p-6 rounded-[2.5rem] border border-slate-200 dark:border-[var(--border-default)] shadow-sm flex flex-col md:flex-row md:items-center gap-6">
                <div className="flex-1 space-y-1">
                  {selectedRoleId === 'Administrador' ? (
                    <div className="flex items-center gap-3">
                       <h3 className="text-lg font-black text-slate-800 dark:text-[var(--text-primary)] uppercase tracking-tight">{currentRole.name}</h3>
                       <span className="px-3 py-1 bg-amber-100 dark:bg-[var(--surface-warning)] text-amber-700 dark:text-[var(--text-warning)] text-[10px] font-black uppercase tracking-widest rounded-full flex items-center gap-1">
                         <Lock size={10} /> Sistema
                       </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <input 
                        type="text"
                        value={currentRole.name}
                        onChange={e => updateRoleName(currentRole.id, e.target.value)}
                        className="text-lg font-black text-slate-800 dark:text-[var(--text-primary)] uppercase tracking-tight bg-transparent border-none p-0 focus:ring-0 outline-none hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] transition-all rounded-lg px-2"
                      />
                      <button 
                        onClick={() => setRoleToDelete(currentRole)}
                        className="p-2 text-slate-300 hover:text-red-500 dark:hover:text-[var(--text-danger)] hover:bg-red-50 dark:hover:bg-[var(--surface-danger)] rounded-xl transition-all"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  )}
                  <p className="text-xs text-slate-400 dark:text-[var(--text-tertiary)] font-medium">Configurando {currentRole.permissions.length} acessos ativos</p>
                </div>

                <div className="relative">
                  <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[var(--text-tertiary)]" />
                  <input 
                    type="text"
                    placeholder="Buscar permissão..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="bg-slate-50 dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-2xl pl-12 pr-6 py-3 text-xs font-bold w-full md:w-64 focus:ring-4 focus:ring-indigo-100 outline-none transition-all placeholder:text-slate-400 dark:text-[var(--text-tertiary)]"
                  />
                </div>
              </div>

              {/* Groups Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <AnimatePresence mode="popLayout">
                  {filteredGroups.map((group) => {
                    const allEnabled = group.permissions.every(p => currentRole.permissions.includes(p.id));
                    const someEnabled = group.permissions.some(p => currentRole.permissions.includes(p.id));
                    
                    return (
                      <motion.div 
                        key={group.id}
                        layout
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-white dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-[2.5rem] shadow-sm flex flex-col overflow-hidden"
                      >
                        <div className="p-6 bg-slate-50/50 dark:bg-[var(--surface-card)]/50 border-b border-slate-100 dark:border-[var(--border-default)] flex items-center justify-between">
                          <h3 className="text-[10px] font-black uppercase text-slate-800 dark:text-[var(--text-primary)] tracking-widest">{group.title}</h3>
                          {selectedRoleId !== 'Administrador' && (
                            <button 
                              onClick={() => toggleGroup(group.id)}
                              className={cn(
                                "text-[10px] font-black uppercase tracking-widest ml-1 transition-colors",
                                allEnabled ? "text-red-500 dark:text-[var(--text-danger)] hover:text-red-700 dark:hover:text-[var(--text-danger)]" : "text-indigo-600 dark:text-[var(--accent-text)] hover:text-indigo-800"
                              )}
                            >
                              {allEnabled ? 'Remover Todos' : 'Ativar Todos'}
                            </button>
                          )}
                        </div>

                        <div className="p-6 space-y-3">
                          {group.permissions.map((perm) => {
                            const isEnabled = currentRole.permissions.includes(perm.id);
                            const isProtected = selectedRoleId === 'Administrador';

                            return (
                              <button
                                key={perm.id}
                                disabled={isProtected}
                                onClick={() => togglePermission(perm.id)}
                                className={cn(
                                  "w-full text-left p-4 rounded-3xl border transition-all flex items-start gap-4 group relative",
                                  isEnabled 
                                    ? "bg-white dark:bg-[var(--surface-card)] border-indigo-100 dark:border-[var(--accent)]/20 hover:border-indigo-200 dark:hover:border-[var(--accent)]/30" 
                                    : "bg-slate-50/50 dark:bg-[var(--surface-card)]/50 border-transparent hover:bg-slate-50 dark:hover:bg-[var(--surface-card)]"
                                )}
                              >
                                <div className={cn(
                                  "mt-0.5 w-10 h-10 rounded-2xl flex items-center justify-center transition-all",
                                  isEnabled ? "bg-indigo-600 dark:bg-[var(--accent)] text-white shadow-xl shadow-indigo-100" : "bg-white dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] text-slate-300"
                                )}>
                                  {isEnabled ? <Check size={20} className="animate-in zoom-in duration-300" /> : <Shield size={18} />}
                                </div>
                                <div className="flex-1 pr-6">
                                  <p className={cn(
                                    "text-xs font-black uppercase tracking-tight mb-1 transition-colors",
                                    isEnabled ? "text-slate-800 dark:text-[var(--text-primary)]" : "text-slate-400 dark:text-[var(--text-tertiary)] group-hover:text-slate-600 dark:group-hover:text-[var(--text-secondary)]"
                                  )}>
                                    {perm.label}
                                  </p>
                                  <p className="text-[10px] text-slate-400 dark:text-[var(--text-tertiary)] font-medium leading-normal">
                                    {perm.desc}
                                  </p>
                                </div>

                                {isProtected && (
                                  <div className="absolute top-4 right-4 text-amber-500 dark:text-[var(--text-warning-strong)] opacity-30">
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
                    <div className="w-16 h-16 bg-slate-50 dark:bg-[var(--surface-card)] rounded-2xl flex items-center justify-center text-slate-200 mx-auto">
                      <Search size={32} />
                    </div>
                    <p className="text-slate-400 dark:text-[var(--text-tertiary)] font-medium">Nenhuma permissão encontrada para sua busca.</p>
                    <button onClick={() => setSearchQuery('')} className="text-indigo-600 dark:text-[var(--accent-text)] text-xs font-black uppercase tracking-widest">Limpar busca</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {roleToDelete && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setRoleToDelete(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative bg-white dark:bg-[var(--surface-card)] w-full max-w-md rounded-[2.5rem] shadow-2xl p-10 overflow-hidden"
            >
              <div className="space-y-6 text-center">
                <div className="w-20 h-20 bg-red-50 dark:bg-[var(--surface-danger)] text-red-500 dark:text-[var(--text-danger)] rounded-3xl flex items-center justify-center mx-auto">
                  <Trash2 size={40} />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-black text-slate-800 dark:text-[var(--text-primary)] uppercase tracking-tight">Excluir Perfil?</h3>
                  <p className="text-slate-500 dark:text-[var(--text-tertiary)] font-medium text-sm leading-relaxed">
                    Você está prestes a excluir o perfil <span className="font-bold text-slate-800 dark:text-[var(--text-primary)]">&quot;{roleToDelete.name}&quot;</span>. 
                    Esta ação é irreversível e usuários vinculados a este perfil perderão o acesso a estas permissões.
                  </p>
                </div>
                <div className="flex gap-4 pt-2">
                  <button 
                    onClick={() => setRoleToDelete(null)}
                    className="flex-1 px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-[var(--text-tertiary)] hover:text-slate-600 dark:hover:text-[var(--text-secondary)] hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] transition-all border border-slate-100 dark:border-[var(--border-default)]"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={() => {
                      handleDeleteRole(roleToDelete.name);
                      setRoleToDelete(null);
                    }}
                    className="flex-1 px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-red-600 dark:bg-[var(--text-danger)] text-white shadow-xl shadow-red-100 hover:bg-red-700 transition-all"
                  >
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
