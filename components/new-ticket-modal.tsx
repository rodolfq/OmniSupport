"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  X,
  Send,
  AlertCircle,
  Paperclip,
  Image as ImageIcon,
  FileText,
  Music,
  Trash2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useApp } from "@/app/app-context";
import {
  TicketStatus,
  Ticket,
  Attachment,
  User,
  Company,
  CategoryConfig,
  PriorityConfig,
  UserRole,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { fileToBase64 } from "@/lib/image-utils";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { createTicket } from "@/lib/tickets";
import { RichEditor } from "./rich-editor";

export function NewTicketModal() {
  const {
    isNewTicketModalOpen,
    setIsNewTicketModalOpen,
    currentUser,
    triggerRefresh,
    preselectedUserId,
    setPreselectedUserId,
    preselectedCompanyId,
    setPreselectedCompanyId,
  } = useApp();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [assigneeId, setAssigneeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [analysts, setAnalysts] = useState<User[]>([]);
  const [availableCategories, setAvailableCategories] = useState<
    CategoryConfig[]
  >([]);
  const [availablePriorities, setAvailablePriorities] = useState<
    PriorityConfig[]
  >([]);
  const [availableStatuses, setAvailableStatuses] = useState<any[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isCustomer = currentUser?.role === UserRole.EMPLOYEE;

  useEffect(() => {
    if (isNewTicketModalOpen && currentUser) {
      console.log("” NewTicketModal Debug:", {
        role: currentUser.role,
        isCustomer,
        companyId: currentUser.companyId,
        companiesCount: companies.length,
      });
    }
  }, [isNewTicketModalOpen, currentUser, isCustomer, companies.length]);

  useEffect(() => {
    async function fetchData() {
      if (!isNewTicketModalOpen) return;

      try {
        console.log("”„ NewTicketModal: Buscando dados para novo chamado...");
        // Fetch companies (always fetch all)
        const { data: loadedCompanies, error: companiesError } = await supabase
          .from("companies")
          .select("id, name")
          .order("name", { ascending: true });

        console.log("DEBUG loadedCompanies:", loadedCompanies);
        if (companiesError) {
          console.error("DEBUG companiesError:", companiesError);
          setCompanies([]);
        } else {
          setCompanies(loadedCompanies || []);
        }

        // Fetch users
        const { data: loadedUsers, error: usersError } = await supabase
          .from("profiles")
          .select("*");
        
        let mappedUsers: User[] = [];
        if (usersError) {
          console.error("DEBUG usersError:", usersError);
          setUsers([]);
        } else {
          mappedUsers = (loadedUsers || []).map((u) => ({
            ...u,
            companyId: u.company_id,
          })) as User[];
          setUsers(mappedUsers);
        }

        const currentUsers = mappedUsers;
        // Fetch analysts (filtering by role/is_admin)
        const analystsList = currentUsers.filter(
          (u) =>
            u.role === "Equipe" ||
            u.role === "Administrador" ||
            u.isAdmin ||
            u.role === "Admin",
        );
        setAnalysts(analystsList);

        // Config tables
        const [catRes, priRes, staRes] = await Promise.all([
          supabase.from("config_categories").select("*"),
          supabase.from("config_priorities").select("*"),
          supabase.from("config_statuses").select("*"),
        ]);

        setAvailableCategories(catRes.data || []);
        setAvailablePriorities(priRes.data || []);
        setAvailableStatuses(staRes.data || []);

        if (!category && catRes.data?.[0]) {
          setCategory(catRes.data[0].label);
        }
        if (!priority && priRes.data?.[0]) {
          setPriority(priRes.data[0].label);
        }

        if (currentUser && currentUser.companyId) {
          setSelectedCompanyId(currentUser.companyId);
          setSelectedCustomerId(currentUser.id);
          setEmployeeIds([currentUser.id]); // Auto-select requester
        }

        if (preselectedCompanyId) {
          setSelectedCompanyId(preselectedCompanyId);
        }
        if (preselectedUserId) {
          setSelectedCustomerId(preselectedUserId);
        }
      } catch (err) {
        console.error("Erro ao carregar dados do Supabase:", err);
        toast.error("Erro ao carregar dados do sistema.");
      }
    }

    fetchData();

    return () => {
      // Clear preselection when modal closes
      setPreselectedUserId(null);
      setPreselectedCompanyId(null);
    };
  }, [
    isNewTicketModalOpen,
    currentUser?.id,
    currentUser?.companyId,
    preselectedUserId,
    preselectedCompanyId,
    isCustomer,
  ]);

  const filteredUsers = users.filter((u) => u.companyId === selectedCompanyId);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files) return;
    const newAttachments: Attachment[] = await Promise.all(
      Array.from(files).map(async (file) => ({
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        type: file.type,
        url: await fileToBase64(file),
        size: file.size,
      })),
    );
    setAttachments([...attachments, ...newAttachments]);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const blob = items[i].getAsFile();
        if (blob) {
          const file = new File([blob], `pasted-image-${Date.now()}.png`, {
            type: blob.type,
          });
          handleFileUpload([file] as unknown as FileList);
        }
      }
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments(attachments.filter((a) => a.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setLoading(true);

    const newTicket: Ticket = {
      id: crypto.randomUUID(),
      ticketNumber: undefined,
      title,
      description,
      status: (availableStatuses[0]?.label || TicketStatus.NEW) as any,
      priority,
      companyId: selectedCompanyId,
      customerId: selectedCustomerId || currentUser.id,
      category: category || "Geral",
      tags: [],
      // Note: employeeIds, assigneeId, attachments not in current schema - ignored for DB
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      // Save directly to Supabase via our new service
      await createTicket(newTicket);

      setSaveSuccess(true);
      triggerRefresh();
      toast.success(`Chamado criado com sucesso!`);

      setTimeout(() => {
        setSaveSuccess(false);
        setIsNewTicketModalOpen(false);
        // Reset form
        setTitle("");
        setDescription("");
        setAttachments([]);
        setEmployeeIds([]);
        setSelectedCustomerId("");
        setAssigneeId("");
      }, 1500);
    } catch (error: any) {
      console.error("Erro detalhado ao criar chamado:", {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
        error: error,
      });
      toast.error(
        "Erro ao abrir o chamado. Verifique os logs do console para mais detalhes.",
      );
    } finally {
      setLoading(false);
    }
  };

  const toggleEmployee = (userId: string) => {
    if (employeeIds.includes(userId)) {
      setEmployeeIds(employeeIds.filter((id) => id !== userId));
    } else {
      setEmployeeIds([...employeeIds, userId]);
    }
  };

  return (
    <AnimatePresence>
      {isNewTicketModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsNewTicketModalOpen(false)}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden border border-slate-200"
          >
            <div className="bg-slate-900 px-8 py-6 text-white flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black tracking-tight m-0">
                  Novo Chamado
                </h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                  Descreva sua solicitação com detalhes
                </p>
              </div>
              <button
                onClick={() => setIsNewTicketModalOpen(false)}
                className="p-2 hover:bg-white/10 rounded-xl transition-colors text-slate-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              className="p-8 space-y-5 max-h-[80vh] overflow-y-auto"
            >
              {/* Informações Básicas */}
              {!isCustomer && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">
                      Empresa / Cliente
                    </label>
                    <select
                      value={selectedCompanyId}
                      onChange={(e) => {
                        setSelectedCompanyId(e.target.value);
                        setSelectedCustomerId("");
                        setEmployeeIds([]);
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all appearance-none outline-none disabled:opacity-60"
                      required
                    >
                      <option value="">
                        Selecione uma empresa ({companies.length} encontradas)
                      </option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    {companies.length === 0 && (
                      <p className="text-[9px] text-red-500 font-bold mt-1">
                        Nenhuma empresa carregada. Verifique o banco de dados.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">
                      Solicitante Principal
                    </label>
                    <select
                      value={selectedCustomerId}
                      onChange={(e) => setSelectedCustomerId(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all appearance-none outline-none disabled:opacity-60"
                      required
                    >
                      <option value="">Selecione o solicitante</option>
                      {filteredUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Funcionários com Acesso */}
              {!isCustomer && (
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">
                    Funcionários com Acesso (Recebem atualizações)
                  </label>
                  <div className="flex flex-wrap gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl min-h-[46px]">
                    {filteredUsers.length === 0 && (
                      <p className="text-xs text-slate-400 italic">
                        Selecione uma empresa primeiro
                      </p>
                    )}
                    {filteredUsers.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => toggleEmployee(u.id)}
                        className={cn(
                          "px-3 py-1 rounded-full text-xs font-bold border transition-all",
                          employeeIds.includes(u.id)
                            ? "bg-indigo-600 border-indigo-600 text-white shadow-sm"
                            : "bg-white border-slate-200 text-slate-600 hover:border-slate-300",
                        )}
                      >
                        {u.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">
                  Assunto do Chamado
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex: Erro ao gerar relatório mensal"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">
                    Categoria
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all appearance-none"
                  >
                    <option value="">Selecione uma categoria</option>
                    {availableCategories.map((cat) => (
                      <option key={cat.id} value={cat.label}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">
                    Prioridade
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all appearance-none"
                  >
                    <option value="">Selecione a prioridade</option>
                    {availablePriorities.map((p) => (
                      <option key={p.id} value={p.label}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {!isCustomer && (
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">
                    Analista Responsável (Opcional)
                  </label>
                  <select
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all appearance-none"
                  >
                    <option value="">Aguardando Atribuição</option>
                    {analysts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.role})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">
                  Descrição Detalhada (Editor Moderno)
                </label>
                <RichEditor
                  content={description}
                  onChange={setDescription}
                  placeholder="Explique o que aconteceu, passos para reproduzir, insira imagens ou vídeos..."
                  minHeight="200px"
                />
              </div>

              {/* Anexos */}
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">
                  Anexos (Imagem, Ãudio, Docs)
                </label>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    handleFileUpload(e.dataTransfer.files);
                  }}
                  className={cn(
                    "border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center gap-2 transition-all cursor-pointer",
                    isDragging
                      ? "bg-indigo-50 border-indigo-500 scale-[1.02]"
                      : "bg-slate-50 border-slate-200 hover:border-slate-300",
                  )}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="text-slate-400" size={24} />
                  <p className="text-xs font-bold text-slate-500">
                    Clique ou arraste arquivos aqui
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Suporta múltiplos arquivos e imagens do clipboard
                  </p>
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    ref={fileInputRef}
                    onChange={(e) => handleFileUpload(e.target.files)}
                  />
                </div>

                {attachments.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    {attachments.map((att) => (
                      <div
                        key={att.id}
                        className="flex items-center justify-between p-2 bg-white border border-slate-200 rounded-xl"
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          {att.type.startsWith("image/") ? (
                            <ImageIcon size={14} className="text-indigo-500" />
                          ) : att.type.startsWith("audio/") ? (
                            <Music size={14} className="text-pink-500" />
                          ) : (
                            <FileText size={14} className="text-slate-400" />
                          )}
                          <span className="text-[10px] font-bold text-slate-700 truncate">
                            {att.name}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAttachment(att.id)}
                          className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-lg transition-all"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-2 flex gap-4">
                <button
                  type="button"
                  onClick={() => setIsNewTicketModalOpen(false)}
                  className="flex-1 px-6 py-3 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50 transition-all border border-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading || saveSuccess}
                  className={cn(
                    "flex-1 px-6 py-3 rounded-xl text-sm font-black uppercase tracking-widest shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed",
                    saveSuccess
                      ? "bg-emerald-500 text-white"
                      : "bg-indigo-600 text-white shadow-indigo-100 hover:bg-indigo-700",
                  )}
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Criando...
                    </>
                  ) : saveSuccess ? (
                    "Chamado Aberto!"
                  ) : (
                    <>
                      Abrir Chamado <Send size={16} />
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
