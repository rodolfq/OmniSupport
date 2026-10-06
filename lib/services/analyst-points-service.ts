import { query } from '@/lib/db';
import { logAudit } from '@/lib/audit-log';
import { DEFAULT_POINTS_WEIGHTS, PointsWeights, normalizeWeights, POINTS_WEIGHT_KEYS } from '@/lib/analyst-points';

// Configuração do ranking por pontos (migrations/analyst_points_config.sql).
// Enquanto a tabela não existir, a leitura devolve os padrões do código. Salvar exige a tabela.

const UNDEFINED_TABLE = '42P01';

export interface PointsConfigRecord {
  weights: PointsWeights;
  updatedAt: string | null;
  isDefault: boolean;
}

export async function getPointsConfig(): Promise<PointsConfigRecord> {
  try {
    const res = await query(`SELECT config, updated_at FROM public.analyst_points_config WHERE id = 1`);
    const row = res.rows[0];
    if (!row) return { weights: DEFAULT_POINTS_WEIGHTS, updatedAt: null, isDefault: true };
    return {
      weights: normalizeWeights(row.config),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      isDefault: false,
    };
  } catch (err: any) {
    if (err?.code === UNDEFINED_TABLE) {
      return { weights: DEFAULT_POINTS_WEIGHTS, updatedAt: null, isDefault: true };
    }
    throw err;
  }
}

// Valida antes de gravar. Nada de valor inválido caindo silenciosamente no padrão.
export function validateWeightsInput(input: unknown): { ok: true; weights: PointsWeights } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Configuração inválida.' };
  const src = input as Record<string, unknown>;
  for (const key of POINTS_WEIGHT_KEYS) {
    const raw = src[key];
    const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.'));
    if (raw === undefined || raw === null || raw === '' || !Number.isFinite(n)) {
      return { ok: false, error: `Valor inválido no campo ${key}.` };
    }
    if (key === 'volumeLimit' && n < 0) {
      return { ok: false, error: 'O limitador de volume não pode ser negativo.' };
    }
  }
  const tw = src.tagWeights;
  if (tw !== undefined && tw !== null) {
    if (typeof tw !== 'object' || Array.isArray(tw)) {
      return { ok: false, error: 'Pesos de tags inválidos.' };
    }
    for (const [tagId, v] of Object.entries(tw as Record<string, unknown>)) {
      if (v === '' || v === null) continue;
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n)) return { ok: false, error: `Peso inválido para a tag ${tagId}.` };
    }
  }
  return { ok: true, weights: normalizeWeights(src) };
}

export interface WeightChange {
  campo: string;        // chave do peso ("bad") ou "tag:<id>" para peso por tag
  de: number | null;    // null = sem peso (tag sem peso ou valor anterior ausente)
  para: number | null;
}

// Diferença campo a campo entre dois conjuntos de pesos. Só o que mudou entra no histórico.
export function diffWeights(before: PointsWeights, after: PointsWeights): WeightChange[] {
  const changes: WeightChange[] = [];
  for (const key of POINTS_WEIGHT_KEYS) {
    if (before[key] !== after[key]) changes.push({ campo: key, de: before[key], para: after[key] });
  }
  const tagIds = new Set([...Object.keys(before.tagWeights), ...Object.keys(after.tagWeights)]);
  for (const id of tagIds) {
    const de = before.tagWeights[id] ?? null;
    const para = after.tagWeights[id] ?? null;
    if (de !== para) changes.push({ campo: `tag:${id}`, de, para });
  }
  return changes;
}

// Salva e registra no log de alterações quem mudou o quê (valor antes e depois). Como cada
// mudança mexe no ranking de todo o time, o histórico é a única forma de explicar uma
// oscilação de pontos depois. Sem mudança de valor, não grava linha no log.
export async function savePointsConfig(
  weights: PointsWeights,
  actor: { id: string; name: string }
): Promise<PointsConfigRecord> {
  const before = await getPointsConfig();
  await query(
    `INSERT INTO public.analyst_points_config (id, config, updated_at, updated_by)
     VALUES (1, $1::jsonb, now(), $2)
     ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(weights), actor.id]
  );
  const changes = diffWeights(before.weights, weights);
  if (changes.length > 0 || before.isDefault) {
    await logAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: before.isDefault ? 'create' : 'update',
      entityType: 'analyst_points_config',
      entityId: '1',
      entityLabel: 'Pontuação do ranking',
      changes: { alteracoes: changes, primeiraConfiguracao: before.isDefault },
    });
  }
  return getPointsConfig();
}

export interface PointsConfigHistoryEntry {
  id: string;
  quando: string;      // ISO
  quem: string;
  acao: string;
  alteracoes: WeightChange[];
  primeiraConfiguracao: boolean;
}

export async function getPointsConfigHistory(limit = 30): Promise<PointsConfigHistoryEntry[]> {
  try {
    const res = await query(
      `SELECT id, actor_name, action, changes, created_at
         FROM public.audit_log
        WHERE entity_type = 'analyst_points_config'
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit]
    );
    return res.rows.map(r => ({
      id: r.id,
      quando: new Date(r.created_at).toISOString(),
      quem: r.actor_name,
      acao: r.action,
      alteracoes: r.changes?.alteracoes ?? [],
      primeiraConfiguracao: !!r.changes?.primeiraConfiguracao,
    }));
  } catch (err: any) {
    if (err?.code === UNDEFINED_TABLE) return [];
    throw err;
  }
}
