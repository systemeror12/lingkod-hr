import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withinIntervals } from '../attendance-days/attendance-calculation';
import { AttendanceDaysService } from '../attendance-days/attendance-days.service';
import {
  ATTENDANCE_WORK_DATE_LOCKED,
  findLockedWorkDate,
  lockedWorkDateMessage,
} from '../attendance-work-date-lock';
import {
  AttendanceCtoInputError,
  assertValidVoidCtoInput,
  ctoInputFacts,
  type RecordCtoInput,
  type VoidCtoInput,
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
   * Period or without expected duty, a timed interval outside expected duty, or
   * coverage overlapping posted leave or another current CTO input, is refused.
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
    // retry or overlapping CTO input sees the committed winner. Posted leave
    // does not take this lock; refusing CTO and leave in both directions
    // belongs to Leave and CTO approval (#543).
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
    // CTO pays expected duty only (docs/hris-controls.md, CTO Request). Recording
    // can check only the Work Date's coverage window, which bounds expected duty
    // without being it; the calculated Day decides placement.
    const coverageWindow = await this.days.workDateCoverageWindowInTransaction(
      transaction,
      agencyId,
      input.employeeId,
      input.workDate,
    );
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
    if (
      facts.startsAt &&
      facts.endsAt &&
      !withinIntervals(coverageWindow, { startsAt: facts.startsAt, endsAt: facts.endsAt })
    ) {
      throw new AttendanceCtoInputError(
        "The CTO interval falls outside the Work Date's expected duty.",
        400,
        'CTO_INPUT_OUTSIDE_EXPECTED_DUTY',
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

  /**
   * Withdraw a current CTO input inside the caller-owned transaction: create its
   * `NONE` successor, leaving the input itself untouched, and recalculate the
   * Employee's current Attendance Day for the Work Date, when one exists. A retry
   * with the same source key returns the existing successor, even once the Work
   * Date is locked; the same key with different facts is a conflict. A Work Date
   * in a finalized Attendance Period is refused, because Attendance Correction
   * owns that change.
   */
  async voidInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: VoidCtoInput,
  ): Promise<{ id: string }> {
    const { agencyId } = context;
    assertValidVoidCtoInput(input);

    // The same per-Employee lock recordInTransaction takes, so a concurrent void
    // or new input sees the committed winner.
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
        existing.coverageMode === 'NONE' &&
        existing.predecessorInputId === input.predecessorInputId;
      if (!same) {
        throw new AttendanceCtoInputError(
          'The source key already names a different CTO input.',
          409,
          'CTO_INPUT_SOURCE_KEY_CONFLICT',
        );
      }
      return { id: existing.id };
    }

    const predecessor = await transaction.attendanceCtoInput.findFirst({
      where: { agencyId, employeeId: input.employeeId, id: input.predecessorInputId },
      select: {
        workDate: true,
        coverageMode: true,
        successors: { select: { id: true }, take: 1 },
      },
    });
    if (!predecessor) {
      throw new AttendanceCtoInputError(
        'The predecessor is not a CTO input for this Employee.',
        404,
        'CTO_INPUT_PREDECESSOR_NOT_FOUND',
      );
    }
    if (predecessor.coverageMode === 'NONE' || predecessor.successors.length > 0) {
      throw new AttendanceCtoInputError(
        'The CTO input is no longer current, so it cannot be voided.',
        409,
        'CTO_INPUT_ALREADY_SUPERSEDED',
      );
    }

    const workDate = predecessor.workDate.toISOString().slice(0, 10);
    const locked = await findLockedWorkDate(transaction, agencyId, [workDate]);
    if (locked) {
      throw new AttendanceCtoInputError(
        lockedWorkDateMessage(locked),
        409,
        ATTENDANCE_WORK_DATE_LOCKED,
      );
    }

    const successor = await transaction.attendanceCtoInput.create({
      data: {
        agencyId,
        employeeId: input.employeeId,
        sourceKey: input.sourceKey,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        workDate: predecessor.workDate,
        coverageMode: 'NONE',
        predecessorInputId: input.predecessorInputId,
      },
      select: { id: true },
    });
    await this.days.recalculateCurrentWorkDateInTransaction(
      transaction,
      context,
      input.employeeId,
      workDate,
    );
    return { id: successor.id };
  }
}
