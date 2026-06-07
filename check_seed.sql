-- Check if seed data exists
SELECT email FROM auth.users WHERE email IN ('admin@systemsat.com.br', 'jose@cliente.com');

-- Check profiles
SELECT id, email, name, role FROM public.profiles WHERE email IN ('admin@systemsat.com.br', 'jose@cliente.com');

-- Check companies 
SELECT id, name FROM public.companies;

-- Check config tables
SELECT label FROM public.config_priorities;
SELECT label FROM public.config_statuses;