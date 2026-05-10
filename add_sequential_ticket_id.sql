-- Migration: Add sequential public ticket number
-- 1. Create a sequence for tickets
CREATE SEQUENCE IF NOT EXISTS public.ticket_seq START 1;

-- 2. Add the column to tickets table
ALTER TABLE public.tickets 
ADD COLUMN IF NOT EXISTS public_ticket_number BIGINT DEFAULT nextval('public.ticket_seq');

-- 3. Backfill existing tickets (might need careful ordering, assuming created_at ordering for now)
WITH OrderedTickets AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as rn
  FROM public.tickets
)
UPDATE public.tickets
SET public_ticket_number = OrderedTickets.rn
FROM OrderedTickets
WHERE tickets.id = OrderedTickets.id;

-- 4. Set the sequence to the next value based on the current maximum
-- Note: This might not work perfectly with existing data if not run carefully.
-- After backfilling, let's set the sequence correctly.
DO $$
DECLARE
  max_val BIGINT;
BEGIN
  SELECT MAX(public_ticket_number) INTO max_val FROM public.tickets;
  IF max_val IS NULL THEN max_val := 0; END IF;
  EXECUTE 'ALTER SEQUENCE public.ticket_seq RESTART WITH ' || (max_val + 1);
END $$;

-- 5. Add constraints
ALTER TABLE public.tickets ALTER COLUMN public_ticket_number SET NOT NULL;
ALTER TABLE public.tickets ADD CONSTRAINT unique_ticket_number UNIQUE (public_ticket_number);

-- 6. Indices (for fast searching/ordering)
CREATE INDEX IF NOT EXISTS idx_tickets_public_number ON public.tickets(public_ticket_number);
