// Pontuação e metas da avaliação de chamados (aba "Chamado" do Desempenho por Analista).
// Só regra e conta, sem banco: a leitura da configuração e os números vêm de
// lib/services/ticket-points-service.ts e lib/services/ticket-metrics-service.ts.

export interface TicketMetas {
  slaPct: number;                      // % dos chamados dentro do SLA (≥)
  primeiraRespostaMin: number;         // mediana da 1ª resposta, em minutos (≤)
  resolucaoPrimeiroContatoPct: number; // % que nasce resolvido (≥)
  backlogMax: number;                  // chamados abertos há mais que o limite (≤)
  reaberturaPct: number;               // % dos chamados fechados que foram reabertos (≤)
}

export interface TicketRegras {
  backlogHorasUteis: number; // a partir de quantas horas úteis aberto um chamado vira backlog
  amostraMinima: number;     // chamados mínimos para entrar no ranking
}

export interface TicketPontos {
  slaCumprido: number;
  slaDescumprido: number;
  primeiraRespostaNoPrazo: number;
  primeiraRespostaForaPrazo: number;
  resolvidoPrimeiroContato: number;
  backlog: number;   // por chamado em backlog
  reabertura: number; // por reabertura
}

export interface TicketConfigValues {
  metas: TicketMetas;
  regras: TicketRegras;
  pontos: TicketPontos;
}

export const DEFAULT_TICKET_CONFIG: TicketConfigValues = {
  // Valores de exemplo, com base em referências de mercado (ver docs no PR): SLA 90% (só 32% das equipes
  // cumprem o próprio SLA de forma consistente), 1ª resposta 60 min (mediana de mercado ~1 h), resolução no
  // 1º contato 70% (média do setor), reabertura 5% (estimativa), backlog 20 (depende do tamanho da equipe).
  metas: { slaPct: 90, primeiraRespostaMin: 60, resolucaoPrimeiroContatoPct: 70, backlogMax: 20, reaberturaPct: 5 },
  regras: { backlogHorasUteis: 48, amostraMinima: 10 },
  pontos: { slaCumprido: 10, slaDescumprido: -15, primeiraRespostaNoPrazo: 5, primeiraRespostaForaPrazo: -5, resolvidoPrimeiroContato: 10, backlog: -2, reabertura: -10 },
};

// Campos da configuração, na ordem da tela. A chave "grupo.campo" é usada no histórico.
export const TICKET_CONFIG_FIELDS: { grupo: keyof TicketConfigValues; campo: string; label: string; tipo: 'meta' | 'regra' | 'ponto'; referencia: string }[] = [
  { grupo: 'metas', campo: 'slaPct', label: 'Chamados dentro do SLA (%)', tipo: 'meta', referencia: 'Valor de exemplo: 90%. Só cerca de um terço das equipes cumpre o SLA de forma consistente.' },
  { grupo: 'metas', campo: 'primeiraRespostaMin', label: 'Mediana da 1ª resposta (min)', tipo: 'meta', referencia: 'Valor de exemplo: 60 min. Mediana de mercado perto de 1 hora.' },
  { grupo: 'metas', campo: 'resolucaoPrimeiroContatoPct', label: 'Nasce resolvido (%)', tipo: 'meta', referencia: 'Valor de exemplo: 70%. Média do setor de suporte; 80% é padrão de excelência.' },
  { grupo: 'metas', campo: 'backlogMax', label: 'Backlog máximo (chamados)', tipo: 'meta', referencia: 'Valor de exemplo: 20. Ajuste ao tamanho da equipe.' },
  { grupo: 'metas', campo: 'reaberturaPct', label: 'Reabertura máxima (%)', tipo: 'meta', referencia: 'Valor de exemplo: 5%. Estimativa; não encontrei benchmark confiável.' },
  { grupo: 'regras', campo: 'backlogHorasUteis', label: 'Backlog a partir de (horas úteis)', tipo: 'regra', referencia: 'Regra de negócio: 48 horas úteis (seg a sex, 8h às 18h).' },
  { grupo: 'regras', campo: 'amostraMinima', label: 'Chamados mínimos para o ranking', tipo: 'regra', referencia: 'Abaixo disso, o analista aparece fora do ranking.' },
  { grupo: 'pontos', campo: 'slaCumprido', label: 'SLA cumprido (por chamado)', tipo: 'ponto', referencia: 'Chamado concluído dentro do prazo do SLA da prioridade.' },
  { grupo: 'pontos', campo: 'slaDescumprido', label: 'SLA descumprido (por chamado)', tipo: 'ponto', referencia: 'Chamado concluído depois do prazo, ou ainda aberto com o prazo vencido.' },
  { grupo: 'pontos', campo: 'primeiraRespostaNoPrazo', label: '1ª resposta dentro da meta (por chamado)', tipo: 'ponto', referencia: 'Primeira resposta da equipe até a meta, depois de um comentário do cliente.' },
  { grupo: 'pontos', campo: 'primeiraRespostaForaPrazo', label: '1ª resposta fora da meta (por chamado)', tipo: 'ponto', referencia: 'Primeira resposta da equipe depois da meta.' },
  { grupo: 'pontos', campo: 'resolvidoPrimeiroContato', label: 'Nasce resolvido (por chamado)', tipo: 'ponto', referencia: 'Chamado que nasce já resolvido.' },
  { grupo: 'pontos', campo: 'backlog', label: 'Em backlog (por chamado)', tipo: 'ponto', referencia: 'Por chamado aberto além do limite de horas úteis. Valor de exemplo: −2.' },
  { grupo: 'pontos', campo: 'reabertura', label: 'Reaberto (por reabertura)', tipo: 'ponto', referencia: 'Por reabertura de chamado já concluído.' },
];

