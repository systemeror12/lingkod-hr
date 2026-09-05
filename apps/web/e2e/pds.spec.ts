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

async function fillEvidencePair(
  dialog: Locator,
  prefix: string,
  evidence: { documentId: string; versionId: string },
): Promise<void> {
  await dialog.getByLabel(`${prefix} document ID`, { exact: true }).fill(evidence.documentId);
  await dialog
    .getByLabel(`${prefix} document version ID`, { exact: true })
    .fill(evidence.versionId);
}

function withoutEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutEvidence);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      /Document(?:Version)?Id$/.test(key) ? null : withoutEvidence(child),
    ]),
  );
}

test('completes the Revised 2026 PDS certification and correction journey', async ({ page }) => {
  test.setTimeout(90_000);
  const stamp = Date.now();
  const employeeNumber = `E2E-PDS-${stamp}`;
  const legalName = `E2E PDS Employee ${stamp}`;
  const dialog = page.getByRole('dialog');
  let createPayload: Record<string, unknown> | null = null;

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible({ timeout: 15000 });

  const headers = { origin: new URL(page.url()).origin };
  const sessionResponse = await page.request.get('/api/v1/auth/me', { headers });
  const sessionBody = await sessionResponse.text();
  expect(sessionResponse.ok(), sessionBody).toBe(true);
  const session = JSON.parse(sessionBody) as { agencyId: string; membershipId: string };
  const employeesResponse = await page.request.get(
    `/api/v1/agencies/${session.agencyId}/employees`,
    { headers },
  );
  const employeesBody = await employeesResponse.text();
  expect(employeesResponse.ok(), employeesBody).toBe(true);
  const linkedEmployee = (
    JSON.parse(employeesBody) as { employees: { id: string; membershipId: string | null }[] }
  ).employees.find((employee) => employee.membershipId === session.membershipId);
  if (linkedEmployee) {
    const unlinkResponse = await page.request.delete(
      `/api/v1/agencies/${session.agencyId}/employees/${linkedEmployee.id}/membership-link`,
      { headers },
    );
    expect(unlinkResponse.ok(), await unlinkResponse.text()).toBe(true);
  }

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

  await page.getByLabel('Agency Membership').selectOption(session.membershipId);
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
  await dialog.getByLabel('UMID ID no.').fill('N/A');
  await dialog.getByLabel('Pag-IBIG ID no.').fill('N/A');
  await dialog.getByLabel('PhilHealth no.').fill('N/A');
  await dialog.getByLabel('PhilSys PCN').fill('N/A');
  await dialog.getByLabel('TIN', { exact: true }).fill('N/A');
  await dialog.getByLabel('Agency employee no.').fill(employeeNumber);
  for (const label of [
    'House / block / lot no.',
    'Street',
    'Subdivision / village',
    'Barangay',
    'City / municipality',
    'Province',
    'ZIP code',
  ]) {
    await dialog.getByLabel(label).nth(0).fill('N/A');
    await dialog.getByLabel(label).nth(1).fill('N/A');
    await dialog.getByLabel(label).nth(2).fill('N/A');
  }
  await dialog.getByLabel('Telephone', { exact: true }).nth(0).fill('N/A');
  await dialog.getByLabel('Mobile').fill('09171234567');
  await dialog.getByLabel('Email address').fill('mara.santos@example.test');
  await dialog.getByLabel('Surname').nth(1).fill('Santos');
  await dialog.getByLabel('First name').nth(1).fill('Jose');
  await dialog.getByLabel('Surname').nth(2).fill('Santos');
  await dialog.getByLabel('First name').nth(2).fill('Pedro');
  await dialog.getByLabel('Surname').nth(3).fill('Reyes');
  await dialog.getByLabel('First name').nth(3).fill('Ana');
  await dialog.getByLabel('Middle name').nth(1).fill('N/A');
  await dialog.getByLabel('Middle name').nth(2).fill('N/A');
  await dialog.getByLabel('Middle name').nth(3).fill('N/A');
  await dialog.getByLabel('Occupation').fill('N/A');
  await dialog.getByLabel('Employer / business name').fill('N/A');
  await dialog.getByLabel('Telephone', { exact: true }).nth(1).fill('N/A');
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
  await dialog.getByLabel('Date of examination / conferment').fill('2020-01-15');
  await dialog.getByLabel('Place of examination / conferment').fill('Manila');
  await dialog.getByRole('button', { name: 'Add work experience' }).click();
  await dialog.getByRole('button', { name: 'Add work experience' }).click();
  await dialog.getByLabel('Position title').nth(0).fill('Administrative Assistant II');
  await dialog
    .getByLabel('Department / agency / office / company')
    .nth(0)
    .fill('Records Management Unit');
  await dialog.getByLabel('Inclusive from').nth(0).fill('2020-06-01');
  await dialog.getByLabel('Inclusive to').nth(0).fill('2023-12-31');
  await dialog.getByLabel('Monthly salary').nth(0).fill('20000');
  await dialog.getByLabel('Salary / job / pay grade and step').nth(0).fill('8-1');
  await dialog.getByLabel('Status of appointment').nth(0).fill('Permanent');
  await dialog.getByLabel('Government service').nth(0).selectOption('Y');
  await dialog.getByLabel('Position title').nth(1).fill('Administrative Officer IV');
  await dialog
    .getByLabel('Department / agency / office / company')
    .nth(1)
    .fill('Human Resource Management Division');
  await dialog.getByLabel('Inclusive from').nth(1).fill('2024-01-01');
  await dialog.getByLabel('Monthly salary').nth(1).fill('45000');
  await dialog.getByLabel('Salary / job / pay grade and step').nth(1).fill('15-1');
  await dialog.getByLabel('Status of appointment').nth(1).fill('Permanent');
  await dialog.getByRole('group', { name: 'Work experience 2' }).getByLabel('Current work').check();
  await dialog.getByLabel('Government service').nth(1).selectOption('Y');
  await dialog.getByRole('button', { name: 'Move work experience 2 up' }).click();
  await expect(dialog.getByLabel('Position title').nth(0)).toHaveValue('Administrative Officer IV');
  await dialog.getByRole('button', { name: 'Add voluntary work' }).click();
  const voluntaryGroup = dialog.getByRole('group', { name: 'Voluntary work 1' });
  await voluntaryGroup
    .getByLabel('Organization name and address')
    .fill('Barangay San Isidro, Quezon City');
  await voluntaryGroup.getByLabel('Position / nature of work').fill('Community organizer');
  await voluntaryGroup.getByLabel('Inclusive from').fill('2019-01-01');
  await voluntaryGroup.getByLabel('Inclusive to').fill('2019-12-31');
  await voluntaryGroup.getByLabel('Number of hours').fill('24');
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
  await dialog.getByLabel('WES signature document ID').fill('wes-signature-document');
  await dialog.getByLabel('WES signature document version ID').fill('wes-signature-version');
  await dialog.getByLabel('WES signed date').fill('2026-02-03');
  await dialog.getByLabel('Special skills and hobbies').fill('Policy writing; records indexing');
  await dialog.getByLabel('Non-academic distinctions').fill('N/A');
  await dialog.getByLabel('Membership in associations').fill('PHRMO Association');
  await dialog.getByLabel('34.a Related within the third degree?').selectOption('YES');
  await dialog
    .getByLabel('34.a Related within the third degree? details')
    .fill('Spouse works outside the agency.');
  await dialog.getByRole('button', { name: 'Add reference' }).click();
  await dialog.getByLabel('Reference name').fill('Alicia Ramos');
  await dialog.getByLabel('Reference address').fill('Quezon City');
  await dialog.getByLabel('Reference telephone').fill('02-8123-4567');
  await dialog.getByLabel('Government ID type').fill('Passport');
  await dialog.getByLabel('Government ID number').fill('P1234567');
  await dialog.getByLabel('Government ID issued date').fill('2025-01-02');
  await dialog.getByLabel('Government ID issued place').fill('DFA Manila');
  await dialog.getByLabel('Photo document ID').fill('photo-document');
  await dialog.getByLabel('Photo document version ID').fill('photo-version');
  await dialog.getByLabel('Signature document ID', { exact: true }).fill('signature-document');
  await dialog
    .getByLabel('Signature document version ID', { exact: true })
    .fill('signature-version');
  await dialog.getByLabel('Employee signature date').fill('2026-02-04');
  await dialog.getByLabel('Thumbmark document ID').fill('thumbmark-document');
  await dialog.getByLabel('Thumbmark document version ID').fill('thumbmark-version');
  await dialog
    .getByLabel('Oath administrator signature document ID')
    .fill('oath-signature-document');
  await dialog
    .getByLabel('Oath administrator signature document version ID')
    .fill('oath-signature-version');
  await dialog.getByLabel('Subscribed and sworn date').fill('2026-02-04');
  await dialog.getByLabel('Oath administration date').fill('2026-02-04');
  await dialog.getByLabel('Administering officer').fill('Maria Clerk');
  await dialog.getByLabel('Subscribed and sworn text').fill('Subscribed and sworn in Quezon City.');
  await dialog.getByLabel('Page 1 signature document ID').fill('page-1-signature-document');
  await dialog.getByLabel('Page 1 signature document version ID').fill('page-1-signature-version');
  await dialog.getByLabel('Page 1 signed date').fill('2026-02-04');
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
    const postData =
      route.request().method() === 'POST' || route.request().method() === 'PATCH'
        ? JSON.stringify(withoutEvidence(route.request().postDataJSON()))
        : undefined;
    await route.continue(postData === undefined ? {} : { postData });
  });
  const saveButton = dialog.locator('button[type="submit"]');
  const createResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/pds'),
  );
  const saveRequest = saveButton.click();
  await expect(saveButton).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  releaseCreate();
  await saveRequest;
  const createResponse = await createResponsePromise;
  const createResponseBody = await createResponse.text();
  expect(createResponse.ok(), createResponseBody).toBe(true);
  const createdVersion = JSON.parse(createResponseBody) as { id: string };
  const agencyId = /\/agencies\/([^/]+)\//.exec(createResponse.url())?.[1];
  expect(agencyId).toBeTruthy();
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
      signatureDocumentId: 'wes-signature-document',
      signatureDocumentVersionId: 'wes-signature-version',
      signedAt: '2026-02-03',
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
  expect(createPayload?.otherInformation).toMatchObject({
    skillsAndHobbies: 'Policy writing; records indexing',
    nonAcademicDistinctions: 'N/A',
    associationMemberships: 'PHRMO Association',
  });
  expect(createPayload?.declarations).toMatchObject({
    relatedWithinThirdDegree: true,
    relationshipDetails: 'Spouse works outside the agency.',
  });
  expect(createPayload?.references).toMatchObject([
    { sequenceNo: 1, name: 'Alicia Ramos', address: 'Quezon City' },
  ]);
  expect(createPayload?.certification).toMatchObject({
    governmentIdType: 'Passport',
    governmentIdNumber: 'P1234567',
    photoDocumentId: 'photo-document',
    employeeSignatureDocumentId: 'signature-document',
    employeeSignatureDocumentVersionId: 'signature-version',
    thumbmarkDocumentId: 'thumbmark-document',
  });
  expect(createPayload?.pageSignatures).toMatchObject([
    {
      pageKey: 'C1',
      signatureDocumentId: 'page-1-signature-document',
      signatureDocumentVersionId: 'page-1-signature-version',
      signedAt: '2026-02-04T00:00:00.000+08:00',
      signatureDate: '2026-02-04',
    },
    { pageKey: 'C2', signatureDocumentId: null, signatureDocumentVersionId: null, signedAt: null },
    { pageKey: 'C3', signatureDocumentId: null, signatureDocumentVersionId: null, signedAt: null },
    { pageKey: 'C4', signatureDocumentId: null, signatureDocumentVersionId: null, signedAt: null },
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
  await dialog.getByRole('button', { name: 'Save Draft' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText('PDS Draft saved.');
  await expect(page.getByText('Manila', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('University of the Philippines', { exact: true })).toBeVisible();
  await expect(page.getByText('Career Service Professional', { exact: true })).toBeVisible();

  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Employee certify', exact: true })).toHaveCount(0);

  await page.goto('/pds');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Submit PDS' })
    .getByRole('button', { name: 'Submit', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Edit Draft PDS' })).toBeVisible();
  await expect(page.getByLabel('Height (metres)')).toBeFocused();

  const editDialog = page.getByRole('dialog', { name: 'Edit Draft PDS' });
  await editDialog.getByLabel('Height (metres)').fill('1.62');
  await editDialog.getByLabel('Weight (kilograms)').fill('58');
  await editDialog.getByLabel('Blood type').fill('O+');
  for (const level of ['ELEMENTARY', 'SECONDARY', 'VOCATIONAL_TRADE', 'GRADUATE_STUDIES']) {
    await editDialog.getByRole('button', { name: 'Add education row' }).click();
    const index = (await editDialog.getByLabel('Education level').count()) - 1;
    await editDialog.getByLabel('Education level').nth(index).selectOption(level);
    await editDialog.getByLabel('Name of school').nth(index).fill('N/A');
    await editDialog.getByLabel('Basic education / degree / course').nth(index).fill('N/A');
    await editDialog.getByLabel('Period of attendance').nth(index).fill('N/A');
    await editDialog.getByLabel('Highest level / units earned').nth(index).fill('N/A');
    await editDialog.getByLabel('Scholarship / academic honors').nth(index).fill('N/A');
  }
  await editDialog.getByRole('button', { name: 'Add reference' }).click();
  await editDialog.getByRole('button', { name: 'Add reference' }).click();
  for (const index of [1, 2]) {
    await editDialog.getByLabel('Reference name').nth(index).fill('N/A');
    await editDialog.getByLabel('Reference address').nth(index).fill('N/A');
    await editDialog.getByLabel('Reference telephone').nth(index).fill('N/A');
  }
  await expect(
    editDialog.getByText(
      'I declare under oath that I have personally accomplished this Personal Data Sheet which is a true, correct, and complete statement pursuant to the provisions of pertinent laws, rules, and regulations of the Republic of the Philippines.',
    ),
  ).toBeVisible();
  await editDialog.getByLabel('Truth declaration accepted').check();
  await editDialog.getByLabel('Verification authorization accepted').check();
  await editDialog.getByLabel('Misrepresentation warning accepted').check();

  const evidence = await page.evaluate(async (activeAgencyId) => {
    const response = await fetch(`/api/v1/agencies/${activeAgencyId}/documents/versions`);
    const value = (await response.json()) as {
      documents: Array<{ documentId: string; version: { id: string } }>;
    };
    const first = value.documents[0];
    if (!response.ok || !first) throw new Error('No finalized evidence was available.');
    return { documentId: first.documentId, versionId: first.version.id };
  }, agencyId as string);
  await fillEvidencePair(editDialog, 'WES signature', evidence);
  await fillEvidencePair(editDialog, 'Photo', evidence);
  await fillEvidencePair(editDialog, 'Signature', evidence);
  await fillEvidencePair(editDialog, 'Oath administrator signature', evidence);
  for (const pageNo of [1, 2, 3, 4]) {
    await fillEvidencePair(editDialog, `Page ${pageNo} signature`, evidence);
    await editDialog.getByLabel(`Page ${pageNo} signed date`).fill('2026-02-04');
  }
  await editDialog.getByRole('button', { name: 'Save Draft' }).click();
  await expect(editDialog).toBeHidden();

  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Submit PDS' })
    .getByRole('button', { name: 'Submit', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('PDS submitted.');

  await page.getByRole('button', { name: 'Return with reason', exact: true }).click();
  const returnDialog = page.getByRole('dialog', { name: 'Return PDS' });
  await returnDialog.getByLabel('Return reason').fill('Confirm the employee declaration.');
  await returnDialog.getByRole('button', { name: 'Return with reason' }).click();
  await expect(page.getByRole('status')).toContainText('PDS returned.');

  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Submit PDS' })
    .getByRole('button', { name: 'Submit', exact: true })
    .click();
  await page.getByRole('button', { name: 'Employee certify', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Employee certify PDS' })
    .getByRole('button', { name: 'Employee certify' })
    .click();
  await expect(page.getByRole('status')).toContainText('employee certification recorded');
  await page.getByRole('button', { name: 'HR verify', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'HR verify PDS' })
    .getByRole('button', { name: 'HR verify' })
    .click();
  await expect(page.getByRole('status')).toContainText('HR verification recorded');

  const renderResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/render'),
  );
  await page.getByRole('button', { name: 'Generate output', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Generate output' })
    .getByRole('button', { name: 'Generate output' })
    .click();
  const renderResponse = await renderResponsePromise;
  const released = (await renderResponse.json()) as {
    outputs: Array<{
      outputKey: string;
      outputType: 'PDS' | 'WES';
      sourceArtifactHash: string;
      renderingMetadata: Record<string, unknown>;
      renderedContent: Record<string, unknown> | null;
    }>;
  };
  expect(renderResponse.ok()).toBe(true);
  expect(released.outputs).toHaveLength(2);
  expect(released.outputs.every((output) => output.sourceArtifactHash.length === 64)).toBe(true);
  const pdsRenderingMetadata = released.outputs.find(
    (output) => output.outputType === 'PDS',
  )?.renderingMetadata;
  expect(pdsRenderingMetadata).toMatchObject({
    revision: 'CS_FORM_212_REVISED_2026',
    layoutContract: {
      guideReference: 'Guide to Filling Out the Personal Data Sheet (PDS), Revised 2026',
      photo: { widthCm: 3.5, heightCm: 4.5, transformations: 'NONE' },
      signaturePlacement: { position: 'BOTTOM_OF_EVERY_PAGE' },
    },
  });
  const pdsPages = (
    pdsRenderingMetadata?.layoutContract as {
      pages: Array<{ pageKey: string; sections: Array<{ section: string }> }>;
    }
  ).pages;
  expect(pdsPages.map((page) => page.pageKey)).toEqual(['C1', 'C2', 'C3', 'C4']);
  expect(pdsPages[0]?.sections[0]?.section).toBe('I. PERSONAL INFORMATION');
  expect(
    released.outputs.find((output) => output.outputType === 'PDS')?.renderedContent,
  ).toMatchObject({
    certificationStatements: {
      truthDeclaration:
        'I declare under oath that I have personally accomplished this Personal Data Sheet which is a true, correct, and complete statement pursuant to the provisions of pertinent laws, rules, and regulations of the Republic of the Philippines.',
      verificationAuthorization:
        'I authorize the agency head/authorized representative to verify/validate the contents stated herein.',
      misrepresentationWarning:
        'I agree that any misrepresentation made in this document and its attachments shall cause the filing of administrative/criminal case/s against me.',
    },
  });
  expect(
    released.outputs.find((output) => output.outputType === 'WES')?.renderingMetadata,
  ).toMatchObject({
    layoutContract: {
      title: 'WORK EXPERIENCE SHEET',
      signature: {
        label: 'Signature over Printed Name of Employee/Applicant',
        dateLabel: 'Date',
      },
    },
  });

  await page.getByRole('button', { name: 'Correct certified', exact: true }).click();
  const correctionDialog = page.getByRole('dialog', { name: 'Correct certified PDS' });
  await correctionDialog.getByLabel('Correction reason').fill('Update after employee review.');
  await correctionDialog.getByRole('button', { name: 'Correct certified' }).click();
  await expect(page.getByRole('status')).toContainText('Correction Draft created.');

  const historical = await page.evaluate(
    async ({ activeAgencyId, versionId }) => {
      const response = await fetch(`/api/v1/agencies/${activeAgencyId}/pds/${versionId}/outputs`);
      if (!response.ok) throw new Error('Historical output could not be loaded.');
      return (await response.json()) as {
        outputs: Array<{
          outputKey: string;
          outputType: 'PDS' | 'WES';
          sourceArtifactHash: string;
          renderingMetadata: Record<string, unknown>;
          renderedContent: Record<string, unknown> | null;
        }>;
      };
    },
    { activeAgencyId: agencyId as string, versionId: createdVersion.id },
  );
  expect(historical.outputs).toEqual(released.outputs);
  const history = page.getByRole('region', { name: 'Versions' });
  await expect(history.getByText('v2', { exact: true })).toBeVisible();
  await expect(history.getByText('v1', { exact: true })).toBeVisible();
});
