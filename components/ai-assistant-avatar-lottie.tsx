'use client';

import React, { useEffect, useState } from 'react';
import Lottie from 'lottie-react';

interface AiAssistantAvatarLottieProps {
  src: string;
  // Mesmo recorte manual (focusX/focusY/zoom) usado em ai-assistant-avatar-
  // rive.tsx, pela mesma razão: a arte não vem centralizada/quadrada de
  // fábrica (female-05.json é 800x600). preserveAspectRatio 'xMidYMid
  // slice' abaixo é o equivalente Lottie do Fit.Cover do Rive — sem isso o
  // recorte por fração de canvas não bateria com o que aparece na tela.
  focusX?: number;
  focusY?: number;
  zoom?: number;
  size?: number;
  className?: string;
}

// Personagem em Lottie (JSON do bodymovin/After Effects) — alternativa aos
// personagens Rive de ai-assistant-avatar-rive.tsx pra arquivos sem state
// machine (loop de tempo puro, sem interação). animationData do lottie-
// react precisa do JSON já parseado, não aceita URL direto — por isso o
// fetch manual abaixo em vez de só passar `src`.
export function AiAssistantAvatarLottie({
  src, focusX = 0.5, focusY = 0.5, zoom = 1, size = 40, className
}: AiAssistantAvatarLottieProps) {
  const [animationData, setAnimationData] = useState<object | null>(null);
  const canvasSize = size * zoom;

  useEffect(() => {
    let cancelled = false;
    setAnimationData(null);
    fetch(src)
      .then((res) => res.json())
      .then((data) => { if (!cancelled) setAnimationData(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [src]);

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        background: 'transparent',
        position: 'relative'
      }}
    >
      {animationData && (
        <Lottie
          animationData={animationData}
          loop
          autoplay
          rendererSettings={{ preserveAspectRatio: 'xMidYMid slice' }}
          style={{
            position: 'absolute',
            width: canvasSize,
            height: canvasSize,
            left: size / 2 - focusX * canvasSize,
            top: size / 2 - focusY * canvasSize
          }}
        />
      )}
    </div>
  );
}
