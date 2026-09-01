import { query } from '@/lib/db';

// Escala de fim de semana — planilha Google Sheets publicada na web (só
// leitura, atualiza sozinha quando a planilha muda), pedida pra aparecer
// dentro de Configurações > Giro de Atendimento. Ver
// components/weekend-schedule-content.tsx e
// app/api/giro/weekend-schedule/route.ts.
//
// A planilha tem UMA ABA POR MÊS (ex: "Agosto Novo Modelo", "Outubro/2026"),
// cada aba nova nasce com um `gid` novo e imprevisível quando o time publica
// o mês seguinte — não tem como fixar um gid no código. A decisão (consciente,
// não à toa) foi detectar a aba certa pelo NOME batendo com o mês atual, em
// vez de exigir que alguém venha atualizar uma configuração toda virada de
// mês. Contrapartida: se o Google mudar o formato interno da página de
// publicação, ou se o time nomear uma aba fora do padrão "<Mês> ...", a
// detecção para de achar a aba e a tela mostra um erro explicando o que
// aconteceu (nunca falha silenciosa mostrando o mês errado).
//
// Se a planilha for republicada num link novo (Arquivo > Compartilhar >
// Publicar na web), quem tem giro:manage troca o link direto na tela
// "Escala Fim de Semana" (ver saveWeekendScheduleSheetId abaixo,
// weekend_schedule_settings.published_sheet_id) — sem precisar de deploy.
// Esta constante é só o valor de partida/fallback.
const DEFAULT_PUBLISHED_SHEET_ID = '2PACX-1vROzKHP1pCAm8nNSnYlEcb7ZSAax1Mnvlon5CPWlXv0uFRPIuDjKGbkmEwcpJ-XMmygyJnAzqRAFZpH';

const PT_MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
];

export interface WeekendScheduleRow {
  date: string;
  weekday: string;
  titular: string;
  substituto: string;
  responsavelEfetivo: string;
  horas: string;
}

export interface WeekendScheduleResult {
  tabName: string;
  rows: WeekendScheduleRow[];
  // ID efetivamente usado nesta busca (configurado ou o padrão) — pra tela
  // montar o link "abrir no Google Sheets" sem precisar saber se alguém
  // trocou o link em Configurações.
  sheetId: string;
  // AAAA-MM-DD, sempre do Postgres (ver currentMonthAndToday acima) — pra
  // quem exibe destacar passado/próximo fim de semana/restante sem depender
  // do relógio do navegador.
  todayIso: string;
  fetchedAt: string;
}

export class WeekendScheduleNotFoundError extends Error {
  constructor(public availableTabs: string[]) {
    // Lista vazia é um caso bem diferente de "achei abas, mas nenhuma bate
    // com o mês": geralmente indica link errado/planilha despublicada, ou o
    // Google mudou o formato da página (ver fetchTabList) — nesses casos
    // "não encontramos a aba do mês" confundiria mais do que ajudaria.
    super(
      availableTabs.length === 0
        ? 'Não conseguimos identificar nenhuma aba nessa planilha publicada. Verifique se o link está correto (Configurações > Escala Fim de Semana > Trocar link) e se a planilha continua publicada na web.'
        : 'Não encontramos a aba do mês atual na planilha publicada.'
    );
  }
}

// \p{Diacritic} (Unicode property escape) em vez de uma faixa de caracteres
// escrita à mão — mais claro e sem risco de mojibake no arquivo-fonte (ver
// scripts/check-encoding.js).
function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

// Mês (alvo, considerando monthOffset) e dia "de hoje" (sempre o de verdade,
// nunca o navegado — é o que classifyWeekendRows usa pra marcar passado/
// próximo/restante) sempre pelo Postgres (ver cabeçalho do arquivo) — nunca
// `new Date()` do processo Node, que roda em UTC. `todayIso` viaja pro
// cliente sem cada tela precisar de outra chamada — ver classifyWeekendRows
// em lib/weekend-schedule-utils.ts.
async function resolveMonthAndToday(monthOffset: number): Promise<{ monthName: string; todayIso: string }> {
  const res = await query(
    `SELECT EXTRACT(MONTH FROM NOW() AT TIME ZONE 'America/Sao_Paulo')::int AS mes,
            to_char(NOW() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS hoje`
  );
  const currentMonthIndex = res.rows[0].mes - 1; // 0-based
  const targetIndex = ((currentMonthIndex + monthOffset) % 12 + 12) % 12;
  return { monthName: PT_MONTHS[targetIndex], todayIso: res.rows[0].hoje };
}

// --- Link configurável -------------------------------------------------

/** Valor cru salvo (NULL = usando o padrão) — pra tela mostrar o que está configurado hoje. */
export async function getConfiguredPublishedSheetId(): Promise<string | null> {
  const res = await query('SELECT published_sheet_id FROM public.weekend_schedule_settings WHERE id = 1');
  return res.rows[0]?.published_sheet_id || null;
}

async function resolvePublishedSheetId(): Promise<string> {
  const configured = await getConfiguredPublishedSheetId();
  return configured || DEFAULT_PUBLISHED_SHEET_ID;
}

