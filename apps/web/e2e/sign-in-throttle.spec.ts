import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

// A cold dev server compiles /sign-in first.
test.describe.configure({ timeout: 90_000 });

test('shows when an email in its Sign-in Cool-down can try again', async ({ page }) => {
  // An unknown email is throttled like a real one, and no seeded User is touched.
  const email = `nobody-${randomUUID()}@example.test`;
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.getByLabel('Password').fill('a wrong passphrase here');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('The email or password is incorrect.')).toBeVisible();
  }

  await page.getByLabel('Password').fill('a wrong passphrase here');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByText(
      /^Too many attempts for this email\. You can try again after \d{1,2}:\d{2} [AP]M\.$/i,
    ),
  ).toBeVisible();
});

test('says the password must be reset once the second-factor ceiling is reached', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/sign-in', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'PASSWORD_RESET_REQUIRED',
          message: 'Your password was disabled after too many wrong codes. Reset it to sign in.',
        },
      }),
    }),
  );
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('ceiling@example.test');
  await page.getByLabel('Password').fill('the right passphrase');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Reset your password to sign in' })).toBeVisible();
  await expect(page.getByText('Password reset required')).toBeVisible();
  await expect(page.getByText('We emailed you about this.')).toBeVisible();
  await page.getByRole('button', { name: 'Use a different account' }).click();
  await expect(page.getByLabel('Password')).toHaveValue('');
});
