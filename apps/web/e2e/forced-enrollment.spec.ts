import { totpCode } from '@lingkod-hr/auth';
import { expect, test } from '@playwright/test';
import { LOCAL_SEED_PASSPHRASE } from './sign-in';

// Seeded as an MFA-Required User without a TOTP factor; the seed removes any factor each run.
const email = 'enrollment.candidate@example.test';

// A cold dev server compiles /sign-in and /dashboard, and hashing Recovery Codes takes a moment.
test.describe.configure({ timeout: 90_000 });

test('sets up an authenticator and saves Recovery Codes before the first session', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(LOCAL_SEED_PASSPHRASE);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();
  await expect(page.getByText(`Account: ${email}`)).toBeVisible();
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  await expect(page.getByText('Step 2 of 3: Set up authenticator')).toBeVisible();
  await expect(page.getByText(/^Sign-in expires at /)).toBeVisible();
  expect((await page.context().cookies()).map(({ name }) => name)).not.toContain('hris_session');

  await page.getByText('Show setup key').click();
  const otpauthUri = await page.getByTestId('otpauth-uri').textContent();
  expect(otpauthUri).toMatch(/^otpauth:\/\/totp\//);
  const secret = new URL(otpauthUri ?? '').searchParams.get('secret') ?? '';

  const codeField = page.getByLabel('Authentication code');
  await codeField.fill('000000');
  await page.getByRole('button', { name: 'Confirm code' }).click();
  await expect(page.getByText('That code didn’t match.', { exact: false })).toBeVisible();
  await expect(codeField).toHaveValue('');

  await codeField.fill(totpCode(secret, new Date()));
  await page.getByRole('button', { name: 'Confirm code' }).click();

  await expect(page.getByRole('heading', { name: 'Save your Recovery Codes' })).toBeVisible();
  await expect(page.getByText('Step 3 of 3: Save Recovery Codes')).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Recovery Codes' }).getByRole('listitem'),
  ).toHaveCount(10);

  // Printing keeps only the slip. The scene is decorative, so only its class finds it.
  const screenOnly = [
    page.locator('.lh-scene'),
    page.getByText('Para sa mga lingkod-bayan'),
    page.getByText('Personnel records for government agencies'),
    page.getByRole('heading', { name: 'Save your Recovery Codes' }),
    page.getByRole('button', { name: 'Print slip' }),
    page.getByRole('button', { name: 'Copy codes' }),
    page.getByLabel('I’ve saved these Recovery Codes somewhere safe.'),
    page.getByRole('button', { name: 'Continue' }),
    page.getByText('Step 3 of 3: Save Recovery Codes'),
  ];
  for (const element of screenOnly) await expect(element).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  for (const element of screenOnly) await expect(element).toBeHidden();
  await expect(
    page.getByRole('list', { name: 'Recovery Codes' }).getByRole('listitem').last(),
  ).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(page.getByText(/^Issued .+\. Each code works once\./)).toBeVisible();
  await page.emulateMedia({ media: 'screen' });

  const finish = page.getByRole('button', { name: 'Continue' });
  await expect(finish).toBeDisabled();
  await page.getByLabel('I’ve saved these Recovery Codes somewhere safe.').check();
  await finish.click();

  await expect(page.getByRole('heading', { name: 'You’re set up' })).toBeVisible();
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('Enrollment Candidate', { exact: true }).first()).toBeVisible();
});
