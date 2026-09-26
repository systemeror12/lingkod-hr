import { expect, test, type Locator } from '@playwright/test';

async function expectCenteredDialog(dialog: Locator, viewportWidth: number): Promise<void> {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('The Employee Document dialog geometry was unavailable.');
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth - 16);
  expect(Math.abs(box.x + box.width / 2 - viewportWidth / 2)).toBeLessThanOrEqual(1);
}

async function expectFocusInside(dialog: Locator): Promise<void> {
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
}

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

  let completeLink!: () => void;
  const linkCompletion = new Promise<void>((resolve) => {
    completeLink = resolve;
  });
  await page.route('**/api/v1/agencies/**', async (route) => {
    const request = route.request();
    const url = request.url();
    if (!url.includes('/documents')) {
      await route.continue();
      return;
    }
    if (request.method() === 'GET' && url.includes('/employees/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ documents: [] }),
      });
      return;
    }
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          documents: [
            {
              documentId: '00000000-0000-4000-8000-000000000008',
              documentNo: 'E2E-PDS-001',
              documentType: 'PDS',
              classification: 'CONFIDENTIAL',
              status: 'ISSUED',
              version: {
                id: '00000000-0000-4000-8000-000000000009',
                versionNo: 1,
                contentHash: 'e2e',
                mimeType: 'application/pdf',
                sizeBytes: 12,
                createdAt: '2026-08-30T00:00:00.000Z',
                issuedAt: '2026-08-30T00:00:00.000Z',
              },
            },
            {
              documentId: '00000000-0000-4000-8000-000000000008',
              documentNo: 'E2E-PDS-001',
              documentType: 'PDS',
              classification: 'CONFIDENTIAL',
              status: 'DRAFT',
              version: {
                id: '00000000-0000-4000-8000-00000000000a',
                versionNo: 2,
                contentHash: 'e2e-successor',
                mimeType: 'application/pdf',
                sizeBytes: 12,
                createdAt: '2026-08-30T00:00:00.000Z',
                issuedAt: null,
              },
            },
          ],
        }),
      });
      return;
    }
    if (request.method() === 'POST') {
      await linkCompletion;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
      return;
    }
    await route.continue();
  });

  await page.getByRole('tab', { name: 'Documents' }).click();
  const linkTrigger = page.getByRole('button', { name: 'Link personnel document' });
  await linkTrigger.click();
  const linkDialog = page.getByRole('dialog', { name: 'Link personnel document' });
  await expect(linkDialog).toBeVisible();
  await expect(linkDialog).toHaveAccessibleDescription(
    'Link one finalized Agency Document Version to this Employee with a controlled personnel meaning.',
  );
  await expect(linkDialog.getByLabel('Document Version')).toBeFocused();
  await expectFocusInside(linkDialog);
  await expectCenteredDialog(linkDialog, page.viewportSize()?.width ?? 1280);
  await page.mouse.click(1, 1);
  await expect(linkDialog).toBeVisible();
  await page.keyboard.press('Tab');
  await expectFocusInside(linkDialog);
  await linkDialog
    .getByLabel('Document Version')
    .selectOption('00000000-0000-4000-8000-000000000008:00000000-0000-4000-8000-000000000009');
  await expect(linkDialog.getByLabel('Exact version ID')).toHaveValue(
    '00000000-0000-4000-8000-000000000009',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expectCenteredDialog(linkDialog, 390);
  const submitLink = linkDialog.getByRole('button', {
    name: /^(Link document|Linking…|Linking\.\.\.)$/,
  });
  await submitLink.click();
  await expect(submitLink).toBeDisabled();
  await expect(
    linkDialog.getByRole('button', { name: 'Close link personnel document dialog' }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(linkDialog).toBeVisible();
  completeLink();
  await expect(linkDialog).toBeHidden();
  await expect(linkTrigger).toBeFocused();

  await page.getByRole('link', { name: 'Employee directory' }).click();
  await expect(
    page.getByRole('heading', { name: 'Employee directory', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(employeeNumber, { exact: true })).toBeVisible();
  await expect(page.getByText('LINKED', { exact: true })).toBeVisible();
});

test('keeps Employee creation values after a network failure and permits retry', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/employees/new');
  await page.getByLabel('Employee number').fill(`RETRY-${Date.now()}`);
  await page.getByLabel('Legal name').fill('Retry Employee');
  await page.getByLabel('Birth date').fill('1990-01-01');
  await page.getByLabel('Contact email').fill('retry@example.test');
  await page.route('**/api/v1/agencies/*/employees', (route) => route.abort('failed'), {
    times: 1,
  });
  await page.getByRole('button', { name: 'Create employee', exact: true }).click();
  await expect(
    page.locator('p[role="alert"]').filter({ hasText: 'Check the connection' }),
  ).toBeVisible();
  await expect(page.getByLabel('Legal name')).toHaveValue('Retry Employee');
  await expect(page.getByRole('button', { name: 'Create employee', exact: true })).toBeEnabled();
});
