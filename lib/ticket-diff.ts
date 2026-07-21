// Helper compartilhado por chamados e tickets internos para montar a
// mensagem automática de "o que mudou" (formato Linear/Jira: "de → para
// (Campo)"), usada tanto no log de sistema quanto na aba Histórico.

export interface FieldChange {
  label: string;
  from: string;
  to: string;
}

export function formatChangeMessage(changes: FieldChange[]): string {
  const lines = changes.map(c => `${c.from || '—'} → ${c.to || '—'} (${c.label})`);
  return ['Alterações realizadas', ...lines].join('\n');
}
