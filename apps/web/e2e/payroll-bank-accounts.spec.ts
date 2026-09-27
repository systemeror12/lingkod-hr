import { expect, test } from '@playwright/test';

test('maintains masked payroll bank accounts through shared dialogs', async ({ page }) => {
  test.setTimeout(60_000);
  const stamp = Date.now();
  const legalName = `E2E Payroll Bank ${stamp}`;
  const accountNumber = `TESTBANK${stamp}`;
  const correctedNumber = `CORRECTED${stamp}`;
  const replacementNumber = `REPLACED${stamp}`;
  const accounts: Array<Record<string, string | null>> = [];
  const evidenceDocumentId = '00000000-0000-4000-8000-000000000301';
  const evidenceDocumentVersionId = '00000000-0000-4000-8000-000000000302';
  const history = [
    {
      id: '00000000-0000-4000-8000-000000000201',
      action: 'PAYROLL_BANK_ACCOUNT_CREATED',
      newStatus: 'PENDING_VERIFICATION',
      maskedAccountNumber: '********1234',
      actorDisplayName: 'Protected Shell HR',
      reason: 'Initial entry.',
      actedAt: '2026-09-05T00:00:00.000Z',
    },
  ];

  await page.route('**/api/v1/agencies/**/employees/**/documents', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        documents: [
          {
            id: '00000000-0000-4000-8000-000000000300',
            documentId: evidenceDocumentId,
            documentVersionId: evidenceDocumentVersionId,
            documentNo: 'BANK-EVIDENCE-001',
            documentType: 'BANK_CERTIFICATION',
            employeeId: '00000000-0000-4000-8000-000000000303',
            classification: 'CONFIDENTIAL',
            status: 'FINAL',
            personnelClassification: 'BANK_ACCOUNT',
            purpose: 'PAYROLL_SUPPORT',
            releaseState: 'RELEASED',
            versionNo: 1,
            mimeType: 'application/pdf',
            sizeBytes: 512,
            issuedAt: null,
            createdAt: '2026-09-05T00:00:00.000Z',
          },
        ],
      }),
    });
  });

  await page.route('**/api/v1/agencies/**/employees/**/payroll-bank-accounts**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const parts = url.pathname.split('/');
    const action = parts.at(-1);
    const accountId = parts.at(-2);
    if (request.method() === 'GET' && action === 'history') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ entries: history }),
      });
      return;
    }
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accounts }),
      });
      return;
    }
    const body = request.postDataJSON() as Record<string, string>;
    if (action === 'reveal') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accountNumber }),
      });
      return;
    }
    if (action === 'activate') {
      const target = accounts.find(({ id }) => id === accountId);
      if (target) {
        for (const item of accounts) item.status = 'REPLACED';
        target.status = 'ACTIVE';
        target.verificationState = 'VERIFIED';
        target.verifiedAt = body.verifiedAt;
        accounts.splice(0, accounts.length, target);
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (action === 'correct') {
      const target = accounts.find(({ id }) => id === accountId);
      if (target) {
        target.id = '00000000-0000-4000-8000-000000000102';
        target.maskedAccountNumber = '********5678';
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (action === 'replace') {
      accounts.push({
        id: '00000000-0000-4000-8000-000000000103',
        bankCode: body.bankCode,
        accountName: body.accountName,
        maskedAccountNumber: '********9012',
        verificationState: 'PENDING',
        verifiedAt: null,
        status: 'PENDING_VERIFICATION',
        effectiveFrom: body.effectiveFrom,
        effectiveTo: null,
      });
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
      return;
    }
    if (action === 'inactivate') {
      accounts.splice(0, accounts.length);
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    accounts.push({
      id: '00000000-0000-4000-8000-000000000101',
      bankCode: body.bankCode,
      accountName: body.accountName,
      maskedAccountNumber: '********1234',
      verificationState: 'PENDING',
      verifiedAt: null,
      status: 'PENDING_VERIFICATION',
      effectiveFrom: body.effectiveFrom,
      effectiveTo: null,
    });
    await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
  });

  const apiPort = process.env.PLAYWRIGHT_API_PORT ?? '3101';
  await expect
    .poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${apiPort}/api/v1/health`)).ok;
      } catch {
        return false;
      }
    })
    .toBe(true);

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible({ timeout: 15_000 });
  await page.goto('/employees');
  await page.getByRole('link', { name: 'Create employee' }).click();
  await page.getByLabel('Employee number').fill(`E2E-BANK-${stamp}`);
  await page.getByLabel('Legal name').fill(legalName);
  await page.getByLabel('Birth date').fill('1990-01-01');
  await page.getByLabel('Sex').selectOption('FEMALE');
  await page.getByLabel('Civil status').selectOption('SINGLE');
  await page.getByLabel('Contact email').fill(`bank.${stamp}@example.test`);
  await page.getByRole('button', { name: 'Create employee' }).click();

  await page.getByRole('tab', { name: 'Payroll bank accounts' }).click();
  await expect(page.getByRole('heading', { name: 'Payroll bank accounts' })).toBeVisible();
  await page.getByRole('button', { name: 'Add bank account' }).click();
  const create = page.getByRole('dialog', { name: 'Add payroll bank account' });
  await create.getByLabel('Bank code').fill('LBP');
  await create.getByLabel('Account name').fill(legalName);
  await create.getByLabel('Account number').fill(accountNumber);
  await create.getByLabel('Effective from').fill('2026-01-01');
  await create.getByLabel('Evidence (optional)').selectOption({ label: 'BANK-EVIDENCE-001' });
  const createRequest = page.waitForRequest(
    (request) => request.url().endsWith('/payroll-bank-accounts') && request.method() === 'POST',
  );
  await create.getByRole('button', { name: 'Save pending account' }).click();
  expect((await createRequest).postDataJSON()).toMatchObject({
    evidenceDocumentId,
    evidenceDocumentVersionId,
  });
  await expect(page.getByText('********1234', { exact: true })).toBeVisible();
  await expect(page.getByText(accountNumber, { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Activate', exact: true }).click();
  const activate = page.getByRole('dialog', { name: 'Activate payroll bank account' });
  await activate.getByLabel('Verified date').fill('2025-12-15');
  await activate.getByLabel('Reason').fill('Matched retained bank evidence.');
  await activate.getByRole('button', { name: 'Activate payroll bank account' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Reveal account number' }).click();
  const reveal = page.getByRole('dialog', { name: 'Reveal payroll bank account' });
  await reveal.getByLabel('Reveal reason').fill('Confirm payroll destination.');
  await reveal.getByRole('button', { name: 'Reveal payroll bank account' }).click();
  await expect(reveal.getByLabel('Revealed payroll bank account number')).toHaveText(accountNumber);
  await reveal.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText(accountNumber, { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Correct' }).click();
  const correct = page.getByRole('dialog', { name: 'Correct payroll bank account' });
  await correct.getByLabel('Account number').fill(correctedNumber);
  await correct.getByLabel('Reason').fill('Correct a transcription error.');
  await correct.getByRole('button', { name: 'Correct payroll bank account' }).click();
  await expect(page.getByText('********5678', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Replace' }).click();
  const replace = page.getByRole('dialog', { name: 'Replace payroll bank account' });
  await replace.getByLabel('Bank code').fill('DBP');
  await replace.getByLabel('Account number').fill(replacementNumber);
  await replace.getByLabel('Effective from').fill('2026-07-01');
  await replace.getByLabel('Reason').fill('Employee submitted a new payroll destination.');
  await replace.getByRole('button', { name: 'Replace payroll bank account' }).click();
  await expect(page.getByText('********9012', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'View history' }).first().click();
  const historyDialog = page.getByRole('region', { name: 'History payroll bank account' });
  await expect(historyDialog.getByText('********1234', { exact: true })).toBeVisible();
  await expect(historyDialog.getByText(accountNumber, { exact: true })).toHaveCount(0);
  await historyDialog.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'Activate', exact: true }).click();
  const replacementActivation = page.getByRole('dialog', { name: 'Activate payroll bank account' });
  await replacementActivation.getByLabel('Verified date').fill('2026-06-15');
  await replacementActivation.getByLabel('Reason').fill('Matched retained bank evidence.');
  await replacementActivation
    .getByRole('button', { name: 'Activate payroll bank account' })
    .click();
  await page.getByRole('button', { name: 'Inactivate' }).click();
  const inactivate = page.getByRole('dialog', { name: 'Inactivate payroll bank account' });
  await inactivate.getByLabel('Inactivation date').fill('2026-12-31');
  await inactivate.getByLabel('Reason').fill('Employee closed the account.');
  await inactivate.getByRole('button', { name: 'Inactivate payroll bank account' }).click();
  await expect(
    page.getByText('No payroll bank accounts are recorded for this Employee.'),
  ).toBeVisible();
});
