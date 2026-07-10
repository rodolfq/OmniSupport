-- ==========================================
-- NUCLEAR FIX V10 - SEQUENCIA DE TICKETS
-- ==========================================

-- 1. CRIAR SEQUÊNCIA PARA NÚMEROS DE TICKET
CREATE SEQUENCE IF NOT EXISTS ticket_number_seq START 1000;

-- 2. GARANTIR QUE A COLUNA public_ticket_number TENHA DEFAULT DA SEQUÊNCIA
-- Primeiro, garantimos que a coluna existe
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'public_ticket_number') THEN
        ALTER TABLE public.tickets ADD COLUMN public_ticket_number INTEGER;
    END IF;
END $$;

-- 3. ALTERAR PARA USAR A SEQUÊNCIA COMO DEFAULT
ALTER TABLE public.tickets ALTER COLUMN public_ticket_number SET DEFAULT nextval('ticket_number_seq');

-- 4. GARANTIR QUE A COLUNA ID (PK) SEJA UUID SE NÃO FOR
-- Se o banco estiver usando TEXT por erro de versoes anteriores, tentamos ajustar ou garantir o default
ALTER TABLE public.tickets ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 5. RE-APLICAR PERMISSÕES DE INSERÇÃO (DEFAULTS)
ALTER TABLE public.tickets ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.tickets ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.tickets ALTER COLUMN status SET DEFAULT 'Novo';
ALTER TABLE public.tickets ALTER COLUMN priority SET DEFAULT 'Baixa';
ALTER TABLE public.tickets ALTER COLUMN category SET DEFAULT 'Geral';

-- 6. NOTIFICAR O POSTGREST PARA RECARREGAR O SCHEMA
NOTIFY pgrst, 'reload schema';
