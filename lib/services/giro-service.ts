import { pool, query } from '../db';
import { getTodaySP, toDateOnly } from '../report-period';
import type {
  GiroDay,
  GiroRow,
  GiroHistoryEntry,
  GiroParticipant,
  GiroChecklistItem,
  GiroServiceType
} from '../types';

/**
 * Giro de Atendimento — rodízio diário da equipe de suporte.
 *
 * Regra de ouro deste arquivo: a "hora de agora" e o "dia de hoje" NUNCA saem
 * de `new Date()` do processo Node. O container roda em UTC e o expediente é
 * no Brasil — às 21h de Brasília o Node já virou o dia, e a geração criaria o
 * giro de amanhã no meio do turno da tarde. Toda referência temporal vem do
 * Postgres com AT TIME ZONE 'America/Sao_Paulo' (mesma regra de
 * lib/report-period.ts, que já resolvia isso para os relatórios).
 *
 * Concorrência: a geração automática é disparada por quem abre a tela, então
 * duas abas podem tentar criar o mesmo dia ao mesmo tempo. Quem protege é o
 * UNIQUE de giro_days.giro_date + ON CONFLICT DO NOTHING — não um lock de
 * aplicação, que não sobreviveria a mais de uma réplica.
 */

// --------------------------------------------------------------- utilitários

/** Hora atual em São Paulo no formato HH:mm — sempre via banco (ver acima). */
export async function getCurrentTimeSP(): Promise<string> {
  const res = await query(`SELECT to_char(NOW() AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS hora`);
  return res.rows[0].hora as string;
}

/** Data de hoje (AAAA-MM-DD) no fuso do Brasil. */
export async function getTodayDate(): Promise<string> {
  return toDateOnly(await getTodaySP());
}

function isValidDate(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !Number.isNaN(new Date(`${dateStr}T00:00:00Z`).getTime());
}

interface EligibleParticipant {
  userId: string;
  name: string;
  workSchedule: string | null;
  positionType: 'free' | 'fixed';
  fixedPosition: number | null;
  baseOrder: number;
  createdAt: Date;
}

/**
 * Quem entra na geração de uma data: todo participante cadastrado que não está
 * "fora do rodízio" e cuja ausência já venceu.
 *
 * O prazo de ausência é comparado com GREATEST(agora, 00:00 da data gerada) —
 * e não com `now()` puro. Motivo: gerar hoje o giro de uma data futura com
 * `now()` deixaria de fora quem volta amanhã de manhã, ainda que naquele dia
 * ele já esteja de volta. Para a data de hoje os dois valores coincidem.
 */
async function getEligibleParticipants(dateStr: string): Promise<EligibleParticipant[]> {
  const res = await query(
    `SELECT gp.user_id, p.name, gp.work_schedule, gp.position_type, gp.fixed_position, gp.base_order, gp.created_at
       FROM public.giro_participants gp
       JOIN public.profiles p ON p.id = gp.user_id
      WHERE gp.out_of_rotation = false
        AND (
          gp.absent_until IS NULL
          OR gp.absent_until <= GREATEST(NOW(), ($1::date)::timestamptz)
        )
      -- base_order, não created_at: é a ordem PROGRAMADA que o admin definiu
      -- arrastando a lista em Configuração — é ela que decide onde um livre
      -- entra quando não há giro anterior pra herdar (ver buildOrder abaixo).
      ORDER BY gp.base_order ASC, p.name ASC`,
    [dateStr]
  );
  return res.rows.map(r => ({
    userId: r.user_id,
    name: r.name,
    workSchedule: r.work_schedule,
    positionType: r.position_type === 'fixed' ? 'fixed' : 'free',
    fixedPosition: r.fixed_position,
    baseOrder: r.base_order,
    createdAt: r.created_at
  }));
}

/**
 * Ordem do "dia anterior": o giro existente mais recente ANTES da data — não
 * literalmente `data - 1`. Fim de semana, feriado e qualquer dia sem giro não
 * podem zerar o rodízio; se fosse `data - 1`, toda segunda-feira recomeçaria
 * do cadastro e a vez de sexta seria perdida.
 */
async function getPreviousOrder(dateStr: string): Promise<{ userId: string; isFixed: boolean }[]> {
  const res = await query(
    `SELECT r.user_id, r.is_fixed
       FROM public.giro_day_rows r
       JOIN public.giro_days d ON d.id = r.day_id
      WHERE d.giro_date = (
              SELECT MAX(giro_date) FROM public.giro_days WHERE giro_date < $1::date
            )
      ORDER BY r.position ASC`,
    [dateStr]
  );
  return res.rows.map(r => ({ userId: r.user_id, isFixed: r.is_fixed }));
}

/**
 * Monta a ordem do dia a partir da ordem anterior — o coração do Giro.
 *
 * 1. Quem é fixo hoje sai do rodízio e reserva o próprio número. Número fora
 *    de 1..total faz a pessoa valer como LIVRE naquele dia — o excedente não
 *    pode empurrar ninguém para fora da ordem. Duas pessoas com o MESMO
 *    número já é bloqueado na gravação (saveParticipant) — o `takenSlots`
 *    abaixo é só uma rede de segurança pra dado legado/corrida de escrita,
 *    não o mecanismo principal.
 * 2. Os livres que já estavam na ordem anterior rodam: o ÚLTIMO deles assume o
 *    primeiro lugar e os demais descem uma posição. Com um único livre não há
 *    rodízio (rodar uma lista de um elemento é a própria lista).
 * 3. Quem NÃO estava na ordem anterior (novo, voltou de ausência, foi incluído
 *    à mão ontem) entra no fim e FORA do rodízio deste primeiro dia — decisão
 *    (b) da especificação. Assim ninguém perde a vez por causa da volta de um
 *    colega, e ausência não vira atalho para o primeiro lugar.
 * 4. Por fim os fixos ocupam seus números e os livres preenchem os buracos, na
 *    ordem em que ficaram.
 */
