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

  const own = !!isOwnMessage;

  console.log(`[AudioPlayer] Rendering: name="${name}" srcLength=${src?.length ?? 0} srcPrefix="${(src || '').slice(0, 40)}"`);

  if (!src) {
    console.error(`[AudioPlayer] Rendered without a valid src — attachment url is empty. name="${name}"`);
    return (
      <div className={cn(
        "flex items-center gap-2 rounded-xl p-2.5 w-full text-xs font-bold",
        own ? "bg-white/10 text-white/70" : "bg-slate-50 border border-slate-200 text-slate-400"
      )}>
        Áudio indisponível
      </div>
    );
  }

  return (
    <div className={cn(
      "flex items-center gap-2 rounded-xl p-2.5 w-full",
      own ? "bg-white/10" : "bg-slate-50 border border-slate-200"
    )}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
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
          "shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all",
          own ? "bg-white text-indigo-600" : "bg-indigo-600 text-white"
        )}
        title={isPlaying ? 'Pausar' : 'Reproduzir'}
      >
        {isPlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
      </button>

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={handleSeek}
          className={cn("w-full h-1 accent-current cursor-pointer", own ? "text-white" : "text-indigo-600")}
        />
        <span className={cn("text-[10px] font-bold tabular-nums", own ? "text-white/80" : "text-slate-400")}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      <button
        type="button"
        onClick={cycleSpeed}
        className={cn(
          "shrink-0 px-2 py-1 rounded-lg text-[10px] font-black transition-all",
          own ? "bg-white/15 text-white hover:bg-white/25" : "bg-slate-200 text-slate-600 hover:bg-slate-300"
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
          "shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all",
          own ? "text-white/80 hover:bg-white/15" : "text-slate-400 hover:bg-slate-200"
        )}
        title="Baixar áudio"
      >
        <Download size={14} />
      </a>
    </div>
  );
}
