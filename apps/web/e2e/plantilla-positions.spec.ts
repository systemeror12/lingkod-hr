import { expect, test, type Locator } from '@playwright/test';

async function expectCenteredDialog(dialog: Locator, viewportWidth: number): Promise<void> {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('The Plantilla Position dialog geometry was unavailable.');
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth - 16);
  expect(Math.abs(box.x + box.width / 2 - viewportWidth / 2)).toBeLessThanOrEqual(1);
}

test('creates a proposed Plantilla Position and prepares one successor', async ({ page }) => {
  const itemNumber = 'E2E-' + Date.now();

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/plantilla-positions');
  await expect(
    page.getByRole('heading', { name: 'Plantilla positions', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /HRM-000142/ })).toBeVisible();

  const trigger = page.getByRole('button', { name: 'Create proposed position' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Create proposed position' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(
    'Reserve the permanent Item Number and record its first effective definition against active Agency references.',
  );
  await expect(dialog.getByLabel('Permanent Item Number')).toBeFocused();
  await expectCenteredDialog(dialog, page.viewportSize()?.width ?? 1280);

  await page.mouse.click(1, 1);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await dialog.getByLabel('Permanent Item Number').fill(itemNumber);
  await dialog.getByLabel('Position title').fill('Human Resource Management Officer III');
  await dialog.getByLabel('Parenthetical title Optional').fill('Records and Staffing');
  await dialog.getByLabel('Salary grade').fill('18');
  await dialog.getByLabel('Organization unit').selectOption({ index: 1 });
  await dialog.getByLabel('Funding source').fill('General Appropriations Act');
  await dialog.getByLabel('Exact Qualification Standard version').selectOption({ index: 1 });
  await dialog.getByLabel('Applicable Staffing Authority').selectOption({ index: 1 });
  await dialog.getByRole('button', { name: 'Create proposed position' }).click();

  await expect(page.getByRole('status')).toContainText(
    `Proposed position “${itemNumber}” was created.`,
  );
  const result = page.getByRole('button', { name: new RegExp(itemNumber) });
  await expect(result).toBeVisible();
  await result.click();
  await expect(
    page.getByRole('heading', { name: 'Human Resource Management Officer III' }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Effective definition' }).getByText('Version 1', {
      exact: true,
    }),
  ).toBeVisible();

  const linkTrigger = page.getByRole('button', { name: 'Link External Evidence' });
  await linkTrigger.click();
  const linkDialog = page.getByRole('dialog', { name: 'Link External Evidence' });
  await expect(linkDialog).toBeVisible();
  await expect(linkDialog).toHaveAccessibleDescription(
    'Attach an accessible Agency Document to this position with the reason it supports the record.',
  );
  await expect(linkDialog.getByLabel('External Evidence Document')).toBeFocused();
  await expectCenteredDialog(linkDialog, page.viewportSize()?.width ?? 1280);
  await page.keyboard.press('Tab');
  expect(await linkDialog.evaluate((element) => element.contains(document.activeElement))).toBe(
    true,
  );
  await page.keyboard.press('Escape');
  await expect(linkDialog).toBeHidden();
  await expect(linkTrigger).toBeFocused();
  await linkTrigger.click();
  await expect(linkDialog.getByLabel('External Evidence Document')).toBeFocused();
  await linkDialog.getByLabel('External Evidence Document').selectOption({
    label: 'E2E-PLANTILLA-AUTHORITY · STAFFING_AUTHORITY · v1',
  });
  await linkDialog.getByLabel('Evidence purpose').selectOption('POSITION_DESCRIPTION');
  await linkDialog.getByLabel('Effectivity Optional').fill('2026-01-01');
  await linkDialog.getByRole('button', { name: 'Link evidence', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(
    'External Evidence E2E-PLANTILLA-AUTHORITY was linked',
  );
  const evidenceDocument = page.getByText('E2E-PLANTILLA-AUTHORITY', { exact: true });
  await expect(evidenceDocument).toBeVisible();
  const evidenceDocumentBox = await evidenceDocument.boundingBox();
  const inspectEvidence = page.getByRole('button', { name: 'Inspect document' });
  const inspectEvidenceBox = await inspectEvidence.boundingBox();
  expect(evidenceDocumentBox).not.toBeNull();
  expect(inspectEvidenceBox).not.toBeNull();
  if (!evidenceDocumentBox || !inspectEvidenceBox) {
    throw new Error('Evidence layout geometry was unavailable.');
  }
  expect(inspectEvidenceBox.y).toBeGreaterThan(evidenceDocumentBox.y);
  const linkButtonBox = await linkTrigger.boundingBox();
  expect(linkButtonBox).not.toBeNull();
  if (!linkButtonBox) throw new Error('Evidence link trigger geometry was unavailable.');
  expect(linkButtonBox.height).toBe(44);

  const removeTrigger = page.getByRole('button', { name: 'Remove link' }).first();
  await removeTrigger.click();
  const removeDialog = page.getByRole('dialog', { name: 'Remove evidence link' });
  await expect(removeDialog).toBeVisible();
  await expect(removeDialog).toHaveAccessibleDescription(
    'Remove E2E-PLANTILLA-AUTHORITY from this position only. The Document, its versions, and audit history stay preserved.',
  );
  await expect(removeDialog.getByLabel('Reason for removal')).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await removeDialog.evaluate((element) => element.contains(document.activeElement))).toBe(
    true,
  );
  await page.keyboard.press('Escape');
  await expect(removeDialog).toBeHidden();
  await expect(removeTrigger).toBeFocused();
  await removeTrigger.click();
  await expect(removeDialog.getByLabel('Reason for removal')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectCenteredDialog(removeDialog, 390);
  await removeDialog
    .getByLabel('Reason for removal')
    .fill('The document was attached to the wrong controlled purpose.');
  await removeDialog.getByRole('button', { name: 'Remove link', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('position description link was removed');
  await expect(page.getByText('E2E-PLANTILLA-AUTHORITY', { exact: true })).toBeHidden();
  await expect(linkTrigger).toBeFocused();

  await page.getByRole('button', { name: 'Prepare successor' }).click();
  await expect(page.getByRole('status')).toContainText(
    `Draft successor prepared for “${itemNumber}”.`,
  );
  await expect(page.getByRole('button', { name: 'Draft successor exists' })).toBeDisabled();

  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expectCenteredDialog(dialog, 390);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('authorizes and controls a Plantilla Position lifecycle with evidence', async ({ page }) => {
  const itemNumber = 'LIFE-E2E-' + Date.now();

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/plantilla-positions');
  await expect(
    page.getByRole('heading', { name: 'Plantilla positions', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Create proposed position' }).click();
  const createDialog = page.getByRole('dialog', { name: 'Create proposed position' });
  await createDialog.getByLabel('Permanent Item Number').fill(itemNumber);
  await createDialog.getByLabel('Position title').fill('Lifecycle Test Position');
  await createDialog.getByLabel('Salary grade').fill('18');
  await createDialog.getByLabel('Organization unit').selectOption({ index: 1 });
  await createDialog.getByLabel('Funding source').fill('General Appropriations Act');
  await createDialog.getByLabel('Exact Qualification Standard version').selectOption({ index: 1 });
  await createDialog.getByLabel('Applicable Staffing Authority').selectOption({ index: 1 });
  await createDialog.getByRole('button', { name: 'Create proposed position' }).click();

  await expect(page.getByRole('status')).toContainText(
    `Proposed position “${itemNumber}” was created.`,
  );
  await page.getByRole('button', { name: new RegExp(itemNumber) }).click();
  await expect(page.getByRole('button', { name: 'Authorize position' })).toBeVisible();

  async function linkEvidence(purpose: 'CREATION' | 'FREEZE' | 'ABOLITION'): Promise<void> {
    await page.getByRole('button', { name: 'Link External Evidence' }).click();
    const linkDialog = page.getByRole('dialog', { name: 'Link External Evidence' });
    await linkDialog.getByLabel('External Evidence Document').selectOption({
      label: 'E2E-PLANTILLA-AUTHORITY · STAFFING_AUTHORITY · v1',
    });
    await linkDialog.getByLabel('Evidence purpose').selectOption(purpose);
    await linkDialog.getByRole('button', { name: 'Link evidence', exact: true }).click();
    await expect(page.getByRole('status')).toContainText(
      'External Evidence E2E-PLANTILLA-AUTHORITY was linked',
    );
  }

  async function completeTransition(
    button: string,
    dialogName: string,
    submitButton: string,
    reason: string,
    successText: string,
  ): Promise<void> {
    await page.getByRole('button', { name: button, exact: true }).click();
    const transitionDialog = page.getByRole('dialog', { name: dialogName });
    await expect(transitionDialog.getByLabel('Effective date')).toBeFocused();
    await transitionDialog.getByLabel('Reason').fill(reason);
    await transitionDialog.getByRole('button', { name: submitButton, exact: true }).click();
    await expect(page.getByRole('status')).toContainText(successText);
    await expect(page.locator('[aria-label="Position lifecycle actions"]')).toBeFocused();
  }

  await linkEvidence('CREATION');
  const authorizeButton = page.getByRole('button', { name: 'Authorize position', exact: true });
  await authorizeButton.click();
  const authorizeDialog = page.getByRole('dialog', { name: 'Authorize Plantilla Position' });
  await expect(authorizeDialog).toHaveAccessibleDescription(
    'Authorize this complete proposed position with its active Staffing Authority and creation evidence.',
  );
  await expectCenteredDialog(authorizeDialog, page.viewportSize()?.width ?? 1280);
  await page.keyboard.press('Escape');
  await expect(authorizeDialog).toBeHidden();
  await expect(authorizeButton).toBeFocused();
  await completeTransition(
    'Authorize position',
    'Authorize Plantilla Position',
    'Authorize position',
    'The complete proposed position is authorized for the Agency.',
    `“${itemNumber}” was authorized`,
  );
  await expect(
    page.getByRole('region', { name: 'Effective definition' }).getByText('AUTHORIZED', {
      exact: true,
    }),
  ).toBeVisible();

  await completeTransition(
    'Declare vacant',
    'Declare position vacant',
    'Declare vacant',
    'The authorized item has no incumbent.',
    `“${itemNumber}” was declared vacant`,
  );
  await expect(
    page.getByRole('region', { name: 'Effective definition' }).getByText('VACANT', {
      exact: true,
    }),
  ).toBeVisible();

  await linkEvidence('FREEZE');
  await completeTransition(
    'Freeze position',
    'Freeze Plantilla Position',
    'Freeze position',
    'The item is frozen pending the approved control.',
    `“${itemNumber}” was frozen`,
  );
  await expect(
    page.getByRole('region', { name: 'Effective definition' }).getByText('FROZEN', {
      exact: true,
    }),
  ).toBeVisible();

  await completeTransition(
    'Restore vacancy',
    'Restore position to vacant',
    'Restore vacancy',
    'The freeze control has been cleared.',
    `“${itemNumber}” was restored to vacant`,
  );
  await expect(
    page.getByRole('region', { name: 'Effective definition' }).getByText('VACANT', {
      exact: true,
    }),
  ).toBeVisible();

  await linkEvidence('ABOLITION');
  await completeTransition(
    'Abolish position',
    'Abolish Plantilla Position',
    'Abolish position',
    'The authorized item is abolished prospectively.',
    `“${itemNumber}” was abolished`,
  );
  await expect(
    page.getByRole('region', { name: 'Effective definition' }).getByText('ABOLISHED', {
      exact: true,
    }),
  ).toBeVisible();

  const history = page.getByRole('region', { name: 'Transition history' });
  await expect(history).toContainText('AUTHORIZED');
  await expect(history).toContainText('VACANT');
  await expect(history).toContainText('FROZEN');
  await expect(history).toContainText('ABOLISHED');

  await page.goto('/audit');
  await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible();
  const auditEvent = page
    .getByRole('button')
    .filter({ hasText: 'PLANTILLA_POSITION_ABOLISHED' })
    .first();
  await expect(auditEvent).toContainText('VACANT → ABOLISHED');
  await auditEvent.click();
  const auditDialog = page.getByRole('dialog', { name: 'Audit Event detail' });
  await expect(auditDialog).toContainText('PLANTILLA_POSITION_ABOLISHED');
  await expect(auditDialog).toContainText('ABOLISHED');
});
