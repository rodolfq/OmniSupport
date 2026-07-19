'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Ticket, MessageSquare, Users, MoreHorizontal, UserCircle } from 'lucide-react';
import { useApp } from '@/app/app-context';
import { Permission, UserRole } from '@/lib/types';
import { getUserPermissions } from '@/lib/nav-items';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { MobileMoreSheet } from './mobile-more-sheet';

interface TabItem {
  name: string;
  icon: typeof LayoutDashboard;
  href: string;
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const { currentUser, isOmniChatOpen } = useApp();
  const isMobileViewport = useIsMobile();
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  const userPermissions = useMemo(() => getUserPermissions(currentUser), [currentUser]);
  const isCustomer = [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser?.role as UserRole);

  const tabs: TabItem[] = useMemo(() => {
    if (isCustomer) {
      return [
        { name: 'Chamados', icon: UserCircle, href: '/my-tickets' },
        { name: 'Chat', icon: MessageSquare, href: '/chat' },
        ...(currentUser?.role === UserRole.CUSTOMER ? [{ name: 'Empresa', icon: Users, href: '/customers' }] : []),
      ];
    }

    const items: TabItem[] = [];
    if (userPermissions.includes(Permission.DASHBOARD_VIEW)) {
      items.push({ name: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' });
    }
    if (userPermissions.includes(Permission.TICKETS_READ)) {
      items.push({ name: 'Chamados', icon: Ticket, href: '/tickets' });
    }
    items.push({ name: 'Chat', icon: MessageSquare, href: '/chat' });
    return items;
  }, [isCustomer, currentUser?.role, userPermissions]);

  // O chat em tela cheia no celular (ver isMobileFullScreen em chat-widget.tsx)
  // cobre a tela inteira — a bottom nav precisa sumir por completo enquanto
  // ele estiver aberto, tanto para não ficar por cima do composer (mesmo
  // z-index, ordem de DOM decidiria o empate a favor da nav) quanto porque,
  // como no WhatsApp/Telegram, uma conversa aberta não convive com tabs de
  // navegação — voltar é o botão de minimizar do próprio cabeçalho do chat.
  if (isMobileViewport && isOmniChatOpen) return null;

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-[200] bg-[var(--surface-card)] border-t border-[var(--border-default)] flex items-stretch shadow-[0_-4px_16px_rgba(0,0,0,0.06)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {tabs.map(tab => {
          const isActive = pathname === tab.href || pathname.startsWith(tab.href + '/');
          return (
            <Link
              key={tab.name}
              href={tab.href}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-1 py-2.5 min-h-[56px] transition-all",
                isActive ? "text-[var(--accent-text)]" : "text-[var(--text-tertiary)]"
              )}
            >
              <tab.icon size={22} />
              <span className="text-[9px] font-bold uppercase tracking-tight">{tab.name}</span>
            </Link>
          );
        })}
        <button
          onClick={() => setIsMoreOpen(true)}
          className={cn(
            "flex-1 flex flex-col items-center justify-center gap-1 py-2.5 min-h-[56px] transition-all",
            isMoreOpen ? "text-[var(--accent-text)]" : "text-[var(--text-tertiary)]"
          )}
        >
          <MoreHorizontal size={22} />
          <span className="text-[9px] font-bold uppercase tracking-tight">Mais</span>
        </button>
      </nav>

      <MobileMoreSheet isOpen={isMoreOpen} onClose={() => setIsMoreOpen(false)} />
    </>
  );
}
