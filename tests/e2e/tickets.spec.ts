import { test, expect } from '@playwright/test';
import path from 'path';

test.use({ storageState: path.join(__dirname, '..', '.auth', 'clienteA.json') });

test('Cliente cria um chamado pelo modal "Novo Chamado" e vê ele na lista', async ({ page }) => {
  const title = `[E2E] Chamado de teste ${Date.now()}`;

  await page.goto('/my-tickets');
  await page.getByRole('button', { name: 'Novo Chamado' }).click();

  await page.getByPlaceholder('Ex: Erro ao gerar relatório mensal').fill(title);
  // RichEditor (Tiptap) é um <div contenteditable>, não <textarea> — sem
  // atributo `placeholder` de verdade pro Playwright localizar por texto.
  await page.locator('[contenteditable="true"]').first().click();
  await page.locator('[contenteditable="true"]').first().fill('Descrição criada pelo teste automatizado E2E.');

  await page.getByRole('button', { name: 'Abrir Chamado' }).click();

  // Modal fecha e o chamado aparece na lista, sem precisar recarregar a página.
  await expect(page.getByRole('button', { name: 'Abrir Chamado' })).toHaveCount(0);
  await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 });
});
