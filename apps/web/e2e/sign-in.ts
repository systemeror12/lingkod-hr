import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { totpCode, totpStep } from '@lingkod-hr/auth';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Duplicated from packages/database/scripts/seed-protected-shell-e2e.ts.
export const LOCAL_SEED_PASSPHRASE = 'local-only seed passphrase';
export const LOCAL_SEED_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
/** Every seed run restores all ten for each seeded MFA-Required User. */
export const LOCAL_SEED_RECOVERY_CODES = [
  'seedc-ode22',
  'seedc-ode23',
  'seedc-ode24',
  'seedc-ode25',
  'seedc-ode26',
  'seedc-ode27',
  'seedc-ode32',
  'seedc-ode33',
  'seedc-ode34',
  'seedc-ode35',
];
const SESSION_COOKIE = 'hris_session';
/** The seeded Agency Administrator most specs work as. */
export const MARISOL_EMAIL = 'marisol.santos@example.test';

type Cookie = Parameters<BrowserContext['addCookies']>[0][number];

const sessions = new Map<string, Cookie>();
// The API accepts each step once, and every worktree shares one database, so the last used step
// outlives this worker.
const lastStepFile = join(tmpdir(), 'lingkod-hr-e2e-totp-step');

function lastUsedStep(): number {
  try {
    return Number(readFileSync(lastStepFile, 'utf8')) || 0;
  } catch {
    return 0;
  }
}

/** The seeded authenticator's code for a step not used yet, waiting for the next step if needed. */
export async function nextTotpCode(): Promise<string> {
  const used = lastUsedStep();
  const waitMs = (used + 1) * 30_000 - Date.now();
  if (waitMs > 0) {
    test.info().setTimeout(test.info().timeout + waitMs);
    await new Promise((resolve) => setTimeout(resolve, waitMs + 250));
  }
  const at = new Date();
  writeFileSync(lastStepFile, String(totpStep(at)));
  return totpCode(LOCAL_SEED_TOTP_SECRET, at);
}

/**
 * Signs a seeded User in through `/sign-in`, answering the TOTP step when the User has a factor.
 * Reuses the session cookie for the same User and membership while `/api/v1/auth/me` accepts it.
 * Pass `fresh` before a guarded action, such as sending an invitation, so the Reauthentication
 * Window is open.
 */
export async function signIn(
  page: Page,
  email: string,
  options: { membershipId?: string; fresh?: boolean } = {},
): Promise<void> {
  const key = `${email}:${options.membershipId ?? ''}`;
  const cached = options.fresh ? undefined : sessions.get(key);
  if (cached) {
    await page.context().addCookies([cached]);
    // The API refuses cookie requests without a same-origin Origin or Referer.
    const origin = new URL(test.info().project.use.baseURL ?? 'http://localhost:3100').origin;
    const me = await page.request.get('/api/v1/auth/me', { headers: { origin } });
    if (me.ok()) return;
    sessions.delete(key);
    await page.context().clearCookies({ name: SESSION_COOKIE });
  }

  await page.goto(
    options.membershipId ? `/sign-in?membershipId=${options.membershipId}` : '/sign-in',
  );
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(LOCAL_SEED_PASSPHRASE);
  await page.getByRole('button', { name: 'Sign in' }).click();

  const codeField = page.getByLabel('Authentication code');
  await expect(codeField.or(page.getByRole('heading', { name: 'Work queue' }))).toBeVisible();
  if (await codeField.isVisible()) {
    await codeField.fill(await nextTotpCode());
    await page.getByRole('button', { name: 'Verify' }).click();
  }
  // The first spec of a shard waits for a cold dev server to compile /dashboard.
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

  const session = (await page.context().cookies()).find(({ name }) => name === SESSION_COOKIE);
  if (!session) throw new Error(`No session cookie after signing in ${email}.`);
  sessions.set(key, session);
}

/**
 * Activates an invitation through `/invite/<token>` and leaves `page` signed in on `/dashboard`.
 * A first-time invitee sets `name` and a new password. An existing User proves the seed password
 * and answers the seeded authenticator. Either one enrolls a new authenticator when the invited
 * roles need MFA and the User has none, and answers its secret.
 */
export async function activateInvitation(
  page: Page,
  url: string,
  options: { name?: string; password?: string } = {},
): Promise<string | null> {
  await page.goto(url);
  if (options.name) {
    await page.getByLabel('Full name').fill(options.name);
    await page.getByLabel('New password').fill(options.password ?? 'amber ledger quietly ferments');
  } else {
    await page.getByLabel('Password').fill(LOCAL_SEED_PASSPHRASE);
  }
  await page.getByRole('button', { name: 'Continue' }).click();

  const codeField = page.getByLabel('Authentication code');
  const enroll = page.getByRole('heading', { name: 'Set up your authenticator' });
  const done = page.getByRole('heading', { name: /^You now have access to / });
  await expect(enroll.or(codeField).or(done).first()).toBeVisible();
  let enrolledSecret: string | null = null;
  if (await enroll.isVisible()) {
    await page.getByText('Show setup key').click();
    const otpauthUri = await page.getByTestId('otpauth-uri').textContent();
    expect(otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const secret = new URL(otpauthUri ?? '').searchParams.get('secret') ?? '';
    enrolledSecret = secret;
    await codeField.fill(totpCode(secret, new Date()));
    await page.getByRole('button', { name: 'Confirm code' }).click();
    await expect(
      page.getByRole('list', { name: 'Recovery Codes' }).getByRole('listitem'),
    ).toHaveCount(10);
    await page.getByLabel('I’ve saved these Recovery Codes somewhere safe.').check();
    await page.getByRole('button', { name: 'Finish activation' }).click();
  } else if (await codeField.isVisible()) {
    await codeField.fill(await nextTotpCode());
    await page.getByRole('button', { name: 'Accept invitation' }).click();
  }
  await expect(done).toBeVisible();
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return enrolledSecret;
}
