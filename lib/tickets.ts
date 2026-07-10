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
  
  try {
    const res = await fetch('/api/tickets');
    if (res.ok) {
      remoteTickets = await res.json();
    }
  } catch (e) {
    console.warn("Error fetching tickets on client:", e);
  }
  
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

  const res = await fetch(`/api/tickets?id=${id}`);
  if (!res.ok) return null;
  return res.json();
}

export async function createTicket(ticket: Ticket): Promise<void> {
  let userId = ticket.customerId;
  
  const meRes = await fetch('/api/auth/me');
  if (meRes.ok) {
    const meData = await meRes.json();
    if (meData.user) {
      userId = meData.user.id;
    }
  }

  const res = await fetch('/api/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create', ticket, userId })
  });
  
  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.error || 'Erro ao criar ticket');
  }
}

export async function updateTicket(ticket: Partial<Ticket> & { id: string }): Promise<void> {
  const res = await fetch(`/api/tickets?id=${ticket.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ticket)
  });
  if (!res.ok) throw new Error('Error updating ticket via API');
}

export async function fetchMessages(ticketId: string, signal?: AbortSignal): Promise<Message[]> {
  if (ticketId === 'ex-ticket-payment-error') {
    return MOCK_EXAMPLE_MESSAGES;
  }

  const res = await fetch(`/api/tickets?action=messages&ticketId=${ticketId}`);
  if (!res.ok) return [];
  return res.json();
}

export async function createMessage(message: Message): Promise<void> {
  const res = await fetch('/api/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create-message', message })
  });
  if (!res.ok) throw new Error('Error creating ticket message via API');
}
