import { expect, test, type Locator } from '@playwright/test';

async function expectCenteredDialog(dialog: Locator, viewportWidth: number): Promise<void> {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('The PDS dialog geometry was unavailable.');
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth - 16);
  expect(Math.abs(box.x + box.width / 2 - viewportWidth / 2)).toBeLessThanOrEqual(1);
}

async function expectFocusInside(dialog: Locator): Promise<void> {
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
}

test('creates and edits a Draft PDS personal and family record', async ({ page }) => {
  const stamp = Date.now();
  const employeeNumber = `E2E-PDS-${stamp}`;
  const legalName = `E2E PDS Employee ${stamp}`;
  const dialog = page.getByRole('dialog');

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible({ timeout: 15000 });
  await page.goto('/employees');
  await page.getByRole('link', { name: 'Create employee' }).click();
  await page.getByLabel('Employee number').fill(employeeNumber);
  await page.getByLabel('Legal name').fill(legalName);
  await page.getByLabel('Birth date').fill('1995-06-15');
  await page.getByLabel('Sex').selectOption('FEMALE');
  await page.getByLabel('Civil status').selectOption('SINGLE');
  await page.getByLabel('Contact email').fill(`e2e.pds.${stamp}@example.test`);
  await page.getByRole('button', { name: 'Create employee' }).click();
  await expect(page.getByRole('heading', { name: legalName })).toBeVisible();

  await page.getByLabel('Agency Membership').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Link membership' }).click();
  await expect(page.getByText('LINKED', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Maintain PDS' }).click();
  await expect(page.getByRole('heading', { name: `${legalName} · PDS` })).toBeVisible();

  await page.getByRole('button', { name: 'Create Draft PDS' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName('Create Draft PDS');
  await expect(dialog).toHaveAccessibleDescription(
    'Items 1-27 are saved as one protected Draft. Empty fields remain available for later completion.',
  );
  await expect(dialog.getByLabel('As-of date')).toBeFocused();
  await expectCenteredDialog(dialog, 1280);
  await page.mouse.click(1, 1);
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    await expectFocusInside(dialog);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Create Draft PDS' })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Create Draft PDS' }).click();
  await expect(dialog).toBeVisible();
  await expectCenteredDialog(dialog, 390);
  await page.setViewportSize({ width: 1280, height: 720 });
  await dialog.getByLabel('Surname').nth(0).fill('Santos');
  await dialog.getByLabel('First name').nth(0).fill('Mara');
  await dialog.getByLabel('Birth date').fill('1994-05-12');
  await dialog.getByLabel('Place of birth').fill('Quezon City');
  await dialog.getByLabel('Sex at birth').selectOption('FEMALE');
  await dialog.getByLabel('Civil status').selectOption('MARRIED');
  await dialog.getByLabel('Citizenship').selectOption('FILIPINO');
  await dialog.getByLabel('Mobile').fill('09171234567');
  await dialog.getByLabel('Email address').fill('mara.santos@example.test');
  await dialog.getByLabel('Surname').nth(1).fill('Santos');
  await dialog.getByLabel('First name').nth(1).fill('Jose');
  await dialog.getByLabel('Surname').nth(2).fill('Santos');
  await dialog.getByLabel('First name').nth(2).fill('Pedro');
  await dialog.getByLabel('Surname').nth(3).fill('Reyes');
  await dialog.getByLabel('First name').nth(3).fill('Ana');
  await dialog.getByRole('button', { name: 'Add child' }).click();
  await dialog.getByLabel('Full name').fill('Mara Santos Jr.');
  await dialog.getByLabel('Date of birth').fill('2020-04-20');
  const educationSection = dialog.locator('fieldset').filter({ hasText: 'Educational background' });
  await dialog.getByRole('button', { name: 'Add education row' }).click();
  await dialog.getByLabel('Education level').selectOption('COLLEGE');
  await dialog.getByLabel('Name of school').fill('University of the Philippines');
  await dialog.getByLabel('Basic education / degree / course').fill('BS Public Administration');
  await dialog.getByLabel('Period of attendance').fill('2010-2014');
  await dialog.getByLabel('Highest level / units earned').fill('N/A');
  await dialog.getByLabel('Year graduated').fill('2014');
  await dialog.getByLabel('Scholarship / academic honors').fill('N/A');
  await dialog.getByRole('button', { name: 'Add education row' }).click();
  await expect(dialog.getByLabel('Education level')).toHaveCount(2);
  await dialog.getByLabel('Education level').nth(1).selectOption('ELEMENTARY');
  await dialog.getByRole('button', { name: 'Move education row up' }).nth(1).click();
  await expect(dialog.getByLabel('Education level').nth(0)).toHaveValue('ELEMENTARY');
  await expect(dialog.getByLabel('Education level').nth(1)).toHaveValue('COLLEGE');
  await educationSection.getByRole('button', { name: 'Remove' }).first().click();
  await dialog.getByRole('button', { name: 'Add eligibility row' }).click();
  await dialog.getByLabel('Eligibility name / category').fill('Career Service Professional');
  await dialog.getByLabel('Rating').fill('Passed');
  await dialog.getByLabel('Place of examination / conferment').fill('Manila');
  const routePattern = '**/api/v1/agencies/**/pds**';
  let releaseCreate: () => void = () => {};
  const createHeld = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  await page.route(routePattern, async (route) => {
    if (route.request().method() === 'POST') await createHeld;
    await route.continue();
  });
  const saveButton = dialog.locator('button[type="submit"]');
  const saveRequest = saveButton.click();
  await expect(saveButton).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  releaseCreate();
  await saveRequest;
  await page.unroute(routePattern);

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText('PDS Draft created.');
  await expect(page.getByText('Mara Santos Jr.', { exact: true })).toBeVisible();
  await expect(page.getByText('University of the Philippines', { exact: true })).toBeVisible();
  await expect(page.getByText('Career Service Professional', { exact: true })).toBeVisible();
  await expect(page.getByText('Married', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit personal and family information' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Place of birth').fill('Manila');
  await dialog
    .locator('fieldset')
    .filter({ hasText: 'Educational background' })
    .getByRole('button', { name: 'Remove' })
    .click();
  await dialog
    .locator('fieldset')
    .filter({ hasText: 'Civil-service eligibility' })
    .getByRole('button', { name: 'Remove' })
    .click();
  await dialog.getByRole('button', { name: 'Save Draft' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText('PDS Draft saved.');
  await expect(page.getByText('Manila', { exact: true })).toBeVisible();
  await expect(page.getByText('No education rows recorded.', { exact: true })).toBeVisible();
  await expect(page.getByText('No eligibility rows recorded.', { exact: true })).toBeVisible();
});
