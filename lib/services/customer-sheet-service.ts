import crypto from 'crypto';
import { query, withCreationContext } from '../db';

// Quem disparou a sincronização (login + IP), pro registro rígido de criação de
// usuário (user_creation_log). Sem isso o autor fica só como a rotina.
export interface SyncCreationInfo { actorId?: string | null; ip?: string | null; userAgent?: string | null }
import { hashPassword } from '../auth-utils';

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
 * Empresa EM TREINAMENTO (2026-09-28): toda empresa com data de entrada
 * (coluna D, "4 - Entrada", DD/MM/AAAA) de 2026 em diante entra em treinamento
 * por aqui — e SÓ por aqui. Uma vez removido o status (por quem tem a permissão
 * customers:training, ou por qualquer caminho: o gatilho de companies grava
 * training_removed_at), a importação NUNCA o devolve, por mais que a planilha
 * seja importada de novo; só volta manualmente. A importação também nunca
 * REMOVE o status: só adiciona, e só a quem nunca foi removida.
 *
 * Casamento de empresa por NOME (case-insensitive, mesmo espírito do antigo
 * sync do Bitrix) — id_central NÃO é chave única aqui: duas linhas podem
 * compartilhar o mesmo id_central quando duas marcas/CNPJs usam a mesma conta
 * central (confirmado nos dados reais da planilha), então nunca é usado para
 * decidir se cria ou atualiza.
 *
 * O Decisor vira o "usuário principal" (Admin Cliente) da empresa quando ela
 * ainda não tem um: pedido do usuário (2026-09-02), porque a importação em
 * massa da planilha criou empresa sem NENHUM usuário — sem isso, ninguém
 * consegue logar como aquele cliente. E-mail genérico a partir do telefone do
 * Decisor (mesmo padrão já usado manualmente antes, ver
 * contatos_para_validar.csv), pra ser corrigido depois — mas DETERMINÍSTICO
 * (mesmo telefone sempre gera o mesmo e-mail), nunca timestamp/aleatório: foi
 * exatamente um e-mail sempre-diferente (`contact_${Date.now()}@placeholder`)
 * que duplicou perfil de contato antes (ver migrations/profiles_email_opcional.sql)
 * ao nunca colidir com o cadastro que já existia. Só roda quando a empresa
 * ainda NÃO tem usuário principal — nunca mexe em quem já está cadastrado.
 */

const SPREADSHEET_ID = '1EJnd8R_3dSSBn9ERl3nRcYcBZWJJiI16tkuaT026Hhc';

// Coluna B ("2 - Cliente"), C ("3 - CS"), X ("Comercial"), AE ("Decisor") e
// AF ("Telefone") são iguais nas duas abas — só a coluna do Id Central muda
// de posição entre elas.
const SHEETS: { name: string; idCentralColumn: string }[] = [
  { name: 'Onboarding', idCentralColumn: 'S' },
  { name: 'Ongoing', idCentralColumn: 'U' },
];
const NAME_COLUMN = 'B';
const CS_COLUMN = 'C';
const COMERCIAL_COLUMN = 'X';
const DECISOR_COLUMN = 'AE';
const TELEFONE_COLUMN = 'AF';
// Coluna D ("4 - Entrada"): data em que o cliente entrou, igual nas duas abas.
const ENTRY_DATE_COLUMN = 'D';
// Regra confirmada pelo usuário (2026-09-28): ano de entrada MAIOR OU IGUAL a 2026
// — qualquer dia de 2026 (a partir de 01/01/2026) ou posterior (o pedido dizia
// "superior a 2026"). Só o ano conta. Ano de corte numa constante pra ser uma
// linha só se a regra mudar.
export const TRAINING_ENTRY_FROM_YEAR = 2026;

/**
 * Lê a data de entrada da célula. Aceita DD/MM/AAAA (formato da planilha, com ou
 * sem zero à esquerda) e AAAA-MM-DD. Data inexistente (31/02/2026), vazia ou em
 * outro formato devolve null — nunca erro e nunca "adivinha" uma data.
 */
export function parseSheetEntryDate(raw: string | null | undefined): { year: number; month: number; day: number } | null {
  const value = (raw || '').trim();
  if (!value) return null;
  let d: number, m: number, y: number;
  let match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    d = Number(match[1]); m = Number(match[2]); y = Number(match[3]);
  } else {
    match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/);
    if (!match) return null;
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  }
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { year: y, month: m, day: d };
}

