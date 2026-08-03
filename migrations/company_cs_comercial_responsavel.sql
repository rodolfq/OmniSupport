-- CS Responsável e Comercial Responsável da empresa-cliente. Por enquanto
-- atribuídos manualmente a um usuário da equipe interna (Administrador/
-- Equipe/Time Interno); a ideia é que futuramente venham de uma API externa.
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS cs_responsavel_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS comercial_responsavel_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
