import { PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

/**
 * docs/hris-controls.md §8.2: Supervisor access does not automatically include
 * full PDS sensitive fields, bank details, government identifier values or
 * SALN content. Since a PDS read_sensitive grant now reaches every Employee its
 * scope covers, Direct Reports included, the supervisor role template must
 * hold none of these permissions at any scope.
 */
const excludedPermissionCodes = [
  'personnel.pds.read_sensitive',
  'payroll.bank_accounts.read',
  'payroll.bank_accounts.reveal',
  'payroll.bank_accounts.history.read',
  'payroll.bank_accounts.manage',
  'personnel.identifiers.reveal',
  'personnel.identifiers.manage',
];
// No permission reads SALN content today; any future one belongs under this prefix.
const salnContentPrefix = 'personnel.saln.';

it.skipIf(!enabled)('keeps §8.2 exclusions out of the supervisor role template', async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for the integration test.');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const known = await prisma.permission.findMany({
      where: { code: { in: excludedPermissionCodes } },
      select: { code: true },
    });
    expect(known.map((permission) => permission.code).sort()).toEqual(
      [...excludedPermissionCodes].sort(),
    );

    const grants = await prisma.rolePermission.findMany({
      where: { role: { code: 'supervisor', isSystemTemplate: true } },
      select: { scopePolicy: true, permission: { select: { code: true } } },
    });
    expect(grants.length).toBeGreaterThan(0);
    const excluded = grants
      .map((grant) => grant.permission.code)
      .filter(
        (code) => excludedPermissionCodes.includes(code) || code.startsWith(salnContentPrefix),
      );
    expect(excluded).toEqual([]);
  } finally {
    await prisma.$disconnect();
  }
});
