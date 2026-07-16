'use client';

import React, { useState, Suspense } from 'react';
import { Sidebar } from '@/components/sidebar';
import { Bell, Check, Clock, MessageCircle, Ticket, ChevronDown, Sun, Moon } from 'lucide-react';
import { useApp } from '@/app/app-context';
import { useTheme } from '@/app/theme-provider';
import { usePathname, useRouter } from 'next/navigation';
import { NewTicketModal } from '@/components/new-ticket-modal';
import { ChatWidget } from '@/components/chat-widget';
import { ForcePasswordChange } from '@/components/force-password-change';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { UserRole } from '@/lib/types';

function stripNotificationHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
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
    return <div className="min-h-screen bg-slate-50 dark:bg-[var(--surface-card)] flex items-center justify-center font-bold text-slate-400 dark:text-[var(--text-tertiary)]">Carregando...</div>;
  }

  if (!authInitialized) {
    return <div className="min-h-screen bg-slate-50 dark:bg-[var(--surface-card)] flex items-center justify-center font-bold text-slate-400 dark:text-[var(--text-tertiary)]">Verificando sessão...</div>;
  }

  if (!currentUser) {
    return null;
  }

  const unreadCount = notifications.filter(n => !n.read).length;
  const isTeam = [UserRole.ADMIN, UserRole.SUPPORT, UserRole.INTERNAL].includes(currentUser.role as UserRole);
  const getNotificationIcon = (type: string) => {
    if (type.startsWith('chat_')) return <MessageCircle size={14} />;
    if (type === 'ticket_closed') return <Check size={14} />;
    return <Ticket size={14} />;
  };
  const getNotificationColor = (type: string) => {
    if (type.startsWith('chat_')) return 'bg-green-100 dark:bg-[var(--surface-success)] text-green-600 dark:text-[var(--text-success)]';
    if (type === 'ticket_closed') return 'bg-emerald-100 dark:bg-[var(--surface-success)] text-emerald-600 dark:text-[var(--text-success)]';
    return 'bg-indigo-100 dark:bg-[var(--accent)]/20 text-indigo-600 dark:text-[var(--accent-text)]';
  };
  return (
    <div className="flex bg-gray-50 dark:bg-[var(--surface-page)] min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 bg-white dark:bg-[var(--surface-card)] border-b border-slate-200 dark:border-[var(--border-default)] flex items-center justify-between px-8 shadow-sm sticky top-0 z-[100]">
<div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-slate-800 dark:text-[var(--text-primary)] tracking-tight">Portal OmniSupport</h1>
            <div className="h-4 w-px bg-slate-300 dark:bg-[var(--text-tertiary)]"></div>
            <span className="text-sm text-slate-500 dark:text-[var(--text-tertiary)] font-medium">Logado como: {currentUser?.name}</span>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4 text-slate-400 dark:text-[var(--text-tertiary)] border-l pl-6 ml-2">
              {isTeam && (
                <div className="relative">
                  <button 
                    onClick={() => setIsStatusMenuOpen(!isStatusMenuOpen)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 dark:bg-[var(--surface-card)] rounded-full border border-slate-100 dark:border-[var(--border-default)] hover:bg-slate-100 dark:hover:bg-[var(--surface-pill)] transition-all cursor-pointer"
                  >
                    <div className={cn(
                      "w-2.5 h-2.5 rounded-full",
                      userStatus === 'online' ? "bg-emerald-500 dark:bg-[var(--text-success)] shadow-[0_0_8px_rgba(16,185,129,0.5)]" : 
                      userStatus === 'away' ? "bg-amber-500 dark:bg-[var(--text-warning-strong)]" : "bg-slate-400 dark:bg-[var(--text-tertiary)]"
                    )} />
                    <span className="text-[10px] font-black uppercase tracking-tighter text-slate-500 dark:text-[var(--text-tertiary)]">
                      {userStatus === 'online' ? 'Disponível' : 
                       userStatus === 'away' ? `Ausente ${userStatusReason ? `> ${userStatusReason}` : ''}` : 'Offline'}
                    </span>
                    <ChevronDown size={10} className={cn("transition-transform", isStatusMenuOpen && "rotate-180")} />
                  </button>

                  {isStatusMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setIsStatusMenuOpen(false)} />
                      <div className="absolute top-full mt-2 w-48 bg-white dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-2xl shadow-xl z-50 overflow-hidden py-1 animate-in fade-in slide-in-from-top-2">
                        <button 
                          onClick={() => { setUserStatus('online'); setIsStatusMenuOpen(false); }}
                          className="w-full px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] flex items-center gap-2 transition-all border-b border-slate-100 dark:border-[var(--border-default)]"
                        >
                          <div className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-[var(--text-success)] shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
                          <span className="text-[10px] font-black uppercase text-slate-600 dark:text-[var(--text-secondary)] tracking-widest">Disponível</span>
                        </button>

                        <div className="px-4 pt-3 pb-1 text-[9px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] bg-slate-50/50 dark:bg-[var(--surface-card)]/50 flex justify-between items-center">
                          <span>Motivos de Ausência</span>
                          {absenceReasons.length > 5 && <span className="text-[8px] opacity-40 lowercase font-normal italic">Role para ver mais</span>}
                        </div>
                        <div className="py-1 max-h-[250px] overflow-y-auto custom-scrollbar">
                          {absenceReasons.length === 0 ? (
                            <div className="px-4 py-2 text-[10px] text-slate-400 dark:text-[var(--text-tertiary)] italic">Nenhum motivo configurado</div>
                          ) : (
                            absenceReasons.map(reason => (
                              <button 
                                key={reason.id}
                                onClick={() => { setUserStatus('away', reason.label); setIsStatusMenuOpen(false); }}
                                className={cn(
                                  "w-full px-6 py-2 text-left hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] flex items-center gap-2 transition-all group",
                                  userStatusReason === reason.label && "bg-amber-50 dark:bg-[var(--surface-warning)]"
                                )}
                              >
                                <div className={cn(
                                  "w-1.5 h-1.5 rounded-full",
                                  userStatusReason === reason.label ? "bg-amber-500 dark:bg-[var(--text-warning-strong)]" : "bg-amber-200 group-hover:bg-amber-500 dark:group-hover:bg-[var(--text-warning-strong)]"
                                )} />
                                <span className={cn(
                                  "text-[10px] font-bold tracking-tight",
                                  userStatusReason === reason.label ? "text-amber-600 dark:text-[var(--text-warning)]" : "text-slate-500 dark:text-[var(--text-tertiary)]"
                                )}>
                                  {reason.label}
                                </span>
                              </button>
                            ))
                          )}
                        </div>

                        <button 
                          onClick={() => { setUserStatus('offline'); setIsStatusMenuOpen(false); }}
                          className="w-full px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] flex items-center gap-2 transition-all border-t border-slate-100 dark:border-[var(--border-default)]"
                        >
                          <div className="w-2 h-2 rounded-full bg-slate-400 dark:bg-[var(--text-tertiary)]" />
                          <span className="text-[10px] font-black uppercase text-slate-600 dark:text-[var(--text-secondary)] tracking-widest">Offline</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {isTeam && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 dark:bg-[var(--surface-card)] rounded-full border border-slate-100 dark:border-[var(--border-default)] group cursor-default">
                  <div className={cn(
                    "w-2.5 h-2.5 rounded-full animate-pulse",
                    whatsappStatus === 'connected' ? "bg-emerald-500 dark:bg-[var(--text-success)] shadow-[0_0_8px_rgba(16,185,129,0.5)]" : 
                    whatsappStatus === 'disconnected' ? "bg-red-500 dark:bg-[var(--text-danger)]" : "bg-amber-500 dark:bg-[var(--text-warning-strong)]"
                  )} />
                  <span className="text-[10px] font-black uppercase tracking-tighter text-slate-500 dark:text-[var(--text-tertiary)]">
                    {whatsappStatus === 'connected' ? 'Canais OK' : 
                    whatsappStatus === 'disconnected' ? 'Canais OFF' : 'Conectando...'}
                  </span>
                </div>
              )}
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg transition-all hover:text-slate-600 dark:hover:text-[var(--text-secondary)] hover:bg-slate-50 dark:hover:bg-[var(--surface-card)]"
                title={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
              >
                {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
              </button>
              <div className="relative">
                <button
                  onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                  className={cn(
                    "relative p-2 rounded-lg transition-all",
                    isNotificationsOpen ? "bg-slate-100 dark:bg-[var(--surface-pill)] text-indigo-600 dark:text-[var(--accent-text)]" : "hover:text-slate-600 dark:hover:text-[var(--text-secondary)] hover:bg-slate-50 dark:hover:bg-[var(--surface-card)]"
                  )}
                >
                  <Bell size={20} />
                  {unreadCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 dark:bg-[var(--text-danger)] text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white">
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
                    <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-2xl shadow-2xl z-[120] overflow-hidden transform origin-top-right transition-all animate-in fade-in zoom-in-95 duration-200">
                      <div className="p-4 border-b border-slate-100 dark:border-[var(--border-default)] flex items-center justify-between bg-slate-50/50 dark:bg-[var(--surface-card)]/50">
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-800 dark:text-[var(--text-primary)]">Notificações</h3>
                        <button 
                          onClick={() => {
                            notifications.forEach(n => markNotificationRead(n.id));
                          }}
                          className="text-[9px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] hover:text-red-500 dark:hover:text-[var(--text-danger)] transition-all flex items-center gap-1"
                        >
                          <Check size={10} /> Marcar Lidas
                        </button>
                      </div>
                      <div className="max-h-[400px] overflow-y-auto">
                        {notifications.length === 0 ? (
                          <div className="p-10 text-center text-slate-400 dark:text-[var(--text-tertiary)]">
                            <Bell size={32} className="mx-auto mb-3 opacity-20" />
                            <p className="text-xs font-bold">Nenhuma notificação</p>
                          </div>
                        ) : (
                          notifications.map(notif => (
                            <div 
                              key={notif.id}
                              onClick={() => {
                                markNotificationRead(notif.id);
                                setIsNotificationsOpen(false);
                              }}
                              className={cn(
                                "p-4 border-b border-slate-50 dark:border-[var(--border-default)] hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] transition-all cursor-pointer relative group",
                                !notif.read && "bg-indigo-50/30 dark:bg-[var(--accent)]/10"
                              )}
                            >
                              <div className="flex items-start gap-3">
                                <div className={cn(
                                  "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                                  getNotificationColor(notif.type)
                                )}>
                                  {getNotificationIcon(notif.type)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px] font-bold text-slate-800 dark:text-[var(--text-primary)] truncate">{notif.title}</p>
                                  <p className="text-[10px] text-slate-500 dark:text-[var(--text-tertiary)] mt-0.5 line-clamp-2">{stripNotificationHtml(notif.message)}</p>
                                  <div className="flex items-center gap-1.5 mt-2 text-[9px] text-slate-400 dark:text-[var(--text-tertiary)] font-medium">
                                    <Clock size={10} />
                                    {new Date(notif.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </div>
                                </div>
                                {!notif.read && (
                                  <div className="w-2 h-2 rounded-full bg-indigo-500 dark:bg-[var(--accent)] shrink-0 mt-1" />
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="p-3 bg-slate-50 dark:bg-[var(--surface-card)] text-center border-t border-slate-100 dark:border-[var(--border-default)]">
                        <Link 
                          href="/activities" 
                          onClick={() => setIsNotificationsOpen(false)}
                          className="text-[10px] font-black uppercase text-indigo-600 dark:text-[var(--accent-text)] hover:text-indigo-700 dark:hover:text-[var(--accent-text)] tracing-widest block w-full py-1"
                        >
                          Ver todas as atividades
                        </Link>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>
        <main className="flex-1 p-8 overflow-y-auto">
          <Suspense fallback={null}>
            {children}
          </Suspense>
        </main>
        <NewTicketModal />
        <ChatWidget />
      </div>
      <ForcePasswordChange />
    </div>
  );
}
