// Fonte única da verdade pro "Detector de insatisfação do cliente" —
// taxonomia fixa definida pelo negócio (departamento + categoria
// específica), usada tanto no prompt do Groq
// (lib/services/dissatisfaction-service.ts) quanto em qualquer
// dropdown/filtro de UI (app/(portal)/chat-history/page.tsx). Mesma ideia de
// catálogo fixo de lib/automation-events.ts — categoria nova = só mexer
// aqui.

export interface DissatisfactionDepartmentDef {
  department: string;
  categories: string[];
}

export const DISSATISFACTION_TAXONOMY: DissatisfactionDepartmentDef[] = [
  {
    department: 'Suporte',
    categories: ['Lentidão no atendimento', 'Demora na resposta', 'Falta de retorno', 'Baixa resolutividade', 'Comunicação inadequada']
  },
  {
    department: 'Comercial',
    categories: ['Alinhamento incorreto de expectativas', 'Promessa não atendida', 'Escopo divergente', 'Informações inconsistentes', 'Pendências contratuais', 'Falta de definição comercial', 'Prazo comercial não cumprido']
  },
  {
    department: 'Treinamento',
    categories: ['Conteúdo insuficiente', 'Capacitação incompleta', 'Treinamento superficial', 'Material de apoio insuficiente', 'Dificuldade para esclarecer dúvidas', 'Participação reduzida']
  },
  {
    department: 'Hardware',
    categories: ['Configuração incorreta']
  },
  {
    department: 'Customer Success',
    categories: ['Falta de alinhamento', 'Comunicação ineficiente', 'Plano de ação pendente', 'Acompanhamento insuficiente', 'Relacionamento fragilizado', 'Baixa proatividade']
  },
  {
    department: 'Produto SSX',
    categories: ['Lentidão do sistema', 'Instabilidade', 'Erro de funcionamento', 'Funcionalidade indisponível', 'Funcionalidade insuficiente', 'Interface complexa', 'Dificuldade de usabilidade', 'Limitação funcional', 'Integração com falha', 'Dados inconsistentes']
  }
];

export const DISSATISFACTION_DEPARTMENTS = DISSATISFACTION_TAXONOMY.map(d => d.department);

const CATEGORY_BY_DEPARTMENT = new Map(
  DISSATISFACTION_TAXONOMY.map(d => [d.department, new Set(d.categories)])
);

// Validação defensiva do retorno do Groq — nunca grava department/category
// que o modelo tenha inventado fora da taxonomia.
export function isValidDissatisfactionPair(department: string, category: string): boolean {
  return CATEGORY_BY_DEPARTMENT.get(department)?.has(category) ?? false;
}

// Texto formatado pra embutir no prompt — uma linha por departamento.
export function formatTaxonomyForPrompt(): string {
  return DISSATISFACTION_TAXONOMY.map(d => `- ${d.department}: ${d.categories.join(', ')}`).join('\n');
}
