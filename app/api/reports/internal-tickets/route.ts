import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { resolvePeriod } from '@/lib/report-period';
import { getTicketConfig } from '@/lib/services/ticket-points-service';

// Relatório de Tickets Internos — o trabalho do time de desenvolvimento, com
// controle de entrega. Responde:
//   1. quantos tickets entraram, quantos foram resolvidos e quantos seguem em aberto
//   2. quantos foram entregues no prazo e quantos atrasaram (campo late_delivery, gravado ao virar Resolvido)
//   3. quantos foram reprovados em QA (manual, sem pontuação — só indicativo)
//   4. a regra de 2 dias: ticket com prioridade (estrelas) acima do mínimo que não virou
//      Resolvido dentro do prazo em dias úteis. Só sinaliza, não gera pontos.
//
// Regra de 2 dias: tempo medido em MINUTOS ÚTEIS (ticket_business_minutes: 08h–18h, seg a sex)
// desde a criação até virar Resolvido (ou até agora, se ainda não resolvido). Cada dia útil
// tem 600 minutos, então o limite é diasUteis * 600. Configuração em Configurações > Pontuação
// do Ranking > Ticket interno (lib/ticket-points.ts, grupo 'interno').
//
// O período filtra pela DATA DE CRIAÇÃO (horário de Brasília), mesma regra do Carga e Complexidade.
//
// Acesso: reports:internal (Administrador sempre).

const MINUTOS_UTEIS_POR_DIA = 600;

async function getActor(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  if (!token) return null;
  const decoded = await verifyJWT(token);
  if (!decoded?.id) return null;
  const result = await query(
    `SELECT p.id, p.role, COALESCE(rp.permissions, '{}'::text[]) AS permissions
     FROM public.profiles p
     LEFT JOIN public.role_permissions rp ON rp.id = p.access_profile_id
     WHERE p.id = $1`,
    [decoded.id]
  );
  return result.rows[0] || null;
}

