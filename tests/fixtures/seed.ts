// Cria os usuários fixture usados pelos testes automatizados (um por papel,
// senha conhecida) + a segunda empresa-cliente usada no teste de isolamento
// entre empresas. Roda depois de tests/db-reset.js (schema limpo).
//
// Uso: npx ts-node tests/fixtures/seed.ts
//
// IMPORTANTE sobre ordem: lib/db.ts faz dotenv.config({ path: '.env' }) ao ser
// importado, e dotenv por padrão NÃO sobrescreve variável já presente em
// process.env. Por isso tests/env-test precisa carregar ANTES de lib/db.
// Este arquivo usa require() (não `import`) de propósito: com `import`
// (sintaxe ESM) o ts-node/Node passam a resolver módulo por módulo como ESM
// puro (exige extensão explícita, hoisting diferente) — require() mantém tudo
// em CommonJS clássico, ordem de execução = ordem no arquivo.
require('../env-test').loadTestEnv();

const { query, pool } = require('../../lib/db');
const { hashPassword } = require('../../lib/auth-utils');
// Cast explícito: `require()` sozinho tipa como `any`/`unknown` dependendo do
// modo de resolução do ts-node, o que quebra o Object.entries mais abaixo.
const usersFixture = require('./users') as typeof import('./users');
const { TEST_USERS, TEST_PASSWORD, TEST_COMPANY_A_ID, TEST_COMPANY_B_ID } = usersFixture;

async function seed() {
  console.log('[seed] Criando empresa B (isolamento entre empresas)...');
  await query(
    `INSERT INTO public.companies (id, name, industry, phone) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [TEST_COMPANY_B_ID, 'Empresa B (E2E)', 'Tecnologia', '1140050000']
  );

  console.log('[seed] Buscando Perfis de Acesso globais seedados pelo schema...');
  const rolePermsRes = await query(
    `SELECT id, name FROM public.role_permissions WHERE internal_team_id IS NULL`
  );
  const accessProfileByName = new Map<string, string>(rolePermsRes.rows.map((r: any) => [r.name, r.id]));

  const passwordHash = hashPassword(TEST_PASSWORD);

  for (const [key, user] of Object.entries(TEST_USERS)) {
    const accessProfileId = accessProfileByName.get(user.role);
    if (!accessProfileId) {
      throw new Error(`Perfil de acesso "${user.role}" não encontrado — rode tests/db-reset.js antes do seed.`);
    }

    await query(
      `INSERT INTO public.profiles (email, name, role, company_id, password, must_change_password, access_profile_id)
       VALUES ($1, $2, $3, $4, $5, false, $6)
       ON CONFLICT (email) DO UPDATE SET
         password = EXCLUDED.password,
         must_change_password = false,
         access_profile_id = EXCLUDED.access_profile_id,
         company_id = EXCLUDED.company_id`,
      [user.email, user.name, user.role, (user as any).companyId || null, passwordHash, accessProfileId]
    );
    console.log(`[seed] ${key}: ${user.email}`);
  }

  console.log(`[seed] Concluído. Senha de todos os usuários fixture: ${TEST_PASSWORD}`);
}

seed()
  .catch((err) => {
    console.error('[seed] Erro:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
