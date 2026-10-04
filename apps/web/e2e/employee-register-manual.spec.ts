// Manual walkthrough of the Employee register. It stops in the Playwright Inspector.
// pnpm --filter @lingkod-hr/web exec playwright test e2e/employee-register-manual.spec.ts --headed
import { expect, test } from '@playwright/test';
import { MARISOL_EMAIL, signIn } from './sign-in';

test('try the Employee register search, filters and paging', async ({ page }) => {
  test.skip(Boolean(process.env.CI), 'Manual walkthrough for developers.');
  await signIn(page, MARISOL_EMAIL);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible({ timeout: 15000 });
  await page.goto('/employees');
  await expect(page.getByText(/^Showing \d+–\d+ of \d+$/)).toBeVisible();

  const search = page.getByRole('searchbox', { name: 'Search employees' });
  await search.fill('e2e');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/q=e2e/);

  const filters = page.getByRole('complementary', { name: 'Filters' });
  await filters.getByRole('checkbox', { name: /^Preboarding/ }).check();
  await expect(page).toHaveURL(/serviceStatus=PREBOARDING/);
  await filters.getByRole('checkbox', { name: /^Needs link/ }).check();
  await expect(page).toHaveURL(/membership=UNLINKED/);

  const next = page.getByRole('link', { name: 'Next page' });
  if (await next.isVisible()) {
    await next.click();
    await expect(page).toHaveURL(/page=2/);
  }

  await page.goBack();
  await page.pause(); // look around in the Inspector
});
