import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { getConfig } from '@lingkod-hr/config';
import { expect, test, type Page } from '@playwright/test';
import { MARISOL_EMAIL, signIn } from './sign-in';

async function withAdmin<T>(work: (admin: PrismaClient) => Promise<T>): Promise<T> {
  getConfig();
  const adminUrl = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!adminUrl) throw new Error('A worktree database owner URL is required for the fixture.');
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    return await work(admin);
  } finally {
    await admin.$disconnect();
  }
}

function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * An Employee of their own, so no other journey's balance moves, with 120 minutes of COC earned
 * this month: an approved COC authority, one certified service record on it, an approved
 * Certificate of COC Earned, and the ledger entry its approval posts. Certification and approval
 * have their own journeys; this one starts where they end, so the records are written in their
 * final state. Also a finalized Document Version to support corrections.
 */
async function seedEarnedCoc(stamp: number) {
  return withAdmin(async (admin) => {
    const alex = await admin.employee.findFirstOrThrow({
      where: { employeeNumber: 'E2E-0001' },
      select: { agencyId: true, currentServiceSegment: { select: { organizationUnitId: true } } },
    });
    const agencyId = alex.agencyId;
    const unitId = alex.currentServiceSegment?.organizationUnitId;
    if (!unitId) throw new Error('Alex Rivera has no current Service Segment.');
    const marisol = await admin.agencyMembership.findFirstOrThrow({
      where: { agencyId, user: { emailNormalized: MARISOL_EMAIL } },
      select: { id: true },
    });
    // A certificate's approver is never its preparer.
    const preparer = await admin.agencyMembership.findFirstOrThrow({
      where: { agencyId, id: { not: marisol.id } },
      select: { id: true },
    });
    const today = manilaToday();
    const earnedMonth = `${today.slice(0, 7)}-01`;
    const validUntil = `${Number(today.slice(0, 4)) + 1}-12-31`;
    const name = `Ledger Employee ${stamp}`;
    const authorityNo = `OT-LEDGER-${stamp}`;
    return admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const employee = await transaction.employee.create({
        data: {
          agencyId,
          employeeNumber: `E2E-COC-${stamp}`,
          legalName: name,
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `coc-ledger-${stamp}@example.test`,
          serviceStatus: 'ACTIVE',
          createdByMembershipId: marisol.id,
          updatedByMembershipId: marisol.id,
        },
      });
      const authority = await transaction.overtimeAuthority.create({
        data: {
          agencyId,
          requestingUnitId: unitId,
          authorityNo,
          purpose: 'Digitize the accession registers.',
          workDateFrom: new Date(earnedMonth),
          workDateTo: new Date(earnedMonth),
          compensationMethod: 'COC',
          status: 'APPROVED',
          approvedByMembershipId: marisol.id,
          approvedAt: new Date(),
        },
      });
      const coverage = await transaction.overtimeAuthorityEmployee.create({
        data: {
          agencyId,
          overtimeAuthorityId: authority.id,
          employeeId: employee.id,
          authorizedHours: '2',
        },
      });
      const record = await transaction.overtimeServiceRecord.create({
        data: {
          agencyId,
          overtimeAuthorityEmployeeId: coverage.id,
          employeeId: employee.id,
          workDate: new Date(earnedMonth),
          claimedHours: '2',
          accomplishment: 'Digitized the accession registers.',
          actualMinutes: 120,
          sourceAttendanceDayId: randomUUID(),
          dayClassification: 'WORKDAY',
          status: 'CERTIFIED',
          certifiedMinutes: 120,
          recordedByMembershipId: marisol.id,
          certifiedByMembershipId: marisol.id,
          certifiedAt: new Date(),
        },
      });
      const certificate = await transaction.cocEarnedCertificate.create({
        data: {
          agencyId,
          employeeId: employee.id,
          earnedMonth: new Date(earnedMonth),
          status: 'APPROVED',
          preparedByMembershipId: preparer.id,
          approvedByMembershipId: marisol.id,
          approvedAt: new Date(),
        },
      });
      const line = await transaction.cocEarnedCertificateLine.create({
        data: {
          agencyId,
          cocEarnedCertificateId: certificate.id,
          overtimeServiceRecordId: record.id,
          certifiedMinutes: 120,
          creditedMinutes: '120.0',
          excessMinutes: '0.0',
        },
      });
      const account = await transaction.cocAccount.create({
        data: { agencyId, employeeId: employee.id, status: 'ACTIVE', openedAt: new Date(today) },
      });
      await transaction.cocLedgerEntry.create({
        data: {
          agencyId,
          cocAccountId: account.id,
          minutes: '120.0',
          effectiveDate: new Date(today),
          validUntil: new Date(validUntil),
          earnedMonth: new Date(earnedMonth),
          sourceType: 'COC_EARNED_CERTIFICATE',
          sourceId: certificate.id,
          sourcePostingKey: line.id,
          ruleCode: 'JC2_2004_COC_EARNING',
          postedByMembershipId: marisol.id,
        },
      });
      const document = await transaction.document.create({
        data: {
          agencyId,
          documentType: 'COC_CORRECTION_BASIS',
          classification: 'INTERNAL',
          status: 'APPROVED',
          createdByMembershipId: marisol.id,
        },
      });
      const version = await transaction.documentVersion.create({
        data: {
          agencyId,
          documentId: document.id,
          versionNo: 1,
          storageKey: `e2e/coc-ledger/${document.id}`,
          contentHash: 'c'.repeat(64),
          mimeType: 'application/pdf',
          sizeBytes: 1,
          issuedAt: new Date(),
          createdByMembershipId: marisol.id,
        },
      });
      await transaction.document.update({
        where: { id: document.id },
        data: { currentVersionId: version.id },
      });
      return { name, authorityNo, authorityId: authority.id, versionId: version.id };
    });
  });
}

