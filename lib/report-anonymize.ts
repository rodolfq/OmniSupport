import { query } from '@/lib/db';

// Compartilhado entre app/api/reports/analysts/route.ts (R2) e
// app/api/reports/survey/route.ts (R4, dimensão 'analyst') — extraído aqui
// só quando o 2º consumidor apareceu, pra não duplicar a mesma lógica de
// anonimização (bug corrigido numa cópia e não na outra é o risco real de
// manter isso repetido).
//
// Ordem estável e sem relação com desempenho (profiles.created_at) — o
// mesmo analista sempre cai no mesmo "Analista N" entre chamadas diferentes,
// já que cada uma calcula a ordem do mesmo jeito, sem precisar de estado
// compartilhado.
export async function anonymizeAnalystRows<T extends { analystId: string | null; analystName: string }>(
  actorId: string,
  rows: T[]
): Promise<(T & { isSelf: boolean })[]> {
  const ids = Array.from(new Set(rows.map(r => r.analystId).filter((id): id is string => !!id)));
  if (ids.length === 0) return rows.map(r => ({ ...r, isSelf: false }));

  const res = await query(
    `SELECT id FROM public.profiles WHERE id = ANY($1::uuid[]) ORDER BY created_at ASC`,
    [ids]
  );
  const orderIndex = new Map(res.rows.map((r: any, i: number) => [r.id, i + 1]));

  return rows.map(r => {
    const isSelf = r.analystId === actorId;
    return {
      ...r,
      analystName: isSelf || !r.analystId ? r.analystName : `Analista ${orderIndex.get(r.analystId) ?? '?'}`,
      isSelf
    };
  });
}
