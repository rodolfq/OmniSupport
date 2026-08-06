'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Rive, Layout, Fit, Alignment } from '@rive-app/canvas';
import Lottie from 'lottie-react';
import { RotateCcw, ZoomIn } from 'lucide-react';
import { AiAssistantAvatarOption, AvatarCrop } from '@/lib/ai-assistant-avatar-options';

interface AiAssistantAvatarCropEditorProps {
  option: AiAssistantAvatarOption;
  crop: AvatarCrop;
  onChange: (crop: AvatarCrop) => void;
}

// Tamanho do quadrado de prévia — usado DIRETO na mesma fórmula de recorte
// de components/ai-assistant-avatar-rive.tsx (focusX/focusY/zoom), então o
// que aparece aqui bate 1:1 com o ícone real (só que maior e sem o
// clip circular, pra dar contexto do que fica de fora).
const VIEWPORT_SIZE = 260;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4.5;

// Editor visual do recorte (posição + zoom) de um personagem Rive — arrastar
// pra posicionar, slider pra zoom. Salva no mesmo lugar global de sempre
// (ai_assistant_settings.avatar_crop_overrides via saveAssistantConfig em
// ai-assistant-settings-content.tsx), não é preferência por usuário.
//
// Monta a instância do Rive UMA vez (por src/stateMachine) — arrastar/dar
// zoom só reposiciona e redimensiona o <canvas> já existente
// (rive.resizeDrawingSurfaceToCanvas), nunca recria a instância. Recriar a
// cada tick de slider seria recarregar o arquivo inteiro de novo, travado.
export function AiAssistantAvatarCropEditor({ option, crop, onChange }: AiAssistantAvatarCropEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const riveRef = useRef<Rive | null>(null);
  const cropRef = useRef(crop);
  cropRef.current = crop;

  const canvasSize = VIEWPORT_SIZE * crop.zoom;
  const [lottieData, setLottieData] = useState<object | null>(null);

  // Mesmo fetch manual de ai-assistant-avatar-lottie.tsx — animationData do
  // lottie-react precisa do JSON já parseado.
  useEffect(() => {
    if (!option.lottieSrc) { setLottieData(null); return; }
    let cancelled = false;
    setLottieData(null);
    fetch(option.lottieSrc)
      .then((res) => res.json())
      .then((data) => { if (!cancelled) setLottieData(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [option.lottieSrc]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !option.riveSrc || !option.stateMachine) return;

    canvas.width = VIEWPORT_SIZE * cropRef.current.zoom;
    canvas.height = VIEWPORT_SIZE * cropRef.current.zoom;

    const rive = new Rive({
      src: option.riveSrc,
      canvas,
      stateMachines: option.stateMachine,
      autoplay: true,
      autoBind: false,
      layout: new Layout({ fit: Fit.Cover, alignment: Alignment.Center })
    });
    riveRef.current = rive;

    return () => {
      rive.cleanup();
      riveRef.current = null;
    };
  }, [option.riveSrc, option.stateMachine]);

  // Zoom muda só o tamanho físico do canvas (sem recriar a instância).
  useEffect(() => {
    const canvas = canvasRef.current;
    const rive = riveRef.current;
    if (!canvas || !rive) return;
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    rive.resizeDrawingSurfaceToCanvas();
  }, [canvasSize]);

  // MouseEvent + listeners em window durante o arrasto, não
  // Pointer Capture — mesmo raciocínio de components/ai-assistant-avatar-
  // rive.tsx (o rastreio de cursor por PointerEvent sintético não
  // funcionou contra o runtime do Rive; aqui é o inverso, mas o padrão de
  // window-level listener é mais simples e não depende de nenhuma API por
  // trás do pointer capture, então usamos ele por padrão em todo o
  // arquivo). Sem isso, soltar o drag fora do quadro pequeno perderia o
  // rastreio do mouse.
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const startFocusX = cropRef.current.focusX;
    const startFocusY = cropRef.current.focusY;

    const handleMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      onChange({
        ...cropRef.current,
        focusX: startFocusX - dx / canvasSize,
        focusY: startFocusY - dy / canvasSize
      });
    };
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div
        className="relative shrink-0 rounded-2xl overflow-hidden select-none touch-none cursor-grab active:cursor-grabbing"
        style={{ width: VIEWPORT_SIZE, height: VIEWPORT_SIZE, background: '#12181f' }}
        onMouseDown={handleMouseDown}
      >
        {option.riveSrc && (
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              width: canvasSize,
              height: canvasSize,
              left: VIEWPORT_SIZE / 2 - crop.focusX * canvasSize,
              top: VIEWPORT_SIZE / 2 - crop.focusY * canvasSize,
              pointerEvents: 'none'
            }}
          />
        )}
        {option.lottieSrc && lottieData && (
          <Lottie
            animationData={lottieData}
            loop
            autoplay
            rendererSettings={{ preserveAspectRatio: 'xMidYMid slice' }}
            style={{
              position: 'absolute',
              width: canvasSize,
              height: canvasSize,
              left: VIEWPORT_SIZE / 2 - crop.focusX * canvasSize,
              top: VIEWPORT_SIZE / 2 - crop.focusY * canvasSize,
              pointerEvents: 'none'
            }}
          />
        )}
        {/* Escurece fora do círculo (as 4 pontas do quadrado) — é exatamente
            o que o ícone circular real corta fora. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ borderRadius: '50%', boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }}
        />
        <div
          className="absolute inset-0 pointer-events-none rounded-full"
          style={{ border: '2px dashed rgba(255,255,255,0.65)' }}
        />
      </div>

      <div className="flex-1 w-full space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <ZoomIn size={15} className="text-[var(--text-tertiary)] shrink-0" />
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.05}
              value={crop.zoom}
              onChange={(e) => onChange({ ...crop, zoom: parseFloat(e.target.value) })}
              className="flex-1 accent-[var(--accent)]"
            />
            <span className="text-[10px] font-mono text-[var(--text-tertiary)] w-12 text-right shrink-0">{crop.zoom.toFixed(2)}x</span>
          </div>
          <p className="text-[10px] text-[var(--text-tertiary)] font-medium ml-[27px]">Zoom</p>
        </div>

        <button
          type="button"
          onClick={() => onChange(option.defaultCrop)}
          className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[var(--accent-text)] hover:underline"
        >
          <RotateCcw size={12} /> Restaurar posição padrão
        </button>

        <p className="text-[10px] text-[var(--text-tertiary)] font-medium leading-relaxed">
          Arraste dentro do quadro pra posicionar a personagem. A área tracejada é exatamente o que aparece no ícone circular — o resto (escurecido) fica de fora.
        </p>
      </div>
    </div>
  );
}
