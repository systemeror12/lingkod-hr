import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { AttendanceDaysService } from '../attendance-days/attendance-days.service';
import {
  ATTENDANCE_WORK_DATE_LOCKED,
  findLockedWorkDate,
  lockedWorkDateMessage,
} from '../attendance-work-date-lock';
import {
  AttendanceCtoInputError,
  ctoInputFacts,
  type RecordCtoInput,
} from './attendance-cto-inputs.types';

/**
 * Attendance's owner of approved CTO (ADR 0009). CTO Request approval hands it
 * one immutable input per Work Date inside its own authoritative transaction;
 * Attendance Day calculation reads only current inputs.
 */
@Injectable()
export class AttendanceCtoInputsService {
  constructor(@Inject(AttendanceDaysService) private readonly days: AttendanceDaysService) {}

  /**
   * Record a CTO input inside the caller-owned transaction and recalculate the
   * Employee's current Attendance Day for the Work Date, when one exists. A
   * retry with the same source key returns the existing input; the same key
   * with different facts is a conflict. A Work Date in a finalized Attendance
   * Period, or coverage overlapping posted leave or another current CTO input,
   * is refused.
   */
  async recordInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: RecordCtoInput,
  ): Promise<{ id: string }> {
    const { agencyId } = context;
    const facts = ctoInputFacts(input);

    const employee = await transaction.employee.findFirst({
      where: { agencyId, id: input.employeeId },
      select: { id: true },
    });
    if (!employee) {
      throw new AttendanceCtoInputError(
        'The Employee does not belong to this Agency.',
        404,
        'CTO_INPUT_EMPLOYEE_NOT_FOUND',
      );
    }
    // One Employee's CTO inputs are recorded one at a time, so a concurrent
    // retry or overlapping input sees the committed winner.
    await transaction.$queryRaw(
      Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`${agencyId}:attendance-cto:${input.employeeId}`}, 0))`,
    );

    const existing = await transaction.attendanceCtoInput.findFirst({
      where: { agencyId, sourceKey: input.sourceKey },
    });
    if (existing) {
      const same =
        existing.employeeId === input.employeeId &&
        existing.sourceType === input.sourceType &&
        existing.sourceId === input.sourceId &&
        existing.workDate.getTime() === facts.workDate.getTime() &&
        existing.coverageMode === input.coverageMode &&
        existing.startsAt?.getTime() === facts.startsAt?.getTime() &&
        existing.endsAt?.getTime() === facts.endsAt?.getTime() &&
        existing.predecessorInputId === null;
      if (!same) {
        throw new AttendanceCtoInputError(
          'The source key already names a different CTO input.',
          409,
          'CTO_INPUT_SOURCE_KEY_CONFLICT',
        );
      }
      return { id: existing.id };
    }

    const locked = await findLockedWorkDate(transaction, agencyId, [input.workDate]);
    if (locked) {
      throw new AttendanceCtoInputError(
        lockedWorkDateMessage(locked),
        409,
        ATTENDANCE_WORK_DATE_LOCKED,
      );
    }

    // Posted leave covers its whole Work Date, so any CTO on that date overlaps.
    const postedLeave = await transaction.attendancePostedLeaveInput.findFirst({
      where: {
        agencyId,
        employeeId: input.employeeId,
        dateFrom: { lte: facts.workDate },
        dateTo: { gte: facts.workDate },
        quantity: { gt: 0 },
        successors: { none: {} },
      },
      select: { id: true },
    });
    if (postedLeave) {
      throw new AttendanceCtoInputError(
        'The CTO overlaps posted leave on the Work Date.',
        409,
        'CTO_INPUT_OVERLAPS_POSTED_LEAVE',
      );
    }
    const overlapping = await transaction.attendanceCtoInput.findFirst({
      where: {
        agencyId,
        employeeId: input.employeeId,
        coverageMode: { not: 'NONE' },
        successors: { none: {} },
        OR: [
          {
            workDate: facts.workDate,
            ...(input.coverageMode === 'TIMED' ? { coverageMode: 'WHOLE_WORK_DATE' } : {}),
          },
          ...(facts.startsAt && facts.endsAt
            ? [
                {
                  coverageMode: 'TIMED',
                  startsAt: { lt: facts.endsAt },
                  endsAt: { gt: facts.startsAt },
                },
              ]
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

    const created = await transaction.attendanceCtoInput.create({
      data: {
        agencyId,
        employeeId: input.employeeId,
        sourceKey: input.sourceKey,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        workDate: facts.workDate,
        coverageMode: input.coverageMode,
        startsAt: facts.startsAt,
        endsAt: facts.endsAt,
      },
      select: { id: true },
    });
    await this.days.recalculateCurrentWorkDateInTransaction(
      transaction,
      context,
      input.employeeId,
      input.workDate,
    );
    return { id: created.id };
  }
}
