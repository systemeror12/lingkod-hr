import { expect, test } from '@playwright/test';

test('creates an Employee and links an Agency Membership', async ({ page }) => {
  const stamp = Date.now();
  const employeeNumber = `E2E-EMP-${stamp}`;
  const legalName = `E2E Employee ${stamp}`;

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible({ timeout: 15000 });
  await page.goto('/employees');
  await expect(
    page.getByRole('heading', { name: 'Employee directory', exact: true }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Create employee' }).click();
  await expect(page.getByRole('heading', { name: 'Create preboarding employee' })).toBeVisible();
  await page.getByLabel('Employee number').fill(employeeNumber);
  await page.getByLabel('Legal name').fill(legalName);
  await page.getByLabel('Birth date').fill('1995-06-15');
  await page.getByLabel('Sex').selectOption('FEMALE');
  await page.getByLabel('Civil status').selectOption('SINGLE');
  await page.getByLabel('Contact email').fill(`e2e.${stamp}@example.test`);
  await page.getByRole('button', { name: 'Create employee' }).click();

  await expect(page.getByRole('heading', { name: legalName })).toBeVisible();
  await expect(page.getByText(employeeNumber, { exact: true })).toBeVisible();
  await expect(page.getByText('UNLINKED', { exact: true })).toBeVisible();

  await page.getByLabel('Agency Membership').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Link membership' }).click();
  await expect(page.getByRole('status')).toContainText('Agency Membership linked');
  await expect(page.getByText('LINKED', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Employee directory' }).click();
  await expect(
    page.getByRole('heading', { name: 'Employee directory', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(employeeNumber, { exact: true })).toBeVisible();
  await expect(page.getByText('LINKED', { exact: true })).toBeVisible();
});
