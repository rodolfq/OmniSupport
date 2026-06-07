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
          className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col"
        >
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600">
                <AlertTriangle size={20} />
              </div>
              <h3 className="font-bold text-slate-800">{title}</h3>
            </div>
            <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 transition-colors">
              <X size={20} />
            </button>
          </div>
          <div className="p-6">
            {error && (
               <div className="mb-4 bg-red-50 border border-red-200 text-red-600 rounded-xl p-4 text-sm font-medium">
                  {error}
               </div>
            )}
            <p className="text-slate-600">{message}</p>
          </div>
          <div className="p-6 bg-slate-50 flex gap-3 justify-end items-center border-t border-slate-100">
            <button
              onClick={onCancel}
              className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-200 bg-slate-100 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={onConfirm}
              className="px-4 py-2 font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-sm"
            >
              Confirmar ExclusÃ£o
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}


