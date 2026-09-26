import { expect, test } from '@playwright/test';

test('enters the protected Work queue through local OIDC and adapts its authorized navigation', async ({
  page,
}, testInfo) => {
  const requests: string[] = [];
  const dashboardStatuses: number[] = [];
  const appUrl = testInfo.project.use.baseURL ?? 'http://localhost:3100';
  const oidcIssuer = process.env.OIDC_ISSUER ?? 'http://127.0.0.1:4100';
  page.on('request', (request) => requests.push(request.url()));
  page.on('response', (response) => {
    if (response.url() === `${appUrl}/dashboard`) {
      dashboardStatuses.push(response.status());
    }
  });

  await page.goto('/dashboard');

  expect(requests.some((url) => url.includes('/api/v1/auth/login'))).toBe(true);
  expect(dashboardStatuses[0]).toBe(307);
  expect(requests.some((url) => url.startsWith(`${oidcIssuer}/authorize`))).toBe(true);
  expect(requests.some((url) => url.includes('/api/v1/auth/callback'))).toBe(true);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await expect(
    page.getByText('National Archives Coordination Office', { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText('Marisol Santos', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Agency Administrator/).first()).toBeVisible();

  const navigation = page.getByRole('navigation', { name: 'Primary' });
  await expect(navigation.getByRole('link', { name: 'Work queue' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const oversight = navigation.getByRole('button', { name: 'Oversight' });
  await expect(oversight).toHaveAttribute('aria-expanded', 'false');
  await expect(navigation.getByRole('link', { name: 'Audit Log' })).toHaveCount(0);
  await oversight.focus();
  await page.keyboard.press('Enter');
  await expect(oversight).toHaveAttribute('aria-expanded', 'true');
  await expect(navigation.getByRole('link', { name: 'Users & Access' })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Audit Log' })).toBeVisible();
  await navigation.getByRole('button', { name: 'Structure' }).click();
  await expect(navigation.getByRole('link', { name: 'Organization' })).toBeVisible();

  await navigation.getByRole('link', { name: 'Audit Log' }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await expect(navigation.getByRole('link', { name: 'Audit Log' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.goto('/dashboard');
  await expect(navigation.getByRole('button', { name: 'Oversight' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );

  await navigation.getByRole('button', { name: 'Oversight' }).click();
  await navigation.getByRole('link', { name: 'Audit Log' }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await navigation.getByRole('button', { name: 'Oversight' }).click();
  await expect(navigation.getByRole('link', { name: 'Audit Log' })).toHaveCount(0);
  await navigation.getByRole('link', { name: 'Work queue' }).click();
  await page.getByRole('main').getByRole('link', { name: 'Audit Log' }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await expect(navigation.getByRole('link', { name: 'Audit Log' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.goto('/dashboard');

  await expect(page.getByText('LingkodHR', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('expanded.png'), fullPage: true });
  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  await expect(page.getByText('LingkodHR', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Expand navigation' })).toBeFocused();
  await expect(navigation.getByRole('link', { name: 'Work queue' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  const railOversight = navigation.getByRole('button', { name: 'Oversight' });
  await railOversight.click();
  const oversightMenu = page.getByRole('menu', { name: 'Oversight' });
  await expect(oversightMenu.getByRole('menuitem', { name: 'Audit Log' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('collapsed.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(oversightMenu).toBeHidden();
  await expect(railOversight).toBeFocused();
  await railOversight.click();
  await expect(oversightMenu).toBeVisible();
  await page.mouse.click(700, 500);
  await expect(oversightMenu).toBeHidden();

  await railOversight.focus();
  await page.keyboard.press('Enter');
  await expect(oversightMenu.getByRole('menuitem', { name: 'Users & Access' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(oversightMenu.getByRole('menuitem', { name: 'Audit Log' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/audit$/);
  await expect(oversightMenu).toBeHidden();
  await expect(railOversight).toHaveAttribute('aria-current', 'true');

  const reloaded = await page.request.get('/dashboard');
  expect(await reloaded.text()).toContain('aria-label="Expand navigation"');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand navigation' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Collapse navigation' })).toBeVisible();

  await page.goto('/dashboard');
  await page.setViewportSize({ width: 720, height: 900 });
  await expect(page.getByRole('button', { name: /navigation/ })).toBeHidden();
  await expect(navigation.getByRole('link', { name: 'Work queue' })).toBeHidden();
  const menu = page.getByRole('button', { name: 'Menu' });
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(navigation.getByRole('link', { name: 'Work queue' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('narrow.png'), fullPage: true });
  await navigation.getByRole('button', { name: 'Oversight' }).click();
  await navigation.getByRole('link', { name: 'Audit Log' }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('main')).toBeFocused();

  await page.goto('/records/non-disclosable-id');
  await expect(page.getByRole('heading', { name: 'The record could not be found' })).toBeVisible();
  await expect(page.getByText('non-disclosable-id')).toHaveCount(0);
});
