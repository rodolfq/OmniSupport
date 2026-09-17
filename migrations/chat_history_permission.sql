-- Histórico de Conversas (/chat-history) estava travado por role fixo
-- (Administrador/Equipe) direto no componente, sem nenhuma Permission
-- correspondente — um perfil de acesso de Time Interno não tinha como
-- ganhar esse acesso, não importa quantas permissões o admin marcasse nele
-- (achado em 2026-09-17). Agora usa Permission.CHAT_HISTORY_VIEW
-- ('chat:history') como qualquer outra tela.
--
-- Backfill: concede a quem hoje é 'Equipe' (preserva o acesso que já
-- funcionava, sem regressão). Administrador já tem tudo automaticamente
-- (lib/nav-items.ts#getUserPermissions), não precisa de UPDATE aqui. Time
-- Interno NUNCA teve acesso a esta tela antes — fica de fora do backfill de
-- propósito; quem precisar (ex.: uma equipe de "Suporte" via Time Interno)
-- ganha explicitamente em Configurações > Permissões, não por default.
UPDATE public.role_permissions
SET permissions = array_append(permissions, 'chat:history')
WHERE id IN (
  SELECT DISTINCT access_profile_id
  FROM public.profiles
  WHERE role = 'Equipe' AND access_profile_id IS NOT NULL
)
AND NOT ('chat:history' = ANY(permissions));
