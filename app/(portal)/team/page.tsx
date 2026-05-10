'use client';

import React, { useState, useEffect } from 'react';
import { 
  Users, UserPlus, Search, Mail, Shield, Key, Trash2, Edit2, CheckCircle2, XCircle, Bell
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '@/app/app-context';
import { NotificationSettingsContent } from '@/components/notification-settings';
import { UserRole } from '@/lib/mock-db';
import { NewEmployeeModal } from '@/components/new-employee-modal';
import { getUsers, createUser, updateUser, deleteUser } from '@/app/actions';

export default function TeamManagementPage() {
  const [analysts, setAnalysts] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isNewEmployeeModalOpen, setIsNewEmployeeModalOpen] = useState(false);
  const [isNotifModalOpen, setIsNotifModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  
  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('Funcionário');
  
  const { currentUser } = useApp();

  const fetchUsers = async () => {
    try {
      const users = await getUsers();
      setAnalysts(users || []);
    } catch (e) {
      console.error("Erro ao buscar usuários:", e);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const filteredAnalysts = analysts.filter(a => 
    // Filter logic: Internal team are those in the 'Equipe' role, 
    // without a companyId.
    (a.role === 'Equipe' && !a.companyId) &&
    (a.name.toLowerCase().includes(search.toLowerCase()) || 
    a.email.toLowerCase().includes(search.toLowerCase()))
  );

  const handleOpenModal = (user?: User) => {
    if (user) {
      setSelectedUser(user);
      setName(user.name);
      setEmail(user.email);
      setRole(user.role.toString());
      setCompanyId(user.companyId);
    } else {
      setSelectedUser(null);
      setName('');
      setEmail('');
      setRole('Suporte');
      setCompanyId(currentUser?.role === UserRole.CUSTOMER ? currentUser.companyId : undefined);
    }
    setPassword('');
    setIsChangingPassword(false);
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!name || !email) return;

    try {
      if (selectedUser) {
        // Edit mode
        await updateUser(selectedUser.id, name, email, role as string, companyId);
      } else {
        // Create mode
        await createUser(email, name, role as string, companyId || 'platform-company-id', [], false);
      }

      // Refresh list immediately
      await fetchUsers();
      setIsModalOpen(false);
    } catch (error) {
      console.error('Erro ao salvar usuário:', error);
      alert('Erro ao salvar usuário.');
    }
  };

  const handlePasswordChange = () => {
    if (!password || !selectedUser) return;
    
    const updated: User = { ...selectedUser, password, mustChangePassword: true };
    MockDB.saveUser(updated);
    
    alert(`Senha alterada com sucesso para ${selectedUser.name}. O usuário precisará alterá-la no próximo login.`);
    setIsChangingPassword(false);
    setPassword('');
  };

  const handleDelete = async (id: string) => {
    if (confirm('Tem certeza que deseja remover este colaborador?')) {
      try {
        await deleteUser(id);
        
        // Refresh local state based on current view
        await fetchUsers();
        setIsModalOpen(false);
      } catch (error) {
        console.error('Erro ao excluir usuário:', error);
        alert('Não foi possível excluir o usuário. Verifique suas permissões no sistema.');
      }
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">
            {currentUser?.role === UserRole.CUSTOMER ? 'Contatos da Empresa' : 'Gestão da Equipe'}
          </h2>
          <p className="text-slate-500 font-medium">
            {currentUser?.role === UserRole.CUSTOMER 
              ? 'Gerencie quem pode acessar os chamados da sua empresa' 
              : 'Configure analistas, permissões e acessos'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsNotifModalOpen(true)}
            className="hidden md:flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 text-slate-600 rounded-2xl text-sm font-black uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm"
          >
            <Bell size={18} />
            Minhas Notificações
          </button>
          <button 
            onClick={() => setIsNewEmployeeModalOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-2xl text-sm font-black uppercase tracking-widest shadow-lg shadow-indigo-200 transition-all flex items-center gap-2"
          >
            <UserPlus size={18} />
            {currentUser?.role === UserRole.CUSTOMER ? 'Novo Contato' : 'Adicionar Analista'}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-[2rem] shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center gap-4 bg-slate-50/30">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              placeholder="Buscar por nome ou e-mail..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl pl-12 pr-4 py-2.5 text-sm font-medium focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50">
                <th className="px-8 py-5 text-[10px] font-black uppercase text-slate-400 tracking-widest">ID</th>
                <th className="px-8 py-5 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                  {currentUser?.role === UserRole.CUSTOMER ? 'Nome' : 'Analista'}
                </th>
                <th className="px-8 py-5 text-[10px] font-black uppercase text-slate-400 tracking-widest">Cargo/Nível</th>
                <th className="px-8 py-5 text-[10px] font-black uppercase text-slate-400 tracking-widest">Status</th>
                <th className="px-8 py-5 text-[10px] font-black uppercase text-slate-400 tracking-widest text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredAnalysts.map((user, index) => (
                <tr key={user.id} className="hover:bg-slate-50/80 transition-colors group">
                  <td className="px-8 py-5 text-slate-400 font-mono text-xs">
                    {index + 1}
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 font-black text-lg">
                        {user.name.charAt(0)}
                      </div>
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-800">{user.name}</span>
                        <span className="text-xs text-slate-400 flex items-center gap-1">
                          <Mail size={12} /> {user.email}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-2">
                      <Shield size={14} className="text-indigo-500" />
                      <span className="px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-black uppercase tracking-widest">
                        {user.role}
                      </span>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <div className={cn(
                      "flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest",
                      user.status === 'online' ? "text-emerald-600" : 
                      user.status === 'away' ? "text-amber-600" : "text-slate-400"
                    )}>
                      {user.status === 'online' && <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
                      {user.status === 'away' && <div className="w-2 h-2 rounded-full bg-amber-500" />}
                      {user.status === 'offline' && <div className="w-2 h-2 rounded-full bg-slate-300" />}
                      {!user.status && <CheckCircle2 size={14} />}
                      {user.status === 'online' ? 'Disponível' : 
                       user.status === 'away' ? 'Ausente' : 
                       user.status === 'offline' ? 'Offline' : 'Ativo'}
                    </div>
                  </td>
                  <td className="px-8 py-5 text-right">
                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => handleOpenModal(user)}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                        title="Editar"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button 
                        onClick={() => handleDelete(user.id)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                        title="Remover"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <NewEmployeeModal 
        isOpen={isNewEmployeeModalOpen} 
        onClose={() => setIsNewEmployeeModalOpen(false)} 
        companyId={currentUser?.role === UserRole.CUSTOMER ? (currentUser.companyId || 'company-id') : 'platform-company-id'}
        onSuccess={async () => {
          await fetchUsers();
          setIsNewEmployeeModalOpen(false);
        }}
      />
      
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
              className="relative bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-black text-slate-800 tracking-tight">
                    {selectedUser 
                      ? (currentUser?.role === UserRole.CUSTOMER ? 'Editar Contato' : 'Editar Analista') 
                      : (currentUser?.role === UserRole.CUSTOMER ? 'Novo Contato' : 'Novo Analista')}
                  </h3>
                  <p className="text-sm text-slate-500 font-medium">Defina as credenciais do colaborador</p>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                  <XCircle size={28} />
                </button>
              </div>

              <div className="p-8 space-y-6">
                <div className="space-y-1.5">
                   <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Nome Completo</label>
                  <input 
                    type="text" 
                    value={name || ''}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
                    placeholder="Ex: João da Silva"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">E-mail Corporativo</label>
                  <input 
                    type="email" 
                    value={email || ''}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
                    placeholder="analista@systemsat.com.br"
                  />
                </div>

                {role === UserRole.CUSTOMER && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Empresa</label>
                    <select 
                      value={companyId || ''}
                      onChange={(e) => setCompanyId(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all appearance-none"
                    >
                      <option value="">Nenhuma Empresa</option>
                      {companies.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {role !== UserRole.CUSTOMER && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Nível de Acesso</label>
                    <div className="grid grid-cols-2 gap-3">
                      {roles.map(r => (
                        <button 
                          key={r.id}
                          onClick={() => setRole(r.name)}
                          className={cn(
                            "px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all",
                            role === r.name ? "bg-indigo-600 text-white border-indigo-600 shadow-md" : "bg-white text-slate-500 border-slate-200 hover:border-indigo-300"
                          )}
                        >
                          {r.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedUser && (
                  <div className="pt-4 border-t border-slate-100">
                    {isChangingPassword ? (
                      <div className="space-y-3">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Nova Senha</label>
                        <div className="flex gap-2">
                          <input 
                            type="password" 
                            value={password || ''}
                            onChange={(e) => setPassword(e.target.value)}
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 outline-none"
                            placeholder="********"
                          />
                          <button 
                            onClick={handlePasswordChange}
                            className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase"
                          >
                            Salvar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button 
                        onClick={() => setIsChangingPassword(true)}
                        className="flex items-center gap-2 text-indigo-600 text-[10px] font-black uppercase tracking-widest hover:underline"
                      >
                        <Key size={14} /> Redefinir Senha
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="p-8 bg-slate-50/50 flex gap-3">
                {selectedUser && (
                  <button 
                    onClick={() => handleDelete(selectedUser.id)}
                    className="px-6 py-3 bg-rose-50 text-rose-600 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-all border border-rose-100"
                  >
                    Excluir
                  </button>
                )}
                <div className="flex-1" />
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100 transition-all font-bold"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleSave}
                  className="px-12 py-3 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 font-bold"
                >
                  Salvar Alterações
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
              className="relative bg-white w-full max-w-4xl rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-black text-slate-800 tracking-tight uppercase">
                    Configurações de Alerta
                  </h3>
                  <p className="text-sm text-slate-500 font-medium">Personalize seus alertas sonoros e notificações do sistema</p>
                </div>
                <button onClick={() => setIsNotifModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                  <XCircle size={28} />
                </button>
              </div>

              <div className="p-8 max-h-[70vh] overflow-y-auto">
                 <NotificationSettingsContent />
              </div>

              <div className="p-8 bg-slate-50/50 flex justify-end">
                <button 
                  onClick={() => setIsNotifModalOpen(false)}
                  className="px-12 py-3 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 font-bold"
                >
                  Confirmar e Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
