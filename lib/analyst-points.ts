import { AnalystPerformanceRow, MIN_ANALYST_SAMPLE } from '@/lib/types';

// Ranking de analistas por pontos. A conta é feita por conversa e depois somada por analista,
// então cada número pode ser conferido com a conversa de origem.
//
// Regras:
// - Volume: cada conversa vale um peso. Se a conversa tem tags com peso configurado, vale o
//   MAIOR deles (não soma). Sem tag com peso, vale o peso base.
// - O volume da conversa é dividido entre os analistas pela participação nas mensagens da
//   equipe. Quem não respondeu nada não ganha volume. A soma de cada conversa é sempre 1.
// - Good e bad: contam nas conversas do analista responsável, com a nota do cliente.
// - Primeira resposta: faixa da 1ª resposta ao cliente (medida desde a primeira mensagem dele).
//   Conta no analista responsável.
// - Horas online não entram na pontuação.

export interface PointsWeights {
  volume: number;                      // peso base por conversa (sem tag com peso)
  volumeLimit: number;                 // teto de pontos de volume (0 = sem limite)
  good: number;                        // por avaliação positiva
  bad: number;                         // por avaliação negativa
  lt1: number;                         // conversa com 1ª resposta < 1 min
  lt3: number;                         // conversa com 1ª resposta de 1 a 3 min
  gt3: number;                         // conversa com 1ª resposta >= 3 min
  tagWeights: Record<string, number>;  // peso por tag (id de config_tags)
}

// Contagens por analista, já prontas para a conta de pontos.
export interface PointsCounts {
  volume: number;        // conversas em que o analista é o responsável
  volumePoints: number;  // pontos brutos de volume (chats x peso, divididos pela participação)
  good: number;
  bad: number;
  lt1: number;
  lt3: number;
  gt3: number;
}

export interface PointsBreakdown {
  volume: number;
  good: number;
  bad: number;
  lt1: number;
  lt3: number;
  gt3: number;
  total: number;
}

// Dado de uma conversa, como vem do banco.
export interface SessionPointsInput {
  sessionId: string;
  assigneeId: string;
  tags: string[];                        // ids de config_tags
  rating: number | null;                 // 1 = bom, -1 = ruim, null = sem nota
  firstResponseSeconds: number | null;   // 1ª resposta ao cliente, em segundos
  teamMessages: { analystId: string; n: number }[];  // mensagens da equipe por analista
}

export interface PointsRow {
  row: AnalystPerformanceRow;
  breakdown: PointsBreakdown;
  eligible: boolean;
}

export const DEFAULT_POINTS_WEIGHTS: PointsWeights = {
  volume: 0.5,
  volumeLimit: 0,
  good: 10,
  bad: -150,
  lt1: 5,
  lt3: 0.5,
  gt3: -1,
  tagWeights: {},
};

export const POINTS_WEIGHT_KEYS = ['volume', 'volumeLimit', 'good', 'bad', 'lt1', 'lt3', 'gt3'] as const;

function finiteOr(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return v !== undefined && v !== null && v !== '' && Number.isFinite(n) ? n : fallback;
}

// Valida e normaliza uma configuração vinda da tela ou do banco. Campo inválido cai no padrão.
export function normalizeWeights(input: unknown): PointsWeights {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: PointsWeights = {
    volume: finiteOr(src.volume, DEFAULT_POINTS_WEIGHTS.volume),
    volumeLimit: Math.max(0, finiteOr(src.volumeLimit, DEFAULT_POINTS_WEIGHTS.volumeLimit)),
    good: finiteOr(src.good, DEFAULT_POINTS_WEIGHTS.good),
    bad: finiteOr(src.bad, DEFAULT_POINTS_WEIGHTS.bad),
    lt1: finiteOr(src.lt1, DEFAULT_POINTS_WEIGHTS.lt1),
    lt3: finiteOr(src.lt3, DEFAULT_POINTS_WEIGHTS.lt3),
    gt3: finiteOr(src.gt3, DEFAULT_POINTS_WEIGHTS.gt3),
    tagWeights: {},
  };
  const tw = src.tagWeights;
  if (tw && typeof tw === 'object') {
    for (const [tagId, v] of Object.entries(tw as Record<string, unknown>)) {
      if (v === undefined || v === null || v === '') continue;
      const n = Number(String(v).replace(',', '.'));
      if (Number.isFinite(n)) out.tagWeights[tagId] = n;
    }
  }
  return out;
}

// Peso de uma conversa: o maior peso entre as tags que têm peso configurado.
// Sem nenhuma tag com peso, vale o peso base. Nunca soma.
export function chatWeightFor(tags: string[], w: PointsWeights): number {
  let best: number | null = null;
  for (const t of tags) {
    const v = w.tagWeights[t];
    if (v !== undefined && Number.isFinite(v)) best = best === null ? v : Math.max(best, v);
  }
  return best ?? w.volume;
}

