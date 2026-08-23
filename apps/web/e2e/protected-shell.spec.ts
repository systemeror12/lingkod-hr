import { expect, test } from '@playwright/test';

test('enters the protected Work queue through local OIDC and adapts its authorized navigation', async ({
  page,
}, testInfo) => {
  const requests: string[] = [];
  const dashboardStatuses: number[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('response', (response) => {
    if (response.url() === 'http://localhost:3100/dashboard') {
      dashboardStatuses.push(response.status());
    }
  });

  await page.goto('/dashboard');

  expect(requests.some((url) => url.includes('/api/v1/auth/login'))).toBe(true);
  expect(dashboardStatuses[0]).toBe(307);
  expect(requests.some((url) => url.startsWith('http://127.0.0.1:4100/authorize'))).toBe(true);
  expect(requests.some((url) => url.includes('/api/v1/auth/callback'))).toBe(true);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await expect(
    page.getByText('National Archives Coordination Office', { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText('Marisol Santos', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Agency Administrator/).first()).toBeVisible();

  const navigation = page.getByRole('navigation', { name: 'Primary' });
  await expect(navigation.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(navigation.getByRole('link', { name: 'Users & Access' })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Audit Log' })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Organization' })).toBeVisible();

  const rail = page.getByRole('complementary', { name: 'Application' });
  await expect(page.getByText('LingkodHR', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('expanded.png'), fullPage: true });
  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  await expect(page.getByText('LingkodHR', { exact: true })).toBeHidden();
  await navigation.getByRole('link', { name: 'Dashboard' }).hover();
  await expect(rail.getByRole('tooltip', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expand navigation' })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('collapsed.png'), fullPage: true });

  await page.setViewportSize({ width: 720, height: 900 });
  await expect(page.getByRole('button', { name: /navigation/ })).toBeHidden();
  await expect(navigation.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Users & Access' })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Audit Log' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('narrow.png'), fullPage: true });

  await page.goto('/records/non-disclosable-id');
  await expect(page.getByRole('heading', { name: 'The record could not be found' })).toBeVisible();
  await expect(page.getByText('non-disclosable-id')).toHaveCount(0);
});
