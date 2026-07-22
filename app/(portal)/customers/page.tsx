'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { getUsers, getCompanies, deleteCompany } from '@/app/actions';
import { Company, User, UserRole, Permission } from '@/lib/types';
import { Building2, User as UserIcon, Mail, Phone, Plus, MessageCircle, Ticket, ShieldCheck, ShieldOff, Search, X, Check } from 'lucide-react';
import { cn, normalizeString, maskPhone } from '@/lib/utils';
import { NewEmployeeModal } from '@/components/new-employee-modal';
import { EditEmployeeModal } from '@/components/edit-employee-modal';
import { NewCompanyModal } from '@/components/new-company-modal';
import { ConfirmModal } from '@/components/confirm-modal';
import { useApp } from '@/app/app-context';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '@/lib/supabase';

function WhatsAppNumberModal({ 
  isOpen, 
  onClose, 
  user 
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  user: User | null 
}) {
  const { currentUser, setIsOmniChatOpen, setActiveOmniChatId, userStatus } = useApp();
  if (!user) return null;
  const phones = user.phones || (user.phone ? [user.phone] : []);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative bg-[var(--surface-card)] w-full max-w-sm rounded-3xl shadow-2xl p-6 border border-[var(--border-default)]"
          >
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-black text-[var(--text-primary)] tracking-tight">WhatsApp Omni</h3>
              <button onClick={onClose} className="p-2 hover:bg-[var(--surface-pill)] rounded-xl transition-all text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                <X size={20} />
              </button>
            </div>

            <p className="text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-widest mb-4 font-black">Central de Atendimento</p>
            
            <div className="space-y-2">
              {phones.length > 0 ? phones.map((n, idx) => (
                <button
                   key={idx}
                   onClick={async () => {
                     const cleanPhone = n.replace(/\D/g, '');
                     
                     const { data: existingSessions } = await supabase.from('chat_sessions').select('*').eq('customer_phone', cleanPhone);
                     const existing = existingSessions?.find((s: any) => !['closed'].includes(s.status));
                     
                     let sessionId: string;
                     if (existing) {
                       sessionId = existing.id;
                       // Re-assign if current user is analyst and it's unassigned
                       if (!existing.assigneeId && currentUser && currentUser.role !== UserRole.CUSTOMER) {
                         if (userStatus !== 'online') {
                           alert('Você precisa estar Online para assumir atendimentos!');
                           return;
                         }
                         await supabase.from('chat_sessions').update({
                           assignee_id: currentUser.id,
                           status: 'active'
                         }).eq('id', sessionId);
                       }
                     } else {
                       const isOnlineAnalyst = currentUser?.role !== UserRole.CUSTOMER && userStatus === 'online';
                       const { data: newSession } = await supabase.from('chat_sessions').insert({
                         customer_id: user.id,
                         customer_name: user.name,
                         customer_phone: cleanPhone,
                         status: isOnlineAnalyst ? 'active' : 'pending',
                         assignee_id: isOnlineAnalyst ? currentUser?.id : null,
                         messages: [],
                         started_at: new Date().toISOString(),
                         last_message_at: new Date().toISOString()
                       }).select('id').single();
                       sessionId = newSession?.id || '';
                     }
                    
                    setActiveOmniChatId(sessionId);
                    setIsOmniChatOpen(true);
                    onClose();
                  }}
                  className="w-full flex items-center justify-between p-4 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[var(--surface-card)] border border-[var(--border-default)] flex items-center justify-center text-[var(--accent-text)] shadow-sm group-hover:bg-[var(--accent)] group-hover:text-white transition-all">
                      <MessageCircle size={20} />
                    </div>
                    <span className="text-sm font-black text-[var(--text-secondary)]">{maskPhone(n)}</span>
                  </div>
                  <Check size={16} className="text-[var(--accent-text)] opacity-0 group-hover:opacity-100 transition-all" />
                </button>
              )) : (
                <p className="text-sm text-[var(--text-tertiary)] italic text-center py-4">Nenhum número cadastrado.</p>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export default function CustomersPage() {
  const { currentUser, setIsNewTicketModalOpen, setPreselectedUserId, setPreselectedCompanyId, hasPermission } = useApp();
  const [isLoading, setIsLoading] = useState(true);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [isEditEmployeeModalOpen, setIsEditEmployeeModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<User | null>(null);
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState(false);
  const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
  const [companyToEdit, setCompanyToEdit] = useState<Company | null>(null);
  const [companyToDelete, setCompanyToDelete] = useState<Company | null>(null);
  const [deleteError, setDeleteError] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const isCompanyPortalUser = [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser?.role as UserRole);
  const isCustomerAdmin = currentUser?.role === UserRole.CUSTOMER;
  const canManageCompanies = hasPermission(Permission.CUSTOMERS_WRITE);
  const canCreateEmployees = canManageCompanies || isCustomerAdmin;
  const canEditEmployees = canManageCompanies || isCustomerAdmin;

  const handleOpenTicket = (user: User) => {
    setPreselectedUserId(user.id);
    setPreselectedCompanyId(user.companyId || null);
    setIsNewTicketModalOpen(true);
  };

  const handleWhatsApp = (user: User) => {
    setSelectedEmployee(user);
    setIsWhatsAppModalOpen(true);
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
        console.log('📋 Clientes: Carregando dados...');
        const loadedCompanies = await getCompanies();
        const loadedUsers = await getUsers();
        console.log(`✅ Clientes: getCompanies=${loadedCompanies.length}, getUsers=${loadedUsers.length}`);

        let filteredUsers = loadedUsers;
        let filteredCompanies = loadedCompanies;
        const companyProfileRoles = [UserRole.CUSTOMER, UserRole.EMPLOYEE] as string[];
        const currentCompanyId = currentUser?.companyId || null;

if (isCompanyPortalUser) {
           filteredCompanies = loadedCompanies.filter(c => c.id === currentCompanyId);
           filteredUsers = loadedUsers.filter(u => companyProfileRoles.includes(u.role) && u.companyId === currentCompanyId);
         } else {
             filteredUsers = loadedUsers.filter(u => companyProfileRoles.includes(u.role) && !!u.companyId);
         }

        setCompanies(filteredCompanies);
        setUsers(filteredUsers);
        
        if (filteredCompanies.length > 0 && (!selectedCompanyId || !filteredCompanies.some(c => c.id === selectedCompanyId))) {
          setSelectedCompanyId(filteredCompanies[0].id);
        }
    } finally {
        setIsLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser) loadData();
  }, [currentUser?.id]);

  const filteredCompanies = useMemo(() => {
    if (!searchQuery.trim()) return companies;

    const lowerQuery = normalizeString(searchQuery);
    return companies.filter(c => {
      // Direct company name match
      if (normalizeString(c.name).includes(lowerQuery)) return true;

      // Match employee name within this company
      const hasMatchingEmployee = users.some(u => 
        u.companyId === c.id && normalizeString(u.name).includes(lowerQuery)
      );
      
      return hasMatchingEmployee;
    });
  }, [companies, users, searchQuery]);

  const selectedCompany = useMemo(() => 
    companies.find(c => c.id === selectedCompanyId),
  [companies, selectedCompanyId]);

  const companyEmployees = useMemo(() => 
    users
      .filter(u => u.companyId === selectedCompanyId)
      .sort((a, b) => Number(b.isAdmin || b.role === UserRole.CUSTOMER) - Number(a.isAdmin || a.role === UserRole.CUSTOMER)),
  [users, selectedCompanyId]);

  return (
    <div className="flex gap-8 h-full max-h-[calc(100vh-120px)] overflow-hidden">
      <div className="w-80 flex flex-col gap-4">
        <div className="space-y-4">
          <h2 className="font-black text-xs uppercase tracking-[0.2em] text-[var(--text-tertiary)] mb-2 flex justify-between items-center">
            Empresas
            {canManageCompanies && (
              <Plus size={16} onClick={() => setIsCompanyModalOpen(true)} className="text-[var(--accent-text)] cursor-pointer hover:scale-125 transition-transform" />
            )}
          </h2>

          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] group-focus-within:text-[var(--accent-text)] transition-colors" size={16} />
            <input
              type="text"
              placeholder="Buscar por empresa ou funcionário..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl pl-10 pr-4 py-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-[var(--accent)]/10 focus:border-[var(--accent)] transition-all"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 space-y-2 scrollbar-thin scrollbar-thumb-slate-200">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-[var(--text-tertiary)] font-medium">Buscando empresas...</div>
          ) : filteredCompanies.length > 0 ? (
            filteredCompanies.map(c => (
              <button
                key={c.id}
                onClick={() => setSelectedCompanyId(c.id)}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all group",
                  selectedCompanyId === c.id
                    ? "bg-[var(--surface-card)] border-[var(--accent)] shadow-sm ring-2 ring-[var(--accent)]/5 translate-x-1"
                    : "bg-[var(--surface-card)] border-[var(--border-default)] hover:border-[var(--border-default)] hover:bg-[var(--surface-card)]"
                )}
              >
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center transition-all",
                  selectedCompanyId === c.id
                    ? "bg-[var(--accent)] text-white scale-110"
                    : "bg-[var(--surface-pill)] text-[var(--text-tertiary)] group-hover:bg-[var(--border-default)]"
                )}>
                  <Building2 size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-[var(--text-primary)] truncate">{c.name}</p>
                  <p className="text-[9px] text-[var(--text-tertiary)] font-bold uppercase tracking-wider truncate">{c.industry}</p>
                </div>
              </button>
            ))
          ) : (
            <div className="p-8 text-center bg-[var(--surface-card)] rounded-2xl border border-dashed border-[var(--border-default)]">
              <Building2 className="mx-auto text-slate-300 mb-2" size={32} />
              <p className="text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-widest">Nenhuma empresa encontrada</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-8 pr-4 scrollbar-thin scrollbar-thumb-slate-200">
        {isLoading ? (
          <div className="flex items-center justify-center h-64 text-sm text-[var(--text-tertiary)] font-medium">Carregando quadro de funcionários...</div>
        ) : selectedCompany ? (
          <>
            <div className="bg-[var(--surface-card)] p-8 rounded-2xl border border-[var(--border-default)] shadow-sm flex justify-between items-start">
              <div className="flex items-center gap-6">
                <div className="w-20 h-20 bg-[var(--accent)]/10 rounded-2xl flex items-center justify-center text-[var(--accent-text)]">
                  <Building2 size={40} />
                </div>
                <div>
                  <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tight">{selectedCompany.name}</h1>
                  <p className="text-[var(--text-tertiary)] text-sm font-medium">{selectedCompany.industry} • {selectedCompany.phone || 'Sem telefone'}</p>
                </div>
              </div>
              <div className="flex gap-2">
                {canManageCompanies && (
                  <>
                <button
                  onClick={() => { setCompanyToEdit(selectedCompany); setIsCompanyModalOpen(true); }}
                  className="bg-[var(--accent)]/10 text-[var(--accent-text)] px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-[var(--accent)]/20 transition-all">Editar Empresa</button>
                <button
                  onClick={() => setCompanyToDelete(selectedCompany)}
                  className="bg-[var(--surface-danger)] text-[var(--text-danger)] px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-[var(--surface-danger)] transition-all">Excluir Empresa</button>
                  </>
                )}
                {canCreateEmployees && (
                <button
                  onClick={() => setIsEmployeeModalOpen(true)}
                  className="bg-[var(--accent)] text-white px-6 py-2.5 rounded-lg text-sm font-bold shadow-md hover:bg-[var(--accent-hover)] transition-all"
                >
                  Novo Funcionário
                </button>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <div>
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Usuários da Empresa</h3>
                  <p className="text-xs text-[var(--text-tertiary)] font-medium">Admin cliente e funcionários com acesso ao suporte</p>
                </div>
                <div className="flex gap-4">
                   <div className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-tertiary)] uppercase">
                     <div className="w-2 h-2 rounded-full bg-[var(--text-success)]"></div> Login Ativo
                   </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {companyEmployees.map(employee => (
                  <div key={employee.id} className="bg-[var(--surface-card)] p-6 rounded-2xl border border-[var(--border-default)] shadow-sm hover:border-[var(--accent)] transition-all group relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 flex gap-2">
                      {canEditEmployees && (
                      <button
                         onClick={() => { setSelectedEmployee(employee); setIsEditEmployeeModalOpen(true); }}
                         className="flex items-center gap-1 text-[9px] font-semibold uppercase text-[var(--accent-text)] bg-[var(--accent)]/10 px-2 py-0.5 rounded-full border border-[var(--accent)]/20 hover:bg-[var(--accent)] hover:text-white transition-all"
                      >
                         Editar
                      </button>
                      )}
                      {(employee.isAdmin || employee.role === UserRole.CUSTOMER) && (
                        <div className="flex items-center gap-1 text-[9px] font-semibold uppercase text-[var(--accent-text)] bg-[var(--accent)]/10 px-2 py-0.5 rounded-full border border-[var(--accent)]/20">
                          <ShieldCheck size={10} /> Admin Cliente
                        </div>
                      )}
                      {employee.isActive === false ? (
                        <div className="flex items-center gap-1 text-[9px] font-semibold uppercase text-[var(--text-danger)] bg-[var(--surface-danger)] px-2 py-0.5 rounded-full border border-[var(--text-danger)]/20">
                          <ShieldOff size={10} /> Login Bloqueado
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-[9px] font-semibold uppercase text-[var(--text-success)] bg-[var(--surface-success)] px-2 py-0.5 rounded-full border border-[var(--text-success)]/20">
                          <ShieldCheck size={10} /> Login Autorizado
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-4 mb-6">
                      <div className="w-14 h-14 rounded-xl bg-[var(--surface-pill)] flex items-center justify-center text-[var(--text-tertiary)] group-hover:bg-[var(--accent)]/10 group-hover:text-[var(--accent-text)] transition-colors overflow-hidden">
                        {employee.avatarUrl ? (
                          <img src={employee.avatarUrl} alt={employee.name} className="w-full h-full object-cover" />
                        ) : (
                          <UserIcon size={28} />
                        )}
                      </div>
                      <div>
                        <p className="font-black text-lg text-[var(--text-primary)] tracking-tight">{employee.name}</p>
                        <p className="text-xs text-[var(--text-tertiary)] font-bold uppercase tracking-widest">{employee.role}</p>
                      </div>
                    </div>

                    <div className="space-y-3 mb-6">
                      <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)] font-medium bg-[var(--surface-card)] p-2 rounded-lg border border-[var(--border-default)]">
                        <Mail size={16} className="text-[var(--text-tertiary)]" /> {employee.email}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)] font-medium bg-[var(--surface-card)] p-2 rounded-lg border border-[var(--border-default)]">
                        <Phone size={16} className="text-[var(--text-tertiary)]" /> {employee.phone || '(11) 99999-0000'}
                      </div>
                    </div>

                    {!isCompanyPortalUser && (
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        title="Abrir Chamado"
                        onClick={() => handleOpenTicket(employee)}
                        className="flex flex-col items-center justify-center gap-2 p-3 bg-[var(--accent)]/10 text-[var(--accent-text)] rounded-xl hover:bg-[var(--accent)] hover:text-white transition-all border border-[var(--accent)]/20"
                      >
                        <Ticket size={18} />
                        <span className="text-[9px] font-semibold uppercase tracking-widest">Chamado</span>
                      </button>
                      <button
                        title="Contactar via WhatsApp"
                        onClick={() => handleWhatsApp(employee)}
                        className="flex flex-col items-center justify-center gap-2 p-3 bg-[var(--surface-success)] text-[var(--text-success)] rounded-xl hover:bg-[var(--text-success)] hover:text-white transition-all border border-[var(--text-success)]/20"
                      >
                        <MessageCircle size={18} />
                        <span className="text-[9px] font-semibold uppercase tracking-widest">WhatsApp</span>
                      </button>
                    </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="p-8 text-center bg-[var(--surface-card)] rounded-2xl border border-dashed border-[var(--border-default)]">
            <p className="text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-widest">Nenhuma empresa selecionada</p>
          </div>
        )}
      </div>
      <NewEmployeeModal 
        isOpen={isEmployeeModalOpen} 
        onClose={() => setIsEmployeeModalOpen(false)} 
        companyId={selectedCompanyId || ''} 
        onSuccess={loadData}
      />
      <EditEmployeeModal
        isOpen={isEditEmployeeModalOpen}
        onClose={() => { setIsEditEmployeeModalOpen(false); setSelectedEmployee(null); }}
        user={selectedEmployee}
        onSuccess={loadData}
      />
      <NewCompanyModal
        isOpen={isCompanyModalOpen}
        onClose={() => { setIsCompanyModalOpen(false); setCompanyToEdit(null); }}
        company={companyToEdit}
        onSuccess={loadData}
        showInternalSection={canManageCompanies}
      />
      <WhatsAppNumberModal
        isOpen={isWhatsAppModalOpen}
        onClose={() => { setIsWhatsAppModalOpen(false); setSelectedEmployee(null); }}
        user={selectedEmployee}
      />
      <ConfirmModal
        isOpen={!!companyToDelete}
        title="Excluir Empresa"
        message={`Tem certeza que deseja excluir a empresa ${companyToDelete?.name}? Isso não poderá ser desfeito.`}
        error={deleteError}
        onCancel={() => { setCompanyToDelete(null); setDeleteError(''); }}
        onConfirm={async () => {
          if (companyToDelete) {
             try {
                const result = await deleteCompany(companyToDelete.id);
                if (result.error) {
                    setDeleteError(result.error);
                } else {
                    setCompanyToDelete(null);
                    setDeleteError('');
                    loadData();
                }
             } catch (e: any) {
                setDeleteError(e.message || 'Erro inesperado ao excluir empresa.');
             }
          }
        }}
      />
    </div>
  );
}
