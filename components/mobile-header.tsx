'use client';

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bell } from 'lucide-react';
import { useApp } from '@/app/app-context';
import { NotificationPanel } from './notification-panel';

export function MobileHeader() {
  const { currentUser, notifications, markNotificationRead } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <>
      <header
        className="md:hidden h-14 bg-[var(--surface-card)] border-b border-[var(--border-default)] flex items-center justify-between px-4 sticky top-0 z-[100]"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <img src="/branding/icon.png" alt="SSX Resolve" className="w-7 h-7 object-contain shrink-0" draggable={false} />
          <span className="text-sm font-black text-[var(--text-primary)] tracking-tight truncate">SSX Resolve</span>
        </div>
        <button
          onClick={() => setIsOpen(true)}
          className="relative p-2 rounded-xl text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] transition-all"
        >
          <Bell size={20} />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 bg-[var(--text-danger)] text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-[var(--surface-card)]">
              {unreadCount}
            </span>
          )}
        </button>
      </header>

      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[300] md:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="absolute bottom-0 inset-x-0 h-[80vh] bg-[var(--surface-card)] rounded-t-[2rem] shadow-2xl overflow-hidden"
            >
              <NotificationPanel
                notifications={notifications}
                onMarkRead={markNotificationRead}
                onItemClick={() => setIsOpen(false)}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
