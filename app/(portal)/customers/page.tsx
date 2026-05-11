'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { getUsers, getCompanies, deleteCompany } from '@/app/actions';
import { Company, User, MockDB, ChatSession, UserRole } from '@/lib/mock-db';
import { Building2, User as UserIcon, Mail, Phone, Plus, MessageCircle, Ticket, ShieldCheck, Search, X, Check } from 'lucide-react';
import { cn, normalizeString, maskPhone } from '@/lib/utils';
import { NewEmployeeModal } from '@/components/new-employee-modal';
import { EditEmployeeModal } from '@/components/edit-employee-modal';
import { NewCompanyModal } from '@/components/new-company-modal';
import { ConfirmModal } from '@/components/confirm-modal';
import { useApp } from '@/app/app-context';
import { motion, AnimatePresence } from 'motion/react';

function WhatsAppNumberModal({ 
  isOpen, 
  onClose, 
  user 
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  user: User | null 
}) {
  const { currentUser, setIsOmniChatOpen, setActiveOmniChatId } = useApp();
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
            className="relative bg-white w-full max-w-sm rounded-3xl shadow-2xl p-6 border border-slate-200"
          >
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-black text-slate-800 tracking-tight">WhatsApp Omni</h3>
              <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-all text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 font-black">Central de Atendimento</p>
            
            <div className="space-y-2">
              {phones.length > 0 ? phones.map((n, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    const cleanPhone = n.replace(/\D/g, '');
                    
                    const existingSessions = MockDB.getChatSessions();
                    const existing = existingSessions.find(s => s.customerPhone === cleanPhone && s.status !== 'closed');
                    
                    let sessionId: string;
                    if (existing) {
                      sessionId = existing.id;
                      // Re-assign if current user is analyst and it's unassigned
                      if (!existing.assigneeId && currentUser && currentUser.role !== UserRole.CUSTOMER) {
                        existing.assigneeId = currentUser.id;
                        existing.status = 'active';
                        MockDB.saveChatSession(existing);
                      }
                    } else {
                      const newSession: ChatSession = {
                        id: `S-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
                        customerId: user.id,
                        customerName: user.name,
                        customerPhone: cleanPhone,
                        status: currentUser?.role !== UserRole.CUSTOMER ? 'active' : 'pending',
                        assigneeId: currentUser?.role !== UserRole.CUSTOMER ? currentUser?.id : undefined,
                        messages: [],
                        startedAt: new Date().toISOString(),
                        lastMessageAt: new Date().toISOString()
                      };
                      MockDB.saveChatSession(newSession);
                      sessionId = newSession.id;
                      
                      // If it's still pending (started by customer or no assignee), try distribution
                      if (newSession.status === 'pending') {
                        MockDB.distributeChat(sessionId);
                      }
                    }
                    
                    setActiveOmniChatId(sessionId);
                    setIsOmniChatOpen(true);
                    onClose();
                  }}
                  className="w-full flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl hover:border-indigo-500 hover:bg-indigo-50 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-indigo-600 shadow-sm group-hover:bg-indigo-600 group-hover:text-white transition-all">
                      <MessageCircle size={20} />
                    </div>
                    <span className="text-sm font-black text-slate-700">{maskPhone(n)}</span>
                  </div>
                  <Check size={16} className="text-indigo-500 opacity-0 group-hover:opacity-100 transition-all" />
                </button>
              )) : (
                <p className="text-sm text-slate-500 italic text-center py-4">Nenhum número cadastrado.</p>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export default function CustomersPage() {
  const { currentUser, setIsNewTicketModalOpen, setPreselectedUserId, setPreselectedCompanyId } = useApp();
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
        const loadedCompanies = await getCompanies();
        const loadedUsers = await getUsers();

        // Filtering logic still applies
        let filteredUsers = loadedUsers;
        let filteredCompanies = loadedCompanies;

        if (currentUser?.role === UserRole.CUSTOMER) {
          filteredCompanies = loadedCompanies.filter(c => c.id === currentUser.companyId);
          filteredUsers = loadedUsers.filter(u => u.role === 'Funcionário' && u.companyId === currentUser.companyId);
        } else {
            // Admin/internal team: Only show users with 'Funcionário' role and associated company
            filteredUsers = loadedUsers.filter(u => u.role === 'Funcionário' && !!u.companyId);
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
    loadData();
  }, []);

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
    users.filter(u => u.companyId === selectedCompanyId),
  [users, selectedCompanyId]);

  return (
    <div className="flex gap-8 h-full max-h-[calc(100vh-120px)] overflow-hidden">
      <div className="w-80 flex flex-col gap-4">
        <div className="space-y-4">
          <h2 className="font-black text-xs uppercase tracking-[0.2em] text-slate-400 mb-2 flex justify-between items-center">
            Empresas <Plus size={16} onClick={() => setIsCompanyModalOpen(true)} className="text-indigo-600 cursor-pointer hover:scale-125 transition-transform" />
          </h2>
          
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={16} />
            <input 
              type="text"
              placeholder="Buscar por empresa ou funcionário..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 space-y-2 scrollbar-thin scrollbar-thumb-slate-200">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-slate-500 font-medium">Buscando empresas...</div>
          ) : filteredCompanies.length > 0 ? (
            filteredCompanies.map(c => (
              <button 
                key={c.id} 
                onClick={() => setSelectedCompanyId(c.id)} 
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all group", 
                  selectedCompanyId === c.id 
                    ? "bg-white border-indigo-500 shadow-sm ring-2 ring-indigo-500/5 translate-x-1" 
                    : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                )}
              >
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center transition-all", 
                  selectedCompanyId === c.id 
                    ? "bg-indigo-600 text-white scale-110" 
                    : "bg-slate-100 text-slate-400 group-hover:bg-slate-200"
                )}>
                  <Building2 size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-slate-800 truncate">{c.name}</p>
                  <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider truncate">{c.industry}</p>
                </div>
              </button>
            ))
          ) : (
            <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
              <Building2 className="mx-auto text-slate-300 mb-2" size={32} />
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Nenhuma empresa encontrada</p>
            </div>
          )}
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto space-y-8 pr-4 scrollbar-thin scrollbar-thumb-slate-200">
        {isLoading ? (
          <div className="flex items-center justify-center h-64 text-sm text-slate-500 font-medium">Carregando quadro de funcionários...</div>
        ) : selectedCompany ? (
          <>
            <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex justify-between items-start">
              <div className="flex items-center gap-6">
                <div className="w-20 h-20 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600">
                  <Building2 size={40} />
                </div>
                <div>
                  <h1 className="text-3xl font-black text-slate-800 tracking-tight">{selectedCompany.name}</h1>
                  <p className="text-slate-400 text-sm font-medium">{selectedCompany.industry} • {selectedCompany.phone || 'Sem telefone'}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => { setCompanyToEdit(selectedCompany); setIsCompanyModalOpen(true); }}
                  className="bg-indigo-50 text-indigo-600 px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-indigo-100 transition-all">Editar Empresa</button>
                <button 
                  onClick={() => setCompanyToDelete(selectedCompany)}
                  className="bg-red-50 text-red-600 px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-red-100 transition-all">Excluir Empresa</button>
                <button 
                  onClick={() => setIsEmployeeModalOpen(true)}
                  className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg text-sm font-bold shadow-md hover:bg-indigo-700 transition-all"
                >
                  Novo Funcionário
                </button>
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <div>
                  <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Quadro de Funcionários</h3>
                  <p className="text-xs text-slate-500 font-medium">Colaboradores com acesso ao suporte</p>
                </div>
                <div className="flex gap-4">
                   <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase">
                     <div className="w-2 h-2 rounded-full bg-green-500"></div> Login Ativo
                   </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {companyEmployees.map(employee => (
                  <div key={employee.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:border-indigo-300 transition-all group relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 flex gap-2">
                      <button 
                         onClick={() => { setSelectedEmployee(employee); setIsEditEmployeeModalOpen(true); }}
                         className="flex items-center gap-1 text-[9px] font-black uppercase text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100 hover:bg-indigo-600 hover:text-white transition-all"
                      >
                         Editar
                      </button>
                      <div className="flex items-center gap-1 text-[9px] font-black uppercase text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-100">
                        <ShieldCheck size={10} /> Login Autorizado
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4 mb-6">
                      <div className="w-14 h-14 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
                        <UserIcon size={28} />
                      </div>
                      <div>
                        <p className="font-black text-lg text-slate-800 tracking-tight">{employee.name}</p>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">{employee.role}</p>
                      </div>
                    </div>

                    <div className="space-y-3 mb-6">
                      <div className="flex items-center gap-3 text-sm text-slate-600 font-medium bg-slate-50 p-2 rounded-lg border border-slate-100">
                        <Mail size={16} className="text-slate-400" /> {employee.email}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-slate-600 font-medium bg-slate-50 p-2 rounded-lg border border-slate-100">
                        <Phone size={16} className="text-slate-400" /> {employee.phone || '(11) 99999-0000'}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <button 
                        title="Abrir Chamado"
                        onClick={() => handleOpenTicket(employee)}
                        className="flex flex-col items-center justify-center gap-2 p-3 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-600 hover:text-white transition-all border border-indigo-100"
                      >
                        <Ticket size={18} />
                        <span className="text-[9px] font-black uppercase tracking-widest">Chamado</span>
                      </button>
                      <button 
                        title="Contactar via WhatsApp"
                        onClick={() => handleWhatsApp(employee)}
                        className="flex flex-col items-center justify-center gap-2 p-3 bg-emerald-50 text-emerald-600 rounded-xl hover:bg-emerald-600 hover:text-white transition-all border border-emerald-100"
                      >
                        <MessageCircle size={18} />
                        <span className="text-[9px] font-black uppercase tracking-widest">WhatsApp</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Nenhuma empresa selecionada</p>
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
