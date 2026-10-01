import { expect, test } from '@playwright/test';

// Activation is prospective: the form accepts only dates after today in Manila.
function prospectiveDate(offsetDays = 30): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

test('administers an effective-dated Agency Profile through the Version Rail', async ({
  page,
}, testInfo) => {
  const effectiveDate = prospectiveDate();
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/organization?workspace=agency');

  await expect(page.getByRole('heading', { name: 'Agency record through time' })).toBeVisible();
  const rail = page.getByRole('navigation', { name: 'Agency Profile Versions' });
  await expect(rail).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'National Archives Coordination Office' }),
  ).toBeVisible();

  const prepare = page.getByRole('button', { name: 'Prepare successor' });
  if (await prepare.count()) await prepare.click();
  await expect(rail.getByRole('button', { name: 'V2' })).toBeVisible();
  await rail.getByRole('button', { name: 'V2' }).click();
  await expect(
    page.getByRole('heading', { name: 'National Archives Coordination Office' }),
  ).toBeVisible();

  const editOpener = page.getByRole('button', { name: 'Continue draft' });
  await editOpener.click();
  const editDialog = page.getByRole('region', { name: 'Edit draft successor' });
  await expect(editDialog).toBeVisible();
  await expect(editDialog).toHaveAccessibleDescription(
    'Edit the successor fields before activation. Activated versions cannot be rewritten.',
  );
  await expect(page.getByLabel('Official name')).toBeFocused();
  await page.mouse.click(1, 1);
  await expect(editDialog).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(editDialog).toBeHidden();
  await expect(editOpener).toBeFocused();
  await editOpener.click();
  await expect(editDialog).toBeVisible();

  await page.getByLabel('Official name').fill('');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Enter the official name.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Official name')).toBeFocused();

  await page.getByLabel('Official name').fill('National Archives and Records Office');
  await page.getByLabel('Acronym').fill('NARO');
  await page.getByLabel('Agency type').selectOption('NGA');
  await page.getByLabel('Parent organization').fill('Office of the President');
  await page.getByLabel('Reporting identifiers').fill('UACS 240010000 · CSC 04-118');
  await page.getByLabel('Appointing-authority title').fill('Secretary');
  await page.getByLabel('Default timezone').selectOption('Asia/Manila');
  await page.getByLabel('Default currency').selectOption('PHP');
  await page.getByLabel('Proposed effective date').fill(effectiveDate);
  let patchRequests = 0;
  await page.route('**/api/v1/agencies/*/agency-profile/draft/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      patchRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await route.continue();
  });
  const saveButton = page.getByRole('button', { name: 'Save draft' });
  await saveButton.click();
  await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('Draft successor saved.');
  expect(patchRequests).toBe(1);
  await page.unroute('**/api/v1/agencies/*/agency-profile/draft/*');
  await expect(editDialog).toBeHidden();

  await page.getByRole('button', { name: 'Review activation' }).click();
  const activationDialog = page.getByRole('dialog', { name: 'Review activation' });
  await expect(activationDialog).toBeVisible();
  await expect(page.getByLabel('Effective date')).toBeFocused();
  await page.getByLabel('Effective date').fill(effectiveDate);
  await page.getByLabel('Reason for change').fill('Approved prospective Agency identity change.');
  await page.getByRole('button', { name: 'Activate successor' }).click();
  await expect(page.getByRole('status')).toContainText('Version 2 is activated for');
  await expect(activationDialog).toBeHidden();
  await expect(rail.getByRole('button', { name: 'V2' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('article dd').filter({ hasText: /^NARO$/ })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('agency-profile-version-rail.png'),
    fullPage: true,
  });
});
