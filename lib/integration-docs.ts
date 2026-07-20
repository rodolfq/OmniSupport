import { RATE_LIMIT_MAX_REQUESTS, type IntegrationScope } from '@/lib/integration-constants';

// Catálogo único dos endpoints da API de integração — fonte de verdade tanto
// para o guia exibido em Configurações > Integrações quanto para os campos
// gerados automaticamente no testador interativo. Manter em sincronia com as
// rotas reais em app/api/integrations/v1/*.

export interface EndpointParam {
  name: string;
  in: 'query' | 'body';
  type: string;
  required?: boolean;
  description: string;
  placeholder?: string;
}

export interface EndpointErrorDoc {
  status: number;
  code: string;
  description: string;
}

export interface EndpointDoc {
  id: string;
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  summary: string;
  description: string;
  scope: IntegrationScope | null; // null = qualquer chave ativa, sem escopo específico
  params: EndpointParam[];
  exampleResponse: string;
  errors: EndpointErrorDoc[];
}

const AUTH_ERRORS: EndpointErrorDoc[] = [
  { status: 401, code: 'UNAUTHORIZED', description: 'Chave ausente, inválida ou revogada.' },
  { status: 429, code: 'RATE_LIMITED', description: `Mais de ${RATE_LIMIT_MAX_REQUESTS} requisições/minuto para essa chave.` },
];

function scopeError(scope: IntegrationScope): EndpointErrorDoc {
  return { status: 403, code: 'FORBIDDEN_SCOPE', description: `Chave sem o escopo "${scope}".` };
}

