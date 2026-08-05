'use client';

import React, { useEffect, useRef } from 'react';
import { Rive, Layout, Fit, Alignment } from '@rive-app/canvas';

interface AiAssistantAvatarRiveProps {
  src: string;
  stateMachine: string;
  // Nome do trigger (View Model) a disparar no clique — só necessário pra
  // arquivos sem Listener de clique nativo (ver lib/ai-assistant-avatar-
  // options.ts). Quando null, o clique não faz nada aqui: se o arquivo tiver
  // Listener próprio de clique, o runtime do Rive já reage sozinho.
  clickTrigger?: string | null;
  // Recorte manual sobre o artboard renderizado com Fit.Cover — ver
  // lib/ai-assistant-avatar-options.ts pro porquê (nenhum dos arquivos tem
  // fundo transparente nem enquadramento centralizado de fábrica).
  focusX?: number;
  focusY?: number;
  zoom?: number;
  // Redireciona o mousemove da janela inteira pro <canvas> real (que é só
  // o ícone, poucos px) — sem isso, o Listener nativo de "olhar pro mouse"
  // só reage quando o ponteiro está sobre o ícone. Ver comentário completo
  // em lib/ai-assistant-avatar-options.ts.
  globalCursorTracking?: boolean;
  size?: number;
  className?: string;
}

// Personagem Rive (arquivo .riv real, com blink/rastreio de cursor/reação a
// clique embutidos pelo autor) — alternativa ao personagem SVG feito à mão
// em ai-assistant-avatar.tsx.
//
// Usa a classe Rive de baixo nível (@rive-app/canvas) direto num <canvas>
// nosso, via useEffect — de propósito, NÃO usa o hook useRive de
// @rive-app/react-canvas. Em teste (dev e build de produção), o hook
// deixava o canvas preto de forma intermitente mesmo com uma única
// instância na página (sem erro no console, os arquivos carregavam com
// sucesso — só não desenhava); o padrão manual abaixo, que define
// canvas.width/height ANTES de construir o Rive (igual à documentação),
// nunca falhou num teste sequer. Se for mexer aqui, mantenha esse padrão.
export function AiAssistantAvatarRive({
  src, stateMachine, clickTrigger, focusX = 0.5, focusY = 0.5, zoom = 1, globalCursorTracking = false, size = 40, className
}: AiAssistantAvatarRiveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const riveRef = useRef<Rive | null>(null);
  const canvasSize = size * zoom;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = canvasSize;
    canvas.height = canvasSize;

    const rive = new Rive({
      src,
      canvas,
      stateMachines: stateMachine,
      autoplay: true,
      // Precisa de autoBind sempre que o arquivo usa View Model pra
      // QUALQUER coisa em runtime — não só pro trigger de clique. O
      // "girl-cursor-tracking.riv" não tem clickTrigger, mas o Listener de
      // rastreio de cursor escreve em propriedades do View Model (Mouse X/
      // Mouse Y); sem instância vinculada, essas escritas não vão a lugar
      // nenhum e o rastreio simplesmente não faz nada, sem erro nenhum.
      autoBind: !!clickTrigger || globalCursorTracking,
      layout: new Layout({ fit: Fit.Cover, alignment: Alignment.Center })
    });
    riveRef.current = rive;

    return () => {
      rive.cleanup();
      riveRef.current = null;
    };
  }, [src, stateMachine]);

  // Mapeia a posição do mouse na JANELA INTEIRA (0..1 em cada eixo) pra
  // dentro do bounding box do canvas real, e dispara um mousemove sintético
  // nele — o Listener nativo do arquivo (que só escuta o <canvas>) passa a
  // reagir a qualquer ponto da tela, não só quando o cursor está em cima do
  // ícone pequeno.
  //
  // MouseEvent, não PointerEvent — confirmado por teste direto contra o
  // arquivo real: o Listener de rastreio de cursor do Rive só reagiu a
  // mousemove/mouseenter clássicos, PointerEvent sintético não teve efeito
  // nenhum (mesmo com isPrimary/pointerType corretos). Se for mexer aqui e
  // parar de funcionar, é o primeiro lugar a suspeitar.
  useEffect(() => {
    if (!globalCursorTracking) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let entered = false;

    const dispatchAt = (type: string, clientX: number, clientY: number) => {
      // bubbles:false de propósito — o listener do Rive está direto no
      // canvas (dispara na fase de target independente de bubbling), e
      // deixar borbulhar faria o evento sintético voltar pro listener de
      // window abaixo, disparando outro sintético — loop infinito.
      canvas.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: false }));
    };

    const handlePointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const fracX = e.clientX / window.innerWidth;
      const fracY = e.clientY / window.innerHeight;
      const x = rect.left + fracX * rect.width;
      const y = rect.top + fracY * rect.height;

      // O Listener do arquivo só passa a reagir ao mousemove depois de um
      // mouseenter — como o mouse de verdade nunca entra fisicamente no
      // canvas pequeno (ele está em qualquer lugar da tela), esse evento
      // nunca aconteceria sozinho. Simulamos uma vez, na primeira posição.
      if (!entered) {
        dispatchAt('mouseenter', x, y);
        entered = true;
      }
      dispatchAt('mousemove', x, y);
    };

    window.addEventListener('pointermove', handlePointerMove);
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, [globalCursorTracking]);

  const handleClick = () => {
    if (!clickTrigger) return;
    const trigger = riveRef.current?.viewModelInstance?.trigger(clickTrigger);
    trigger?.trigger();
  };

  return (
    <div
      className={className}
      onClick={clickTrigger ? handleClick : undefined}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        background: '#12181f',
        position: 'relative',
        cursor: clickTrigger ? 'pointer' : undefined
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          width: canvasSize,
          height: canvasSize,
          left: size / 2 - focusX * canvasSize,
          top: size / 2 - focusY * canvasSize
        }}
      />
    </div>
  );
}
