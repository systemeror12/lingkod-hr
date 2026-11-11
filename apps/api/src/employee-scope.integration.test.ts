import type { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { createAdminClient } from './attendance-test-fixtures';
import { requestDatabaseContext } from './database-context';
import { ownEmployeeId, resolveEmployeeScope, type EmployeeScope } from './employee-scope';
import {
  addMember,
  cleanup,
  createAgency,
  enabled,
  type AgencyFixture,
} from './overtime-authorities/overtime-authority-test-fixtures';

const PERMISSION = 'employee_scope.test.read';

type ScopePolicy = RequestContext['permissions'][number]['scopePolicy'];

/**
 * Two Agencies built by the Overtime Authority fixture, plus a child unit under
 * the home division: its head reports to the division chief, its member does
 * not (one level only).
 */
async function withAgencies(
  label: string,
  run: (fixture: {
    admin: PrismaClient;
    suffix: string;
    home: AgencyFixture;
    foreign: AgencyFixture;
    childHead: { id: string };
  }) => Promise<void>,
) {
  const admin = await createAdminClient();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-scope-${label}`;
  const home = await createAgency(admin, suffix, `${label}H`);
  const foreign = await createAgency(admin, suffix, `${label}F`);
  try {
    const { childHead } = await addChildUnit(admin, home, suffix);
    await run({ admin, suffix, home, foreign, childHead });
  } finally {
    await cleanup(admin, [home.agency.id, foreign.agency.id], suffix);
    await admin.$disconnect();
  }
}

async function addChildUnit(admin: PrismaClient, home: AgencyFixture, suffix: string) {
  const agencyId = home.agency.id;
  const headPosition = await home.asReplica((transaction) =>
    transaction.plantillaPosition.create({
      data: {
        agencyId,
        itemNumber: `CHILD-HEAD-${suffix}`,
        status: 'OCCUPIED',
        createdByMembershipId: home.membership.id,
        updatedByMembershipId: home.membership.id,
      },
    }),
  );
  const unit = await admin.organizationUnit.create({
    data: { agencyId, code: `CHILD-${suffix}`, unitType: 'SECTION', status: 'ACTIVE' },
  });
  const version = await admin.organizationUnitVersion.create({
    data: {
      agencyId,
      organizationUnitId: unit.id,
      versionNo: 1,
      name: 'Child',
      parentUnitId: home.division.id,
      headPositionId: headPosition.id,
      effectiveFrom: new Date('2020-01-01'),
      status: 'ACTIVE',
      domainStatus: 'ACTIVE',
    },
  });
  await admin.organizationUnit.update({
    where: { id: unit.id },
    data: { currentVersionId: version.id },
  });
  const employee = (name: string, number: string) =>
    admin.employee.create({
      data: {
        agencyId,
        employeeNumber: `SCOPE-${number}-${suffix}`,
        legalName: name,
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `scope-${number.toLowerCase()}-${suffix}@example.test`,
        serviceStatus: 'ACTIVE',
        createdByMembershipId: home.membership.id,
        updatedByMembershipId: home.membership.id,
      },
    });
  const childHead = await employee('Cora Child Head', 'CH');
  const childMember = await employee('Remy Child Member', 'CM');
  await withDatabaseContext(
    {
      agencyId,
      membershipId: home.membership.id,
      capabilities: ['personnel-baseline-transition'],
    },
    async (transaction) => {
      for (const [employeeId, positionId] of [
        [childHead.id, headPosition.id],
        [childMember.id, null],
      ] as const) {
        const segment = await transaction.serviceSegment.create({
          data: {
            agencyId,
            employeeId,
            organizationUnitId: unit.id,
            positionId,
            appointmentStatus: 'PERMANENT',
            salaryGrade: 18,
            salaryStep: 1,
            effectiveFrom: new Date('2020-01-01'),
            status: 'ACTIVE',
            createdByMembershipId: home.membership.id,
          },
        });
        if (positionId) {
          await transaction.positionIncumbency.create({
            data: {
              agencyId,
              positionId,
              employeeId,
              serviceSegmentId: segment.id,
              effectiveFrom: new Date('2020-01-01'),
              status: 'ACTIVE',
              createdByMembershipId: home.membership.id,
            },
          });
        }
      }
    },
  );
  return { childHead };
}

let actorSequence = 0;

/** A new Agency Membership holding `policies` on the test permission, optionally linked to an Employee. */
async function actor(
  admin: PrismaClient,
  home: AgencyFixture,
  suffix: string,
  policies: ScopePolicy[],
  options: { employeeId?: string; primaryOrganizationUnitId?: string } = {},
): Promise<RequestContext> {
  actorSequence += 1;
  const context = await addMember(
    admin,
    home,
    suffix,
    `scope-actor-${actorSequence}`,
    'employee',
    policies.map((scopePolicy) => ({ code: PERMISSION, scopePolicy })),
  );
  if (options.employeeId) {
    const employeeId = options.employeeId;
    await withDatabaseContext(
      {
        agencyId: home.agency.id,
        userId: home.user.id,
        membershipId: home.membership.id,
        capabilities: ['employee-membership-link'],
      },
      async (transaction) => {
        // An Employee links to one membership at a time; move it to the new one.
        await transaction.agencyMembership.updateMany({
          where: { agencyId: home.agency.id, employeeId },
          data: { employeeId: null },
        });
        await transaction.agencyMembership.update({
          where: { agencyId_id: { agencyId: home.agency.id, id: context.membershipId } },
          data: { employeeId },
        });
      },
    );
  }
  return { ...context, primaryOrganizationUnitId: options.primaryOrganizationUnitId ?? null };
}

function resolve(context: RequestContext) {
  return withDatabaseContext(requestDatabaseContext(context), (transaction) =>
    resolveEmployeeScope(transaction, context, PERMISSION),
  );
}

/** The scope with its Employee ids sorted, so a set compares by content. */
function sorted(scope: EmployeeScope) {
  return scope.kind === 'SCOPED' ? { ...scope, employeeIds: [...scope.employeeIds].sort() } : scope;
}

function employees(...ids: string[]): EmployeeScope {
  return { kind: 'SCOPED', employeeIds: [...ids].sort() };
}

it.skipIf(!enabled)(
  'resolves each scope policy to the Employees it reaches',
  () =>
    withAgencies('policies', async ({ admin, suffix, home, childHead }) => {
      // No grant for the permission.
      const unrelated = await actor(admin, home, suffix, []);
      expect(await resolve(unrelated)).toEqual({ kind: 'NONE' });

      expect(await resolve(await actor(admin, home, suffix, ['AGENCY']))).toEqual({
        kind: 'AGENCY',
      });

      const own = await actor(admin, home, suffix, ['OWN'], { employeeId: home.member.id });
      expect(sorted(await resolve(own))).toEqual(employees(home.member.id));

      // A membership with no linked Employee has no own Employee.
      const unlinked = await actor(admin, home, suffix, ['OWN']);
      expect(await resolve(unlinked)).toEqual(employees());

      // The chief's Direct Reports: the division's members and the child unit's
      // head, but not the chief, the child unit's member, or another division.
      const supervisor = await actor(admin, home, suffix, ['DIRECT_REPORTS'], {
        employeeId: home.chief.id,
      });
      expect(sorted(await resolve(supervisor))).toEqual(
        employees(home.member.id, home.leaver.id, childHead.id),
      );

      // Active Service Segments in the primary Organization Unit; the leaver's is closed.
      const office = await actor(admin, home, suffix, ['ASSIGNED_OFFICE'], {
        primaryOrganizationUnitId: home.division.id,
      });
      expect(sorted(await resolve(office))).toEqual(employees(home.chief.id, home.member.id));
      // No primary Organization Unit, no office.
      expect(await resolve(await actor(admin, home, suffix, ['ASSIGNED_OFFICE']))).toEqual(
        employees(),
      );

      const restricted = await actor(admin, home, suffix, ['RESTRICTED'], {
        employeeId: home.chief.id,
        primaryOrganizationUnitId: home.division.id,
      });
      expect(await resolve(restricted)).toEqual(employees());
    }),
  120_000,
);

it.skipIf(!enabled)(
  'unites combined grants, and an AGENCY grant wins over narrower ones',
  () =>
    withAgencies('combined', async ({ admin, suffix, home, childHead }) => {
      const combined = await actor(admin, home, suffix, ['OWN', 'DIRECT_REPORTS', 'RESTRICTED'], {
        employeeId: home.chief.id,
      });
      expect(sorted(await resolve(combined))).toEqual(
        employees(home.chief.id, home.member.id, home.leaver.id, childHead.id),
      );

      const officeAndOwn = await actor(admin, home, suffix, ['OWN', 'ASSIGNED_OFFICE'], {
        employeeId: home.outsider.id,
        primaryOrganizationUnitId: home.division.id,
      });
      expect(sorted(await resolve(officeAndOwn))).toEqual(
        employees(home.chief.id, home.member.id, home.outsider.id),
      );

      const agencyWide = await actor(
        admin,
        home,
        suffix,
        ['OWN', 'DIRECT_REPORTS', 'ASSIGNED_OFFICE', 'RESTRICTED', 'AGENCY'],
        { employeeId: home.chief.id, primaryOrganizationUnitId: home.division.id },
      );
      expect(await resolve(agencyWide)).toEqual({ kind: 'AGENCY' });
    }),
  120_000,
);

it.skipIf(!enabled)(
  "never reaches another Agency's Employees",
  () =>
    withAgencies('isolation', async ({ admin, suffix, home, foreign }) => {
      // Pointing the primary Organization Unit at another Agency's division reaches nobody.
      const office = await actor(admin, home, suffix, ['ASSIGNED_OFFICE'], {
        primaryOrganizationUnitId: foreign.division.id,
      });
      expect(await resolve(office)).toEqual(employees());

      // Another Agency's chief has a division of Direct Reports, none of which appear here.
      const supervisor = await actor(admin, home, suffix, ['OWN', 'DIRECT_REPORTS'], {
        employeeId: home.chief.id,
      });
      const scope = await resolve(supervisor);
      const foreignIds = [foreign.chief.id, foreign.member.id, foreign.leaver.id];
      expect(scope.kind).toBe('SCOPED');
      if (scope.kind === 'SCOPED') {
        expect(scope.employeeIds.filter((id) => foreignIds.includes(id))).toEqual([]);
      }

      // A context naming another Agency's membership finds no own Employee here.
      const foreignLinked = await actor(admin, foreign, suffix, ['OWN'], {
        employeeId: foreign.member.id,
      });
      const crossed = { ...foreignLinked, agencyId: home.agency.id };
      expect(
        await withDatabaseContext(requestDatabaseContext(crossed), (transaction) =>
          ownEmployeeId(transaction, crossed),
        ),
      ).toBeNull();
      expect(
        await withDatabaseContext(requestDatabaseContext(foreignLinked), (transaction) =>
          ownEmployeeId(transaction, foreignLinked),
        ),
      ).toBe(foreign.member.id);
    }),
  120_000,
);
