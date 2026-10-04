import { PrismaClient } from '@prisma/client';
import { hashSessionToken } from '@lingkod-hr/auth';
import { getConfig } from '@lingkod-hr/config';
import { expect, test, type Page } from '@playwright/test';
import {
  activateInvitation,
  LOCAL_SEED_PASSPHRASE,
  MARISOL_EMAIL,
  nextTotpCode,
  signIn,
} from './sign-in';

// A cold dev server compiles the pages, and the prompt may wait for a fresh TOTP step.
test.describe.configure({ timeout: 120_000 });

/** Moves this page's session sign-in 6 minutes back, closing its Reauthentication Window. */
async function closeReauthenticationWindow(page: Page): Promise<void> {
  getConfig();
  const adminUrl = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!adminUrl) throw new Error('A worktree database owner URL is required to age the session.');
  const cookie = (await page.context().cookies()).find(({ name }) => name === 'hris_session');
  if (!cookie) throw new Error('The page has no session cookie.');
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    const { count } = await admin.userSession.updateMany({
      where: { sessionTokenHash: new Uint8Array(hashSessionToken(cookie.value)) },
      data: { authTime: new Date(Date.now() - 6 * 60_000) },
    });
    expect(count).toBe(1);
  } finally {
    await admin.$disconnect();
  }
}

async function readActivationUrl(recipient: string): Promise<string> {
  let url: string | undefined;
  await expect
    .poll(
      async () => {
        const response = await fetch('http://localhost:8025/api/v1/messages');
        const payload = (await response.json()) as {
          messages: { ID: string; To: { Address: string }[] }[];
        };
        const summary = payload.messages.find(({ To }) =>
          To.some(({ Address }) => Address === recipient),
        );
        if (!summary) return false;
        const detail = await fetch(`http://localhost:8025/api/v1/message/${summary.ID}`);
        const text = ((await detail.json()) as { Text: string }).Text;
        url = /https?:\/\/[^\s]+\/invite\/[A-Za-z0-9_-]{43}/.exec(text)?.[0];
        return url !== undefined;
      },
      { intervals: [100], timeout: 5_000 },
    )
    .toBe(true);
  return url ?? '';
}

test('asks the User to confirm it’s them before a guarded invitation, then retries it once', async ({
  page,
  browser,
}) => {
  const recipient = `reauth-${Date.now()}@example.test`;
  await signIn(page, MARISOL_EMAIL);
  await closeReauthenticationWindow(page);

  await page.goto('/users-access');
  await page.getByRole('button', { name: 'Invite user' }).click();
  await page.getByLabel('Email address').fill(recipient);
  await page.getByRole('button', { name: 'Send invitation' }).click();

  const prompt = page.getByRole('dialog', { name: 'Confirm it’s you' });
  await expect(prompt).toBeVisible();
  await prompt.getByLabel('Current password').fill('not the passphrase');
  await prompt.getByLabel('Authentication code').fill('000000');
  await prompt.getByRole('button', { name: 'Confirm' }).click();
  await expect(prompt.getByRole('alert')).toHaveText('Password or code is incorrect.');

  await prompt.getByLabel('Current password').fill(LOCAL_SEED_PASSPHRASE);
  await prompt.getByLabel('Authentication code').fill(await nextTotpCode());
  await prompt.getByRole('button', { name: 'Confirm' }).click();
  await expect(prompt).toBeHidden();
  await expect(page.getByRole('status')).toContainText(`Invitation sent to ${recipient}`);

  // The new User regenerates their Recovery Codes inside the window their activation opened.
  const activationUrl = await readActivationUrl(recipient);
  const context = await browser.newContext();
  const hrmo = await context.newPage();
  try {
    await activateInvitation(hrmo, activationUrl, { name: 'Tala Reyes' });
    await hrmo.getByRole('link', { name: 'Account security for Tala Reyes' }).click();
    await expect(hrmo.getByRole('heading', { name: 'Account security' })).toBeVisible();
    await expect(
      hrmo.getByText('10 of 10 left. Generating a new set voids the old one.'),
    ).toBeVisible();
    await hrmo.getByRole('button', { name: 'Generate new codes' }).click();

    const codes = hrmo.getByRole('dialog', { name: 'Your new Recovery Codes' });
    await expect(
      codes.getByRole('list', { name: 'Recovery Codes' }).getByRole('listitem'),
    ).toHaveCount(10);
    const acknowledge = codes.getByRole('button', { name: 'I’ve saved them' });
    await expect(acknowledge).toBeDisabled();
    await codes.getByLabel('I’ve saved these Recovery Codes somewhere safe.').check();
    await acknowledge.click();
    await expect(codes).toBeHidden();
  } finally {
    await context.close();
  }
});