// Aceita tanto a URL inteira que aparece na barra de endereço depois de
// "Publicar na web" (.../spreadsheets/d/e/<ID>/pubhtml, com ou sem
// parâmetros depois) quanto só o <ID> colado direto — o formato do link não
// muda (é sempre esse "/d/e/<ID>/"), só o ID em si.
export function extractPublishedSheetId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = /\/d\/e\/([^/?#]+)/.exec(trimmed);
  if (urlMatch) return urlMatch[1];
  // Sem barra nem espaço — já deve ser o ID sozinho.
  if (!/[\s/]/.test(trimmed)) return trimmed;
  return null;
}

export class InvalidSheetLinkError extends Error {
  constructor(message?: string) {
    super(message || 'Link inválido — cole a URL de "Publicar na web" (termina em /pubhtml) ou só o ID da planilha.');
  }
}

/**
 * rawInput vazio/null volta a usar o link padrão embutido no código.
 *
 * Valida o link JÁ aqui, tentando de fato acessá-lo — sem isso, um ID colado
 * errado (ou de uma planilha despublicada) só quebraria depois, na tela de
 * quem for ver a escala, sem nenhuma relação com quem cadastrou o link e sem
 * pista de qual dos dois lados está errado.
 */
export async function saveWeekendScheduleSheetId(rawInput: string | null, actorId: string): Promise<void> {
  let sheetId: string | null = null;
  if (rawInput && rawInput.trim()) {
    sheetId = extractPublishedSheetId(rawInput);
    if (!sheetId) throw new InvalidSheetLinkError();

    let tabs: SheetTab[];
    try {
      tabs = await fetchTabList(sheetId);
    } catch (error: any) {
      throw new InvalidSheetLinkError(error?.message);
    }
    if (tabs.length === 0) {
      throw new InvalidSheetLinkError(
        'Não encontramos nenhuma aba nessa planilha publicada — confira se o link está correto e se a planilha continua publicada na web (Arquivo > Compartilhar > Publicar na web).'
      );
    }
  }
  await query(
    `INSERT INTO public.weekend_schedule_settings (id, published_sheet_id, updated_by, updated_at)
     VALUES (1, $1, $2, now())
     ON CONFLICT (id) DO UPDATE SET published_sheet_id = $1, updated_by = $2, updated_at = now()`,
    [sheetId, actorId]
  );
  // Sem isso, a tela continuaria mostrando dado da planilha ANTIGA até o
  // cache de 5 min expirar sozinho, mesmo com o link já trocado.
  cache.clear();
}

// --- Descoberta da aba (nome -> gid) ----------------------------------------

interface SheetTab {
  name: string;
  gid: string;
}

// Sem timeout, uma falha de rede do container (DNS/firewall bloqueando saída
// para docs.google.com) deixa o fetch pendurado indefinidamente — nem
// resolve nem rejeita — e a tela fica presa em "Carregando escala..." pra
// sempre, sem nunca cair no catch do route.ts. 10s é folga suficiente pro
// Google responder em condição normal sem deixar quem clicou esperando.
const FETCH_TIMEOUT_MS = 10_000;

// Traduz timeout/erro de rede cru (ex: "fetch failed", "AbortError") numa
// mensagem que a tela consegue mostrar — o objetivo é nunca deixar o erro
// genérico do Node vazar pro usuário nem, pior, deixar a requisição pendurada
// sem nunca rejeitar (ver FETCH_TIMEOUT_MS acima).
async function fetchGoogleSheets(url: string): Promise<Response> {
  try {
    return await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error: any) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error('O Google Sheets não respondeu a tempo. Tente novamente em instantes.');
    }
    throw new Error('Não foi possível conectar ao Google Sheets — verifique o acesso à internet do servidor.');
  }
}

async function fetchTabList(sheetId: string): Promise<SheetTab[]> {
  const res = await fetchGoogleSheets(`https://docs.google.com/spreadsheets/d/e/${sheetId}/pubhtml`);
  if (!res.ok) {
    // 404 é o caso mais comum na prática (ID errado, planilha despublicada
    // ou excluída) — vale a pena diferenciar de um erro passageiro do lado
    // do Google, que costuma se resolver sozinho numa nova tentativa.
    if (res.status === 404) {
      throw new Error('Planilha não encontrada no Google Sheets — o link pode estar incorreto ou a planilha pode não estar mais publicada na web.');
    }
    throw new Error(`O Google Sheets recusou a requisição ao tentar acessar a planilha publicada (código ${res.status}). Tente novamente em instantes.`);
  }
  const html = await res.text();

  // A página de publicação embute a lista de abas como
  // items.push({name: "Agosto Novo Modelo", pageUrl: "...gid=123..."}) — não
  // é uma API documentada, é a estrutura interna do HTML que o Google gera
  // hoje para pubhtml. Se o Google mudar isso, tabs vem vazio e quem chamou
  // recebe um erro claro (ver WeekendScheduleNotFoundError), não um resultado
  // errado.
  const tabs: SheetTab[] = [];
  const re = /items\.push\(\{name:\s*"((?:[^"\\]|\\.)*)",\s*pageUrl:\s*"[^"]*gid=(\d+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    tabs.push({ name: match[1].replace(/\\\//g, '/'), gid: match[2] });
  }
  return tabs;
}

