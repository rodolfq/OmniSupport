import { query } from '../db';

// Índice de complexidade do TICKET INTERNO (0-100), calculado a partir de
// sinais que o sistema já registra sozinho — nada aqui depende de alguém
// preencher campo.
//
// Por que um índice objetivo, se existe o campo "Esforço" preenchido à mão:
// os dois servem a propósitos diferentes e um calibra o outro. O campo é a
// opinião de quem resolveu (e só existe se a pessoa preencheu); o índice é
// medível, existe para 100% dos tickets e é comparável entre pessoas.
// Onde os dois discordam de forma sistemática, ou o critério de preenchimento
// está frouxo ou o índice está mal calibrado — os dois casos interessam.
//
// ------------------------------------------------------------------ Sinais
//
// Peso total 100, distribuído entre cinco sinais independentes:
//
//   Mensagens trocadas .............. 25   volume de discussão
//   Pessoas distintas envolvidas .... 15   quantas cabeças o caso exigiu
//   Chamados de cliente vinculados .. 25   alcance: quantos clientes dependem
//   Tempo em aberto ................. 20   quanto tempo ficou de pé
//   SLA estourado ................... 15   passou do prazo calculado
//
// Cada sinal contínuo satura num teto (ver as constantes abaixo): um ticket
// com 200 mensagens não é 10x mais complexo que um com 20 — passado certo
// ponto o sinal já disse o que tinha pra dizer. Sem saturação, um único
// outlier achataria toda a escala.
//
// -------------------------------------------------------- O que ficou fora
//
// Dois sinais que eu queria e o schema ainda não permite:
//   - nº de reatribuições ("ping-pong"): internal_tickets.assignee_id guarda
//     só o responsável ATUAL. A troca existe apenas como texto livre numa
//     mensagem de sistema, o que não é base confiável pra métrica.
//   - reaberturas: exigiria histórico de status, que também não existe.
// Ambos entram de graça no dia em que houver uma tabela de eventos.
//
// O tempo em aberto usa updated_at como aproximação de "quando concluiu" —
// internal_tickets não tem closed_at. Para ticket concluído e editado depois,
// essa referência desloca. Aproximação assumida, documentada aqui e na tela.

export const COMPLEXITY_WEIGHTS = {
  messages: 25,
  participants: 15,
  linkedTickets: 25,
  duration: 20,
  slaBreached: 15
} as const;

// Tetos de saturação de cada sinal contínuo.
export const COMPLEXITY_CAPS = {
  /** 20 mensagens já caracteriza uma discussão longa. */
  messages: 20,
  /** Além do autor original, 4 pessoas distintas é muita gente num ticket. */
  extraParticipants: 4,
  /** 3 chamados de cliente dependendo do mesmo ticket já é alcance alto. */
  linkedTickets: 3,
  /** 15 dias em aberto satura o sinal de duração. */
  durationDays: 15
} as const;

export interface ComplexitySignals {
  messageCount: number;
  participantCount: number;
  linkedTicketCount: number;
  durationDays: number;
  slaBreached: boolean;
}

export interface ComplexityBreakdown extends ComplexitySignals {
  score: number;
  parts: {
    messages: number;
    participants: number;
    linkedTickets: number;
    duration: number;
    slaBreached: number;
  };
}

function ratio(value: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.max(0, Math.min(value / cap, 1));
}

export function computeComplexity(signals: ComplexitySignals): ComplexityBreakdown {
  const parts = {
    messages: ratio(signals.messageCount, COMPLEXITY_CAPS.messages) * COMPLEXITY_WEIGHTS.messages,
    // O primeiro participante é o próprio autor — não diz nada sobre
    // complexidade, então a escala começa a contar do segundo.
    participants: ratio(Math.max(0, signals.participantCount - 1), COMPLEXITY_CAPS.extraParticipants) * COMPLEXITY_WEIGHTS.participants,
    linkedTickets: ratio(signals.linkedTicketCount, COMPLEXITY_CAPS.linkedTickets) * COMPLEXITY_WEIGHTS.linkedTickets,
    duration: ratio(signals.durationDays, COMPLEXITY_CAPS.durationDays) * COMPLEXITY_WEIGHTS.duration,
    slaBreached: signals.slaBreached ? COMPLEXITY_WEIGHTS.slaBreached : 0
  };

  return {
    ...signals,
    parts,
    score: Math.round(
      parts.messages + parts.participants + parts.linkedTickets + parts.duration + parts.slaBreached
    )
  };
}

export type ComplexityBand = 'baixa' | 'media' | 'alta';

