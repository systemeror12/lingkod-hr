import { expect, test, type Locator } from '@playwright/test';

async function expectCenteredDialog(dialog: Locator, viewportWidth: number): Promise<void> {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('The Service Record dialog geometry was unavailable.');
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth - 16);
  expect(Math.abs(box.x + box.width / 2 - viewportWidth / 2)).toBeLessThanOrEqual(1);
}

test('uses shared modals for generation, preview, replacement, and history', async ({ page }) => {
  const employeeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const snapshotId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const replacementId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const record = {
    id: snapshotId,
    asOfDate: '2026-09-05',
    renderingContractVersion: 'service-record-printable-v1',
    employee: { id: employeeId, employeeNumber: '2026-001', legalName: 'Maria Santos' },
    generatedBy: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', displayName: 'Marisol Santos' },
    generatedAt: '2026-09-05T07:00:00.000Z',
    supersedesSnapshotId: null,
    replacementSnapshotId: null,
    correctionReason: null,
    snapshot: {
      label: 'Printable System View',
      disclaimer:
        'This is a Printable System View of HRIS history. It is not an Exact Versioned Form, certification, Agency approval, or external filing.',
      asOfDate: '2026-09-05',
      employee: { id: employeeId, employeeNumber: '2026-001', legalName: 'Maria Santos' },
      serviceSegments: [
        {
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          appointmentStatus: 'PERMANENT',
          position: { itemNumber: 'HRM-001', title: 'HR Officer' },
          organizationUnit: { code: 'HRM', name: 'Human Resource Management Division' },
          salaryGrade: 18,
          salaryStep: 2,
          effectiveFrom: '2020-01-01',
          effectiveTo: null,
        },
      ],
      personnelActions: [],
    },
  };

  await page.route('**/api/v1/agencies/*/employees', (route) =>
    route.fulfill({
      json: {
        employees: [
          {
            id: employeeId,
            employeeNumber: '2026-001',
            legalName: 'Maria Santos',
            serviceStatus: 'ACTIVE',
          },
        ],
      },
    }),
  );
  await page.route('**/api/v1/agencies/*/documents', (route) =>
    route.fulfill({
      json: {
        documents: [
          {
            id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            documentNo: 'CORR-2026-01',
            documentType: 'SERVICE_RECORD_SUPPORT',
            status: 'APPROVED',
            currentVersion: { id: '11111111-1111-4111-8111-111111111111', versionNo: 1 },
          },
        ],
      },
    }),
  );
  await page.route('**/api/v1/agencies/*/service-records', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ json: record });
    else await route.continue();
  });
  await page.route(`**/service-records/${snapshotId}`, (route) => route.fulfill({ json: record }));
  await page.route(`**/service-records/${replacementId}`, (route) =>
    route.fulfill({
      json: {
        ...record,
        id: replacementId,
        supersedesSnapshotId: snapshotId,
        correctionReason: 'Corrected from retained evidence.',
        generatedAt: '2026-09-05T08:00:00.000Z',
      },
    }),
  );
  await page.route(`**/service-records/${snapshotId}/replace`, (route) =>
    route.fulfill({
      json: {
        ...record,
        id: replacementId,
        supersedesSnapshotId: snapshotId,
        correctionReason: 'Corrected from retained evidence.',
        generatedAt: '2026-09-05T08:00:00.000Z',
      },
    }),
  );

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/service-records');
  await expect(page.getByRole('heading', { name: 'Service Records', exact: true })).toBeVisible();

  const trigger = page.getByRole('button', { name: 'Generate record' });
  await trigger.click();
  const generate = page.getByRole('dialog', { name: 'Generate Service Record' });
  await expect(generate).toHaveAccessibleDescription(
    'Select an Employee and explicit as-of date. Service facts come from authoritative history.',
  );
  await expect(generate.getByLabel('Employee')).toBeFocused();
  await expectCenteredDialog(generate, 1280);
  await page.mouse.click(1, 1);
  await expect(generate).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(generate).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await generate.getByLabel('Employee').selectOption(employeeId);
  await generate.getByRole('button', { name: 'Generate record' }).click();
  const preview = page.getByRole('region', { name: 'Printable System View' });
  await expect(preview).toContainText('HR Officer');
  await expect(preview).toContainText('not an Exact Versioned Form');
  await preview.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'Replace' }).click();
  const replacement = page.getByRole('dialog', { name: 'Confirm Service Record replacement' });
  await expect(replacement.getByLabel('Reason')).toBeFocused();
  await replacement.getByLabel('Reason').fill('Corrected from retained evidence.');
  await replacement
    .getByLabel('Correction evidence')
    .selectOption('ffffffff-ffff-4fff-8fff-ffffffffffff');
  await replacement.getByRole('button', { name: 'Create replacement' }).click();
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'History' }).first().click();
  const history = page.getByRole('region', { name: 'Service Record history' });
  await expect(history).toContainText('Replacement');
  await expect(history).toContainText('Superseded');
  await page.setViewportSize({ width: 390, height: 844 });
  const historyBox = await history.boundingBox();
  expect(historyBox).not.toBeNull();
  expect(historyBox!.x + historyBox!.width).toBeLessThanOrEqual(390);
});
