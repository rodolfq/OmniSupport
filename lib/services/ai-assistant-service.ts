import Groq from 'groq-sdk';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { query } from '@/lib/db';
import { isEmbeddingEnabled, semanticSearch, truncateText } from './embedding-service';

// Agente de IA (widget flutuante) — combina duas estratégias de busca:
// 1) ferramentas específicas por palavra-chave/SQL (search_tickets,
//    get_ticket_details, etc.) — precisas, rápidas, ótimas quando o
//    usuário sabe o que procura (nome de empresa, número do chamado).
// 2) semantic_search — busca por significado sobre TODO o histórico
//    indexado (ver lib/services/embedding-service.ts e
//    migrations/ai_embeddings.sql), pra perguntas amplas/vagas que uma
//    busca exata não cobre bem. Só funciona se ENABLE_AI_EMBEDDINGS=true
//    no servidor — a ferramenta já avisa o modelo quando está desligada,
//    em vez de parecer "não achei nada".
// Cobre as 4 fontes pedidas — chat com cliente, chat de grupo interno,
// chamados e tickets internos — Google Drive fica fora por enquanto.
//
// Provedor: Groq (API compatível com o formato da OpenAI), não Gemini —
// trocado depois que o projeto Google Cloud da chave Gemini veio com cota
// gratuita zerada (limit: 0) e o desbloqueio via Google Cloud passou a
// exigir recarga mínima. Groq tem tier gratuito de verdade, sem cartão.
//
// Nunca chamar sem checar Permission.AI_ASSISTANT_USE antes (ver
// app/api/ai-assistant/route.ts) — o agente tem acesso de leitura amplo às
// 4 fontes, sem repetir aqui o escopo fino (por fila/empresa) que cada tela
// já aplica. Limitação aceita nesta v1, documentada pro usuário.

const MODEL_NAME = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
// Reduzido de 4 pra 3 (menos uma rodada de reenvio de schema+histórico no
// pior caso) e limites de resultado cortados (eram 8/20) — o agente bateu
// o teto diário de tokens do Groq (100k/dia no tier gratuito); cada
// resultado a mais em cada busca é texto reenviado em toda rodada
// seguinte.
const MAX_TOOL_ROUNDS = 3;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 12;

// Erro distinto de propósito — a rota (app/api/ai-assistant/route.ts) usa
// isso pra devolver "assistente não configurado" em vez da mensagem
// genérica de falha transitória, que só confunde quem está configurando a
// chave pela primeira vez.
export class AssistantNotConfiguredError extends Error {}

function getClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new AssistantNotConfiguredError('GROQ_API_KEY não configurada — ver seção 4 do CLAUDE.md.');
  }
  return new Groq({ apiKey });
}

// Aceita number OU string — o schema das ferramentas declara `limit` como
// ['number', 'string'] de propósito (modelos via Groq às vezes mandam
// "12" em vez de 12; um schema estrito só de 'number' faz a API do Groq
// rejeitar a chamada inteira com 400 tool_use_failed antes mesmo do
// código aqui rodar, então a tolerância tem que estar no schema, não só
// na hora de usar o valor).
function clampLimit(n?: number | string): number {
  const v = Math.trunc(Number(n ?? DEFAULT_LIMIT));
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_LIMIT;
  return Math.min(v, MAX_LIMIT);
}