function pickCurrentMonthTab(tabs: SheetTab[], monthName: string): SheetTab {
  const matches = tabs.filter(t => normalize(t.name).includes(monthName));
  if (matches.length === 0) {
    throw new WeekendScheduleNotFoundError(tabs.map(t => t.name));
  }
  // Mais de uma aba com o mesmo nome de mês (ex: ano seguinte reaproveitando o
  // nome) — fica com a última da lista, que é a publicada mais recentemente.
  return matches[matches.length - 1];
}

// --- CSV ---------------------------------------------------------------

// Parser simples de uma linha CSV respeitando aspas (o export do Google
// Sheets escapa vírgula/aspas dentro de campo com aspas duplas) — não precisa
// de biblioteca externa para um formato tão previsível.
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cur += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      cells.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

function parseCsv(text: string): string[][] {
  // \r\n do export do Google — split simples por linha, uma linha nunca
  // atravessa quebra real dentro de aspas nestas planilhas (sem texto longo
  // multi-linha nas células da escala).
  return text.split(/\r?\n/).map(parseCsvLine);
}

const SECTION_TITLE = 'escala de fins de semana';

function extractWeekendSection(rows: string[][]): WeekendScheduleRow[] {
  const startIdx = rows.findIndex(r => normalize(r[0] || '') === SECTION_TITLE);
  if (startIdx === -1) return [];

  // Linha seguinte ao título é o cabeçalho (DATA, DIA_SEMANA, TITULAR,
  // SUBSTITUTO, RESPONSAVEL_EFETIVO, HORAS) — pulamos os dois e lemos até uma
  // linha em branco ou a próxima seção ("ESCALA DE FERIADOS").
  const out: WeekendScheduleRow[] = [];
  for (let i = startIdx + 2; i < rows.length; i++) {
    const r = rows[i];
    const first = (r[0] || '').trim();
    if (!first) break;
    if (normalize(first).startsWith('escala de')) break;
    out.push({
      date: first,
      weekday: (r[1] || '').trim(),
      titular: (r[2] || '').trim(),
      substituto: (r[3] || '').trim(),
      responsavelEfetivo: (r[4] || '').trim(),
      horas: (r[5] || '').trim()
    });
  }
  return out;
}

// --- Cache em memória ----------------------------------------------------
// Mesmo espírito do cache de foto de contato do WhatsApp (lib/presence.ts
// não, mas o padrão já usado em outros lugares do projeto): evita bater no
// Google a cada carregamento de tela — a planilha muda no máximo algumas
// vezes por dia. 5 min é curto o bastante pra não incomodar quem acabou de
// editar e clicou em "Atualizar". Chave por monthOffset — navegar pra outro
// mês não pode invalidar/atrasar o mês atual (usado também pelo popover do
// Giro).
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<number, { data: WeekendScheduleResult; expiresAt: number }>();

export async function getWeekendSchedule(forceRefresh = false, monthOffset = 0): Promise<WeekendScheduleResult> {
  const cached = cache.get(monthOffset);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const sheetId = await resolvePublishedSheetId();
  const [{ monthName, todayIso }, tabs] = await Promise.all([resolveMonthAndToday(monthOffset), fetchTabList(sheetId)]);
  const tab = pickCurrentMonthTab(tabs, monthName);
  const csvRes = await fetchGoogleSheets(
    `https://docs.google.com/spreadsheets/d/e/${sheetId}/pub?output=csv&gid=${tab.gid}`
  );
  if (!csvRes.ok) {
    if (csvRes.status === 404) {
      throw new Error(`Não foi possível baixar os dados da aba "${tab.name}" — ela pode ter sido removida ou renomeada na planilha depois que a lista de abas foi lida.`);
    }
    throw new Error(`O Google Sheets recusou o download dos dados da planilha (código ${csvRes.status}). Tente novamente em instantes.`);
  }
  const csvText = await csvRes.text();
  const rows = extractWeekendSection(parseCsv(csvText));

  // Aba existe e o download deu certo, mas a seção "ESCALA DE FINS DE
  // SEMANA" não foi encontrada — sem esse aviso, a tela mostraria "nenhuma
  // linha encontrada" como se a escala estivesse vazia de propósito, quando
  // na prática o layout da planilha mudou (título da seção renomeado/
  // movido) e ninguém vai perceber a causa real.
  if (rows.length === 0) {
    console.warn(`[weekend-schedule] Aba "${tab.name}" não tem a seção "ESCALA DE FINS DE SEMANA" (ou ela veio vazia) — conferir o layout da planilha.`);
  }

  const result: WeekendScheduleResult = { tabName: tab.name, rows, sheetId, todayIso, fetchedAt: new Date().toISOString() };
  cache.set(monthOffset, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}