export const INTEGRATION_ENDPOINTS: EndpointDoc[] = [
  {
    id: 'ping',
    method: 'GET',
    path: '/api/integrations/v1/ping',
    summary: 'Testar credenciais',
    description: 'Confirma que a chave é válida e devolve seu nome e escopos. Use este endpoint primeiro para validar a configuração antes de integrar de verdade — não lê nenhum dado de negócio.',
    scope: null,
    params: [],
    exampleResponse: JSON.stringify(
      { data: { ok: true, keyName: 'CRM Comercial', scopes: ['employees:read', 'tickets:read'] } },
      null,
      2
    ),
    errors: AUTH_ERRORS,
  },
  {
    id: 'employees-list',
    method: 'GET',
    path: '/api/integrations/v1/employees',
    summary: 'Listar ou consultar funcionários',
    description: 'Sem parâmetros, retorna uma página de funcionários (papéis Funcionário/Cliente). Informando "id", ignora os demais filtros e retorna um único registro.',
    scope: 'employees:read',
    params: [
      { name: 'id', in: 'query', type: 'uuid', description: 'Retorna só esse funcionário.' },
      { name: 'companyId', in: 'query', type: 'uuid', description: 'Filtra por empresa (ver GET /companies).' },
      { name: 'email', in: 'query', type: 'string', description: 'Filtra por e-mail exato.' },
      { name: 'limit', in: 'query', type: 'number', description: 'Itens por página. Padrão 100, máximo 500.', placeholder: '100' },
      { name: 'offset', in: 'query', type: 'number', description: 'Deslocamento para paginação. Padrão 0.', placeholder: '0' },
    ],
    exampleResponse: JSON.stringify(
      {
        data: [
          { id: 'b7e1...', name: 'Jean Silva', email: 'jean@empresa.com', role: 'Funcionário', companyId: '56f9...', phone: '11999990000', createdAt: '2026-07-20T12:00:00.000Z' },
        ],
        meta: { limit: 100, offset: 0, total: 1, hasMore: false },
      },
      null,
      2
    ),
    errors: [...AUTH_ERRORS, scopeError('employees:read'), { status: 404, code: 'NOT_FOUND', description: 'Nenhum funcionário com o id informado.' }],
  },
  {
    id: 'employees-create',
    method: 'POST',
    path: '/api/integrations/v1/employees',
    summary: 'Cadastrar funcionário',
    description: 'Cria um novo registro (papel Funcionário ou Cliente). O registro não recebe senha nem acesso de login ao portal — é só sincronismo de dados.',
    scope: 'employees:write',
    params: [
      { name: 'name', in: 'body', type: 'string', required: true, description: 'Nome completo.', placeholder: 'Jean Silva' },
      { name: 'email', in: 'body', type: 'string', required: true, description: 'E-mail único no sistema.', placeholder: 'jean@empresa.com' },
      { name: 'phone', in: 'body', type: 'string', description: 'Telefone com DDI/DDD.', placeholder: '11999990000' },
      { name: 'companyId', in: 'body', type: 'uuid', description: 'Empresa vinculada (ver GET /companies).' },
      { name: 'role', in: 'body', type: '"Funcionário" | "Cliente"', description: 'Papel do registro. Padrão: Funcionário.' },
    ],
    exampleResponse: JSON.stringify(
      { data: { id: 'b7e1...', name: 'Jean Silva', email: 'jean@empresa.com', role: 'Funcionário', companyId: '56f9...', phone: '11999990000', createdAt: '2026-07-20T12:00:00.000Z' } },
      null,
      2
    ),
    errors: [
      ...AUTH_ERRORS,
      scopeError('employees:write'),
      { status: 400, code: 'VALIDATION_ERROR', description: 'Campo obrigatório ausente, e-mail inválido, role fora da whitelist ou companyId inexistente.' },
      { status: 409, code: 'CONFLICT', description: 'Já existe um funcionário com esse e-mail.' },
    ],
  },
  {
    id: 'employees-update',
    method: 'PUT',
    path: '/api/integrations/v1/employees',
    summary: 'Atualizar funcionário',
    description: 'Atualização parcial: envie só os campos que deseja alterar. O "id" vai na query string; os demais campos vão no corpo.',
    scope: 'employees:write',
    params: [
      { name: 'id', in: 'query', type: 'uuid', required: true, description: 'Id do funcionário a atualizar.' },
      { name: 'name', in: 'body', type: 'string', description: 'Novo nome.' },
      { name: 'phone', in: 'body', type: 'string', description: 'Novo telefone.' },
      { name: 'companyId', in: 'body', type: 'uuid', description: 'Nova empresa vinculada.' },
      { name: 'role', in: 'body', type: '"Funcionário" | "Cliente"', description: 'Novo papel (nunca Administrador/Equipe/Time Interno).' },
    ],
    exampleResponse: JSON.stringify(
      { data: { id: 'b7e1...', name: 'Jean Silva', email: 'jean@empresa.com', role: 'Funcionário', companyId: '56f9...', phone: '11888887777', createdAt: '2026-07-20T12:00:00.000Z' } },
      null,
      2
    ),
    errors: [
      ...AUTH_ERRORS,
      scopeError('employees:write'),
      { status: 400, code: 'VALIDATION_ERROR', description: 'id ausente, role fora da whitelist ou companyId inexistente.' },
      { status: 404, code: 'NOT_FOUND', description: 'Funcionário não encontrado.' },
    ],
  },
  {
    id: 'companies-list',
    method: 'GET',
    path: '/api/integrations/v1/companies',
    summary: 'Listar ou consultar empresas',
    description: 'Use para resolver o companyId antes de cadastrar/atualizar um funcionário. Sem "id" retorna todas; com "id" retorna uma só.',
    scope: 'employees:read',
    params: [{ name: 'id', in: 'query', type: 'uuid', description: 'Retorna só essa empresa.' }],
    exampleResponse: JSON.stringify(
      { data: [{ id: '56f9...', name: 'Empresa Matriz Ltda', industry: 'Tecnologia', phone: '1140040000' }], meta: { total: 1 } },
      null,
      2
    ),
    errors: [...AUTH_ERRORS, scopeError('employees:read'), { status: 404, code: 'NOT_FOUND', description: 'Empresa não encontrada.' }],
  },
  {
    id: 'tickets-list',
    method: 'GET',
    path: '/api/integrations/v1/tickets',
    summary: 'Listar ou consultar chamados',
    description: 'Sem "id" retorna uma página de chamados. Com "id" retorna o chamado com as mensagens visíveis ao cliente — mensagens internas entre atendentes não são expostas por esta API.',
    scope: 'tickets:read',
    params: [
      { name: 'id', in: 'query', type: 'string', description: 'Retorna esse chamado + mensagens.' },
      { name: 'companyId', in: 'query', type: 'uuid', description: 'Filtra por empresa.' },
      { name: 'status', in: 'query', type: 'string', description: 'Ex.: "Novo", "Em Atendimento", "Aguardando Cliente", "Fechado".', placeholder: 'Novo' },
      { name: 'limit', in: 'query', type: 'number', description: 'Itens por página. Padrão 100, máximo 500.', placeholder: '100' },
      { name: 'offset', in: 'query', type: 'number', description: 'Deslocamento para paginação. Padrão 0.', placeholder: '0' },
    ],
    exampleResponse: JSON.stringify(
      {
        data: [
          { id: '294803172edd...', ticketNumber: 23, title: 'Impressora não liga', status: 'Novo', priority: 'Média', category: 'Hardware', companyId: '56f9...', customerId: null, assigneeId: null, employeeIds: [], createdAt: '2026-07-20T12:00:00.000Z', updatedAt: '2026-07-20T12:00:00.000Z' },
        ],
        meta: { limit: 100, offset: 0, total: 1, hasMore: false },
      },
      null,
      2
    ),
    errors: [...AUTH_ERRORS, scopeError('tickets:read'), { status: 404, code: 'NOT_FOUND', description: 'Chamado não encontrado.' }],
  },
  {
    id: 'conversations-list',
    method: 'GET',
    path: '/api/integrations/v1/conversations',
    summary: 'Listar ou consultar conversas',
    description: 'Sem "id" retorna uma página de conversas (chat/WhatsApp). Com "id" retorna a conversa com todas as mensagens.',
    scope: 'conversations:read',
    params: [
      { name: 'id', in: 'query', type: 'uuid', description: 'Retorna essa conversa + mensagens.' },
      { name: 'companyId', in: 'query', type: 'uuid', description: 'Filtra pela empresa do cliente.' },
      { name: 'customerId', in: 'query', type: 'uuid', description: 'Filtra por cliente.' },
      { name: 'status', in: 'query', type: 'string', description: 'Ex.: "waiting", "active", "closed".', placeholder: 'active' },
      { name: 'limit', in: 'query', type: 'number', description: 'Itens por página. Padrão 100, máximo 500.', placeholder: '100' },
      { name: 'offset', in: 'query', type: 'number', description: 'Deslocamento para paginação. Padrão 0.', placeholder: '0' },
    ],
    exampleResponse: JSON.stringify(
      {
        data: [
          { id: '7188...', type: 'support', customerId: '48bf...', customerName: 'Jean', customerPhone: '11999990000', assigneeId: 'a881...', status: 'active', ticketId: null, ticketNumber: null, createdAt: '2026-07-20T12:00:00.000Z', updatedAt: '2026-07-20T12:00:00.000Z', lastMessageAt: null },
        ],
        meta: { limit: 100, offset: 0, total: 1, hasMore: false },
      },
      null,
      2
    ),
    errors: [...AUTH_ERRORS, scopeError('conversations:read'), { status: 404, code: 'NOT_FOUND', description: 'Conversa não encontrada.' }],
  },
];
