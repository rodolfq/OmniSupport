/**
 * Busca por texto sem diferenciar acento (2026-11-24, pedido do usuário:
 * "João" acha "joao", "Ação" acha "acao", "Concluído" acha "concluido").
 *
 * Dois lados, sempre juntos:
 *  - coluna: `unaccentCol('title')` → translate() que troca letra acentuada
 *    pela sem acento, maiúscula e minúscula (não depende do collation do banco
 *    nem da extensão `unaccent`, que exigiria migration e não existe no dev);
 *  - termo digitado: `likeTerm(busca)` → tira o acento no JS e monta `%...%`.
 * O ILIKE continua cuidando de maiúscula/minúscula.
 *
 * Nenhuma dessas colunas tem índice de texto (trigrama), então envolver a
 * coluna não faz nenhuma busca perder índice.
 */

const FROM = 'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝýÿ';
const TO = 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyy';

/** Expressão SQL da coluna sem acento. `expr` é SQL confiável (nome de coluna), nunca entrada do usuário. */
export function unaccentCol(expr: string): string {
  return `translate(${expr}, '${FROM}', '${TO}')`;
}

/** Remove acentos de um texto (mesma regra de lib/utils.ts normalizeString, sem baixar a caixa). */
export function stripAccents(value: string): string {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Termo de busca pronto para `ILIKE`: sem acento e entre `%`. */
export function likeTerm(value: string): string {
  return `%${stripAccents(String(value ?? '').trim())}%`;
}
