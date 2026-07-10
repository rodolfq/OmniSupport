-- Verificar todos os dados críticos de uma vez
SELECT '=== Auth Users ===' as section;
SELECT email, id FROM auth.users LIMIT 5;

SELECT '=== Profiles ===' as section;
SELECT id, email, name, role FROM public.profiles LIMIT 5;

SELECT '=== Companies ===' as section;
SELECT id, name FROM public.companies;

SELECT '=== Queues ===' as section;
SELECT id, name FROM public.queues;

SELECT '=== Storage Bucket ===' as section;
SELECT id, name FROM storage.buckets;