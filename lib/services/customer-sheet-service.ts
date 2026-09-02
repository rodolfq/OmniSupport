import { query } from '../db';

/**
 * Importação de empresas-cliente a partir da planilha de CS (Google Sheets) —
 * substitui o sync de EMPRESAS que vinha do Bitrix24 (o sync de usuários/
 * equipe do Bitrix continua existindo, é coisa separada — ver
 * lib/services/bitrix24-service.ts).
 *
 * Acesso pela URL pública de exportação (gviz), sem chave de API nem OAuth —
 * só funciona enquanto a planilha continuar compartilhada como "qualquer
 * pessoa com o link pode ver". Se alguém restringir o compartilhamento, o
 * fetch começa a falhar com HTML de login em vez de CSV; o erro abaixo tenta
 * deixar isso claro em vez de estourar um parse genérico.
 *
 * Casamento de empresa por NOME (case-insensitive, mesmo espírito do antigo
 * sync do Bitrix) — id_central NÃO é chave única aqui: duas linhas podem
 * compartilhar o mesmo id_central quando duas marcas/CNPJs usam a mesma conta
 * central (confirmado nos dados reais da planilha), então nunca é usado para
 * decidir se cria ou atualiza.
 */

const SPREADSHEET_ID = '1EJnd8R_3dSSBn9ERl3nRcYcBZWJJiI16tkuaT026Hhc';

// Coluna B ("2 - Cliente") e coluna C ("3 - CS") são iguais nas duas abas —
// só a coluna do Id Central muda de posição entre elas.
const SHEETS: { name: string; idCentralColumn: string }[] = [
  { name: 'Onboarding', idCentralColumn: 'S' },
  { name: 'Ongoing', idCentralColumn: 'U' },
];
const NAME_COLUMN = 'B';
const CS_COLUMN = 'C';

function columnLetterToIndex(letter: string): number {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Parser de CSV simples, mas respeitando aspas (campo com vírgula/quebra de linha dentro). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function fetchSheetRows(sheetName: string): Promise<string[][]> {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Falha ao ler a aba "${sheetName}" da planilha (HTTP ${res.status}). Verifique se ela continua compartilhada como "qualquer pessoa com o link pode ver".`
    );
  }
  const text = await res.text();
  return parseCsv(text);
}

export interface CustomerSheetSyncResult {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  /** Nomes de CS que não bateram com exatamente um usuário da equipe (0 ou
   *  mais de 1 candidato) — ficaram sem CS Responsável atribuído automaticamente. */
  unresolvedCs: string[];
}

export async function syncCompaniesFromSheet(): Promise<CustomerSheetSyncResult> {
  let fetched = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];
  const unresolvedCsSet = new Set<string>();

  // Cache por nome de CS já resolvido nesta execução — a planilha repete o
  // mesmo CS em dezenas de linhas, não faz sentido reconsultar toda vez.
  const csCache = new Map<string, string | null>();

  // Nomes que não batem 1-pra-1 sozinhos, resolvidos manualmente com o
  // usuário (2026-09-01): "Duda"/"João"/"Lucas" são apelido ou nome parcial
  // de uma pessoa específica; "Luiz Felipe" bate com 2 perfis distintos e
  // vale QUALQUER um dos dois (resolveCsProfileId pega o primeiro, abaixo).
  const CS_NAME_OVERRIDES: Record<string, string> = {
    'luiz felipe': 'Luiz Felipe',
    'joão': 'João Pedro Oliveira Sotelino',
    'lucas': 'Lucas Barreto',
    'duda': 'Eduarda Melo',
  };

  async function resolveCsProfileId(csName: string): Promise<string | null> {
    const key = csName.trim().toLowerCase();
    if (!key) return null;
    if (csCache.has(key)) return csCache.get(key)!;

    const override = CS_NAME_OVERRIDES[key];
    const res = override
      ? await query(
          `SELECT id FROM public.profiles
            WHERE is_active = true
              AND role IN ('Administrador', 'Equipe', 'Time Interno')
              AND lower(name) = lower($1)
            ORDER BY id ASC`,
          [override]
        )
      : await query(
          `SELECT id FROM public.profiles
            WHERE is_active = true
              AND role IN ('Administrador', 'Equipe', 'Time Interno')
              AND name ILIKE $1 || '%'`,
          [csName.trim()]
        );
    // Sem override: só aceita quando bate com EXATAMENTE uma pessoa — nome
    // ambíguo/sem match não vira atribuição adivinhada, fica em branco pra
    // atribuir à mão. Com override, o nome-alvo já foi decidido explicitamente
    // (inclusive o caso "qualquer um dos 2" — ORDER BY id ASC dá o mesmo
    // resultado sempre, sem precisar decidir qual é "o certo").
    const resolved = override
      ? (res.rows[0]?.id ?? null)
      : (res.rows.length === 1 ? res.rows[0].id : null);
    csCache.set(key, resolved);
    if (!override && res.rows.length !== 1) unresolvedCsSet.add(csName.trim());
    return resolved;
  }

  for (const sheet of SHEETS) {
    const rows = await fetchSheetRows(sheet.name);
    if (rows.length <= 1) continue; // só cabeçalho ou vazia

    const nameIdx = columnLetterToIndex(NAME_COLUMN);
    const csIdx = columnLetterToIndex(CS_COLUMN);
    const idCentralIdx = columnLetterToIndex(sheet.idCentralColumn);

    for (const row of rows.slice(1)) {
      const name = (row[nameIdx] || '').trim();
      if (!name) {
        skipped++;
        continue;
      }
      fetched++;

      const idCentral = (row[idCentralIdx] || '').trim() || null;
      const csName = (row[csIdx] || '').trim();

      try {
        const csProfileId = csName ? await resolveCsProfileId(csName) : null;

        const existing = await query('SELECT id FROM public.companies WHERE lower(name) = lower($1)', [name]);
        if (existing.rows.length > 0) {
          // COALESCE dos dois lados: célula vazia na planilha não apaga um
          // id_central/CS já preenchido antes; CS ambíguo/sem match não
          // apaga uma atribuição manual já feita no cadastro.
          await query(
            `UPDATE public.companies
                SET id_central = COALESCE($1, id_central),
                    cs_responsavel_id = COALESCE($2, cs_responsavel_id)
              WHERE id = $3`,
            [idCentral, csProfileId, existing.rows[0].id]
          );
          updated++;
        } else {
          await query(
            `INSERT INTO public.companies (name, id_central, cs_responsavel_id)
             VALUES ($1, $2, $3)`,
            [name, idCentral, csProfileId]
          );
          created++;
        }
      } catch (err: any) {
        errors.push(`${name}: ${err.message}`);
      }
    }
  }

  return { fetched, created, updated, skipped, errors, unresolvedCs: [...unresolvedCsSet].sort() };
}
