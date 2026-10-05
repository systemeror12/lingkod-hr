import { PrismaClient } from '@prisma/client';
import { hashPassword } from '@lingkod-hr/auth';
import { getConfig } from '@lingkod-hr/config';
import { expect, test } from '@playwright/test';
import { LOCAL_SEED_PASSPHRASE, MARISOL_EMAIL, nextTotpCode, signIn } from './sign-in';

interface MailpitMessageSummary {
  ID: string;
  Subject: string;
  Created: string;
  To: Array<{ Address: string }>;
}

/** The text of the newest mail with `subject` Mailpit received for the User since `since`. */
async function newestMailText(subject: string, since: number): Promise<string | null> {
  const response = await fetch('http://localhost:8025/api/v1/messages');
  if (!response.ok) throw new Error('Mailpit message listing failed.');
  const { messages } = (await response.json()) as { messages: MailpitMessageSummary[] };
  const summary = messages.find(
    (message) =>
      message.Subject === subject &&
      Date.parse(message.Created) >= since &&
      message.To.some(({ Address }) => Address === MARISOL_EMAIL),
  );
  if (!summary) return null;
  const detail = await fetch(`http://localhost:8025/api/v1/message/${summary.ID}`);
  if (!detail.ok) throw new Error('Mailpit message lookup failed.');
  return ((await detail.json()) as { Text: string }).Text;
}

/** Gives Marisol the seed passphrase again, which the other specs sign in with. */
async function restoreSeedPassphrase(): Promise<void> {
  getConfig();
  const adminUrl = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!adminUrl) throw new Error('A worktree database owner URL is required to restore it.');
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    const { id } = await admin.user.findUniqueOrThrow({
      where: { emailNormalized: MARISOL_EMAIL },
      select: { id: true },
    });
    await admin.userPassword.update({
      where: { userId: id },
      data: { passwordHash: await hashPassword(LOCAL_SEED_PASSPHRASE) },
    });
  } finally {
    await admin.$disconnect();
  }
}

// A cold dev server compiles the reset pages, and the TOTP step may wait for the next code.
test.describe.configure({ timeout: 120_000 });

test('resets a forgotten password from the emailed link', async ({ page }) => {
  // Mailpit stamps messages to the millisecond; allow for the clocks rounding apart.
  const startedAt = Date.now() - 1_000;
  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await page.getByLabel('Email').fill(MARISOL_EMAIL);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(
    page.getByRole('heading', {
      name: 'If that email belongs to a LingkodHR account, we’ve sent a reset link.',
    }),
  ).toBeVisible();

  let mail: string | null = null;
  await expect
    .poll(async () => (mail = await newestMailText('Reset your LingkodHR password', startedAt)), {
      intervals: [100],
      timeout: 5_000,
    })
    .not.toBeNull();
  const resetPath = /\/reset-password\/[A-Za-z0-9_-]{43}/.exec(mail ?? '')?.[0];
  if (!resetPath) throw new Error('The reset mail held no reset link.');

  await page.goto(resetPath);
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await expect(page.getByText(`Account: ${MARISOL_EMAIL}`)).toBeVisible();

  const passwordField = page.getByRole('textbox', { name: 'New password' });
  const codeField = page.getByRole('textbox', { name: 'Authentication code' });
  try {
    await passwordField.fill('too short');
    await codeField.fill('000000');
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByText('Use 15 to 128 characters. This one has 9.')).toBeVisible();

    // A wrong code answers as one, even with the current password.
    await passwordField.fill(LOCAL_SEED_PASSPHRASE);
    await codeField.fill('000000');
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByText('That code didn’t work. Your link still works.')).toBeVisible();
    await expect(codeField).toHaveValue('');

    await codeField.fill(await nextTotpCode());
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(
      page.getByText('Choose a password that’s different from your current one.'),
    ).toBeVisible();

    await passwordField.fill('tahimik na umaga sa bundok 42');
    await codeField.fill(await nextTotpCode());
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByRole('heading', { name: 'Your password was reset' })).toBeVisible();
    await expect
      .poll(() => newestMailText('Your LingkodHR password was reset', startedAt), {
        intervals: [100],
        timeout: 5_000,
      })
      .not.toBeNull();

    // The link works once.
    await page.goto(resetPath);
    await expect(
      page.getByRole('heading', { name: 'This reset link is invalid or has expired.' }),
    ).toBeVisible();
  } finally {
    await restoreSeedPassphrase();
  }

  await signIn(page, MARISOL_EMAIL);
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
});
