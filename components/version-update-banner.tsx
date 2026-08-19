'use client';

import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, Sparkles } from 'lucide-react';

// Diferente de um toast comum (sonner) de propósito: some sozinho não serve
// aqui — o usuário só decide atualizar quando quiser, então o aviso fica
// fixo na tela até o clique em "Atualizar agora" (sem botão de fechar). Por
// isso é maior, com borda/ícone de destaque, em vez de discreto como uma
// notificação passageira. Ver app-context.tsx para a detecção de versão.
export function VersionUpdateBanner({ visible, onUpdate }: { visible: boolean; onUpdate: () => void }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.95 }}
          transition={{ type: 'spring', damping: 22, stiffness: 260 }}
          className="fixed bottom-6 right-6 z-[500] w-[calc(100vw-3rem)] max-w-sm"
        >
          <div className="bg-[var(--surface-card)] border-2 border-[var(--accent)] rounded-3xl shadow-2xl shadow-black/20 p-5 flex items-start gap-4">
            <div className="w-11 h-11 rounded-2xl bg-[var(--accent)] text-white flex items-center justify-center shrink-0 animate-pulse">
              <Sparkles size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-[var(--text-primary)] tracking-tight">Nova versão disponível</p>
              <p className="text-xs text-[var(--text-tertiary)] font-medium mt-0.5 mb-3 leading-relaxed">
                Termine o que estiver fazendo — quando puder, atualize a página para usar a versão mais recente.
              </p>
              <button
                onClick={onUpdate}
                className="flex items-center gap-2 bg-[var(--accent)] text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest shadow-md hover:bg-[var(--accent-hover)] transition-all"
              >
                <RefreshCw size={13} /> Atualizar agora
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
