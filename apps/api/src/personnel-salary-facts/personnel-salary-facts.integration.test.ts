import { PrismaClient } from '@prisma/client';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { PersonnelSalaryFactsService } from './personnel-salary-facts.service';

const enabled = process.env.DATABASE_E2E === 'true';

it.skipIf(!enabled)(
  'reads salary facts per Service Segment on real PostgreSQL and refuses another Agency',
  async () => {
    const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
    if (!url) throw new Error('A database owner URL is required for the integration test.');
    const admin = new PrismaClient({ datasources: { db: { url } } });
    const suffix = `${Date.now()}-salary-facts`;
    const agencyIds: string[] = [];
    let userId = '';

    try {
      const [agency, foreignAgency] = await Promise.all(
        ['SF', 'SF-F'].map((code) =>
          admin.agency.create({
            data: {
              code: `${code}-${suffix}`,
              name: `Salary Facts Agency ${code}`,
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
          emailNormalized: `salary-facts-${suffix}@example.test`,
          displayName: 'Salary Facts Reader',
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
          legalName: 'Juan Dela Cruz',
          birthDate: new Date('1990-01-01'),
          sex: 'MALE',
          civilStatus: 'SINGLE',
          contactEmail: `juan-${suffix}@example.test`,
          serviceStatus: 'ACTIVE',
          createdByMembershipId: membership.id,
          updatedByMembershipId: membership.id,
        },
      });

      const segmentData = {
        agencyId,
        employeeId: employee.id,
        organizationUnitId: unit.id,
        appointmentStatus: 'PERMANENT',
        salaryGrade: 11,
        createdByMembershipId: membership.id,
      };
      const [stepOne, stepTwo] = await withDatabaseContext(
        {
          agencyId,
          userId,
          membershipId: membership.id,
          capabilities: ['personnel-baseline-transition'],
        },
        async (transaction) => {
          const first = await transaction.serviceSegment.create({
            data: {
              ...segmentData,
              salaryStep: 1,
              effectiveFrom: new Date('2026-01-01'),
              effectiveTo: new Date('2026-03-14'),
              status: 'CLOSED',
            },
          });
          const second = await transaction.serviceSegment.create({
            data: {
              ...segmentData,
              salaryStep: 2,
              effectiveFrom: new Date('2026-03-15'),
              status: 'ACTIVE',
            },
          });
          // A voided correction overlapping both must never be read.
          await transaction.serviceSegment.create({
            data: {
              ...segmentData,
              salaryStep: 9,
              effectiveFrom: new Date('2025-06-01'),
              status: 'VOIDED',
            },
          });
          return [first, second];
        },
      );

      const service = new PersonnelSalaryFactsService();
      const read = (from: string, to: string) =>
        withDatabaseContext({ agencyId, userId, membershipId: membership.id }, (transaction) =>
          service.readInTransaction(transaction, agencyId, employee.id, from, to),
        );
      const facts = (id: string, from: string, to: string, salaryStep: number) => ({
        status: 'IN_SERVICE',
        from,
        to,
        serviceSegmentId: id,
        salaryGrade: 11,
        salaryStep,
        payBasis: null,
        employmentFraction: null,
      });

      await expect(read('2026-03-01', '2026-03-31')).resolves.toEqual([
        facts(stepOne!.id, '2026-03-01', '2026-03-14', 1),
        facts(stepTwo!.id, '2026-03-15', '2026-03-31', 2),
      ]);
      await expect(read('2025-12-20', '2026-01-10')).resolves.toEqual([
        { status: 'NO_SERVICE_SEGMENT', from: '2025-12-20', to: '2025-12-31' },
        facts(stepOne!.id, '2026-01-01', '2026-01-10', 1),
      ]);
      await expect(read('2025-07-01', '2025-07-01')).resolves.toEqual([
        { status: 'NO_SERVICE_SEGMENT', from: '2025-07-01', to: '2025-07-01' },
      ]);

      await expect(
        withDatabaseContext(
          { agencyId: foreignAgencyId, userId, membershipId: foreignMembership.id },
          (transaction) =>
            service.readInTransaction(
              transaction,
              foreignAgencyId,
              employee.id,
              '2026-03-01',
              '2026-03-31',
            ),
        ),
      ).rejects.toMatchObject({ code: 'PERSONNEL_SALARY_FACTS_EMPLOYEE_NOT_FOUND' });
      // Row-level security hides the Employee even if a caller passes the wrong Agency.
      await expect(
        withDatabaseContext(
          { agencyId: foreignAgencyId, userId, membershipId: foreignMembership.id },
          (transaction) =>
            service.readInTransaction(
              transaction,
              agencyId,
              employee.id,
              '2026-03-01',
              '2026-03-31',
            ),
        ),
      ).rejects.toMatchObject({ code: 'PERSONNEL_SALARY_FACTS_EMPLOYEE_NOT_FOUND' });
    } finally {
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
