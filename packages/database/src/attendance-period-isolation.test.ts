import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

async function adminClient(): Promise<PrismaClient> {
  const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!url) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url } } });
}

async function withContext<T>(
  client: PrismaClient,
  values: {
    agencyId: string;
    userId: string;
    membershipId: string;
    attendanceTransition?: boolean;
  },
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      "SELECT set_config('app.agency_id', '" +
        values.agencyId +
        "', true), set_config('app.user_id', '" +
        values.userId +
        "', true), set_config('app.membership_id', '" +
        values.membershipId +
        "', true), set_config('app.attendance_transition', '" +
        (values.attendanceTransition ? 'on' : '') +
        "', true)",
    );
    return work(transaction);
  });
}

it.skipIf(!enabled)(
  'freezes the stable Attendance Period interval and moves status only forward through the owning service',
  async () => {
    const runtimeUrl = process.env.DATABASE_URL;
    if (!runtimeUrl) throw new Error('DATABASE_URL is required for the integration test.');
    const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
    const admin = await adminClient();
    const suffix = String(Date.now()) + '-period';
    const agencies = await Promise.all(
      ['A', 'B'].map((label) =>
        admin.agency.create({
          data: {
            code: 'PERIOD-RLS-' + label + '-' + suffix,
            name: 'Attendance Period RLS ' + label,
            agencyType: 'NGA',
            status: 'ACTIVE',
          },
        }),
      ),
    );
    const agencyA = agencies[0]!;
    const agencyB = agencies[1]!;
    const user = await admin.user.create({
      data: {
        emailNormalized: 'attendance-period-' + suffix + '@example.test',
        displayName: 'Attendance Period RLS User',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agencyA.id, userId: user.id, status: 'ACTIVE' },
    });
    const period = await admin.attendancePeriod.create({
      data: {
        agencyId: agencyA.id,
        code: 'PERIOD-RLS-' + suffix,
        dateFrom: new Date('2026-01-05'),
        dateTo: new Date('2026-01-05'),
      },
    });
    const request = { agencyId: agencyA.id, userId: user.id, membershipId: membership.id };
    const transition = { ...request, attendanceTransition: true };
    const update = (
      values: typeof request & { attendanceTransition?: boolean },
      data: Prisma.AttendancePeriodUpdateManyMutationInput,
    ) =>
      withContext(app, values, (transaction) =>
        transaction.attendancePeriod.updateMany({ where: { id: period.id }, data }),
      );

    try {
      await expect(update(request, { status: 'FINALIZED' })).rejects.toThrow(
        /requires the owning application service/i,
      );
      await expect(update(transition, { status: 'FINALIZED' })).resolves.toEqual({ count: 1 });

      // The #10 review: an ordinary request context widened date_to after finalization.
      await expect(update(request, { dateTo: new Date('2026-01-31') })).rejects.toThrow(
        /immutable/i,
      );
      await expect(update(transition, { dateTo: new Date('2026-01-31') })).rejects.toThrow(
        /immutable/i,
      );
      await expect(update(transition, { dateFrom: new Date('2026-01-01') })).rejects.toThrow(
        /immutable/i,
      );
      await expect(update(transition, { code: 'PERIOD-RLS-MOVED-' + suffix })).rejects.toThrow(
        /immutable/i,
      );
      await expect(update(transition, { agencyId: agencyB.id })).rejects.toThrow(/immutable/i);

      // A finalized period never reopens, whoever asks.
      await expect(update(request, { status: 'OPEN' })).rejects.toThrow(/never reopens/i);
      await expect(update(transition, { status: 'OPEN' })).rejects.toThrow(/never reopens/i);

      const retained = await admin.attendancePeriod.findUniqueOrThrow({
        where: { id: period.id },
      });
      expect(retained).toMatchObject({
        agencyId: agencyA.id,
        code: 'PERIOD-RLS-' + suffix,
        dateFrom: new Date('2026-01-05'),
        dateTo: new Date('2026-01-05'),
        status: 'FINALIZED',
      });
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.attendancePeriod.deleteMany({ where: { agencyId: agencyA.id } });
        await transaction.agencyMembership.deleteMany({ where: { agencyId: agencyA.id } });
        await transaction.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
        await transaction.user.deleteMany({ where: { emailNormalized: { contains: suffix } } });
      });
      await app.$disconnect();
      await admin.$disconnect();
    }
  },
);
