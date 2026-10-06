-- Valores de exemplo da pontuação de chamados, com base em referências de mercado
-- (ver lib/ticket-points.ts). Substitui os valores iniciais da migração ticket_points_config.sql.
--
-- Só atualiza a linha que nunca foi alterada por um usuário (updated_by IS NULL). Se alguém já
-- salvou uma configuração pela tela, ela não é sobrescrita.
--
-- Aditiva e idempotente. Para reverter: UPDATE para os valores anteriores (ver migrations/ticket_points_config.sql).

UPDATE public.ticket_points_config
   SET config = '{"metas":{"slaPct":90,"primeiraRespostaMin":60,"resolucaoPrimeiroContatoPct":70,"backlogMax":20,"reaberturaPct":5},"regras":{"backlogHorasUteis":48,"amostraMinima":10},"pontos":{"slaCumprido":10,"slaDescumprido":-15,"primeiraRespostaNoPrazo":5,"primeiraRespostaForaPrazo":-5,"resolvidoPrimeiroContato":10,"backlog":-2,"reabertura":-10}}'::jsonb,
       updated_at = now()
 WHERE id = 1 AND updated_by IS NULL;
