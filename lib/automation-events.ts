// Catálogo dos eventos do módulo "Mensagens Automáticas". Fonte única da
// verdade para chaves, textos padrão e vínculo com status do chamado.
//
// Para adicionar um evento novo no futuro: só acrescentar uma entrada aqui.
// A linha correspondente em automation_settings é auto-criada na primeira
// leitura (ver ensureAutomationSettingsSeeded em automation-service.ts) —
// não é necessária nenhuma migration nova.

export interface AutomationEventDef {
  key: string;
  label: string;
  description: string;
  defaultMessage: string;
  /** Mostra o seletor "status que dispara este evento" na UI. */
  statusConfigurable: boolean;
  /** Valor pré-selecionado desse seletor (rótulo em config_statuses). */
  defaultTriggerStatus?: string;
}

export const AUTOMATION_EVENTS: AutomationEventDef[] = [
  {
    key: 'novo_chamado',
    label: 'Novo chamado',
    description: 'Disparado quando um chamado é criado.',
    statusConfigurable: false,
    defaultMessage: `📢 Confirmação de abertura de chamado

✅ Seu chamado nº {{numero_chamado}} foi registrado com sucesso.

📌 Assunto:
{{titulo}}

🧑‍💻 Nossa equipe irá analisar sua solicitação e iniciar o atendimento o mais breve possível.

Você receberá novas atualizações automaticamente.

➡️ SystemSat`
  },
  {
    key: 'chamado_classificado',
    label: 'Chamado classificado',
    description: 'Disparado quando a categoria do chamado é definida ou alterada.',
    statusConfigurable: false,
    defaultMessage: `📢 Confirmação de classificação

✅ Seu chamado nº {{numero_chamado}} foi classificado.

📂 Categoria:
{{categoria}}

🔁 Em breve um analista iniciará o atendimento.

➡️ SystemSat`
  },
  {
    key: 'analista_atribuido',
    label: 'Analista atribuído',
    description: 'Disparado quando um responsável assume o chamado.',
    statusConfigurable: false,
    defaultMessage: `👨‍💻 Atendimento iniciado

Seu chamado nº {{numero_chamado}} agora está sob responsabilidade de:

👤 {{analista}}

Nossa equipe seguirá acompanhando sua solicitação até a resolução.

➡️ SystemSat`
  },
  {
    key: 'mudanca_prioridade',
    label: 'Mudança de prioridade',
    description: 'Disparado sempre que a prioridade do chamado é alterada.',
    statusConfigurable: false,
    defaultMessage: `📌 Atualização de prioridade

Seu chamado nº {{numero_chamado}} teve sua prioridade alterada.

Nova prioridade:

{{prioridade}}

Caso tenha dúvidas, basta responder esta conversa.

➡️ SystemSat`
  },
  {
    key: 'mudanca_status',
    label: 'Mudança de status',
    description: 'Disparado sempre que o status mudar para algo não coberto por um evento mais específico abaixo.',
    statusConfigurable: false,
    defaultMessage: `📢 Atualização do chamado

Seu chamado nº {{numero_chamado}} recebeu uma atualização.

Novo status:

{{status}}

Você continuará recebendo notificações sempre que houver novidades.

➡️ SystemSat`
  },
  {
    key: 'solicitacao_informacoes',
    label: 'Solicitação de informações',
    description: 'Disparado quando o status muda para o status configurado abaixo (padrão: "Aguardando Cliente").',
    statusConfigurable: true,
    defaultTriggerStatus: 'Aguardando Cliente',
    defaultMessage: `📋 Precisamos da sua ajuda

Seu chamado nº {{numero_chamado}} está aguardando um retorno seu.

Assim que recebermos as informações solicitadas, o atendimento continuará normalmente.

➡️ SystemSat`
  },
  {
    key: 'aguardando_aprovacao',
    label: 'Aguardando aprovação',
    description: 'Disparado quando o status muda para o status configurado abaixo (padrão: "Aguardando Aprovação"). Só dispara se esse fluxo existir.',
    statusConfigurable: true,
    defaultTriggerStatus: 'Aguardando Aprovação',
    defaultMessage: `⏳ Aguardando aprovação

Seu chamado nº {{numero_chamado}} está aguardando sua confirmação para continuidade.

Após sua resposta o atendimento será retomado.

➡️ SystemSat`
  },
  {
    key: 'aguardando_nota',
    label: 'Aguardando nota do cliente',
    description: 'Disparado quando o status muda para o status configurado abaixo (padrão: "Resolvido"), após o analista concluir o atendimento.',
    statusConfigurable: true,
    defaultTriggerStatus: 'Resolvido',
    defaultMessage: `⭐ Como foi seu atendimento?

Seu chamado nº {{numero_chamado}} foi resolvido.

Gostaríamos de conhecer sua experiência.

Sua avaliação é muito importante para melhorarmos continuamente nossos atendimentos.

➡️ SystemSat`
  },
  {
    key: 'chamado_finalizado',
    label: 'Chamado finalizado',
    description: 'Disparado quando o status muda para o status configurado abaixo (padrão: "Fechado").',
    statusConfigurable: true,
    defaultTriggerStatus: 'Fechado',
    defaultMessage: `✅ Chamado finalizado

Seu chamado nº {{numero_chamado}} foi encerrado com sucesso.

Obrigado por confiar em nossa equipe.

Caso o problema persista ou seja necessário complementar o atendimento, você poderá solicitar a reabertura deste chamado sem necessidade de criar um novo.

Agradecemos sua avaliação.

➡️ SystemSat`
  },
  {
    key: 'chamado_reaberto',
    label: 'Chamado reaberto',
    description: 'Disparado quando um chamado fechado volta para um status em andamento.',
    statusConfigurable: false,
    defaultMessage: `🔄 Chamado reaberto

Seu chamado nº {{numero_chamado}} foi reaberto.

Nossa equipe retomará o atendimento em breve.

➡️ SystemSat`
  },
  {
    key: 'resposta_analista',
    label: 'Comentário interno convertido em resposta',
    description: 'Disparado sempre que o analista responder ao cliente (não conta notas internas).',
    statusConfigurable: false,
    defaultMessage: `💬 Nova atualização

Há uma nova resposta em seu chamado nº {{numero_chamado}}.

Acesse o sistema ou responda esta conversa para continuar o atendimento.

➡️ SystemSat`
  }
];

