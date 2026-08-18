-- Índices que faltavam pros padrões de consulta reais da API de integração
-- (/api/integrations/v1/*): toda listagem ordena por created_at DESC, e a
-- sincronização incremental nova (?updatedSince=) filtra por updated_at —
-- sem índice, essas viram varredura sequencial conforme a tabela cresce.
--
-- idx_tickets_created_at já existe (schema_postgres.sql) — os que faltavam:
CREATE INDEX IF NOT EXISTS idx_tickets_updated_at ON public.tickets(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_created_at ON public.chat_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON public.chat_sessions(updated_at DESC);

-- GET /employees filtra sempre por role IN ('Funcionário','Cliente') e ordena
-- por created_at DESC — índice composto serve as duas coisas de uma vez.
CREATE INDEX IF NOT EXISTS idx_profiles_role_created_at ON public.profiles(role, created_at DESC);
-- GET /employees?companyId= filtra por empresa.
CREATE INDEX IF NOT EXISTS idx_profiles_company_id ON public.profiles(company_id);
