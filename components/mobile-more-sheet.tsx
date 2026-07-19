'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { X, ChevronDown, Sun, Moon, LogOut, Database, Download, Share } from 'lucide-react';
import { useApp } from '@/app/app-context';
import { useTheme } from '@/app/theme-provider';
import { UserRole } from '@/lib/types';
import { getNavItems, getUserPermissions, filterVisibleNavItems } from '@/lib/nav-items';
import { usePwaInstall } from '@/lib/pwa-install';
import { cn } from '@/lib/utils';
import { ChangePasswordModal } from './change-password-modal';

interface MobileMoreSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function MobileMoreSheet({ isOpen, onClose }: MobileMoreSheetProps) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    currentUser,
    setCurrentUser,
    userStatus,
    userStatusReason,
    lunchSecondsRemaining,
    absenceReasons,
    setUserStatus,
    whatsappStatus,
    dbStatus
  } = useApp();
  const { theme, toggleTheme } = useTheme();

  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [showIosInstallHint, setShowIosInstallHint] = useState(false);
  const { canInstall, isIOS, isStandalone, promptInstall } = usePwaInstall();

  const isTeam = [UserRole.ADMIN, UserRole.SUPPORT, UserRole.INTERNAL].includes(currentUser?.role as UserRole);

  const navItems = useMemo(
    () => getNavItems(currentUser, () => { setIsPasswordModalOpen(true); onClose(); }),
    [currentUser, onClose]
  );
  const userPermissions = useMemo(() => getUserPermissions(currentUser), [currentUser]);
  const visibleItems = useMemo(
    () => filterVisibleNavItems(navItems, userPermissions),
    [navItems, userPermissions]
  );

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.error('Erro ao efetuar logout no servidor:', e);
    }
    localStorage.setItem('omni_session_active', 'false');
    setCurrentUser(null);
    router.push('/login');
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[300] md:hidden">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            className="absolute bottom-0 inset-x-0 max-h-[85vh] bg-[var(--surface-card)] rounded-t-[2rem] shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="p-5 border-b border-[var(--border-default)] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent-text)] font-black text-sm overflow-hidden shrink-0">
                  {currentUser?.avatarUrl ? (
                    <img src={currentUser.avatarUrl} alt={currentUser.name} className="w-full h-full object-cover" />
                  ) : (
                    (currentUser?.name || 'U').charAt(0)
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--text-primary)] truncate">{currentUser?.name}</p>
                  <p className="text-[10px] text-[var(--text-tertiary)] font-medium truncate">{currentUser?.email}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-xl text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] transition-all shrink-0"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {isTeam && (
                <div className="rounded-2xl border border-[var(--border-default)] overflow-hidden">
                  <button
                    onClick={() => setIsStatusOpen(!isStatusOpen)}
                    className="w-full px-4 py-3 flex items-center justify-between bg-[var(--surface-pill)]/40"
                  >
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-2.5 h-2.5 rounded-full",
                        userStatus === 'online' ? "bg-[var(--text-success)]" :
                        userStatus === 'away' ? "bg-[var(--text-warning-strong)]" : "bg-[var(--text-tertiary)]"
                      )} />
                      <span className="text-xs font-black uppercase text-[var(--text-secondary)] tracking-tight">
                        {userStatus === 'online' ? 'Disponível' :
                         userStatus === 'away' ? `Ausente${userStatusReason ? ` > ${userStatusReason}` : ''}${
                           userStatusReason === 'Almoço' && lunchSecondsRemaining !== null
                             ? ` (${formatCountdown(lunchSecondsRemaining)})`
                             : ''
                         }` : 'Offline'}
                      </span>
                    </div>
                    <ChevronDown size={16} className={cn("transition-transform text-[var(--text-tertiary)]", isStatusOpen && "rotate-180")} />
                  </button>
                  {isStatusOpen && (
                    <div className="p-2 border-t border-[var(--border-default)] space-y-1">
                      <button
                        onClick={() => { setUserStatus('online'); setIsStatusOpen(false); }}
                        className="w-full px-4 py-2.5 text-left rounded-xl hover:bg-[var(--surface-pill)] flex items-center gap-2"
                      >
                        <div className="w-2 h-2 rounded-full bg-[var(--text-success)]" />
                        <span className="text-[11px] font-semibold uppercase text-[var(--text-secondary)] tracking-widest">Disponível</span>
                      </button>
                      {absenceReasons.map(reason => (
                        <button
                          key={reason.id}
                          onClick={() => { setUserStatus('away', reason.label); setIsStatusOpen(false); }}
                          className="w-full px-4 py-2.5 text-left rounded-xl hover:bg-[var(--surface-pill)] flex items-center gap-2"
                        >
                          <div className="w-1.5 h-1.5 rounded-full bg-[var(--border-alert)]" />
                          <span className="text-[11px] font-medium text-[var(--text-tertiary)]">{reason.label}</span>
                        </button>
                      ))}
                      <button
                        onClick={() => { setUserStatus('offline'); setIsStatusOpen(false); }}
                        className="w-full px-4 py-2.5 text-left rounded-xl hover:bg-[var(--surface-pill)] flex items-center gap-2 border-t border-[var(--border-default)] mt-1 pt-2.5"
                      >
                        <div className="w-2 h-2 rounded-full bg-[var(--text-tertiary)]" />
                        <span className="text-[11px] font-semibold uppercase text-[var(--text-secondary)] tracking-widest">Offline</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {isTeam && (
                <div className="flex items-center justify-between px-4 py-3 rounded-2xl border border-[var(--border-default)]">
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-2.5 h-2.5 rounded-full",
                      whatsappStatus === 'connected' ? "bg-[var(--text-success)]" :
                      whatsappStatus === 'disconnected' ? "bg-[var(--text-danger)]" : "bg-[var(--text-warning-strong)]"
                    )} />
                    <span className="text-xs font-black uppercase text-[var(--text-secondary)] tracking-tight">
                      {whatsappStatus === 'connected' ? 'Canais OK' : whatsappStatus === 'disconnected' ? 'Canais OFF' : 'Conectando...'}
                    </span>
                  </div>
                  <Database size={16} className={cn(
                    dbStatus === 'connected' ? "text-[var(--text-success)]" :
                    dbStatus === 'error' ? "text-[var(--text-danger)]" : "text-[var(--text-tertiary)]"
                  )} />
                </div>
              )}

              <button
                onClick={toggleTheme}
                className="w-full flex items-center justify-between px-4 py-3 rounded-2xl border border-[var(--border-default)]"
              >
                <span className="text-xs font-black uppercase text-[var(--text-secondary)] tracking-tight">
                  {theme === 'dark' ? 'Modo Escuro' : 'Modo Claro'}
                </span>
                {theme === 'dark' ? <Moon size={18} className="text-[var(--text-tertiary)]" /> : <Sun size={18} className="text-[var(--text-tertiary)]" />}
              </button>

              {!isStandalone && (canInstall || isIOS) && (
                <div className="rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 overflow-hidden">
                  <button
                    onClick={() => (canInstall ? promptInstall() : setShowIosInstallHint(!showIosInstallHint))}
                    className="w-full flex items-center justify-between px-4 py-3"
                  >
                    <span className="flex items-center gap-2 text-xs font-black uppercase text-[var(--accent-text)] tracking-tight">
                      <Download size={16} />
                      Instalar App
                    </span>
                    {isIOS && !canInstall && (
                      <ChevronDown size={16} className={cn("transition-transform text-[var(--accent-text)]", showIosInstallHint && "rotate-180")} />
                    )}
                  </button>
                  {isIOS && !canInstall && showIosInstallHint && (
                    <p className="px-4 pb-3 text-[11px] text-[var(--text-tertiary)] font-medium leading-relaxed flex items-center gap-1.5 flex-wrap">
                      Toque em <Share size={13} className="inline text-[var(--accent-text)]" /> Compartilhar e depois em &quot;Adicionar à Tela de Início&quot;.
                    </p>
                  )}
                </div>
              )}

              <div className="pt-2 space-y-1">
                {visibleItems.map(item => {
                  const isActive = item.href ? (pathname === item.href || pathname.startsWith(item.href + '/')) : false;

                  if (!item.subItems) {
                    return (
                      <Link
                        key={item.name}
                        href={item.href!}
                        onClick={onClose}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold transition-all",
                          isActive ? "bg-[var(--accent)]/10 text-[var(--accent-text)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-pill)]"
                        )}
                      >
                        <item.icon size={18} />
                        {item.name}
                      </Link>
                    );
                  }

                  const isOpenSection = openSection === item.name;
                  return (
                    <div key={item.name} className="rounded-2xl overflow-hidden">
                      <button
                        onClick={() => setOpenSection(isOpenSection ? null : item.name)}
                        className="w-full flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all"
                      >
                        <span className="flex items-center gap-3">
                          <item.icon size={18} />
                          {item.name}
                        </span>
                        <ChevronDown size={16} className={cn("transition-transform", isOpenSection && "rotate-180")} />
                      </button>
                      {isOpenSection && (
                        <div className="pl-6 py-1 space-y-1">
                          {item.subItems.map(sub => sub.action ? (
                            <button
                              key={sub.name}
                              onClick={() => { sub.action?.(); }}
                              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-semibold text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] transition-all"
                            >
                              <sub.icon size={16} />
                              {sub.name}
                            </button>
                          ) : (
                            <Link
                              key={sub.name}
                              href={sub.href!}
                              onClick={onClose}
                              className={cn(
                                "flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all",
                                sub.href && pathname === sub.href ? "bg-[var(--accent)]/10 text-[var(--accent-text)]" : "text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)]"
                              )}
                            >
                              <sub.icon size={16} />
                              {sub.name}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold text-[var(--text-danger)] hover:bg-[var(--surface-danger)] transition-all"
              >
                <LogOut size={18} />
                Sair
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {isPasswordModalOpen && <ChangePasswordModal isOpen={isPasswordModalOpen} onClose={() => setIsPasswordModalOpen(false)} />}
    </AnimatePresence>
  );
}
