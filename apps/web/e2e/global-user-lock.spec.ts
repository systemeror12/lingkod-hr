import { expect, test, type Browser } from '@playwright/test';
import { LOCAL_SEED_PASSPHRASE, signIn } from './sign-in';

// Seeded in the National Archives Coordination Office; each seed run unlocks the candidate.
const securityOfficer = 'security.officer@example.test';
const candidate = 'user.lock.candidate@example.test';

// A cold dev server compiles the pages.
test.describe.configure({ timeout: 120_000 });

async function expectSignInRefused(browser: Browser): Promise<void> {
  const context = await browser.newContext();
  const user = await context.newPage();
  try {
    await user.goto('/sign-in');
    await user.getByLabel('Email').fill(candidate);
    await user.getByLabel('Password').fill(LOCAL_SEED_PASSPHRASE);
    await user.getByRole('button', { name: 'Sign in' }).click();
    await expect(user.getByRole('alert')).toBeVisible();
    await expect(user).toHaveURL(/\/sign-in/);
  } finally {
    await context.close();
  }
}

test('a Security Administrator locks a User, who then cannot sign in, and unlocks them', async ({
  page,
  browser,
}) => {
  await signIn(page, securityOfficer, { fresh: true });
  await page.goto('/users-access');
  await expect(page.getByRole('heading', { name: 'Users & Access' })).toBeVisible();
  // No one locks their own account.
  await expect(
    page
      .getByRole('row', { name: /Security Officer/ })
      .getByRole('button', { name: 'Lock account' }),
  ).toHaveCount(0);

  const row = page.getByRole('row', { name: /User Lock Candidate/ });
  await row.getByRole('button', { name: 'Lock account' }).click();
  const lock = page.getByRole('dialog', { name: 'Lock account' });
  await lock.getByRole('button', { name: 'Lock account' }).click();
  await expect(lock.getByText('Add the reason.')).toBeVisible();
  await lock.getByLabel('Reason').fill('Sign-ins from an unrecognized device overnight.');
  await lock.getByRole('button', { name: 'Lock account' }).click();

  await expect(page.getByRole('status')).toContainText(
    'User Lock Candidate’s account is locked in every Agency',
  );
  await expect(row.getByText('Locked', { exact: true })).toBeVisible();
  await expectSignInRefused(browser);

  await row.getByRole('button', { name: 'Unlock account' }).click();
  const unlock = page.getByRole('dialog', { name: 'Unlock account' });
  await unlock.getByLabel('Reason').fill('The User confirmed the device was theirs.');
  await unlock.getByRole('button', { name: 'Unlock account' }).click();

  await expect(page.getByRole('status')).toContainText(
    'User Lock Candidate’s account is unlocked.',
  );
  await expect(row.getByRole('button', { name: 'Lock account' })).toBeVisible();
});
