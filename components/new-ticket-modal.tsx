"use client";

import React, { useState, useRef, useEffect } from "react";
import { StyledSelect } from '@/components/styled-select';
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
import { selectableOptions } from "@/lib/utils";
import { useApp } from "@/app/app-context";
import {
  TicketStatus,
  Ticket,
  Attachment,
  User,
  Company,
  CategoryConfig,
  RequestTypeConfig,
  ProductConfig,
  PriorityConfig,
  UserRole,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { fileToBase64 } from "@/lib/image-utils";
import { toast } from "sonner";
import {
  useCompaniesQuery,
  useProfilesLiteQuery,
  useConfigCategoriesQuery,
  useConfigPrioritiesQuery,
  useConfigStatusesQuery,
  useQueuesQuery,
  useConfigRequestTypesQuery,
  useConfigProductsQuery,
} from "@/lib/query-hooks";
import { createTicket } from "@/lib/tickets";
import { RichEditor } from "./rich-editor";
import { AttachmentPreviewModal, AttachmentChipThumb, isImageAttachment } from "./attachment-gallery";

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
    prefilledTicketTitle,
    setPrefilledTicketTitle,
    prefilledTicketDescription,
    setPrefilledTicketDescription,
  } = useApp();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [queueId, setQueueId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [requestTypeId, setRequestTypeId] = useState("");
  const [productId, setProductId] = useState("");
  const [priority, setPriority] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  // Aplica título/descrição prontos (ex.: mensagem do chat interno
  // transformada em chamado, ver app/(portal)/chat-internal/page.tsx)
  // DURANTE o render, não num useEffect — se fosse por efeito, o
  // RichEditor (components/rich-editor.tsx) já montava com content="" no
  // primeiro render e só corrigia depois via sync; na prática isso não
  // chegava a aparecer de forma confiável (o editor Tiptap é desmontado e
  // remontado a cada abertura do modal, e cada remontagem tem sua própria
  // corrida entre "criar editor" e "sincronizar content"). Setando aqui
  // (padrão oficial do React pra "ajustar estado ao detectar uma transição
  // de prop", ver react.dev "You Might Not Need an Effect"), o formulário
  // só chega a ser desenhado já com o valor certo — sem instante vazio.
  const [wasOpen, setWasOpen] = useState(isNewTicketModalOpen);
  if (wasOpen !== isNewTicketModalOpen) {
    setWasOpen(isNewTicketModalOpen);
    if (isNewTicketModalOpen) {
      setTitle(prefilledTicketTitle || "");
      setDescription(prefilledTicketDescription || "");
    }
  }

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [assigneeId, setAssigneeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Dado de referência (empresas, usuários, config_*, filas) vem dos hooks
  // compartilhados de lib/query-hooks.ts (cache de 60s do TanStack Query) em
  // vez de buscado do zero toda vez que o modal abre — era a causa da
  // lentidão ao criar um novo chamado (fluxo mais usado do sistema).
  // `enabled: isNewTicketModalOpen` é essencial aqui: este componente fica
  // sempre montado no layout do portal (só o JSX interno é condicional),
  // então sem isso os 8 hooks abaixo disparariam em TODA navegação do
  // portal, não só quando o modal realmente abre.
  const { data: companiesData } = useCompaniesQuery({ enabled: isNewTicketModalOpen });
  const companies = React.useMemo(
    () => ([...(companiesData || [])] as Company[]).sort((a, b) => a.name.localeCompare(b.name)),
    [companiesData]
  );

  // Lite (sem avatar_url) — este modal só usa id/name/role/isAdmin nos
  // selects de solicitante/responsável, nunca renderiza foto.
  const { data: profilesData } = useProfilesLiteQuery({ enabled: isNewTicketModalOpen });
  // useMemo é essencial em todos os `(xData || [])` abaixo: `availablePriorities`
  // entra na dependência de um useEffect que chama setPriority — sem memo,
  // cada um desses vira um array novo a cada render enquanto a respectiva
  // query não resolve, arriscando o mesmo loop de render infinito já visto
  // (e corrigido) em chat-widget.tsx.
  const users = React.useMemo(() => (profilesData || []) as User[], [profilesData]);
  const analysts = React.useMemo(
    () =>
      users.filter(
        (u) =>
          u.role === "Equipe" ||
          u.role === "Administrador" ||
          u.isAdmin ||
          (u.role as any) === "Admin",
      ),
    [users]
  );

  // selectableOptions sem id selecionado: aqui o chamado está sendo CRIADO, e
  // opção arquivada não deve mais ser oferecida a chamado novo — só continua
  // visível onde já foi usada (ver ticket-detail-modal.tsx).
  const { data: categoriesData } = useConfigCategoriesQuery({ enabled: isNewTicketModalOpen });
  const availableCategories = React.useMemo(
    () => selectableOptions((categoriesData || []) as CategoryConfig[]),
    [categoriesData]
  );
  const { data: queuesData } = useQueuesQuery({ enabled: isNewTicketModalOpen });
  const availableQueues = React.useMemo(() => (queuesData || []) as Array<{ id: string; name: string }>, [queuesData]);
  const { data: requestTypesData } = useConfigRequestTypesQuery({ enabled: isNewTicketModalOpen });
  const availableRequestTypes = React.useMemo(
    () => selectableOptions((requestTypesData || []) as RequestTypeConfig[]),
    [requestTypesData]
  );
  const { data: productsData } = useConfigProductsQuery({ enabled: isNewTicketModalOpen });
  const availableProducts = React.useMemo(
    () => selectableOptions((productsData || []) as ProductConfig[]),
    [productsData]
  );
  const { data: prioritiesData } = useConfigPrioritiesQuery({ enabled: isNewTicketModalOpen });
  const availablePriorities = React.useMemo(() => (prioritiesData || []) as PriorityConfig[], [prioritiesData]);
  // Escopado a 'ticket' (não estava antes — buscava status de chamado E de
  // ticket interno misturados via SELECT * sem filtro). Este modal só cria
  // chamado, então o filtro é mais correto, não só mais rápido.
  const { data: statusesData } = useConfigStatusesQuery('ticket', { enabled: isNewTicketModalOpen });
  const availableStatuses = React.useMemo(() => (statusesData || []) as any[], [statusesData]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cliente e Funcionário são os dois papéis do "portal da empresa" — nenhum
  // dos dois deve ver os campos de uso interno (Empresa/Cliente, Marcadores,
  // Analista Responsável). Faltar UserRole.CUSTOMER aqui fazia um usuário
  // "Cliente" ver a tela de analista, inclusive o seletor de empresa
  // pré-preenchido com o company_id da própria conta.
  const isCustomer = currentUser?.role === UserRole.CUSTOMER || currentUser?.role === UserRole.EMPLOYEE;

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
    if (!isNewTicketModalOpen) return;

    // Reinicia os campos de seleção a cada abertura do modal — sem isso,
    // "Empresa/Cliente" e os demais selects ficavam com o valor da última
    // vez que um chamado foi criado (só título/descrição/anexos eram
    // limpos no sucesso do submit), dando a impressão de estar pré-preenchido.
    setSelectedCompanyId("");
    setSelectedCustomerId("");
    setEmployeeIds([]);
    setQueueId("");
    setCategoryId("");
    setRequestTypeId("");
    setProductId("");
    setPriority("");
    setTags([]);
    setTagInput("");
    setAssigneeId("");

    // Só pré-preenche empresa/solicitante pra quem é o próprio cliente —
    // contas internas (Administrador/Equipe) também podem ter um
    // company_id preenchido no perfil (ex: o admin semeado aponta pra
    // "Empresa Matriz Ltda"), o que fazia o campo aparecer com uma
    // empresa "fantasma" já selecionada mesmo pra quem cria chamado em
    // nome de terceiros.
    if (isCustomer && currentUser && currentUser.companyId) {
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

    // Título/descrição prontos são aplicados durante o render, não aqui
    // (ver o `if (wasOpen !== isNewTicketModalOpen)` logo acima dos
    // useState) — só a limpeza do rascunho no context (abaixo) continua
    // precisando ser um efeito de verdade.
    return () => {
      // Clear preselection when modal closes
      setPreselectedUserId(null);
      setPreselectedCompanyId(null);
      setPrefilledTicketTitle(null);
      setPrefilledTicketDescription(null);
    };
  }, [
    isNewTicketModalOpen,
    currentUser?.id,
    currentUser?.companyId,
    preselectedUserId,
    preselectedCompanyId,
    isCustomer,
  ]);

  // Prioridade padrão (a primeira cadastrada) — só quando o campo ainda está
  // vazio, pra não sobrescrever escolha do usuário. Separado do efeito acima
  // porque agora depende dos dados do hook (podem já estar em cache e
  // resolver antes/depois do reset de campos).
  useEffect(() => {
    if (isNewTicketModalOpen && !priority && availablePriorities[0]) {
      setPriority(availablePriorities[0].label);
    }
  }, [isNewTicketModalOpen, priority, availablePriorities]);

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
      queueId: queueId || undefined,
      categoryId: categoryId || undefined,
      requestTypeId: requestTypeId || undefined,
      productId: productId || undefined,
      employeeIds: employeeIds,
      tags: tags,
      assigneeId: assigneeId || undefined,
      attachments: attachments,
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
    <>
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
            className="relative bg-[var(--surface-card)] w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden border border-[var(--border-default)]"
          >
            <div className="bg-slate-900 px-8 py-6 text-white flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black tracking-tight m-0">
                  Novo Chamado
                </h3>
                <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">
                  Descreva sua solicitação com detalhes
                </p>
              </div>
              <button
                onClick={() => setIsNewTicketModalOpen(false)}
                className="p-2 hover:bg-white/10 rounded-xl transition-colors text-[var(--text-tertiary)] hover:text-white"
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
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] ml-1">
                      Empresa / Cliente
                    </label>
                    <StyledSelect
                      value={selectedCompanyId}
                      onChange={(e) => {
                        setSelectedCompanyId(e.target.value);
                        setSelectedCustomerId("");
                        setEmployeeIds([]);
                      }}
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] transition-all appearance-none outline-none disabled:opacity-60"
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
                    </StyledSelect>
                    {companies.length === 0 && (
                      <p className="text-[9px] text-[var(--text-danger)] font-bold mt-1">
                        Nenhuma empresa carregada. Verifique o banco de dados.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] ml-1">
                      Solicitante Principal
                    </label>
                    <StyledSelect
                      value={selectedCustomerId}
                      onChange={(e) => setSelectedCustomerId(e.target.value)}
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] transition-all appearance-none outline-none disabled:opacity-60"
                      required
                    >
                      <option value="">Selecione o solicitante</option>
                      {filteredUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </StyledSelect>
                  </div>
                </div>
              )}

              {/* Funcionários com Acesso */}
              {!isCustomer && (
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] ml-1">
                    Funcionários com Acesso (Recebem atualizações)
                  </label>
                  <div className="flex flex-wrap gap-2 p-3 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl min-h-[46px]">
                    {filteredUsers.length === 0 && (
                      <p className="text-xs text-[var(--text-tertiary)] italic">
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
                            ? "bg-[var(--accent)] border-[var(--accent)] text-white shadow-sm"
                            : "bg-[var(--surface-card)] border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-default)]",
                        )}
                      >
                        {u.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] ml-1">
                  Assunto do Chamado
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex: Erro ao gerar relatório mensal"
                  className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] ml-1">
                    Fila
                  </label>
                  <StyledSelect
                    value={queueId}
                    onChange={(e) => setQueueId(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all appearance-none"
                  >
                    <option value="">Selecione uma fila</option>
                    {availableQueues.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.name}
                      </option>
                    ))}
                  </StyledSelect>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] ml-1">
                    Categoria
                  </label>
                  <StyledSelect
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all appearance-none"
                  >
                    <option value="">Selecione uma categoria</option>
                    {availableCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.label}
                      </option>
                    ))}
                  </StyledSelect>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] ml-1">
                    Tipo de Solicitação
                  </label>
                  <StyledSelect
                    value={requestTypeId}
                    onChange={(e) => setRequestTypeId(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all appearance-none"
                  >
                    <option value="">Selecione um tipo de solicitação</option>
                    {availableRequestTypes.map((rt) => (
                      <option key={rt.id} value={rt.id}>
                        {rt.label}
                      </option>
                    ))}
                  </StyledSelect>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] ml-1">
                    Prioridade
                  </label>
                  <StyledSelect
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all appearance-none"
                  >
                    <option value="">Selecione a prioridade</option>
                    {availablePriorities.map((p) => (
                      <option key={p.id} value={p.label}>
                        {p.label}
                      </option>
                    ))}
                  </StyledSelect>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] ml-1">
                  Produto
                </label>
                <StyledSelect
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all appearance-none"
                >
                  <option value="">Selecione um produto</option>
                  {availableProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </StyledSelect>
              </div>

              {!isCustomer && (
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] ml-1">
                    Marcadores
                  </label>
                  <div className="flex flex-wrap items-center gap-2 p-3 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl min-h-[46px]">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-[var(--surface-pill)] text-[var(--text-pill)]"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => setTags(tags.filter((t) => t !== tag))}
                          className="hover:text-[var(--text-danger)]"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault();
                          const value = tagInput.trim();
                          if (value && !tags.includes(value)) {
                            setTags([...tags, value]);
                          }
                          setTagInput("");
                        }
                      }}
                      placeholder="Digite e pressione Enter..."
                      className="flex-1 min-w-[120px] bg-transparent text-sm font-medium outline-none"
                    />
                  </div>
                </div>
              )}

              {!isCustomer && (
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] ml-1">
                    Analista Responsável (Opcional)
                  </label>
                  <StyledSelect
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all appearance-none"
                  >
                    <option value="">Aguardando Atribuição</option>
                    {analysts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.role})
                      </option>
                    ))}
                  </StyledSelect>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] ml-1">
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
                <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] ml-1">
                  Anexos (Imagem, Áudio, Docs)
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
                      ? "bg-[var(--accent)]/10 border-[var(--accent)] scale-[1.02]"
                      : "bg-[var(--surface-card)] border-[var(--border-default)] hover:border-[var(--border-default)]",
                  )}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="text-[var(--text-tertiary)]" size={24} />
                  <p className="text-xs font-bold text-[var(--text-tertiary)]">
                    Clique ou arraste arquivos aqui
                  </p>
                  <p className="text-[10px] text-[var(--text-tertiary)]">
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
                    {attachments.map((att) => {
                      const isImage = isImageAttachment(att);

                      return (
                        <div
                          key={att.id}
                          className="flex items-center justify-between p-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl"
                        >
                          <button
                            type="button"
                            onClick={() => isImage && setPreviewAttachment(att)}
                            disabled={!isImage}
                            className="flex min-w-0 items-center gap-2 overflow-hidden text-left disabled:cursor-default"
                            title={isImage ? "Visualizar imagem" : undefined}
                          >
                            <AttachmentChipThumb
                              attachment={att}
                              size={18}
                              fallback={
                                isImage ? (
                                  <ImageIcon size={14} className="text-[var(--accent-text)]" />
                                ) : att.type.startsWith("audio/") ? (
                                  <Music size={14} className="text-pink-500 dark:text-pink-400" />
                                ) : (
                                  <FileText size={14} className="text-[var(--text-tertiary)]" />
                                )
                              }
                            />
                            <span className="text-[10px] font-bold text-[var(--text-secondary)] truncate">
                              {att.name}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeAttachment(att.id)}
                            className="p-1 hover:bg-[var(--surface-danger)] text-[var(--text-tertiary)] hover:text-[var(--text-danger)] rounded-lg transition-all"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="pt-2 flex gap-4">
                <button
                  type="button"
                  onClick={() => setIsNewTicketModalOpen(false)}
                  className="flex-1 px-6 py-3 rounded-xl text-sm font-bold text-[var(--text-tertiary)] hover:bg-[var(--surface-card)] transition-all border border-[var(--border-default)]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading || saveSuccess}
                  className={cn(
                    "flex-1 px-6 py-3 rounded-xl text-sm font-black uppercase tracking-widest shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed",
                    saveSuccess
                      ? "bg-[var(--text-success)] text-white"
                      : "bg-[var(--accent)] text-white shadow-indigo-100 hover:bg-[var(--accent-hover)]",
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
      <AttachmentPreviewModal attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />
    </>
  );
}
