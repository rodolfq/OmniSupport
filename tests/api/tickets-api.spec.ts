import { test, expect, APIRequestContext } from '@playwright/test';
import { TEST_USERS, TEST_PASSWORD } from '../fixtures/users';

async function loginAs(request: APIRequestContext, email: string) {
  const res = await request.post('/api/auth/login', { data: { email, password: TEST_PASSWORD } });
  expect(res.ok(), `login falhou para ${email}: ${await res.text()}`).toBeTruthy();
  return (await res.json()).user;
}

test.describe('POST /api/tickets?action=create', () => {
  test('cliente autenticado cria um chamado', async ({ request }) => {
    const user = await loginAs(request, TEST_USERS.clienteA.email);

    const res = await request.post('/api/tickets', {
      data: {
        action: 'create',
        userId: user.id,
        ticket: { title: `[E2E-API] chamado ${Date.now()}`, description: 'Criado pelo teste de API.' },
      },
    });

    expect(res.status()).toBe(200);
    // Resposta é { success, ticket }, não o chamado direto na raiz — a rota
    // (app/api/tickets/route.ts, action 'create') retorna `NextResponse.json({ success: true, ticket: newTicket })`.
    const body = await res.json();
    expect(body.ticket.status).toBe('Novo');
    expect(body.ticket.company_id).toBe(TEST_USERS.clienteA.companyId);
  });

  // A rota em si (action 'create') não confere cookie nenhum, só exige um
  // `userId` no corpo — mas middleware.ts intercepta TODA rota de /api/ que
  // não esteja em PUBLIC_PATHS antes dela ser executada, e devolve 401 sem
  // JWT válido (ver middleware.ts:101). Checado aqui pra deixar essa garantia
  // registrada num teste, não só na leitura do código — foi verificado na
  // prática ao montar esta suíte: sem isso a rota sozinha seria uma falha de
  // autorização (qualquer um cria chamado em nome de outro userId).
  test('sem sessão (bloqueado pelo middleware global), retorna 401', async ({ request }) => {
    const res = await request.post('/api/tickets', {
      data: {
        action: 'create',
        userId: TEST_USERS.clienteB.email, // nem precisa ser um id válido — middleware barra antes da rota olhar o corpo
        ticket: { title: 'não deveria ser criado', description: 'x' },
      },
      headers: { cookie: '' },
    });

    expect(res.status()).toBe(401);
  });
});

test.describe('PUT /api/tickets — edição', () => {
  test('sem sessão retorna 401', async ({ request }) => {
    const res = await request.put('/api/tickets?id=id-inexistente', {
      data: { status: 'Fechado' },
      headers: { cookie: '' },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe('GET /api/tickets — isolamento entre empresas', () => {
  // Corrigido em app/api/tickets/route.ts (06/09/2026): isCompanyScopedActor()
  // filtra por company_id na listagem, no chamado único (?id=) e nas
  // mensagens (?action=messages) sempre que o ator é Cliente/Funcionário.
  // Antes da correção este teste ficava vermelho de propósito (test.fail()) —
  // documentando o achado sem travar o resto da suíte. Removido o
  // test.fail() agora que a rota filtra de verdade: se voltar a vazar, este
  // teste quebra a suíte, sem margem pra passar despercebido de novo.
  test('Cliente da Empresa A não recebe chamado da Empresa B na listagem', async ({ request }) => {
    const userB = await loginAs(request, TEST_USERS.clienteB.email);
    const marker = `[E2E-API] chamado privado da Empresa B ${Date.now()}`;
    const createRes = await request.post('/api/tickets', {
      data: { action: 'create', userId: userB.id, ticket: { title: marker, description: 'x' } },
    });
    expect(createRes.status()).toBe(200);
    const createdTicketId = (await createRes.json()).ticket.id;

    // Mesmo APIRequestContext: login como Cliente A sobrescreve o cookie.
    await loginAs(request, TEST_USERS.clienteA.email);
    const listRes = await request.get('/api/tickets');
    expect(listRes.status()).toBe(200);
    const tickets = await listRes.json();
    expect((tickets as any[]).some((t) => t.title === marker)).toBe(false);

    // Mesma proteção precisa valer pedindo o chamado direto pelo id (não só
    // a listagem) — senão bastava conhecer/adivinhar o id pra contornar.
    const singleRes = await request.get(`/api/tickets?id=${createdTicketId}`);
    expect(singleRes.status()).toBe(403);

    // E pelas mensagens do chamado, mesmo sem pedir o chamado em si.
    const messagesRes = await request.get(`/api/tickets?action=messages&ticketId=${createdTicketId}`);
    expect(messagesRes.status()).toBe(403);
  });

  test('Cliente vê o próprio chamado normalmente (a correção não bloqueia a própria empresa)', async ({ request }) => {
    const userA = await loginAs(request, TEST_USERS.clienteA.email);
    const marker = `[E2E-API] chamado da própria Empresa A ${Date.now()}`;
    const createRes = await request.post('/api/tickets', {
      data: { action: 'create', userId: userA.id, ticket: { title: marker, description: 'x' } },
    });
    const createdTicketId = (await createRes.json()).ticket.id;

    const listRes = await request.get('/api/tickets');
    const tickets = await listRes.json();
    expect((tickets as any[]).some((t) => t.title === marker)).toBe(true);

    const singleRes = await request.get(`/api/tickets?id=${createdTicketId}`);
    expect(singleRes.status()).toBe(200);
  });
});
