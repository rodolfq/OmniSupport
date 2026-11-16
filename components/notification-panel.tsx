'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, CalendarClock, Check, Clock, Link2, MessageCircle, Rocket, Ticket } from 'lucide-react';
import type { AppNotification } from '@/app/app-context';
import { useApp, getNotificationTargetHref } from '@/app/app-context';
import { UserRole } from '@/lib/types';
import { cn, stripNotificationHtml } from '@/lib/utils';

function getNotificationIcon(type: string) {
  if (type === 'hotfix_overdue') return <Rocket size={14} />;
  if (type === 'calendar_event') return <CalendarClock size={14} />;
  if (type.startsWith('chat_')) return <MessageCircle size={14} />;
  if (type === 'ticket_closed') return <Check size={14} />;
  if (type.startsWith('internal_ticket_')) return <Link2 size={14} />;
  return <Ticket size={14} />;
}

function getNotificationColor(type: string) {
  if (type === 'hotfix_overdue') return 'bg-[var(--surface-danger)] text-[var(--text-danger)]';
  if (type === 'calendar_event') return 'bg-[var(--accent)]/15 text-[var(--accent-text)]';
  if (type.startsWith('chat_')) return 'bg-[var(--surface-success)] text-[var(--text-success)]';
  if (type === 'ticket_closed') return 'bg-[var(--surface-success)] text-[var(--text-success)]';
  if (type.startsWith('internal_ticket_')) return 'bg-[var(--surface-warning)] text-[var(--text-warning)]';
  return 'bg-[var(--accent)]/15 text-[var(--accent-text)]';
}

interface NotificationPanelProps {
  notifications: AppNotification[];
  onMarkRead: (id: string) => void;
  onItemClick?: () => void;
}

// Corpo da lista de notificações, compartilhado entre o dropdown desktop
// (app/(portal)/layout.tsx) e o bottom-sheet mobile (mobile-header.tsx) —
// cada um só fornece o container/posicionamento ao redor.
export function NotificationPanel({ notifications, onMarkRead, onItemClick }: NotificationPanelProps) {
  const { currentUser } = useApp();
  const router = useRouter();
  const isCompanyUser = [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser?.role as UserRole);

  const handleItemClick = (notif: AppNotification) => {
    onMarkRead(notif.id);
    if (notif.type === 'calendar_event' && notif.meta?.eventUrl) {
      // Sem página própria no SSX Desk — o destino é o link do evento/reunião
      // do Google, externo, então abre numa aba nova em vez de navegar.
      window.open(notif.meta.eventUrl, '_blank', 'noopener,noreferrer');
    } else {
      const href = getNotificationTargetHref(notif, isCompanyUser);
      if (href) router.push(href);
    }
    onItemClick?.();
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-4 border-b border-[var(--border-default)] flex items-center justify-between bg-[var(--surface-pill)]/50 shrink-0">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-primary)]">Notificações</h3>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="p-10 text-center text-[var(--text-tertiary)]">
            <Bell size={32} className="mx-auto mb-3 opacity-20" />
            <p className="text-xs font-medium">Nenhuma notificação</p>
          </div>
        ) : (
          notifications.map(notif => (
            <div
              key={notif.id}
              onClick={() => handleItemClick(notif)}
              className={cn(
                "p-4 border-b border-[var(--border-default)] hover:bg-[var(--surface-pill)] transition-all cursor-pointer relative group",
                !notif.read && "bg-[var(--accent)]/5"
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
                  <p className="text-[11px] font-semibold text-[var(--text-primary)] truncate">{notif.title}</p>
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5 line-clamp-2">{stripNotificationHtml(notif.message)}</p>
                  <div className="flex items-center gap-1.5 mt-2 text-[9px] text-[var(--text-tertiary)] font-medium">
                    <Clock size={10} />
                    {new Date(notif.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                {!notif.read && (
                  <div className="w-2 h-2 rounded-full bg-[var(--accent)] shrink-0 mt-1" />
                )}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="p-3 bg-[var(--surface-pill)]/50 text-center border-t border-[var(--border-default)] shrink-0">
        <Link
          href="/activities"
          onClick={onItemClick}
          className="text-[10px] font-semibold uppercase text-[var(--accent-text)] hover:opacity-80 tracking-widest block w-full py-1"
        >
          Ver todas as atividades
        </Link>
      </div>
    </div>
  );
}
