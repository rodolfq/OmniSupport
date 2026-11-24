/**
 * Layout único dos Kanbans (2026-11-24, pedido do usuário — "como no Odoo"):
 * colunas SEMPRE lado a lado numa fileira só, com largura fixa; quando não
 * cabem na tela, as que sobram ficam à direita e o próprio quadro ganha
 * rolagem horizontal. Antes cada tela fazia de um jeito: umas quebravam em
 * várias linhas (grid de 4), outras espremiam as colunas até um mínimo.
 *
 * Usado em: Todos os Chamados, Tickets Internos, Meus Chamados (cliente e
 * equipe) e Dashboard (chamados e tickets internos). Ao criar um Kanban novo,
 * use as duas classes — não reinvente a grade.
 *
 * - `w-full min-w-0`: o quadro nunca alarga o pai; quem rola é ele, não a página.
 * - `p-1`: espaço para o anel de destaque (ring) da coluna ao arrastar um card,
 *   que o overflow cortaria.
 * - No celular cada coluna ocupa quase a tela inteira e "encaixa" ao deslizar
 *   (snap), o mesmo gesto do Odoo no celular.
 */
export const KANBAN_BOARD_CLASS =
  'flex w-full min-w-0 items-start gap-4 overflow-x-auto overscroll-x-contain snap-x snap-mandatory md:snap-none p-1 pb-4';

// Largura aumentada em 2026-11-24 (pedido do usuário): 288px → 352px no
// desktop, já que o quadro rola na horizontal e não precisa mais espremer.
export const KANBAN_COLUMN_CLASS = 'shrink-0 w-[85vw] sm:w-80 lg:w-[22rem] snap-start';
