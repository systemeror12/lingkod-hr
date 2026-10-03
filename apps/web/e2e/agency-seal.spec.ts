import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { totpCode } from '@lingkod-hr/auth';
import { expect, test } from '@playwright/test';
import { MARISOL_EMAIL, signIn } from './sign-in';

const fixture = resolve(__dirname, 'fixtures/agency-seal.png');
const origin = `http://localhost:${process.env.PLAYWRIGHT_APP_PORT ?? '3100'}`;

test('stages, previews, saves, replaces, and removes a seal shown on Invitation Activation', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page, MARISOL_EMAIL);
  const me = await page.request.get('/api/v1/auth/me', { headers: { origin } });
  const { agencyId, agency } = await me.json();
  const endpoint = `/api/v1/agencies/${agencyId}/agency-profile/seal`;
  const prior = await page.request.get(endpoint, { headers: { origin } });
  const initial = (await prior.json()).seal;
  // This test owns the seal it creates; restore an initially empty settings page on completion.
  expect(initial).toBeNull();
  const inviteeContext = await browser.newContext();
  try {
    await page.goto('/organization?workspace=agency');
    await page.getByRole('link', { name: 'Seal and building photo', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Seal and building photo' })).toBeVisible();
    await page.getByLabel('Agency seal file').setInputFiles(fixture);
    await expect(page.getByText('Not saved', { exact: true })).toBeVisible();
    expect(
      (await (await page.request.get(endpoint, { headers: { origin } })).json()).seal,
    ).toBeNull();
    const preview = page.getByRole('region', { name: 'Preview · not saved' });
    await expect(preview.getByRole('img', { name: `${agency.name} seal` })).toBeVisible();
    await expect
      .poll(() =>
        preview
          .locator('img')
          .evaluateAll((images) =>
            images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
          ),
      )
      .toBe(true);
    await page.getByRole('tab', { name: 'Signed in', exact: true }).click();
    await expect(preview.getByLabel('Agency seal stamped')).toBeVisible();
    expect(
      await preview
        .getByLabel('Agency seal stamped')
        .getByRole('img')
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);
    await page.getByRole('tab', { name: 'Set password', exact: true }).click();
    await page.getByRole('button', { name: 'Save seal', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Agency seal saved.');
    const savedPreview = page.getByRole('region', { name: 'What invited Users see' });
    await expect(savedPreview.locator('img')).toHaveCount(3);
    await expect
      .poll(() =>
        savedPreview
          .locator('img')
          .evaluateAll((images) =>
            images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
          ),
      )
      .toBe(true);
    // All previews now use signed storage URLs. Simulate expiry on any new request.
    await page.route('**/agency-seals/**', (route) => route.fulfill({ status: 403 }));
    await page.getByRole('tab', { name: 'Signed in', exact: true }).click();
    expect(
      await savedPreview
        .getByLabel('Agency seal stamped')
        .getByRole('img')
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);
    await page.unroute('**/agency-seals/**');
    await page.getByRole('tab', { name: 'Set password', exact: true }).click();

    await expect(page.getByText(/Changed by Marisol Santos/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'View in Audit Log' })).toHaveAttribute(
      'href',
      '/audit',
    );
    await page.screenshot({ path: testInfo.outputPath('agency-seal-saved.png'), fullPage: true });

    await page.getByLabel('Agency seal file').setInputFiles({
      name: 'wrong.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg/>'),
    });
    await expect(
      page.getByRole('region', { name: 'Agency seal', exact: true }).getByRole('alert'),
    ).toContainText('wrong.svg: Use a PNG or JPEG image. The current seal is unchanged.');
    await page.getByLabel('Agency seal file').setInputFiles({
      name: 'replacement.png',
      mimeType: 'image/png',
      buffer: readFileSync(fixture),
    });
    await page.getByRole('button', { name: 'Save seal', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Agency seal saved.');
    await page.reload();
    await expect(page.getByText('replacement.png', { exact: true })).toBeVisible();

    const recipient = `seal-invite-${Date.now()}@example.test`;
    const invitationResponse = await page.request.post(`/api/v1/agencies/${agencyId}/invitations`, {
      headers: { origin },
      data: { email: recipient, roleCodes: ['hrmo_administrator'] },
    });
    expect(invitationResponse.ok()).toBe(true);
    const { activationUrl } = await invitationResponse.json();
    const invitee = await inviteeContext.newPage();
    await invitee.goto(activationUrl);
    const mark = invitee.getByRole('img', { name: `${agency.name} seal` });
    await expect(mark).toBeVisible();
    const signedUrl = await mark.getAttribute('src');
    expect(signedUrl).toContain('X-Amz-Signature=');
    expect(signedUrl).toContain('X-Amz-Expires=300');
    expect((await invitee.request.get(signedUrl!)).status()).toBe(200);
    await expect
      .poll(() =>
        invitee
          .locator('img')
          .evaluateAll((images) =>
            images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
          ),
      )
      .toBe(true);
    await inviteeContext.route('**/agency-seals/**', (route) => route.fulfill({ status: 403 }));
    await invitee.getByLabel('Full name').fill('Invited Seal User');
    await invitee.getByLabel('New password').fill('amber ledger quietly ferments');
    await invitee.getByRole('button', { name: 'Continue', exact: true }).click();
    await invitee.getByText('Show setup key').click();
    const uri = await invitee.getByTestId('otpauth-uri').textContent();
    const secret = new URL(uri!).searchParams.get('secret')!;
    await invitee.getByLabel('Authentication code').fill(totpCode(secret, new Date()));
    await invitee.getByRole('button', { name: 'Confirm code' }).click();
    await invitee.getByLabel('I’ve saved these Recovery Codes somewhere safe.').check();
    await invitee.getByRole('button', { name: 'Finish activation' }).click();
    await expect(invitee.getByRole('heading', { name: /^You now have access to / })).toBeVisible();
    await expect(invitee.getByLabel('Agency seal stamped').getByRole('img')).toBeVisible();
    expect(
      await invitee
        .getByLabel('Agency seal stamped')
        .getByRole('img')
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);
    await invitee.screenshot({
      path: testInfo.outputPath('invitation-seal-stamped.png'),
      fullPage: true,
    });

    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Remove the Agency seal?' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep seal', exact: true }).click();
    await expect(page.getByText('replacement.png', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByRole('button', { name: 'Remove seal', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Agency seal removed.');
    await expect(page.getByText('No seal yet.', { exact: false })).toBeVisible();
    await page.goto('/sign-in');
    await expect(page.getByRole('img', { name: `${agency.name} seal` })).toHaveCount(0);
  } finally {
    await inviteeContext.close();
    const current = (await (await page.request.get(endpoint, { headers: { origin } })).json()).seal;
    if (current)
      await page.request.delete(endpoint, {
        headers: { origin },
        data: { expectedSealId: current.id },
      });
  }
});
