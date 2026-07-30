'use client';

// Página secreta de lançamento — só existe pra ser acessada digitando a URL
// diretamente, não tem link em lugar nenhum. É descartável: pra remover
// depois, basta apagar esta pasta (app/login/new/) e a entrada '/login/new'
// em PUBLIC_PATHS (middleware.ts). Reaproveita a tela de login real
// (LoginPage) por baixo do pano/fita — não duplica nada do formulário.
import React, { useEffect, useState } from 'react';
import { Scissors } from 'lucide-react';
import LoginPage from '../page';

interface ConfettiPiece {
  id: number;
  color: string;
  tx: number;
  ty: number;
  rot: number;
  delay: number;
  duration: number;
  size: number;
  round: boolean;
}

const CONFETTI_COLORS = ['#F43F5E', '#FBBF24', '#34D399', '#60A5FA', '#A78BFA', '#F472B6', '#ffffff', '#F97316'];

function generateConfetti(): ConfettiPiece[] {
  return Array.from({ length: 90 }, (_, i) => {
    const angle = Math.random() * Math.PI * 2;
    const radius = 100 + Math.random() * 320;
    return {
      id: i,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      tx: Math.cos(angle) * radius,
      ty: Math.sin(angle) * radius * 0.45,
      rot: (360 + Math.random() * 720) * (Math.random() > 0.5 ? 1 : -1),
      delay: Math.random() * 0.2,
      duration: 2.6 + Math.random() * 1.6,
      size: 6 + Math.random() * 7,
      round: Math.random() > 0.5,
    };
  });
}

