// Paleta compartilhada pelo gerenciador de status (Configurações > Geral) e
// pelos kanbans de Tickets Internos — cada cor já vem com bg/text (badge),
// dot (bolinha do kanban) e accent (hex, pra gráficos/barras) casados, então
// qualquer status novo cadastrado manualmente já nasce com um visual
// consistente nas telas que hoje tratavam só os 4 status hardcoded.
export interface StatusColor {
  key: string;
  label: string;
  bg: string;
  text: string;
  dot: string;
  accent: string;
}

export const STATUS_COLOR_PALETTE: StatusColor[] = [
  { key: 'slate', label: 'Cinza', bg: 'bg-slate-100', text: 'text-slate-700', dot: 'bg-slate-500', accent: '#64748B' },
  { key: 'blue', label: 'Azul', bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500', accent: '#2563EB' },
  { key: 'amber', label: 'Âmbar', bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500', accent: '#D97706' },
  { key: 'emerald', label: 'Esmeralda', bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', accent: '#16A34A' },
  { key: 'rose', label: 'Rosa', bg: 'bg-rose-100', text: 'text-rose-700', dot: 'bg-rose-500', accent: '#E11D48' },
  { key: 'purple', label: 'Roxo', bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500', accent: '#9333EA' },
  { key: 'cyan', label: 'Ciano', bg: 'bg-cyan-100', text: 'text-cyan-700', dot: 'bg-cyan-500', accent: '#0891B2' },
  { key: 'indigo', label: 'Índigo', bg: 'bg-indigo-100', text: 'text-indigo-700', dot: 'bg-indigo-500', accent: '#4F46E5' },
  { key: 'orange', label: 'Laranja', bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500', accent: '#EA580C' },
  { key: 'pink', label: 'Rosa Choque', bg: 'bg-pink-100', text: 'text-pink-700', dot: 'bg-pink-500', accent: '#DB2777' },
];

export function findStatusColor(colorClasses?: string | null): StatusColor {
  if (colorClasses) {
    const found = STATUS_COLOR_PALETTE.find(p => colorClasses.includes(p.bg));
    if (found) return found;
  }
  return STATUS_COLOR_PALETTE[0];
}
