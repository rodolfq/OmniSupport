
-- Migration to add absence reasons and status tracking
ALTER TABLE analyst_status ADD COLUMN IF NOT EXISTS current_reason TEXT;

CREATE TABLE IF NOT EXISTS absence_reasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  label TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Insert default reasons
INSERT INTO absence_reasons (label) VALUES 
('Almoço'), ('Reunião'), ('Pessoal'), ('Pausa')
ON CONFLICT (label) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL, -- 'online', 'away', 'offline'
  reason TEXT, -- 'Reunião', 'Almoço', 'Pessoal', etc.
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  duration INTEGER, -- em segundos
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
