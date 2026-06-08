'use client';

import React, { useState, useEffect } from 'react';
import { 
  MockDB, 
  ChatSession, 
  User, 
  UserRole,
  Company
} from '@/lib/mock-db';
import { 
  Search, 
  X,
  Check
} from 'lucide-react';
import { cn, normalizeString, maskPhone } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';

export function LinkContactModal({ 
  isOpen, 
  onClose, 
  session, 
  onSuccess 
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  session: ChatSession | null,
  onSuccess: () => void
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCompanyId, setNewCompanyId] = useState('');
  const [isCreatingNewCompany, setIsCreatingNewCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');

  useEffect(() => {
    if (isOpen) {
      setUsers(MockDB.getUsers().filter(u => u.role === UserRole.EMPLOYEE));
      setCompanies(MockDB.getCompanies());
      setNewName(session?.customerName || '');
    }
  }, [isOpen, session]);

  const filteredUsers = users.filter(u => 
    normalizeString(u.name).includes(normalizeString(searchTerm)) ||
    (u.phone && u.phone.includes(searchTerm)) ||
    (u.phones && u.phones.some(p => p.includes(searchTerm)))
  );

  const handleLink = (userId: string) => {
    if (!session) return;
    const user = users.find(u => u.id === userId);
    if (!user) return;

    // Add phone to user if it's new
    if (session.customerPhone) {
      const currentPhones = user.phones || (user.phone ? [user.phone] : []);
      if (!currentPhones.includes(session.customerPhone)) {
        MockDB.saveUser({
          ...user,
          phones: [...currentPhones, session.customerPhone],
          phone: user.phone || session.customerPhone
        });
      }
    }

    const updatedSession: ChatSession = {
      ...session,
      customerId: userId,
      customerName: user.name
    };
    MockDB.saveChatSession(updatedSession);
    onSuccess();
    onClose();
  };

  const handleCreateAndLink = async () => {
    if (!session || !newName) return;
    
    let finalCompanyId = newCompanyId;
    
    if (isCreatingNewCompany && newCompanyName) {
      const newCompany: Company = {
        id: `comp-${Math.random().toString(36).substr(2, 9)}`,
        name: newCompanyName
      };
      MockDB.saveCompany(newCompany);
      finalCompanyId = newCompany.id;
    }

    if (!finalCompanyId) return;

    const newUser = await MockDB.inviteUser(
      `contact_${Date.now()}@placeholder.com`, 
      newName, 
      UserRole.EMPLOYEE, 
      finalCompanyId
    );

    if (newUser && session.customerPhone) {
      MockDB.saveUser({
        ...newUser,
        phones: [session.customerPhone],
        phone: session.customerPhone
      });
    }

    if (newUser) {
      handleLink(newUser.id);
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
            className="relative bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-200"
          >
            <div className="bg-slate-900 px-8 py-6 text-white flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black tracking-tight">Vincular Contato</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                  Número: {maskPhone(session?.customerPhone || '')}
                </p>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors text-slate-400">
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-6">
              <div className="flex bg-slate-100 p-1 rounded-2xl">
                <button 
                  onClick={() => setIsCreatingNew(false)}
                  className={cn(
                    "flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all",
                    !isCreatingNew ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"
                  )}
                >
                  Pesquisar Existente
                </button>
                <button 
                  onClick={() => setIsCreatingNew(true)}
                  className={cn(
                    "flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all",
                    isCreatingNew ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"
                  )}
                >
                  Criar Novo
                </button>
              </div>

              {isCreatingNew ? (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Nome</label>
                    <input 
                      type="text" 
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Nome completo"
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between ml-1">
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Empresa</label>
                      <button 
                        onClick={() => setIsCreatingNewCompany(!isCreatingNewCompany)}
                        className="text-[9px] font-black uppercase text-indigo-600 hover:underline"
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
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
                      />
                    ) : (
                      <select 
                        value={newCompanyId}
                        onChange={(e) => setNewCompanyId(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all appearance-none"
                      >
                        <option value="">Selecione uma empresa</option>
                        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )}
                  </div>
                  <button 
                    onClick={handleCreateAndLink}
                    disabled={!newName || (isCreatingNewCompany ? !newCompanyName : !newCompanyId)}
                    className="w-full py-4 bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all disabled:opacity-50"
                  >
                    Criar e Vincular
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input 
                      type="text"
                      placeholder="Buscar por nome ou telefone..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
                    />
                  </div>

                  <div className="max-h-60 overflow-y-auto space-y-2 pr-2 scrollbar-thin scrollbar-thumb-slate-200">
                    {filteredUsers.map(u => (
                      <button
                        key={u.id}
                        onClick={() => handleLink(u.id)}
                        className="w-full flex items-center justify-between p-3 bg-white border border-slate-100 rounded-2xl hover:border-indigo-500 hover:bg-indigo-50 transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 font-bold text-xs uppercase tracking-tighter group-hover:bg-indigo-600 group-hover:text-white transition-all">
                            {u.name.charAt(0)}
                          </div>
                          <div className="text-left">
                            <p className="text-xs font-black text-slate-700">{u.name}</p>
                            <p className="text-[10px] font-bold text-slate-400 truncate w-40">
                               {companies.find(c => c.id === u.companyId)?.name}
                            </p>
                          </div>
                        </div>
                        <Check size={16} className="text-indigo-500 opacity-0 group-hover:opacity-100" />
                      </button>
                    ))}
                    {filteredUsers.length === 0 && (
                      <p className="text-xs text-slate-400 italic text-center py-4">Nenhum colaborador encontrado.</p>
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


