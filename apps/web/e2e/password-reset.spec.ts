import { PrismaClient } from '@prisma/client';
import { hashPassword, normalizeRecoveryCode } from '@lingkod-hr/auth';
import { getConfig } from '@lingkod-hr/config';
import { expect, test, type Page } from '@playwright/test';
import {
  LOCAL_SEED_PASSPHRASE,
  LOCAL_SEED_RECOVERY_CODES,
  MARISOL_EMAIL,
  nextTotpCode,
} from './sign-in';

interface MailpitMessageSummary {
  ID: string;
  Subject: string;
  Created: string;
  To: Array<{ Address: string }>;
}

/** The text of the newest mail with `subject` Mailpit received for `email` since `since`. */
async function newestMailText(
  email: string,
  subject: string,
  since: number,
): Promise<string | null> {
  const response = await fetch('http://localhost:8025/api/v1/messages');
  if (!response.ok) throw new Error('Mailpit message listing failed.');
  const { messages } = (await response.json()) as { messages: MailpitMessageSummary[] };
  const summary = messages.find(
    (message) =>
      message.Subject === subject &&
      Date.parse(message.Created) >= since &&
      message.To.some(({ Address }) => Address === email),
  );
  if (!summary) return null;
  const detail = await fetch(`http://localhost:8025/api/v1/message/${summary.ID}`);
  if (!detail.ok) throw new Error('Mailpit message lookup failed.');
  return ((await detail.json()) as { Text: string }).Text;
}

/**
 * Gives a seeded User the seed passphrase and all ten seed Recovery Codes again, which the other
 * specs sign in with, and drops a remaining-codes prompt a reset left owed.
 */
async function restoreSeedCredentials(email: string): Promise<void> {
  getConfig();
  const adminUrl = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!adminUrl) throw new Error('A worktree database owner URL is required to restore it.');
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    const { id } = await admin.user.findUniqueOrThrow({
      where: { emailNormalized: email },
      select: { id: true },
    });
    await admin.userPassword.update({
      where: { userId: id },
      data: {
        passwordHash: await hashPassword(LOCAL_SEED_PASSPHRASE),
        recoveryCodePromptOwedAt: null,
      },
    });
    const codeHashes = await Promise.all(
      LOCAL_SEED_RECOVERY_CODES.map((code) => hashPassword(normalizeRecoveryCode(code) ?? '')),
    );
    await admin.$transaction([
      admin.userRecoveryCode.deleteMany({ where: { userId: id } }),
      admin.userRecoveryCode.createMany({
        data: codeHashes.map((codeHash) => ({ userId: id, codeHash })),
      }),
    ]);
  } finally {
    await admin.$disconnect();
  }
}

/**
 * Asks for a reset link for `email` from the sign-in page and answers its path from the mail. The
 * API sends an email 3 links an hour, so each test resets a different User.
 */
async function requestResetLink(page: Page, email: string, startedAt: number): Promise<string> {
  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(
    page.getByRole('heading', {
      name: 'If that email belongs to a LingkodHR account, we’ve sent a reset link.',
    }),
  ).toBeVisible();

  let mail: string | null = null;
  await expect
    .poll(
      async () => (mail = await newestMailText(email, 'Reset your LingkodHR password', startedAt)),
      {
        intervals: [100],
        timeout: 5_000,
      },
    )
    .not.toBeNull();
  const resetPath = /\/reset-password\/[A-Za-z0-9_-]{43}/.exec(mail ?? '')?.[0];
  if (!resetPath) throw new Error('The reset mail held no reset link.');
  return resetPath;
}

// A cold dev server compiles the reset pages, and the TOTP step may wait for the next code.
test.describe.configure({ timeout: 120_000 });

test('resets a forgotten password from the emailed link', async ({ page }) => {
  // Mailpit stamps messages to the millisecond; allow for the clocks rounding apart.
  const startedAt = Date.now() - 1_000;
  const resetPath = await requestResetLink(page, MARISOL_EMAIL, startedAt);

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
      .poll(() => newestMailText(MARISOL_EMAIL, 'Your LingkodHR password was reset', startedAt), {
        intervals: [100],
        timeout: 5_000,
      })
      .not.toBeNull();

    // The link works once.
    await page.goto(resetPath);
    await expect(
      page.getByRole('heading', { name: 'This reset link is invalid or has expired.' }),
    ).toBeVisible();

    // Check the reset's prompt state before restoring the seed credentials clears it.
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(MARISOL_EMAIL);
    await page.getByLabel('Password').fill('tahimik na umaga sa bundok 42');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByLabel('Authentication code').fill(await nextTotpCode());
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'You reset your password with a Recovery Code' }),
    ).not.toBeVisible();
  } finally {
    await restoreSeedCredentials(MARISOL_EMAIL);
  }
});

test('shows the Recovery Codes left at the first sign-in after a reset proved with one', async ({
  page,
}) => {
  // A seeded Security Administrator, so this reset leaves Marisol's link limit to the test above.
  const email = 'security.officer@example.test';
  const startedAt = Date.now() - 1_000;
  const newPassword = 'hapon sa tabing dagat 17';
  try {
    // Ten codes before the reset, so the prompt's count is known.
    await restoreSeedCredentials(email);
    const resetPath = await requestResetLink(page, email, startedAt);
    await page.goto(resetPath);
    await page.getByRole('textbox', { name: 'New password' }).fill(newPassword);
    await page.getByRole('button', { name: 'No phone? Use a Recovery Code' }).click();
    await page
      .getByRole('textbox', { name: 'Recovery Code' })
      .fill(LOCAL_SEED_RECOVERY_CODES.at(-1) ?? '');
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByRole('heading', { name: 'Your password was reset' })).toBeVisible();

    await page.getByRole('link', { name: 'Sign in' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(newPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByLabel('Authentication code').fill(await nextTotpCode());
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(
      page.getByRole('heading', { name: 'You reset your password with a Recovery Code' }),
    ).toBeVisible();
    await expect(page.getByText('9 Recovery Codes')).toBeVisible();
    await expect(page.getByText('If you lost your authenticator, replace it')).toBeVisible();

    await page.getByRole('button', { name: 'Continue to workspace' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  } finally {
    await restoreSeedCredentials(email);
  }
});