function buildOrder(
  eligible: EligibleParticipant[],
  previousOrder: { userId: string }[]
): { userId: string; isFixed: boolean }[] {
  const total = eligible.length;
  if (total === 0) return [];

  const byId = new Map(eligible.map(p => [p.userId, p]));
  const previousIds = previousOrder.map(p => p.userId).filter(id => byId.has(id));
  const previousIndex = new Map(previousIds.map((id, i) => [id, i]));

  // ---- 1. fixos válidos (a ordem de avaliação decide quem fica com um número
  // disputado: quem já estava na ordem anterior tem prioridade; entre quem
  // não estava, vale a ordem PROGRAMADA — base_order, devolvida já ordenada
  // por getEligibleParticipants).
  const fixedCandidates = eligible
    .filter(p => p.positionType === 'fixed' && p.fixedPosition != null)
    .sort((a, b) => {
      const ia = previousIndex.has(a.userId) ? previousIndex.get(a.userId)! : Number.MAX_SAFE_INTEGER;
      const ib = previousIndex.has(b.userId) ? previousIndex.get(b.userId)! : Number.MAX_SAFE_INTEGER;
      return ia - ib;
    });

  const takenSlots = new Map<number, string>();
  for (const candidate of fixedCandidates) {
    const slot = candidate.fixedPosition!;
    if (slot < 1 || slot > total || takenSlots.has(slot)) continue; // vira livre hoje
    takenSlots.set(slot, candidate.userId);
  }
  const fixedIds = new Set(takenSlots.values());

  // ---- 2. livres que já estavam na ordem anterior, na ordem de lá
  const freeFromPrevious = previousIds.filter(id => !fixedIds.has(id));

  // ---- 3. os que não estavam na ordem anterior entram depois do rodízio,
  // entre si na ordem PROGRAMADA (base_order) — é o que `eligible` já
  // reflete, vindo ordenado de getEligibleParticipants.
  const newcomers = eligible
    .filter(p => !fixedIds.has(p.userId) && !previousIndex.has(p.userId))
    .map(p => p.userId);

  const rotated = freeFromPrevious.length > 1
    ? [freeFromPrevious[freeFromPrevious.length - 1], ...freeFromPrevious.slice(0, -1)]
    : freeFromPrevious;

  const freeQueue = [...rotated, ...newcomers];

  // ---- 4. fixos nos números deles, livres nos buracos
  const order: { userId: string; isFixed: boolean }[] = [];
  let freeCursor = 0;
  for (let slot = 1; slot <= total; slot++) {
    const fixedUser = takenSlots.get(slot);
    if (fixedUser) {
      order.push({ userId: fixedUser, isFixed: true });
      continue;
    }
    const nextFree = freeQueue[freeCursor++];
    // Só acontece se a contagem divergir (não deveria): o slot fica sem dono e
    // é descartado no filtro abaixo, em vez de gerar uma linha órfã.
    if (nextFree) order.push({ userId: nextFree, isFixed: false });
  }
  return order;
}

/** Passagem de turno padrão: o primeiro da ordem sem posição fixa. */
function computeAutoHandoff(order: { userId: string; isFixed: boolean }[]): string | null {
  return order.find(o => !o.isFixed)?.userId ?? null;
}

/**
 * Data passada abre somente leitura — e isso precisa valer no servidor, não só
 * na tela: a tela pode estar aberta desde ontem, e a virada da meia-noite não
 * recarrega nada sozinha. Sem esta guarda, quem deixou o Giro aberto de um dia
 * para o outro editaria o dia anterior achando que edita o de hoje.
 */
async function assertDayEditable(dayId: string): Promise<{ ok: true; date: string } | { ok: false; error: string }> {
  const res = await query('SELECT giro_date FROM public.giro_days WHERE id = $1', [dayId]);
  if (!res.rows[0]) return { ok: false, error: 'Giro não encontrado.' };
  const date = toDateOnly(res.rows[0].giro_date);
  const today = toDateOnly(await getTodaySP());
  if (date < today) return { ok: false, error: 'Este dia já passou e está disponível somente para consulta.' };
  return { ok: true, date };
}

/** Mesma guarda, a partir da linha (o dia é descoberto por ela). */
export async function assertRowEditable(rowId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await query('SELECT day_id FROM public.giro_day_rows WHERE id = $1', [rowId]);
  if (!res.rows[0]) return { ok: false, error: 'Linha não encontrada.' };
  const check = await assertDayEditable(res.rows[0].day_id);
  return check.ok ? { ok: true } : check;
}

export async function assertDayWritable(dayId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const check = await assertDayEditable(dayId);
  return check.ok ? { ok: true } : check;
}

/** Mesma guarda, a partir do registro de histórico. */
export async function assertHistoryEditable(historyId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await query('SELECT day_id FROM public.giro_history WHERE id = $1', [historyId]);
  if (!res.rows[0]) return { ok: false, error: 'Registro não encontrado.' };
  const check = await assertDayEditable(res.rows[0].day_id);
  return check.ok ? { ok: true } : check;
}

// ------------------------------------------------------------------- leitura

async function loadRows(dayId: string, handoffUserId: string | null): Promise<GiroRow[]> {
  // NUNCA `p.avatar_url` numa listagem: é a foto inteira em `data:` URL
  // base64 (até ~2,7MB cada), e essa consulta roda a cada abertura do Giro —
  // é o mesmo motivo documentado em app/api/users/route.ts. `has_avatar`
  // vira só um link pra rota que serve a imagem sob demanda
  // (/api/users/[id]/avatar), e a miniatura (~1,3kB) continua embutida.
  const res = await query(
    `SELECT r.*, p.name, p.avatar_thumb_url,
            (p.avatar_url IS NOT NULL AND p.avatar_url <> '') AS has_avatar
       FROM public.giro_day_rows r
       JOIN public.profiles p ON p.id = r.user_id
      WHERE r.day_id = $1
      ORDER BY r.position ASC`,
    [dayId]
  );
  return res.rows.map(r => ({
    id: r.id,
    userId: r.user_id,
    userName: r.name,
    avatarUrl: r.has_avatar ? `/api/users/${r.user_id}/avatar` : null,
    avatarThumbUrl: r.avatar_thumb_url,
    position: r.position,
    serviceType: r.service_type as GiroServiceType,
    serviceTime: r.service_time,
    note: r.note,
    lunchTime: r.lunch_time,
    checklist: r.checklist || {},
    workSchedule: r.work_schedule,
    isFixed: r.is_fixed,
    isHandoff: r.user_id === handoffUserId,
    completedCount: r.completed_count
  }));
}

async function loadHistory(dayId: string): Promise<GiroHistoryEntry[]> {
  const res = await query(
    `SELECT id, user_id, user_name, service_type, service_time, note, created_at
       FROM public.giro_history WHERE day_id = $1 ORDER BY created_at ASC`,
    [dayId]
  );
  return res.rows.map(r => ({
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    serviceType: r.service_type as GiroServiceType,
    serviceTime: r.service_time,
    note: r.note,
    createdAt: r.created_at.toISOString()
  }));
}

