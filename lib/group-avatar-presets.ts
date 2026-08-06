// Galeria de ícones prontos pra foto de grupo do chat interno — alternativa
// rápida ao upload de arquivo (que já existia) nos modais "Novo Grupo" e
// "Configurações do Grupo" (ver app/(portal)/chat-internal/page.tsx). Gerados
// como SVG inline (data URI) em vez de arquivos em public/: nenhum asset pra
// versionar, sempre disponíveis, e o valor salvo em internal_chats.image_url
// é só uma string igual a de um upload comum — o resto do app (avatar da
// sala, header, lista) não precisa saber a diferença.
export interface GroupAvatarPreset {
  id: string;
  label: string;
  url: string;
}

function buildPresetAvatarUrl(bg: string, emoji: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="24" fill="${bg}"/><text x="48" y="63" font-size="44" text-anchor="middle">${emoji}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const PRESET_DEFS: { id: string; label: string; bg: string; emoji: string }[] = [
  { id: 'team', label: 'Equipe', bg: '#4f46e5', emoji: '👥' },
  { id: 'support', label: 'Suporte', bg: '#0ea5e9', emoji: '🎧' },
  { id: 'dev', label: 'Dev', bg: '#16a34a', emoji: '💻' },
  { id: 'alert', label: 'Alertas', bg: '#dc2626', emoji: '🚨' },
  { id: 'idea', label: 'Ideias', bg: '#f59e0b', emoji: '💡' },
  { id: 'rocket', label: 'Lançamento', bg: '#7c3aed', emoji: '🚀' },
  { id: 'chat', label: 'Conversa', bg: '#0891b2', emoji: '💬' },
  { id: 'star', label: 'Destaque', bg: '#db2777', emoji: '⭐' }
];

export const GROUP_AVATAR_PRESETS: GroupAvatarPreset[] = PRESET_DEFS.map((p) => ({
  id: p.id,
  label: p.label,
  url: buildPresetAvatarUrl(p.bg, p.emoji)
}));
