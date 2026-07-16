'use client';

import React from 'react';
import { useApp } from '@/app/app-context';
import { Bell, Clock, Search, Filter, Check, Lock, MessageCircle, MessageSquare, Ticket, UserPlus, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { UserRole } from '@/lib/types';

function stripHtml(value: string) {
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

export default function ActivitiesPage() {
  const { currentUser, notifications, markNotificationRead, clearNotifications } = useApp();
  const isCompanyUser = [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser?.role as UserRole);

  const getIcon = (type: string) => {
    switch (type) {
      case 'ticket_new': return <Ticket size={18} />;
      case 'ticket_assigned': return <UserPlus size={18} />;
      case 'ticket_update': return <Clock size={18} />;
      case 'ticket_closed': return <CheckCircle2 size={18} />;
      case 'chat_new': return <MessageSquare size={18} />;
      case 'chat_message': return <MessageCircle size={18} />;
      default: return <Bell size={18} />;
    }
  };

  const getColor = (type: string) => {
    if (type.startsWith('chat_')) return "bg-green-100 dark:bg-[var(--surface-success)] text-green-600 dark:text-[var(--text-success)]";
    if (type === 'ticket_closed') return "bg-emerald-100 dark:bg-[var(--surface-success)] text-emerald-600 dark:text-[var(--text-success)]";
    if (type === 'ticket_new') return "bg-indigo-100 dark:bg-[var(--accent)]/20 text-indigo-600 dark:text-[var(--accent-text)]";
    return "bg-slate-100 dark:bg-[var(--surface-pill)] text-slate-600 dark:text-[var(--text-secondary)]";
  };

  const getTargetHref = (notif: { type: string; targetId?: string }) => {
    if (!notif.targetId) return '#';
    if (notif.type.startsWith('chat_')) return `${isCompanyUser ? '/my-tickets' : '/dashboard'}?chat=${notif.targetId}`;
    return `${isCompanyUser ? '/my-tickets' : '/dashboard'}?ticket=${notif.targetId}`;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-800 dark:text-[var(--text-primary)] uppercase tracking-tight">Atividades e Notificações</h1>
          <p className="text-sm font-medium text-slate-500 dark:text-[var(--text-tertiary)] mt-1">Histórico completo de eventos do seu portal.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => markNotificationRead('all')}
            className="px-4 py-2 bg-white dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-xl text-xs font-bold text-slate-600 dark:text-[var(--text-secondary)] hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] transition-all flex items-center gap-2"
          >
            <Check size={14} /> Marcar tudo como lido
          </button>
          <button 
            onClick={clearNotifications}
            className="px-4 py-2 bg-red-50 dark:bg-[var(--surface-danger)] text-red-600 dark:text-[var(--text-danger)] rounded-xl text-xs font-bold hover:bg-red-100 dark:hover:bg-[var(--surface-danger)] transition-all"
          >
            Limpar Histórico
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-[var(--surface-card)] rounded-[2.5rem] shadow-xl border border-slate-200 dark:border-[var(--border-default)] overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-[var(--border-default)] bg-slate-50/50 dark:bg-[var(--surface-card)]/50 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <button className="text-[10px] font-black uppercase text-indigo-600 dark:text-[var(--accent-text)] border-b-2 border-indigo-600 dark:border-[var(--accent)] pb-1 tracking-widest">Todas</button>
            <button className="text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] hover:text-slate-600 dark:hover:text-[var(--text-secondary)] pb-1 tracking-widest transition-all">Não lidas</button>
            <button className="text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] hover:text-slate-600 dark:hover:text-[var(--text-secondary)] pb-1 tracking-widest transition-all">Tickets</button>
            <button className="text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] hover:text-slate-600 dark:hover:text-[var(--text-secondary)] pb-1 tracking-widest transition-all">Chats</button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[var(--text-tertiary)]" size={14} />
            <input 
              type="text" 
              placeholder="Filtrar atividade..."
              className="bg-white dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-xl py-1.5 pl-9 pr-4 text-xs font-medium focus:ring-4 focus:ring-indigo-500/10 dark:focus:ring-[var(--accent)]/10 outline-none w-64"
            />
          </div>
        </div>

        <div className="divide-y divide-slate-50 dark:divide-[var(--border-default)]">
          {notifications.length === 0 ? (
            <div className="py-20 text-center">
              <div className="w-16 h-16 bg-slate-50 dark:bg-[var(--surface-card)] rounded-3xl flex items-center justify-center text-slate-200 mx-auto mb-4">
                <Bell size={32} />
              </div>
              <h3 className="text-sm font-black text-slate-800 dark:text-[var(--text-primary)] uppercase tracking-tight">Sem atividades recentes</h3>
              <p className="text-xs text-slate-400 dark:text-[var(--text-tertiary)] font-medium mt-1">Tudo o que acontecer no portal aparecerá aqui.</p>
            </div>
          ) : (
            notifications.map((notif) => (
              <div 
                key={notif.id}
                onClick={() => markNotificationRead(notif.id)}
                className={cn(
                  "p-6 flex items-start gap-4 hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] transition-all cursor-pointer group relative",
                  !notif.read && "bg-indigo-50/20 dark:bg-[var(--accent)]/10"
                )}
              >
                {!notif.read && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500 dark:bg-[var(--accent)]" />
                )}
                <div className={cn(
                  "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm",
                  getColor(notif.type)
                )}>
                  {getIcon(notif.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-sm font-black text-slate-800 dark:text-[var(--text-primary)] uppercase tracking-tight">{notif.title}</h4>
                    <span className="text-[10px] font-bold text-slate-400 dark:text-[var(--text-tertiary)] uppercase">
                      {new Date(notif.timestamp).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-slate-500 dark:text-[var(--text-tertiary)] leading-relaxed max-w-2xl">{stripHtml(notif.message)}</p>
                  
                  <div className="mt-4 flex items-center gap-4">
                     {notif.targetId && (
                       <Link 
                        href={getTargetHref(notif)}
                        className="text-[10px] font-black uppercase text-indigo-600 dark:text-[var(--accent-text)] hover:underline tracking-widest"
                       >
                         Visualizar Registro
                       </Link>
                     )}
                     {!notif.read && (
                        <button className="text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] hover:text-indigo-600 dark:hover:text-[var(--accent-text)] tracking-widest">
                          Marcar como lido
                        </button>
                     )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
