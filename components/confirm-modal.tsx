'use client';

import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ isOpen, title, message, error, onConfirm, onCancel }: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white dark:bg-[var(--surface-card)] rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col"
        >
          <div className="p-6 border-b border-slate-100 dark:border-[var(--border-default)] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-[var(--surface-danger)] flex items-center justify-center text-red-600 dark:text-[var(--text-danger)]">
                <AlertTriangle size={20} />
              </div>
              <h3 className="font-bold text-slate-800 dark:text-[var(--text-primary)]">{title}</h3>
            </div>
            <button onClick={onCancel} className="text-slate-400 dark:text-[var(--text-tertiary)] hover:text-slate-600 dark:hover:text-[var(--text-secondary)] transition-colors">
              <X size={20} />
            </button>
          </div>
          <div className="p-6">
            {error && (
               <div className="mb-4 bg-red-50 dark:bg-[var(--surface-danger)] border border-red-200 dark:border-[var(--text-danger)]/30 text-red-600 dark:text-[var(--text-danger)] rounded-xl p-4 text-sm font-medium">
                  {error}
               </div>
            )}
            <p className="text-slate-600 dark:text-[var(--text-secondary)]">{message}</p>
          </div>
          <div className="p-6 bg-slate-50 dark:bg-[var(--surface-card)] flex gap-3 justify-end items-center border-t border-slate-100 dark:border-[var(--border-default)]">
            <button
              onClick={onCancel}
              className="px-4 py-2 font-semibold text-slate-600 dark:text-[var(--text-secondary)] hover:bg-slate-200 dark:hover:bg-[var(--border-default)] bg-slate-100 dark:bg-[var(--surface-pill)] rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={onConfirm}
              className="px-4 py-2 font-semibold text-white bg-red-600 dark:bg-[var(--text-danger)] hover:bg-red-700 rounded-lg transition-colors shadow-sm"
            >
              Confirmar Exclusão
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}


