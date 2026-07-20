import { authenticateApiKey, isAuthError, authErrorResponse, integrationJson } from '@/lib/integration-auth';

// Endpoint de teste de credenciais: qualquer chave ativa (independente de
// escopo) pode confirmar que está autenticando corretamente antes de
// integrar de verdade. Não lê nenhuma tabela de negócio.
export async function GET(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);

  return integrationJson(auth, {
    data: {
      ok: true,
      keyName: auth.name,
      scopes: auth.scopes,
    },
  });
}
