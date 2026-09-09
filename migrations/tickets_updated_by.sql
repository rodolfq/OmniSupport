-- Quem fez a última edição de campo no chamado (status, responsável, etc.).
-- Sem isso, o polling de notificações (app/api/notifications/check/route.ts)
-- não tinha como saber que o próprio usuário foi quem fechou/assumiu o
-- chamado, e mandava a notificação de volta pra ele mesmo.
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
