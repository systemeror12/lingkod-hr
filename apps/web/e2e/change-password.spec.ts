import { totpCode } from '@lingkod-hr/auth';
import { expect, test } from '@playwright/test';
import { activateInvitation, MARISOL_EMAIL, signIn } from './sign-in';

const ACTIVATION_PASSWORD = 'amber ledger quietly ferments';

/** The text of the newest mail to `recipient` whose subject matches, or null. */
async function newestMailText(recipient: string, subject: RegExp): Promise<string | null> {
  const response = await fetch('http://localhost:8025/api/v1/messages');
  const { messages } = (await response.json()) as {
    messages: { ID: string; Subject: string; To: { Address: string }[] }[];
  };
  const summary = messages.find(
    (message) =>
      subject.test(message.Subject) && message.To.some(({ Address }) => Address === recipient),
  );
  if (!summary) return null;
  const detail = await fetch(`http://localhost:8025/api/v1/message/${summary.ID}`);
  return ((await detail.json()) as { Text: string }).Text;
}

// A cold dev server compiles the pages, and activation enrolls a new authenticator.
test.describe.configure({ timeout: 120_000 });

test('changes the password with the current password and a code, then emails a notice', async ({
  page,
  browser,
}) => {
  const recipient = `change-password-${Date.now()}@example.test`;
  await signIn(page, MARISOL_EMAIL, { fresh: true });
  await page.goto('/users-access');
  await page.getByRole('button', { name: 'Invite user' }).click();
  await page.getByLabel('Email address').fill(recipient);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByRole('status')).toContainText(`Invitation sent to ${recipient}`);

  let activationUrl: string | undefined;
  await expect
    .poll(
      async () => {
        const text = await newestMailText(recipient, /./);
        activationUrl = /https?:\/\/[^\s]+\/invite\/[A-Za-z0-9_-]{43}/.exec(text ?? '')?.[0];
        return activationUrl !== undefined;
      },
      { intervals: [100], timeout: 5_000 },
    )
    .toBe(true);

  const context = await browser.newContext();
  const user = await context.newPage();
  try {
    const secret = await activateInvitation(user, activationUrl ?? '', {
      name: 'Ligaya Cruz',
      password: ACTIVATION_PASSWORD,
    });
    if (!secret) throw new Error('Activation enrolled no authenticator.');
    await user.goto('/account-security');
    await user.getByRole('button', { name: 'Change password' }).click();

    const dialog = user.getByRole('dialog', { name: 'Change password' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Current password').fill(ACTIVATION_PASSWORD);
    await dialog.getByLabel('Authentication code').fill('000000');
    await dialog.getByLabel('New password').fill('tahimik na umaga sa bundok');
    await dialog.getByRole('button', { name: 'Change password' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Current password or code is incorrect.');

    await dialog.getByLabel('New password').fill(ACTIVATION_PASSWORD);
    await dialog.getByRole('button', { name: 'Change password' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'Choose a password that’s different from your current one.',
    );

    // The step after enrollment's, which the factor already accepted.
    await dialog
      .getByLabel('Authentication code')
      .fill(totpCode(secret, new Date(Date.now() + 30_000)));
    await dialog.getByLabel('New password').fill('tahimik na umaga sa bundok');
    await dialog.getByRole('button', { name: 'Change password' }).click();
    await expect(dialog).toBeHidden();
    await expect(user.getByRole('status')).toHaveText('Password changed. We emailed you a notice.');

    await expect
      .poll(() => newestMailText(recipient, /^Your LingkodHR password was changed$/), {
        intervals: [100],
        timeout: 5_000,
      })
      .toContain('contact your Agency Administrator');
  } finally {
    await context.close();
  }
});
