'use client';

import React, { useState, Suspense } from 'react';
import { Sidebar } from '@/components/sidebar';
import { Search, Bell, HelpCircle, Plus, Check, Clock, Trash2, Ticket, ChevronDown } from 'lucide-react';
import { useApp } from '@/app/app-context';
import { useRouter } from 'next/navigation';
import { NewTicketModal } from '@/components/new-ticket-modal';
import { ChatWidget } from '@/components/chat-widget';
import { ForcePasswordChange } from '@/components/force-password-change';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { UserRole } from '@/lib/types';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { 
    currentUser,
    authInitialized,
    setIsNewTicketModalOpen, 
    notifications, 
    markNotificationRead, 
    clearNotifications,
    whatsappStatus,
    userStatus,
    userStatusReason,
    absenceReasons,
    setUserStatus
  } = useApp();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center font-bold text-slate-400">Carregando...</div>;
  }

  if (!authInitialized) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center font-bold text-slate-400">Verificando sessão...</div>;
  }

  if (!currentUser) {
    router.push('/login');
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center font-bold text-slate-400">Redirecionando para login...</div>;
  }

  const unreadCount = notifications.filter(n => !n.read && !n.type.startsWith('chat_')).length;
  const isTeam = currentUser.role !== UserRole.CUSTOMER;

  return (
    <div className="flex bg-gray-50 min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shadow-sm sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-slate-800 tracking-tight">Portal OmniSupport</h1>
            <div className="h-4 w-px bg-slate-300"></div>
            <span className="text-sm text-slate-500 font-medium">Logado como: {currentUser?.name}</span>
          </div>
          <div className="flex items-center gap-6">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="text" 
                placeholder="Buscar ticket ou cliente..." 
                className="bg-slate-50 border border-slate-200 rounded-full py-2 px-10 text-sm w-80 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
              />
            </div>
            <button 
              onClick={() => setIsNewTicketModalOpen(true)}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-sm transition-colors cursor-pointer"
            >
              <Plus size={16} />
              Novo Chamado
            </button>
            <div className="flex items-center gap-4 text-slate-400 border-l pl-6 ml-2">
              {isTeam && (
                <div className="relative">
                  <button 
                    onClick={() => setIsStatusMenuOpen(!isStatusMenuOpen)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-full border border-slate-100 hover:bg-slate-100 transition-all cursor-pointer"
                  >
                    <div className={cn(
                      "w-2.5 h-2.5 rounded-full",
                      userStatus === 'online' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : 
                      userStatus === 'away' ? "bg-amber-500" : "bg-slate-400"
                    )} />
                    <span className="text-[10px] font-black uppercase tracking-tighter text-slate-500">
                      {userStatus === 'online' ? 'Disponível' : 
                       userStatus === 'away' ? `Ausente ${userStatusReason ? `> ${userStatusReason}` : ''}` : 'Offline'}
                    </span>
                    <ChevronDown size={10} className={cn("transition-transform", isStatusMenuOpen && "rotate-180")} />
                  </button>

                  {isStatusMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setIsStatusMenuOpen(false)} />
                      <div className="absolute top-full mt-2 w-48 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden py-1 animate-in fade-in slide-in-from-top-2">
                        <button 
                          onClick={() => { setUserStatus('online'); setIsStatusMenuOpen(false); }}
                          className="w-full px-4 py-2 text-left hover:bg-slate-50 flex items-center gap-2 transition-all border-b border-slate-100"
                        >
                          <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
                          <span className="text-[10px] font-black uppercase text-slate-600 tracking-widest">Disponível</span>
                        </button>

                        <div className="px-4 pt-3 pb-1 text-[9px] font-black uppercase text-slate-400 bg-slate-50/50 flex justify-between items-center">
                          <span>Motivos de AusÃªncia</span>
                          {absenceReasons.length > 5 && <span className="text-[8px] opacity-40 lowercase font-normal italic">Role para ver mais</span>}
                        </div>
                        <div className="py-1 max-h-[250px] overflow-y-auto custom-scrollbar">
                          {absenceReasons.length === 0 ? (
                            <div className="px-4 py-2 text-[10px] text-slate-400 italic">Nenhum motivo configurado</div>
                          ) : (
                            absenceReasons.map(reason => (
                              <button 
                                key={reason.id}
                                onClick={() => { setUserStatus('away', reason.label); setIsStatusMenuOpen(false); }}
                                className={cn(
                                  "w-full px-6 py-2 text-left hover:bg-slate-50 flex items-center gap-2 transition-all group",
                                  userStatusReason === reason.label && "bg-amber-50"
                                )}
                              >
                                <div className={cn(
                                  "w-1.5 h-1.5 rounded-full",
                                  userStatusReason === reason.label ? "bg-amber-500" : "bg-amber-200 group-hover:bg-amber-500"
                                )} />
                                <span className={cn(
                                  "text-[10px] font-bold tracking-tight",
                                  userStatusReason === reason.label ? "text-amber-600" : "text-slate-500"
                                )}>
                                  {reason.label}
                                </span>
                              </button>
                            ))
                          )}
                        </div>

                        <button 
                          onClick={() => { setUserStatus('offline'); setIsStatusMenuOpen(false); }}
                          className="w-full px-4 py-2 text-left hover:bg-slate-50 flex items-center gap-2 transition-all border-t border-slate-100"
                        >
                          <div className="w-2 h-2 rounded-full bg-slate-400" />
                          <span className="text-[10px] font-black uppercase text-slate-600 tracking-widest">Offline</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {isTeam && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-full border border-slate-100 group cursor-default">
                  <div className={cn(
                    "w-2.5 h-2.5 rounded-full animate-pulse",
                    whatsappStatus === 'connected' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : 
                    whatsappStatus === 'disconnected' ? "bg-red-500" : "bg-amber-500"
                  )} />
                  <span className="text-[10px] font-black uppercase tracking-tighter text-slate-500">
                    {whatsappStatus === 'connected' ? 'Canais OK' : 
                    whatsappStatus === 'disconnected' ? 'Canais OFF' : 'Conectando...'}
                  </span>
                </div>
              )}
              <div className="relative">
                <button 
                  onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                  className={cn(
                    "relative p-2 rounded-lg transition-all",
                    isNotificationsOpen ? "bg-slate-100 text-indigo-600" : "hover:text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <Bell size={20} />
                  {unreadCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {isNotificationsOpen && (
                  <>
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => setIsNotificationsOpen(false)} 
                    />
                    <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 overflow-hidden transform origin-top-right transition-all animate-in fade-in zoom-in-95 duration-200">
                      <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-800">NotificaÃ§Ãµes de chamados</h3>
                        <button 
                          onClick={() => {
                            notifications.filter(n => !n.type.startsWith('chat_')).forEach(n => markNotificationRead(n.id));
                          }}
                          className="text-[9px] font-black uppercase text-slate-400 hover:text-red-500 transition-all flex items-center gap-1"
                        >
                          <Check size={10} /> Marcar Lidas
                        </button>
                      </div>
                      <div className="max-h-[400px] overflow-y-auto">
                        {notifications.filter(n => !n.type.startsWith('chat_')).length === 0 ? (
                          <div className="p-10 text-center text-slate-400">
                            <Bell size={32} className="mx-auto mb-3 opacity-20" />
                            <p className="text-xs font-bold">Nenhuma notificaÃ§Ã£o de ticket</p>
                          </div>
                        ) : (
                          notifications.filter(n => !n.type.startsWith('chat_')).map(notif => (
                            <div 
                              key={notif.id}
                              onClick={() => {
                                markNotificationRead(notif.id);
                                setIsNotificationsOpen(false);
                              }}
                              className={cn(
                                "p-4 border-b border-slate-50 hover:bg-slate-50 transition-all cursor-pointer relative group",
                                !notif.read && "bg-indigo-50/30"
                              )}
                            >
                              <div className="flex items-start gap-3">
                                <div className={cn(
                                  "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                                  notif.type === 'ticket_closed' ? "bg-emerald-100 text-emerald-600" : "bg-indigo-100 text-indigo-600"
                                )}>
                                  {notif.type === 'ticket_closed' ? <Check size={14} /> : <Ticket size={14} />}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px] font-bold text-slate-800 truncate">{notif.title}</p>
                                  <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{notif.message}</p>
                                  <div className="flex items-center gap-1.5 mt-2 text-[9px] text-slate-400 font-medium">
                                    <Clock size={10} />
                                    {new Date(notif.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </div>
                                </div>
                                {!notif.read && (
                                  <div className="w-2 h-2 rounded-full bg-indigo-500 shrink-0 mt-1" />
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="p-3 bg-slate-50 text-center border-t border-slate-100">
                        <Link 
                          href="/activities" 
                          onClick={() => setIsNotificationsOpen(false)}
                          className="text-[10px] font-black uppercase text-indigo-600 hover:text-indigo-700 tracing-widest block w-full py-1"
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
