import { expect, test, type Locator } from '@playwright/test';

async function expectCenteredDialog(dialog: Locator, viewportWidth: number): Promise<void> {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('The Organization Unit dialog geometry was unavailable.');
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth - 16);
  expect(Math.abs(box.x + box.width / 2 - viewportWidth / 2)).toBeLessThanOrEqual(1);
}

async function expectFocusInside(dialog: Locator): Promise<void> {
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
}

test('creates and highlights a Draft Organization Unit through the Work queue', async ({
  page,
}, testInfo) => {
  const code = `RMD-${Date.now()}`;

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/organization');
  await expect(
    page.getByRole('heading', { name: 'Organization Units', exact: true }),
  ).toBeVisible();
  const emptyState = page.getByText('No Organization Units yet.', { exact: true });
  if (await emptyState.count()) {
    await expect(emptyState).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('empty.png'), fullPage: true });
  }

  const trigger = page.getByRole('button', { name: 'Create Organization Unit' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Create Organization Unit' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(
    'Register the unit as a Draft, then place and activate it from the preparation queue.',
  );
  await expect(page.getByLabel('Official name')).toBeFocused();
  await expectCenteredDialog(dialog, page.viewportSize()?.width ?? 1280);
  await page.mouse.click(1, 1);
  await expect(dialog).toBeVisible();

  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    await expectFocusInside(dialog);
  }
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Shift+Tab');
    await expectFocusInside(dialog);
  }

  await page.getByRole('button', { name: 'Create Draft' }).click();
  await expect(page.getByText('Enter the official name.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Official name')).toBeFocused();
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('validation.png'), fullPage: true });

  await page.getByLabel('Official name').fill('Records Management Division');
  await page.getByLabel('Agency-unique code').fill(code);
  await page.getByLabel('Unit type').selectOption('DIVISION');
  await page.getByLabel('Effective date').fill('2026-08-15');
  await page.getByRole('button', { name: 'Create Draft' }).click();

  await expect(page.getByRole('status')).toContainText(
    'Draft Organization Unit “Records Management Division” was created.',
  );
  const highlighted = page
    .getByRole('row')
    .filter({ hasText: 'Records Management Division' })
    .filter({ hasText: code });
  await expect(highlighted).toContainText('Records Management Division');
  await expect(highlighted).toContainText(code);
  await expect(highlighted).toContainText('DRAFT');
  await expect(highlighted).toHaveAttribute('data-highlighted', 'true');
  await expect(page.getByRole('button', { name: 'Create Organization Unit' })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('success-highlight.png'), fullPage: true });

  await trigger.click();
  await page.getByLabel('Official name').fill('Replacement Records Management Division');
  await page.getByLabel('Agency-unique code').fill(code);
  await page.getByRole('button', { name: 'Create Draft' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible();
  await expect(page.getByLabel('Official name')).toHaveValue(
    'Replacement Records Management Division',
  );
  await expect(page.getByLabel('Agency-unique code')).toHaveValue(code);
  await dialog.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.setViewportSize({ width: 820, height: 900 });
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expectCenteredDialog(dialog, 820);
  await dialog.press('Escape');

  await page.setViewportSize({ width: 720, height: 900 });
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expectCenteredDialog(dialog, 720);
  await expect(page.getByLabel('Official name')).toBeFocused();
  await dialog.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expectCenteredDialog(dialog, 390);
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Draft' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('responsive-modal.png'), fullPage: true });
});