// Mesma tolerância number|string de clampLimit, pra ticketNumber/
// internalTicketNumber — usados em comparação SQL exata, não em LIMIT.
function toNumberOrUndefined(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// --- Tool declarations -----------------------------------------------------
// JSON Schema puro (formato OpenAI-compatível que o Groq usa) — sem o enum
// SchemaType do SDK do Gemini.

// Descrições enxutas de propósito — esse schema inteiro é reenviado em
// TODA requisição ao Groq, use a ferramenta ou não. Detalhe de negócio
// (quando usar qual) mora no SYSTEM_INSTRUCTION, não repetido aqui.
const tools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_tickets',
      description: 'Busca chamados por palavra-chave, empresa, status ou número.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Palavra-chave no título/descrição' },
          companyName: { type: 'string' },
          status: { type: 'string', description: 'Ex: "Novo", "Em Atendimento", "Fechado"' },
          ticketNumber: { type: ['number', 'string'] },
          limit: { type: ['number', 'string'] }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_ticket_details',
      description: 'Busca um chamado específico (por número ou id) com as últimas mensagens.',
      parameters: {
        type: 'object',
        properties: {
          ticketNumber: { type: ['number', 'string'] },
          ticketId: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_internal_tickets',
      description: 'Busca tickets internos (dev/infra/QA/produto) por palavra-chave, equipe ou status.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          teamName: { type: 'string' },
          status: { type: 'string' },
          limit: { type: ['number', 'string'] }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_internal_ticket_details',
      description: 'Busca um ticket interno específico (por número ou id) com as últimas anotações.',
      parameters: {
        type: 'object',
        properties: {
          internalTicketNumber: { type: ['number', 'string'] },
          internalTicketId: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_client_chats',
      description: 'Busca mensagens de chat com clientes (WhatsApp/widget) por palavra-chave, cliente ou empresa.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          customerName: { type: 'string' },
          companyName: { type: 'string' },
          limit: { type: ['number', 'string'] }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_internal_chats',
      description: 'Busca mensagens em chats internos da equipe por palavra-chave.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: ['number', 'string'] }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'semantic_search',
      description: 'Busca por SIGNIFICADO (não palavra exata) em todo o histórico indexado — todas as fontes juntas. Use em pergunta ampla/vaga ou quando busca por palavra-chave não achou nada.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Pergunta/tema em linguagem natural' },
          sourceTypes: {
            type: 'array',
            items: { type: 'string', enum: ['ticket_message', 'internal_ticket_message', 'chat_message', 'internal_chat_message'] },
            description: 'Opcional — restringe a fontes específicas'
          },
          limit: { type: ['number', 'string'] }
        },
        required: ['query']
      }
    }
  }
];

// --- Tool executors ---------------------------------------------------------
// Todas as buscas são parametrizadas ($1, $2...) — nunca interpolam o termo
// de busca direto na query. `limit` é sempre clampLimit()'ado antes de
// entrar na SQL (é número, não string vinda do usuário — seguro interpolar).

async function searchTickets(args: any) {
  const limit = clampLimit(args?.limit);
  const conditions: string[] = [];
  const params: any[] = [];
  let i = 1;
  if (args?.query) { conditions.push(`(t.title ILIKE $${i} OR t.description ILIKE $${i})`); params.push(`%${args.query}%`); i++; }
  if (args?.companyName) { conditions.push(`c.name ILIKE $${i}`); params.push(`%${args.companyName}%`); i++; }
  if (args?.status) { conditions.push(`t.status = $${i}`); params.push(args.status); i++; }
  const ticketNumber = toNumberOrUndefined(args?.ticketNumber);
  if (ticketNumber !== undefined) { conditions.push(`t.public_ticket_number = $${i}`); params.push(ticketNumber); i++; }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const res = await query(
    `SELECT t.public_ticket_number, t.title, t.status, t.priority, t.created_at,
            c.name AS company_name, p.name AS assignee_name
     FROM public.tickets t
     LEFT JOIN public.companies c ON c.id = t.company_id
     LEFT JOIN public.profiles p ON p.id = t.assignee_id
     ${where}
     ORDER BY t.created_at DESC
     LIMIT ${limit}`,
    params
  );
  return res.rows.map((r: any) => ({
    ticketNumber: r.public_ticket_number,
    title: r.title,
    status: r.status,
    priority: r.priority,
    company: r.company_name,
    assignee: r.assignee_name,
    createdAt: r.created_at
  }));
}

