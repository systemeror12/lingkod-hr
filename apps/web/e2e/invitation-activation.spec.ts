import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword, normalizeRecoveryCode, sealTotpSecret } from '@lingkod-hr/auth';
import { getConfig, parseProtectedValueKey } from '@lingkod-hr/config';
import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  LOCAL_SEED_PASSPHRASE,
  LOCAL_SEED_RECOVERY_CODES,
  LOCAL_SEED_TOTP_SECRET,
  MARISOL_EMAIL,
  nextTotpCode,
  signIn,
} from './sign-in';

const AGENCY_NAME = 'National Archives Coordination Office';

/**
 * Creates a User with no Agency Membership who signs in with the seed passphrase, the seeded
 * authenticator, and the ten seed Recovery Codes, as the seed does for its MFA-Required Users.
 */
async function createExistingUser(email: string): Promise<void> {
  const config = getConfig();
  const adminUrl = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!adminUrl) throw new Error('A worktree database owner URL is required to create a User.');
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    const [passwordHash, ...codeHashes] = await Promise.all([
      hashPassword(LOCAL_SEED_PASSPHRASE),
      ...LOCAL_SEED_RECOVERY_CODES.map((code) => hashPassword(normalizeRecoveryCode(code) ?? '')),
    ]);
    const user = await admin.user.create({
      data: {
        emailNormalized: email,
        displayName: 'Existing Invitee',
        globalStatus: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    const factorId = randomUUID();
    await admin.$transaction([
      admin.userPassword.create({ data: { userId: user.id, passwordHash: passwordHash ?? '' } }),
      admin.userTotpFactor.create({
        data: {
          id: factorId,
          userId: user.id,
          secretEnvelope: sealTotpSecret(
            LOCAL_SEED_TOTP_SECRET,
            parseProtectedValueKey(config.DATA_ENCRYPTION_KEY),
            { userId: user.id, factorId },
          ),
        },
      }),
      admin.userRecoveryCode.createMany({
        data: codeHashes.map((codeHash) => ({ userId: user.id, codeHash })),
      }),
    ]);
  } finally {
    await admin.$disconnect();
  }
}

/** Marisol invites `email` as an HRMO Administrator; answers the activation path from the mail. */
async function invite(page: Page, email: string): Promise<string> {
  await signIn(page, MARISOL_EMAIL, { fresh: true });
  const origin = new URL(page.url()).origin;
  const me = await page.request.get('/api/v1/auth/me', { headers: { origin } });
  const { agencyId } = (await me.json()) as { agencyId: string };
  const invited = await page.request.post(`/api/v1/agencies/${agencyId}/invitations`, {
    headers: { origin },
    data: { email, roleCodes: ['hrmo_administrator'] },
  });
  expect(invited.ok(), await invited.text()).toBe(true);

  let path: string | undefined;
  await expect
    .poll(
      async () => {
        const response = await fetch('http://localhost:8025/api/v1/messages');
        if (!response.ok) throw new Error('Mailpit message listing failed.');
        const { messages } = (await response.json()) as {
          messages: { ID: string; Subject: string; To: { Address: string }[] }[];
        };
        const summary = messages.find(
          ({ Subject, To }) =>
            Subject === `LingkodHR invitation for ${AGENCY_NAME}` &&
            To.some(({ Address }) => Address === email),
        );
        if (!summary) return null;
        const detail = await fetch(`http://localhost:8025/api/v1/message/${summary.ID}`);
        const { Text } = (await detail.json()) as { Text: string };
        path = /\/invite\/[A-Za-z0-9_-]{43}/.exec(Text)?.[0];
        return path ?? null;
      },
      { intervals: [100], timeout: 5_000 },
    )
    .not.toBeNull();
  return path ?? '';
}

/** Opens the invitation as the existing User in their own browser and confirms the password. */
async function startActivation(browser: Browser, path: string): Promise<Page> {
  const invitee = await (await browser.newContext()).newPage();
  await invitee.goto(path);
  await expect(invitee.getByRole('heading', { name: 'Join NACO with your account' })).toBeVisible();
  await invitee.getByLabel('Password').fill(LOCAL_SEED_PASSPHRASE);
  await invitee.getByRole('button', { name: 'Continue' }).click();
  await expect(invitee.getByLabel('Authentication code')).toBeFocused();
  return invitee;
}

// A cold dev server compiles the invitation page, and the TOTP step may wait for the next code.
test.describe.configure({ timeout: 120_000 });

test('shows the Recovery Codes left before an activation proved with one continues', async ({
  page,
  browser,
}) => {
  const email = `activation-recovery-${Date.now()}@example.test`;
  await createExistingUser(email);
  const invitee = await startActivation(browser, await invite(page, email));
  try {
    await invitee.getByRole('button', { name: 'No phone? Use a Recovery Code' }).click();
    await invitee
      .getByRole('textbox', { name: 'Recovery Code' })
      .fill(LOCAL_SEED_RECOVERY_CODES[0] ?? '');
    await invitee.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(
      invitee.getByRole('heading', { name: 'You accepted the invitation with a Recovery Code' }),
    ).toBeVisible();
    await expect(invitee.getByText('9 Recovery Codes')).toBeVisible();
    await expect(invitee.getByText('If you lost your authenticator, replace it')).toBeVisible();

    await invitee.getByRole('button', { name: 'Continue' }).click();
    await expect(
      invitee.getByRole('heading', { name: 'You now have access to NACO' }),
    ).toBeVisible();
    await invitee.getByRole('button', { name: 'Open workspace' }).click();
    await expect(invitee).toHaveURL(/\/dashboard$/);
    await expect(invitee.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  } finally {
    await invitee.context().close();
  }
});

test('continues straight to the inviting Agency after an activation proved with the authenticator', async ({
  page,
  browser,
}) => {
  const email = `activation-totp-${Date.now()}@example.test`;
  await createExistingUser(email);
  const invitee = await startActivation(browser, await invite(page, email));
  try {
    await invitee.getByLabel('Authentication code').fill(await nextTotpCode());
    await invitee.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(
      invitee.getByRole('heading', { name: 'You now have access to NACO' }),
    ).toBeVisible();
    await expect(invitee.getByText(/Recovery Codes? left/)).toHaveCount(0);
  } finally {
    await invitee.context().close();
  }
});
