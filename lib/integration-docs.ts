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

// Exemplo pronto de consulta (só parâmetros de query) — vira um curl completo
// e um atalho "usar este exemplo" no testador, pra quem só quer copiar e
// colar num Postman/Insomnia sem descobrir sozinho quais parâmetros combinar.
export interface EndpointExample {
  label: string;
  description: string;
  query: Record<string, string>;
}

export interface EndpointDoc {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  summary: string;
  description: string;
  scope: IntegrationScope | null; // null = qualquer chave ativa, sem escopo específico
  params: EndpointParam[];
  examples?: EndpointExample[];
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
    description: 'Sem parâmetros, retorna uma página de funcionários ATIVOS (papéis Funcionário/Cliente). Informando "id", ignora os demais filtros e retorna um único registro (ativo ou não). Quem foi desativado (ver DELETE) só aparece pedindo includeInactive=1.',
    scope: 'employees:read',
    params: [
      { name: 'id', in: 'query', type: 'uuid', description: 'Retorna só esse funcionário.' },
      { name: 'companyId', in: 'query', type: 'uuid', description: 'Filtra por empresa (ver GET /companies).' },
      { name: 'email', in: 'query', type: 'string', description: 'Filtra por e-mail exato.' },
      { name: 'includeInactive', in: 'query', type: '"1"', description: 'Inclui quem foi desativado na listagem. Padrão: só ativos.' },
      { name: 'limit', in: 'query', type: 'number', description: 'Itens por página. Padrão 100, máximo 500.', placeholder: '100' },
      { name: 'offset', in: 'query', type: 'number', description: 'Deslocamento para paginação. Padrão 0.', placeholder: '0' },
    ],
    exampleResponse: JSON.stringify(
      {
        data: [
          { id: 'b7e1...', name: 'Jean Silva', email: 'jean@empresa.com', role: 'Funcionário', companyId: '56f9...', phone: '11999990000', isActive: true, createdAt: '2026-07-20T12:00:00.000Z' },
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
    description: 'Atualização parcial: envie só os campos que deseja alterar. O "id" vai na query string; os demais campos vão no corpo. Também serve para REATIVAR alguém desativado — envie isActive: true.',
    scope: 'employees:write',
    params: [
      { name: 'id', in: 'query', type: 'uuid', required: true, description: 'Id do funcionário a atualizar.' },
      { name: 'name', in: 'body', type: 'string', description: 'Novo nome.' },
      { name: 'phone', in: 'body', type: 'string', description: 'Novo telefone.' },
      { name: 'companyId', in: 'body', type: 'uuid', description: 'Nova empresa vinculada.' },
      { name: 'role', in: 'body', type: '"Funcionário" | "Cliente"', description: 'Novo papel (nunca Administrador/Equipe/Time Interno).' },
      { name: 'isActive', in: 'body', type: 'boolean', description: 'true reativa um funcionário desativado (ver DELETE).' },
    ],
    exampleResponse: JSON.stringify(
      { data: { id: 'b7e1...', name: 'Jean Silva', email: 'jean@empresa.com', role: 'Funcionário', companyId: '56f9...', phone: '11888887777', isActive: true, createdAt: '2026-07-20T12:00:00.000Z' } },
      null,
      2
    ),
    errors: [
      ...AUTH_ERRORS,
      scopeError('employees:write'),
      { status: 400, code: 'VALIDATION_ERROR', description: 'id ausente, role fora da whitelist, isActive não-boolean ou companyId inexistente.' },
      { status: 404, code: 'NOT_FOUND', description: 'Funcionário não encontrado.' },
    ],
  },
  {
    id: 'employees-delete',
    method: 'DELETE',
    path: '/api/integrations/v1/employees',
    summary: 'Desativar funcionário',
    description: 'Desativação SUAVE (is_active = false) — nunca apaga o registro de verdade, porque chamados e conversas antigas continuam apontando pra ele. Some das listagens padrão a partir de agora. Para reverter, use PUT com isActive: true.',
    scope: 'employees:write',
    params: [
      { name: 'id', in: 'query', type: 'uuid', required: true, description: 'Id do funcionário a desativar.' },
    ],
    exampleResponse: JSON.stringify({ data: { id: 'b7e1...', isActive: false } }, null, 2),
    errors: [
      ...AUTH_ERRORS,
      scopeError('employees:write'),
      { status: 400, code: 'VALIDATION_ERROR', description: 'Parâmetro id ausente.' },
      { status: 404, code: 'NOT_FOUND', description: 'Funcionário não encontrado.' },
    ],
  },
  {
    id: 'companies-list',
    method: 'GET',
    path: '/api/integrations/v1/companies',
    summary: 'Listar ou consultar empresas',
    description: 'Use para resolver o companyId antes de cadastrar/atualizar um funcionário, ou para consultar o perfil de relacionamento (isInTraining + resumo das avaliações do analista). Sem "id" retorna todas; com "id" retorna uma só. Aceita companies:read, companies:write (que já inclui leitura) ou, por compatibilidade com chaves antigas, employees:read.',
    scope: 'companies:read',
    params: [{ name: 'id', in: 'query', type: 'uuid', description: 'Retorna só essa empresa.' }],
    exampleResponse: JSON.stringify(
      {
        data: [
          {
            id: '56f9...',
            name: 'Empresa Matriz Ltda',
            industry: 'Tecnologia',
            phone: '1140040000',
            isInTraining: false,
            evaluation: {
              count: 3,
              overallAverage: 4.2,
              averages: { knowledgeScore: 4, autonomyScore: 4.5, learningScore: 4, engagementScore: 4.5, organizationScore: 3.8, communicationScore: 4.2 },
              latestTag: 'technical',
              countByOrigin: { chatClose: 2, manual: 1 },
            },
          },
        ],
        meta: { total: 1 },
      },
      null,
      2
    ),
    errors: [...AUTH_ERRORS, scopeError('companies:read'), { status: 404, code: 'NOT_FOUND', description: 'Empresa não encontrada.' }],
  },
  {
    id: 'companies-update',
    method: 'PUT',
    path: '/api/integrations/v1/companies',
    summary: 'Atualizar empresa',
    description: 'Atualização parcial: envie só os campos que deseja alterar. Inclui o indicador "cliente em treinamento" (isInTraining), visível só internamente no chat. As avaliações do analista não são editáveis por esta API — só pelo portal.',
    scope: 'companies:write',
    params: [
      { name: 'id', in: 'query', type: 'uuid', required: true, description: 'Id da empresa a atualizar.' },
      { name: 'name', in: 'body', type: 'string', description: 'Novo nome.' },
      { name: 'industry', in: 'body', type: 'string', description: 'Novo ramo/indústria.' },
      { name: 'phone', in: 'body', type: 'string', description: 'Novo telefone.' },
      { name: 'isInTraining', in: 'body', type: 'boolean', description: 'Marca a empresa como "em treinamento" — mostra um aviso pra equipe interna no chat.', placeholder: 'true' },
    ],
    exampleResponse: JSON.stringify(
      {
        data: {
          id: '56f9...',
          name: 'Empresa Matriz Ltda',
          industry: 'Tecnologia',
          phone: '1140040000',
          isInTraining: false,
          evaluation: {
            count: 3,
            overallAverage: 4.2,
            averages: { knowledgeScore: 4, autonomyScore: 4.5, learningScore: 4, engagementScore: 4.5, organizationScore: 3.8, communicationScore: 4.2 },
            latestTag: 'technical',
            countByOrigin: { chatClose: 2, manual: 1 },
          },
        },
      },
      null,
      2
    ),
    errors: [
      ...AUTH_ERRORS,
      scopeError('companies:write'),
      { status: 400, code: 'VALIDATION_ERROR', description: 'id ausente, nenhum campo informado para atualizar, ou isInTraining não é um boolean.' },
      { status: 404, code: 'NOT_FOUND', description: 'Empresa não encontrada.' },
    ],
  },
  {
    id: 'tickets-list',
    method: 'GET',
    path: '/api/integrations/v1/tickets',
    summary: 'Listar ou consultar chamados',
    description: 'Sem "id" retorna uma página de chamados de todos os clientes, filtrável por qualquer um dos parâmetros abaixo (todos combináveis entre si). Com "id" retorna o chamado com as mensagens visíveis ao cliente — mensagens internas entre atendentes não são expostas por esta API.',
    scope: 'tickets:read',
    params: [
      { name: 'id', in: 'query', type: 'string', description: 'Retorna esse chamado + mensagens (ignora os demais filtros).' },
      { name: 'companyId', in: 'query', type: 'uuid', description: 'Filtra por empresa (ver GET /companies).' },
      { name: 'customerId', in: 'query', type: 'uuid', description: 'Filtra pelo contato que abriu o chamado (ver GET /employees).' },
      { name: 'assigneeId', in: 'query', type: 'uuid', description: 'Filtra pelo analista responsável.' },
      { name: 'queueId', in: 'query', type: 'string', description: 'Filtra pela fila do chamado.' },
      { name: 'status', in: 'query', type: 'string', description: 'Ex.: "Novo", "Em Atendimento", "Aguardando Cliente", "Fechado".', placeholder: 'Novo' },
      { name: 'subStatus', in: 'query', type: 'string', description: 'Sub-status dentro do status principal, quando cadastrado.' },
      { name: 'priority', in: 'query', type: '"Baixa" | "Média" | "Alta" | "Urgente"', description: 'Prioridade exata.', placeholder: 'Urgente' },
      { name: 'category', in: 'query', type: 'string', description: 'Nome da categoria (não diferencia maiúsc./minúsc.) — use este em vez de categoryId se não souber o UUID.', placeholder: 'Hardware' },
      { name: 'categoryId', in: 'query', type: 'uuid', description: 'Id exato da categoria, se você já souber.' },
      { name: 'requestType', in: 'query', type: 'string', description: 'Nome do tipo de solicitação (não diferencia maiúsc./minúsc.).' },
      { name: 'requestTypeId', in: 'query', type: 'uuid', description: 'Id exato do tipo de solicitação.' },
      { name: 'product', in: 'query', type: 'string', description: 'Nome do produto (não diferencia maiúsc./minúsc.).' },
      { name: 'productId', in: 'query', type: 'uuid', description: 'Id exato do produto.' },
      { name: 'tags', in: 'query', type: 'string (separado por vírgula)', description: 'Chamados que tenham QUALQUER uma das tags informadas.', placeholder: 'vip,retido' },
      { name: 'search', in: 'query', type: 'string', description: 'Trecho do título (não diferencia maiúsc./minúsc.).' },
      { name: 'contentSearch', in: 'query', type: 'string', description: 'Trecho da descrição (não diferencia maiúsc./minúsc.).' },
      { name: 'createdFrom', in: 'query', type: 'ISO 8601', description: 'Só chamados criados a partir desta data/hora.', placeholder: '2026-08-01T00:00:00Z' },
      { name: 'createdTo', in: 'query', type: 'ISO 8601', description: 'Só chamados criados até esta data/hora.' },
      { name: 'updatedSince', in: 'query', type: 'ISO 8601', description: 'Só chamados alterados a partir desta data/hora — para sincronizar incrementalmente sem reler tudo a cada chamada.', placeholder: '2026-08-01T00:00:00Z' },
      { name: 'limit', in: 'query', type: 'number', description: 'Itens por página. Padrão 100, máximo 500.', placeholder: '100' },
      { name: 'offset', in: 'query', type: 'number', description: 'Deslocamento para paginação. Padrão 0.', placeholder: '0' },
    ],
    examples: [
      {
        label: 'Só chamados de uma categoria',
        description: 'Filtra pelo nome da categoria — não precisa saber o UUID.',
        query: { category: 'Hardware' },
      },
      {
        label: 'Abertos e urgentes',
        description: 'Combina status + prioridade — os filtros sempre funcionam em conjunto (E lógico).',
        query: { status: 'Novo', priority: 'Urgente' },
      },
      {
        label: 'Por responsável e fila',
        description: 'Chamados de um analista específico dentro de uma fila.',
        query: { assigneeId: '<uuid-do-analista>', queueId: '<id-da-fila>' },
      },
      {
        label: 'Por tag',
        description: 'Chamados marcados com "vip" OU "retido".',
        query: { tags: 'vip,retido' },
      },
      {
        label: 'Sincronização incremental',
        description: 'Só o que mudou desde a última vez que você sincronizou — ideal para rodar periodicamente.',
        query: { updatedSince: '2026-08-01T00:00:00Z' },
      },
    ],
    exampleResponse: JSON.stringify(
      {
        data: [
          { id: '294803172edd...', ticketNumber: 23, title: 'Impressora não liga', description: 'Não liga mesmo trocando a tomada.', status: 'Novo', subStatus: null, priority: 'Média', category: 'Hardware', categoryId: 'a1b2...', requestTypeId: null, productId: null, tags: ['hardware'], queueId: 'suporte-n1', companyId: '56f9...', customerId: null, assigneeId: null, employeeIds: [], createdAt: '2026-07-20T12:00:00.000Z', updatedAt: '2026-07-20T12:00:00.000Z' },
        ],
        meta: { limit: 100, offset: 0, total: 1, hasMore: false },
      },
      null,
      2
    ),
    errors: [...AUTH_ERRORS, scopeError('tickets:read'), { status: 400, code: 'VALIDATION_ERROR', description: 'updatedSince/createdFrom/createdTo não é uma data ISO 8601 válida.' }, { status: 404, code: 'NOT_FOUND', description: 'Chamado não encontrado.' }],
  },
  {
    id: 'tickets-create',
    method: 'POST',
    path: '/api/integrations/v1/tickets',
    summary: 'Abrir chamado',
    description: 'Cria um chamado novo, com status "Novo", em nome de uma empresa (e opcionalmente de um contato específico). Dispara a mesma automação de "novo chamado" configurada em Configurações — a equipe é notificada igual a um chamado aberto pelo portal.',
    scope: 'tickets:write',
    params: [
      { name: 'title', in: 'body', type: 'string', required: true, description: 'Título do chamado.', placeholder: 'Impressora não liga' },
      { name: 'description', in: 'body', type: 'string', required: true, description: 'Descrição do problema.', placeholder: 'Não liga mesmo trocando a tomada.' },
      { name: 'companyId', in: 'body', type: 'uuid', required: true, description: 'Empresa dona do chamado (ver GET /companies).' },
      { name: 'customerId', in: 'body', type: 'uuid', description: 'Contato específico que abriu o chamado (ver GET /employees).' },
      { name: 'priority', in: 'body', type: '"Baixa" | "Média" | "Alta" | "Urgente"', description: 'Padrão: Baixa.' },
      { name: 'categoryId', in: 'body', type: 'uuid', description: 'Categoria (lista configurável em Configurações).' },
      { name: 'requestTypeId', in: 'body', type: 'uuid', description: 'Tipo de solicitação (lista configurável).' },
      { name: 'productId', in: 'body', type: 'uuid', description: 'Produto (lista configurável).' },
      { name: 'tags', in: 'body', type: 'string[]', description: 'Marcadores livres.' },
    ],
    exampleResponse: JSON.stringify(
      { data: { id: '294803172edd...', ticketNumber: 24, title: 'Impressora não liga', description: 'Não liga mesmo trocando a tomada.', status: 'Novo', subStatus: null, priority: 'Baixa', category: 'Geral', categoryId: null, requestTypeId: null, productId: null, tags: [], companyId: '56f9...', customerId: null, assigneeId: null, employeeIds: [], createdAt: '2026-08-17T12:00:00.000Z', updatedAt: '2026-08-17T12:00:00.000Z' } },
      null,
      2
    ),
    errors: [
      ...AUTH_ERRORS,
      scopeError('tickets:write'),
      { status: 400, code: 'VALIDATION_ERROR', description: 'Campo obrigatório ausente, priority fora da lista, ou companyId/customerId/categoryId/requestTypeId/productId inexistente.' },
    ],
  },
  {
    id: 'tickets-update',
    method: 'PATCH',
    path: '/api/integrations/v1/tickets',
    summary: 'Atualizar chamado',
    description: 'Atualização parcial: envie só os campos que deseja alterar. O "id" vai na query string. Dispara a mesma automação do portal (troca de status, prioridade, responsável) — inclusive e-mail/WhatsApp configurados para o status novo.',
    scope: 'tickets:write',
    params: [
      { name: 'id', in: 'query', type: 'string', required: true, description: 'Id do chamado a atualizar.' },
      { name: 'status', in: 'body', type: 'string', description: 'Precisa ser um status cadastrado em Configurações.', placeholder: 'Em Atendimento' },
      { name: 'priority', in: 'body', type: '"Baixa" | "Média" | "Alta" | "Urgente"', description: 'Nova prioridade.' },
      { name: 'categoryId', in: 'body', type: 'uuid', description: 'Nova categoria.' },
      { name: 'requestTypeId', in: 'body', type: 'uuid', description: 'Novo tipo de solicitação.' },
      { name: 'productId', in: 'body', type: 'uuid', description: 'Novo produto.' },
      { name: 'tags', in: 'body', type: 'string[]', description: 'Substitui os marcadores.' },
      { name: 'assigneeId', in: 'body', type: 'uuid', description: 'Novo responsável (precisa ser alguém da equipe).' },
    ],
    exampleResponse: JSON.stringify(
      { data: { id: '294803172edd...', ticketNumber: 23, title: 'Impressora não liga', description: 'Não liga mesmo trocando a tomada.', status: 'Em Atendimento', subStatus: null, priority: 'Média', category: 'Hardware', categoryId: 'a1b2...', requestTypeId: null, productId: null, tags: ['hardware'], companyId: '56f9...', customerId: null, assigneeId: 'c3d4...', employeeIds: [], createdAt: '2026-07-20T12:00:00.000Z', updatedAt: '2026-08-17T12:05:00.000Z' } },
      null,
      2
    ),
    errors: [
      ...AUTH_ERRORS,
      scopeError('tickets:write'),
      { status: 400, code: 'VALIDATION_ERROR', description: 'id ausente, nenhum campo informado, status não cadastrado, priority fora da lista, ou categoryId/requestTypeId/productId/assigneeId inexistente.' },
      { status: 404, code: 'NOT_FOUND', description: 'Chamado não encontrado.' },
    ],
  },
  {
    id: 'conversations-list',
    method: 'GET',
    path: '/api/integrations/v1/conversations',
    summary: 'Listar ou consultar conversas',
    description: 'Sem "id" retorna uma página de conversas (chat/WhatsApp) de todos os clientes, filtrável por qualquer um dos parâmetros abaixo (todos combináveis entre si). Com "id" retorna a conversa com todas as mensagens visíveis ao cliente — anotações internas entre atendentes não são expostas por esta API.',
    scope: 'conversations:read',
    params: [
      { name: 'id', in: 'query', type: 'uuid', description: 'Retorna essa conversa + mensagens (ignora os demais filtros).' },
      { name: 'companyId', in: 'query', type: 'uuid', description: 'Filtra pela empresa do cliente.' },
      { name: 'customerId', in: 'query', type: 'uuid', description: 'Filtra por cliente.' },
      { name: 'customerPhone', in: 'query', type: 'string', description: 'Filtra por telefone (aceita com ou sem DDI/pontuação — compara só os dígitos).', placeholder: '11999990000' },
      { name: 'assigneeId', in: 'query', type: 'uuid', description: 'Filtra pelo analista responsável pela conversa.' },
      { name: 'queueId', in: 'query', type: 'string', description: 'Filtra pela fila da conversa.' },
      { name: 'ticketId', in: 'query', type: 'string', description: 'Conversa vinculada a este chamado.' },
      { name: 'tags', in: 'query', type: 'string (separado por vírgula)', description: 'Conversas que tenham QUALQUER uma das tags informadas.', placeholder: 'vip' },
      { name: 'status', in: 'query', type: 'string', description: 'Ex.: "waiting", "active", "closed".', placeholder: 'active' },
      { name: 'updatedSince', in: 'query', type: 'ISO 8601', description: 'Só conversas alteradas a partir desta data/hora — para sincronização incremental.', placeholder: '2026-08-01T00:00:00Z' },
      { name: 'limit', in: 'query', type: 'number', description: 'Itens por página. Padrão 100, máximo 500.', placeholder: '100' },
      { name: 'offset', in: 'query', type: 'number', description: 'Deslocamento para paginação. Padrão 0.', placeholder: '0' },
    ],
    examples: [
      {
        label: 'Conversas ativas de um analista',
        description: 'Combina responsável + status — os filtros sempre funcionam em conjunto (E lógico).',
        query: { assigneeId: '<uuid-do-analista>', status: 'active' },
      },
      {
        label: 'Por telefone do cliente',
        description: 'Não precisa formatar — só os dígitos são comparados.',
        query: { customerPhone: '11999990000' },
      },
      {
        label: 'Por tag',
        description: 'Conversas marcadas com "vip".',
        query: { tags: 'vip' },
      },
      {
        label: 'Conversa de um chamado específico',
        description: 'Encontra a conversa que deu origem a um chamado já conhecido.',
        query: { ticketId: '<id-do-chamado>' },
      },
      {
        label: 'Sincronização incremental',
        description: 'Só o que mudou desde a última vez que você sincronizou — ideal para rodar periodicamente.',
        query: { updatedSince: '2026-08-01T00:00:00Z' },
      },
    ],
    exampleResponse: JSON.stringify(
      {
        data: [
          { id: '7188...', type: 'support', customerId: '48bf...', customerName: 'Jean', customerPhone: '11999990000', assigneeId: 'a881...', queueId: 'suporte-n1', status: 'active', ticketId: null, ticketNumber: null, tags: ['vip'], createdAt: '2026-07-20T12:00:00.000Z', updatedAt: '2026-07-20T12:00:00.000Z', lastMessageAt: null },
        ],
        meta: { limit: 100, offset: 0, total: 1, hasMore: false },
      },
      null,
      2
    ),
    errors: [...AUTH_ERRORS, scopeError('conversations:read'), { status: 400, code: 'VALIDATION_ERROR', description: 'updatedSince não é uma data ISO 8601 válida.' }, { status: 404, code: 'NOT_FOUND', description: 'Conversa não encontrada.' }],
  },
];