async function hydrateDay(dayRow: any, isReadOnly: boolean): Promise<GiroDay> {
  const [rows, history] = await Promise.all([
    loadRows(dayRow.id, dayRow.handoff_user_id),
    loadHistory(dayRow.id)
  ]);
  return {
    id: dayRow.id,
    date: toDateOnly(dayRow.giro_date),
    handoffMode: dayRow.handoff_mode,
    handoffUserId: dayRow.handoff_user_id,
    rows,
    history,
    isReadOnly,
    exists: true
  };
}

/**
 * Abre o giro de uma data, gerando-o se necessário.
 *
 * Data passada nunca é gerada nem regerada: se não existe giro naquele dia,
 * é porque naquele dia não houve — inventar um agora, com o cadastro de hoje,
 * seria fabricar histórico.
 */
export async function getGiroDay(dateStr: string): Promise<GiroDay> {
  if (!isValidDate(dateStr)) throw new Error('Data inválida.');

  const today = toDateOnly(await getTodaySP());
  const isPast = dateStr < today;

  const existing = await query('SELECT * FROM public.giro_days WHERE giro_date = $1::date', [dateStr]);
  if (existing.rows[0]) return hydrateDay(existing.rows[0], isPast);

  if (isPast) {
    return {
      id: '', date: dateStr, handoffMode: 'none', handoffUserId: null,
      rows: [], history: [], isReadOnly: true, exists: false
    };
  }

  await generateDay(dateStr);
  const created = await query('SELECT * FROM public.giro_days WHERE giro_date = $1::date', [dateStr]);
  // Se ainda assim não existe, não havia ninguém elegível — devolve o dia
  // vazio em vez de estourar, e a tela explica que falta cadastrar gente.
  if (!created.rows[0]) {
    return {
      id: '', date: dateStr, handoffMode: 'none', handoffUserId: null,
      rows: [], history: [], isReadOnly: false, exists: false
    };
  }
  return hydrateDay(created.rows[0], false);
}

// ------------------------------------------------------------------- geração

/**
 * Cria o giro de uma data. Não faz nada se o dia já existir — a checagem final
 * é o ON CONFLICT, não um SELECT anterior, para aguentar duas requisições
 * simultâneas.
 */
async function generateDay(dateStr: string): Promise<void> {
  const eligible = await getEligibleParticipants(dateStr);
  if (eligible.length === 0) return;

  const previousOrder = await getPreviousOrder(dateStr);
  const order = buildOrder(eligible, previousOrder);
  if (order.length === 0) return;

  const handoffUserId = computeAutoHandoff(order);
  const byId = new Map(eligible.map(p => [p.userId, p]));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO public.giro_days (giro_date, handoff_mode, handoff_user_id)
       VALUES ($1::date, 'auto', $2)
       ON CONFLICT (giro_date) DO NOTHING
       RETURNING id`,
      [dateStr, handoffUserId]
    );
    // Alguém criou o dia entre o SELECT e este INSERT — a outra requisição
    // usou exatamente o mesmo algoritmo, então basta desistir desta.
    if (!inserted.rows[0]) {
      await client.query('ROLLBACK');
      return;
    }

    const dayId = inserted.rows[0].id;
    for (let i = 0; i < order.length; i++) {
      const entry = order[i];
      await client.query(
        `INSERT INTO public.giro_day_rows (day_id, user_id, position, work_schedule, is_fixed)
         VALUES ($1, $2, $3, $4, $5)`,
        [dayId, entry.userId, i + 1, byId.get(entry.userId)?.workSchedule ?? null, entry.isFixed]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reprocessar: reaplica posições fixas, ausências e participantes novos sobre
 * o dia que já existe.
 *
 * Recusa em dois casos, que a tela também bloqueia mas que precisam valer no
 * servidor: data passada (só recarrega) e dia que já tem atendimento
 * concluído — o histórico do dia é a prova de que a ordem já foi usada de
 * verdade, e reordenar depois disso bagunçaria a vez de quem já atendeu.
 */
export async function reprocessDay(dateStr: string): Promise<{ error?: string }> {
  if (!isValidDate(dateStr)) return { error: 'Data inválida.' };

  const today = toDateOnly(await getTodaySP());
  if (dateStr < today) return { error: 'Datas passadas não são reprocessadas.' };

  const dayRes = await query('SELECT * FROM public.giro_days WHERE giro_date = $1::date', [dateStr]);
  const day = dayRes.rows[0];
  if (!day) {
    await generateDay(dateStr);
    return {};
  }

  const historyCount = await query('SELECT COUNT(*)::int AS total FROM public.giro_history WHERE day_id = $1', [day.id]);
  if (historyCount.rows[0].total > 0) {
    return { error: 'Este dia já tem atendimentos concluídos e não pode ser reprocessado.' };
  }

  const eligible = await getEligibleParticipants(dateStr);
  const previousOrder = await getPreviousOrder(dateStr);
  const order = buildOrder(eligible, previousOrder);
  const byId = new Map(eligible.map(p => [p.userId, p]));

  // Estado do dia que sobrevive ao reprocessamento, para quem continua na
  // ordem. Checklist e almoço porque valem o dia todo (e refazê-los é
  // trabalho perdido); o atendimento em andamento porque nenhuma regra pede
  // para descartá-lo, e apagar a observação que alguém está escrevendo seria
  // perda de dado silenciosa; completed_count porque reflete trabalho já
  // feito de verdade hoje — zerar puniria quem já atendeu antes do
  // reprocessamento.
  const currentRows = await query('SELECT * FROM public.giro_day_rows WHERE day_id = $1', [day.id]);
  const preserved = new Map(currentRows.rows.map(r => [r.user_id, r]));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Quem deixou de fazer parte sai; os demais são reposicionados. O DELETE
    // vem antes para não esbarrar no UNIQUE (day_id, user_id) ao reinserir.
    await client.query('DELETE FROM public.giro_day_rows WHERE day_id = $1', [day.id]);

    for (let i = 0; i < order.length; i++) {
      const entry = order[i];
      const old = preserved.get(entry.userId);
      await client.query(
        `INSERT INTO public.giro_day_rows
           (day_id, user_id, position, service_type, service_time, note, lunch_time, checklist, work_schedule, is_fixed, completed_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          day.id, entry.userId, i + 1,
          old?.service_type ?? 'Chamado',
          old?.service_time ?? null,
          old?.note ?? null,
          old?.lunch_time ?? null,
          old?.checklist ?? {},
          byId.get(entry.userId)?.workSchedule ?? null,
          entry.isFixed,
          old?.completed_count ?? 0
        ]
      );
    }

    await refreshHandoff(client, day.id);
    await client.query('COMMIT');
    return {};
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ------------------------------------------------------------ passagem de turno

