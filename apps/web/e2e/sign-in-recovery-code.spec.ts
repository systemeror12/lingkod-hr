import { expect, test } from '@playwright/test';
import { LOCAL_SEED_PASSPHRASE, LOCAL_SEED_RECOVERY_CODES } from './sign-in';

const email = 'marisol.santos@example.test';
// The seed stores only Argon2id hashes of these codes, so the API checks the typed code as it
// would a real one. Each seed run restores all ten.
const [code = ''] = LOCAL_SEED_RECOVERY_CODES;

/** Subjects of the mail Mailpit received for the User since `since`. */
async function subjectsSince(since: number): Promise<string[]> {
  const response = await fetch('http://localhost:8025/api/v1/messages');
  if (!response.ok) throw new Error('Mailpit message listing failed.');
  const payload = (await response.json()) as {
    messages: { Subject: string; Created: string; To: { Address: string }[] }[];
  };
  return payload.messages
    .filter(
      (message) =>
        Date.parse(message.Created) >= since && message.To.some(({ Address }) => Address === email),
    )
    .map(({ Subject }) => Subject);
}

// A cold dev server compiles /sign-in and /dashboard.
test.describe.configure({ timeout: 90_000 });

test('signs in with a Recovery Code in place of the authenticator code', async ({ page }) => {
  // Mailpit stamps messages to the millisecond; allow for the clocks rounding apart.
  const startedAt = Date.now() - 1_000;
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(LOCAL_SEED_PASSPHRASE);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByLabel('Authentication code')).toBeFocused();

  await page.getByRole('button', { name: 'No phone? Use a Recovery Code' }).click();
  await expect(page.getByRole('heading', { name: 'Enter a Recovery Code' })).toBeVisible();
  const codeField = page.getByRole('textbox', { name: 'Recovery Code' });
  await expect(codeField).toBeFocused();

  await codeField.fill('aaaaa-bbbbb');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('That Recovery Code didn’t work.')).toBeVisible();
  await expect(codeField).toHaveValue('');

  // Typed in upper case without the hyphen; matching ignores both.
  await codeField.fill(code.replace('-', '').toUpperCase());
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(
    page.getByRole('heading', { name: 'You signed in with a Recovery Code' }),
  ).toBeVisible();
  await expect(page.getByText('9 Recovery Codes')).toBeVisible();
  await expect
    .poll(() => subjectsSince(startedAt), { intervals: [100], timeout: 5_000 })
    .toContain('A Recovery Code was used to sign in to LingkodHR');

  await page.getByRole('button', { name: 'Continue to workspace' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
});
