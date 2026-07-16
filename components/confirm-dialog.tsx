"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
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
  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="relative bg-white dark:bg-[var(--surface-card)] rounded-2xl shadow-2xl p-6 w-full max-w-sm"
          >
            <div className="flex items-start gap-4 mb-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${variant === 'danger' ? 'bg-red-100 dark:bg-[var(--surface-danger)]' : 'bg-amber-100 dark:bg-[var(--surface-warning)]'}`}>
                <AlertTriangle size={20} className={variant === 'danger' ? 'text-red-600 dark:text-[var(--text-danger)]' : 'text-amber-600 dark:text-[var(--text-warning)]'} />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-800 dark:text-[var(--text-primary)]">{title}</h3>
                {description && <p className="text-sm text-slate-500 dark:text-[var(--text-tertiary)] mt-1">{description}</p>}
              </div>
            </div>
            
            <div className="flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-slate-600 dark:text-[var(--text-secondary)] hover:bg-slate-100 dark:hover:bg-[var(--surface-pill)] transition-all text-sm font-bold"
              >
                {cancelLabel}
              </button>
              <button
                onClick={handleConfirm}
                className={`px-4 py-2 rounded-lg text-white font-bold text-sm transition-all ${
                  variant === 'danger' 
                    ? 'bg-red-500 dark:bg-[var(--text-danger)] hover:bg-red-600 dark:hover:bg-[var(--text-danger)]' 
                    : 'bg-amber-500 dark:bg-[var(--text-warning-strong)] hover:bg-amber-600 dark:hover:bg-[var(--accent-warning-hover)]'
                }`}
              >
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