test('guards every Organization Unit dismissal path during submission', async ({ page }) => {
  let releaseResponse!: () => void;
  const responseReleased = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });

  await page.route('**/api/v1/agencies/*/organization-units', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await responseReleased;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'held-organization-unit',
        code: 'HELD',
        officialName: 'Held Organization Unit',
        unitType: 'OFFICE',
        effectiveDate: '2026-08-16',
        status: 'DRAFT',
      }),
    });
  });

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/organization');
  const trigger = page.getByRole('button', { name: 'Create Organization Unit' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Create Organization Unit' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Official name').fill('Held Organization Unit');
  await page.getByLabel('Agency-unique code').fill('HELD');
  await page.getByRole('button', { name: 'Create Draft' }).click();

  const createButton = page.getByRole('button', { name: /Create Draft|Creating…/ });
  await expect(createButton).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Close Organization Unit dialog' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.mouse.click(1, 1);
  await expect(dialog).toBeVisible();

  releaseResponse();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('places Draft units into the effective hierarchy and inspects the dated tree', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const suffix = Date.now();
  const rootName = `Administrative Services Office ${suffix}`;
  const childName = `Records Division ${suffix}`;

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/organization');
  const createTrigger = page.getByRole('button', { name: 'Create Organization Unit' });

  await createTrigger.click();
  await page.getByLabel('Official name').fill(rootName);
  await page.getByLabel('Agency-unique code').fill(`ASO-${suffix}`);
  await page.getByLabel('Unit type').selectOption('OFFICE');
  await page.getByLabel('Effective date').fill('2026-08-15');
  await page.getByRole('button', { name: 'Create Draft' }).click();

  const rootRow = page.getByRole('row').filter({ hasText: rootName });
  const rootActivationTrigger = rootRow.getByRole('button', {
    name: `Place and activate ${rootName}`,
  });
  await rootActivationTrigger.click();
  const activationDialog = page.getByRole('dialog', { name: `Activate ${rootName}` });
  await expect(activationDialog).toBeVisible();
  const activationCode = activationDialog.getByText(`ASO-${suffix}`, { exact: true });
  await expect(activationCode).toBeVisible();
  expect(
    await activationCode.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await expect(activationDialog).toHaveAccessibleDescription(
    'Choose where this unit reports, then activate its effective-dated version.',
  );
  await expect(page.getByLabel('Parent Organization Unit')).toBeFocused();
  await expectCenteredDialog(activationDialog, page.viewportSize()?.width ?? 1280);
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    await expectFocusInside(activationDialog);
  }
  await page.mouse.click(1, 1);
  await expect(activationDialog).toBeVisible();
  await activationDialog.press('Escape');
  await expect(activationDialog).toBeHidden();
  await expect(rootActivationTrigger).toBeFocused();
  await rootActivationTrigger.click();
  await expect(activationDialog).toBeVisible();
  await page.getByRole('button', { name: 'Activate Organization Unit' }).click();
  await expect(page.getByText('Enter the activation reason.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Activation reason')).toBeFocused();
  await page.getByLabel('Activation reason').fill('Approved as the Agency root');

  let releaseActivation!: () => void;
  const activationReleased = new Promise<void>((resolve) => {
    releaseActivation = resolve;
  });
  await page.route(
    '**/api/v1/agencies/*/organization-units/*/activate',
    async (route) => {
      await activationReleased;
      await route.continue();
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Activate Organization Unit' }).click();
  await expect(page.getByRole('button', { name: 'Activating…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Close activation dialog' })).toBeDisabled();
  await expect(activationDialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await activationDialog.press('Escape');
  await page.mouse.click(1, 1);
  await expect(activationDialog).toBeVisible();
  releaseActivation();

  await expect(page.getByRole('status')).toContainText(`${rootName} is now active.`);
  await expect(page.getByRole('heading', { name: 'Effective hierarchy' })).toBeVisible();
  await page.getByRole('link', { name: '← Organization Units', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(rootName) }).click();
  await expect(page).toHaveURL(/unit=/);
  await page.reload();
  const selectedRecord = page.getByRole('region', { name: 'Selected Organization Unit' });
  await expect(selectedRecord).toContainText(rootName);
  await expect(selectedRecord).toContainText('No parent · Agency root');
  await expect(selectedRecord).toContainText('ACTIVE');

  await createTrigger.click();
  await page.getByLabel('Official name').fill(childName);
  await page.getByLabel('Agency-unique code').fill(`RD-${suffix}`);
  await page.getByLabel('Unit type').selectOption('DIVISION');
  await page.getByLabel('Effective date').fill('2026-08-15');
  await page.getByRole('button', { name: 'Create Draft' }).click();
  const childRow = page.getByRole('row').filter({ hasText: childName });
  await childRow.getByRole('button', { name: `Place and activate ${childName}` }).click();
  await page.getByLabel('Parent Organization Unit').selectOption({ label: rootName });
  await page.getByLabel('Activation reason').fill('Approved reporting placement');
  await page.getByRole('button', { name: 'Activate Organization Unit' }).click();

  await expect(page.getByRole('status')).toContainText(`${childName} is now active.`);
  await expect(selectedRecord).toContainText(rootName);
  await expect(selectedRecord).toContainText('0 children');
  await page.getByRole('link', { name: '← Organization Units', exact: true }).click();
  const verticalConnector = page.locator('[data-tree-connector="vertical"]');
  await expect(verticalConnector.first()).toBeVisible();
  await expect(verticalConnector.first()).toHaveCSS('width', '1px');
  await expect(verticalConnector.first()).toHaveCSS('background-color', 'rgb(174, 184, 199)');
  const childHierarchyButton = page
    .getByRole('navigation', { name: 'Organization hierarchy' })
    .getByRole('button', { name: new RegExp(childName) });
  const verticalBox = await verticalConnector.first().boundingBox();
  const childButtonBox = await childHierarchyButton.boundingBox();
  const horizontalBox = await childHierarchyButton.locator('span').first().boundingBox();
  expect(verticalBox).not.toBeNull();
  expect(childButtonBox).not.toBeNull();
  expect(horizontalBox).not.toBeNull();
  if (verticalBox && horizontalBox) {
    expect(Math.abs(verticalBox.x - horizontalBox.x)).toBeLessThanOrEqual(1);
  }
  if (verticalBox && childButtonBox) {
    expect(Math.abs(verticalBox.y - childButtonBox.y)).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: testInfo.outputPath('effective-hierarchy.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Hierarchy as of')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Effective hierarchy' })).toBeVisible();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({
    path: testInfo.outputPath('effective-hierarchy-narrow.png'),
    fullPage: true,
  });
});

test('reviews an effective-dated Organization Unit successor without rewriting the current version', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const suffix = Date.now();
  const name = `Records Information Office ${suffix}`;

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/organization');
  await page.getByRole('button', { name: 'Create Organization Unit' }).click();
  await page.getByLabel('Official name').fill(name);
  await page.getByLabel('Agency-unique code').fill(`RIO-${suffix}`);
  await page.getByLabel('Unit type').selectOption('OFFICE');
  await page.getByLabel('Effective date').fill('2026-08-15');
  await page.getByRole('button', { name: 'Create Draft' }).click();

  const row = page.getByRole('row').filter({ hasText: name });
  await row.getByRole('button', { name: `Place and activate ${name}` }).click();
  await page.getByLabel('Activation reason').fill('Approved as an Agency root');
  await page.getByRole('button', { name: 'Activate Organization Unit' }).click();
  await expect(page.getByRole('status')).toContainText(`${name} is now active.`);

  await page.getByRole('link', { name: '← Organization Units', exact: true }).click();
  await page
    .getByRole('button', { name: new RegExp(name) })
    .first()
    .click();
  await page.getByRole('button', { name: 'Prepare change' }).click();
  const dialog = page.getByRole('region', { name: 'Review Organization Unit successor' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(
    'Edit the proposed values and effective date. The current version remains unchanged until activation.',
  );
  await expect(page.getByLabel('Proposed official name')).toBeFocused();
  await expect(dialog).toContainText(name);
  await expect(dialog).toContainText('Proposed successor');
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await dialog.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText('Draft successor saved');
});

test('keeps a missing Unit explicit across reload and returns to the dated Tree', async ({
  page,
}) => {
  await page.goto(
    '/organization?asOf=2026-08-15&unit=00000000-0000-4000-8000-000000000000&view=form',
  );
  await expect(page.getByRole('alert')).toContainText('This Organization Unit is unavailable');
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('This Organization Unit is unavailable');
  await page.getByRole('link', { name: '← Organization Units', exact: true }).click();
  await expect(page).toHaveURL(/asOf=2026-08-15/);
  await expect(page.getByLabel('Hierarchy as of')).toHaveValue('2026-08-15');
  await page.goBack();
  await expect(page.getByRole('alert')).toContainText('This Organization Unit is unavailable');
});