export function complexityBand(score: number): ComplexityBand {
  if (score >= 60) return 'alta';
  if (score >= 30) return 'media';
  return 'baixa';
}

export interface InternalTicketComplexityRow extends ComplexityBreakdown {
  id: string;
  internalTicketNumber: number;
  title: string;
  status: string;
  isClosed: boolean;
  priority: number;
  assigneeId: string | null;
  assigneeName: string | null;
  teamName: string | null;
  hotfixName: string | null;
  effortLabel: string | null;
  effortWeight: number | null;
  outcomeLabel: string | null;
  countsAsDefect: boolean;
  slaLimit: string | null;
  createdAt: string;
  updatedAt: string;
}

// Uma query só para todos os tickets internos do período. Os agregados por
// mensagem e por vínculo saem de subselects correlacionados em vez de JOIN +
// GROUP BY: com JOIN, um ticket com 30 mensagens multiplicaria as linhas antes
// do agrupamento e qualquer outra contagem sairia inflada.
export async function getInternalTicketComplexity(
  startDate: string,
  endDate: string
): Promise<InternalTicketComplexityRow[]> {
  const res = await query(
    `SELECT i.id,
            i.internal_ticket_number,
            i.title,
            i.status,
            i.priority,
            i.assignee_id,
            i.internal_team_id,
            i.sla_limit,
            i.created_at,
            i.updated_at,
            p.name  AS assignee_name,
            tm.name AS team_name,
            h.name  AS hotfix_name,
            e.label AS effort_label,
            e.weight AS effort_weight,
            o.label AS outcome_label,
            COALESCE(o.counts_as_defect, false) AS counts_as_defect,
            COALESCE(cs.is_closed, false) AS is_closed,
            (SELECT count(*) FROM public.internal_ticket_messages m
              WHERE m.internal_ticket_id = i.id AND m.type NOT IN ('system', 'system_log')) AS message_count,
            (SELECT count(DISTINCT m.author_id) FROM public.internal_ticket_messages m
              WHERE m.internal_ticket_id = i.id AND m.author_id IS NOT NULL
                AND m.type NOT IN ('system', 'system_log')) AS participant_count,
            (SELECT count(*) FROM public.ticket_internal_links l
              WHERE l.internal_ticket_id = i.id) AS linked_ticket_count
     FROM public.internal_tickets i
     LEFT JOIN public.profiles p ON p.id = i.assignee_id
     LEFT JOIN public.internal_teams tm ON tm.id = i.internal_team_id
     LEFT JOIN public.hotfixes h ON h.id = i.hotfix_id
     LEFT JOIN public.config_effort_levels e ON e.id = i.effort_id
     LEFT JOIN public.config_outcomes o ON o.id = i.outcome_id
     LEFT JOIN public.config_statuses cs ON cs.label = i.status AND cs.scope = 'internal_ticket'
     WHERE i.created_at >= $1::date AND i.created_at < ($2::date + INTERVAL '1 day')`,
    [startDate, endDate]
  );

  return res.rows.map((r: any) => {
    const isClosed = !!r.is_closed;
    // Ticket aberto conta o tempo até agora; concluído, até a última alteração.
    const endMs = isClosed ? new Date(r.updated_at).getTime() : Date.now();
    const durationDays = Math.max(0, (endMs - new Date(r.created_at).getTime()) / 86400000);
    // Mesma referência do tempo: comparar o SLA com "agora" num ticket já
    // concluído marcaria como estourado todo ticket antigo, mesmo o que foi
    // entregue dentro do prazo.
    const slaBreached = r.sla_limit ? endMs > new Date(r.sla_limit).getTime() : false;

    const breakdown = computeComplexity({
      messageCount: Number(r.message_count) || 0,
      participantCount: Number(r.participant_count) || 0,
      linkedTicketCount: Number(r.linked_ticket_count) || 0,
      durationDays,
      slaBreached
    });

    return {
      ...breakdown,
      id: r.id,
      internalTicketNumber: r.internal_ticket_number,
      title: r.title,
      status: r.status,
      isClosed,
      priority: Number(r.priority) || 1,
      assigneeId: r.assignee_id || null,
      assigneeName: r.assignee_name || null,
      teamName: r.team_name || null,
      hotfixName: r.hotfix_name || null,
      effortLabel: r.effort_label || null,
      effortWeight: r.effort_weight !== null && r.effort_weight !== undefined ? Number(r.effort_weight) : null,
      outcomeLabel: r.outcome_label || null,
      countsAsDefect: !!r.counts_as_defect,
      slaLimit: r.sla_limit ? new Date(r.sla_limit).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString()
    };
  });
}