export function getAutomationEventDef(key: string): AutomationEventDef | undefined {
  return AUTOMATION_EVENTS.find(e => e.key === key);
}

// Puro, sem dependências de servidor — usado tanto no envio real
// (lib/services/automation-service.ts) quanto na prévia da UI de admin.
export function renderTemplate(template: string, context: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => context[key] ?? '');
}

export interface AutomationVariableDef {
  key: string;
  label: string;
  sample: string;
}

export const AUTOMATION_VARIABLES: AutomationVariableDef[] = [
  { key: 'numero_chamado', label: 'Número do chamado', sample: '0042' },
  { key: 'titulo', label: 'Título do chamado', sample: 'Impressora não funciona' },
  { key: 'cliente', label: 'Nome do cliente', sample: 'João da Silva' },
  { key: 'empresa', label: 'Nome da empresa', sample: 'Empresa Exemplo Ltda' },
  { key: 'analista', label: 'Analista responsável', sample: 'Maria Souza' },
  { key: 'status', label: 'Status atual', sample: 'Em Atendimento' },
  { key: 'prioridade', label: 'Prioridade', sample: 'Alta' },
  { key: 'categoria', label: 'Categoria', sample: 'Suporte Técnico' },
  { key: 'data', label: 'Data do envio', sample: '18/07/2026' },
  { key: 'hora', label: 'Hora do envio', sample: '14:32' },
  { key: 'link', label: 'Link do chamado', sample: 'https://app.systemsat.com.br/my-tickets?ticket=abc123' },
  { key: 'nota', label: 'Nota/resposta relacionada', sample: 'Cliente confirmou o problema.' },
  { key: 'motivo', label: 'Motivo (quando informado)', sample: 'Reincidência reportada pelo cliente' },
  { key: 'tempo_atendimento', label: 'Tempo de atendimento', sample: '2 dias e 3 horas' }
];
