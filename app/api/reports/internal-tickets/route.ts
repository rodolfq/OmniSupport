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
              tm.id AS team_id, tm.name AS team_name,
              ticket_business_minutes(i.created_at, COALESCE(i.resolved_at, NOW())) AS minutos_uteis
       FROM public.internal_tickets i
       LEFT JOIN public.profiles p ON p.id = i.assignee_id
       LEFT JOIN public.internal_teams tm ON tm.id = i.internal_team_id
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