async function getTicketDetails(args: any) {
  let ticket: any;
  const ticketNumber = toNumberOrUndefined(args?.ticketNumber);
  if (ticketNumber !== undefined) {
    const res = await query(
      `SELECT t.*, c.name AS company_name, p.name AS assignee_name
       FROM public.tickets t
       LEFT JOIN public.companies c ON c.id = t.company_id
       LEFT JOIN public.profiles p ON p.id = t.assignee_id
       WHERE t.public_ticket_number = $1`,
      [ticketNumber]
    );
    ticket = res.rows[0];
  } else if (args?.ticketId) {
    const res = await query(
      `SELECT t.*, c.name AS company_name, p.name AS assignee_name
       FROM public.tickets t
       LEFT JOIN public.companies c ON c.id = t.company_id
       LEFT JOIN public.profiles p ON p.id = t.assignee_id
       WHERE t.id = $1`,
      [args.ticketId]
    );
    ticket = res.rows[0];
  }
  if (!ticket) return { error: 'Chamado não encontrado.' };

  const msgs = await query(
    `SELECT content, type, is_visible_to_customer, created_at
     FROM public.ticket_messages WHERE ticket_id = $1 ORDER BY created_at DESC LIMIT 8`,
    [ticket.id]
  );
  return {
    ticketNumber: ticket.public_ticket_number,
    title: ticket.title,
    description: truncateText(ticket.description),
    status: ticket.status,
    priority: ticket.priority,
    company: ticket.company_name,
    assignee: ticket.assignee_name,
    createdAt: ticket.created_at,
    recentMessages: msgs.rows.map((m: any) => ({
      content: truncateText(m.content),
      visibleToCustomer: m.is_visible_to_customer,
      type: m.type,
      at: m.created_at
    }))
  };
}

async function searchInternalTickets(args: any) {
  const limit = clampLimit(args?.limit);
  const conditions: string[] = [];
  const params: any[] = [];
  let i = 1;
  if (args?.query) { conditions.push(`(it.title ILIKE $${i} OR it.description ILIKE $${i})`); params.push(`%${args.query}%`); i++; }
  if (args?.teamName) { conditions.push(`team.name ILIKE $${i}`); params.push(`%${args.teamName}%`); i++; }
  if (args?.status) { conditions.push(`it.status = $${i}`); params.push(args.status); i++; }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const res = await query(
    `SELECT it.internal_ticket_number, it.title, it.status, it.priority, it.created_at,
            team.name AS team_name, p.name AS assignee_name
     FROM public.internal_tickets it
     LEFT JOIN public.internal_teams team ON team.id = it.internal_team_id
     LEFT JOIN public.profiles p ON p.id = it.assignee_id
     ${where}
     ORDER BY it.created_at DESC
     LIMIT ${limit}`,
    params
  );
  return res.rows.map((r: any) => ({
    internalTicketNumber: r.internal_ticket_number,
    title: r.title,
    status: r.status,
    priority: r.priority,
    team: r.team_name,
    assignee: r.assignee_name,
    createdAt: r.created_at
  }));
}

async function getInternalTicketDetails(args: any) {
  let row: any;
  const internalTicketNumber = toNumberOrUndefined(args?.internalTicketNumber);
  if (internalTicketNumber !== undefined) {
    const res = await query(
      `SELECT it.*, team.name AS team_name, p.name AS assignee_name
       FROM public.internal_tickets it
       LEFT JOIN public.internal_teams team ON team.id = it.internal_team_id
       LEFT JOIN public.profiles p ON p.id = it.assignee_id
       WHERE it.internal_ticket_number = $1`,
      [internalTicketNumber]
    );
    row = res.rows[0];
  } else if (args?.internalTicketId) {
    const res = await query(
      `SELECT it.*, team.name AS team_name, p.name AS assignee_name
       FROM public.internal_tickets it
       LEFT JOIN public.internal_teams team ON team.id = it.internal_team_id
       LEFT JOIN public.profiles p ON p.id = it.assignee_id
       WHERE it.id = $1`,
      [args.internalTicketId]
    );
    row = res.rows[0];
  }
  if (!row) return { error: 'Ticket interno não encontrado.' };

  const msgs = await query(
    `SELECT content, type, created_at
     FROM public.internal_ticket_messages WHERE internal_ticket_id = $1 ORDER BY created_at DESC LIMIT 8`,
    [row.id]
  );
  return {
    internalTicketNumber: row.internal_ticket_number,
    title: row.title,
    description: truncateText(row.description),
    status: row.status,
    priority: row.priority,
    team: row.team_name,
    assignee: row.assignee_name,
    createdAt: row.created_at,
    recentMessages: msgs.rows.map((m: any) => ({ content: truncateText(m.content), type: m.type, at: m.created_at }))
  };
}

