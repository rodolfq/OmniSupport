'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Download } from 'lucide-react';
import { cn } from '@/lib/utils';

const SPEEDS = [1, 1.5, 2] as const;

const MEDIA_ERROR_NAMES: Record<number, string> = {
  1: 'MEDIA_ERR_ABORTED',
  2: 'MEDIA_ERR_NETWORK',
  3: 'MEDIA_ERR_DECODE',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED'
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

interface AudioPlayerProps {
  src: string;
  name?: string;
  isOwnMessage?: boolean;
}

export function AudioPlayer({ src, name, isOwnMessage }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = SPEEDS[speedIndex];
  }, [speedIndex]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch((err) => {
        console.error(`[AudioPlayer] play() rejected: name="${err?.name}" message="${err?.message}"`);
      });
    }
  };

  const cycleSpeed = () => {
    setSpeedIndex(prev => (prev + 1) % SPEEDS.length);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const value = Number(e.target.value);
    audio.currentTime = value;
    setCurrentTime(value);
  };

  const fixingDurationRef = useRef(false);

  // Áudio de voz do WhatsApp chega como OGG/Opus (via Pyvon) — nesse
  // container, o Chrome/Chromium não sabe a duração real no <audio
  // onLoadedMetadata>, só um valor inútil (normalmente Infinity, às vezes um
  // número bem maior que o áudio de verdade). É por isso que a barra
  // "andava pouco": o range ficava com max=Infinity/errado, então os
  // segundos reais de reprodução pareciam quase não mover o preenchimento.
  // Truque padrão pra esse bug conhecido do Chrome com OGG sem índice de
  // duração no cabeçalho: forçar uma busca (seek) pro fim do arquivo faz o
  // decoder calcular a duração de verdade; depois volta pro início antes de
  // qualquer reprodução real começar.
  const fixDurationIfBroken = (audio: HTMLAudioElement) => {
    if (Number.isFinite(audio.duration) || fixingDurationRef.current) return;
    fixingDurationRef.current = true;
    const onFixTimeUpdate = () => {
      audio.removeEventListener('timeupdate', onFixTimeUpdate);
      audio.currentTime = 0;
      setDuration(audio.duration);
      fixingDurationRef.current = false;
    };
    audio.addEventListener('timeupdate', onFixTimeUpdate);
    audio.currentTime = 1e7; // ~115 dias — bem além de qualquer áudio real, sem ser um valor extremo o bastante pra motor de mídia nenhum estranhar
  };

  // Enquanto fixDurationIfBroken ainda não corrigiu (ou pra formato que nunca
  // precisou, tipo WAV), duration pode estar em Infinity/NaN por uma fração
  // de segundo — nunca deixa isso vazar pro <input type="range"> (max=Infinity
  // é exatamente o bug original: qualquer currentTime real parece não mover
  // a barra).
  const safeDuration = Number.isFinite(duration) ? duration : 0;

  const own = !!isOwnMessage;

  console.log(`[AudioPlayer] Rendering: name="${name}" srcLength=${src?.length ?? 0} srcPrefix="${(src || '').slice(0, 40)}"`);

  if (!src) {
    console.error(`[AudioPlayer] Rendered without a valid src — attachment url is empty. name="${name}"`);
    return (
      <div className={cn(
        "flex items-center gap-2 rounded-xl p-2.5 w-full text-xs font-bold",
        own ? "bg-white/10 text-white/70" : "bg-[var(--surface-card)] border border-[var(--border-default)] text-[var(--text-tertiary)]"
      )}>
        Áudio indisponível
      </div>
    );
  }

  return (
    <div className={cn(
      "flex items-center gap-2 rounded-xl p-2.5 w-full",
      own ? "bg-white/10" : "bg-[var(--surface-card)] border border-[var(--border-default)]"
    )}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onLoadedMetadata={(e) => {
          const audio = e.currentTarget;
          setDuration(audio.duration);
          fixDurationIfBroken(audio);
        }}
        onTimeUpdate={(e) => {
          // Ignora o timeupdate disparado pelo próprio seek de correção
          // (fixDurationIfBroken) — sem isso, a barra pisca "115 dias" por um
          // instante antes de fixDurationIfBroken zerar currentTime de volta.
          if (fixingDurationRef.current) return;
          setCurrentTime(e.currentTarget.currentTime);
        }}
        onError={(e) => {
          const el = e.currentTarget;
          const code = el.error?.code;
          const codeName = code ? (MEDIA_ERROR_NAMES[code] || `unknown(${code})`) : 'none';
          console.error(
            `[AudioPlayer] <audio> error: code=${codeName} message="${el.error?.message || ''}" ` +
            `networkState=${el.networkState} readyState=${el.readyState} ` +
            `currentSrc="${el.currentSrc.slice(0, 60)}" srcLength=${src.length} srcPrefix="${src.slice(0, 40)}"`
          );
        }}
        className="hidden"
      />

      <button
        type="button"
        onClick={togglePlay}
        className={cn(
          "shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition-all",
          own ? "bg-[var(--surface-card)] text-[var(--accent-text)]" : "bg-[var(--accent)] text-white"
        )}
        title={isPlaying ? 'Pausar' : 'Reproduzir'}
      >
        {isPlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
      </button>

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <input
          type="range"
          min={0}
          max={safeDuration}
          step={0.1}
          value={Math.min(currentTime, safeDuration)}
          onChange={handleSeek}
          className={cn("w-full h-1 accent-current cursor-pointer", own ? "text-white" : "text-[var(--accent-text)]")}
        />
        <span className={cn("text-[10px] font-bold tabular-nums", own ? "text-white/80" : "text-[var(--text-tertiary)]")}>
          {formatTime(currentTime)} / {formatTime(safeDuration)}
        </span>
      </div>

      <button
        type="button"
        onClick={cycleSpeed}
        className={cn(
          "shrink-0 px-2 py-1 rounded-lg text-[10px] font-black transition-all",
          own ? "bg-white/15 text-white hover:bg-white/25" : "bg-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--text-tertiary)]"
        )}
        title="Velocidade de reprodução"
      >
        {SPEEDS[speedIndex]}x
      </button>

      <a
        href={src}
        download={name || 'audio.webm'}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition-all",
          own ? "text-white/80 hover:bg-white/15" : "text-[var(--text-tertiary)] hover:bg-[var(--border-default)]"
        )}
        title="Baixar áudio"
      >
        <Download size={14} />
      </a>
    </div>
  );
}
