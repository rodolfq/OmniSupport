'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { assignChatSession } from '@/lib/services/chat-session-actions';
import { getUsers } from '@/lib/services/user-actions-service';
import { getCompanies, setCompanyActive, updateCompanyLogo } from '@/lib/services/company-service';
import { Company, User, UserRole, Permission } from '@/lib/types';
import { Building2, User as UserIcon, Mail, Phone, Plus, MessageCircle, Ticket, ShieldCheck, ShieldOff, Search, X, Check, Pencil, UserPlus, RefreshCw, Headset, Briefcase, Camera, Trash2 } from 'lucide-react';
import { cn, normalizeString, normalizePhone, maskPhone } from '@/lib/utils';
import { NewEmployeeModal } from '@/components/new-employee-modal';
import { EditEmployeeModal } from '@/components/edit-employee-modal';
import { NewCompanyModal } from '@/components/new-company-modal';
import { ConfirmModal } from '@/components/confirm-modal';
import { UserService } from '@/lib/services/user-service';
import { resolveChatSessionForPhone } from '@/lib/services/chat-service';
import { useApp } from '@/app/app-context';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

const MAX_LOGO_FILE_BYTES = 4 * 1024 * 1024; // mesmo limite (folgado) do servidor, ver app/api/companies/route.ts

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Erro ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}

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
                     // Exigência de estar Online vem ANTES de criar a conversa:
                     // quem inicia por aqui vira o responsável (a atribuição é
                     // feita no servidor, em app/api/chats/route.ts), então
                     // barrar depois deixaria uma conversa criada e atribuída a
                     // alguém que a tela acabou de recusar.
                     const isPortalUser = currentUser
                       && [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser.role as UserRole);
                     if (!isPortalUser && userStatus !== 'online') {
                       toast.error('Você precisa estar Online para assumir atendimentos!');
                       return;
                     }

                     // resolveChatSessionForPhone (lib/services/chat-service) é o
                     // mesmo caminho usado ao clicar num telefone dentro da
                     // conversa: acha a sessão aberta ou cria uma nova, já com
                     // a normalização de telefone brasileiro (DDI, nono
                     // dígito) que este trecho não fazia — aqui só se removia
                     // o que não era dígito. Conversa JÁ existente mantém o
                     // responsável atual, não é "roubada".
                     const resolved = await resolveChatSessionForPhone(n, user.name);
                     if ('error' in resolved) {
                       toast.error(resolved.error);
                       return;
                     }
                     const sessionId = resolved.sessionId;

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
  const [internalUsers, setInternalUsers] = useState<User[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [isEditEmployeeModalOpen, setIsEditEmployeeModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<User | null>(null);
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState(false);
  const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
  const [companyToEdit, setCompanyToEdit] = useState<Company | null>(null);
  // Empresa não é mais excluída pela tela — é desativada (reversível, preserva
  // pessoas e histórico). deleteCompany continua existindo em app/actions.ts,
  // sem botão que a acione.
  const [companyToToggle, setCompanyToToggle] = useState<Company | null>(null);
  const [toggleError, setToggleError] = useState('');
  const [deleteError, setDeleteError] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSyncingBitrix24, setIsSyncingBitrix24] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const isCompanyPortalUser = [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser?.role as UserRole);
  const isCustomerAdmin = currentUser?.role === UserRole.CUSTOMER;
  const canManageCompanies = hasPermission(Permission.CUSTOMERS_WRITE);
  const canCreateEmployees = canManageCompanies || isCustomerAdmin;
  const canEditEmployees = canManageCompanies || isCustomerAdmin;
  // Cliente/Funcionário editam a logo da PRÓPRIA empresa (a lista já vem
  // filtrada só pra ela — ver loadData), equipe interna edita a de qualquer
  // uma. Ação de imagem, não de dado de negócio: não exige Administrador do
  // sistema como "Editar Empresa" (nome/setor/CS) exige.
  const canEditCompanyLogo = isCompanyPortalUser || canManageCompanies;

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

        // CS/Comercial Responsável são perfil interno — Cliente/Funcionário
        // não tem acesso a /api/users?type=analysts (403), nem precisa ver
        // esse dado.
        if (!isCompanyPortalUser) {
          UserService.getAnalysts().then(setInternalUsers).catch(() => setInternalUsers([]));
        }

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

  // Sincronização manual com o Bitrix24 (CRM) — sem job em segundo plano de
  // propósito, só o botão. Casa por nome exato: empresa já existente aqui
  // é atualizada, senão é criada. Ver lib/services/bitrix24-service.ts.
  const handleSyncBitrix24 = async () => {
    if (isSyncingBitrix24) return;
    setIsSyncingBitrix24(true);
    try {
      const res = await fetch('/api/integrations/bitrix24/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Falha ao sincronizar com o Bitrix24.');
      toast.success(`Bitrix24 sincronizado: ${data.created} nova(s), ${data.updated} atualizada(s)${data.skipped ? `, ${data.skipped} ignorada(s)` : ''}.`);
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        console.error('[Bitrix24] Erros durante a sincronização:', data.errors);
        toast.warning(`${data.errors.length} empresa(s) falharam ao sincronizar — ver console.`);
      }
      await loadData();
    } catch (err: any) {
      console.error('Erro ao sincronizar com o Bitrix24:', err);
      toast.error(err?.message || 'Falha ao sincronizar com o Bitrix24.');
    } finally {
      setIsSyncingBitrix24(false);
    }
  };

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite escolher o mesmo arquivo de novo depois de trocar
    if (!file || !selectedCompanyId) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Escolha um arquivo de imagem.');
      return;
    }
    if (file.size > MAX_LOGO_FILE_BYTES) {
      toast.error('Imagem muito grande — use um arquivo de até 4MB.');
      return;
    }

    setIsUploadingLogo(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const result = await updateCompanyLogo(selectedCompanyId, dataUrl);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setCompanies(prev => prev.map(c => c.id === selectedCompanyId ? { ...c, logoThumbUrl: result.logoThumbUrl || undefined } : c));
      toast.success('Logo atualizada.');
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao salvar a logo.');
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!selectedCompanyId) return;
    setIsUploadingLogo(true);
    try {
      const result = await updateCompanyLogo(selectedCompanyId, null);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setCompanies(prev => prev.map(c => c.id === selectedCompanyId ? { ...c, logoThumbUrl: undefined, logoUrl: undefined } : c));
      toast.success('Logo removida.');
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao remover a logo.');
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const filteredCompanies = useMemo(() => {
    // Sem busca: só as ativas, para a lista do dia a dia ficar limpa.
    // COM busca: as inativas voltam a aparecer (marcadas como tal). Esconder
    // sempre repetiria o problema que a desativação veio resolver — registro
    // que existe no banco e não aparece em lugar nenhum, deixando quem procura
    // achar que sumiu.
    if (!searchQuery.trim()) return companies.filter(c => c.isActive !== false);

    const lowerQuery = normalizeString(searchQuery);
    // Só compara dígitos quando a busca realmente tem algum — evita que uma
    // busca por texto (ex: "Jean") combine com qualquer telefone por engano.
    const digitsQuery = normalizePhone(searchQuery);

    return companies.filter(c => {
      // Direct company name match
      if (normalizeString(c.name).includes(lowerQuery)) return true;

      // Nome, e-mail ou telefone de qualquer funcionário desta empresa —
      // achar a pessoa deve levar direto pra empresa dela.
      return users.some(u => {
        if (u.companyId !== c.id) return false;
        if (normalizeString(u.name).includes(lowerQuery)) return true;
        if (normalizeString(u.email || '').includes(lowerQuery)) return true;
        if (!digitsQuery) return false;
        if (normalizePhone(u.phone || '').includes(digitsQuery)) return true;
        return (u.phones || []).some(p => normalizePhone(p).includes(digitsQuery));
      });
    });
  }, [companies, users, searchQuery]);

  const selectedCompany = useMemo(() =>
    companies.find(c => c.id === selectedCompanyId),
  [companies, selectedCompanyId]);

  const resolveInternalUser = (id?: string) => internalUsers.find(u => u.id === id);

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
              <span className="flex items-center gap-2.5">
                <span title="Sincronizar empresas do Bitrix24">
                  <RefreshCw
                    size={14}
                    onClick={handleSyncBitrix24}
                    className={cn(
                      "text-[var(--text-tertiary)] cursor-pointer hover:text-[var(--accent-text)] transition-colors",
                      isSyncingBitrix24 && "animate-spin pointer-events-none opacity-60"
                    )}
                  />
                </span>
                <Plus size={16} onClick={() => setIsCompanyModalOpen(true)} className="text-[var(--accent-text)] cursor-pointer hover:scale-125 transition-transform" />
              </span>
            )}
          </h2>

          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] group-focus-within:text-[var(--accent-text)] transition-colors" size={16} />
            <input
              type="text"
              placeholder="Buscar por empresa, funcionário, e-mail ou telefone..."
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
            filteredCompanies.map(c => {
              // Empresa desativada aparece em cinza e com etiqueta. O contraste
              // reduzido não é enfeite: ela só chega aqui quando alguém a
              // procurou de propósito, e precisa ficar evidente à primeira
              // vista que não está em uso — sem esconder o registro.
              const inativa = c.isActive === false;
              return (
              <button
                key={c.id}
                onClick={() => setSelectedCompanyId(c.id)}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all group",
                  selectedCompanyId === c.id
                    ? "bg-[var(--surface-card)] border-[var(--accent)] shadow-sm ring-2 ring-[var(--accent)]/5 translate-x-1"
                    : "bg-[var(--surface-card)] border-[var(--border-default)] hover:border-[var(--border-default)] hover:bg-[var(--surface-card)]",
                  inativa && "opacity-60 border-dashed"
                )}
              >
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center transition-all overflow-hidden shrink-0",
                  inativa
                    ? "bg-[var(--surface-pill)] text-[var(--text-tertiary)] grayscale"
                    : selectedCompanyId === c.id
                      ? "bg-[var(--accent)] text-white scale-110"
                      : "bg-[var(--surface-pill)] text-[var(--text-tertiary)] group-hover:bg-[var(--border-default)]"
                )}>
                  {c.logoThumbUrl ? (
                    <img src={c.logoThumbUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Building2 size={20} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "font-bold text-sm truncate",
                    inativa ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]"
                  )}>{c.name}</p>
                  {/* Setor removido do card a pedido — continua no cadastro
                      (Editar Empresa). A etiqueta de desativada permanece:
                      é o que explica por que a empresa aparece em cinza. */}
                  {inativa && (
                    <span className="inline-block mt-0.5 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-[var(--surface-pill)] text-[var(--text-tertiary)]">
                      Desativada
                    </span>
                  )}
                </div>
              </button>
              );
            })
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
            <div className={cn(
              "bg-[var(--surface-card)] rounded-2xl border shadow-sm overflow-hidden",
              selectedCompany.isActive === false
                ? "border-dashed border-[var(--text-tertiary)]/40"
                : "border-[var(--border-default)]"
            )}>
            {/* Faixa fixa, não um aviso passageiro: a situação da empresa é
                estado permanente da tela e precisa continuar visível enquanto
                alguém trabalha nela. */}
            {selectedCompany.isActive === false && (
              <div className="px-8 py-3 bg-[var(--surface-pill)] border-b border-[var(--border-default)] flex items-center gap-2">
                <ShieldOff size={16} className="text-[var(--text-tertiary)] shrink-0" />
                <p className="text-xs font-bold text-[var(--text-secondary)]">
                  Empresa desativada
                  <span className="font-medium text-[var(--text-tertiary)]">
                    {' '}— não aparece na lista nem nos seletores do dia a dia. Cadastro, pessoas e histórico continuam intactos.
                  </span>
                </p>
              </div>
            )}
            <div className={cn("p-8 flex justify-between items-start", selectedCompany.isActive === false && "opacity-70")}>
              <div className="flex items-center gap-6">
                <div
                  className={cn(
                    "w-20 h-20 rounded-2xl flex items-center justify-center relative group/logo overflow-hidden shrink-0",
                    selectedCompany.isActive === false
                      ? "bg-[var(--surface-pill)] text-[var(--text-tertiary)]"
                      : "bg-[var(--accent)]/10 text-[var(--accent-text)]",
                    canEditCompanyLogo && !isUploadingLogo && "cursor-pointer"
                  )}
                  onClick={() => canEditCompanyLogo && !isUploadingLogo && logoInputRef.current?.click()}
                  title={canEditCompanyLogo ? 'Clique para trocar a logo' : undefined}
                >
                  {selectedCompany.logoThumbUrl ? (
                    <img src={selectedCompany.logoThumbUrl} alt={`Logo de ${selectedCompany.name}`} className="w-full h-full object-cover" />
                  ) : (
                    <Building2 size={40} />
                  )}
                  {canEditCompanyLogo && (
                    <div className={cn(
                      "absolute inset-0 bg-black/50 flex items-center justify-center gap-2 transition-opacity",
                      isUploadingLogo ? "opacity-100" : "opacity-0 group-hover/logo:opacity-100"
                    )}>
                      {isUploadingLogo ? (
                        <RefreshCw size={18} className="text-white animate-spin" />
                      ) : (
                        <>
                          <Camera size={18} className="text-white" />
                          {selectedCompany.logoThumbUrl && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleRemoveLogo(); }}
                              title="Remover logo"
                              className="text-white/80 hover:text-white"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
                {canEditCompanyLogo && (
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLogoFileChange}
                    className="hidden"
                  />
                )}
                <div>
                  <h1 className={cn(
                    "text-3xl font-black tracking-tight",
                    selectedCompany.isActive === false ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]"
                  )}>{selectedCompany.name}</h1>
                  {/* Setor removido do cabeçalho a pedido: continua no cadastro
                      (Editar Empresa) e no card da lista lateral. */}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/customers/${selectedCompany.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Ver chamados e atendimentos desta empresa"
                  className="flex items-center gap-2 bg-[var(--surface-pill)] text-[var(--text-secondary)] px-4 py-2.5 rounded-lg text-sm font-bold border border-[var(--border-default)] hover:bg-[var(--border-default)] transition-all"
                >
                  <Ticket size={16} /> Chamados e Atendimentos
                </a>
                {canManageCompanies && (
                  <button
                    onClick={() => { setCompanyToEdit(selectedCompany); setIsCompanyModalOpen(true); }}
                    title="Editar empresa"
                    className="flex items-center gap-2 bg-[var(--accent)]/10 text-[var(--accent-text)] px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-[var(--accent)]/20 transition-all"
                  >
                    <Pencil size={16} /> Editar Empresa
                  </button>
                )}
                {/* Desativar/Reativar mora só dentro de "Editar Empresa" (ver
                    components/new-company-modal.tsx). É ação de manutenção do
                    cadastro, não do dia a dia — no cabeçalho ficava ao lado de
                    ações corriqueiras, convidando ao clique acidental. */}
                {canCreateEmployees && (
                  <button
                    onClick={() => setIsEmployeeModalOpen(true)}
                    className="flex items-center gap-2 bg-[var(--accent)] text-white px-6 py-2.5 rounded-lg text-sm font-bold shadow-md hover:bg-[var(--accent-hover)] transition-all"
                  >
                    <UserPlus size={16} /> Novo Funcionário
                  </button>
                )}
              </div>
            </div>

            <div className="px-8 py-5 border-t border-[var(--border-default)] bg-[var(--surface-pill)]/40 grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[var(--surface-card)] border border-[var(--border-default)] flex items-center justify-center text-[var(--text-tertiary)] shrink-0">
                  <Phone size={15} />
                </div>
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">Telefone</p>
                  <p className="text-sm font-bold text-[var(--text-primary)] truncate">{selectedCompany.phone || 'Sem telefone'}</p>
                </div>
              </div>
              {/* Contador de funcionários removido a pedido: a própria lista
                  de funcionários vem logo abaixo, então o número era só uma
                  repetição do que já está visível. */}
              {!isCompanyPortalUser && (
                <>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[var(--surface-card)] border border-[var(--border-default)] flex items-center justify-center text-[var(--text-tertiary)] shrink-0">
                      <Headset size={15} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">CS Responsável</p>
                      <p className="text-sm font-bold text-[var(--text-primary)] truncate">{resolveInternalUser(selectedCompany.csResponsavelId)?.name || 'Não definido'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[var(--surface-card)] border border-[var(--border-default)] flex items-center justify-center text-[var(--text-tertiary)] shrink-0">
                      <Briefcase size={15} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">Comercial Responsável</p>
                      <p className="text-sm font-bold text-[var(--text-primary)] truncate">{resolveInternalUser(selectedCompany.comercialResponsavelId)?.name || 'Não definido'}</p>
                    </div>
                  </div>
                </>
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
                        <Mail size={16} className="text-[var(--text-tertiary)]" />
                        {/* E-mail é opcional: contato vindo de conversa tem só
                            nome e telefone. Dizer que não há é mais útil que
                            uma linha vazia — e explica por que ele não recebe
                            resposta de chamado por e-mail. */}
                        {employee.email || <span className="italic text-[var(--text-tertiary)]">Sem e-mail cadastrado</span>}
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
        onRequestDeactivate={() => {
          setIsCompanyModalOpen(false);
          setCompanyToToggle(companyToEdit);
        }}
      />
      <WhatsAppNumberModal
        isOpen={isWhatsAppModalOpen}
        onClose={() => { setIsWhatsAppModalOpen(false); setSelectedEmployee(null); }}
        user={selectedEmployee}
      />
      {/* Confirmação de desativar/reativar. Não usa ConfirmModal porque aquele
          tem botão fixo "Confirmar Exclusão" em vermelho — aqui nada é
          excluído, e o botão precisa dizer a ação de verdade. */}
      {companyToToggle && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--surface-card)] rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-[var(--border-default)] flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[var(--surface-pill)] flex items-center justify-center text-[var(--text-secondary)]">
                {companyToToggle.isActive === false ? <ShieldCheck size={20} /> : <ShieldOff size={20} />}
              </div>
              <h3 className="font-bold text-[var(--text-primary)]">
                {companyToToggle.isActive === false ? 'Reativar empresa?' : 'Desativar empresa?'}
              </h3>
            </div>
            <div className="p-6 space-y-3">
              {toggleError && (
                <div className="bg-[var(--surface-danger)] border border-[var(--text-danger)]/30 text-[var(--text-danger)] rounded-xl p-4 text-sm font-medium">
                  {toggleError}
                </div>
              )}
              <p className="text-[var(--text-secondary)]">
                {companyToToggle.isActive === false
                  ? <><b>{companyToToggle.name}</b> volta a aparecer nas listas e seletores do dia a dia.</>
                  : <><b>{companyToToggle.name}</b> sai das listas e dos seletores do dia a dia. Nada é apagado: cadastro, pessoas, chamados e conversas continuam no lugar, e ela reaparece marcada como desativada quando alguém buscar por ela.</>}
              </p>
            </div>
            <div className="p-6 bg-[var(--surface-card)] flex gap-3 justify-end border-t border-[var(--border-default)]">
              <button
                onClick={() => { setCompanyToToggle(null); setToggleError(''); }}
                className="px-4 py-2 font-semibold text-[var(--text-secondary)] bg-[var(--surface-pill)] hover:bg-[var(--border-default)] rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  const alvo = companyToToggle;
                  const ativar = alvo.isActive === false;
                  const result = await setCompanyActive(alvo.id, ativar);
                  if (result.error) {
                    setToggleError(result.error);
                    return;
                  }
                  setCompanyToToggle(null);
                  setToggleError('');
                  toast.success(ativar ? 'Empresa reativada.' : 'Empresa desativada.');
                  loadData();
                }}
                className="px-4 py-2 font-semibold text-white bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors shadow-sm"
              >
                {companyToToggle.isActive === false ? 'Reativar empresa' : 'Desativar empresa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
