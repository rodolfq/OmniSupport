import { query } from '@/lib/db';
import {
  authenticateApiKey,
  isAuthError,
  authErrorResponse,
  requireScope,
  integrationJson,
  integrationError,
} from '@/lib/integration-auth';

// Conversas ENCERRADAS com clientes de empresas "em treinamento", com a data em
// que ocorreram e o motivo (tags de chat: Problema, Dúvida, Solicitação, ...).
// Feita para outra aplicação da empresa consumir por GET, com uma chave de API
// de escopo próprio (`training-conversations:read`) — quem recebe essa chave
// não enxerga as demais conversas nem o conteúdo das mensagens.
//
// Decisões que não devem ser "melhoradas" sem intenção:
//  - "Em treinamento" é a situação ATUAL da empresa (companies.is_in_training),
//    a mesma do filtro da tela Histórico de Conversas. O histórico não guarda o
//    status da época da conversa: empresa que sair do treinamento deixa de
//    aparecer aqui com as conversas antigas dela.
//  - Só sai daqui o que já está em chat_histories (conversa finalizada) e cujo
//    contato está vinculado a um cliente com empresa. Conversa sem vínculo não
//    tem empresa, logo não conta como "de cliente em treinamento".
//  - `date`/`from`/`to` são o DIA em que a conversa COMEÇOU, no horário do
//    Brasil (America/Sao_Paulo) — em UTC uma conversa das 22h cairia no dia
//    seguinte. `startedAt`/`finishedAt` seguem em ISO 8601 (UTC) para quem
//    precisar do instante exato.
//  - `company.isInTraining` vem da própria linha da empresa. Hoje é sempre true (a
//    lista só tem empresa em treinamento), mas fica explícito para quem consome
//    não ter que deduzir o status pelo fato de a conversa estar na lista.
//  - Não devolve telefone, transcrição nem mensagens: o pedido é só quando e
//    por quê. Tag apagada do cadastro depois deixa de aparecer na conversa.
//  - `company.idCentral` (companies.id_central) — id do cliente no sistema
//    "Central", vindo da Planilha de CS (ver seção 10 do CLAUDE.md). Pode vir
//    `null`: nem toda empresa tem a célula preenchida na planilha (2026-09-29:
//    4 das 79 em treinamento). NÃO É ÚNICO — duas empresas podem compartilhar o
//    mesmo id_central quando são marcas/CNPJs diferentes na mesma conta
//    central; quem consome não deve tratá-lo como chave primária.
//  - `summary`/`summaryGeneratedAt` — resumo da conversa gerado por IA (Groq),
//    o mesmo texto que aparece no Histórico de Conversas. Só existe quando o
//    detector de insatisfação está ligado (ENABLE_DISSATISFACTION_DETECTOR) E
//    já processou aquela conversa — por isso ambos vêm `null` com frequência
//    (2026-09-29: 17 de 18 conversas de empresas em treinamento já têm resumo,
//    mas é um job assíncrono, não roda no instante em que a conversa termina).

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isValidDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Compara nome de tag sem diferenciar maiúscula/minúscula nem acento
// ("duvida" acha "Dúvida") — feito em JS porque o lower() do Postgres depende do
// locale do banco e não trata acentuadas de forma confiável.
function normalizeLabel(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

export async function GET(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);
  const scopeError = requireScope(auth, 'training-conversations:read');
  if (scopeError) return scopeError;

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const companyId = searchParams.get('companyId');
  const tagParam = searchParams.get('tag');
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 500);
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

  if (from && !isValidDay(from)) {
    return integrationError(auth, 'VALIDATION_ERROR', 'from precisa ser uma data no formato AAAA-MM-DD (ex.: 2026-09-01).', 400);
  }
  if (to && !isValidDay(to)) {
    return integrationError(auth, 'VALIDATION_ERROR', 'to precisa ser uma data no formato AAAA-MM-DD (ex.: 2026-09-30).', 400);
  }
  if (from && to && from > to) {
    return integrationError(auth, 'VALIDATION_ERROR', 'from não pode ser depois de to.', 400);
  }

  try {
    const tagsRes = await query(`SELECT id::text AS id, label FROM public.config_tags WHERE domain = 'chat' ORDER BY label`);
    const labelById = new Map<string, string>(tagsRes.rows.map((t: any) => [t.id, t.label]));

    const conditions: string[] = [];
    const params: any[] = [];

    if (from) {
      params.push(from);
      conditions.push(`(COALESCE(h.started_at, h.created_at) AT TIME ZONE 'America/Sao_Paulo')::date >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      conditions.push(`(COALESCE(h.started_at, h.created_at) AT TIME ZONE 'America/Sao_Paulo')::date <= $${params.length}::date`);
    }
    if (companyId) {
      params.push(companyId);
      conditions.push(`co.id::text = $${params.length}`);
    }
    if (tagParam) {
      const wanted = tagParam.split(',').map(normalizeLabel).filter(Boolean);
      const ids = tagsRes.rows.filter((t: any) => wanted.includes(normalizeLabel(t.label))).map((t: any) => t.id);
      // Nome que não existe no cadastro é erro de digitação de quem integra:
      // avisar com a lista válida é mais útil do que devolver vazio em silêncio.
      const known = new Set(tagsRes.rows.map((t: any) => normalizeLabel(t.label)));
      const unknown = wanted.filter(w => !known.has(w));
      if (unknown.length > 0 || ids.length === 0) {
        return integrationError(
          auth,
          'VALIDATION_ERROR',
          `Tag desconhecida no parâmetro "tag". Tags disponíveis: ${tagsRes.rows.map((t: any) => t.label).join(', ') || '(nenhuma cadastrada)'}.`,
          400
        );
      }
      params.push(ids);
      conditions.push(`s.tags && $${params.length}::text[]`);
    }

    const baseFrom = `
      FROM public.chat_histories h
      JOIN public.profiles p ON p.id = h.customer_id
      JOIN public.companies co ON co.id = p.company_id AND co.is_in_training = true
      LEFT JOIN public.chat_sessions s ON s.id = h.session_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}`;

    const countRes = await query(`SELECT COUNT(*)::int AS total ${baseFrom}`, params);
    const total = countRes.rows[0]?.total ?? 0;

    const listParams = [...params, limit, offset];
    const res = await query(
      `SELECT h.id, h.session_id, h.customer_name, h.started_at, h.finished_at,
              (COALESCE(h.started_at, h.created_at) AT TIME ZONE 'America/Sao_Paulo')::date::text AS chat_date,
              p.name AS customer_profile_name, co.id AS company_id, co.name AS company_name, co.is_in_training AS company_is_in_training,
              co.id_central, h.summary, h.summary_generated_at, s.tags AS session_tags
       ${baseFrom}
       ORDER BY COALESCE(h.started_at, h.created_at) DESC, h.id
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    const data = res.rows.map((row: any) => ({
      id: row.id,
      sessionId: row.session_id,
      date: row.chat_date,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      company: { id: row.company_id, name: row.company_name, isInTraining: row.company_is_in_training === true, idCentral: row.id_central },
      customerName: row.customer_profile_name || row.customer_name || null,
      summary: row.summary,
      summaryGeneratedAt: row.summary_generated_at,
      tags: ((row.session_tags || []) as string[])
        .filter(id => labelById.has(id))
        .map(id => ({ id, label: labelById.get(id) as string }))
        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    }));

    return integrationJson(auth, {
      data,
      meta: { limit, offset, total, hasMore: offset + data.length < total },
    });
  } catch (error: any) {
    console.error('[integrations/v1/training-conversations] Erro no GET:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao listar as conversas de clientes em treinamento.', 500);
  }
}