async function searchClientChats(args: any) {
  const limit = clampLimit(args?.limit);
  const conditions: string[] = [`m.type NOT IN ('system')`, `m.text IS NOT NULL`];
  const params: any[] = [];
  let i = 1;
  if (args?.query) { conditions.push(`m.text ILIKE $${i}`); params.push(`%${args.query}%`); i++; }
  if (args?.customerName) { conditions.push(`s.customer_name ILIKE $${i}`); params.push(`%${args.customerName}%`); i++; }
  if (args?.companyName) { conditions.push(`comp.name ILIKE $${i}`); params.push(`%${args.companyName}%`); i++; }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const res = await query(
    `SELECT m.text, m.created_at, s.customer_name, s.customer_phone, s.status, comp.name AS company_name
     FROM public.chat_messages m
     JOIN public.chat_sessions s ON s.id = m.session_id
     LEFT JOIN public.profiles cust ON cust.id = s.customer_id
     LEFT JOIN public.companies comp ON comp.id = cust.company_id
     ${where}
     ORDER BY m.created_at DESC
     LIMIT ${limit}`,
    params
  );
  return res.rows.map((r: any) => ({
    customer: r.customer_name,
    phone: r.customer_phone,
    company: r.company_name,
    sessionStatus: r.status,
    message: truncateText(r.text),
    at: r.created_at
  }));
}

async function searchInternalChats(args: any) {
  const limit = clampLimit(args?.limit);
  const conditions: string[] = [`m.type NOT IN ('system')`, `m.text IS NOT NULL`];
  const params: any[] = [];
  let i = 1;
  if (args?.query) { conditions.push(`m.text ILIKE $${i}`); params.push(`%${args.query}%`); i++; }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const res = await query(
    `SELECT m.text, m.sender_name, m.created_at, c.name AS chat_name, c.type AS chat_type
     FROM public.internal_chat_messages m
     JOIN public.internal_chats c ON c.id = m.chat_id
     ${where}
     ORDER BY m.created_at DESC
     LIMIT ${limit}`,
    params
  );
  return res.rows.map((r: any) => ({
    chat: r.chat_name || (r.chat_type === 'direct' ? 'Conversa direta' : 'Grupo'),
    sender: r.sender_name,
    message: truncateText(r.text),
    at: r.created_at
  }));
}

const SOURCE_TYPE_LABEL: Record<string, string> = {
  ticket_message: 'chamado',
  internal_ticket_message: 'ticket interno',
  chat_message: 'chat com cliente',
  internal_chat_message: 'chat interno'
};

