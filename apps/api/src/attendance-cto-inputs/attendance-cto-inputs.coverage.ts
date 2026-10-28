import type { Prisma } from '@prisma/client';
import {
  AttendanceCtoInputError,
  toDatabaseDate,
  type CtoDayCoverage,
} from './attendance-cto-inputs.types';

/**
 * Current CTO covering one Work Date for Attendance Day calculation. Only an
 * input with no successor is current, and a `NONE` successor withdraws its
 * predecessor's coverage, so neither appears here. A TIMED input without both
 * bounds fails closed rather than being paid as a whole Work Date.
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
  return inputs.map((input) => {
    if (input.coverageMode === 'WHOLE_WORK_DATE') return { inputId: input.id, interval: null };
    if (input.coverageMode !== 'TIMED' || !input.startsAt || !input.endsAt) {
      throw new AttendanceCtoInputError(
        'A CTO input does not define a placeable coverage.',
        500,
        'CTO_INPUT_COVERAGE_INVALID',
      );
    }
    return { inputId: input.id, interval: { startsAt: input.startsAt, endsAt: input.endsAt } };
  });
}
