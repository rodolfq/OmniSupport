-- Migration for internal_ticket_messages table
-- Execute this SQL in Supabase SQL Editor

-- Create internal_ticket_messages table (compatible with text-based internal_tickets.id)
CREATE TABLE IF NOT EXISTS public.internal_ticket_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    internal_ticket_id TEXT REFERENCES public.internal_tickets(id) ON DELETE CASCADE,
    author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    attachments_data JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_internal_ticket_messages_ticket_id ON public.internal_ticket_messages(internal_ticket_id);
CREATE INDEX IF NOT EXISTS idx_internal_ticket_messages_created_at ON public.internal_ticket_messages(created_at);

-- Disable RLS (recommended for development)
ALTER TABLE public.internal_ticket_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_tickets DISABLE ROW LEVEL SECURITY;

-- Permissive policies (in case RLS is re-enabled)
DROP POLICY IF EXISTS "internal_ticket_messages_all" ON public.internal_ticket_messages;
CREATE POLICY "internal_ticket_messages_all" ON public.internal_ticket_messages 
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "internal_tickets_all" ON public.internal_tickets;
CREATE POLICY "internal_tickets_all" ON public.internal_tickets 
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Enable realtime
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'internal_ticket_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE internal_ticket_messages;
  END IF;
END $$;