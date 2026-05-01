import { test, expect } from '@playwright/test';

test.only('Finalize prepared dispatch', async ({ page }) => {
  await page.goto('http://localhost:5173/login');

  await page.locator('input').nth(0).fill('admin@test.com');
  await page.locator('input').nth(1).fill('123456');
  await page.getByRole('button', { name: /login/i }).click();

  await page.waitForURL((url) => !url.pathname.includes('/login'));

  await page.goto('http://localhost:5173/dispatch?draftDispatchId=1');

  await page.getByRole('button', { name: /finalize dispatch/i }).click();

  await expect(page.locator('body')).toContainText(/finalized|locked|sales bill|dispatch/i, {
    timeout: 15000,
  });
});