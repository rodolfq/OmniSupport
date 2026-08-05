// Fonte única da verdade pras opções de ícone do Agente de IA — usado tanto
// no servidor (validar o que foi salvo em ai_assistant_settings.avatar_source
// / avatar_crop_overrides) quanto no client (aba Configurações > Agente de
// IA e no próprio widget). Mesma ideia de catálogo fixo de
// lib/dissatisfaction-taxonomy.ts.
//
// Os nomes de state machine/trigger foram confirmados por introspecção real
// do runtime do Rive (rive.contents / viewModelInstance.properties) sobre os
// arquivos em public/rive/, não são um palpite — ver components/
// ai-assistant-avatar-rive.tsx pra como isso é consumido.
export type AiAssistantAvatarSource = 'default' | 'expressive-faces' | 'girl-cursor-tracking' | 'vermelha';

// Recorte manual sobre o artboard (renderizado com Fit.Cover) — nenhum dos 3
// arquivos .riv tem fundo transparente nem cara centralizada de fábrica (o
// fundo é parte da própria arte, não dá pra remover sem o editor do Rive).
// focusX/focusY (0–1) é o ponto do artboard que fica no centro do círculo;
// zoom > 1 aproxima. Editável ao vivo em Configurações > Agente de IA (ver
// components/ai-assistant-avatar-crop-editor.tsx) — os valores abaixo em
// AI_ASSISTANT_AVATAR_OPTIONS são só o ponto de partida/default; o valor
// que vale de verdade pra todo mundo é o salvo em
// ai_assistant_settings.avatar_crop_overrides (ver getEffectiveCrop).
export interface AvatarCrop {
  focusX: number;
  focusY: number;
  zoom: number;
}

export type AvatarCropOverrides = Partial<Record<AiAssistantAvatarSource, AvatarCrop>>;

export interface AiAssistantAvatarOption {
  id: AiAssistantAvatarSource;
  label: string;
  description: string;
  // null = personagem padrão em SVG (components/ai-assistant-avatar.tsx),
  // não usa Rive nem recorte.
  riveSrc: string | null;
  // Miniatura estática (PNG) — usada só como ícone de seleção na grade.
  // Nunca montamos mais de um <canvas> Rive ao mesmo tempo na tela de
  // Configurações fora do editor de posição: montar vários simultaneamente
  // (um por card) deixava os canvases pretos — bug de concorrência do
  // runtime do Rive com múltiplas instâncias no ar ao mesmo tempo,
  // reproduzido tanto em dev quanto em build de produção.
  previewImage: string | null;
  stateMachine: string | null;
  // Nome do trigger (View Model) a disparar no clique, quando o próprio
  // arquivo não reage sozinho ao clique via Listener nativo.
  clickTrigger: string | null;
  defaultCrop: AvatarCrop;
  // O Listener nativo de "olhos seguem o mouse" do arquivo só reage a
  // ponteiro DENTRO do <canvas> — e nosso canvas real é só o ícone (40-56px
  // de tela), então na prática só rastreava quando o mouse chegava bem
  // perto. Quando true, o componente redireciona o mousemove da janela
  // inteira pra esse Listener nativo (ver components/ai-assistant-avatar-
  // rive.tsx) — a personagem passa a acompanhar o cursor em qualquer lugar
  // da tela, não só sobre o ícone.
  globalCursorTracking: boolean;
}

export const AI_ASSISTANT_AVATAR_OPTIONS: AiAssistantAvatarOption[] = [
  {
    id: 'default',
    label: 'Padrão (vetor)',
    description: 'Personagem própria em SVG — pisca, respira e o cabelo balança em loop.',
    riveSrc: null,
    previewImage: null,
    stateMachine: null,
    clickTrigger: null,
    defaultCrop: { focusX: 0.5, focusY: 0.5, zoom: 1 },
    globalCursorTracking: false
  },
  {
    id: 'expressive-faces',
    label: 'Ruiva (Expressive Faces)',
    description: 'Recortada de um arquivo com 4 personagens — só a ruiva fica visível. Sem rastreio de cursor: clique dispara a expressão.',
    riveSrc: '/rive/expressive-faces.riv',
    previewImage: '/rive/expressive-faces-preview.png',
    stateMachine: 'STATE MACHINE ALL',
    clickTrigger: 'red head trigger',
    defaultCrop: { focusX: 0.32, focusY: 0.60, zoom: 2.2 },
    globalCursorTracking: false
  },
  {
    id: 'girl-cursor-tracking',
    label: 'Garota (segue o cursor)',
    description: 'Olhos seguem o mouse em qualquer parte da tela, pisca sozinha e reage ao clique.',
    riveSrc: '/rive/girl-cursor-tracking.riv',
    previewImage: '/rive/girl-cursor-tracking-preview.png',
    stateMachine: 'State Machine 1',
    clickTrigger: null,
    defaultCrop: { focusX: 0.40, focusY: 0.42, zoom: 1.6 },
    globalCursorTracking: true
  },
  {
    id: 'vermelha',
    label: 'Vermelha (respiração)',
    description: 'Loop de respiração contínuo, baseado em tempo — sem interação por mouse.',
    riveSrc: '/rive/vermelha.riv',
    previewImage: '/rive/vermelha-preview.png',
    stateMachine: 'State Machine 1',
    clickTrigger: null,
    defaultCrop: { focusX: 0.5, focusY: 0.33, zoom: 1.40 },
    globalCursorTracking: false
  }
];

export const DEFAULT_AI_ASSISTANT_AVATAR: AiAssistantAvatarSource = 'default';

export function getAvatarOption(id: string | null | undefined): AiAssistantAvatarOption {
  return AI_ASSISTANT_AVATAR_OPTIONS.find((o) => o.id === id) || AI_ASSISTANT_AVATAR_OPTIONS[0];
}

export function isValidAvatarSource(value: string | null | undefined): value is AiAssistantAvatarSource {
  return !!value && AI_ASSISTANT_AVATAR_OPTIONS.some((o) => o.id === value);
}

function isValidCrop(value: any): value is AvatarCrop {
  return value
    && typeof value.focusX === 'number' && value.focusX >= -0.5 && value.focusX <= 1.5
    && typeof value.focusY === 'number' && value.focusY >= -0.5 && value.focusY <= 1.5
    && typeof value.zoom === 'number' && value.zoom >= 1 && value.zoom <= 6;
}

// O que vale de verdade em runtime pra todo mundo: o override salvo (se
// existir e for um valor plausível) por cima do default do catálogo.
export function getEffectiveCrop(id: AiAssistantAvatarSource, overrides: AvatarCropOverrides | null | undefined): AvatarCrop {
  const option = getAvatarOption(id);
  const override = overrides?.[id];
  return isValidCrop(override) ? override : option.defaultCrop;
}

// Filtra um objeto cru (ex.: vindo do client) pra só as chaves/formatos
// válidos antes de gravar em ai_assistant_settings.avatar_crop_overrides —
// nunca confia direto no JSON que chegou.
export function sanitizeCropOverrides(raw: any): AvatarCropOverrides {
  const result: AvatarCropOverrides = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const option of AI_ASSISTANT_AVATAR_OPTIONS) {
    if (!option.riveSrc) continue;
    const candidate = raw[option.id];
    if (isValidCrop(candidate)) {
      result[option.id] = { focusX: candidate.focusX, focusY: candidate.focusY, zoom: candidate.zoom };
    }
  }
  return result;
}
