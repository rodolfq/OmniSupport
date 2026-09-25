-- Registro RÍGIDO de criação de usuários: toda linha inserida em public.profiles
-- gera, NA MESMA TRANSAÇÃO, uma linha em public.user_creation_log dizendo quem
-- foi criado e por qual login.
--
-- Por que gatilho no banco e não só código na aplicação: qualquer caminho que
-- crie usuário (tela, chat "Vincular", API de integração, sincronização de
-- planilha/Bitrix24, script) passa por aqui. Não existe como criar um perfil sem
-- deixar rastro, nem caminho futuro esquecido de registrar. E, por ser a mesma
-- transação, se o registro falhar a criação também é desfeita (nunca há usuário
-- sem log).
--
-- Quem criou vem de variáveis de sessão gravadas pela aplicação dentro da
-- transação (lib/db.ts, withCreationContext): app.actor_id (login que criou),
-- app.source (origem: portal, chat, integração...), app.actor_label (quando não
-- há login, ex.: nome da chave de API), app.ip e app.user_agent. O nome, e-mail,
-- papel e empresa de quem criou são lidos DO BANCO pelo gatilho — não dá pra
-- aplicação informar um nome falso. Sem contexto, a linha sai com source
-- 'desconhecido' e sem autor: o registro existe do mesmo jeito.
--
-- A tabela é SOMENTE-INSERÇÃO: gatilhos barram UPDATE, DELETE e TRUNCATE. Os
-- dados de quem foi criado e de quem criou são gravados como FOTO (nome, e-mail,
-- papel), sem chave estrangeira, para o registro sobreviver à exclusão ou edição
-- do usuário depois.
--
-- Aditiva: cria tabela, funções e gatilhos novos; nada do que existe muda.
-- Compatível com Postgres 12 (produção): sem gen_random_uuid() e com
-- EXECUTE PROCEDURE.

CREATE TABLE IF NOT EXISTS public.user_creation_log (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  -- Quem foi criado (foto no momento da criação)
  created_user_id UUID NOT NULL,
  created_user_name TEXT,
  created_user_email TEXT,
  created_user_role TEXT,
  created_user_company_id UUID,
  created_user_company_name TEXT,
  -- Por qual login foi criado (foto). NULL = sem login (sistema/integração/desconhecido)
  created_by_id UUID,
  created_by_name TEXT,
  created_by_email TEXT,
  created_by_role TEXT,
  created_by_company_id UUID,
  -- De onde veio a criação
  source TEXT NOT NULL DEFAULT 'desconhecido',
  actor_label TEXT,
  ip TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_creation_log_created_at ON public.user_creation_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_creation_log_created_by ON public.user_creation_log (created_by_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_creation_log_created_user ON public.user_creation_log (created_user_id);

-- Grava a linha de log a cada perfil criado.
CREATE OR REPLACE FUNCTION public.fn_log_profile_creation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor_id UUID;
  v_actor_name TEXT;
  v_actor_email TEXT;
  v_actor_role TEXT;
  v_actor_company UUID;
  v_company_name TEXT;
BEGIN
  -- current_setting(..., true) devolve NULL se a variável nunca foi definida;
  -- o BEGIN/EXCEPTION cobre um valor que não seja um UUID válido.
  BEGIN
    v_actor_id := NULLIF(current_setting('app.actor_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_actor_id := NULL;
  END;

  IF v_actor_id IS NOT NULL THEN
    SELECT p.name, p.email, p.role, p.company_id
      INTO v_actor_name, v_actor_email, v_actor_role, v_actor_company
      FROM public.profiles p WHERE p.id = v_actor_id;
  END IF;

  SELECT c.name INTO v_company_name FROM public.companies c WHERE c.id = NEW.company_id;

  INSERT INTO public.user_creation_log (
    created_user_id, created_user_name, created_user_email, created_user_role,
    created_user_company_id, created_user_company_name,
    created_by_id, created_by_name, created_by_email, created_by_role, created_by_company_id,
    source, actor_label, ip, user_agent
  ) VALUES (
    NEW.id, NEW.name, NEW.email, NEW.role,
    NEW.company_id, v_company_name,
    v_actor_id, v_actor_name, v_actor_email, v_actor_role, v_actor_company,
    COALESCE(NULLIF(current_setting('app.source', true), ''), 'desconhecido'),
    NULLIF(current_setting('app.actor_label', true), ''),
    NULLIF(current_setting('app.ip', true), ''),
    NULLIF(current_setting('app.user_agent', true), '')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_creation_log ON public.profiles;
CREATE TRIGGER trg_profiles_creation_log
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.fn_log_profile_creation();

-- Somente-inserção.
CREATE OR REPLACE FUNCTION public.fn_user_creation_log_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'user_creation_log é somente-inserção: % não é permitido', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_creation_log_no_change ON public.user_creation_log;
CREATE TRIGGER trg_user_creation_log_no_change
  BEFORE UPDATE OR DELETE ON public.user_creation_log
  FOR EACH ROW EXECUTE PROCEDURE public.fn_user_creation_log_immutable();

DROP TRIGGER IF EXISTS trg_user_creation_log_no_truncate ON public.user_creation_log;
CREATE TRIGGER trg_user_creation_log_no_truncate
  BEFORE TRUNCATE ON public.user_creation_log
  FOR EACH STATEMENT EXECUTE PROCEDURE public.fn_user_creation_log_immutable();
