-- Permissão "Vincular contato no Histórico de Conversas" (chat:history_link_contact,
-- Permission.CHAT_HISTORY_LINK_CONTACT) concedida à equipe interna "Suporte".
--
-- A função é nova (botão "Vincular contato" em /chat-history, 2026-09-28), então
-- ninguém a tinha de forma implícita e não há backfill genérico: só o
-- Administrador (que recebe todas as permissões automaticamente) usaria até
-- alguém conceder. Pedido do usuário: liberar para todo o grupo Suporte.
--
-- Permissão é concedida por PERFIL DE ACESSO (role_permissions), não por
-- usuário. Em 2026-09-28 a equipe interna "Suporte" tem 12 pessoas em dois
-- perfis, ambos escopados a ela (internal_team_id): 'Suporte' (11 usuários) e
-- 'Supervisão' (1 usuário). Os dois já têm 'chat:history' — o servidor exige as
-- duas permissões (ver action 'set-history-contact' em app/api/chats/route.ts).
--
-- Amarrado ao escopo da equipe (não só ao nome): um perfil 'Suporte' de outra
-- equipe não é tocado. Idempotente (NOT ... = ANY) e sem efeito num banco que
-- não tenha essa equipe. Quem entrar depois nesses perfis herda a permissão.
UPDATE public.role_permissions rp
SET permissions = array_append(rp.permissions, 'chat:history_link_contact')
WHERE rp.name IN ('Suporte', 'Supervisão')
  AND rp.internal_team_id IN (SELECT id FROM public.internal_teams WHERE name = 'Suporte')
  AND NOT ('chat:history_link_contact' = ANY(rp.permissions));
