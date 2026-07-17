'use client';

import React, { useState, useEffect } from 'react';
import { StyledSelect } from '@/components/styled-select';
import { 
  ChatSession, 
  User, 
  UserRole,
  Company
} from '@/lib/types';
import { UserService, createUser } from '@/lib/services/user-service';
import { CompanyService } from '@/lib/services/company-service';
import { supabase } from '@/lib/supabase';
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
  const [queues, setQueues] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCompanyId, setNewCompanyId] = useState('');
  const [isCreatingNewCompany, setIsCreatingNewCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');

  useEffect(() => {
    if (isOpen) {
      async function loadData() {
        try {
          const emps = await UserService.getEmployees();
          setUsers(emps);
          const comps = await CompanyService.getAll();
          setCompanies(comps);
          const { data: queuesData } = await supabase.from('queues').select('id, whatsapp_instance_id');
          setQueues(queuesData || []);
        } catch (e) {
          console.error("Error loading LinkContactModal data:", e);
        }
      }
      loadData();
      setNewName(session?.customerName || '');
    }
  }, [isOpen, session]);

  // Foto de perfil do WhatsApp do contato, para sincronizar com o cadastro
  // (profiles.avatar_url) assim que ele é vinculado/criado.
  const fetchWhatsappContactPhoto = async (): Promise<string | null> => {
    if (!session?.customerPhone) return null;
    const queue = queues.find(q => q.id === session.queueId);
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
      const { error } = await supabase
        .from('chat_sessions')
        .update({
          customer_id: user.id,
          customer_name: user.name
        })
        .eq('id', session.id);

      if (error) throw error;

      onSuccess();
      onClose();
    } catch (e) {
      console.error(e);
      alert('Erro ao associar contato.');
    }
  };

  const handleCreateAndLink = async () => {
    if (!session || !newName) return;
    
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
        alert("Selecione ou crie uma empresa.");
        return;
      }

      const { id: newUserId, error } = await createUser(
        `contact_${Date.now()}@placeholder.com`, 
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
      alert('Erro ao criar e associar contato: ' + e.message);
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
                    onClick={handleCreateAndLink}
                    disabled={!newName || (isCreatingNewCompany ? !newCompanyName : !newCompanyId)}
                    className="w-full py-4 bg-[var(--text-success)] text-white text-[10px] font-semibold uppercase tracking-widest rounded-2xl shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all disabled:opacity-50"
                  >
                    Criar e Vincular
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
                        onClick={() => handleLink(u)}
                        className="w-full flex items-center justify-between p-3 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 transition-all group"
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
                        <Check size={16} className="text-[var(--accent-text)] opacity-0 group-hover:opacity-100" />
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


