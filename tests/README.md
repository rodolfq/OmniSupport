# Testes automatizados (Playwright)

Suíte E2E + API do SSX Desk, montada em 06/09/2026. Cobre exatamente o que
`npm run lint`/`tsc --noEmit` não cobrem: comportamento real de login,
criação/edição de chamado e controle de acesso por papel.

## Regra inegociável: nunca toca o banco real

Todo teste roda contra um servidor Next dedicado, na porta **3100**, ligado a
um Postgres descartável (`ssx_pg-dev`, banco `ssx_test`) — nunca o `.env` de
produção. Duas travas independentes garantem isso:

1. `tests/start-test-server.js` só sobe o servidor depois de carregar
   `.env.test` (nunca o `.env` real) via `tests/env-test.js`.
2. `tests/env-test.js` recusa subir se `DATABASE_URL` não apontar
   literalmente para `localhost:5433/ssx_test` — mesmo que alguém edite
   `.env.test` errado.

Nunca aponte `.env.test` para outro host/porta. Se um dia o teste precisar
rodar em CI, o banco de teste tem que ser outro Postgres descartável, nunca o
de produção.

## Como rodar

```bash
# 1. Garanta que o container do Postgres de dev está no ar (ver CLAUDE.md).
docker start ssx-pg-dev

# 2. Reseta o schema + recria os usuários fixture (roda sozinho antes do
#    test:e2e via hook "pretest:e2e", mas dá pra rodar à parte):
npm run test:db:reset

# 3. Roda a suíte inteira (sobe o servidor de teste sozinho, na porta 3100):
npm run test:e2e

# Modo interativo (escolher teste, ver trace passo a passo):
npm run test:e2e:ui
```

O relatório HTML fica em `playwright-report/index.html` depois de qualquer
execução (`npx playwright show-report` abre).

## Estrutura

```
tests/
  env-test.js            # carrega .env.test com trava de segurança (nunca produção)
  start-test-server.js   # sobe `next dev -p 3100` já com o env de teste
  db-reset.js            # reaplica schema_postgres.sql em ssx_test
  fixtures/
    users.ts             # dados dos 6 usuários fixture (1 por papel) + 2 empresas
    seed.ts               # grava os fixtures acima no banco de teste
  e2e/                    # testes de navegador (Playwright browser)
    auth.setup.ts          # loga cada papel 1x, salva sessão em tests/.auth/
    permissions.spec.ts    # visibilidade de menu por permissão
    tickets.spec.ts        # criação de chamado pela UI (Cliente)
  api/                    # testes batendo direto na API, sem navegador (mais rápido)
    tickets-api.spec.ts
```

## Usuários fixture

Todos com senha `E2eTeste@123` (ver `tests/fixtures/users.ts`), recriados do
zero a cada `test:db:reset`:

| Papel | E-mail | Empresa |
|---|---|---|
| Administrador | e2e.admin@ssxtest.local | — |
| Equipe | e2e.equipe@ssxtest.local | — |
| Cliente | e2e.cliente.a@ssxtest.local | Empresa A (padrão do schema) |
| Cliente | e2e.cliente.b@ssxtest.local | Empresa B (só existe no ambiente de teste) |
| Funcionário | e2e.funcionario@ssxtest.local | Empresa A |
| Time Interno | e2e.time.interno@ssxtest.local | — |

## Nível de cobertura (de propósito, não é a pirâmide completa ainda)

- `api/` é onde cabe a maior parte da cobertura de criação/edição/permissão —
  roda contra a API sem navegador, rápido o bastante pra crescer bastante sem
  pesar.
- `e2e/` fica só para os fluxos que realmente precisam de navegador (menu,
  modal, formulário) — poucos testes, de propósito (são os mais lentos e mais
  frágeis a mudança visual).
- Não existe unit test aqui — a maior parte do código de negócio faz SQL
  direto (sem camada de mock), então "testar de verdade" já significa bater
  num Postgres real de qualquer jeito. Ver seção 9 do CLAUDE.md.

## Achado de controle de acesso já documentado como teste

Um teste fica **vermelho de propósito** — não é teste quebrado, é bug real
encontrado ao montar esta suíte (06/09/2026), documentado em teste em vez de
silenciado:

- `tests/api/tickets-api.spec.ts` → `[ACHADO] Cliente da Empresa A não
  deveria receber chamado da Empresa B`: `GET /api/tickets` devolve todos os
  chamados de todas as empresas pra qualquer sessão autenticada — o filtro
  por empresa existe só no client (`app/(portal)/my-tickets/page.tsx`), não
  no servidor. Confirmado rodando o teste (não só lendo o código): o Cliente A
  recebeu o título do chamado criado pelo Cliente B.

Corrigir é decisão de produto/API pública (a rota também é consumida pelo
dashboard interno, que precisa ver tudo) — fora do escopo de montar esta
suíte. Enquanto não for corrigido, o teste continua vermelho; não "conserte"
a asserção pra ficar verde sem corrigir a rota.

Uma segunda suspeita da mesma leitura de código — que `action=create` também
criaria chamado em nome de qualquer `userId` sem sessão — **não se confirmou**:
`middleware.ts` intercepta toda rota `/api/` fora de `PUBLIC_PATHS` antes dela
rodar e devolve 401 sem JWT válido, então a rota em si nunca chega a ser
exercida sem sessão. Só a leitura do `route.ts` isolado, sem considerar o
`middleware.ts` na frente, sugeria o contrário — corrigido depois que o
teste correspondente (que esperava 200) falhou com 401 real. Fica como
`tests/api/tickets-api.spec.ts` → `sem sessão (bloqueado pelo middleware
global), retorna 401`, agora como uma garantia positiva, não um achado.

## Ao adicionar teste novo

- Teste de CRUD/permissão → `tests/api/`, sem navegador, usando
  `request.post('/api/auth/login', ...)` pra logar dentro do próprio teste
  (não precisa do `storageState` de `auth.setup.ts`, que é só pros testes de
  navegador).
- Teste de fluxo de tela → `tests/e2e/`, reaproveitando
  `test.use({ storageState: '<papel>.json' })` em vez de logar de novo.
- Precisa de um usuário/empresa que não existe ainda em `users.ts`? Adicione
  lá (não crie usuário solto dentro do teste) e rode `npm run test:db:reset`
  antes de testar localmente.
