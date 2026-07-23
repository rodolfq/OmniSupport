import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Ticket,
  Users,
  PieChart,
  Settings,
  UserCog,
  Shield,
  MessageSquare,
  UserCircle,
  Key,
  MessageCircle,
  Library,
  FileText,
  History,
  Star
} from 'lucide-react';
import { Permission, UserRole, User } from './types';

export interface NavItem {
  name: string;
  icon: LucideIcon;
  href?: string;
  permission?: Permission;
  action?: () => void;
  subItems?: NavItem[];
}

// Mesma árvore de navegação usada pela sidebar desktop e pelo menu "Mais" do
// shell mobile — uma única fonte de verdade para as regras de role/permissão.
export function getNavItems(currentUser: User | null, onChangePassword: () => void): NavItem[] {
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
      ...(currentUser?.role === UserRole.CUSTOMER ? [
        { name: 'Empresa', icon: Users, href: '/customers' },
      ] : []),
      {
        name: 'Configurações',
        icon: Settings,
        href: '/settings',
        subItems: [
          { name: 'Perfil', icon: Settings, href: '/settings' },
          { name: 'Alterar Senha', icon: Key, action: onChangePassword },
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
        { name: 'Avaliações de Clientes', icon: Star, href: '/customer-evaluations', permission: Permission.REPORTS_READ },
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
    { name: 'WhatsApp', icon: MessageSquare, href: '/whatsapp', permission: Permission.WHATSAPP_MANAGE },
    { name: 'Clientes', icon: Users, href: '/customers', permission: Permission.CUSTOMERS_READ },
    {
      name: 'Configurações',
      icon: Settings,
      href: '/settings',
      subItems: [
        { name: 'Configurações', icon: Settings, href: '/settings' },
        { name: 'Equipe', icon: UserCog, href: '/team', permission: Permission.TEAM_READ },
        { name: 'Equipes & Permissões', icon: Shield, href: '/permissions', permission: Permission.SETTINGS_WRITE },
        { name: 'Filas', icon: Library, href: '/queues', permission: Permission.QUEUES_MANAGE },
        { name: 'Alterar Senha', icon: Key, action: onChangePassword },
      ]
    },
  ];
}

export function getUserPermissions(currentUser: User | null): Permission[] {
  if (!currentUser) return [];
  if (currentUser.role === UserRole.ADMIN) {
    return Object.values(Permission);
  }
  return currentUser.permissions || [];
}

// Filtra a árvore de navegação pelas permissões do usuário, preservando um
// item pai se ao menos um sub-item continuar visível (mesma regra usada hoje
// só dentro da sidebar).
export function filterVisibleNavItems(items: NavItem[], userPermissions: Permission[]): NavItem[] {
  return items.reduce<NavItem[]>((acc, item) => {
    const hasPermission = !item.permission || userPermissions.includes(item.permission);
    const visibleSubItems = item.subItems
      ? item.subItems.filter(sub => !sub.permission || userPermissions.includes(sub.permission))
      : undefined;

    if (!hasPermission) {
      if (visibleSubItems && visibleSubItems.length > 0) {
        acc.push({ ...item, subItems: visibleSubItems });
      }
      return acc;
    }

    acc.push(visibleSubItems ? { ...item, subItems: visibleSubItems } : item);
    return acc;
  }, []);
}
