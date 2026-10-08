import { query } from '../db';
import type { MetricsFilter } from '../types';
import { getPeriodBounds } from './metrics-service';

// Indicadores de chamado por analista (responsável atual do chamado), para o Desempenho por Analista.
// Cohort: chamados CRIADOS no período. Backlog é o estado atual, não depende do período.
// Regras (decisões do usuário, 2026-10-06):
// - SLA: prazo da prioridade (config_priorities.sla_hours) em horas úteis (ticket_business_minutes).
//   Cumprido = concluído dentro do prazo. Descumprido = concluído depois, ou ainda aberto com o prazo vencido.
// - Tempo de resposta ao cliente (2026-10-08, era "Mediana da 1ª resposta" — só a 1ª mensagem/1ª
//   resposta do chamado contava): agora TODA mensagem do cliente precisa de resposta visível da
//   equipe dentro da meta, não só a primeira. Por chamado, o "minutos" medido é o PIOR tempo de
//   resposta entre as mensagens já respondidas; mensagem do cliente ainda sem resposta e já além
//   da meta conta como "fora do prazo" mesmo sem latência calculável. Sem nenhum comentário do
//   cliente não há o que medir (fica fora da amostra, igual antes).
// - Nasce resolvido: chamado criado já com status fechado (conta ponto).
// - Reabertura: mudança de um status fechado para um aberto (ticket_status_history).
// - Backlog: chamado aberto com mais de N horas úteis desde a criação (N em regras.backlogHorasUteis).

const TEAM_ROLES = ['Administrador', 'Equipe', 'Time Interno'];
const CLIENT_ROLES = ['Cliente', 'Funcionário'];

export interface TicketPerfRow {
  analystId: string | null; // null = total do time
  analystName: string;
  avatarUrl: string | null;
  chamados: number;
  slaOk: number;
  slaMiss: number;
  slaPendentes: number;
  slaSemHistorico: number;
  frAmostra: number;
  frMedianaMin: number | null;
  frNoPrazo: number;
  frForaPrazo: number;
  nasceramResolvidos: number;
  comHistorico: number;  // chamados com histórico de status (base confiável para nasce-resolvido e reabertura)
  fechados: number;
  reabertos: number;     // chamados com pelo menos uma reabertura
  reaberturas: number;   // eventos de reabertura
}

