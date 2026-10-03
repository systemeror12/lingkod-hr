import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { totpCode } from '@lingkod-hr/auth';
import { expect, test, type Page } from '@playwright/test';
import { MARISOL_EMAIL, signIn } from './sign-in';

const fixture = resolve(__dirname, 'fixtures/agency-building-photo.jpg');
const origin = `http://localhost:${process.env.PLAYWRIGHT_APP_PORT ?? '3100'}`;

const tintOpacity = (page: Page) =>
  page.getByTestId('photo-dawn-tint').evaluate((tint) => Number(getComputedStyle(tint).opacity));

test('uploads, toggles, and removes a building photo shown on Invitation Activation', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page, MARISOL_EMAIL);
  const me = await page.request.get('/api/v1/auth/me', { headers: { origin } });
  const { agencyId, agency } = await me.json();
  const endpoint = `/api/v1/agencies/${agencyId}/agency-profile/building-photo`;
  const initial = (await (await page.request.get(endpoint, { headers: { origin } })).json()).photo;
  // This test owns the photo it creates; restore an initially empty settings page on completion.
  expect(initial).toBeNull();
  const photoName = `${agency.name} building`;
  const inviteeContext = await browser.newContext();
  try {
    await page.goto('/organization/agency-branding');
    const panel = page.getByRole('region', { name: 'Building photo', exact: true });
    await expect(panel.getByText('No photo. Invitations show the drawn sunrise.')).toBeVisible();
    await page.getByLabel('Building photo file').setInputFiles({
      name: 'narrow.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg/>'),
    });
    await expect(panel.getByRole('alert')).toContainText(
      'narrow.svg: Use a PNG or JPEG image. The current photo is unchanged.',
    );

    await page.getByLabel('Building photo file').setInputFiles(fixture);
    await expect(panel.getByText('Not saved', { exact: true })).toBeVisible();
    const staged = page.getByRole('region', { name: 'Preview · not saved' });
    await expect(staged.getByRole('img', { name: photoName }).first()).toBeVisible();
    await panel.getByRole('button', { name: 'Save photo', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('Building photo saved.');
    const preview = page.getByRole('region', { name: 'What invited Users see' });
    await expect(preview.locator(`img[alt="${photoName}"]`)).toHaveCount(2);

    const toggle = panel.getByLabel('Show on Invitation screens');
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(panel.getByRole('status')).toContainText('Building photo turned off.');
    await expect(preview.locator(`img[alt="${photoName}"]`)).toHaveCount(0);

    const invitationResponse = await page.request.post(`/api/v1/agencies/${agencyId}/invitations`, {
      headers: { origin },
      data: { email: `photo-invite-${Date.now()}@example.test`, roleCodes: ['hrmo_administrator'] },
    });
    expect(invitationResponse.ok()).toBe(true);
    const { activationUrl } = await invitationResponse.json();
    const invitee = await inviteeContext.newPage();
    await invitee.goto(activationUrl);
    await expect(
      invitee.getByRole('heading', { name: 'Activate your LingkodHR access' }),
    ).toBeVisible();
    await expect(invitee.getByRole('img', { name: photoName })).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(panel.getByRole('status')).toContainText('Building photo turned on.');
    await expect(preview.locator(`img[alt="${photoName}"]`)).toHaveCount(2);
    await page.reload();
    await expect(
      page
        .getByRole('region', { name: 'Building photo', exact: true })
        .getByLabel('Show on Invitation screens'),
    ).toBeChecked();

    await invitee.reload();
    const photo = invitee.getByRole('img', { name: photoName });
    await expect(photo).toBeVisible();
    const signedUrl = await photo.getAttribute('src');
    expect(signedUrl).toContain('X-Amz-Signature=');
    expect(signedUrl).toContain('agency-building-photos');
    await expect
      .poll(() => photo.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBe(1600);
    await expect.poll(() => tintOpacity(invitee)).toBeGreaterThan(0.5);
    await invitee.screenshot({ path: testInfo.outputPath('invitation-photo-dawn.png') });

    await invitee.getByLabel('Full name').fill('Invited Photo User');
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
    await expect.poll(() => tintOpacity(invitee)).toBe(0);
    await invitee.screenshot({ path: testInfo.outputPath('invitation-photo-signed-in.png') });

    const settings = page.getByRole('region', { name: 'Building photo', exact: true });
    await settings.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByRole('button', { name: 'Remove photo', exact: true }).click();
    await expect(settings.getByRole('status')).toContainText('Building photo removed.');
    await expect(settings.getByText('No photo. Invitations show the drawn sunrise.')).toBeVisible();
  } finally {
    await inviteeContext.close();
    const current = (await (await page.request.get(endpoint, { headers: { origin } })).json())
      .photo;
    if (current)
      await page.request.delete(endpoint, {
        headers: { origin },
        data: { expectedPhotoId: current.id },
      });
  }
});

test('shows the final photo state without animation when reduced motion is on', async ({
  page,
  browser,
}) => {
  await signIn(page, MARISOL_EMAIL);
  const me = await page.request.get('/api/v1/auth/me', { headers: { origin } });
  const { agencyId, agency } = await me.json();
  const endpoint = `/api/v1/agencies/${agencyId}/agency-profile/building-photo`;
  expect(
    (await (await page.request.get(endpoint, { headers: { origin } })).json()).photo,
  ).toBeNull();
  const saved = await page.request.put(endpoint, {
    headers: { origin },
    multipart: {
      expectedPhotoId: '',
      file: { name: 'building.jpg', mimeType: 'image/jpeg', buffer: readFileSync(fixture) },
    },
  });
  expect(saved.ok()).toBe(true);
  const { photo } = await saved.json();
  const reduced = await browser.newContext({ reducedMotion: 'reduce' });
  try {
    const invitation = await page.request.post(`/api/v1/agencies/${agencyId}/invitations`, {
      headers: { origin },
      data: { email: `photo-still-${Date.now()}@example.test`, roleCodes: ['hrmo_administrator'] },
    });
    const invitee = await reduced.newPage();
    await invitee.goto((await invitation.json()).activationUrl);
    await expect(invitee.getByRole('img', { name: `${agency.name} building` })).toBeVisible();
    const transition = await invitee
      .getByTestId('photo-dawn-tint')
      .evaluate((tint) => getComputedStyle(tint).transitionDuration);
    expect(transition.split(',').every((duration) => parseFloat(duration) === 0)).toBe(true);
  } finally {
    await reduced.close();
    await page.request.delete(endpoint, {
      headers: { origin },
      data: { expectedPhotoId: photo.id },
    });
  }
});
