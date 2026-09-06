import { test, expect } from '@playwright/test';
import path from 'path';

const authDir = path.join(__dirname, '..', '.auth');
const storageStateFor = (role: string) => path.join(authDir, `${role}.json`);

test.describe('Administrador', () => {
  test.use({ storageState: storageStateFor('administrador') });

  test('vê o Dashboard no menu e consegue abrir', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('link', { name: 'Geral' })).toBeVisible();
  });
});

test.describe('Cliente', () => {
  test.use({ storageState: storageStateFor('clienteA') });

  test('não vê o Dashboard no menu (sem dashboard:view)', async ({ page }) => {
    await page.goto('/my-tickets');
    await expect(page.getByRole('button', { name: 'Novo Chamado' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Geral' })).toHaveCount(0);
  });

  test('acessando /dashboard diretamente pela URL não expõe dado gerencial', async ({ page }) => {
    // Cliente não tem `dashboard:view`. O objetivo aqui não é validar UM
    // redirecionamento específico (a tela pode escolher renderizar vazio,
    // redirecionar pro /my-tickets, etc.) e sim garantir que o KPI gerencial
    // não fica visível pra quem não tem a permissão.
    await page.goto('/dashboard');
    await expect(page.getByText(/SLA Vencido|Próximos do Vencimento|Novos Sem Responsável/i)).toHaveCount(0);
  });
});
