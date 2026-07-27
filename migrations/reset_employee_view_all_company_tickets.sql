-- Funcionários (role 'Funcionário') sempre enxergam só os próprios
-- chamados — a opção de ver todos os chamados da empresa foi removida das
-- telas de criar/editar funcionário. Reverte quem já tinha sido marcado
-- com essa opção antes da mudança.
UPDATE public.profiles
SET view_all_company_tickets = false
WHERE role = 'Funcionário' AND view_all_company_tickets = true;
