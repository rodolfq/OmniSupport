-- Chat Histories - Stores completed conversation transcripts for internal team access
CREATE TABLE IF NOT EXISTS public.chat_histories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.chat_sessions(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    customer_name TEXT,
    customer_phone TEXT,
    assignee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL, -- Agent who handled it
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    finished_at TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_seconds INTEGER, -- Total conversation duration in seconds
    first_response_seconds INTEGER, -- Time until first analyst response (seconds)
    rating INTEGER CHECK (rating IN (-1, 0, 1)), -- -1 = dislike, 0 = none, 1 = like
    transcript TEXT, -- Full chat transcript
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.chat_histories ENABLE ROW LEVEL SECURITY;

-- Create policies for tickets:read permission
CREATE POLICY "chat_histories_read_policy" ON public.chat_histories
    FOR SELECT USING (true);

CREATE POLICY "chat_histories_insert_policy" ON public.chat_histories
    FOR INSERT WITH CHECK (true);

-- Create index for filtering by date/customer
CREATE INDEX IF NOT EXISTS idx_chat_histories_finished_at ON public.chat_histories(finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_histories_customer_id ON public.chat_histories(customer_id);
CREATE INDEX IF NOT EXISTS idx_chat_histories_session_id ON public.chat_histories(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_histories_assignee_id ON public.chat_histories(assignee_id);

-- Add to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE chat_histories;