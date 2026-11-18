-- Duplicação de ticket interno por duplo clique (achado pelo usuário,
-- 2026-11-16): "Criar Ticket Interno" (dentro do chamado) e "Criar ticket"
-- (tela de ticket interno em modo criação) não tinham nenhuma trava contra
-- clique duplo/retry de rede — dois cliques rápidos (ou duas requisições
-- batendo quase ao mesmo tempo) criavam dois registros com o mesmo conteúdo.
--
-- Esta coluna é a chave de idempotência: o client gera um UUID por TENTATIVA
-- de criação (um por abertura do formulário, reaproveitado em todo retry
-- daquela mesma tentativa) e manda em `creationRequestId`. O servidor faz
-- INSERT ... ON CONFLICT (creation_request_id) DO NOTHING e, se a corrida foi
-- perdida (outra requisição com o MESMO id já criou o ticket), devolve o
-- ticket que já existe em vez de criar um segundo ou estourar 500 — ver
-- app/api/internal-tickets/route.ts, action=save.
--
-- NULL é o normal para todo INSERT fora do fluxo de criação pela tela (script
-- ad-hoc, importação) — índice parcial (só sobre valores não-nulos) para
-- várias linhas sem o campo nunca colidirem entre si.
ALTER TABLE public.internal_tickets
  ADD COLUMN IF NOT EXISTS creation_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_internal_tickets_creation_request_id
  ON public.internal_tickets(creation_request_id)
  WHERE creation_request_id IS NOT NULL;
