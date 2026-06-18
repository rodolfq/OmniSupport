-- Migration: Add internal_chat_messages table for persistent internal chat
-- Internal chat messages storage (separate from ticket messages)

-- Create internal_chat_messages table if not exists
CREATE TABLE IF NOT EXISTS public.internal_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id TEXT REFERENCES public.internal_chats(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_name TEXT,
  text TEXT,
  type TEXT DEFAULT 'text',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_internal_chat_messages_chat_id ON public.internal_chat_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_internal_chat_messages_created_at ON public.internal_chat_messages(created_at DESC);

-- Enable realtime for internal chats
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'internal_chats') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE internal_chats;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'internal_chat_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE internal_chat_messages;
  END IF;
END $$;