import { Prisma, PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { PersonnelSalaryFactsService } from '../personnel-salary-facts/personnel-salary-facts.service';
import { CompensationBasisService } from './compensation-basis.service';

const enabled = process.env.DATABASE_E2E === 'true';

// Test fixtures only: the rates are not from any issuance, the codes carry a
// prefix the cleanup removes, and the 2870 dates sit past every other fixture.
const prefix = 'TEST-332-';

it.skipIf(!enabled)(
  'resolves grade, step, and schedule changes inside one period and refuses another Agency',
  async () => {
    const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
    if (!url) throw new Error('A database owner URL is required for the integration test.');
    const admin = new PrismaClient({ datasources: { db: { url } } });
    const suffix = `${Date.now()}-compensation-basis`;
    const agencyIds: string[] = [];
    let userId = '';

    const loadSchedule = (
      label: string,
      effectiveFrom: string,
      supersedesRuleVersionId: string | null,
      rates: [number, number, string][],
    ) =>
      // A schedule's rates are admitted only in the transaction that inserts it.
      admin.$transaction(async (transaction) => {
        const version = await transaction.nationalPayrollRuleVersion.create({
          data: {
            ruleKind: 'SALARY_SCHEDULE',
            code: `${prefix}${label}-${suffix}`,
            name: `Test salary schedule ${label}`,
            issuingAuthority: 'Test authority',
            issuanceReference: 'Test fixture, not an issuance',
            sourceUrl: 'https://example.test/salary-schedule',
            verifiedOn: new Date('2026-11-15'),
            verifiedBy: 'LingkodHR test fixture',
            effectiveFrom: new Date(effectiveFrom),
            effectiveTo: new Date('2870-12-31'),
            supersedesRuleVersionId,
          },
        });
        await transaction.salaryGradeRate.createMany({
          data: rates.map(([salaryGrade, salaryStep, monthlyRate]) => ({
            ruleVersionId: version.id,
            salaryGrade,
            salaryStep,
            monthlyRate: new Prisma.Decimal(monthlyRate),
          })),
        });
        return version;
      });

    try {
      const [agency, foreignAgency] = await Promise.all(
        ['CB', 'CB-F'].map((code) =>
          admin.agency.create({
            data: {
              code: `${code}-${suffix}`,
              name: `Compensation Basis Agency ${code}`,
              agencyType: 'NGA',
              status: 'ACTIVE',
            },
          }),
        ),
      );
      agencyIds.push(agency!.id, foreignAgency!.id);
      const agencyId = agency!.id;
      const foreignAgencyId = foreignAgency!.id;
      const user = await admin.user.create({
        data: {
          emailNormalized: `compensation-basis-${suffix}@example.test`,
          displayName: 'Compensation Basis Reader',
          globalStatus: 'ACTIVE',
        },
      });
      userId = user.id;
      const membership = await admin.agencyMembership.create({
        data: { agencyId, userId, status: 'ACTIVE' },
      });
      const foreignMembership = await admin.agencyMembership.create({
        data: { agencyId: foreignAgencyId, userId, status: 'ACTIVE' },
      });
      const unit = await admin.organizationUnit.create({
        data: { agencyId, code: `UNIT-${suffix}`, unitType: 'DIVISION', status: 'ACTIVE' },
      });
      const employee = await admin.employee.create({
        data: {
          agencyId,
          employeeNumber: `EMP-${suffix}`,
          legalName: 'Maria Santos',
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `maria-${suffix}@example.test`,
          serviceStatus: 'ACTIVE',
          createdByMembershipId: membership.id,
          updatedByMembershipId: membership.id,
        },
      });

      // A step increment on 10 March and a promotion on 20 March.
      const segmentData = {
        agencyId,
        employeeId: employee.id,
        organizationUnitId: unit.id,
        appointmentStatus: 'PERMANENT',
        createdByMembershipId: membership.id,
      };
      const [stepOne, stepTwo, promoted] = await withDatabaseContext(
        {
          agencyId,
          userId,
          membershipId: membership.id,
          capabilities: ['personnel-baseline-transition'],
        },
        async (transaction) => [
          await transaction.serviceSegment.create({
            data: {
              ...segmentData,
              salaryGrade: 11,
              salaryStep: 1,
              effectiveFrom: new Date('2870-01-01'),
              effectiveTo: new Date('2870-03-09'),
              status: 'CLOSED',
            },
          }),
          await transaction.serviceSegment.create({
            data: {
              ...segmentData,
              salaryGrade: 11,
              salaryStep: 2,
              effectiveFrom: new Date('2870-03-10'),
              effectiveTo: new Date('2870-03-19'),
              status: 'CLOSED',
            },
          }),
          await transaction.serviceSegment.create({
            data: {
              ...segmentData,
              salaryGrade: 13,
              salaryStep: 2,
              effectiveFrom: new Date('2870-03-20'),
              status: 'ACTIVE',
            },
          }),
        ],
      );

      // A corrected schedule replaces the first from 25 March.
      const first = await loadSchedule('A', '2870-01-01', null, [
        [11, 1, '30000'],
        [11, 2, '30500'],
        [13, 2, '36000'],
      ]);
      const corrected = await loadSchedule('B', '2870-03-25', first.id, [[13, 2, '37000']]);

      const service = new CompensationBasisService(new PersonnelSalaryFactsService());
      const context = (agency: string, membershipId: string): RequestContext => ({
        requestId: `compensation-basis-${suffix}`,
        userId,
        agencyId: agency,
        membershipId,
        primaryOrganizationUnitId: null,
        permissions: [{ code: 'payroll.compensation.read', scopePolicy: 'AGENCY' }],
      });
      const home = context(agencyId, membership.id);
      const missingPayBasis = [expect.objectContaining({ code: 'MISSING_PAY_BASIS' })];
      const stretch = (
        from: string,
        to: string,
        segment: { id: string; salaryGrade: number | null; salaryStep: number | null },
        schedule: { id: string; code: string },
        monthlyRate: string,
      ) => ({
        status: 'INDETERMINATE',
        from,
        to,
        personnel: {
          serviceSegmentId: segment.id,
          salaryGrade: segment.salaryGrade,
          salaryStep: segment.salaryStep,
          payBasis: null,
          employmentFraction: null,
        },
        salarySchedule: { ruleVersionId: schedule.id, ruleVersionCode: schedule.code, monthlyRate },
        reasons: missingPayBasis,
      });

      // Personnel records no pay basis yet (#619), so every stretch shows its
      // grade, step, and rate with their sources but stays INDETERMINATE.
      await expect(service.read(home, employee.id, '2870-03-01', '2870-03-31')).resolves.toEqual({
        employeeId: employee.id,
        from: '2870-03-01',
        to: '2870-03-31',
        status: 'INDETERMINATE',
        stretches: [
          stretch('2870-03-01', '2870-03-09', stepOne!, first, '30000'),
          stretch('2870-03-10', '2870-03-19', stepTwo!, first, '30500'),
          stretch('2870-03-20', '2870-03-24', promoted!, first, '36000'),
          stretch('2870-03-25', '2870-03-31', promoted!, corrected, '37000'),
        ],
      });

      // Past the last schedule, and before the first Service Segment.
      const edges = await service.read(home, employee.id, '2870-12-31', '2871-01-01');
      expect(edges.stretches).toEqual([
        stretch('2870-12-31', '2870-12-31', promoted!, corrected, '37000'),
        {
          status: 'INDETERMINATE',
          from: '2871-01-01',
          to: '2871-01-01',
          personnel: expect.objectContaining({ serviceSegmentId: promoted!.id }),
          salarySchedule: null,
          reasons: [
            expect.objectContaining({ code: 'MISSING_PAY_BASIS' }),
            expect.objectContaining({ code: 'MISSING_SALARY_SCHEDULE' }),
          ],
        },
      ]);
      const before = await service.read(home, employee.id, '2869-12-31', '2869-12-31');
      expect(before.stretches).toEqual([
        expect.objectContaining({
          personnel: null,
          reasons: [expect.objectContaining({ code: 'NO_SERVICE_SEGMENT' })],
        }),
      ]);

      // Migration 0160 grants the read to the baseline roles that exist (controls §6.10).
      const grants = await admin.rolePermission.findMany({
        where: { permission: { code: 'payroll.compensation.read' }, role: { agencyId: null } },
        select: { scopePolicy: true, role: { select: { code: true } } },
      });
      expect(grants.map((grant) => `${grant.role.code}:${grant.scopePolicy}`).sort()).toEqual([
        'internal_auditor:AGENCY',
        'payroll_preparer:AGENCY',
      ]);

      // Another Agency's reader cannot resolve the Employee, even naming its Agency.
      const foreign = context(foreignAgencyId, foreignMembership.id);
      await expect(
        service.read(foreign, employee.id, '2870-03-01', '2870-03-31'),
      ).rejects.toMatchObject({ code: 'PERSONNEL_SALARY_FACTS_EMPLOYEE_NOT_FOUND' });
      await expect(
        withDatabaseContext(
          { agencyId: foreignAgencyId, userId, membershipId: foreignMembership.id },
          (transaction) =>
            service.resolveInTransaction(
              transaction,
              agencyId,
              employee.id,
              '2870-03-01',
              '2870-03-31',
            ),
        ),
      ).rejects.toMatchObject({ code: 'PERSONNEL_SALARY_FACTS_EMPLOYEE_NOT_FOUND' });
    } finally {
      await admin.$transaction(async (transaction) => {
        // The rule version immutability triggers are the point; only the test lifts them.
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.$executeRaw`DELETE FROM salary_grade_rates WHERE rule_version_id IN (SELECT id FROM national_payroll_rule_versions WHERE code LIKE ${`${prefix}%-${suffix}`})`;
        await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code LIKE ${`${prefix}%-${suffix}`}`;
      });
      for (const agencyId of agencyIds) {
        await admin.$transaction(async (transaction) => {
          await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
          await transaction.serviceSegment.deleteMany({ where: { agencyId } });
          await transaction.employee.deleteMany({ where: { agencyId } });
          await transaction.organizationUnit.deleteMany({ where: { agencyId } });
          await transaction.agencyMembership.deleteMany({ where: { agencyId } });
        });
        await admin.agency.delete({ where: { id: agencyId } });
      }
      if (userId) await admin.user.delete({ where: { id: userId } });
      await admin.$disconnect();
    }
  },
);