// Quanto de cada conversa cabe a cada analista, pela participação nas mensagens da equipe.
// Sem nenhuma mensagem da equipe, a conversa fica com o responsável. Soma sempre 1.
export function volumeShares(s: SessionPointsInput): Map<string, number> {
  const total = s.teamMessages.reduce((acc, m) => acc + m.n, 0);
  const out = new Map<string, number>();
  if (total > 0) {
    for (const m of s.teamMessages) {
      if (m.n > 0) out.set(m.analystId, (out.get(m.analystId) ?? 0) + m.n / total);
    }
  } else {
    out.set(s.assigneeId, 1);
  }
  return out;
}

// Faixa da 1ª resposta. null = conversa sem resposta da equipe (não pontua).
export function responseBucket(seconds: number | null): 'lt1' | 'lt3' | 'gt3' | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  if (seconds < 60) return 'lt1';
  if (seconds < 180) return 'lt3';
  return 'gt3';
}

// Soma as conversas por analista. Só o responsável recebe contagem de conversa, nota e faixa.
// O volume é dividido pela participação de cada um.
export function aggregatePoints(sessions: SessionPointsInput[], w: PointsWeights): Map<string, PointsCounts> {
  const out = new Map<string, PointsCounts>();
  const blank = (): PointsCounts => ({ volume: 0, volumePoints: 0, good: 0, bad: 0, lt1: 0, lt3: 0, gt3: 0 });
  const get = (id: string) => {
    let c = out.get(id);
    if (!c) { c = blank(); out.set(id, c); }
    return c;
  };

  for (const s of sessions) {
    const cw = chatWeightFor(s.tags, w);
    for (const [analystId, share] of volumeShares(s)) {
      get(analystId).volumePoints += share * cw;
    }
    const owner = get(s.assigneeId);
    owner.volume += 1;
    if (s.rating === 1) owner.good += 1;
    else if (s.rating === -1) owner.bad += 1;
    const bucket = responseBucket(s.firstResponseSeconds);
    if (bucket) owner[bucket] += 1;
  }
  return out;
}

// Conta de pontos de um analista, com os pesos vigentes.
export function computePoints(counts: PointsCounts, w: PointsWeights): PointsBreakdown {
  const volume = w.volumeLimit > 0 ? Math.min(counts.volumePoints, w.volumeLimit) : counts.volumePoints;
  const good = counts.good * w.good;
  const bad = counts.bad * w.bad;
  const lt1 = counts.lt1 * w.lt1;
  const lt3 = counts.lt3 * w.lt3;
  const gt3 = counts.gt3 * w.gt3;
  return { volume, good, bad, lt1, lt3, gt3, total: volume + good + bad + lt1 + lt3 + gt3 };
}

const ZERO_COUNTS: PointsCounts = { volume: 0, volumePoints: 0, good: 0, bad: 0, lt1: 0, lt3: 0, gt3: 0 };

// Pontua e ordena o time. Amostra mínima: fora do pódio e do ranking.
// Empate: mais conversas, depois nome.
export function rankPoints(rows: AnalystPerformanceRow[], w: PointsWeights): PointsRow[] {
  return rows
    .map(row => ({
      row,
      breakdown: computePoints(row.points ?? ZERO_COUNTS, w),
      eligible: !row.amostraInsuficiente && row.chatsAtendidos >= MIN_ANALYST_SAMPLE,
    }))
    .sort((a, b) =>
      b.breakdown.total - a.breakdown.total ||
      b.row.chatsAtendidos - a.row.chatsAtendidos ||
      a.row.analystName.localeCompare(b.row.analystName, 'pt-BR')
    );
}

// Número em pt-BR, com até uma casa decimal.
export function formatPointsBr(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

// Com sinal, para o detalhe: +130 e -90.
export function formatSignedPointsBr(n: number): string {
  return `${n > 0 ? '+' : ''}${formatPointsBr(n)}`;
}

// Qualidade dos dados da pontuação, para mostrar junto do ranking. Conta o que o ranking
// NÃO consegue avaliar, para que o número não pareça mais firme do que é.
export interface PointsDataQuality {
  conversas: number;
  semNota: number;        // conversas sem avaliação do cliente
  semRespostaEquipe: number;  // conversas sem nenhuma mensagem da equipe
  semPrimeiraResposta: number;
}

export function dataQuality(sessions: SessionPointsInput[]): PointsDataQuality {
  return {
    conversas: sessions.length,
    semNota: sessions.filter(s => s.rating === null).length,
    semRespostaEquipe: sessions.filter(s => s.teamMessages.reduce((a, m) => a + m.n, 0) === 0).length,
    semPrimeiraResposta: sessions.filter(s => s.firstResponseSeconds === null).length,
  };
}
