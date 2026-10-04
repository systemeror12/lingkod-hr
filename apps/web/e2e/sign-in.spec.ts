import { expect, test } from '@playwright/test';
import { LOCAL_SEED_PASSPHRASE, nextTotpCode, signIn } from './sign-in';

const email = 'marisol.santos@example.test';

// A cold dev server compiles /sign-in and /dashboard, and the fixture may wait up to 30 seconds
// for an unused TOTP step.
test.describe.configure({ timeout: 90_000 });

test('signs in with email, password, and an authenticator code', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(
    page.getByRole('heading', { name: 'Sign in to your Agency workspace' }),
  ).toBeVisible();

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(LOCAL_SEED_PASSPHRASE);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const codeField = page.getByLabel('Authentication code');
  await expect(codeField).toBeFocused();

  await codeField.fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('The code is incorrect.')).toBeVisible();
  await expect(codeField).toHaveValue('');

  await codeField.fill(await nextTotpCode());
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await expect(page.getByText('Marisol Santos', { exact: true }).first()).toBeVisible();
});

test('reuses the session cookie for the same User instead of signing in again', async ({
  browser,
}) => {
  const first = await browser.newPage();
  await signIn(first, email);
  await first.close();

  const second = await browser.newPage();
  const signInRequests: string[] = [];
  second.on('request', (request) => {
    if (request.url().includes('/api/v1/auth/sign-in')) signInRequests.push(request.url());
  });
  await signIn(second, email);
  await second.goto('/dashboard');
  await expect(second.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  expect(signInRequests).toEqual([]);
  await second.close();
});
