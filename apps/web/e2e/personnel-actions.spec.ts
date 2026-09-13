import { expect, test, type APIResponse, type Locator } from '@playwright/test';

async function apiBody<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
  return JSON.parse(text) as T;
}

async function expectCenteredDialog(dialog: Locator, viewportWidth: number): Promise<void> {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('The Personnel Action dialog geometry was unavailable.');
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth - 16);
}

test('opens Personnel Action preparation with the shared modal contract', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/personnel-actions');
  await expect(page.getByRole('heading', { name: 'Personnel actions', exact: true })).toBeVisible();

  const trigger = page.getByRole('button', { name: 'Prepare action' });
  await trigger.click();
  const dialog = page.getByRole('region', { name: 'Prepare Personnel Action' });
  await expect(dialog).toHaveAccessibleDescription(
    'Record the Employee, proposed effectivity, exact evidence versions, and action-specific facts.',
  );
  await expect(dialog.getByLabel('Employee')).toBeFocused();
  await expectCenteredDialog(dialog, 1280);
  await page.mouse.click(1, 1);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectCenteredDialog(dialog, 390);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(trigger).toBeFocused();
});

test('confirms and shows an effective compensation action in shared modals', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/personnel-actions');
  await page.getByRole('button', { name: 'Open action for Alex Rivera' }).click();

  const detail = page.getByRole('region', { name: 'Alex Rivera' });
  await detail.getByRole('button', { name: 'Effectuate action' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Effectuate Personnel Action' });
  await expect(confirmation).toHaveAccessibleDescription(
    'Confirm the effective-dated compensation facts for exact version 1.',
  );
  await expect(confirmation.getByText('SG 24, Step 2')).toBeVisible();
  await confirmation.getByRole('button', { name: 'Confirm effectuation' }).click();

  await expect(detail.getByText('EFFECTIVE', { exact: true })).toBeVisible();
  await expect(detail.getByText('SG 24, Step 2')).toBeVisible();
  await detail.getByRole('button', { name: 'View history' }).click();
  const history = page.getByRole('region', { name: 'Personnel Action history' });
  await expect(history.getByText('PERSONNEL ACTION EFFECTUATED')).toBeVisible();
});

test('reviews, confirms, and reports service-status effectuation in shared modals', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await page.route('**/api/v1/agencies/*/personnel-actions/*/effectuate', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['idempotency-key']).toMatch(/^web-/);
    const response = await route.fetch({
      method: 'GET',
      url: route
        .request()
        .url()
        .replace(/\/effectuate$/, ''),
    });
    const action = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      contentType: 'application/json',
      json: { ...action, status: 'EFFECTIVE', effectuatedAt: new Date().toISOString() },
    });
  });

  await page.goto('/personnel-actions');
  await page.getByRole('button', { name: 'Open action for E2E Separation Candidate' }).click();
  const detail = page.getByRole('region', { name: 'E2E Separation Candidate' });
  await detail.getByRole('button', { name: 'Effectuate action' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Effectuate Personnel Action' });
  await expect(confirmation).toContainText('preserved service history');
  await confirmation.getByRole('button', { name: 'Confirm effectuation' }).click();
  await expect(detail.getByText('EFFECTIVE', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Close Personnel Action details' }).click();
  await expect(page.getByRole('status')).toHaveText('Personnel Action effectuated.');
});

test('prepares and reviews an Appointment-backed movement from its assumed contract', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  const origin = { origin: new URL(page.url()).origin };
  const session = await apiBody<{ agencyId: string }>(
    await page.request.get('/api/v1/auth/me', { headers: origin }),
  );
  const movementCandidates = await apiBody<{
    candidates: Array<{
      appointmentVersionId: string;
      applicationNo: string;
      actualAssumptionDate: string;
    }>;
  }>(
    await page.request.get(
      `/api/v1/agencies/${session.agencyId}/appointments/movement-candidates`,
      { headers: origin },
    ),
  );
  const candidate = movementCandidates.candidates.find(
    ({ applicationNo }) => applicationNo === 'E2E-MOVE-APP-1',
  );
  if (!candidate) throw new Error('The assumed movement Appointment fixture is missing.');

  await page.goto('/personnel-actions');
  await expect(page.getByRole('heading', { name: 'Personnel actions', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Prepare action' }).click();
  const prepare = page.getByRole('region', { name: 'Prepare Personnel Action' });

  const employeeSelect = prepare.getByLabel('Employee');
  const employeeOption = await employeeSelect
    .locator('option')
    .filter({ hasText: 'E2E-MOVE-001' })
    .getAttribute('value');
  if (!employeeOption) throw new Error('The E2E Movement Candidate option is missing.');
  await employeeSelect.selectOption(employeeOption);

  const actionTypeSelect = prepare.getByLabel('Canonical action type');
  for (const label of [
    'Promotion',
    'Transfer',
    'Demotion',
    'Reclassification',
    'Comparable reinstatement',
  ]) {
    await expect(actionTypeSelect.locator('option', { hasText: label })).toHaveCount(1);
  }
  await actionTypeSelect.selectOption('PROMOTION');

  const appointmentSelect = prepare.getByLabel('Assumed Appointment');
  await expect(appointmentSelect.locator('option', { hasText: 'E2E-MOVE-APP-1' })).toHaveCount(1);
  await appointmentSelect.selectOption(candidate.appointmentVersionId);
  await expect(prepare.getByLabel('Proposed effectivity')).toHaveValue(
    candidate.actualAssumptionDate,
  );

  await prepare
    .getByLabel('Preparation reason')
    .fill('Effectuate the assumed Appointment-backed promotion from the web surfaces.');
  await prepare.getByLabel('External Evidence Document').selectOption({ index: 1 });
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/personnel-actions') && response.request().method() === 'POST',
  );
  await prepare.getByRole('button', { name: 'Save draft' }).click();
  const created = await apiBody<{ status: string }>(await createdResponse);
  expect(created.status).toBe('DRAFT');

  const detail = page.getByRole('region', { name: 'E2E Movement Candidate' });
  await expect(detail.getByText('DRAFT', { exact: true })).toBeVisible();
  await expect(detail.getByText('Assumed Appointment', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Submit for review' }).click();
  await expect(detail.getByText('FOR REVIEW', { exact: true })).toBeVisible();

  await detail.getByRole('button', { name: 'Endorse', exact: true }).click();
  const endorsement = page.getByRole('dialog', { name: 'Endorse Personnel Action' });
  await expect(endorsement).toHaveAccessibleDescription(
    'Record the accountable reason against exact version 1.',
  );
  await endorsement
    .getByLabel('Reason')
    .fill('The assumed Appointment and reserved item were reviewed.');
  await endorsement.getByRole('button', { name: 'Record decision' }).click();
  await expect(detail.getByText('FOR APPROVAL', { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Approve', exact: true })).toBeHidden();
});

test('approves, effectuates, and shows the history of an appointment-backed promotion', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  const origin = { origin: new URL(page.url()).origin };
  const session = await apiBody<{ agencyId: string }>(
    await page.request.get('/api/v1/auth/me', { headers: origin }),
  );
  const register = await apiBody<{
    actions: Array<{ id: string; status: string; preparedBy: { displayName: string } }>;
  }>(
    await page.request.get(`/api/v1/agencies/${session.agencyId}/personnel-actions`, {
      headers: origin,
    }),
  );
  const reviewed = register.actions.find(
    ({ status, preparedBy }) =>
      status === 'FOR_APPROVAL' && preparedBy.displayName === 'Personnel Preparer',
  );
  if (!reviewed) throw new Error('The reviewed movement fixture is missing.');

  await page.goto(`/personnel-actions?record=${reviewed.id}&view=form`);
  const detail = page.getByRole('region', { name: 'E2E Movement Candidate' });
  await expect(detail.getByText('Assumed Appointment', { exact: true })).toBeVisible();

  await detail.getByRole('button', { name: 'Approve', exact: true }).click();
  const approval = page.getByRole('dialog', { name: 'Approve Personnel Action' });
  await expect(approval).toHaveAccessibleDescription(
    'Record the accountable reason against exact version 1.',
  );
  await approval.getByLabel('Reason').fill('Approved within the appointing authority.');
  await approval.getByRole('button', { name: 'Record decision' }).click();
  await expect(detail.getByText('APPROVED', { exact: true })).toBeVisible();

  await detail.getByRole('button', { name: 'Effectuate action' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Effectuate Personnel Action' });
  await expect(confirmation).toHaveAccessibleDescription(
    "Consume exact version 1's assumed Appointment to move the Employee into the reserved Plantilla item.",
  );
  await expect(confirmation).toContainText('closes the source Service Segment');
  await confirmation.getByRole('button', { name: 'Confirm effectuation' }).click();

  await expect(detail.getByText('EFFECTIVE', { exact: true })).toBeVisible();
  await expect(detail.getByText('Target Plantilla Position')).toBeVisible();
  await detail.getByRole('button', { name: 'View history' }).click();
  const history = page.getByRole('region', { name: 'Personnel Action history' });
  await expect(history.getByText('PERSONNEL ACTION SUBMITTED')).toBeVisible();
  await expect(history.getByText('PERSONNEL ACTION ENDORSED')).toBeVisible();
  await expect(history.getByText('PERSONNEL ACTION APPROVED')).toBeVisible();
  await expect(history.getByText('PERSONNEL ACTION EFFECTUATED')).toBeVisible();
});
