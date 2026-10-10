import { PrismaClient } from '@prisma/client';
import { getConfig } from '@lingkod-hr/config';
import { expect, test, type Request } from '@playwright/test';
import { signIn } from './sign-in';

// Seeded in the National Archives Coordination Office.
const securityOfficer = 'security.officer@example.test';
const pageSize = 50;
// Named to sort after every seeded member, so the Factor Reset and lock journeys stay on page one.
const pagingMembers = Array.from({ length: pageSize }, (_, index) => {
  const number = String(index + 1).padStart(2, '0');
  return {
    email: `paging.member.${number}@example.test`,
    displayName: `Zeta Paging Member ${number}`,
  };
});
const lastPagingMember = pagingMembers.at(-1)?.displayName ?? '';

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

/** Gives the Agency more members than one page holds; each run restores them to ACTIVE. */
async function seedPagingMembers(): Promise<void> {
  await withAdmin(async (admin) => {
    const agency = await admin.agency.findFirstOrThrow({
      where: { name: 'National Archives Coordination Office' },
    });
    for (const fixture of pagingMembers) {
      const user = await admin.user.upsert({
        where: { emailNormalized: fixture.email },
        update: {
          displayName: fixture.displayName,
          globalStatus: 'ACTIVE',
          lockedAt: null,
          lockedByAgencyId: null,
        },
        create: {
          emailNormalized: fixture.email,
          displayName: fixture.displayName,
          globalStatus: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
      });
      if (
        !(await admin.agencyMembership.findFirst({
          where: { agencyId: agency.id, userId: user.id },
        }))
      )
        await admin.agencyMembership.create({
          data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE', activatedAt: new Date() },
        });
    }
  });
}

// A cold dev server compiles the pages.
test.describe.configure({ timeout: 120_000 });

test('a Security Administrator pages through the members and locks one on the second page', async ({
  page,
}) => {
  await seedPagingMembers();
  await signIn(page, securityOfficer, { fresh: true });
  await page.goto('/users-access');
  const rows = page.getByRole('region', { name: 'Members' }).locator('tbody tr');
  await expect(rows).toHaveCount(pageSize);
  await expect(page.getByRole('row', { name: new RegExp(lastPagingMember) })).toHaveCount(0);

  // Hold the second page so the in-flight state is observable, and count every request for it.
  const pageRequests: Request[] = [];
  page.on('request', (request) => {
    if (/\/api\/v1\/agencies\/[^/]+\/members\?cursor=/.test(request.url()))
      pageRequests.push(request);
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/api\/v1\/agencies\/[^/]+\/members\?cursor=/, async (route) => {
    await held;
    await route.continue();
  });

  const loadMore = page.getByRole('button', { name: 'Load more members' });
  await loadMore.dblclick();
  const loading = page.getByRole('button', { name: 'Loading…' });
  await expect(loading).toBeDisabled();
  release();

  const row = page.getByRole('row', { name: new RegExp(lastPagingMember) });
  await expect(row).toBeVisible();
  expect(pageRequests).toHaveLength(1);
  await expect(rows).not.toHaveCount(pageSize);
  const loaded = await rows.count();
  await expect(page.getByRole('button', { name: /Load more members|Loading…/ })).toHaveCount(0);

  // Lock and unlock refresh the row in place and keep both pages loaded.
  await row.getByRole('button', { name: 'Lock account' }).click();
  const lock = page.getByRole('dialog', { name: 'Lock account' });
  await lock.getByLabel('Reason').fill('Paging journey: sign-ins from an unrecognized device.');
  await lock.getByRole('button', { name: 'Lock account' }).click();
  await expect(page.getByRole('status')).toContainText(
    `${lastPagingMember}’s account is locked in every Agency`,
  );
  await expect(row.getByText('Locked', { exact: true })).toBeVisible();
  await expect(rows).toHaveCount(loaded);

  await row.getByRole('button', { name: 'Unlock account' }).click();
  const unlock = page.getByRole('dialog', { name: 'Unlock account' });
  await unlock.getByLabel('Reason').fill('Paging journey: the User confirmed the device.');
  await unlock.getByRole('button', { name: 'Unlock account' }).click();
  await expect(page.getByRole('status')).toContainText(
    `${lastPagingMember}’s account is unlocked.`,
  );
  await expect(row.getByRole('button', { name: 'Lock account' })).toBeVisible();
  await expect(rows).toHaveCount(loaded);
});