/** Entrada de 2026 em diante = a importação coloca a empresa em treinamento. */
export function entersTrainingByEntryDate(raw: string | null | undefined): boolean {
  const date = parseSheetEntryDate(raw);
  return !!date && date.year >= TRAINING_ENTRY_FROM_YEAR;
}

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
  /** Mesma ideia acima, para a coluna de Comercial Responsável. */
  unresolvedComercial: string[];
  /** Quantas empresas ganharam usuário principal (Admin Cliente) criado
   *  automaticamente a partir do Decisor, por não terem nenhum ainda. */
  primaryUsersCreated: number;
  /** Empresas que entraram em treinamento NESTA importação (entrada de 2026 em
   *  diante e nunca removidas do status). */
  trainingApplied: number;
  /** Empresas com entrada de 2026 em diante que estão FORA do treinamento porque
   *  já foram removidas uma vez — a importação não as devolve, só manualmente. */
  trainingAlreadyRemoved: number;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Cria o usuário principal (Admin Cliente) da empresa a partir do Decisor,
 * SE ela ainda não tiver nenhum (role = 'Cliente') — nunca substitui quem já
 * está cadastrado. E-mail genérico e determinístico (telefone do Decisor +
 * @ssx.com, ver comentário no topo do arquivo); sem telefone, cai num e-mail
 * baseado no id da empresa. Em colisão de e-mail (mesmo telefone genérico já
 * usado por outra empresa), tenta sufixos incrementais antes de desistir.
 */
async function ensurePrimaryUserFromDecisor(
  companyId: string,
  decisorNome: string,
  decisorTelefone: string | null,
  creation?: SyncCreationInfo
): Promise<boolean> {
  const existing = await query(
    `SELECT id FROM public.profiles WHERE company_id = $1 AND role = 'Cliente' LIMIT 1`,
    [companyId]
  );
  if (existing.rows.length > 0) return false;

  const digits = decisorTelefone ? digitsOnly(decisorTelefone) : '';
  const baseLocalPart = digits || `decisor-${companyId.slice(0, 8)}`;

  let email = `${baseLocalPart}@ssx.com`;
  for (let attempt = 2; attempt <= 6; attempt++) {
    const dup = await query('SELECT id FROM public.profiles WHERE email = $1', [email]);
    if (dup.rows.length === 0) break;
    email = `${baseLocalPart}+${attempt}@ssx.com`;
  }

  const tempPassword = crypto.randomBytes(18).toString('base64url');
  await withCreationContext(
    { actorId: creation?.actorId || null, source: 'sincronizacao-planilha-cs', actorLabel: 'Sincronização da planilha de CS', ip: creation?.ip, userAgent: creation?.userAgent },
    (client) => client.query(
      `INSERT INTO public.profiles
         (name, email, role, company_id, phone, password, is_admin, lives_in_squad,
          must_change_password, view_all_company_tickets)
       VALUES ($1, $2, 'Cliente', $3, $4, $5, TRUE, FALSE, TRUE, TRUE)`,
      [decisorNome, email, companyId, decisorTelefone || null, hashPassword(tempPassword)]
    )
  );
  return true;
}

