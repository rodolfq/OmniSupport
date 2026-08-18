import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Ticket,
  Users,
  PieChart,
  Settings,
  MessageSquare,
  UserCircle,
  MessageCircle,
  History,
  Star,
  BarChart3
} from 'lucide-react';
import { Permission, UserRole, User } from './types';

export interface NavItem {
  name: string;
  icon: LucideIcon;
  href?: string;
  // Array = "qualquer uma delas" — usado por Chamados, que agora reúne
  // Chamados e Tickets Internos numa única tela (ver /tickets): quem tem só
  // uma das duas permissões ainda precisa enxergar o item no menu.
  permission?: Permission | Permission[];
  action?: () => void;
  subItems?: NavItem[];
}

// Mesma árvore de navegação usada pela sidebar desktop e pelo menu "Mais" do
// shell mobile — uma única fonte de verdade para as regras de role/permissão.
// "Alterar Senha" não é mais item de menu à parte: fica dentro de
// Configurações > Segurança (ver app/(portal)/settings/page.tsx).
export function getNavItems(currentUser: User | null): NavItem[] {
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
      // Configurações virou uma tela única com menus internos (Perfil,
      // Segurança/Alterar Senha etc. já estão lá dentro) — o item do menu é
      // um link direto, sem submenu duplicando o que já está em /settings.
      { name: 'Configurações', icon: Settings, href: '/settings' },
    ];
  }

  return [
    {
      name: 'Dashboard',
      icon: LayoutDashboard,
      permission: Permission.DASHBOARD_VIEW,
      subItems: [
        { name: 'Geral', icon: LayoutDashboard, href: '/dashboard', permission: Permission.DASHBOARD_VIEW },
        // Etapa 3 do roadmap "Time x Gerencial" ainda não existe — rota fica
        // reservada aqui, mas só fica visível pra quem tiver
        // DASHBOARD_MANAGEMENT (ninguém, fora de concessão manual, até essa
        // etapa entregar a tela).
        { name: 'Gerencial', icon: BarChart3, href: '/dashboard/management', permission: Permission.DASHBOARD_MANAGEMENT },
        { name: 'Relatórios', icon: PieChart, href: '/reports', permission: Permission.REPORTS_READ },
        { name: 'Avaliações de Clientes', icon: Star, href: '/customer-evaluations', permission: Permission.REPORTS_READ },
      ]
    },
    {
      name: 'Chamados',
      icon: Ticket,
      // Chamados e Tickets Internos foram unificados em /tickets (chave de
      // troca no topo da tela) — o grupo do menu precisa aparecer pra quem
      // tem qualquer uma das duas, não só tickets:read.
      permission: [Permission.TICKETS_READ, Permission.INTERNAL_TICKETS_VIEW],
      subItems: [
        { name: 'Todos os Chamados', icon: Ticket, href: '/tickets', permission: [Permission.TICKETS_READ, Permission.INTERNAL_TICKETS_VIEW] },
        { name: 'Meus Chamados', icon: UserCircle, href: '/my-tickets' },
        { name: 'Painel Chat', icon: MessageSquare, href: '/chat-management', permission: Permission.OUTSIDE_QUEUE_VIEW },
        { name: 'Histórico de Conversas', icon: History, href: '/chat-history', permission: Permission.TICKETS_READ },
      ]
    },
    { name: 'Chat Interno', icon: MessageCircle, href: '/chat-internal', permission: Permission.CHAT_INTERNAL_VIEW },
    { name: 'Clientes', icon: Users, href: '/customers', permission: Permission.CUSTOMERS_READ },
    // Configurações virou uma tela única com menus internos (Equipe, Filas,
    // Giro, Hotfixes, WhatsApp, Alterar Senha etc. já estão lá dentro, ver
    // app/(portal)/settings/page.tsx) — o item do menu é um link direto, sem
    // submenu duplicando o que já está em /settings.
    { name: 'Configurações', icon: Settings, href: '/settings' },
  ];
}

export function getUserPermissions(currentUser: User | null): Permission[] {
  if (!currentUser) return [];
  if (currentUser.role === UserRole.ADMIN) {
    return Object.values(Permission);
  }
  return currentUser.permissions || [];
}

// item.permission em array = "qualquer uma delas" já basta pra mostrar o
// item; um único Permission continua exigindo exatamente aquela. Exportada
// porque a sidebar (components/sidebar.tsx) faz sua própria checagem
// inline em vez de usar filterVisibleNavItems — mesma regra, uma fonte só.
export function matchesPermission(required: Permission | Permission[] | undefined, userPermissions: Permission[]): boolean {
  if (!required) return true;
  if (Array.isArray(required)) return required.some(p => userPermissions.includes(p));
  return userPermissions.includes(required);
}

// Filtra a árvore de navegação pelas permissões do usuário, preservando um
// item pai se ao menos um sub-item continuar visível (mesma regra usada hoje
// só dentro da sidebar).
export function filterVisibleNavItems(items: NavItem[], userPermissions: Permission[]): NavItem[] {
  return items.reduce<NavItem[]>((acc, item) => {
    const hasPermission = matchesPermission(item.permission, userPermissions);
    const visibleSubItems = item.subItems
      ? item.subItems.filter(sub => matchesPermission(sub.permission, userPermissions))
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
