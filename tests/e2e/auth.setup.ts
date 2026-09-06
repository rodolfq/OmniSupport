import { test as setup, expect } from '@playwright/test';
import path from 'path';
import { TEST_USERS, TEST_PASSWORD } from '../fixtures/users';

// Loga uma vez por papel e salva a sessão (cookie JWT) em disco. Os specs de
// './e2e' reaproveitam esse arquivo via `storageState`, em vez de logar de
// novo em cada teste — mais rápido e evita esbarrar no freio de força bruta
// do login (lib/login-rate-limit.ts) por excesso de tentativas.
const authDir = path.join(__dirname, '..', '.auth');

// Serial de propósito: `next dev` compila cada rota sob demanda na primeira
// visita. Com os 6 logins em paralelo, vários workers batem em /dashboard e
// /my-tickets ao mesmo tempo pela primeira vez e a compilação concorrente
// estoura até um timeout de 30s (visto na prática ao montar esta suíte) —
// rodando um de cada vez, só o primeiro acesso a cada rota paga esse custo.
setup.describe.configure({ mode: 'serial' });

for (const [key, user] of Object.entries(TEST_USERS)) {
  setup(`login como ${key}`, async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('exemplo@empresa.com').fill(user.email);
    await page.getByPlaceholder('••••••••').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Entrar no Sistema' }).click();

    // Cliente/Funcionário caem em /my-tickets; os demais em /dashboard (ver
    // app/login/page.tsx) — só espera sair da tela de login. Timeout alto de
    // propósito: `next dev` compila cada rota sob demanda na primeira visita
    // (login/dashboard/my-tickets podem levar alguns segundos só na primeira
    // vez), não é lentidão do login em si.
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 40_000 });
    await expect(page).not.toHaveURL(/\/login/);

    await page.context().storageState({ path: path.join(authDir, `${key}.json`) });
  });
}