function isAuthorized(actor: any): boolean {
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes('reports:internal');
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round1(n: number | null): number | null {
  return n === null ? null : Math.round(n * 10) / 10;
}

type SituacaoRegra ='nao_aplica' | 'em_prazo' | 'em_atencao' | 'cumpriu' | 'descumpriu' | 'encerrado';

interface TicketBase {
  id: string;
  numero: number;
  titulo: string;
  status: string;
  subStatus: string | null;
  estrelas: number;
  equipeId: string | null;
  equipe: string | null;
  responsavelId: string | null;
  responsavel: string | null;
  criadoEm: string;
  entregaReal: string | null;
  qaReprovado: boolean;
  atrasado: boolean;
  encerrado: boolean;
  minutosUteis: number;
  situacaoRegra: SituacaoRegra;
}

const ORDEM_SITUACAO: Record<SituacaoRegra, number> = {
  em_atencao: 0,
  descumpriu: 1,
  em_prazo: 2,
  cumpriu: 3,
  encerrado: 4,
  nao_aplica: 5,
};

export async function GET(request: NextRequest) {
  const actor = await getActor(request);
  if (!actor) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (!isAuthorized(actor)) return NextResponse.json({ error: 'Sem permissão para ver este relatório.' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'overview';
  if (action === 'status-time') return statusTime(searchParams);
  if (action !== 'overview') {
    return NextResponse.json({ error: `Action não suportada: ${action}` }, { status: 400 });
  }

  try {
    const { startDate, endDate } = await resolvePeriod(searchParams);
    const record = await getTicketConfig();
    const regra = record.config.interno;
    const limiteMinutos = regra.diasUteis * MINUTOS_UTEIS_POR_DIA;

    // Uma linha por ticket interno criado no período. minutos úteis já sai do banco:
    // até resolved_at quando resolvido, senão até agora (o relógio da regra continua correndo).
    const res = await query(
      `SELECT i.id, i.internal_ticket_number, i.title, i.status, i.sub_status, i.priority,
              i.created_at, i.resolved_at, i.qa_rejected, i.late_delivery,
              COALESCE(cs.is_closed, false) AS is_closed,
              p.id AS assignee_id, p.name AS assignee_name,
              -- Fila (2026-11-13); ticket antigo, sem fila, fica pela equipe.
              COALESCE(iq.id, tm.id) AS team_id, COALESCE(iq.name, tm.name) AS team_name,
              ticket_business_minutes(i.created_at, COALESCE(i.resolved_at, NOW())) AS minutos_uteis
       FROM public.internal_tickets i
       LEFT JOIN public.profiles p ON p.id = i.assignee_id
       LEFT JOIN public.internal_teams tm ON tm.id = i.internal_team_id
       LEFT JOIN public.internal_ticket_queues iq ON iq.id = i.internal_queue_id
       LEFT JOIN public.config_statuses cs
              ON cs.label = i.status AND cs.scope = 'internal_ticket' AND cs.parent_status_id IS NULL
       WHERE (i.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $1::date AND $2::date`,
      [startDate, endDate]
    );

    const todos: TicketBase[] = res.rows.map((r: any) => {
      const estrelas = Number(r.priority ?? 1);
      const minutos = Number(r.minutos_uteis ?? 0);
      const resolvido = !!r.resolved_at;
      const encerrado = !!r.is_closed;
      let situacaoRegra: SituacaoRegra;
      if (estrelas < regra.estrelasMinimas) situacaoRegra = 'nao_aplica';
      else if (resolvido) situacaoRegra = minutos <= limiteMinutos ? 'cumpriu' : 'descumpriu';
      else if (encerrado) situacaoRegra = 'encerrado';
      else situacaoRegra = minutos > limiteMinutos ? 'em_atencao' : 'em_prazo';

      return {
        id: r.id,
        numero: Number(r.internal_ticket_number),
        titulo: r.title,
        status: r.status,
        subStatus: r.sub_status ?? null,
        estrelas,
        equipeId: r.team_id ?? null,
        equipe: r.team_name ?? null,
        responsavelId: r.assignee_id ?? null,
        responsavel: r.assignee_name ?? null,
        criadoEm: new Date(r.created_at).toISOString(),
        entregaReal: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
        qaReprovado: !!r.qa_rejected,
        atrasado: resolvido && !!r.late_delivery,
        encerrado,
        minutosUteis: minutos,
        situacaoRegra,
      };
    });

    // Opções dos filtros de equipe e responsável saem do período INTEIRO, antes dos
    // filtros aplicados, senão escolher uma equipe esvaziaria a lista de responsáveis.
    const equipesMap = new Map<string, string>();
    const responsaveisMap = new Map<string, string>();
    for (const t of todos) {
      if (t.equipeId && t.equipe) equipesMap.set(t.equipeId, t.equipe);
      if (t.responsavelId && t.responsavel) responsaveisMap.set(t.responsavelId, t.responsavel);
    }
    const opcoes = {
      equipes: [...equipesMap].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
      responsaveis: [...responsaveisMap].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    };

    const teamIdFilter = searchParams.get('teamId');
    const assigneeIdFilter = searchParams.get('assigneeId');
    const filtrados = todos.filter(t =>
      (!teamIdFilter || t.equipeId === teamIdFilter) &&
      (!assigneeIdFilter || t.responsavelId === assigneeIdFilter)
    );

    // KPIs do período filtrado.
    const resolvidos = filtrados.filter(t => t.entregaReal !== null);
    const noPrazo = resolvidos.filter(t => !t.atrasado);
    const emAberto = filtrados.filter(t => !t.entregaReal && !t.encerrado);
    const kpis = {
      criados: filtrados.length,
      resolvidos: resolvidos.length,
      emAberto: emAberto.length,
      noPrazo: noPrazo.length,
      noPrazoPct: resolvidos.length === 0 ? null : noPrazo.length / resolvidos.length,
      atrasados: resolvidos.length - noPrazo.length,
      qaReprovados: filtrados.filter(t => t.qaReprovado).length,
      emAtencao: filtrados.filter(t => t.situacaoRegra === 'em_atencao').length,
      descumpriram: filtrados.filter(t => t.situacaoRegra === 'descumpriu').length,
      medianaHorasUteis: round1(median(resolvidos.map(t => t.minutosUteis / 60))),
    };

    // Uma linha por responsável (sem responsável entra como "Sem responsável").
    const porResponsavel = new Map<string, TicketBase[]>();
    for (const t of filtrados) {
      const chave = t.responsavelId ?? '__sem__';
      const lista = porResponsavel.get(chave) ?? [];
      lista.push(t);
      porResponsavel.set(chave, lista);
    }
    const analistas = [...porResponsavel.entries()].map(([chave, lista]) => {
      const resolv = lista.filter(t => t.entregaReal !== null);
      const noPrazoLista = resolv.filter(t => !t.atrasado);
      return {
        responsavelId: chave === '__sem__' ? null : chave,
        responsavel: chave === '__sem__' ? 'Sem responsável' : (lista[0].responsavel ?? 'Sem responsável'),
        criados: lista.length,
        resolvidos: resolv.length,
        noPrazo: noPrazoLista.length,
        atrasados: resolv.length - noPrazoLista.length,
        qaReprovados: lista.filter(t => t.qaReprovado).length,
        emAberto: lista.filter(t => !t.entregaReal && !t.encerrado).length,
        emAtencao: lista.filter(t => t.situacaoRegra === 'em_atencao').length,
        descumpriram: lista.filter(t => t.situacaoRegra === 'descumpriu').length,
        medianaHorasUteis: round1(median(resolv.map(t => t.minutosUteis / 60))),
      };
    }).sort((a, b) => (b.emAtencao - a.emAtencao) || (b.criados - a.criados) || a.responsavel.localeCompare(b.responsavel, 'pt-BR'));

    const tickets = [...filtrados]
      .map(t => ({ ...t, horasUteis: round1(t.minutosUteis / 60) }))
      .sort((a, b) => (ORDEM_SITUACAO[a.situacaoRegra] - ORDEM_SITUACAO[b.situacaoRegra]) || (b.numero - a.numero));

    return NextResponse.json({
      regra: {
        estrelasMinimas: regra.estrelasMinimas,
        diasUteis: regra.diasUteis,
        limiteMinutos,
      },
      kpis,
      analistas,
      tickets,
      opcoes,
    });
  } catch (error: any) {
    if (error?.code === '42P01' || error?.code === '42883') {
      return NextResponse.json({ error: 'Relatório indisponível neste banco (migração pendente).' }, { status: 503 });
    }
    console.error('[reports/internal-tickets] Erro:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Tempo por status e sub-status, por fila (2026-11-23,
// migrations/internal_ticket_status_periods.sql).
//
// Regras (decididas com o usuário):
// - Média e mediana usam só trechos ENCERRADOS cujo fim caiu no período (horário
//   de Brasília): é o tempo que o ticket de fato levou para sair daquele status.
// - Trechos "desde a implantação" (since_deploy) ficam fora das médias: o ticket
//   já estava no status antes de o registro começar, então o tempo medido é menor
//   que o real.
// - Status FECHADOS (config_statuses.is_closed) não entram: ficar em "Concluído"
//   não é tempo de trabalho.
// - "Agora" = tickets que estão neste status neste momento (independe do período),
//   com o mais antigo deles, para achar quem está parado.
// - Fila = a fila em que o ticket estava NAQUELE trecho; ticket antigo sem fila
//   cai na equipe (mesma regra do resto do relatório) e, sem as duas, em "Sem fila".
// - Dois relógios: corrido (24h/dia) e útil (08h–18h, seg a sex).
// ---------------------------------------------------------------------------
async function statusTime(searchParams: URLSearchParams) {
  try {
    const { startDate, endDate } = await resolvePeriod(searchParams);
    const res = await query(
      `SELECT p.internal_ticket_id, p.status, p.sub_status, p.started_at, p.ended_at, p.since_deploy,
              COALESCE(p.queue_id, i.internal_team_id) AS group_id,
              COALESCE(q.name, CASE WHEN p.queue_id IS NULL THEN tm.name END, 'Sem fila') AS group_name,
              EXTRACT(EPOCH FROM (COALESCE(p.ended_at, now()) - p.started_at)) AS seconds,
              public.ticket_business_minutes(p.started_at, COALESCE(p.ended_at, now())) AS business_minutes
         FROM public.internal_ticket_status_periods p
         JOIN public.internal_tickets i ON i.id = p.internal_ticket_id
         LEFT JOIN public.internal_ticket_queues q ON q.id = p.queue_id
         LEFT JOIN public.internal_teams tm ON tm.id = i.internal_team_id
        WHERE NOT EXISTS (
                SELECT 1 FROM public.config_statuses cs
                 WHERE cs.scope = 'internal_ticket' AND cs.parent_status_id IS NULL
                   AND cs.label = p.status AND cs.is_closed
              )
          AND (
                p.ended_at IS NULL
                OR (NOT p.since_deploy
                    AND (p.ended_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $1::date AND $2::date)
              )`,
      [startDate, endDate]
    );

    const teamIdFilter = searchParams.get('teamId');
    type Acc = {
      filaId: string | null; fila: string; status: string; subStatus: string | null;
      horas: number[]; horasUteis: number[]; tickets: Set<string>;
      agora: number; agoraMaisAntigoHoras: number | null; agoraMaisAntigoUteis: number | null;
    };
    const groups = new Map<string, Acc>();
    const filasMap = new Map<string, string>();

    for (const r of res.rows as any[]) {
      const filaId: string | null = r.group_id ?? null;
      if (filaId) filasMap.set(filaId, r.group_name);
      if (teamIdFilter && filaId !== teamIdFilter) continue;
      const sub = r.sub_status || null;
      const key = `${filaId ?? '__sem__'}|${r.status}|${sub ?? ''}`;
      const acc: Acc = groups.get(key) ?? {
        filaId, fila: r.group_name, status: r.status, subStatus: sub,
        horas: [], horasUteis: [], tickets: new Set<string>(),
        agora: 0, agoraMaisAntigoHoras: null, agoraMaisAntigoUteis: null,
      };
      const horas = Math.max(0, Number(r.seconds) || 0) / 3600;
      const horasUteis = Math.max(0, Number(r.business_minutes) || 0) / 60;
      if (r.ended_at) {
        // Trecho de menos de 1 min é artefato (status e sub-status gravados em
        // duas etapas seguidas), não passagem de verdade: não entra na média.
        if (horas * 60 < 1) { groups.set(key, acc); continue; }
        acc.horas.push(horas);
        acc.horasUteis.push(horasUteis);
        acc.tickets.add(r.internal_ticket_id);
      } else {
        acc.agora += 1;
        if (acc.agoraMaisAntigoHoras === null || horas > acc.agoraMaisAntigoHoras) {
          acc.agoraMaisAntigoHoras = horas;
          acc.agoraMaisAntigoUteis = horasUteis;
        }
      }
      groups.set(key, acc);
    }

    const media = (v: number[]) => (v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length);
    const linhas = [...groups.values()].map(g => ({
      filaId: g.filaId,
      fila: g.fila,
      status: g.status,
      subStatus: g.subStatus,
      passagens: g.horas.length,
      tickets: g.tickets.size,
      mediaHoras: round1(media(g.horas)),
      medianaHoras: round1(median(g.horas)),
      mediaHorasUteis: round1(media(g.horasUteis)),
      medianaHorasUteis: round1(median(g.horasUteis)),
      agora: g.agora,
      agoraMaisAntigoHoras: round1(g.agoraMaisAntigoHoras),
      agoraMaisAntigoUteis: round1(g.agoraMaisAntigoUteis),
    })).sort((a, b) =>
      a.fila.localeCompare(b.fila, 'pt-BR')
      || a.status.localeCompare(b.status, 'pt-BR')
      || (a.subStatus ?? '').localeCompare(b.subStatus ?? '', 'pt-BR')
    );

    return NextResponse.json({
      linhas,
      opcoes: {
        filas: [...filasMap].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
      },
    });
  } catch (error: any) {
    if (error?.code === '42P01' || error?.code === '42883') {
      return NextResponse.json({ error: 'Tempo por status indisponível neste banco (migração pendente).' }, { status: 503 });
    }
    console.error('[reports/internal-tickets status-time] Erro:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