async function runSemanticSearch(args: any) {
  if (!isEmbeddingEnabled()) {
    return { error: 'Busca semântica está desligada neste ambiente (ENABLE_AI_EMBEDDINGS não ativado) — use as ferramentas de busca por palavra-chave em vez disso.' };
  }
  if (!args?.query) return { error: 'Parâmetro "query" é obrigatório.' };

  // O modelo às vezes ignora o enum do schema e manda rótulo em português
  // ("chamados", "tickets internos") em vez do valor real ('ticket_message'
  // etc.) — Groq não rejeita isso (só valida `type`, não `enum`, na
  // prática). Um sourceTypes inválido filtraria a busca pra um valor que
  // não existe no banco e voltaria vazia, do jeito errado de falhar
  // silenciosamente. Filtra pros valores válidos; se nenhum sobrar, busca
  // em tudo (mesmo comportamento de não informar o filtro).
  const requestedSourceTypes = Array.isArray(args?.sourceTypes)
    ? args.sourceTypes.filter((t: unknown) => typeof t === 'string' && t in SOURCE_TYPE_LABEL)
    : [];

  const results = await semanticSearch(args.query, {
    sourceTypes: requestedSourceTypes.length > 0 ? requestedSourceTypes : undefined,
    limit: toNumberOrUndefined(args?.limit)
  });
  return results.map(r => ({
    source: SOURCE_TYPE_LABEL[r.sourceType] || r.sourceType,
    parentId: r.parentId,
    content: r.content,
    relevance: r.relevance,
    at: r.at
  }));
}

async function executeTool(name: string, args: any): Promise<any> {
  try {
    switch (name) {
      case 'search_tickets': return await searchTickets(args);
      case 'get_ticket_details': return await getTicketDetails(args);
      case 'search_internal_tickets': return await searchInternalTickets(args);
      case 'get_internal_ticket_details': return await getInternalTicketDetails(args);
      case 'search_client_chats': return await searchClientChats(args);
      case 'search_internal_chats': return await searchInternalChats(args);
      case 'semantic_search': return await runSemanticSearch(args);
      default: return { error: `Ferramenta desconhecida: ${name}` };
    }
  } catch (err: any) {
    console.error(`[ai-assistant] Erro executando ferramenta "${name}":`, err);
    return { error: 'Falha ao buscar essa informação agora.' };
  }
}

// --- Orquestração ------------------------------------------------------------

export interface AssistantChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface AssistantToolCall {
  name: string;
  args: any;
}

export interface AssistantResult {
  text: string;
  toolCalls: AssistantToolCall[];
}

// Bug conhecido de modelos Llama via Groq com tool-calling: às vezes o
// modelo escreve a chamada de função como texto solto (ex:
// "<function=search_tickets{...}</function>") em vez de usar o campo
// estruturado — a API rejeita com 400 "tool_use_failed" nesse caso. Quase
// sempre é não-determinístico: repetir a MESMA requisição já sai certo na
// tentativa seguinte. parallel_tool_calls: false reduz a chance de
// acontecer (o modelo tenta empacotar menos chamada por vez).
// Medido empiricamente: ~10% de chance de falha por tentativa nesse modelo
// (llama-3.3-70b-versatile) — não é específico de nenhuma pergunta, é
// aleatório. 3 tentativas deixava uma cauda de risco pequena mas real;
// subiu pra 4 porque o custo de mais uma chamada no Groq é irrelevante.
const MAX_TOOL_CALL_RETRIES = 3;

function isToolUseFailedError(err: any): boolean {
  const code = err?.error?.error?.code ?? err?.error?.code;
  if (code === 'tool_use_failed') return true;
  return typeof err?.message === 'string' && err.message.includes('tool_use_failed');
}

async function createCompletionWithRetry(client: Groq, messages: ChatCompletionMessageParam[]) {
  let lastError: any;
  for (let attempt = 0; attempt <= MAX_TOOL_CALL_RETRIES; attempt++) {
    try {
      return await client.chat.completions.create({
        model: MODEL_NAME,
        messages,
        tools,
        tool_choice: 'auto',
        parallel_tool_calls: false
      });
    } catch (err: any) {
      if (!isToolUseFailedError(err)) throw err;
      lastError = err;
      console.warn(`[ai-assistant] tool_use_failed — tentativa ${attempt + 1}/${MAX_TOOL_CALL_RETRIES + 1}`);
    }
  }
  throw lastError;
}

