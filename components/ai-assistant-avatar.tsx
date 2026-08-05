'use client';

import React, { useId } from 'react';

interface AiAssistantAvatarProps {
  size?: number;
  className?: string;
}

// Ícone do Agente de IA — personagem vetorial própria (não é a imagem de
// referência enviada pelo usuário: não temos ferramenta de geração de
// imagem, então recriamos a mesma linguagem visual — headset, cabelo escuro
// com mecha teal, olhos grandes — como SVG animável em CSS puro).
// Cada instância recebe um sufixo de gradiente único (useId) porque o
// widget pode montar duas ao mesmo tempo (botão flutuante + cabeçalho do
// painel) e ids de <defs> colidindo fariam a segunda instância "roubar" o
// gradiente da primeira.
export function AiAssistantAvatar({ size = 40, className }: AiAssistantAvatarProps) {
  const s = useId().replace(/[:]/g, '');

  return (
    <div className={className} style={{ width: size, height: size, lineHeight: 0 }}>
      <style>{`
        .aiav-eyelid-${s} { transform-box: fill-box; transform-origin: center; animation: aiav-blink-${s} 4.8s ease-in-out infinite; }
        .aiav-eyelid-right-${s} { animation-delay: 0.04s; }
        @keyframes aiav-blink-${s} {
          0%, 88%, 100% { transform: scaleY(0.02); }
          90% { transform: scaleY(1); }
          92% { transform: scaleY(0.02); }
          93.5% { transform: scaleY(1); }
          95% { transform: scaleY(0.02); }
        }
        .aiav-head-${s} { transform-box: fill-box; transform-origin: 50% 88%; animation: aiav-sway-${s} 6.4s ease-in-out infinite; }
        @keyframes aiav-sway-${s} {
          0% { transform: rotate(-1.6deg) translateY(0px); }
          50% { transform: rotate(1.6deg) translateY(-1.1px); }
          100% { transform: rotate(-1.6deg) translateY(0px); }
        }
        .aiav-strand1-${s} { transform-box: fill-box; transform-origin: top center; animation: aiav-strand1-${s} 5.2s ease-in-out infinite; }
        .aiav-strand2-${s} { transform-box: fill-box; transform-origin: top center; animation: aiav-strand2-${s} 6.1s ease-in-out infinite; }
        .aiav-strand3-${s} { transform-box: fill-box; transform-origin: top center; animation: aiav-strand3-${s} 4.4s ease-in-out infinite; }
        @keyframes aiav-strand1-${s} { 0% { transform: rotate(-2.2deg); } 50% { transform: rotate(2deg); } 100% { transform: rotate(-2.2deg); } }
        @keyframes aiav-strand2-${s} { 0% { transform: rotate(2deg); } 50% { transform: rotate(-2.4deg); } 100% { transform: rotate(2deg); } }
        @keyframes aiav-strand3-${s} { 0% { transform: rotate(-0.8deg); } 50% { transform: rotate(0.8deg); } 100% { transform: rotate(-0.8deg); } }
        .aiav-mouth-${s} { transform-box: fill-box; transform-origin: center; animation: aiav-smile-${s} 6.4s ease-in-out infinite; }
        @keyframes aiav-smile-${s} { 0%, 100% { transform: scaleX(1); } 50% { transform: scaleX(1.035); } }
        @media (prefers-reduced-motion: reduce) {
          .aiav-eyelid-${s}, .aiav-head-${s}, .aiav-strand1-${s}, .aiav-strand2-${s}, .aiav-strand3-${s}, .aiav-mouth-${s} {
            animation: none;
          }
        }
      `}</style>
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
        <defs>
          <radialGradient id={`bgGrad-${s}`} cx="50%" cy="38%" r="75%">
            <stop offset="0%" stopColor="#212d38" />
            <stop offset="100%" stopColor="#0a0f14" />
          </radialGradient>
          <linearGradient id={`hairGrad-${s}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3c2b22" />
            <stop offset="100%" stopColor="#150f0d" />
          </linearGradient>
          <linearGradient id={`hairTipGrad-${s}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#150f0d" />
            <stop offset="100%" stopColor="#28c9c2" />
          </linearGradient>
          <linearGradient id={`skinGrad-${s}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffd9ba" />
            <stop offset="100%" stopColor="#f0b78c" />
          </linearGradient>
          <radialGradient id={`eyeGrad-${s}`} cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#7ff2ea" />
            <stop offset="100%" stopColor="#0e8fa0" />
          </radialGradient>
        </defs>

        <circle cx="50" cy="50" r="50" fill={`url(#bgGrad-${s})`} />

        <g className={`aiav-head-${s}`}>
          <path d="M18,58 C14,39 22,16 50,15 C78,16 86,39 82,58 C86,76 80,96 68,101 L32,101 C20,96 14,76 18,58 Z" fill={`url(#hairGrad-${s})`} />

          <path d="M28,101 C28,87 37,81 50,81 C63,81 72,87 72,101 Z" fill="#222a32" />

          <ellipse cx="50" cy="50" rx="17.5" ry="19.5" fill={`url(#skinGrad-${s})`} />

          <ellipse cx="37" cy="57" rx="4" ry="2.3" fill="#ff9a86" opacity="0.32" />
          <ellipse cx="63" cy="57" rx="4" ry="2.3" fill="#ff9a86" opacity="0.32" />

          <path d="M38,41.5 Q43,38.3 48,40.5" stroke="#2a1c16" strokeWidth="1.7" fill="none" strokeLinecap="round" />
          <path d="M52,40.5 Q57,38.3 62,41.5" stroke="#2a1c16" strokeWidth="1.7" fill="none" strokeLinecap="round" />

          <g>
            <circle cx="41" cy="49.5" r="5.1" fill={`url(#eyeGrad-${s})`} />
            <circle cx="42.3" cy="50.6" r="2.3" fill="#0b1a1d" />
            <circle cx="39.6" cy="47.9" r="0.9" fill="#ffffff" />
            <ellipse className={`aiav-eyelid-${s}`} cx="41" cy="49.5" rx="6.1" ry="6.6" fill={`url(#skinGrad-${s})`} />
          </g>
          <g>
            <circle cx="59" cy="49.5" r="5.1" fill={`url(#eyeGrad-${s})`} />
            <circle cx="60.3" cy="50.6" r="2.3" fill="#0b1a1d" />
            <circle cx="57.6" cy="47.9" r="0.9" fill="#ffffff" />
            <ellipse className={`aiav-eyelid-${s} aiav-eyelid-right-${s}`} cx="59" cy="49.5" rx="6.1" ry="6.6" fill={`url(#skinGrad-${s})`} />
          </g>

          <path d="M50,54 q1.1,2 -0.8,3" stroke="#caa07c" strokeWidth="1" fill="none" opacity="0.55" strokeLinecap="round" />

          <path className={`aiav-mouth-${s}`} d="M43.5,63 Q50,67.6 56.5,63" stroke="#8a4a45" strokeWidth="2" fill="none" strokeLinecap="round" />

          <g className={`aiav-strand3-${s}`}>
            <path d="M40,20 C46,16.5 54,16.5 60,20 C58,26.5 54,29.5 50,29.5 C46,29.5 42,26.5 40,20 Z" fill={`url(#hairGrad-${s})`} />
          </g>

          <g className={`aiav-strand1-${s}`}>
            <path d="M23,43 C16,54 13,70 17,90 C19,96.5 25,99.5 29,98.5 C25,88 23,70 26,55 C27,50 25,46 23,43 Z" fill={`url(#hairGrad-${s})`} />
            <path d="M19,79 C18,87 20,93.5 26,97 C23,90 22,84 22,79 Z" fill={`url(#hairTipGrad-${s})`} opacity="0.9" />
          </g>

          <g className={`aiav-strand2-${s}`}>
            <path d="M77,43 C84,53 87,68 83,87 C81,94 75,98 71,97 C75,87 77,70 75,56 C74,51 75,47 77,43 Z" fill={`url(#hairGrad-${s})`} />
            <path d="M81,80 C82,88 80,94.5 74,98 C77,91 78,85 78,80 Z" fill={`url(#hairTipGrad-${s})`} opacity="0.9" />
          </g>

          <path d="M22,38 C19,19 34,7 50,7 C66,7 81,19 78,38" stroke="#11171c" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <circle cx="78.5" cy="39.5" r="3.4" fill="#11171c" />
          <path d="M78.5,42.5 C77.5,50 72,58 64,61" stroke="#11171c" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <ellipse cx="63" cy="62" rx="2.7" ry="1.9" fill={`url(#eyeGrad-${s})`} />
        </g>
      </svg>
    </div>
  );
}
