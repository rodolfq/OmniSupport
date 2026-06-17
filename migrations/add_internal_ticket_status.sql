-- Migration to add status column to internal_tickets
ALTER TABLE public.internal_tickets ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Novo';

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_internal_tickets_status ON public.internal_tickets(status);

-- Update existing records to have status if null
UPDATE public.internal_tickets SET status = 'Novo' WHERE status IS NULL;