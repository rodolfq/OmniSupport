"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, AlertTriangle, Loader2 } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  // Se devolver uma Promise, o diálogo fica aberto com o botão em "carregando"
  // até ela terminar — assim quem clicou vê que a ação já está em andamento (e
  // não clica de novo). Callback síncrono (void) fecha na hora, como antes.
  onConfirm: () => unknown;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
}

export function ConfirmDialog({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title, 
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'default'
}: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    if (loading) return;
    const result = onConfirm();
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      setLoading(true);
      try {
        await result;
      } catch (err) {
        console.error('[ConfirmDialog] Falha na ação confirmada:', err);
      } finally {
        setLoading(false);
      }
    }
    onClose();
  };

  const handleClose = () => {
    if (!loading) onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="relative bg-[var(--surface-card)] rounded-2xl shadow-2xl p-6 w-full max-w-sm"
          >
            <div className="flex items-start gap-4 mb-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${variant === 'danger' ? 'bg-[var(--surface-danger)]' : 'bg-[var(--surface-warning)]'}`}>
                <AlertTriangle size={20} className={variant === 'danger' ? 'text-[var(--text-danger)]' : 'text-[var(--text-warning)]'} />
              </div>
              <div>
                <h3 className="text-lg font-black text-[var(--text-primary)]">{title}</h3>
                {description && <p className="text-sm text-[var(--text-tertiary)] mt-1">{description}</p>}
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={handleClose}
                disabled={loading}
                className="px-4 py-2 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all text-sm font-bold disabled:opacity-50"
              >
                {cancelLabel}
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading}
                className={`px-4 py-2 rounded-lg text-white font-bold text-sm transition-all flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed ${
                  variant === 'danger'
                    ? 'bg-[var(--text-danger)] hover:bg-[var(--text-danger)]'
                    : 'bg-[var(--text-warning-strong)] hover:bg-[var(--accent-warning-hover)]'
                }`}
              >
                {loading && <Loader2 size={14} className="animate-spin" />}
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// Hook para usar o diálogo de confirmação
export function useConfirm() {
  const [isOpen, setIsOpen] = useState(false);
  const [resolve, setResolve] = useState<(value: boolean) => void>();

  const confirm = (title: string, description?: string): Promise<boolean> => {
    setIsOpen(true);
    return new Promise((res) => setResolve(() => res));
  };

  const handleConfirm = () => {
    resolve?.(true);
    setIsOpen(false);
  };

  const handleCancel = () => {
    resolve?.(false);
    setIsOpen(false);
  };

  return { isOpen, confirm, onConfirm: handleConfirm, onCancel: handleCancel };
}