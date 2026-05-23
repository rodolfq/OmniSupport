import { supabase } from './supabase';
import { Ticket, Message } from './types'; 

const MOCK_EXAMPLE_TICKET: Ticket = {
  id: "ex-ticket-payment-error",
  ticketNumber: 1308,
  title: "🚨 Instabilidade Crítica: Webhooks de Pagamento Duplicados (Gateway API)",
  description: "Durante as últimas 2 horas, recebemos diversos reportes de clientes finais reclamando de cobranças duplicadas em transações Pix/Cartão de Crédito. Ao analisar os payloads que chegam no endpoint `/api/v1/payments/webhook`, observamos que a API do gateway de pagamento está realizando retentativas em menos de 500ms por ausência de um cabeçalho IDempotente. Precisamos reavaliar a validação de concorrência e o lock pessimista no banco.",
  status: "Em Andamento" as any, 
  priority: "3", 
  category: "Suporte Técnico",
  companyId: "11111111-1111-4111-8111-111111111111",
  customerName: "Carlos Henrique (CTO - Matriz)",
  customerId: "cust-demo-robson",
  assigneeId: "9ca681d2-06c7-4a9c-8ef0-cfe404078356",
  assigneeName: "Suporte Omnichannel",
  createdAt: "2026-05-21T11:22:51Z",
  updatedAt: "2026-05-21T13:22:51Z",
  tags: ["Bug", "Urgente"],
  attachments: [
    {
      id: "att-demo-json",
      name: "payload_webhook_payload.json",
      type: "application/json",
      url: "https://raw.githubusercontent.com/json-iterator/test-data/master/large-file.json",
      size: 47291
    },
    {
      id: "att-demo-png",
      name: "erro_banco_deadlock.png",
      type: "image/png",
      url: "https://picsum.photos/seed/error/800/600",
      size: 215430
    }
  ],
  history: [
    {
      id: "h1",
      actor: "Carlos Henrique",
      action: "Criou o chamado no portal",
      timestamp: "2026-05-21T11:22:51Z"
    },
    {
      id: "h2",
      actor: "Sistema",
      action: "Atribuiu automaticamente para o Nível 2 - Técnico baseado nas tags de relevância",
      timestamp: "2026-05-21T11:23:05Z"
    },
    {
      id: "h3",
      actor: "Suporte Omnichannel",
      action: "Alterou a prioridade para Alta (SLA de 24 horas - Nível Crítico)",
      timestamp: "2026-05-21T11:45:12Z"
    }
  ]
};

const MOCK_EXAMPLE_MESSAGES: Message[] = [
  {
    id: "msg-demo-1",
    ticketId: "ex-ticket-payment-error",
    senderId: "cust-demo-robson",
    text: "Olá pessoal, estamos tendo um problema muito severo de conectividade e concorrência na nossa integração. Os webhooks de pagamento estão vindo replicados e o banco de dados está apresentando 'deadlocks' ao atualizar o status do pedido do cliente final. Anexei abaixo o log JSON do webhook duplicado que causou o problema e um print do console com o erro de deadlock no Postgres do nosso lado. Precisamos de ajuda urgente para alinhar se há alguma configuração de idempotência na API do gateway de vocês!",
    timestamp: "2026-05-21T11:22:51Z",
    isVisibleToCustomer: true,
    type: "text",
    attachments: [
      {
        id: "att-demo-json",
        name: "payload_webhook_payload.json",
        type: "application/json",
        url: "https://raw.githubusercontent.com/json-iterator/test-data/master/large-file.json",
        size: 47291
      },
      {
        id: "att-demo-png",
        name: "erro_banco_deadlock.png",
        type: "image/png",
        url: "https://picsum.photos/seed/error/800/600",
        size: 215430
      }
    ]
  },
  {
    id: "msg-demo-2",
    ticketId: "ex-ticket-payment-error",
    senderId: "9ca681d2-06c7-4a9c-8ef0-cfe404078356",
    text: "[NOTA INTERNA - INFRAESTRUTURA] Equipe do Nível 2, verifiquei que o cluster de Redis que gerencia a fila de idempotência deu timeout por volta das 11:15 por alta de conexões concorrentes. Reiniciei a instância em cluster e ajustei o número máximo de conexões TCP aceitas simultaneamente de 10k para 50k. Vou responder ao cliente explicando o cenário ocorrido e sugerindo um lock otimista na tabela 'orders' para segurança de borda adicional.",
    timestamp: "2026-05-21T11:50:33Z",
    isVisibleToCustomer: false,
    type: "internal",
    attachments: []
  },
  {
    id: "msg-demo-3",
    ticketId: "ex-ticket-payment-error",
    senderId: "9ca681d2-06c7-4a9c-8ef0-cfe404078356",
    text: `Olá Carlos Henrique! Tudo bem?\n\nIdentificamos uma sobrecarga temporária em nosso barramento secundário de idempotência que gerou timeouts intermitentes na validação distribuída. Isso ocasionou o disparo de envios duplicados por nossa API de Webhook antes de completada a persistência original.\n\nA instabilidade foi resolvida em definitivo às 11:48 de hoje pela equipe de infraestrutura. De toda forma, como melhor prática de resiliência, sugerimos duas ações:\n1. Adicione um Lock Otimista (utilizando controle de versão na tabela de transações) para blindar seu banco contra concorrência.\n2. Avalie processar as mensagens webhook de forma assíncrona, enviando o status HTTP 200 de imediato e processando a entrada em segundo plano.\n\nFicamos à disposição para realizar testes conjuntos caso queira simular novas chamadas simultâneas!`,
    timestamp: "2026-05-21T12:05:00Z",
    isVisibleToCustomer: true,
    type: "text",
    attachments: []
  }
];