function numeroOu(v: unknown, padrao: number): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : padrao;
}

// Preenche o que faltar com o padrão: uma configuração antiga ou parcial nunca quebra o cálculo.
export function normalizeTicketConfig(raw: unknown): TicketConfigValues {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Record<string, unknown>>;
  const out = {} as TicketConfigValues;
  for (const grupo of ['metas', 'regras', 'pontos'] as const) {
    const padroes = DEFAULT_TICKET_CONFIG[grupo] as unknown as Record<string, number>;
    const atual = (src[grupo] ?? {}) as Record<string, unknown>;
    const linha: Record<string, number> = {};
    for (const campo of Object.keys(padroes)) linha[campo] = numeroOu(atual[campo], padroes[campo]);
    (out as unknown as Record<string, unknown>)[grupo] = linha;
  }
  return out;
}

// Valida antes de gravar. Nada de valor inválido caindo silenciosamente no padrão.
export function validateTicketConfigInput(input: unknown): { ok: true; value: TicketConfigValues } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Configuração inválida.' };
  const src = input as Record<string, Record<string, unknown>>;
  for (const f of TICKET_CONFIG_FIELDS) {
    const raw = src[f.grupo]?.[f.campo];
    const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.'));
    if (raw === undefined || raw === null || raw === '' || !Number.isFinite(n)) {
      return { ok: false, error: `Valor inválido em "${f.label}".` };
    }
    if (f.tipo === 'meta' && (n < 0 || (f.campo.endsWith('Pct') && n > 100))) {
      return { ok: false, error: `"${f.label}" precisa estar entre 0 e 100.` };
    }
    if (f.campo === 'primeiraRespostaMin' || f.campo === 'backlogMax' || f.campo === 'backlogHorasUteis' || f.campo === 'amostraMinima') {
      if (n < 0) return { ok: false, error: `"${f.label}" não pode ser negativo.` };
    }
  }
  return { ok: true, value: normalizeTicketConfig(input) };
}

export interface TicketConfigChange { campo: string; de: number | null; para: number | null }

// Diferença campo a campo. Só o que mudou entra no histórico.
export function diffTicketConfig(antes: TicketConfigValues, depois: TicketConfigValues): TicketConfigChange[] {
  const out: TicketConfigChange[] = [];
  for (const f of TICKET_CONFIG_FIELDS) {
    const de = (antes[f.grupo] as unknown as Record<string, number>)[f.campo];
    const para = (depois[f.grupo] as unknown as Record<string, number>)[f.campo];
    if (de !== para) out.push({ campo: `${f.grupo}.${f.campo}`, de, para });
  }
  return out;
}

export function labelDoCampo(chave: string): string {
  const f = TICKET_CONFIG_FIELDS.find(x => `${x.grupo}.${x.campo}` === chave);
  return f ? f.label : chave;
}

// Contagens por analista, como vêm do banco (ver ticket-metrics-service).
export interface TicketCounts {
  slaOk: number;
  slaMiss: number;
  frNoPrazo: number;
  frForaPrazo: number;
  nasceramResolvidos: number;
  backlog: number;
  reaberturas: number;
}

export interface TicketPointsBreakdown {
  sla: number;
  primeiraResposta: number;
  resolvidoPrimeiroContato: number;
  backlog: number;
  reabertura: number;
  total: number;
}

export function computeTicketPoints(c: TicketCounts, p: TicketPontos): TicketPointsBreakdown {
  const sla = c.slaOk * p.slaCumprido + c.slaMiss * p.slaDescumprido;
  const primeiraResposta = c.frNoPrazo * p.primeiraRespostaNoPrazo + c.frForaPrazo * p.primeiraRespostaForaPrazo;
  const resolvidoPrimeiroContato = c.nasceramResolvidos * p.resolvidoPrimeiroContato;
  const backlog = c.backlog * p.backlog;
  const reabertura = c.reaberturas * p.reabertura;
  return { sla, primeiraResposta, resolvidoPrimeiroContato, backlog, reabertura, total: sla + primeiraResposta + resolvidoPrimeiroContato + backlog + reabertura };
}
