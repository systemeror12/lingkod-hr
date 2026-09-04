import { expect, test, type Locator, type Page } from '@playwright/test';

async function expectCenteredDialog(dialog: Locator, viewportWidth: number): Promise<void> {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('The Government Identifier dialog geometry was unavailable.');
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth - 16);
  expect(Math.abs(box.x + box.width / 2 - viewportWidth / 2)).toBeLessThanOrEqual(1);
}

async function expectFocusInside(dialog: Locator): Promise<void> {
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
}

async function expectFocusTrap(page: Page, dialog: Locator): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    await expectFocusInside(dialog);
  }
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Shift+Tab');
    await expectFocusInside(dialog);
  }
}

test('manages masked government identifiers through the shared dialogs', async ({ page }) => {
  const stamp = Date.now();
  const employeeNumber = `E2E-GI-${stamp}`;
  const legalName = `E2E Government Identifier ${stamp}`;

  const identifiers = [
    {
      id: '00000000-0000-4000-8000-000000000101',
      identifierType: 'TIN',
      maskedValue: '********1234',
      status: 'ACTIVE',
      verifiedAt: '2026-08-31T00:00:00.000Z',
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
    },
  ];

  const historyById: Record<string, Array<Record<string, string>>> = {
    '00000000-0000-4000-8000-000000000101': [
      {
        id: '00000000-0000-4000-8000-000000000201',
        action: 'CREATED',
        status: 'ACTIVE',
        maskedValue: '********1234',
        actorDisplayName: 'Protected Shell HR',
        actedAt: '2026-08-31T00:00:00.000Z',
        reason: 'Initial protected entry',
      },
    ],
  };
  const revealedValue = 'TEST-ONLY-TIN-1234';

  let completeReveal!: () => void;
  const revealCompletion = new Promise<void>((resolve) => {
    completeReveal = resolve;
  });

  await page.route('**/api/v1/agencies/**/employees/**/government-identifiers**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const parts = url.pathname.split('/');
    const identifierId = parts[parts.length - 2];
    const action = parts[parts.length - 1];

    if (request.method() === 'GET' && action === 'history') {
      const historyIdentifierId = url.searchParams.get('identifierId') ?? '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ entries: historyById[historyIdentifierId] ?? [] }),
      });
      return;
    }

    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ identifiers }),
      });
      return;
    }

    if (request.method() !== 'POST' && request.method() !== 'PATCH') {
      await route.continue();
      return;
    }

    const payload = request.postDataJSON() as Record<string, string | null>;

    if (action === 'reveal') {
      expect(request.method()).toBe('POST');
      await revealCompletion;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ value: revealedValue }),
      });
      return;
    }

    if (action === 'replace') {
      expect(request.method()).toBe('POST');
      const target = identifiers.find((identifier) => identifier.id === identifierId);
      if (target) {
        target.maskedValue = '********4321';
        target.updatedAt = '2026-09-02T00:00:00.000Z';
        target.verifiedAt = payload.verifiedAt ?? target.verifiedAt;
        historyById[target.id] = [
          {
            id: '00000000-0000-4000-8000-000000000202',
            action: 'REPLACED',
            status: 'ACTIVE',
            maskedValue: '********4321',
            actorDisplayName: 'Protected Shell HR',
            actedAt: '2026-09-02T00:00:00.000Z',
            reason: String(payload.reason ?? ''),
          },
          ...historyById[target.id],
        ];
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    if (action === 'invalidate') {
      expect(request.method()).toBe('PATCH');
      const target = identifiers.find((identifier) => identifier.id === identifierId);
      if (target) {
        target.status = 'INVALID';
        target.updatedAt = '2026-09-03T00:00:00.000Z';
        historyById[target.id] = [
          {
            id: '00000000-0000-4000-8000-000000000203',
            action: 'INVALIDATED',
            status: 'INVALID',
            maskedValue: target.maskedValue,
            actorDisplayName: 'Protected Shell HR',
            actedAt: '2026-09-03T00:00:00.000Z',
            reason: String(payload.reason ?? ''),
          },
          ...historyById[target.id],
        ];
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    if (parts[parts.length - 1] === 'government-identifiers') {
      const createdId = '00000000-0000-4000-8000-000000000102';
      identifiers.push({
        id: createdId,
        identifierType: String(payload.identifierType ?? 'OTHER'),
        maskedValue: '********5678',
        status: 'ACTIVE',
        verifiedAt: payload.verifiedAt ?? '2026-09-01T00:00:00.000Z',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      });
      historyById[createdId] = [
        {
          id: '00000000-0000-4000-8000-000000000204',
          action: 'CREATED',
          status: 'ACTIVE',
          maskedValue: '********5678',
          actorDisplayName: 'Protected Shell HR',
          actedAt: '2026-09-01T00:00:00.000Z',
          reason: 'Created in browser test',
        },
      ];
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Unsupported test route.' } }),
    });
  });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible({ timeout: 15000 });
  await page.goto('/employees');
  await expect(
    page.getByRole('heading', { name: 'Employee directory', exact: true }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Create employee' }).click();
  await page.getByLabel('Employee number').fill(employeeNumber);
  await page.getByLabel('Legal name').fill(legalName);
  await page.getByLabel('Birth date').fill('1995-06-15');
  await page.getByLabel('Sex').selectOption('FEMALE');
  await page.getByLabel('Civil status').selectOption('SINGLE');
  await page.getByLabel('Contact email').fill(`identifiers.${stamp}@example.test`);
  await page.getByRole('button', { name: 'Create employee' }).click();

  await expect(page.getByRole('heading', { name: legalName })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Government identifiers', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('********1234', { exact: true })).toBeVisible();
  await expect(page.getByText('123456789123', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Add identifier' }).click();
  const createDialog = page.getByRole('dialog', { name: 'Add government identifier' });
  await expect(createDialog).toBeVisible();
  await expect(createDialog).toHaveAccessibleDescription(
    'Record one active protected value for a supported identifier type. The routine list stays masked.',
  );
  await expect(createDialog.getByLabel('Identifier value')).toBeFocused();
  await expectFocusInside(createDialog);
  await expectFocusTrap(page, createDialog);
  await expectCenteredDialog(createDialog, 1280);
  await createDialog.getByLabel('Identifier type').selectOption('GSIS');
  await createDialog.getByLabel('Identifier value').fill('GSIS-987654321');
  await createDialog.getByLabel('Verified date').fill('2026-09-01');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectCenteredDialog(createDialog, 390);
  await createDialog.getByRole('button', { name: 'Save identifier' }).click();
  await expect(createDialog).toBeHidden();
  await expect(page.getByText('GSIS', { exact: true })).toBeVisible();
  await expect(page.getByText('********5678', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Reveal value' }).first().click();
  const revealDialog = page.getByRole('dialog', { name: 'Reveal government identifier' });
  await expect(revealDialog).toBeVisible();
  await expect(revealDialog).toHaveAccessibleDescription(
    'Record why you need the full protected value. The routine screen stays masked.',
  );
  await expect(revealDialog.getByLabel('Reveal reason')).toBeFocused();
  await expectFocusInside(revealDialog);
  await expectFocusTrap(page, revealDialog);
  await revealDialog.getByLabel('Reveal reason').fill('Validate the employee submission.');
  const revealSubmit = revealDialog.getByRole('button', {
    name: /^(Reveal value|Revealing…|Revealing\.\.\.)$/,
  });
  await revealSubmit.click();
  await expect(revealSubmit).toBeDisabled();
  await expect(
    revealDialog.getByRole('button', { name: 'Close reveal government identifier dialog' }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(revealDialog).toBeVisible();
  completeReveal();
  await expect(revealDialog).toContainText(revealedValue);
  await expect(revealDialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await revealDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(revealDialog).toBeHidden();
  await expect(page.getByText(revealedValue, { exact: true })).toHaveCount(0);
  await expect(page.getByText('********1234', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reveal value' }).first()).toBeFocused();

  await page.getByRole('button', { name: 'View history' }).first().click();
  const historyDialog = page.getByRole('dialog', { name: 'Government identifier history' });
  await expect(historyDialog).toBeVisible();
  await expect(historyDialog).toHaveAccessibleDescription(
    'Inspect retained events for the selected protected identifier without exposing its full value.',
  );
  await expectFocusTrap(page, historyDialog);
  await expect(historyDialog).toContainText('Created');
  await expect(historyDialog).toContainText('Initial protected entry');
  await historyDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(historyDialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'View history' }).first()).toBeFocused();

  await page.getByRole('button', { name: 'Replace' }).first().click();
  const replaceDialog = page.getByRole('dialog', { name: 'Replace government identifier' });
  await expect(replaceDialog).toBeVisible();
  await expect(replaceDialog).toHaveAccessibleDescription(
    'Save a successor protected value. The former record stays in retained history.',
  );
  await expectFocusTrap(page, replaceDialog);
  await replaceDialog.getByLabel('New identifier value').fill('1234567894321');
  await replaceDialog.getByLabel('Replacement reason').fill('Employee submitted a corrected TIN.');
  await replaceDialog.getByRole('button', { name: 'Replace identifier' }).click();
  await expect(replaceDialog).toBeHidden();
  await expect(page.getByText('********4321', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Replace' }).first()).toBeFocused();

  await page.getByRole('button', { name: 'Invalidate' }).nth(1).click();
  const invalidateDialog = page.getByRole('dialog', { name: 'Invalidate government identifier' });
  await expect(invalidateDialog).toBeVisible();
  await expect(invalidateDialog).toHaveAccessibleDescription(
    'Mark this protected value invalid without deleting its retained history.',
  );
  await expect(invalidateDialog.getByLabel('Invalidation reason')).toBeFocused();
  await expectFocusTrap(page, invalidateDialog);
  await invalidateDialog
    .getByLabel('Invalidation reason')
    .fill('The GSIS number was entered for the wrong employee.');
  await invalidateDialog.getByRole('button', { name: 'Invalidate identifier' }).click();
  await expect(invalidateDialog).toBeHidden();
  await expect(page.getByText('Invalid', { exact: true })).toBeVisible();
  await expect(
    page.locator('section[aria-labelledby="government-identifiers-heading"]'),
  ).toBeFocused();
});