const SYSTEM_INSTRUCTION = `Você é o assistente interno do SSX Desk (plataforma de atendimento/suporte). Responda SEMPRE em português do Brasil, direto e objetivo — resposta de analista, não redação.
4 fontes de busca: chamados, tickets internos (dev/infra/QA/produto), chat com cliente, chat interno da equipe. Use ferramenta sempre que depender de dado real — NUNCA invente número de chamado, nome, status ou conteúdo de mensagem.

Não desista cedo: "como fazer X"/"onde configuro Y" costuma estar registrado num CHAMADO, não num chat solto. Antes de dizer "não encontrei", tente pelo menos: (1) search_tickets com a palavra-chave literal; (2) se vazio, semantic_search reescrevendo a busca por extenso (ex: "hashauth" → "como gerar hashauth da integração" — termo isolado tem sinal semântico fraco). Não pare na primeira ferramenta vazia.
Pergunta específica (empresa, nº chamado, status exato) → ferramentas por palavra-chave. Pergunta ampla/vaga → semantic_search. Se semantic_search disser que está desligada, avise o usuário em vez de fingir que não achou nada.
Cite o número do chamado/ticket interno quando responder com base nele (ex: "chamado #1234").`;

export async function askAssistant(params: {
  userId: string;
  conversationId: string;
  message: string;
  history: AssistantChatMessage[];
}): Promise<AssistantResult> {
  const client = getClient();

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_INSTRUCTION },
    ...params.history.map((m): ChatCompletionMessageParam => ({
      role: m.role === 'model' ? 'assistant' : 'user',
      content: m.text
    })),
    { role: 'user', content: params.message }
  ];

  const allToolCalls: AssistantToolCall[] = [];
  let text = '';

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    let completion;
    try {
      completion = await createCompletionWithRetry(client, messages);
    } catch (err: any) {
      if (!isToolUseFailedError(err)) throw err;
      // Esgotou as tentativas de retry e o modelo continua não formatando a
      // chamada de função direito — degrada pra uma resposta em texto em
      // vez de estourar um 400 cru até o analista.
      console.error('[ai-assistant] tool_use_failed persistente após retries:', err?.message || err);
      text = 'Não consegui usar a busca dessa vez — tenta reformular a pergunta de um jeito mais direto (ex: "busque chamados sobre X").';
      break;
    }
    const choice = completion.choices[0]?.message;
    const toolCalls = choice?.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      text = choice?.content || '';
      break;
    }

    // Round final sem sobrar texto: aceita não ter uma resposta em texto
    // depois de esgotar as rodadas — melhor que ficar pedindo função pra
    // sempre.
    if (round === MAX_TOOL_ROUNDS) {
      text = choice?.content || 'Não consegui concluir a busca a tempo — tenta reformular a pergunta.';
      break;
    }

    messages.push({ role: 'assistant', content: choice?.content ?? null, tool_calls: toolCalls });

    for (const call of toolCalls) {
      let args: any = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* args inválidos do modelo — segue com {} */ }
      allToolCalls.push({ name: call.function.name, args });
      const result = await executeTool(call.function.name, args);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  // Log best-effort — nunca deve derrubar a resposta ao usuário (mesmo
  // padrão de lib/audit-log.ts).
  void logAssistantTurn({ userId: params.userId, conversationId: params.conversationId, role: 'user', content: params.message, toolCalls: null });
  void logAssistantTurn({ userId: params.userId, conversationId: params.conversationId, role: 'model', content: text, toolCalls: allToolCalls.length ? allToolCalls : null });

  return { text, toolCalls: allToolCalls };
}

async function logAssistantTurn(entry: {
  userId: string;
  conversationId: string;
  role: 'user' | 'model';
  content: string;
  toolCalls: AssistantToolCall[] | null;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO public.ai_assistant_messages (user_id, conversation_id, role, content, tool_calls)
       VALUES ($1, $2, $3, $4, $5)`,
      [entry.userId, entry.conversationId, entry.role, entry.content, entry.toolCalls ? JSON.stringify(entry.toolCalls) : null]
    );
  } catch (err) {
    console.error('[ai-assistant] Falha ao gravar log de conversa:', err);
  }
}
