-- Migration: Fix internal_tickets schema for TEXT-based IDs
-- Run this if you have existing TEXT IDs

-- Drop the existing internal_tickets table if it uses wrong types
DROP TABLE IF EXISTS ticket_internal_links CASCADE;
DROP TABLE IF EXISTS internal_tickets CASCADE;

-- Create internal_tickets with TEXT id (consistent with tickets table)
CREATE TABLE internal_tickets (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  team_id TEXT,
  assignee_id TEXT, -- Removed FK to avoid type mismatch
  priority INTEGER DEFAULT 1,
  tags TEXT[] DEFAULT '{}',
  creator_id TEXT, -- Removed FK to avoid type mismatch
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  sla_limit TIMESTAMP WITH TIME ZONE
);

-- Create N:N link table with TEXT for ticket_id
CREATE TABLE ticket_internal_links (
  ticket_id TEXT REFERENCES tickets(id) ON DELETE CASCADE,
  internal_ticket_id TEXT PRIMARY KEY REFERENCES internal_tickets(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Update role_permissions to include Time Interno
INSERT INTO role_permissions (name, role, permissions) VALUES
  ('Time Interno', 'Time Interno', ARRAY['internal:view', 'internal:edit']::TEXT[])
ON CONFLICT (name) DO UPDATE SET permissions = EXCLUDED.permissions;