async function openAccount(page: Page, name: string): Promise<void> {
  await page.goto('/coc-accounts');
  await page.getByLabel('Search Employee').fill(name);
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
}

test('adjusts COC with evidence, reverses the adjustment, and shows the balance change', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await seedEarnedCoc(Date.now());
  await signIn(page, MARISOL_EMAIL);

  // The destination sits under Overtime, and the register shows today's balance.
  await page.goto('/coc-accounts');
  await page.getByLabel('Search Employee').fill(fixture.name);
  await expect(page.getByRole('row').filter({ hasText: fixture.name })).toContainText(
    '120 minutes',
  );

  await openAccount(page, fixture.name);
  const balance = page.getByRole('definition').first();
  await expect(balance).toHaveText('120 minutes');
  const ledger = page.getByRole('region', { name: 'COC ledger' });
  const entry = (no: number) => ledger.getByRole('row', { name: `Entry ${no} Effective` });
  await expect(entry(1)).toContainText('Earned');
  await expect(entry(1)).toContainText('120');
  // The earned entry links back to its authority's Compensation tab.
  await expect(
    entry(1).getByRole('link', { name: `${fixture.authorityNo} Compensation` }),
  ).toHaveAttribute('href', new RegExp(`tab=compensation&record=${fixture.authorityId}`));

  // An adjustment needs evidence; the API refuses one that is not a Document Version.
  const adjust = page.getByRole('form', { name: 'Adjust COC' });
  await adjust.getByLabel('Minutes to deduct').fill('30');
  await adjust.getByLabel('Reason').fill('Overtime rendered on a suspended workday.');
  await adjust.getByLabel('Supporting Document Version').fill(randomUUID());
  await adjust.getByRole('button', { name: 'Post adjustment' }).click();
  await expect(page.getByRole('alert').first()).toContainText(
    'The supporting evidence must be a finalized Document Version of this Agency.',
  );
  await expect(balance).toHaveText('120 minutes');

  // With finalized evidence, a double click posts once.
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/coc-accounts/'))
      posts.push(request.url());
  });
  await adjust.getByLabel('Supporting Document Version').fill(fixture.versionId);
  await adjust.getByRole('button', { name: 'Post adjustment' }).dblclick();
  await expect(
    page.getByRole('status').filter({ hasText: 'The adjustment was posted.' }),
  ).toBeVisible();
  expect(posts).toHaveLength(1);
  await expect(balance).toHaveText('90 minutes');
  await expect(entry(2)).toContainText('Adjusted');
  await expect(entry(2)).toContainText('-30');
  await expect(entry(2)).toContainText('Overtime rendered on a suspended workday.');
  await expect(entry(2)).toContainText(fixture.versionId);
  // An earned entry is not reversible here.
  await expect(entry(1).getByRole('button', { name: 'Reverse entry 1' })).toHaveCount(0);

  // Reversing restores the same minutes, and each entry links to the other.
  await entry(2).getByRole('button', { name: 'Reverse entry 2' }).click();
  const reverse = page.getByRole('form', { name: 'Reverse entry 2' });
  await expect(reverse).toContainText('Restores 30 minutes');
  await reverse.getByLabel('Reason').fill('The workday was not suspended after all.');
  await reverse.getByLabel('Supporting Document Version').fill(fixture.versionId);
  await reverse.getByRole('button', { name: 'Post reversal' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Entry 2 was reversed.' })).toBeVisible();
  await expect(balance).toHaveText('120 minutes');
  await expect(entry(3)).toContainText('Reversal');
  await expect(entry(3)).toContainText('30');
  await expect(entry(2).getByRole('link', { name: 'Reversed by entry 3' })).toHaveAttribute(
    'href',
    /#coc-entry-/,
  );
  await expect(entry(3).getByRole('link', { name: 'Reverses entry 2' })).toBeVisible();
  await expect(entry(2).getByRole('button', { name: 'Reverse entry 2' })).toHaveCount(0);

  // The register shows the restored balance.
  await page.getByRole('tab', { name: 'Tree' }).click();
  await expect(page.getByRole('row').filter({ hasText: fixture.name })).toContainText(
    '120 minutes',
  );

  // Following the earned entry's link opens the authority on its Compensation tab.
  await openAccount(page, fixture.name);
  await entry(1)
    .getByRole('link', { name: `${fixture.authorityNo} Compensation` })
    .click();
  await expect(page.getByRole('heading', { level: 2, name: fixture.authorityNo })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Compensation' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
