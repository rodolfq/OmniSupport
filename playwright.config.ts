import { defineConfig, devices } from '@playwright/test';

// Roda SEMPRE contra o servidor de teste (porta 3100 / ssx_test) — nunca
// contra o `npm run dev` normal. Ver tests/README.md para o fluxo completo.
export default defineConfig({
  testDir: './tests',
  // Alto de propósito: o servidor de teste roda `next dev`, que compila cada
  // rota sob demanda na primeira visita (alguns segundos a mais só na
  // primeira vez que um teste bate numa página nova).
  timeout: 60_000,
  // 1 worker de propósito, mesmo custando tempo: `next dev` compila rota por
  // rota sob demanda, e não é um processo pensado pra aguentar vários
  // browsers batendo em páginas novas ao mesmo tempo — testado na prática:
  // com 4 workers a compilação concorrente estourava timeout em cerca de 1
  // teste a cada 3 execuções (formulário preso em "Criando...", tela presa
  // em "Verificando sessão..."). Suíte pequena hoje; se crescer muito e isso
  // ficar lento demais, a saída é `next build && next start` num servidor de
  // teste (sem compilação sob demanda) em vez de subir mais workers aqui.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  // Acima do padrão (5s) de propósito: telas como /dashboard mostram
  // "Verificando sessão..." por um instante enquanto app-context.tsx resolve
  // /api/auth/me — em rota ainda não compilada pelo `next dev`, isso sozinho
  // já passa de 5s.
  expect: { timeout: 15_000 },

  // Sobe o servidor de teste automaticamente (env isolado, ver
  // tests/start-test-server.js) e espera /api/health responder — essa rota
  // consulta o banco, então só fica "ok" quando o Postgres de teste está
  // acessível de verdade.
  webServer: {
    command: 'node tests/start-test-server.js',
    url: 'http://localhost:3100/api/health',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'api',
      testDir: './tests/api',
      use: { ...devices['Desktop Chrome'] },
      // Não usa a sessão salva pelo setup (loga sozinho via request), mas
      // depende dele mesmo assim só pra não competir com o setup por
      // compilação a frio das mesmas rotas do Next dev ao mesmo tempo.
      dependencies: ['setup'],
    },
    {
      name: 'e2e',
      testDir: './tests/e2e',
      testIgnore: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
      // Depende também de 'api' (não só 'setup'): os dois batiam em
      // /api/tickets pela primeira vez ao mesmo tempo (compilação a frio do
      // `next dev`) e o formulário de criação de chamado ficava preso em
      // "Criando..." até estourar o timeout do teste. `next dev` compila uma
      // rota por vez de verdade — rodar em série evita a corrida.
      dependencies: ['setup', 'api'],
    },
  ],
});
