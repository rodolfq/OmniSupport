'use client';

import React from 'react';
import { AiAssistantAvatar } from '@/components/ai-assistant-avatar';
import { AiAssistantAvatarRive } from '@/components/ai-assistant-avatar-rive';
import { AiAssistantAvatarSource, AvatarCrop, getAvatarOption } from '@/lib/ai-assistant-avatar-options';

interface AiAssistantIconProps {
  avatarSource: AiAssistantAvatarSource;
  // Recorte efetivo (override salvo + default já resolvidos por quem
  // busca os dados — ver app/api/ai-assistant/avatar/route.ts). Quando
  // omitido, usa o default do catálogo (lib/ai-assistant-avatar-options.ts).
  crop?: AvatarCrop;
  size?: number;
  className?: string;
}

// Ponto único de renderização do ícone do Agente de IA — resolve o id salvo
// em Configurações > Agente de IA (ver lib/ai-assistant-avatar-options.ts)
// pro componente concreto certo. Usado tanto no widget flutuante quanto na
// grade de seleção da tela de Configurações, pra nunca desalinhar os dois.
export function AiAssistantIcon({ avatarSource, crop, size = 40, className }: AiAssistantIconProps) {
  const option = getAvatarOption(avatarSource);

  if (!option.riveSrc || !option.stateMachine) {
    return <AiAssistantAvatar size={size} className={className} />;
  }

  const effectiveCrop = crop || option.defaultCrop;

  return (
    <AiAssistantAvatarRive
      src={option.riveSrc}
      stateMachine={option.stateMachine}
      clickTrigger={option.clickTrigger}
      focusX={effectiveCrop.focusX}
      focusY={effectiveCrop.focusY}
      zoom={effectiveCrop.zoom}
      globalCursorTracking={option.globalCursorTracking}
      size={size}
      className={className}
    />
  );
}
