'use client';

/**
 * Indicativo de "tem novidade" reutilizável — mesmo mecanismo de
 * notificação de chamado (ticket_notification_reads) generalizado pro
 * ticket interno e pro botão de alternância Chamados/Ticket Interno
 * (2026-10-21, pedido do usuário).
 */

/** Selo numérico no canto de um card (mesmo visual que já existia só em my-tickets/page.tsx). */
export function NotificationCountBadge({ count, className = '' }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span className={`absolute -top-2 -right-2 min-w-[20px] h-[20px] px-1.5 rounded-full bg-[var(--accent)] text-white text-[10px] font-bold flex items-center justify-center shadow-md z-10 ${className}`}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** Bolinha discreta — linha de tabela, aba, botão de alternância: onde um selo numérico grande não cabe/não combina. */
export function UnreadDot({ show, className = '' }: { show: boolean; className?: string }) {
  if (!show) return null;
  return <span className={`w-2 h-2 rounded-full bg-[var(--accent)] shrink-0 ${className}`} />;
}
