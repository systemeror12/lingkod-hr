import { expect, test } from '@playwright/test';
import { MARISOL_EMAIL, signIn } from './sign-in';

// Seeded by packages/database/scripts/seed-protected-shell-e2e.ts.
const sensitiveDocumentId = '99999999-9999-4999-8999-999999999999';
const sensitiveDocumentNo = 'E2E-SENSITIVE-EVIDENCE';
const contextReaderEmail = 'context.reader@example.test';

test('shows sensitive Context evidence only to a reader permitted to read it', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, MARISOL_EMAIL);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();

  const headers = { origin: new URL(page.url()).origin };
  const session = (await (await page.request.get('/api/v1/auth/me', { headers })).json()) as {
    agencyId: string;
  };
  const { documents } = (await (
    await page.request.get(`/api/v1/agencies/${session.agencyId}/documents/versions`, { headers })
  ).json()) as { documents: Array<{ documentId: string; version: { id: string } }> };
  const versionId = documents.find(({ documentId }) => documentId === sensitiveDocumentId)?.version
    .id;
  if (!versionId) throw new Error('The sensitive Document Version fixture is missing.');

  await page.goto('/attendance-contexts?view=form&new=context');
  const reason = 'Medical consultation — E2E ' + Date.now();
  await page.getByLabel('Employee').selectOption({ label: 'E2E-0001 · Alex Rivera' });
  await page.getByRole('textbox', { name: 'Work date' }).fill('2026-09-11');
  await page.getByLabel('Reason').fill(reason);
  await page.getByLabel('Evidence Document Version ID (or link a source above)').fill(versionId);
  await page.getByRole('button', { name: 'Record Attendance Context', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Attendance Context recorded');
  await expect(page).toHaveURL(/record=/);
  const recordUrl = page.url();

  const permittedDetail = page.getByRole('definition').filter({ hasText: sensitiveDocumentNo });
  await expect(permittedDetail).toHaveText(`${sensitiveDocumentNo} · v1`);
  await expect(page.getByText('Restricted evidence')).toHaveCount(0);

  await page.context().clearCookies();
  await signIn(page, contextReaderEmail);
  await page.goto(recordUrl.replace(/&?new=[^&]*/, ''));
  await expect(page.getByText(reason)).toBeVisible();
  const detail = page.getByRole('definition').filter({ hasText: 'Restricted evidence' });
  await expect(detail).toHaveText('Restricted evidence');
  expectNoIdentifiers(await page.content(), versionId);

  await page.goto('/attendance-contexts');
  const row = page.getByRole('row').filter({ hasText: reason });
  await expect(row.getByText('Restricted evidence')).toBeVisible();
  expectNoIdentifiers(await page.content(), versionId);
});

function expectNoIdentifiers(html: string, versionId: string): void {
  for (const identifier of [
    sensitiveDocumentNo,
    sensitiveDocumentId,
    versionId,
    'MEDICAL_CERTIFICATE',
  ]) {
    expect(html).not.toContain(identifier);
  }
}
