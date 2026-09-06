// Dados puros dos usuários/empresas fixture — sem nenhum import de lib/db,
// de propósito: specs importam só isto (email/senha pra logar), sem puxar
// junto uma conexão de banco só para ler uma constante.
export const TEST_PASSWORD = 'E2eTeste@123';

export const TEST_COMPANY_A_ID = '11111111-1111-4111-8111-111111111111'; // Empresa Matriz Ltda, já seedada por schema_postgres.sql
export const TEST_COMPANY_B_ID = '22222222-2222-4222-8222-222222222222';

export const TEST_USERS = {
  administrador: { email: 'e2e.admin@ssxtest.local', role: 'Administrador', name: 'E2E Administrador' },
  equipe: { email: 'e2e.equipe@ssxtest.local', role: 'Equipe', name: 'E2E Equipe' },
  clienteA: { email: 'e2e.cliente.a@ssxtest.local', role: 'Cliente', name: 'E2E Cliente A', companyId: TEST_COMPANY_A_ID },
  clienteB: { email: 'e2e.cliente.b@ssxtest.local', role: 'Cliente', name: 'E2E Cliente B', companyId: TEST_COMPANY_B_ID },
  funcionario: { email: 'e2e.funcionario@ssxtest.local', role: 'Funcionário', name: 'E2E Funcionário', companyId: TEST_COMPANY_A_ID },
  timeInterno: { email: 'e2e.time.interno@ssxtest.local', role: 'Time Interno', name: 'E2E Time Interno' },
} as const;

export type TestUserKey = keyof typeof TEST_USERS;
