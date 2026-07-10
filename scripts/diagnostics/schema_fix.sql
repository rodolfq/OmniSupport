-- Drop existing functions with exact signatures
DROP FUNCTION IF EXISTS public.create_user_account(TEXT,TEXT,TEXT,TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.admin_delete_user(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.admin_update_user_password(TEXT,TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- Drop existing tables  
DROP TABLE IF EXISTS public.whatsapp_instances CASCADE;
DROP TABLE IF EXISTS public.ticket_attachments CASCADE;
DROP TABLE IF EXISTS public.ticket_messages CASCADE;
DROP TABLE IF EXISTS public.tickets CASCADE;
DROP TABLE IF EXISTS public.chat_messages CASCADE;
DROP TABLE IF EXISTS public.chat_participants CASCADE;
DROP TABLE IF EXISTS public.chat_sessions CASCADE;
DROP TABLE IF EXISTS public.analyst_status CASCADE;
DROP TABLE IF EXISTS public.user_status_history CASCADE;
DROP TABLE IF EXISTS public.absence_reasons CASCADE;
DROP TABLE IF EXISTS public.whatsapp_sessions CASCADE;
DROP TABLE IF EXISTS public.config_categories CASCADE;
DROP TABLE IF EXISTS public.config_priorities CASCADE;
DROP TABLE IF EXISTS public.config_tags CASCADE;
DROP TABLE IF EXISTS public.config_statuses CASCADE;
DROP TABLE IF EXISTS public.quick_notes CASCADE;
DROP TABLE IF EXISTS public.queues CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.companies CASCADE;
DROP TABLE IF EXISTS public.internal_tickets CASCADE;
DROP TABLE IF EXISTS public.internal_chats CASCADE;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';