export async function syncCompaniesFromSheet(creation?: SyncCreationInfo): Promise<CustomerSheetSyncResult> {
  let fetched = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let primaryUsersCreated = 0;
  let trainingApplied = 0;
  const trainingAlreadyRemovedIds = new Set<string>();
  const errors: string[] = [];
  const unresolvedCsSet = new Set<string>();
  const unresolvedComercialSet = new Set<string>();

  // Cache por nome já resolvido nesta execução, compartilhado entre CS e
  // Comercial (é o mesmo universo de pessoas — Administrador/Equipe/Time
  // Interno — e a mesma regra de resolução pros dois papéis) — a planilha
  // repete o mesmo nome em dezenas de linhas, não faz sentido reconsultar.
  const profileCache = new Map<string, string | null>();

  // Nomes que não batem 1-pra-1 sozinhos, resolvidos manualmente com o
  // usuário (2026-09-01): "Duda"/"João"/"Lucas" são apelido ou nome parcial
  // de uma pessoa específica; "Luiz Felipe" bate com 2 perfis distintos e
  // vale QUALQUER um dos dois (resolveProfileIdByName pega o primeiro, abaixo).
  const NAME_OVERRIDES: Record<string, string> = {
    'luiz felipe': 'Luiz Felipe',
    'joão': 'João Pedro Oliveira Sotelino',
    'lucas': 'Lucas Barreto',
    'duda': 'Eduarda Melo',
  };

  async function resolveProfileIdByName(rawName: string, unresolvedSet: Set<string>): Promise<string | null> {
    const trimmed = rawName.trim();
    const key = trimmed.toLowerCase();
    if (!key) return null;

    const override = NAME_OVERRIDES[key];
    let resolved: string | null;
    if (profileCache.has(key)) {
      resolved = profileCache.get(key)!;
    } else {
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
            [trimmed]
          );
      // Sem override: só aceita quando bate com EXATAMENTE uma pessoa — nome
      // ambíguo/sem match não vira atribuição adivinhada, fica em branco pra
      // atribuir à mão. Com override, o nome-alvo já foi decidido explicitamente
      // (inclusive o caso "qualquer um dos 2" — ORDER BY id ASC dá o mesmo
      // resultado sempre, sem precisar decidir qual é "o certo").
      resolved = override
        ? (res.rows[0]?.id ?? null)
        : (res.rows.length === 1 ? res.rows[0].id : null);
      profileCache.set(key, resolved);
    }
    // Reportado por chamada (não só na primeira vez que o nome aparece): a
    // mesma pessoa pode ficar ambígua pra CS numa linha e pra Comercial em
    // outra, e cada coluna tem sua própria lista de pendências.
    if (!override && resolved === null) unresolvedSet.add(trimmed);
    return resolved;
  }

  for (const sheet of SHEETS) {
    const rows = await fetchSheetRows(sheet.name);
    if (rows.length <= 1) continue; // só cabeçalho ou vazia

    const nameIdx = columnLetterToIndex(NAME_COLUMN);
    const csIdx = columnLetterToIndex(CS_COLUMN);
    const comercialIdx = columnLetterToIndex(COMERCIAL_COLUMN);
    const decisorIdx = columnLetterToIndex(DECISOR_COLUMN);
    const telefoneIdx = columnLetterToIndex(TELEFONE_COLUMN);
    const entryDateIdx = columnLetterToIndex(ENTRY_DATE_COLUMN);
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
      const comercialName = (row[comercialIdx] || '').trim();
      const decisorNome = (row[decisorIdx] || '').trim() || null;
      const decisorTelefone = (row[telefoneIdx] || '').trim() || null;
      const entersTraining = entersTrainingByEntryDate(row[entryDateIdx]);

      try {
        const csProfileId = csName ? await resolveProfileIdByName(csName, unresolvedCsSet) : null;
        const comercialProfileId = comercialName ? await resolveProfileIdByName(comercialName, unresolvedComercialSet) : null;

        const existing = await query(
          'SELECT id, decisor_nome, decisor_telefone, is_in_training, training_removed_at FROM public.companies WHERE lower(name) = lower($1)',
          [name]
        );

        let companyId: string;
        let effectiveDecisorNome: string | null;
        let effectiveDecisorTelefone: string | null;

        if (existing.rows.length > 0) {
          // COALESCE dos dois lados: célula vazia na planilha não apaga um
          // valor já preenchido antes; CS/Comercial ambíguo ou sem match não
          // apaga uma atribuição manual já feita no cadastro. Quando a célula
          // TEM valor, porém, o dado da planilha sempre prevalece — inclusive
          // sobre uma edição manual feita no sistema depois da última sync
          // (pedido do usuário, 2026-09-02): a planilha é a fonte de verdade
          // pra estes 4 campos, o cadastro só edita "no meio do caminho".
          companyId = existing.rows[0].id;
          await query(
            `UPDATE public.companies
                SET id_central = COALESCE($1, id_central),
                    cs_responsavel_id = COALESCE($2, cs_responsavel_id),
                    comercial_responsavel_id = COALESCE($3, comercial_responsavel_id),
                    decisor_nome = COALESCE($4, decisor_nome),
                    decisor_telefone = COALESCE($5, decisor_telefone)
              WHERE id = $6`,
            [idCentral, csProfileId, comercialProfileId, decisorNome, decisorTelefone, companyId]
          );
          updated++;
          // Treinamento: só ADICIONA, e só a quem nunca foi removida. O UPDATE
          // repete as duas condições pra ser atômico (duas linhas da planilha
          // pra mesma empresa, ou uma remoção no meio da importação).
          if (entersTraining && !existing.rows[0].is_in_training) {
            if (existing.rows[0].training_removed_at) {
              trainingAlreadyRemovedIds.add(companyId);
            } else {
              const marked = await query(
                `UPDATE public.companies SET is_in_training = true, training_origin = 'planilha'
                  WHERE id = $1 AND is_in_training = false AND training_removed_at IS NULL
                  RETURNING id`,
                [companyId]
              );
              if ((marked.rowCount ?? 0) > 0) trainingApplied++;
            }
          }
          effectiveDecisorNome = decisorNome || existing.rows[0].decisor_nome || null;
          effectiveDecisorTelefone = decisorTelefone || existing.rows[0].decisor_telefone || null;
        } else {
          const inserted = await query(
            `INSERT INTO public.companies
               (name, id_central, cs_responsavel_id, comercial_responsavel_id, decisor_nome, decisor_telefone,
                is_in_training, training_origin)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [name, idCentral, csProfileId, comercialProfileId, decisorNome, decisorTelefone,
             entersTraining, entersTraining ? 'planilha' : null]
          );
          created++;
          if (entersTraining) trainingApplied++;
          companyId = inserted.rows[0].id;
          effectiveDecisorNome = decisorNome;
          effectiveDecisorTelefone = decisorTelefone;
        }

        // Sem informação nenhuma de Decisor (nem nesta sync, nem em uma
        // anterior), não inventa usuário principal nenhum — deixa a empresa
        // sem usuário mesmo, pra não "definir outro responsável" no lugar.
        if (effectiveDecisorNome) {
          const createdPrimary = await ensurePrimaryUserFromDecisor(companyId, effectiveDecisorNome, effectiveDecisorTelefone, creation);
          if (createdPrimary) primaryUsersCreated++;
        }
      } catch (err: any) {
        errors.push(`${name}: ${err.message}`);
      }
    }
  }

  return {
    fetched, created, updated, skipped, errors,
    unresolvedCs: [...unresolvedCsSet].sort(),
    unresolvedComercial: [...unresolvedComercialSet].sort(),
    primaryUsersCreated,
    trainingApplied,
    trainingAlreadyRemoved: trainingAlreadyRemovedIds.size,
  };
}
