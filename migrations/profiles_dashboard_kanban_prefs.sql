-- Preferência pessoal do usuário pro board de chamados do Dashboard: ordem
-- das colunas, quais ficam ocultas, e o modo de visualização (kanban/lista).
-- JSONB porque é um blob de UI só do dono, sem necessidade de consulta/índice.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS dashboard_kanban_prefs JSONB;
