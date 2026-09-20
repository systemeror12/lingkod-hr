import { expect, test } from '@playwright/test';

test('shows the protected Terminal Leave Inputs register', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();

  await page.goto('/terminal-leave-inputs');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Terminal Leave Inputs', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Effective separations', { exact: true })).toBeVisible();
  await expect(page.getByText('No qualifying separations.', { exact: true })).toBeVisible();
  await expect(page.getByText('Assessment register', { exact: true })).toBeVisible();
  await expect(page.getByText('No assessments yet.', { exact: true })).toBeVisible();
});
