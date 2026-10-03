import { totpCode } from '@lingkod-hr/auth';
import { expect, test } from '@playwright/test';
import { LOCAL_SEED_PASSPHRASE, signIn } from './sign-in';

// Seeded in the National Archives Coordination Office; each seed run restores the candidate's factor.
const securityOfficer = 'security.officer@example.test';
const candidate = 'factor.reset.candidate@example.test';

async function newestMail(
  recipient: string,
  subject: RegExp,
): Promise<{ id: string; text: string } | null> {
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
  return { id: summary.ID, text: ((await detail.json()) as { Text: string }).Text };
}

// A cold dev server compiles the pages, and enrollment hashes new Recovery Codes.
test.describe.configure({ timeout: 120_000 });

test('a Security Administrator resets a factor, and the User enrolls again at sign-in', async ({
  page,
  browser,
}) => {
  const noticeSubject = /authenticator for your LingkodHR account was reset/;
  const earlier = await newestMail(candidate, noticeSubject);

  await signIn(page, securityOfficer, { fresh: true });
  await page.goto('/users-access');
  await expect(page.getByRole('heading', { name: 'Users & Access' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite user' })).toHaveCount(0);
  const row = page.getByRole('row', { name: /Factor Reset Candidate/ });
  await expect(row.getByRole('cell', { name: 'Set up', exact: true })).toBeVisible();
  // No one resets their own factor.
  await expect(
    page
      .getByRole('row', { name: /Security Officer/ })
      .getByRole('button', { name: 'Reset authenticator' }),
  ).toHaveCount(0);

  await row.getByRole('button', { name: 'Reset authenticator' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset authenticator' });
  await dialog.getByRole('button', { name: 'Reset authenticator' }).click();
  await expect(dialog.getByText('Choose how you verified the User and add a note.')).toBeVisible();
  await dialog.getByLabel('In person, with a government ID').check();
  await dialog.getByLabel('Note').fill('Checked their PhilSys ID at the HR counter.');
  await dialog.getByRole('button', { name: 'Reset authenticator' }).click();

  await expect(page.getByRole('status')).toContainText(
    'Factor Reset Candidate’s authenticator was reset.',
  );
  await expect(row.getByRole('cell', { name: 'Not set up', exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const mail = await newestMail(candidate, noticeSubject);
      return mail && mail.id !== earlier?.id ? mail.text : null;
    })
    .toContain(
      'A Security Administrator of National Archives Coordination Office reset your authenticator on',
    );

  const context = await browser.newContext();
  const user = await context.newPage();
  try {
    await user.goto('/sign-in');
    await user.getByLabel('Email').fill(candidate);
    await user.getByLabel('Password').fill(LOCAL_SEED_PASSPHRASE);
    await user.getByRole('button', { name: 'Sign in' }).click();
    await expect(user.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();

    await user.getByText('Show setup key').click();
    const otpauthUri = await user.getByTestId('otpauth-uri').textContent();
    const secret = new URL(otpauthUri ?? '').searchParams.get('secret') ?? '';
    await user.getByLabel('Authentication code').fill(totpCode(secret, new Date()));
    await user.getByRole('button', { name: 'Confirm code' }).click();

    await expect(user.getByRole('heading', { name: 'Save your Recovery Codes' })).toBeVisible();
    await user.getByLabel('I’ve saved these Recovery Codes somewhere safe.').check();
    await user.getByRole('button', { name: 'Continue' }).click();
    await expect(user.getByRole('heading', { name: 'You’re set up' })).toBeVisible();
    await user.getByRole('button', { name: 'Open workspace' }).click();
    await expect(user).toHaveURL(/\/dashboard$/);
  } finally {
    await context.close();
  }
});