export async function fetchAllTickets(signal?: AbortSignal): Promise<Ticket[]> {
    let remoteTickets: Ticket[] = [];
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('tickets')
                .select(`
                    *,
                    customer:profiles!tickets_customer_id_fkey(name),
                    assignee:profiles!tickets_assignee_id_fkey(name)
                `)
                .abortSignal(signal as any);
                
            if (!error && data) {
                remoteTickets = data.map((t: any) => ({
                    ...t,
                    ticketNumber: t.public_ticket_number,
                    companyId: t.company_id,
                    customerId: t.customer_id,
                    customerName: t.customer?.name,
                    assigneeId: t.assignee_id,
                    assigneeName: t.assignee?.name,
                    createdAt: t.created_at,
                    updatedAt: t.updated_at
                })) as Ticket[];
            }
        } catch (e) {
            console.warn("Silent ignore database fetch tickets error in preview:", e);
        }
    }
    
    // Always insert mock ticket to lists so that it can be explored
    const hasExample = remoteTickets.some(t => t.id === MOCK_EXAMPLE_TICKET.id);
    if (!hasExample) {
        return [MOCK_EXAMPLE_TICKET, ...remoteTickets];
    }
    return remoteTickets;
}

export async function getTicketById(id: string, signal?: AbortSignal): Promise<Ticket | null> {
    if (id === "ex-ticket-payment-error") {
        return MOCK_EXAMPLE_TICKET;
    }
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('tickets')
        .select(`
            *,
            customer:profiles!tickets_customer_id_fkey(name),
            assignee:profiles!tickets_assignee_id_fkey(name)
        `)
        .eq('id', id)
        .abortSignal(signal as any)
        .single();
        
    if (error) {
        if (error.message === 'FetchIsAborted' || error.code === '20' || error.message?.includes('aborted')) return null;
        console.error("Error fetching ticket:", error);
        return null;
    }

    if (!data) return null;
    
    return {
        ...data,
        ticketNumber: data.public_ticket_number,
        companyId: data.company_id,
        customerId: data.customer_id,
        customerName: data.customer?.name,
        assigneeId: data.assignee_id,
        assigneeName: data.assignee?.name,
        createdAt: data.created_at,
        updatedAt: data.updated_at
    } as Ticket;
}

export async function createTicket(ticket: Ticket): Promise<void> {
    console.log("🎟️ createTicket: Iniciando criação...");
    
    if (!supabase) {
        throw new Error("Supabase client não inicializado.");
    }

    // 1. Obter sessão atual de forma robusta
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
        console.error("❌ Erro ao buscar sessão:", sessionError);
    }

    const authUser = session?.user || null;
    
    // 2. Definir UID do usuário (prioridade absoluta para o que vem da sessão)
    const userId = authUser?.id || ticket.customerId;
    
    if (!userId) {
      console.error("🚫 createTicket: NID não encontrado. Sessão inválida.");
      throw new Error("Sessão expirada. Por favor, faça login novamente.");
    }

    const payload = {
        title: ticket.title,
        description: ticket.description,
        status: ticket.status || 'Novo',
        priority: ticket.priority || 'Baixa',
        category: ticket.category || 'Geral',
        customer_id: userId,
        assignee_id: ticket.assigneeId || null,
        company_id: (ticket.companyId && ticket.companyId !== '') ? ticket.companyId : null,
    };

    console.log("📤 createTicket - Payload Simplificado:", payload);

    const { data, error } = await supabase
        .from('tickets')
        .insert(payload)
        .select()
        .single();
        
    if (error) {
        console.error("🚫 ERRO SUPABASE TICKETS:", {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint
        });
        throw error;
    }
    
    console.log("✅ Ticket criado com sucesso!", data);
}

export async function updateTicket(ticket: Partial<Ticket> & { id: string }): Promise<void> {
    const { error } = await supabase!
        .from('tickets')
        .update({
          title: ticket.title,
          description: ticket.description,
          status: ticket.status,
          priority: ticket.priority,
          category: ticket.category,
          company_id: ticket.companyId,
          customer_id: ticket.customerId,
          assignee_id: ticket.assigneeId,
          updated_at: new Date().toISOString()
        })
        .eq('id', ticket.id);
        
    if (error) {
        console.error("Error updating ticket:", error);
        throw error;
    }
}

export async function fetchMessages(ticketId: string, signal?: AbortSignal): Promise<Message[]> {
    if (ticketId === 'ex-ticket-payment-error') {
        return MOCK_EXAMPLE_MESSAGES;
    }
    const { data, error } = await supabase!
        .from('ticket_messages')
        .select('*')
        .eq('ticket_id', ticketId)
        .abortSignal(signal as any)
        .order('created_at', { ascending: true });
        
    if (error) {
        if (error.message === 'FetchIsAborted' || error.code === '20' || error.message?.includes('aborted')) return [];
        console.error("Error fetching messages:", error);
        throw error;
    }
    
    return (data || []).map((m: any) => ({
        id: m.id,
        ticketId: m.ticket_id,
        senderId: m.author_id,
        text: m.content,
        timestamp: m.created_at,
        isVisibleToCustomer: m.is_visible_to_customer,
        type: m.type
    })) as Message[];
}

export async function createMessage(message: Message): Promise<void> {
    const { error } = await supabase!
        .from('ticket_messages')
        .insert({
          ticket_id: message.ticketId,
          author_id: message.senderId,
          content: message.text,
          created_at: message.timestamp,
          is_visible_to_customer: message.isVisibleToCustomer,
          type: message.type
        });
        
    if (error) {
        console.error("Error creating message:", error);
        throw error;
    }
}
