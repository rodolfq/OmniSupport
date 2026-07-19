'use client';

import React, { useState, Suspense } from 'react';
import { Sidebar } from '@/components/sidebar';
import { Bell, ChevronDown, Sun, Moon } from 'lucide-react';
import { useApp } from '@/app/app-context';
import { useTheme } from '@/app/theme-provider';
import { usePathname, useRouter } from 'next/navigation';
import { NewTicketModal } from '@/components/new-ticket-modal';
import { ChatWidget } from '@/components/chat-widget';
import { ForcePasswordChange } from '@/components/force-password-change';
import { MobileHeader } from '@/components/mobile-header';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { NotificationPanel } from '@/components/notification-panel';
import { cn } from '@/lib/utils';
import { UserRole } from '@/lib/types';

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { 
    currentUser,
    authInitialized,
    notifications, 
    markNotificationRead, 
    whatsappStatus,
    userStatus,
    userStatusReason,
    lunchSecondsRemaining,
    absenceReasons,
    setUserStatus
  } = useApp();
  const { theme, toggleTheme } = useTheme();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!currentUser && authInitialized) {
      router.replace('/login');
    }
  }, [currentUser, authInitialized, router]);

  // Redirect users without dashboard permission to their default screen
  React.useEffect(() => {
    if (currentUser && authInitialized) {
      const isCompanyUser = [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser.role as UserRole);
      const isTeamUser = [UserRole.ADMIN, UserRole.SUPPORT, UserRole.INTERNAL].includes(currentUser.role as UserRole);

      if (isCompanyUser && pathname === '/dashboard') {
        router.replace('/my-tickets');
      } else if (!isTeamUser && pathname === '/dashboard') {
        router.replace('/my-tickets');
      } else if (currentUser.role === UserRole.INTERNAL && pathname === '/dashboard') {
        router.replace('/internal-tickets');
      }
    }
  }, [currentUser, authInitialized, pathname, router]);

  if (!mounted) {
    return <div className="min-h-screen bg-[var(--surface-page)] flex items-center justify-center font-medium text-[var(--text-tertiary)]">Carregando...</div>;
  }

  if (!authInitialized) {
    return <div className="min-h-screen bg-[var(--surface-page)] flex items-center justify-center font-medium text-[var(--text-tertiary)]">Verificando sessão...</div>;
  }

  if (!currentUser) {
    return null;
  }

  const unreadCount = notifications.filter(n => !n.read).length;
  const isTeam = [UserRole.ADMIN, UserRole.SUPPORT, UserRole.INTERNAL].includes(currentUser.role as UserRole);
  return (
    <div className="flex bg-[var(--surface-page)] min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <MobileHeader />
        <header className="hidden md:flex h-16 bg-[var(--surface-card)] border-b border-[var(--border-default)] items-center justify-between px-8 shadow-sm sticky top-0 z-[100]">
<div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold text-[var(--text-primary)] tracking-tight">Portal SSX Resolve</h1>
            <div className="h-4 w-px bg-[var(--border-default)]"></div>
            <span className="text-sm text-[var(--text-tertiary)] font-medium">Logado como: {currentUser?.name}</span>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4 text-[var(--text-tertiary)] border-l border-[var(--border-default)] pl-6 ml-2">
              {isTeam && (
                <div className="relative">
                  <button
                    onClick={() => setIsStatusMenuOpen(!isStatusMenuOpen)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-[var(--surface-pill)] rounded-full border border-[var(--border-default)] hover:bg-[var(--border-default)]/40 transition-all cursor-pointer"
                  >
                    <div className={cn(
                      "w-2.5 h-2.5 rounded-full",
                      userStatus === 'online' ? "bg-[var(--text-success)] shadow-[0_0_8px_rgba(16,185,129,0.5)]" :
                      userStatus === 'away' ? "bg-[var(--text-warning-strong)]" : "bg-[var(--text-tertiary)]"
                    )} />
                    <span className="text-[10px] font-semibold uppercase tracking-tighter text-[var(--text-tertiary)]">
                      {userStatus === 'online' ? 'Disponível' :
                       userStatus === 'away' ? `Ausente ${userStatusReason ? `> ${userStatusReason}` : ''}${
                         userStatusReason === 'Almoço' && lunchSecondsRemaining !== null
                           ? ` (${formatCountdown(lunchSecondsRemaining)})`
                           : ''
                       }` : 'Offline'}
                    </span>
                    <ChevronDown size={10} className={cn("transition-transform", isStatusMenuOpen && "rotate-180")} />
                  </button>

                  {isStatusMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setIsStatusMenuOpen(false)} />
                      <div className="absolute top-full mt-2 w-48 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-xl z-50 overflow-hidden py-1 animate-in fade-in slide-in-from-top-2">
                        <button
                          onClick={() => { setUserStatus('online'); setIsStatusMenuOpen(false); }}
                          className="w-full px-4 py-2 text-left hover:bg-[var(--surface-pill)] flex items-center gap-2 transition-all border-b border-[var(--border-default)]"
                        >
                          <div className="w-2 h-2 rounded-full bg-[var(--text-success)] shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
                          <span className="text-[10px] font-semibold uppercase text-[var(--text-secondary)] tracking-widest">Disponível</span>
                        </button>

                        <div className="px-4 pt-3 pb-1 text-[9px] font-semibold uppercase text-[var(--text-tertiary)] bg-[var(--surface-pill)]/50 flex justify-between items-center">
                          <span>Motivos de Ausência</span>
                          {absenceReasons.length > 5 && <span className="text-[8px] opacity-40 lowercase font-normal italic">Role para ver mais</span>}
                        </div>
                        <div className="py-1 max-h-[250px] overflow-y-auto custom-scrollbar">
                          {absenceReasons.length === 0 ? (
                            <div className="px-4 py-2 text-[10px] text-[var(--text-tertiary)] italic">Nenhum motivo configurado</div>
                          ) : (
                            absenceReasons.map(reason => (
                              <button
                                key={reason.id}
                                onClick={() => { setUserStatus('away', reason.label); setIsStatusMenuOpen(false); }}
                                className={cn(
                                  "w-full px-6 py-2 text-left hover:bg-[var(--surface-pill)] flex items-center gap-2 transition-all group",
                                  userStatusReason === reason.label && "bg-[var(--surface-warning)]"
                                )}
                              >
                                <div className={cn(
                                  "w-1.5 h-1.5 rounded-full",
                                  userStatusReason === reason.label ? "bg-[var(--text-warning-strong)]" : "bg-[var(--border-alert)] group-hover:bg-[var(--text-warning-strong)]"
                                )} />
                                <span className={cn(
                                  "text-[10px] font-medium tracking-tight",
                                  userStatusReason === reason.label ? "text-[var(--text-warning)]" : "text-[var(--text-tertiary)]"
                                )}>
                                  {reason.label}
                                </span>
                              </button>
                            ))
                          )}
                        </div>

                        <button
                          onClick={() => { setUserStatus('offline'); setIsStatusMenuOpen(false); }}
                          className="w-full px-4 py-2 text-left hover:bg-[var(--surface-pill)] flex items-center gap-2 transition-all border-t border-[var(--border-default)]"
                        >
                          <div className="w-2 h-2 rounded-full bg-[var(--text-tertiary)]" />
                          <span className="text-[10px] font-semibold uppercase text-[var(--text-secondary)] tracking-widest">Offline</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {isTeam && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--surface-pill)] rounded-full border border-[var(--border-default)] group cursor-default">
                  <div className={cn(
                    "w-2.5 h-2.5 rounded-full animate-pulse",
                    whatsappStatus === 'connected' ? "bg-[var(--text-success)] shadow-[0_0_8px_rgba(16,185,129,0.5)]" :
                    whatsappStatus === 'disconnected' ? "bg-[var(--text-danger)]" : "bg-[var(--text-warning-strong)]"
                  )} />
                  <span className="text-[10px] font-semibold uppercase tracking-tighter text-[var(--text-tertiary)]">
                    {whatsappStatus === 'connected' ? 'Canais OK' :
                    whatsappStatus === 'disconnected' ? 'Canais OFF' : 'Conectando...'}
                  </span>
                </div>
              )}
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg transition-all hover:text-[var(--text-secondary)] hover:bg-[var(--surface-pill)]"
                title={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
              >
                {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
              </button>
              <div className="relative">
                <button
                  onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                  className={cn(
                    "relative p-2 rounded-lg transition-all",
                    isNotificationsOpen ? "bg-[var(--surface-pill)] text-[var(--accent-text)]" : "hover:text-[var(--text-secondary)] hover:bg-[var(--surface-pill)]"
                  )}
                >
                  <Bell size={20} />
                  {unreadCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-[var(--text-danger)] text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-[var(--surface-card)]">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {isNotificationsOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-[110]"
                      onClick={() => setIsNotificationsOpen(false)}
                    />
                    <div className="absolute right-0 mt-2 w-80 max-h-[520px] bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-2xl z-[120] overflow-hidden transform origin-top-right transition-all animate-in fade-in zoom-in-95 duration-200">
                      <NotificationPanel
                        notifications={notifications}
                        onMarkRead={markNotificationRead}
                        onItemClick={() => setIsNotificationsOpen(false)}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-8 pb-24 md:pb-8 overflow-y-auto">
          <Suspense fallback={null}>
            {children}
          </Suspense>
        </main>
        <NewTicketModal />
        <ChatWidget />
        <MobileBottomNav />
      </div>
      <ForcePasswordChange />
    </div>
  );
}
