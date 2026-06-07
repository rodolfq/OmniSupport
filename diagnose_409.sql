-- Diagnostic script to find what's causing 409 conflict on tickets insert
-- Run this in Supabase SQL Editor

-- 1. Check existing triggers on tickets table
SELECT tgname as trigger_name, tgrelid::regclass as table_name
FROM pg_trigger 
WHERE tgrelid = 'public.tickets'::regclass
AND tgname NOT LIKE 'pg_%';

-- 2. Check all functions that might be conflicting
SELECT proname, prosrc 
FROM pg_proc 
WHERE proname LIKE '%ticket%' OR proname LIKE '%trigger%'
AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- 3. Check if there are any row-level policies that could cause conflict
SELECT policyname, cmd 
FROM pg_policies 
WHERE tablename = 'tickets';

-- 4. Check the exact schema of tickets
SELECT column_name, is_nullable, column_default
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'tickets'
ORDER BY ordinal_position;

-- 5. Check for any unique constraints
SELECT conname, consrc 
FROM pg_constraint 
WHERE conrelid = 'public.tickets'::regclass;

-- 6. Try a simple insert to see the exact error
-- INSERT INTO public.tickets (title, description, status, priority, category, customer_id)
-- VALUES ('Test', 'Test description', 'Novo', 'Baixa', 'Geral', '11111111-1111-4111-8111-111111111111'::uuid);