export default function SecretLaunchPage() {
  const [cutting, setCutting] = useState(false);
  const [curtainOpen, setCurtainOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [confetti, setConfetti] = useState<ConfettiPiece[]>([]);

  // Confete some sozinho depois de cair — independente do pano/fita, senão
  // ficaria cortado no meio da queda quando o overlay principal desmonta.
  useEffect(() => {
    if (confetti.length === 0) return;
    const timer = setTimeout(() => setConfetti([]), 4200);
    return () => clearTimeout(timer);
  }, [confetti]);

  const handleCut = () => {
    if (cutting) return;
    setCutting(true);
    setConfetti(generateConfetti());
    setTimeout(() => setCurtainOpen(true), 350);
    setTimeout(() => setRevealed(true), 350 + 900);
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      <style>{`
        @keyframes secretlaunch-confetti {
          0% { transform: translate(-50%, -50%) translate(0px, 0px) rotate(0deg); opacity: 1; }
          20% { transform: translate(-50%, -50%) translate(var(--tx), var(--ty)) rotate(calc(var(--rot) * 0.25)); opacity: 1; }
          100% { transform: translate(-50%, -50%) translate(var(--tx), calc(var(--ty) + 62vh)) rotate(var(--rot)); opacity: 0; }
        }
      `}</style>

      {/* Login real por baixo — borrado/escurecido até a fita ser cortada,
          reforça o "pano" de cima (se a cortina tiver qualquer brecha, o
          conteúdo embaixo ainda não fica legível). */}
      <div
        className="transition-all ease-in-out"
        style={{
          filter: revealed ? 'blur(0px) brightness(1)' : 'blur(28px) brightness(0.55)',
          transitionDuration: '900ms',
        }}
      >
        <LoginPage />
      </div>

      {/* Confete — camada própria, sobrevive ao fechamento do overlay
          principal e nunca bloqueia clique no login revelado. */}
      {confetti.length > 0 && (
        <div className="fixed inset-0 z-[60] pointer-events-none overflow-hidden">
          {confetti.map((p) => (
            <span
              key={p.id}
              className="absolute"
              style={{
                left: '50%',
                top: '45%',
                width: p.size,
                height: p.round ? p.size : p.size * 1.8,
                backgroundColor: p.color,
                borderRadius: p.round ? '50%' : '2px',
                animation: `secretlaunch-confetti ${p.duration}s ease-out ${p.delay}s forwards`,
                ['--tx' as any]: `${p.tx}px`,
                ['--ty' as any]: `${p.ty}px`,
                ['--rot' as any]: `${p.rot}deg`,
              }}
            />
          ))}
        </div>
      )}

      {!revealed && (
        <div className="fixed inset-0 z-50" aria-hidden={cutting}>
          {/* Lona/cortina — dois painéis com dobras + barra de "varão" no
              topo, se abrem pros lados revelando o login. */}
          <div
            className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-br from-[var(--accent)] to-[#062B52] transition-transform duration-[900ms] ease-in-out shadow-2xl"
            style={{
              transform: curtainOpen ? 'translateX(-100%)' : 'translateX(0)',
              backgroundImage:
                'repeating-linear-gradient(100deg, rgba(0,0,0,0.12) 0px, rgba(0,0,0,0.12) 10px, rgba(255,255,255,0.05) 10px, rgba(255,255,255,0.05) 26px, transparent 26px, transparent 40px)',
            }}
          >
            <div className="absolute top-0 inset-x-0 h-6 bg-black/25 shadow-inner" />
          </div>
          <div
            className="absolute inset-y-0 right-0 w-1/2 bg-gradient-to-bl from-[var(--accent)] to-[#062B52] transition-transform duration-[900ms] ease-in-out shadow-2xl"
            style={{
              transform: curtainOpen ? 'translateX(100%)' : 'translateX(0)',
              backgroundImage:
                'repeating-linear-gradient(80deg, rgba(0,0,0,0.12) 0px, rgba(0,0,0,0.12) 10px, rgba(255,255,255,0.05) 10px, rgba(255,255,255,0.05) 26px, transparent 26px, transparent 40px)',
            }}
          >
            <div className="absolute top-0 inset-x-0 h-6 bg-black/25 shadow-inner" />
          </div>

          {/* Fita de inauguração + laço grande + tesoura — clique corta */}
          {!curtainOpen && (
            <button
              type="button"
              onClick={handleCut}
              title="Cortar a fita"
              className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-16 flex items-center justify-center outline-none"
            >
              <span
                className="absolute left-0 h-5 bg-[#c81e3a] shadow-lg transition-all duration-500 ease-in"
                style={{
                  width: '50%',
                  transformOrigin: 'left center',
                  transform: cutting ? 'translateY(120px) rotate(12deg)' : 'translateY(0) rotate(0deg)',
                }}
              />
              <span
                className="absolute right-0 h-5 bg-[#c81e3a] shadow-lg transition-all duration-500 ease-in"
                style={{
                  width: '50%',
                  transformOrigin: 'right center',
                  transform: cutting ? 'translateY(120px) rotate(-12deg)' : 'translateY(0) rotate(0deg)',
                }}
              />

              {/* Laço grande, centralizado sobre a fita */}
              <svg
                viewBox="0 0 220 150"
                className="relative z-10 w-56 h-40 sm:w-72 sm:h-52 drop-shadow-2xl transition-all duration-500 ease-in"
                style={{
                  transform: cutting ? 'translateY(140px) rotate(20deg) scale(0.8)' : 'translateY(0) rotate(0deg) scale(1)',
                  opacity: cutting ? 0 : 1,
                }}
              >
                {/* rabichos */}
                <path d="M100,84 L74,146 L96,138 L104,92 Z" fill="#a3162e" />
                <path d="M120,84 L146,146 L124,138 L116,92 Z" fill="#a3162e" />
                {/* laço esquerdo */}
                <path d="M110,75 C60,5 8,18 8,58 C8,98 62,98 110,75 Z" fill="#e0293f" />
                <path d="M110,75 C75,30 30,32 8,58 C30,90 75,92 110,75 Z" fill="#ff5b70" opacity="0.35" />
                {/* laço direito */}
                <path d="M110,75 C160,5 212,18 212,58 C212,98 158,98 110,75 Z" fill="#c81e3a" />
                <path d="M110,75 C145,30 190,32 212,58 C190,90 145,92 110,75 Z" fill="#ff5b70" opacity="0.25" />
                {/* nó central */}
                <circle cx="110" cy="76" r="19" fill="#a3162e" />
                <circle cx="110" cy="76" r="19" fill="#ffffff" opacity="0.08" />
              </svg>

              <Scissors
                size={40}
                className={`absolute z-20 text-white drop-shadow-lg transition-transform duration-500 ${!cutting ? 'animate-pulse' : ''}`}
                style={{
                  transform: cutting
                    ? 'translateX(110px) rotate(45deg) scale(0.9)'
                    : 'translateX(-10px) rotate(0deg) scale(1)',
                }}
              />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
