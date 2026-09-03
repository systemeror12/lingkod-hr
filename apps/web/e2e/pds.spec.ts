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
  let createPayload: Record<string, unknown> | null = null;

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
    'Items 1–30 and Work Experience Sheet rows are saved as one protected Draft. Empty fields remain available for later completion.',
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
  await dialog.getByRole('button', { name: 'Add work experience' }).click();
  await dialog.getByRole('button', { name: 'Add work experience' }).click();
  await dialog.getByLabel('Position title').nth(0).fill('Administrative Assistant II');
  await dialog
    .getByLabel('Department / agency / office / company')
    .nth(0)
    .fill('Records Management Unit');
  await dialog.getByLabel('Inclusive from').nth(0).fill('2020-06-01');
  await dialog.getByLabel('Government service').nth(0).selectOption('Y');
  await dialog.getByLabel('Position title').nth(1).fill('Administrative Officer IV');
  await dialog
    .getByLabel('Department / agency / office / company')
    .nth(1)
    .fill('Human Resource Management Division');
  await dialog.getByRole('group', { name: 'Work experience 2' }).getByLabel('Current work').check();
  await dialog.getByLabel('Government service').nth(1).selectOption('Y');
  await dialog.getByRole('button', { name: 'Move work experience 2 up' }).click();
  await expect(dialog.getByLabel('Position title').nth(0)).toHaveValue('Administrative Officer IV');
  await dialog.getByRole('button', { name: 'Add voluntary work' }).click();
  await dialog.getByLabel('Organization name and address').fill('Barangay San Isidro, Quezon City');
  await dialog.getByLabel('Position / nature of work').fill('Community organizer');
  await dialog.getByLabel('Inclusive from').nth(1).fill('2019-01-01');
  await dialog.getByLabel('Inclusive to').nth(1).fill('2019-12-31');
  await dialog.getByLabel('Number of hours').nth(0).fill('24');
  await dialog.getByRole('button', { name: 'Add learning and development' }).click();
  await dialog.getByLabel('Intervention / training title').fill('Records management workshop');
  await dialog.getByLabel('Type', { exact: true }).fill('Technical');
  await dialog.getByLabel('Attendance from').fill('2024-03-01');
  await dialog.getByLabel('Attendance to').fill('2024-03-02');
  await dialog.getByLabel('Number of hours').nth(1).fill('16');
  await dialog.getByLabel('Conducted / sponsored by').fill('Civil Service Commission');
  await dialog.getByRole('button', { name: 'Add WES artifact' }).click();
  await dialog.getByLabel('Context key').fill('vacancy-1');
  await dialog.getByLabel('Parent work-experience row').selectOption({ index: 1 });
  await dialog.getByLabel('Duration text').fill('January 2018 - Present');
  await dialog.getByLabel('Position', { exact: true }).fill('Administrative Officer IV');
  await dialog.getByLabel('Office / unit').fill('Human Resource Management Division');
  await dialog.getByLabel('Immediate supervisor').fill('Alicia Ramos');
  await dialog.getByLabel('Agency / organization / location').fill('Lingkod HR, Quezon City');
  await dialog
    .getByLabel('Summary of actual duties')
    .fill('Led personnel records maintenance and supervised administrative services.');
  const routePattern = '**/api/v1/agencies/**/pds**';
  let releaseCreate: () => void = () => {};
  const createHeld = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  await page.route(routePattern, async (route) => {
    if (route.request().method() === 'POST') {
      createPayload = route.request().postDataJSON() as Record<string, unknown>;
      await createHeld;
    }
    await route.continue();
  });
  const saveButton = dialog.locator('button[type="submit"]');
  const saveRequest = saveButton.click();
  await expect(saveButton).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  releaseCreate();
  await saveRequest;
  await page.unroute(routePattern);

  expect(createPayload).not.toBeNull();
  expect(createPayload?.workExperience).toMatchObject([
    {
      sequenceNo: 1,
      positionTitle: 'Administrative Officer IV',
      departmentAgencyOfficeCompany: 'Human Resource Management Division',
      governmentService: 'Y',
      isCurrent: true,
    },
    {
      sequenceNo: 2,
      positionTitle: 'Administrative Assistant II',
      departmentAgencyOfficeCompany: 'Records Management Unit',
      governmentService: 'Y',
      isCurrent: false,
    },
  ]);
  expect(createPayload?.voluntaryWork).toMatchObject([
    {
      sequenceNo: 1,
      organizationNameAddress: 'Barangay San Isidro, Quezon City',
      hours: 24,
      positionNatureOfWork: 'Community organizer',
    },
  ]);
  expect(createPayload?.learningAndDevelopment).toMatchObject([
    {
      sequenceNo: 1,
      interventionTitle: 'Records management workshop',
      hours: 16,
      type: 'Technical',
      conductedSponsoredBy: 'Civil Service Commission',
    },
  ]);
  expect(createPayload?.wes).toMatchObject([
    {
      contextKey: 'vacancy-1',
      entries: [
        {
          sequenceNo: 1,
          workExperienceSequenceNo: 1,
          position: 'Administrative Officer IV',
          officeUnit: 'Human Resource Management Division',
          immediateSupervisor: 'Alicia Ramos',
          agencyOrganizationLocation: 'Lingkod HR, Quezon City',
          actualDuties: 'Led personnel records maintenance and supervised administrative services.',
        },
      ],
    },
  ]);

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText('PDS Draft created.');
  await expect(page.getByText('Mara Santos Jr.', { exact: true })).toBeVisible();
  await expect(page.getByText('University of the Philippines', { exact: true })).toBeVisible();
  await expect(page.getByText('Career Service Professional', { exact: true })).toBeVisible();
  await expect(page.getByText('Married', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit Draft PDS' }).click();
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

  await page.getByRole('button', { name: 'Edit Draft PDS' }).click();
  await expect(dialog.getByLabel('Position title').nth(0)).toHaveValue('Administrative Officer IV');
  await expect(dialog.getByLabel('Position title').nth(1)).toHaveValue(
    'Administrative Assistant II',
  );
  await expect(dialog.getByLabel('Parent work-experience row')).toHaveValue(/.+/);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});
