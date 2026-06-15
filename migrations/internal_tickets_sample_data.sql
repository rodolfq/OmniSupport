-- =========================================================================
-- Internal Tickets - Sample Data for Testing
-- Execute this after running supabase_schema.sql
-- =========================================================================

-- Test internal tickets for link-internal-ticket-modal testing
INSERT INTO public.internal_tickets (title, description, team_id, priority, tags) VALUES
  ('Corrigir bug no checkout do carrinho', 'O cálculo do frete está incorreto quando há cupom de desconto', 'Desenvolvimento', 3, ARRAY['Bug', 'Urgente']),
  ('Otimizar queries de relatórios', 'Reduzir tempo de resposta dos relatórios mensais de 30s para 5s', 'Infraestrutura', 2, ARRAY['Performance']),
  ('Teste de integração WhatsApp', 'Verificar falhas na entrega de mensagens em massa', 'QA', 2, ARRAY['Teste']),
  ('Nova feature: Chatbot automático', 'Implementar resposta automática para perguntas frequentes', 'Produto', 1, ARRAY['Melhoria']),
  ('Atualizar documentação da API', 'Revisar endpoints de autenticação e adicionar exemplos', 'Desenvolvimento', 1, ARRAY['Documentação']);

-- =========================================================================
-- Users Search History Table Setup
-- =========================================================================
-- This is auto-created by supabase_schema.sql, but if you need to re-create:
-- CREATE TABLE public.user_search_history (
--   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
--   query TEXT NOT NULL,
--   created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
-- );
-- CREATE INDEX idx_user_search_history_user_id ON public.user_search_history(user_id);

-- =========================================================================
-- Saved Views Table Setup  
-- =========================================================================
-- CREATE TABLE public.saved_views (
--   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
--   name TEXT NOT NULL,
--   filters JSONB NOT NULL,
--   created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
-- );
-- CREATE INDEX idx_saved_views_user_id ON public.saved_views(user_id);

-- =========================================================================
-- Example: Create a saved view for "My Tickets"
-- =========================================================================
-- INSERT INTO public.saved_views (user_id, name, filters) VALUES
--   ('your-user-uuid-here', 'Meus Chamados', '{"assigneeId": "your-user-uuid-here"}');