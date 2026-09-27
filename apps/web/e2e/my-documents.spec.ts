import { expect, test } from '@playwright/test';

// The DTR fixture membership holds the Employee role and is linked to its own Employee record.
const linkedMembershipId = 'd7a00000-0000-4000-8000-000000000002';

test('opens My Documents in the workbench with its truthful states and upload dialog', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible({ timeout: 15000 });
  await page.goto('/my-documents');
  await expect(
    page.getByRole('heading', { level: 1, name: 'No Employee record is linked' }),
  ).toBeVisible();

  await page.goto(`/api/v1/auth/login?membershipId=${linkedMembershipId}`);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible({ timeout: 15000 });
  const navigation = page.getByRole('navigation', { name: 'Primary' });
  await navigation.getByRole('button', { name: 'Personnel' }).click();
  await navigation.getByRole('link', { name: 'My Documents' }).click();
  await expect(page).toHaveURL(/\/my-documents$/);
  await expect(navigation.getByRole('link', { name: 'My Documents' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText('Personnel');
  await expect(page.getByRole('heading', { level: 1, name: 'My Documents' })).toBeVisible();

  const panel = page.getByRole('region', { name: 'Personnel Documents' });
  await expect(panel.getByText('Loading Personnel Documents…')).toBeHidden();
  if ((await panel.getByRole('table').count()) === 0) {
    await expect(
      panel.getByText('No Personnel Documents are visible in this scope.'),
    ).toBeVisible();
  } else {
    await expect(panel.getByRole('columnheader', { name: 'Release state' })).toBeVisible();
  }
  await expect(panel.getByRole('button', { name: 'Link personnel document' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('my-documents.png'), fullPage: true });

  const upload = panel.getByRole('button', { name: 'Upload own evidence' });
  await upload.click();
  const dialog = page.getByRole('dialog', { name: 'Upload own Personnel Document' });
  await expect(dialog).toHaveAccessibleDescription(
    'Upload evidence for this Employee record. It stays pending until an authorized release.',
  );
  await expect(dialog.getByLabel('File')).toHaveAttribute('required', '');
  await expect(dialog.getByLabel('Document classification')).toHaveValue('CONFIDENTIAL');
  await expect(dialog.getByLabel('Personnel classification')).toHaveValue('PDS');
  await expect(dialog.getByLabel('Purpose')).toHaveValue('OWN_RECORD_UPLOAD');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(upload).toBeFocused();
});
