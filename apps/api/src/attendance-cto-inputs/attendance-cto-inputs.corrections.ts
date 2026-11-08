import type { Prisma } from '@prisma/client';
import { withinIntervals } from '../attendance-days/attendance-calculation';
import { AttendanceCtoInputError, type CtoCoverageMode } from './attendance-cto-inputs.types';

/**
 * Refuses a replacement a locked CTO correction could not place, before it
 * waits for authorization: `coverageWindow` is the Work Date's coverage window,
 * or `null` when its schedule cannot be resolved. Mirrors recording's checks,
 * except that the replaced input does not count as an overlap. Posted leave
 * cannot overlap, because the replaced input already holds the Work Date.
 */
export async function assertCtoReplacementPlaceableInTransaction(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  input: {
    employeeId: string;
    predecessorInputId: string;
    workDate: Date;
    coverageMode: CtoCoverageMode;
    startsAt: Date | null;
    endsAt: Date | null;
    coverageWindow: Parameters<typeof withinIntervals>[0] | null;
  },
): Promise<void> {
  const { startsAt, endsAt, coverageWindow } = input;
  if (!coverageWindow) {
    throw new AttendanceCtoInputError(
      "The Employee's schedule for the Work Date cannot be resolved, so the CTO cannot be placed.",
      409,
      'CTO_INPUT_SCHEDULE_UNRESOLVED',
    );
  }
  if (coverageWindow.length === 0) {
    throw new AttendanceCtoInputError(
      'The Work Date has no expected duty, so it cannot take CTO.',
      409,
      'CTO_INPUT_NO_EXPECTED_DUTY',
    );
  }
  if (startsAt && endsAt && !withinIntervals(coverageWindow, { startsAt, endsAt })) {
    throw new AttendanceCtoInputError(
      "The CTO interval falls outside the Work Date's expected duty.",
      400,
      'CTO_INPUT_OUTSIDE_EXPECTED_DUTY',
    );
  }
  const overlapping = await transaction.attendanceCtoInput.findFirst({
    where: {
      agencyId,
      employeeId: input.employeeId,
      id: { not: input.predecessorInputId },
      coverageMode: { not: 'NONE' },
      successors: { none: {} },
      OR: [
        {
          workDate: input.workDate,
          ...(input.coverageMode === 'TIMED' ? { coverageMode: 'WHOLE_WORK_DATE' } : {}),
        },
        ...(startsAt && endsAt
          ? [{ coverageMode: 'TIMED', startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }]
          : []),
      ],
    },
    select: { id: true },
  });
  if (overlapping) {
    throw new AttendanceCtoInputError(
      'The CTO overlaps another current CTO input.',
      409,
      'CTO_INPUT_OVERLAPS_CTO',
    );
  }
}

/**
 * Creates the successor CTO input an authorized Locked Attendance Adjustment
 * carries; a `NONE` successor withdraws its predecessor's coverage. The locked
 * Work Date check does not apply because the adjustment is the authority, and
 * the caller recalculates the Work Date.
 */
export async function createCtoSuccessorInTransaction(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  input: {
    sourceKey: string;
    employeeId: string;
    sourceType: string;
    sourceId: string;
    predecessorInputId: string;
    workDate: Date;
    coverageMode: CtoCoverageMode | 'NONE';
    startsAt: Date | null;
    endsAt: Date | null;
  },
): Promise<{ id: string }> {
  return transaction.attendanceCtoInput.create({
    data: { agencyId, ...input },
    select: { id: true },
  });
}
