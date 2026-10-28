import type { Prisma } from '@prisma/client';
import { toDatabaseDate, type CtoDayCoverage } from './attendance-cto-inputs.types';

/**
 * Current CTO covering one Work Date for Attendance Day calculation. Only an
 * input with no successor is current, and a `NONE` successor withdraws its
 * predecessor's coverage, so neither appears here.
 */
export async function ctoCoverageInTransaction(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  employeeId: string,
  workDate: string,
): Promise<CtoDayCoverage[]> {
  const inputs = await transaction.attendanceCtoInput.findMany({
    where: {
      agencyId,
      employeeId,
      workDate: toDatabaseDate(workDate),
      coverageMode: { not: 'NONE' },
      successors: { none: {} },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, coverageMode: true, startsAt: true, endsAt: true },
  });
  return inputs.map((input) => ({
    inputId: input.id,
    interval:
      input.coverageMode === 'TIMED' && input.startsAt && input.endsAt
        ? { startsAt: input.startsAt, endsAt: input.endsAt }
        : null,
  }));
}
