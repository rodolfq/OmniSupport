/**
 * Preferências de notificação por e-mail (2026-11-25, pedido do usuário).
 * Compartilhado por tela e servidor (sem import de pg/Next).
 *
 * Guardado em profiles.email_notification_prefs como { chave: boolean }.
 * Chave ausente = LIGADA (decisão do usuário: ninguém deixa de receber o que
 * já recebia até desligar na tela).
 */

export const EMAIL_PREF_KEYS = [
  'assigned_to_me',
  'mention',
  'internal_note',
  'internal_status',
  'internal_queue',
  'internal_assignee',
  'internal_title',
  'internal_description',
  'internal_priority',
  'internal_hotfix',
  'internal_classification',
  'internal_top_priority',
  'internal_other',
] as const;

export type EmailPrefKey = typeof EMAIL_PREF_KEYS[number];
export type EmailPrefs = Partial<Record<EmailPrefKey, boolean>>;

export const EMAIL_PREF_GROUPS: { title: string; items: { key: EmailPrefKey; label: string; desc: string }[] }[] = [
  {
    title: 'Sobre você',
    items: [
      { key: 'assigned_to_me', label: 'Atribuído a você', desc: 'Um chamado ou ticket interno passou a ter você como responsável.' },
      { key: 'mention', label: 'Marcação com @', desc: 'Alguém marcou você numa nota do histórico de um ticket interno.' },
    ],
  },
  {
    title: 'Tickets internos que você acompanha',
    items: [
      { key: 'internal_note', label: 'Nova nota no histórico', desc: 'Qualquer nota adicionada ao ticket interno.' },
      { key: 'internal_status', label: 'Mudança de status', desc: 'Status ou sub-status do ticket interno mudou.' },
      { key: 'internal_queue', label: 'Mudança de fila', desc: 'O ticket interno foi para outra fila.' },
      { key: 'internal_assignee', label: 'Mudança de responsável', desc: 'O responsável mudou para outra pessoa (quando passa a ser você, vale "Atribuído a você").' },
      { key: 'internal_title', label: 'Título alterado', desc: 'O título do ticket interno mudou.' },
      { key: 'internal_description', label: 'Descrição alterada', desc: 'A descrição do ticket interno foi editada.' },
      { key: 'internal_priority', label: 'Prioridade (estrelas)', desc: 'A quantidade de estrelas mudou.' },
      { key: 'internal_hotfix', label: 'Hotfix', desc: 'O ticket interno foi ligado a outro hotfix ou desligado dele.' },
      { key: 'internal_classification', label: 'Esforço e desfecho', desc: 'A classificação de esforço ou de desfecho mudou.' },
      { key: 'internal_top_priority', label: 'Prioridade máxima na fila', desc: 'O ticket interno foi marcado ou desmarcado como prioridade máxima.' },
      { key: 'internal_other', label: 'Outras alterações', desc: 'Marcadores, vencimento, publicação prevista e reprovações de QA/ambiente.' },
    ],
  },
];

/** Ligada, a menos que a pessoa tenha desligado explicitamente. */
export function isEmailPrefOn(prefs: EmailPrefs | null | undefined, key: EmailPrefKey): boolean {
  return prefs?.[key] !== false;
}

/** Mantém só chaves conhecidas com valor booleano (o que vem do navegador não é confiável). */
export function sanitizeEmailPrefs(input: unknown): EmailPrefs {
  const out: EmailPrefs = {};
  if (!input || typeof input !== 'object') return out;
  for (const key of EMAIL_PREF_KEYS) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === 'boolean') out[key] = v;
  }
  return out;
}

/**
 * Categoria de mudança de ticket interno → chave da preferência. "assignee"
 * vira "assigned_to_me" para quem é o NOVO responsável (decidido no envio).
 */
export type InternalChangeCategory =
  | 'status' | 'queue' | 'assignee' | 'title' | 'description' | 'priority'
  | 'hotfix' | 'classification' | 'top_priority' | 'other';

export const CATEGORY_PREF: Record<InternalChangeCategory, EmailPrefKey> = {
  status: 'internal_status',
  queue: 'internal_queue',
  assignee: 'internal_assignee',
  title: 'internal_title',
  description: 'internal_description',
  priority: 'internal_priority',
  hotfix: 'internal_hotfix',
  classification: 'internal_classification',
  top_priority: 'internal_top_priority',
  other: 'internal_other',
};

/** Campo do ticket interno (nome usado no `fields` da rota) → categoria. */
export const FIELD_CATEGORY: Record<string, InternalChangeCategory> = {
  status: 'status',
  subStatus: 'status',
  internalQueueId: 'queue',
  teamId: 'queue',
  internalTeamId: 'queue',
  assigneeId: 'assignee',
  title: 'title',
  description: 'description',
  priority: 'priority',
  hotfixId: 'hotfix',
  effortId: 'classification',
  outcomeId: 'classification',
  queueTopPriority: 'top_priority',
};