/**
 * Recalcula a passagem SÓ quando ela está em 'auto'. Fixada à mão ou removida
 * de propósito, a escolha do usuário manda — é o que separa os três estados de
 * handoff_mode.
 */
async function refreshHandoff(client: any, dayId: string): Promise<void> {
  const day = await client.query('SELECT handoff_mode FROM public.giro_days WHERE id = $1', [dayId]);
  if (day.rows[0]?.handoff_mode !== 'auto') return;

  const first = await client.query(
    `SELECT user_id FROM public.giro_day_rows
      WHERE day_id = $1 AND is_fixed = false ORDER BY position ASC LIMIT 1`,
    [dayId]
  );
  await client.query(
    'UPDATE public.giro_days SET handoff_user_id = $1 WHERE id = $2',
    [first.rows[0]?.user_id ?? null, dayId]
  );
}

export async function setHandoff(dayId: string, mode: 'auto' | 'pinned' | 'none', userId?: string | null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (mode === 'pinned') {
      if (!userId) throw new Error('Informe quem assume a passagem.');
      const belongs = await client.query(
        'SELECT 1 FROM public.giro_day_rows WHERE day_id = $1 AND user_id = $2',
        [dayId, userId]
      );
      if (!belongs.rows[0]) throw new Error('Essa pessoa não está no giro deste dia.');
      await client.query(
        `UPDATE public.giro_days SET handoff_mode = 'pinned', handoff_user_id = $1 WHERE id = $2`,
        [userId, dayId]
      );
    } else if (mode === 'none') {
      await client.query(
        `UPDATE public.giro_days SET handoff_mode = 'none', handoff_user_id = NULL WHERE id = $1`,
        [dayId]
      );
    } else {
      await client.query(`UPDATE public.giro_days SET handoff_mode = 'auto' WHERE id = $1`, [dayId]);
      await refreshHandoff(client, dayId);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ------------------------------------------------------------------- edição

/**
 * Edita a linha do dia. Campo ausente no payload não é tocado — assim a tela
 * pode salvar só o que mudou sem apagar o resto por omissão.
 *
 * Regra da hora automática: trocar o tipo ou escrever observação com a hora
 * vazia preenche a hora com o horário atual. Fica aqui, e não na tela, porque
 * os dois pontos de entrada (a tela do Giro e o popover de status) precisam se
 * comportar igual.
 */
export async function updateRow(
  rowId: string,
  patch: {
    serviceType?: GiroServiceType;
    serviceTime?: string | null;
    note?: string | null;
    lunchTime?: string | null;
    checklist?: Record<string, boolean>;
  }
): Promise<void> {
  const current = await query('SELECT * FROM public.giro_day_rows WHERE id = $1', [rowId]);
  const row = current.rows[0];
  if (!row) throw new Error('Linha não encontrada.');

  const nextType = patch.serviceType ?? row.service_type;
  const nextNote = patch.note !== undefined ? patch.note : row.note;
  let nextTime = patch.serviceTime !== undefined ? patch.serviceTime : row.service_time;

  const typeChanged = patch.serviceType !== undefined && patch.serviceType !== row.service_type;
  const noteFilled = patch.note !== undefined && !!patch.note?.trim();
  // `patch.serviceTime` explicitamente vazio é o usuário limpando o campo de
  // propósito — nesse caso não se repõe a hora por cima.
  const timeUntouched = patch.serviceTime === undefined;
  if ((typeChanged || noteFilled) && timeUntouched && !nextTime) {
    nextTime = await getCurrentTimeSP();
  }

  await query(
    `UPDATE public.giro_day_rows
        SET service_type = $1, service_time = $2, note = $3, lunch_time = $4, checklist = $5
      WHERE id = $6`,
    [
      nextType,
      nextTime || null,
      nextNote || null,
      patch.lunchTime !== undefined ? patch.lunchTime : row.lunch_time,
      patch.checklist !== undefined ? JSON.stringify(patch.checklist) : row.checklist,
      rowId
    ]
  );
}

/**
 * Concluir atendimento — as coisas acontecem juntas ou nenhuma acontece (daí a
 * transação): grava no histórico (com a posição de origem, pra dar pra
 * desfazer depois), soma 1 na contagem de atendimentos do dia, limpa a linha
 * e reposiciona pela REGRA DE JUSTIÇA: quem tem MENOS atendimentos concluídos
 * hoje vai na frente.
 *
 * Isso não é "sempre pro fim físico da lista" — é "pro fim do grupo de quem
 * tem contagem igual ou menor". Na prática, pra uma pessoa que só concluiu
 * uma vez, dá exatamente no mesmo lugar de sempre (o fim). A diferença
 * aparece quando alguém conclui 2 vezes seguidas sem que mais ninguém tenha
 * atendido no meio: aí essa pessoa entra na "fila dos que já concluíram 2",
 * atrás de todo mundo que ainda está em 0 ou 1 — e só volta a ser a vez dela
 * quando o resto do time alcançar a mesma contagem. Ver repositionByFairness.
 *
 * O que NÃO é limpo: checklist e almoço, que valem o dia inteiro.
 *
 * A passagem de turno não é recalculada aqui de propósito. Concluir atendimento
 * é o evento mais frequente do dia; recalcular a cada conclusão faria o
 * responsável pela passagem trocar de nome a toda hora, quando o que a regra
 * manda recalcular é geração e reordenação manual.
 */
export async function completeService(rowId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `SELECT r.*, p.name FROM public.giro_day_rows r
         JOIN public.profiles p ON p.id = r.user_id
        WHERE r.id = $1 FOR UPDATE OF r`,
      [rowId]
    );
    const row = res.rows[0];
    if (!row) throw new Error('Linha não encontrada.');

    const horaAtual = await client.query(
      `SELECT to_char(NOW() AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS hora`
    );

    await client.query(
      `INSERT INTO public.giro_history (day_id, user_id, user_name, service_type, service_time, note, position_before)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [row.day_id, row.user_id, row.name, row.service_type, row.service_time || horaAtual.rows[0].hora, row.note, row.position]
    );

    const newCount = row.completed_count + 1;
    await client.query(
      `UPDATE public.giro_day_rows
          SET service_type = 'Chamado', service_time = NULL, note = NULL, completed_count = $1
        WHERE id = $2`,
      [newCount, rowId]
    );

    await repositionByFairness(client, row.day_id, row.id, newCount);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * "Assumir" um chamado Sem Analista consome a vez do analista no Giro — pro
 * Giro é o mesmo evento que concluir um atendimento (registra no histórico e
 * manda pro fim da ordem): ele acabou de pegar um trabalho fora do walk-in
 * normal, então segue igual quem já atendeu.
 *
 * Silencioso de propósito, não lança erro: se o analista não participa do
 * Giro hoje (não está cadastrado, está ausente, ou nem existe giro gerado
 * ainda), não é um erro — é só "não se aplica". Quem chama trata como
 * fire-and-forget, porque isto nunca pode atrapalhar o "Assumir" do chamado
 * em si.
 */
export async function skipTurnForTicketClaim(
  userId: string,
  ticketNumber: number | null,
  ticketId: string
): Promise<{ skipped: boolean }> {
  const today = await getTodayDate();
  const day = await query('SELECT id FROM public.giro_days WHERE giro_date = $1::date', [today]);
  if (!day.rows[0]) return { skipped: false };

  const row = await query(
    'SELECT id FROM public.giro_day_rows WHERE day_id = $1 AND user_id = $2',
    [day.rows[0].id, userId]
  );
  if (!row.rows[0]) return { skipped: false };

  const rowId = row.rows[0].id;
  // Mesmo formato "#0000" usado no cabeçalho do chamado (ticket-detail-modal),
  // pra quem olhar o histórico do Giro reconhecer o número na hora.
  const label = `Chamado #${ticketNumber ? String(ticketNumber).padStart(4, '0') : ticketId.slice(0, 8)}`;
  const hora = await getCurrentTimeSP();

  await updateRow(rowId, { serviceType: 'Chamado', serviceTime: hora, note: label });
  await completeService(rowId);
  return { skipped: true };
}

/**
 * Reordenação em duas passadas com deslocamento (+1000): a primeira passada
 * tira todo mundo da faixa 1..N antes de a segunda gravar os valores finais.
 * Sem isso, um UPDATE intermediário pode colidir com uma posição ainda ocupada
 * — hoje não há UNIQUE em (day_id, position), mas depender da ausência de uma
 * constraint para não corromper a ordem seria frágil.
 */
async function writePositions(client: any, dayId: string, orderedRowIds: string[]): Promise<void> {
  for (let i = 0; i < orderedRowIds.length; i++) {
    await client.query(
      'UPDATE public.giro_day_rows SET position = $1 WHERE id = $2 AND day_id = $3',
      [i + 1 + 1000, orderedRowIds[i], dayId]
    );
  }
  await client.query(
    'UPDATE public.giro_day_rows SET position = position - 1000 WHERE day_id = $1 AND position > 1000',
    [dayId]
  );
}

/**
 * Reposiciona pela regra de justiça: insere a linha logo depois da ÚLTIMA
 * outra linha (na ordem atual) cuja completed_count seja <= newCount, e antes
 * de qualquer uma com contagem maior. Efeito prático:
 *
 * - Todo mundo com contagem igual ou menor (inclusive quem está zerado) fica
 *   na frente — eles "devem" menos atendimentos que esta pessoa agora.
 * - Quem já tem contagem MAIOR (concluiu mais vezes ainda) continua atrás —
 *   não faz sentido esta pessoa, que acabou de igualar ou superar, pular na
 *   frente de alguém que deve ainda mais.
 *
 * Com todo mundo em 0 (caso comum, uma conclusão isolada), isto dá exatamente
 * no fim físico da lista — mesmo resultado de sempre. A diferença só aparece
 * quando alguém acumula mais de uma conclusão antes dos outros.
 */
async function repositionByFairness(client: any, dayId: string, rowId: string, newCount: number): Promise<void> {
  const all = await client.query(
    'SELECT id, completed_count FROM public.giro_day_rows WHERE day_id = $1 ORDER BY position ASC',
    [dayId]
  );
  const others = all.rows.filter((r: any) => r.id !== rowId);

  let insertAt = 0;
  for (let i = 0; i < others.length; i++) {
    if (others[i].completed_count <= newCount) insertAt = i + 1;
  }

  const ids = others.map((r: any) => r.id);
  ids.splice(insertAt, 0, rowId);
  await writePositions(client, dayId, ids);
}

/**
 * Move a linha pra uma posição (1-based) específica, deslocando o resto —
 * usado só por deleteHistoryEntry, pra devolver a pessoa exatamente pra onde
 * estava antes de uma conclusão que foi desfeita.
 */
async function moveToPosition(client: any, dayId: string, rowId: string, targetPosition: number): Promise<void> {
  const all = await client.query(
    'SELECT id FROM public.giro_day_rows WHERE day_id = $1 ORDER BY position ASC',
    [dayId]
  );
  const ids = all.rows.map((r: any) => r.id).filter((id: string) => id !== rowId);
  const insertAt = Math.max(0, Math.min(targetPosition - 1, ids.length));
  ids.splice(insertAt, 0, rowId);
  await writePositions(client, dayId, ids);
}

/** Reordenação manual (arrastar e soltar) — aqui a passagem é recalculada. */
export async function reorderDay(dayId: string, orderedRowIds: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM public.giro_day_rows WHERE day_id = $1', [dayId]);
    const existingIds = new Set(existing.rows.map((r: any) => r.id));
    // A lista precisa ser exatamente a mesma, só que em outra ordem: um id
    // desconhecido ou uma linha faltando significa tela desatualizada, e
    // aplicar isso deixaria gente sem posição.
    if (orderedRowIds.length !== existingIds.size || orderedRowIds.some(id => !existingIds.has(id))) {
      throw new Error('A ordem enviada não corresponde ao giro deste dia. Recarregue a tela.');
    }
    await writePositions(client, dayId, orderedRowIds);
    await refreshHandoff(client, dayId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Excluir um registro do histórico DESFAZ a conclusão de verdade: tira 1 da
 * contagem de atendimentos do dia e devolve a linha pra posição exata que ela
 * tinha antes daquela conclusão específica (position_before, gravado no
 * momento em que ela aconteceu) — não é mais o heurístico "se está no fim,
 * manda pra 1º"; agora é o mesmo lugar de onde saiu, ponto.
 *
 * Registro de antes desta migration não tem position_before (fica NULL) —
 * pra esses, cai na regra antiga como fallback, já que não há como saber a
 * posição de origem real.
 */
export async function deleteHistoryEntry(historyId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT * FROM public.giro_history WHERE id = $1', [historyId]);
    const entry = res.rows[0];
    if (!entry) throw new Error('Registro não encontrado.');

    await client.query('DELETE FROM public.giro_history WHERE id = $1', [historyId]);

    if (entry.user_id) {
      const row = await client.query(
        'SELECT id, position, completed_count FROM public.giro_day_rows WHERE day_id = $1 AND user_id = $2',
        [entry.day_id, entry.user_id]
      );
      if (row.rows[0]) {
        const rowId = row.rows[0].id;
        const nextCount = Math.max(0, row.rows[0].completed_count - 1);
        await client.query('UPDATE public.giro_day_rows SET completed_count = $1 WHERE id = $2', [nextCount, rowId]);

        if (entry.position_before != null) {
          await moveToPosition(client, entry.day_id, rowId, entry.position_before);
        } else {
          // Fallback pra registro antigo, sem position_before: regra
          // original (só devolve pra 1º se estiver no fim agora).
          const all = await client.query(
            'SELECT id, user_id FROM public.giro_day_rows WHERE day_id = $1 ORDER BY position ASC',
            [entry.day_id]
          );
          const last = all.rows[all.rows.length - 1];
          if (last && last.user_id === entry.user_id && all.rows.length > 1) {
            const ids = all.rows.map((r: any) => r.id);
            ids.unshift(ids.pop());
            await writePositions(client, entry.day_id, ids);
          }
        }
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ------------------------------------------------- inclusão/remoção no dia

/**
 * Garante que existe uma linha em giro_days para a data, criando uma vazia
 * (handoff 'auto' por padrão do banco, sem responsável ainda) se for a
 * primeira inclusão manual do dia — quando ninguém elegível gerou o giro
 * ainda (cadastro novo, ou todo mundo ausente). Sem isso, incluir a PRIMEIRA
 * pessoa de um dia sem giro nenhum não tinha onde gravar a linha.
 */
async function ensureDayId(dateStr: string): Promise<string> {
  const today = toDateOnly(await getTodaySP());
  if (dateStr < today) throw new Error('Este dia já passou e está disponível somente para consulta.');

  const existing = await query('SELECT id FROM public.giro_days WHERE giro_date = $1::date', [dateStr]);
  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await query(
    `INSERT INTO public.giro_days (giro_date) VALUES ($1::date)
     ON CONFLICT (giro_date) DO NOTHING
     RETURNING id`,
    [dateStr]
  );
  if (inserted.rows[0]) return inserted.rows[0].id;

  // Concorrência: outra requisição criou o dia entre o SELECT e o INSERT
  // acima (mesma proteção de generateDay — ver comentário no topo do arquivo).
  const retry = await query('SELECT id FROM public.giro_days WHERE giro_date = $1::date', [dateStr]);
  return retry.rows[0].id;
}

/**
 * Inclui alguém no giro de uma data, sempre no FIM.
 *
 * Recebe a DATA, não o id do dia: no ponto em que a tela chama isto o dia
 * pode ainda nem existir (giro novo, zero participante elegível até agora) —
 * é esta função quem garante a linha em giro_days antes de inserir.
 *
 * Se a pessoa ainda não é participante do Giro, o cadastro é criado aqui
 * mesmo — a partir daí ela entra nas gerações seguintes normalmente. É o que
 * permite puxar para o dia alguém que nunca tinha entrado no rodízio sem
 * precisar passar antes pela aba de configuração.
 */
export async function addMemberToDay(dateStr: string, userId: string): Promise<{ error?: string }> {
  if (!isValidDate(dateStr)) return { error: 'Data inválida.' };

  const profile = await query('SELECT id, name FROM public.profiles WHERE id = $1', [userId]);
  if (!profile.rows[0]) return { error: 'Usuário não encontrado.' };

  let dayId: string;
  try {
    dayId = await ensureDayId(dateStr);
  } catch (err: any) {
    return { error: err?.message || 'Não foi possível preparar o dia.' };
  }

  const already = await query(
    'SELECT 1 FROM public.giro_day_rows WHERE day_id = $1 AND user_id = $2',
    [dayId, userId]
  );
  if (already.rows[0]) return { error: 'Essa pessoa já está no giro deste dia.' };

  const participant = await query(
    `INSERT INTO public.giro_participants (user_id, base_order)
     VALUES ($1, COALESCE((SELECT MAX(base_order) FROM public.giro_participants), 0) + 1)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
     RETURNING work_schedule`,
    [userId]
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const maxPos = await client.query(
      'SELECT COALESCE(MAX(position), 0) AS max FROM public.giro_day_rows WHERE day_id = $1',
      [dayId]
    );
    await client.query(
      `INSERT INTO public.giro_day_rows (day_id, user_id, position, work_schedule)
       VALUES ($1, $2, $3, $4)`,
      [dayId, userId, Number(maxPos.rows[0].max) + 1, participant.rows[0]?.work_schedule ?? null]
    );
    // Rule 16: incluir manualmente também recalcula a passagem quando ela
    // está em 'auto' — inclusive no caso trivial de ser a primeira pessoa do
    // dia, que passa a ser a passagem por ser a única (e não fixa).
    await refreshHandoff(client, dayId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return {};
}

/**
 * Remover afeta só o dia aberto: no dia seguinte a pessoa volta pela geração
 * automática, a menos que esteja marcada como "fora do rodízio" na
 * configuração. As posições restantes são compactadas para não sobrar buraco.
 */
export async function removeMemberFromDay(dayId: string, rowId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM public.giro_day_rows WHERE id = $1 AND day_id = $2', [rowId, dayId]);
    const rest = await client.query(
      'SELECT id FROM public.giro_day_rows WHERE day_id = $1 ORDER BY position ASC',
      [dayId]
    );
    await writePositions(client, dayId, rest.rows.map((r: any) => r.id));

    // A passagem pode ter saído junto com a pessoa removida. Em 'auto' o
    // refresh resolve; fixada em quem saiu, o dia volta a ficar sem
    // responsável em vez de apontar para alguém que não está mais na ordem.
    const day = await client.query('SELECT handoff_mode, handoff_user_id FROM public.giro_days WHERE id = $1', [dayId]);
    if (day.rows[0]?.handoff_mode === 'pinned' && day.rows[0].handoff_user_id) {
      const stillThere = await client.query(
        'SELECT 1 FROM public.giro_day_rows WHERE day_id = $1 AND user_id = $2',
        [dayId, day.rows[0].handoff_user_id]
      );
      if (!stillThere.rows[0]) {
        await client.query(`UPDATE public.giro_days SET handoff_mode = 'none', handoff_user_id = NULL WHERE id = $1`, [dayId]);
      }
    } else {
      await refreshHandoff(client, dayId);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// -------------------------------------------------------------- configuração

export async function listParticipants(): Promise<GiroParticipant[]> {
  // Mesma regra de sempre: nunca `avatar_url` cru numa lista (ver comentário
  // em loadRows, acima) — essa consulta alimenta a tela de Configuração
  // inteira, era ela a maior responsável pela demora ao abrir.
  const res = await query(
    `SELECT gp.*, p.name, p.avatar_thumb_url,
            (p.avatar_url IS NOT NULL AND p.avatar_url <> '') AS has_avatar,
            (gp.absent_until IS NOT NULL AND gp.absent_until > NOW()) AS is_absent
       FROM public.giro_participants gp
       JOIN public.profiles p ON p.id = gp.user_id
      -- base_order (a ordem programada), não nome: a tela de Configuração
      -- lista assim de propósito, pra bater com a ordem que o drag-and-drop
      -- está editando.
      ORDER BY gp.base_order ASC, p.name ASC`
  );
  return res.rows.map(r => ({
    userId: r.user_id,
    name: r.name,
    avatarUrl: r.has_avatar ? `/api/users/${r.user_id}/avatar` : null,
    avatarThumbUrl: r.avatar_thumb_url,
    workSchedule: r.work_schedule,
    positionType: r.position_type,
    fixedPosition: r.fixed_position,
    baseOrder: r.base_order,
    outOfRotation: r.out_of_rotation,
    absentUntil: r.absent_until ? r.absent_until.toISOString() : null,
    absenceNote: r.absence_note,
    isAbsent: r.is_absent
  }));
}

/**
 * Reordena os participantes LIVRES — a "ordem programada" — a partir do
 * arrastar-e-soltar em Configuração. Recebe a lista inteira na nova ordem;
 * grava base_order = posição na lista (1-based). Não mexe em quem tem posição
 * fixa: esses não entram nesta lista (a ordem deles é o número escolhido,
 * não um índice de lista).
 */
export async function reorderParticipants(orderedUserIds: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < orderedUserIds.length; i++) {
      await client.query(
        'UPDATE public.giro_participants SET base_order = $1, updated_at = now() WHERE user_id = $2',
        [i + 1, orderedUserIds[i]]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cria ou atualiza um participante.
 *
 * Devolve `reinserted: true` quando a remoção da ausência recolocou a pessoa
 * no giro de hoje — a tela usa isso para avisar, já que é um efeito colateral
 * que o usuário não pediu explicitamente ao desmarcar a ausência.
 */
export async function saveParticipant(input: {
  userId: string;
  workSchedule?: string | null;
  positionType?: 'free' | 'fixed';
  fixedPosition?: number | null;
  outOfRotation?: boolean;
  absentUntil?: string | null;
  absenceNote?: string | null;
}): Promise<{ error?: string; reinserted?: boolean }> {
  const profile = await query('SELECT id FROM public.profiles WHERE id = $1', [input.userId]);
  if (!profile.rows[0]) return { error: 'Usuário não encontrado.' };

  const positionType = input.positionType === 'fixed' ? 'fixed' : 'free';
  const fixedPosition = positionType === 'fixed' ? input.fixedPosition ?? null : null;
  if (positionType === 'fixed' && (fixedPosition == null || fixedPosition < 1)) {
    return { error: 'Informe o número da posição fixa (a partir de 1).' };
  }

  // Duas pessoas na mesma posição fixa não faz sentido — bloqueado aqui, na
  // gravação, em vez de só resolvido na hora de gerar o dia (o excedente
  // virando livre). Só entre quem está ATIVO: um out_of_rotation guardando
  // um número antigo não deve travar ninguém.
  if (positionType === 'fixed' && !input.outOfRotation) {
    const conflict = await query(
      `SELECT p.name FROM public.giro_participants gp
         JOIN public.profiles p ON p.id = gp.user_id
        WHERE gp.position_type = 'fixed' AND gp.fixed_position = $1
          AND gp.out_of_rotation = false AND gp.user_id != $2
        LIMIT 1`,
      [fixedPosition, input.userId]
    );
    if (conflict.rows[0]) {
      return { error: `${conflict.rows[0].name} já está na posição fixa ${fixedPosition}º — escolha outro número.` };
    }
  }

  const previous = await query('SELECT absent_until FROM public.giro_participants WHERE user_id = $1', [input.userId]);
  const wasAbsent = !!previous.rows[0]?.absent_until && new Date(previous.rows[0].absent_until) > new Date();

  await query(
    `INSERT INTO public.giro_participants
       (user_id, work_schedule, position_type, fixed_position, out_of_rotation, absent_until, absence_note, base_order, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
             COALESCE((SELECT MAX(base_order) FROM public.giro_participants), 0) + 1,
             now())
     ON CONFLICT (user_id) DO UPDATE SET
       work_schedule = EXCLUDED.work_schedule,
       position_type = EXCLUDED.position_type,
       fixed_position = EXCLUDED.fixed_position,
       out_of_rotation = EXCLUDED.out_of_rotation,
       absent_until = EXCLUDED.absent_until,
       absence_note = EXCLUDED.absence_note,
       updated_at = now()
       -- base_order NÃO entra no UPDATE: só muda de propósito, via
       -- reorderParticipants (arrastar a lista) — nunca como efeito colateral
       -- de salvar outro campo do participante.`,
    [
      input.userId,
      input.workSchedule?.trim() || null,
      positionType,
      fixedPosition,
      !!input.outOfRotation,
      input.absentUntil || null,
      input.absentUntil ? (input.absenceNote?.trim() || null) : null
    ]
  );

  // Ausência retirada à mão hoje: quem voltou entra na hora, no fim do giro do
  // dia — esperar a virada do dia deixaria a pessoa de fora justamente do turno
  // em que ela voltou a trabalhar.
  if (wasAbsent && !input.absentUntil && !input.outOfRotation) {
    const today = toDateOnly(await getTodaySP());
    // addMemberToDay já garante o dia (mesmo que ainda não exista) e já
    // ignora silenciosamente quem já está lá — não precisa checagem prévia.
    const result = await addMemberToDay(today, input.userId);
    if (!result.error) return { reinserted: true };
  }
  return {};
}

/**
 * Tira a pessoa do cadastro do Giro. Os dias já gerados não são tocados: são
 * histórico, e apagar linhas passadas mudaria relatório de período fechado.
 */
export async function deleteParticipant(userId: string): Promise<void> {
  await query('DELETE FROM public.giro_participants WHERE user_id = $1', [userId]);
}

export async function listChecklistItems(includeInactive = false): Promise<GiroChecklistItem[]> {
  const res = await query(
    `SELECT id, label, sort_order, is_active FROM public.giro_checklist_items
      ${includeInactive ? '' : 'WHERE is_active = true'}
      ORDER BY sort_order ASC, label ASC`
  );
  return res.rows.map(r => ({ id: r.id, label: r.label, sortOrder: r.sort_order, isActive: r.is_active }));
}

export async function saveChecklistItem(input: {
  id?: string | null;
  label: string;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<{ error?: string; id?: string }> {
  const label = input.label?.trim();
  if (!label) return { error: 'O nome do item é obrigatório.' };

  try {
    if (input.id) {
      await query(
        `UPDATE public.giro_checklist_items SET label = $1, sort_order = $2, is_active = $3 WHERE id = $4`,
        [label, input.sortOrder ?? 0, input.isActive !== false, input.id]
      );
      return { id: input.id };
    }
    const res = await query(
      `INSERT INTO public.giro_checklist_items (label, sort_order, is_active) VALUES ($1, $2, $3) RETURNING id`,
      [label, input.sortOrder ?? 0, input.isActive !== false]
    );
    return { id: res.rows[0].id };
  } catch (err: any) {
    // 23505 = unique_violation em label
    if (err?.code === '23505') return { error: 'Já existe um item com esse nome.' };
    throw err;
  }
}

/**
 * Exclui o item do cadastro. As marcações já feitas continuam no JSONB das
 * linhas (chave órfã), o que é inofensivo: a tela só desenha os itens que
 * existem hoje. Limpar o JSONB de todos os dias passados custaria uma
 * varredura e reescreveria histórico sem necessidade.
 */
export async function deleteChecklistItem(id: string): Promise<void> {
  await query('DELETE FROM public.giro_checklist_items WHERE id = $1', [id]);
}

// ------------------------------------------------------------------- resumo

export interface GiroSummary {
  date: string;
  exists: boolean;
  /** Primeiro da ordem — de quem é a vez agora. */
  current: GiroRow | null;
  handoffName: string | null;
  rows: GiroRow[];
  history: GiroHistoryEntry[];
  /** Linha do usuário logado, se ele estiver no giro de hoje. */
  myRowId: string | null;
  /** Link da sala de reunião cadastrado em Configuração — null se ninguém cadastrou ainda. */
  meetUrl: string | null;
}

/**
 * Resumo de hoje para o botão de status — a mesma leitura da tela, sem gerar
 * nada de novo além do que `getGiroDay` já geraria ao abrir a data de hoje.
 */
export async function getTodaySummary(currentUserId: string): Promise<GiroSummary> {
  const today = toDateOnly(await getTodaySP());
  const [day, meetUrl] = await Promise.all([getGiroDay(today), getMeetUrl()]);
  return {
    date: today,
    exists: day.exists,
    current: day.rows[0] ?? null,
    handoffName: day.rows.find(r => r.userId === day.handoffUserId)?.userName ?? null,
    rows: day.rows,
    history: day.history,
    myRowId: day.rows.find(r => r.userId === currentUserId)?.id ?? null,
    meetUrl
  };
}

// -------------------------------------------------------------- Meet (sala)

export async function getMeetUrl(): Promise<string | null> {
  const res = await query('SELECT meet_url FROM public.giro_settings WHERE id = $1', ['default']);
  return res.rows[0]?.meet_url || null;
}

export async function saveMeetUrl(meetUrl: string | null): Promise<{ error?: string }> {
  const trimmed = meetUrl?.trim() || null;
  if (trimmed && !/^https?:\/\//i.test(trimmed)) {
    return { error: 'O link precisa começar com http:// ou https://.' };
  }
  await query(
    `INSERT INTO public.giro_settings (id, meet_url, updated_at) VALUES ('default', $1, now())
     ON CONFLICT (id) DO UPDATE SET meet_url = EXCLUDED.meet_url, updated_at = now()`,
    [trimmed]
  );
  return {};
}

// --------------------------------------------------------------- exportação

export interface GiroExportRow {
  date: string;
  position: number;
  userName: string;
  isHandoff: boolean;
  workSchedule: string | null;
  serviceType: string;
  serviceTime: string | null;
  note: string | null;
  lunchTime: string | null;
  checklist: string;
  history: string;
}

/**
 * Exportação de um período: uma linha por analista por dia, com o histórico do
 * próprio analista naquele dia condensado na última coluna (uma linha por
 * atendimento explodiria o arquivo e repetiria checklist e almoço em todas).
 */
export async function exportPeriod(startDate: string, endDate: string): Promise<GiroExportRow[]> {
  if (!isValidDate(startDate) || !isValidDate(endDate)) throw new Error('Período inválido.');
  if (startDate > endDate) throw new Error('A data inicial não pode ser maior que a final.');

  const items = await listChecklistItems(true);
  const itemLabel = new Map(items.map(i => [i.id, i.label]));

  const res = await query(
    `SELECT d.giro_date, d.handoff_user_id, r.user_id, r.position, r.service_type, r.service_time,
            r.note, r.lunch_time, r.checklist, r.work_schedule, p.name
       FROM public.giro_days d
       JOIN public.giro_day_rows r ON r.day_id = d.id
       JOIN public.profiles p ON p.id = r.user_id
      WHERE d.giro_date BETWEEN $1::date AND $2::date
      ORDER BY d.giro_date ASC, r.position ASC`,
    [startDate, endDate]
  );

  const historyRes = await query(
    `SELECT d.giro_date, h.user_id, h.service_type, h.service_time, h.note
       FROM public.giro_days d
       JOIN public.giro_history h ON h.day_id = d.id
      WHERE d.giro_date BETWEEN $1::date AND $2::date
      ORDER BY d.giro_date ASC, h.created_at ASC`,
    [startDate, endDate]
  );

  const historyByKey = new Map<string, string[]>();
  for (const h of historyRes.rows) {
    const key = `${toDateOnly(h.giro_date)}|${h.user_id}`;
    const label = `${h.service_time || '--:--'} ${h.service_type}${h.note ? ` (${h.note})` : ''}`;
    historyByKey.set(key, [...(historyByKey.get(key) || []), label]);
  }

  return res.rows.map(r => {
    const date = toDateOnly(r.giro_date);
    const checked = Object.entries(r.checklist || {})
      .filter(([, v]) => v === true)
      .map(([id]) => itemLabel.get(id) || id);
    return {
      date,
      position: r.position,
      userName: r.name,
      isHandoff: r.user_id === r.handoff_user_id,
      workSchedule: r.work_schedule,
      serviceType: r.service_type,
      serviceTime: r.service_time,
      note: r.note,
      lunchTime: r.lunch_time,
      checklist: checked.join(', '),
      history: (historyByKey.get(`${date}|${r.user_id}`) || []).join(' | ')
    };
  });
}
