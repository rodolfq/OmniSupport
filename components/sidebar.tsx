'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Permission, UserRole } from '@/lib/types';
import { UserService } from '@/lib/services/user-service';
import { 
   LayoutDashboard, 
   Ticket, 
   Users, 
   PieChart, 
   Settings, 
   LogOut, 
   Headset,
   ChevronRight,
   UserCog,
   Shield,
   MessageSquare,
   UserCircle,
   Key,
   MessageCircle,
   Library,
   Database,
   FileText,
   History
 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApp } from '@/app/app-context';

interface MenuItem {
  name: string;
  icon: any;
  href?: string;
  permission?: Permission;
  action?: () => void;
  subItems?: MenuItem[];
}
import { ChangePasswordModal } from './change-password-modal';

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser, setCurrentUser, userStatus, dbStatus } = useApp();

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

  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  const menuItems: MenuItem[] = useMemo(() => {
    const isCustomer = [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser?.role as UserRole);
    
    if (isCustomer) {
      return [
        { 
          name: 'Chamados', 
          icon: Ticket, 
          subItems: [
            { name: 'Meus Chamados', icon: UserCircle, href: '/my-tickets' },
          ]
        },
        { 
          name: 'Configurações', 
          icon: Settings, 
          href: '/settings',
          subItems: [
            { name: 'Perfil', icon: Settings, href: '/settings' },
            { name: 'Alterar Senha', icon: Key, action: () => setIsPasswordModalOpen(true) },
          ]
        },
      ];
    }

    return [
      { 
        name: 'Dashboard', 
        icon: LayoutDashboard, 
        permission: Permission.DASHBOARD_VIEW,
        subItems: [
          { name: 'Geral', icon: LayoutDashboard, href: '/dashboard', permission: Permission.DASHBOARD_VIEW },
          { name: 'Relatórios', icon: PieChart, href: '/reports', permission: Permission.REPORTS_READ },
        ]
      },
{ 
        name: 'Chamados', 
        icon: Ticket, 
        permission: Permission.TICKETS_READ,
        subItems: [
          { name: 'Todos os Chamados', icon: Ticket, href: '/tickets', permission: Permission.TICKETS_READ },
          { name: 'Meus Chamados', icon: UserCircle, href: '/my-tickets' },
          { name: 'Painel Chat', icon: MessageSquare, href: '/chat-management', permission: Permission.OUTSIDE_QUEUE_VIEW },
          { name: 'Histórico de Conversas', icon: History, href: '/chat-history', permission: Permission.TICKETS_READ },
          { name: 'Tickets Internos', icon: FileText, href: '/internal-tickets', permission: Permission.INTERNAL_TICKETS_VIEW },
        ]
      },
      { name: 'Chat Interno', icon: MessageCircle, href: '/chat-internal', permission: Permission.CHAT_INTERNAL_VIEW },
      { name: 'WhatsApp', icon: MessageSquare, href: '/whatsapp', permission: Permission.OUTSIDE_QUEUE_VIEW },
      { name: 'Clientes', icon: Users, href: '/customers', permission: Permission.CUSTOMERS_READ },
      { 
        name: 'Configurações', 
        icon: Settings, 
        href: '/settings',
        subItems: [
          { name: 'Geral', icon: Settings, href: '/settings', permission: Permission.SETTINGS_READ },
          { name: 'Equipe', icon: UserCog, href: '/team', permission: Permission.TEAM_READ },
          { name: 'Perfil de Acesso', icon: Shield, href: '/permissions', permission: Permission.SETTINGS_WRITE },
          { name: 'Filas', icon: Library, href: '/queues', permission: Permission.SETTINGS_WRITE },
          { name: 'Alterar Senha', icon: Key, action: () => setIsPasswordModalOpen(true) },
        ]
      },
    ];
  }, [currentUser]);

  const userPermissions = useMemo(() => {
    if (!currentUser) return [];
    // Super Admin bypass
    if (currentUser.role === UserRole.ADMIN) {
      return Object.values(Permission);
    }
    return UserService.getPermissionsByRole(currentUser.role);
  }, [currentUser]);

  return (
    <div className="w-20 bg-slate-900 flex flex-col items-center py-6 gap-8 border-r border-slate-800 shadow-xl h-screen sticky top-0 z-20">
      <div className="w-10 h-10 bg-indigo-500 rounded-lg flex items-center justify-center mb-4">
        <Headset size={24} className="text-white" />
      </div>

      <div className="flex-1 flex flex-col gap-4">
        {menuItems.map((item) => {
          // Check permission if required
          const hasPermission = !item.permission || userPermissions.includes(item.permission);
          
          if (!hasPermission) {
            // Check if any sub-item has permission
            if (item.subItems) {
              const hasVisibleSubItem = item.subItems.some(sub => !sub.permission || userPermissions.includes(sub.permission as Permission));
              if (!hasVisibleSubItem) return null;
            } else {
              return null;
            }
          }
          
          const hasSubItems = !!item.subItems;
          const isActive = pathname === item.href || (item.subItems?.some(s => s.href && pathname.startsWith(s.href))) || pathname.startsWith(item.href + '/');

          return (
            <div key={item.name} className="relative group/main">
              {hasSubItems ? (
                <button 
                  onClick={() => setOpenSubmenu(openSubmenu === item.name ? null : item.name)}
                  className={cn(
                    "p-3 rounded-xl transition-all relative",
                    isActive 
                      ? "bg-slate-800 text-indigo-400" 
                      : "text-slate-500 hover:bg-slate-800/50 hover:text-slate-300"
                  )}
                  title={item.name}
                >
                  <item.icon size={24} />
                  {isActive && (
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-indigo-500 rounded-l-full" />
                  )}
                </button>
              ) : (
                <Link 
                  href={item.href!}
                  title={item.name}
                  className={cn(
                    "p-3 rounded-xl transition-all relative block",
                    isActive 
                      ? "bg-slate-800 text-indigo-400" 
                      : "text-slate-500 hover:bg-slate-800/50 hover:text-slate-300"
                  )}
                >
                  <item.icon size={24} />
                  {isActive && (
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-indigo-500 rounded-l-full" />
                  )}
                </Link>
              )}

              {/* Submenu Flyout */}
              {hasSubItems && (
                <div className={cn(
                  "absolute left-full ml-2 top-0 bg-slate-900 border border-slate-800 rounded-2xl p-2 min-w-[180px] shadow-2xl transition-all scale-95 opacity-0 pointer-events-none group-hover/main:scale-100 group-hover/main:opacity-100 group-hover/main:pointer-events-auto z-50",
                  openSubmenu === item.name && "scale-100 opacity-100 pointer-events-auto"
                )}>
                  <div className="px-4 py-2 border-b border-slate-800 mb-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{item.name}</p>
                  </div>
                  {item.subItems?.map(sub => {
                    // Check sub-item permission
                    if (sub.permission && !userPermissions.includes(sub.permission as Permission)) return null;

                    const isSubActive = sub.href ? pathname === sub.href : false;

                    if (sub.action) {
                      return (
                        <button
                          key={sub.name}
                          onClick={() => {
                            sub.action?.();
                            setOpenSubmenu(null);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-all border-none outline-none"
                        >
                          <sub.icon size={16} />
                          {sub.name}
                        </button>
                      );
                    }

                    return (
                      <Link
                        key={sub.name}
                        href={sub.href!}
                        onClick={() => setOpenSubmenu(null)}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold transition-all",
                          isSubActive 
                            ? "bg-indigo-500/10 text-indigo-400" 
                            : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                        )}
                      >
                        <sub.icon size={16} />
                        {sub.name}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-auto flex flex-col items-center gap-4">
        <div 
          className={cn(
            "p-2 rounded-lg transition-all relative flex flex-col items-center gap-1",
            dbStatus === 'connected' ? "text-emerald-500 bg-emerald-500/10" : 
            dbStatus === 'error' ? "text-red-500 bg-red-500/10 animate-pulse" : "text-slate-500 bg-slate-800/50"
          )}
          title={`Banco de Dados: ${dbStatus === 'connected' ? 'Conectado' : dbStatus === 'error' ? 'Erro de Conexão' : 'Desconectado'}`}
        >
          <Database size={18} />
          <div className={cn(
            "w-1.5 h-1.5 rounded-full",
            dbStatus === 'connected' ? "bg-emerald-500" : 
            dbStatus === 'error' ? "bg-red-500" : "bg-slate-500"
          )} />
        </div>

        <div className={cn(
          "w-10 h-10 rounded-full bg-slate-700 border-2 flex items-center justify-center text-slate-300 text-xs font-bold overflow-hidden cursor-help",
          userStatus === 'online' ? "border-emerald-500" : 
          userStatus === 'away' ? "border-amber-500" : "border-slate-500"
        )} title={`${currentUser?.name} (${userStatus})`}>
          {currentUser?.avatarUrl ? (
            <img src={currentUser.avatarUrl} alt={currentUser.name} className="w-full h-full object-cover" />
          ) : (
            (currentUser?.name || 'U').charAt(0)
          )}
        </div>
        <button 
          onClick={handleLogout}
          className="p-3 text-slate-500 hover:text-red-400 transition-colors"
          title="Sair"
        >
          <LogOut size={24} />
        </button>
      </div>

      {isPasswordModalOpen && <ChangePasswordModal isOpen={isPasswordModalOpen} onClose={() => setIsPasswordModalOpen(false)} />}
    </div>
  );
}



