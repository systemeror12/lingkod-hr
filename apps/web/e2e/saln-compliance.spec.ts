import { expect, test } from '@playwright/test';

test('records and corrects SALN filing metadata without a content or due-date surface', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const stamp = Date.now();
  const legalName = `SALN E2E Employee ${stamp}`;
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible({ timeout: 15000 });
  await page.goto('/employees/new');
  await page.getByLabel('Employee number').fill(`SALN-E2E-${stamp}`);
  await page.getByLabel('Legal name').fill(legalName);
  await page.getByLabel('Birth date').fill('1990-01-01');
  await page.getByLabel('Sex').selectOption('FEMALE');
  await page.getByLabel('Civil status').selectOption('SINGLE');
  await page.getByLabel('Contact email').fill(`saln-e2e-${stamp}@example.test`);
  await page.getByRole('button', { name: 'Create employee' }).click();
  await expect(page.getByRole('heading', { name: legalName })).toBeVisible();

  await page.getByRole('tab', { name: 'SALN compliance' }).click();
  await page.getByRole('button', { name: 'Record filing' }).click();
  const create = page.getByRole('region', { name: 'Record SALN filing metadata' });
  await expect(create).toHaveAccessibleDescription(
    'This surface stores compliance metadata only. Do not enter declaration contents.',
  );
  await expect(create.getByLabel('Authorized requirement reference')).toBeFocused();
  await expect(create.getByLabel(/due date/i)).toHaveCount(0);
  await expect(create.getByLabel(/assets|liabilities|declaration contents/i)).toHaveCount(0);
  await create.getByLabel('Authorized requirement reference').fill('Agency memorandum 2026-04');
  await create.getByLabel('Filing year').fill('2026');
  await create.getByLabel('Filing type').fill('ANNUAL');
  await create.getByLabel('Filing status').selectOption('SUBMITTED');
  await create.getByLabel('Submission date').fill('2026-04-30');
  await create.getByLabel('Repository reference').fill(`Records/2026/${stamp}`);
  await page.route(
    '**/api/v1/agencies/*/employees/*/saln-compliance',
    (route) => route.abort('failed'),
    { times: 1 },
  );
  await create.getByRole('button', { name: 'Record filing' }).click();
  await expect(create.getByRole('alert')).toContainText('Check the connection');
  await expect(create.getByLabel('Filing year')).toHaveValue('2026');
  await expect(create.getByRole('button', { name: 'Record filing' })).toBeEnabled();
  await create.getByRole('button', { name: 'Record filing' }).click();
  await expect(create).toBeHidden();
  await expect(page.getByText('2026 · ANNUAL')).toBeVisible();

  await page.getByRole('button', { name: 'Details' }).click();
  const detail = page.getByRole('region', { name: 'SALN filing details' });
  await expect(detail).toContainText('Agency memorandum 2026-04');
  await expect(detail).toContainText(`Records/2026/${stamp}`);
  await detail.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'Update' }).click();
  const update = page.getByRole('region', { name: 'Update SALN filing metadata' });
  await update.getByLabel('Filing type').fill('ANNUAL UPDATED');
  await update.getByRole('button', { name: 'Save update' }).click();
  await expect(update).toBeHidden();
  await expect(page.getByText('2026 · ANNUAL UPDATED')).toBeVisible();

  await page.getByRole('button', { name: 'Correct' }).click();
  const correction = page.getByRole('region', { name: 'Correct SALN filing metadata' });
  await correction.getByLabel('Filing type').fill('ANNUAL CORRECTED');
  await correction
    .getByLabel('Correction reason')
    .fill('Correct the externally supplied filing type.');
  await correction.getByRole('button', { name: 'Record correction' }).click();
  await expect(correction).toBeHidden();
  await expect(page.getByText('2026 · ANNUAL CORRECTED')).toBeVisible();
  await expect(page.getByText('2026 · ANNUAL', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'History' }).click();
  const history = page.getByRole('region', { name: 'SALN compliance history' });
  await expect(history.getByText('2026 · ANNUAL', { exact: true })).toBeVisible();
  await expect(history.getByText('2026 · ANNUAL UPDATED', { exact: true })).toBeVisible();
  await expect(history.getByText('2026 · ANNUAL CORRECTED', { exact: true })).toBeVisible();

  // The history stays open in the hidden SALN tab without trapping focus on the visible one.
  const detailsTab = page.getByRole('tab', { name: 'Details' });
  await detailsTab.click();
  await expect(history).toBeHidden();
  await detailsTab.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tabpanel', { name: 'Details' })).toBeFocused();
});
