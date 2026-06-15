"use client";

import React, { useState, useEffect } from 'react';
import { Users, Plus, X, Shield, Search, Check, ChevronRight, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import type { User } from '@/lib/types';

interface Team {
  id: string;
  name: string;
  description?: string;
  memberIds: string[];
}

export function InternalTeamsContent() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // New team form state
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDescription, setNewTeamDescription] = useState('');
  const [newSelectedMembers, setNewSelectedMembers] = useState<string[]>([]);

  // Edit team form state
  const [editSelectedMembers, setEditSelectedMembers] = useState<string[]>([]);
  const [deletingTeam, setDeletingTeam] = useState<Team | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    
    // Fetch teams from internal_teams table
    const { data: teamsData } = await supabase.from('internal_teams')
      .select('id, name, description')
      .order('name');
    
    // Fetch all eligible users (both 'Equipe' and 'Time Interno') with their team assignments
    const { data: usersData } = await supabase.from('profiles')
      .select('id, name, email, role, internal_team_ids, avatar_url')
      .or('role.eq.Equipe,role.eq.Time Interno');
    
    // Build team list with member IDs
    const teamList: Team[] = (teamsData || []).map(team => ({
      id: team.id,
      name: team.name,
      description: team.description,
      memberIds: (usersData || [])
        .filter(u => u.internal_team_ids?.includes(team.id))
        .map(u => u.id)
    }));

    setTeams(teamList);
    setAllUsers(usersData || []);
    setLoading(false);
  };

  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) return;

    const { data, error } = await supabase.from('internal_teams').insert({
      name: newTeamName.trim(),
      description: newTeamDescription.trim(),
    }).select('id').single();

    if (error) {
      toast.error('Erro ao criar equipe');
      return;
    }

    // Assign selected members to this team
    if (newSelectedMembers.length > 0) {
      // Get current team IDs for each member and add the new team
      const { data: memberProfiles } = await supabase.from('profiles')
        .select('id, internal_team_ids')
        .in('id', newSelectedMembers);
      
      const updatePromises = (memberProfiles || []).map(m => {
        const currentTeams = m.internal_team_ids || [];
        return supabase.from('profiles')
          .update({ internal_team_ids: [...currentTeams, data.id] })
          .eq('id', m.id);
      });
      
      await Promise.all(updatePromises);
    }

    await fetchData();
    setShowNewModal(false);
    setNewTeamName('');
    setNewTeamDescription('');
    setNewSelectedMembers([]);
    toast.success('Equipe criada com sucesso!');
  };

  const handleSaveMembers = async (teamId: string) => {
    // Get all eligible users to check their current teams
    const { data: allInternalUsers } = await supabase.from('profiles')
      .select('id, internal_team_ids')
      .or('role.eq.Equipe,role.eq.Time Interno');
    
    // Current members of this team
    const currentMembers = editingTeam?.memberIds || [];
    const currentSet = new Set(currentMembers);
    const newSet = new Set(editSelectedMembers);
    
    // Members to remove from team
    const toRemove = [...currentSet].filter(id => !newSet.has(id));
    // Members to add to team
    const toAdd = [...newSet].filter(id => !currentSet.has(id));
    
    // Remove team from users leaving
    for (const memberId of toRemove) {
      const profile = allInternalUsers?.find(u => u.id === memberId);
      const currentTeams = profile?.internal_team_ids || [];
      const updatedTeams = currentTeams.filter((id: string) => id !== teamId);
      await supabase.from('profiles')
        .update({ internal_team_ids: updatedTeams })
        .eq('id', memberId);
    }
    
    // Add team to new members
    for (const memberId of toAdd) {
      const profile = allInternalUsers?.find(u => u.id === memberId);
      const currentTeams = profile?.internal_team_ids || [];
      if (!currentTeams.includes(teamId)) {
        await supabase.from('profiles')
          .update({ internal_team_ids: [...currentTeams, teamId] })
          .eq('id', memberId);
      }
    }

    await fetchData();
    setEditingTeam(null);
    setEditSelectedMembers([]);
    toast.success('Membros atualizados com sucesso!');
  };

  const handleDeleteTeam = async () => {
    if (!deletingTeam) return;
    const teamId = deletingTeam.id;

    const { error } = await supabase.from('internal_teams')
      .delete()
      .eq('id', teamId);

    if (error) {
      toast.error('Erro ao remover equipe');
      setDeletingTeam(null);
      return;
    }

    // Remove team from all members (remove from arrays)
    const { data: memberProfiles } = await supabase.from('profiles')
      .select('id, internal_team_ids');
    
    const updatePromises = (memberProfiles || [])
      .filter(m => m.internal_team_ids?.includes(teamId))
      .map(m => {
        const updatedTeams = (m.internal_team_ids || []).filter((id: string) => id !== teamId);
        return supabase.from('profiles')
          .update({ internal_team_ids: updatedTeams })
          .eq('id', m.id);
      });
    
    await Promise.all(updatePromises);

    await fetchData();
    setDeletingTeam(null);
    toast.success('Equipe removida com sucesso!');
  };

  const confirmDeleteTeam = (team: Team) => {
    setDeletingTeam(team);
  };

  const openEditModal = (team: Team) => {
    setEditingTeam(team);
    setEditSelectedMembers([...team.memberIds]);
    setSearchTerm('');
  };

  const filteredUsers = allUsers.filter(u => 
    u.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-sm text-slate-500 font-bold uppercase tracking-widest">Carregando equipes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-[22px] font-black text-slate-800 uppercase tracking-tight">Equipes Internas</h2>
          <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest mt-1">
            Gerencie equipes de desenvolvimento, infraestrutura, QA e produto
          </p>
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          className="px-5 py-2.5 bg-gradient-to-b from-amber-500 to-amber-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-amber-500/20 hover:shadow-amber-500/30 transition-all flex items-center gap-2"
        >
          <Plus size={16} />
          Nova Equipe
        </button>
      </div>

      {/* Teams Grid */}
      {teams.length === 0 ? (
        <div className="bg-white/60 backdrop-blur-xl rounded-3xl p-16 text-center border border-slate-200">
          <Shield size={64} className="mx-auto text-slate-200 mb-6" />
          <h3 className="text-lg font-black text-slate-700 mb-2">Nenhuma equipe configurada</h3>
          <p className="text-sm text-slate-500 font-medium max-w-sm mx-auto">
            Crie equipes para organizar os membros do Time Interno
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {teams.map(team => (
            <div 
              key={team.id} 
              className="group bg-white rounded-3xl border border-slate-200 p-6 hover:border-amber-300 hover:shadow-lg transition-all cursor-pointer"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-100 rounded-2xl flex items-center justify-center">
                    <Users size={20} className="text-amber-600" />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-800 text-[15px] uppercase tracking-tight">{team.name}</h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase">{team.memberIds.length} membros</p>
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                  <button
                    onClick={() => openEditModal(team)}
                    className="p-2 rounded-lg hover:bg-slate-100 transition-all"
                    title="Editar membros"
                  >
                    <ChevronRight size={16} className="text-slate-500" />
                  </button>
                  <button
                    onClick={() => confirmDeleteTeam(team)}
                    className="p-2 rounded-lg hover:bg-red-100 text-red-500 transition-all"
                    title="Excluir equipe"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-500 font-medium mb-4">{team.description || 'Equipe de desenvolvimento e manutenção'}</p>
              
{team.memberIds.length > 0 && (
                  <div className="flex -space-x-2">
                    {team.memberIds.slice(0, 4).map((memberId) => {
                      const member = allUsers.find(u => u.id === memberId);
                      return (
                        <div 
                          key={memberId}
                          className="w-8 h-8 rounded-full bg-amber-100 border-2 border-white flex items-center justify-center text-xs font-black text-amber-600 overflow-hidden"
                          title={member?.name || 'Membro'}
                        >
                          {member?.avatarUrl ? (
                            <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover" />
                          ) : (
                            member?.name?.charAt(0) || '?'
                          )}
                        </div>
                      );
                    })}
                  {team.memberIds.length > 4 && (
                    <div className="w-8 h-8 rounded-full bg-slate-100 border-2 border-white flex items-center justify-center text-[10px] font-black text-slate-500">
                      +{team.memberIds.length - 4}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* New Team Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-md" onClick={() => setShowNewModal(false)} />
          <div className="relative bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl p-8 flex flex-col gap-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center">
                <Plus size={24} className="text-amber-600" />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight">Nova Equipe Interna</h2>
                <p className="text-[10px] text-slate-500 font-bold uppercase">Criar equipe de desenvolvimento</p>
              </div>
            </div>

            <div className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Nome da Equipe *</label>
                <input
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="Desenvolvimento, Infraestrutura..."
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-amber-400 outline-none font-medium"
                />
              </div>
              
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Descrição</label>
                <textarea
                  value={newTeamDescription}
                  onChange={(e) => setNewTeamDescription(e.target.value)}
                  placeholder="Responsabilidades da equipe..."
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-amber-400 outline-none font-medium min-h-[100px]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Membros Iniciais</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar membros..."
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-amber-400 outline-none"
                  />
                </div>
                <div className="max-h-40 overflow-y-auto border border-slate-100 rounded-xl p-2 space-y-1 mt-2">
                  {filteredUsers.map(u => (
                    <button
                      key={u.id}
                      onClick={() => {
                        setNewSelectedMembers(prev => 
                          prev.includes(u.id) 
                            ? prev.filter(id => id !== u.id) 
                            : [...prev, u.id]
                        );
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                        newSelectedMembers.includes(u.id) 
                          ? "bg-amber-100 text-amber-700" 
                          : "hover:bg-slate-50 text-slate-700"
                      )}
                    >
                      <div className={cn(
                        "w-4 h-4 rounded border flex items-center justify-center",
                        newSelectedMembers.includes(u.id) ? "bg-amber-500 border-amber-500" : "border-slate-300"
                      )}>
                        {newSelectedMembers.includes(u.id) && <Check size={12} className="text-white" />}
                      </div>
                      <span>{u.name || u.email}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowNewModal(false)}
                className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 border border-slate-200 hover:bg-slate-50 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateTeam}
                disabled={!newTeamName.trim()}
                className="flex-1 py-3 rounded-xl bg-amber-500 text-white font-black uppercase tracking-widest hover:bg-amber-600 transition-all shadow-lg shadow-amber-500/20 disabled:opacity-50"
              >
                Criar Equipe
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Members Modal */}
      {editingTeam && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-md" onClick={() => setEditingTeam(null)} />
          <div className="relative bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center">
                  <Users size={20} className="text-amber-600" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight">{editingTeam.name}</h2>
                  <p className="text-[10px] text-slate-500 font-bold uppercase">Editar membros da equipe</p>
                </div>
              </div>
              <button 
                onClick={() => setEditingTeam(null)}
                className="p-2 rounded-lg hover:bg-slate-100 transition-all"
              >
                <X size={20} className="text-slate-500" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="relative">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar membros por nome ou email..."
                  className="w-full pl-12 pr-4 py-3 rounded-2xl border border-slate-200 focus:border-amber-400 outline-none font-medium"
                />
              </div>

              <div className="max-h-72 overflow-y-auto space-y-2 py-2">
                {filteredUsers.length === 0 ? (
                  <p className="text-center py-8 text-slate-400 text-sm">Nenhum membro encontrado</p>
                ) : (
                  filteredUsers.map(u => (
                    <button
                      key={u.id}
                      onClick={() => {
                        setEditSelectedMembers(prev => 
                          prev.includes(u.id) 
                            ? prev.filter(id => id !== u.id) 
                            : [...prev, u.id]
                        );
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition-all border",
                        editSelectedMembers.includes(u.id) 
                          ? "bg-amber-50 border-amber-200" 
                          : "hover:bg-slate-50 border-transparent"
                      )}
                    >
<div className={cn(
                         "w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm overflow-hidden",
                         editSelectedMembers.includes(u.id) 
                           ? "bg-amber-500 text-white" 
                           : "bg-slate-100 text-slate-600"
                       )}>
                        {u.avatarUrl ? (
                          <img src={u.avatarUrl} alt={u.name} className="w-full h-full object-cover" />
                        ) : (
                          u.name?.charAt(0) || '?'
                        )}
                      </div>
                      <div className="flex-1 text-left">
                        <p className="font-bold text-slate-800">{u.name || 'Sem nome'}</p>
                        <p className="text-[10px] text-slate-500 font-medium">{u.email}</p>
                      </div>
                      {editSelectedMembers.includes(u.id) && (
                        <Check size={18} className="text-amber-500" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setEditingTeam(null)}
                className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 border border-slate-200 hover:bg-slate-50 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleSaveMembers(editingTeam.id)}
                className="flex-1 py-3 rounded-xl bg-amber-500 text-white font-black uppercase tracking-widest hover:bg-amber-600 transition-all shadow-lg shadow-amber-500/20"
              >
                Salvar Membros
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deletingTeam}
        onClose={() => setDeletingTeam(null)}
        onConfirm={handleDeleteTeam}
        title="Remover Equipe"
        description={`Deseja remover a equipe "${deletingTeam?.name}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Remover"
        variant="danger"
      />
    </div>
  );
}