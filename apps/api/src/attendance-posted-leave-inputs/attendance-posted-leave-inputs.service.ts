import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AttendancePostedLeaveInputError,
  POSTED_LEAVE_ALLOCATION_KINDS,
  POSTED_LEAVE_UNIT_CODES,
  formatDate,
  invalid,
  postedLeaveAmbiguity,
  toDatabaseDate,
  type CreatePostedLeaveInput,
  type PostedLeaveAllocationKind,
  type PostedLeaveDayCoverage,
} from './attendance-posted-leave-inputs.types';

/**
 * Attendance's owner of posted leave. Leave Posting hands it one immutable
 * input per posted allocation line, inside its own authoritative transaction;
 * Attendance Day calculation reads only current inputs from here.
 */
@Injectable()
export class AttendancePostedLeaveInputsService {
  /**
   * Create a posted-leave input inside a caller-owned transaction and return
   * its Attendance-issued identifier. A retry with the same source key returns
   * the existing input; the same key with different facts is a conflict.
   */
  async createInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    input: CreatePostedLeaveInput,
  ): Promise<{ id: string }> {
    assertValid(input);
    const values: PostedLeaveInputFacts = {
      employeeId: input.employeeId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      dateFrom: toDatabaseDate(input.dateFrom),
      dateTo: toDatabaseDate(input.dateTo),
      unitCode: input.unitCode,
      quantity: new Prisma.Decimal(input.quantity),
      allocationKind: input.allocationKind,
      predecessorInputId: input.predecessorInputId ?? null,
    };

    const existing = await transaction.attendancePostedLeaveInput.findFirst({
      where: { agencyId, sourceKey: input.sourceKey },
    });
    if (existing) {
      if (!sameFacts(existing, values)) {
        throw new AttendancePostedLeaveInputError(
          'The source key already names a different posted-leave input.',
          409,
          'POSTED_LEAVE_INPUT_SOURCE_KEY_CONFLICT',
        );
      }
      return { id: existing.id };
    }

    const employee = await transaction.employee.findFirst({
      where: { agencyId, id: input.employeeId },
      select: { id: true },
    });
    if (!employee) {
      throw new AttendancePostedLeaveInputError(
        'The Employee does not belong to this Agency.',
        404,
        'POSTED_LEAVE_INPUT_EMPLOYEE_NOT_FOUND',
      );
    }
    if (input.predecessorInputId) {
      const predecessor = await transaction.attendancePostedLeaveInput.findFirst({
        where: { agencyId, id: input.predecessorInputId },
        select: { employeeId: true, successors: { select: { id: true }, take: 1 } },
      });
      if (!predecessor || predecessor.employeeId !== input.employeeId) {
        throw new AttendancePostedLeaveInputError(
          'The predecessor is not a posted-leave input for this Employee.',
          404,
          'POSTED_LEAVE_INPUT_PREDECESSOR_NOT_FOUND',
        );
      }
      if (predecessor.successors.length > 0) {
        throw new AttendancePostedLeaveInputError(
          'The predecessor already has a successor input.',
          409,
          'POSTED_LEAVE_INPUT_ALREADY_SUPERSEDED',
        );
      }
    }

    // ON CONFLICT DO NOTHING keeps a concurrent duplicate from aborting the
    // caller's transaction; the committed winner is read back below.
    const { count } = await transaction.attendancePostedLeaveInput.createMany({
      data: { agencyId, sourceKey: input.sourceKey, ...values },
      skipDuplicates: true,
    });
    const stored = await transaction.attendancePostedLeaveInput.findFirst({
      where: { agencyId, sourceKey: input.sourceKey },
    });
    if (count === 1 && stored) return { id: stored.id };
    if (stored && sameFacts(stored, values)) return { id: stored.id };
    throw stored
      ? new AttendancePostedLeaveInputError(
          'The source key already names a different posted-leave input.',
          409,
          'POSTED_LEAVE_INPUT_SOURCE_KEY_CONFLICT',
        )
      : new AttendancePostedLeaveInputError(
          'The predecessor already has a successor input.',
          409,
          'POSTED_LEAVE_INPUT_ALREADY_SUPERSEDED',
        );
  }

  /**
   * Current posted leave covering one Work Date. An input whose quantity
   * Attendance cannot place as whole-day coverage returns an ambiguity instead
   * of an assumed interval, so the calculation can fail closed.
   */
  async coverageInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    workDateValue: string,
  ): Promise<PostedLeaveDayCoverage[]> {
    const workDate = toDatabaseDate(workDateValue);
    const inputs = await transaction.attendancePostedLeaveInput.findMany({
      where: {
        agencyId,
        employeeId,
        dateFrom: { lte: workDate },
        dateTo: { gte: workDate },
        successors: { none: {} },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return inputs.map((input) => {
      const quantity = input.quantity.toNumber();
      return {
        inputId: input.id,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        allocationKind: input.allocationKind as PostedLeaveAllocationKind,
        quantity,
        ambiguousReason: postedLeaveAmbiguity({
          dateFrom: formatDate(input.dateFrom),
          dateTo: formatDate(input.dateTo),
          unitCode: input.unitCode as CreatePostedLeaveInput['unitCode'],
          quantity,
        }),
      };
    });
  }
}

interface PostedLeaveInputFacts {
  employeeId: string;
  sourceType: string;
  sourceId: string;
  dateFrom: Date;
  dateTo: Date;
  unitCode: string;
  quantity: Prisma.Decimal;
  allocationKind: string;
  predecessorInputId: string | null;
}

function assertValid(input: CreatePostedLeaveInput): void {
  if (input.sourceKey.trim().length === 0) throw invalid('A stable source key is required.');
  if (input.sourceType.trim().length === 0) throw invalid('A Leave source reference is required.');
  if (!POSTED_LEAVE_UNIT_CODES.includes(input.unitCode)) throw invalid('Enter a valid unit.');
  if (!POSTED_LEAVE_ALLOCATION_KINDS.includes(input.allocationKind)) {
    throw invalid('Enter a valid allocation kind.');
  }
  if (!(input.quantity > 0)) throw invalid('The approved quantity must be greater than zero.');
  if (toDatabaseDate(input.dateTo) < toDatabaseDate(input.dateFrom)) {
    throw invalid('The date range must not end before it starts.');
  }
}

function sameFacts(
  existing: Prisma.AttendancePostedLeaveInputGetPayload<object>,
  values: PostedLeaveInputFacts,
): boolean {
  return (
    existing.employeeId === values.employeeId &&
    existing.sourceType === values.sourceType &&
    existing.sourceId === values.sourceId &&
    existing.dateFrom.getTime() === values.dateFrom.getTime() &&
    existing.dateTo.getTime() === values.dateTo.getTime() &&
    existing.unitCode === values.unitCode &&
    existing.quantity.equals(values.quantity) &&
    existing.allocationKind === values.allocationKind &&
    existing.predecessorInputId === values.predecessorInputId
  );
}