export async function getTicketPerformance(filter: MetricsFilter, metaPrimeiraRespostaMin: number): Promise<TicketPerfRow[]> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `WITH closed_set AS (
       SELECT label FROM public.config_statuses WHERE scope = 'ticket' AND is_closed AND parent_status_id IS NULL
     ),
     tk AS (
       SELECT t.id, t.assignee_id, t.status, t.created_at, pr.sla_hours,
              p.name AS assignee_name, COALESCE(p.avatar_medium_url, p.avatar_thumb_url) AS avatar,
              EXISTS (SELECT 1 FROM public.ticket_status_history h WHERE h.ticket_id = t.id) AS tem_historico
         FROM public.tickets t
         JOIN public.profiles p ON p.id = t.assignee_id AND p.role = ANY($4::text[])
         LEFT JOIN public.config_priorities pr ON pr.label = t.priority
        WHERE t.created_at >= $1::timestamptz AND t.created_at < $2::timestamptz
          -- Chamado mesclado não é atendimento concluído: sai do SLA, da 1ª resposta e da reabertura.
          AND t.status <> 'Mesclado' AND t.merged_into_id IS NULL
     ),
     closed_at AS (
       SELECT h.ticket_id, MIN(h.changed_at) AS at
         FROM public.ticket_status_history h
        WHERE h.to_status IN (SELECT label FROM closed_set)
          AND h.ticket_id IN (SELECT id FROM tk)
        GROUP BY h.ticket_id
     ),
     sla AS (
       SELECT tk.id,
         CASE
           WHEN tk.sla_hours IS NULL THEN 'sem_prazo'
           WHEN ca.at IS NOT NULL THEN
             CASE WHEN public.ticket_business_minutes(tk.created_at, ca.at) <= tk.sla_hours * 60 THEN 'ok' ELSE 'miss' END
           WHEN tk.status IN (SELECT label FROM closed_set) THEN 'sem_historico'
           WHEN public.ticket_business_minutes(tk.created_at, now()) > tk.sla_hours * 60 THEN 'miss'
           ELSE 'pendente'
         END AS sla_state
         FROM tk
         LEFT JOIN closed_at ca ON ca.ticket_id = tk.id
     ),
     -- "Tempo de resposta ao cliente" (2026-10-08, era "Mediana da 1ª resposta"):
     -- TODA mensagem do cliente precisa de resposta da equipe dentro da meta,
     -- não só a primeira do chamado. client_msgs/team_msgs listam cada
     -- mensagem; pares casa cada mensagem do cliente com a PRÓXIMA resposta
     -- visível da equipe depois dela (NULL = ainda sem resposta).
     client_msgs AS (
       SELECT m.ticket_id, m.created_at AS at
         FROM public.ticket_messages m
         JOIN public.profiles p ON p.id = m.author_id AND p.role = ANY($5::text[])
        WHERE m.type = 'text' AND m.ticket_id IN (SELECT id FROM tk)
     ),
     team_msgs AS (
       SELECT m.ticket_id, m.created_at AS at
         FROM public.ticket_messages m
         JOIN public.profiles p ON p.id = m.author_id AND p.role = ANY($4::text[])
        WHERE m.type = 'text' AND m.is_visible_to_customer = true AND m.ticket_id IN (SELECT id FROM tk)
     ),
     pares AS (
       SELECT cm.ticket_id, cm.at AS client_at,
         (SELECT MIN(tm.at) FROM team_msgs tm WHERE tm.ticket_id = cm.ticket_id AND tm.at > cm.at) AS reply_at
         FROM client_msgs cm
     ),
     fr AS (
       -- minutos = o PIOR tempo de resposta do chamado, entre as mensagens do
       -- cliente já respondidas (não a média/1ª — o objetivo é que NENHUMA
       -- mensagem estoure o prazo, não só a primeira).
       -- tem_pendencia_vencida = existe mensagem do cliente AINDA sem resposta
       -- e já além da meta (chamado fechado sem responder conta sempre;
       -- aberto só conta quando "agora" já passou do prazo — mesmo padrão de
       -- 'pendente' usado no SLA do chamado acima).
       SELECT p.ticket_id,
         MAX(EXTRACT(EPOCH FROM (p.reply_at - p.client_at)) / 60) FILTER (WHERE p.reply_at IS NOT NULL) AS minutos,
         bool_or(
           p.reply_at IS NULL
           AND EXTRACT(EPOCH FROM (COALESCE(ca.at, NOW()) - p.client_at)) / 60 > $3::float
         ) AS tem_pendencia_vencida
         FROM pares p
         LEFT JOIN closed_at ca ON ca.ticket_id = p.ticket_id
        GROUP BY p.ticket_id
     ),
     born AS (
       SELECT DISTINCT h.ticket_id
         FROM public.ticket_status_history h
        WHERE h.from_status IS NULL AND h.to_status IN (SELECT label FROM closed_set)
          AND h.ticket_id IN (SELECT id FROM tk)
     ),
     reab AS (
       SELECT h.ticket_id, COUNT(*)::int AS n
         FROM public.ticket_status_history h
        WHERE h.from_status IN (SELECT label FROM closed_set)
          AND h.to_status NOT IN (SELECT label FROM closed_set)
          AND h.ticket_id IN (SELECT id FROM tk)
        GROUP BY h.ticket_id
     ),
     base AS (
       SELECT tk.assignee_id, tk.assignee_name, tk.avatar,
              s.sla_state, f.minutos, COALESCE(f.tem_pendencia_vencida, false) AS tem_pendencia_vencida,
              (b.ticket_id IS NOT NULL) AS nasceu_resolvido,
              (ca.at IS NOT NULL) AS fechado,
              tk.tem_historico,
              COALESCE(r.n, 0) AS reaberturas
         FROM tk
         JOIN sla s ON s.id = tk.id
         LEFT JOIN fr f ON f.ticket_id = tk.id
         LEFT JOIN born b ON b.ticket_id = tk.id
         LEFT JOIN closed_at ca ON ca.ticket_id = tk.id
         LEFT JOIN reab r ON r.ticket_id = tk.id
     )
     SELECT assignee_id,
            MAX(assignee_name) AS analyst_name,
            MAX(avatar) AS avatar,
            COUNT(*)::int AS chamados,
            COUNT(*) FILTER (WHERE sla_state = 'ok')::int AS sla_ok,
            COUNT(*) FILTER (WHERE sla_state = 'miss')::int AS sla_miss,
            COUNT(*) FILTER (WHERE sla_state = 'pendente')::int AS sla_pendentes,
            COUNT(*) FILTER (WHERE sla_state = 'sem_historico')::int AS sla_sem_historico,
            -- Amostra/no-prazo/fora-prazo agora também contam mensagem do cliente
            -- ainda sem resposta e já vencida como "fora do prazo", mesmo sem um
            -- "minutos" calculado (não dá pra medir latência de quem nunca respondeu).
            COUNT(*) FILTER (WHERE minutos IS NOT NULL OR tem_pendencia_vencida)::int AS fr_amostra,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY minutos))::float AS fr_mediana_min,
            COUNT(*) FILTER (WHERE NOT tem_pendencia_vencida AND minutos <= $3::float)::int AS fr_no_prazo,
            COUNT(*) FILTER (WHERE tem_pendencia_vencida OR minutos > $3::float)::int AS fr_fora_prazo,
            COUNT(*) FILTER (WHERE nasceu_resolvido)::int AS nasceram_resolvidos,
            COUNT(*) FILTER (WHERE tem_historico)::int AS com_historico,
            COUNT(*) FILTER (WHERE fechado)::int AS fechados,
            COUNT(*) FILTER (WHERE reaberturas > 0)::int AS reabertos,
            COALESCE(SUM(reaberturas), 0)::int AS reaberturas,
            GROUPING(assignee_id) AS is_total
       FROM base
      GROUP BY GROUPING SETS ((assignee_id), ())`,
    [bounds.startUtc, bounds.endUtcExclusive, metaPrimeiraRespostaMin, TEAM_ROLES, CLIENT_ROLES]
  );

  return res.rows.map(r => ({
    analystId: r.is_total === 1 ? null : r.assignee_id,
    analystName: r.is_total === 1 ? 'Time' : (r.analyst_name ?? 'Removido'),
    avatarUrl: r.avatar ?? null,
    chamados: r.chamados,
    slaOk: r.sla_ok,
    slaMiss: r.sla_miss,
    slaPendentes: r.sla_pendentes,
    slaSemHistorico: r.sla_sem_historico,
    frAmostra: r.fr_amostra,
    frMedianaMin: r.fr_mediana_min === null ? null : Number(r.fr_mediana_min),
    frNoPrazo: r.fr_no_prazo,
    frForaPrazo: r.fr_fora_prazo,
    nasceramResolvidos: r.nasceram_resolvidos,
    comHistorico: r.com_historico,
    fechados: r.fechados,
    reabertos: r.reabertos,
    reaberturas: r.reaberturas,
  }));
}

// Backlog atual: chamados abertos com mais de `horasUteis` horas úteis desde a criação. Não depende do período.
// Retorna contagem por responsável (null = sem responsável) e o total do time.
export async function getTicketBacklog(horasUteis: number): Promise<{ porAnalista: Map<string, number>; total: number }> {
  const res = await query(
    `WITH closed_set AS (
       SELECT label FROM public.config_statuses WHERE scope = 'ticket' AND is_closed AND parent_status_id IS NULL
     ),
     abertos AS (
       SELECT t.assignee_id
         FROM public.tickets t
        WHERE t.status NOT IN (SELECT label FROM closed_set)
          AND public.ticket_business_minutes(t.created_at, now()) > $1::float * 60
     )
     SELECT assignee_id, COUNT(*)::int AS n, GROUPING(assignee_id) AS is_total
       FROM abertos
      GROUP BY GROUPING SETS ((assignee_id), ())`,
    [horasUteis]
  );
  const porAnalista = new Map<string, number>();
  let total = 0;
  for (const r of res.rows) {
    if (r.is_total === 1) total = Number(r.n);
    else if (r.assignee_id) porAnalista.set(r.assignee_id, Number(r.n));
  }
  return { porAnalista, total };
}
