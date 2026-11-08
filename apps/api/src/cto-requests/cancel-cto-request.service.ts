import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { manilaToday } from '../attendance-configuration/attendance-configuration.types';
import { ApprovalServiceError } from '../approvals/approval.service';
import { AttendanceCorrectionsService } from '../attendance-corrections/attendance-corrections.service';
import {
  AttendanceCorrectionServiceError,
  CTO_CANCELLATION_SOURCE_TYPE,
} from '../attendance-corrections/attendance-corrections.types';
import { AttendanceCtoInputsService } from '../attendance-cto-inputs/attendance-cto-inputs.service';
import { AttendanceCtoInputError } from '../attendance-cto-inputs/attendance-cto-inputs.types';
import { AttendanceDayServiceError } from '../attendance-days/attendance-days.types';
import { findLockedWorkDate } from '../attendance-work-date-lock';
import { CocAccountsService } from '../coc-accounts/coc-accounts.service';
import { requestDatabaseContext } from '../database-context';
import {
  OVERTIME_AUTHORITY_AUDIT_WRITER,
  type OvertimeAuthorityAuditWriter,
} from '../overtime-authorities/overtime-authorities.audit';
import {
  assertEmployeeAccess,
  assertNotOwnRequest,
  assertStatus,
  decisionAlreadyRecorded,
  lockRequest,
  readRequest,
} from './cto-request.records';
import { datesToCancel } from './cto-request-rule';
import {
  CANCEL_PERMISSION,
  CtoRequestError,
  type CtoRequestCancelInput,
  type CtoRequestDateSummary,
  type CtoRequestSummary,
} from './cto-requests.types';

/** The stable key of one cancelled Work Date's Attendance effect, so a retry finds it. */
export function ctoCancellationEffectKey(cancellationId: string, workDate: string): string {
  return `cto-cancellation:${cancellationId}:${workDate}`;
}

/**
 * The Approving Official cancels approved CTO, as a recall in the exigency of the
 * service (JC 2, s. 2004 item 5.9.3) or at the Employee's request, for the whole
 * request or named Work Dates (hris-controls §5.19). In one transaction it records
 * the cancellation, exactly reverses each cancelled date's usage entries, takes each
 * date's Attendance effect (see `cancelWorkDate`), and marks the dates cancelled. The
 * request becomes CANCELLED once no uncancelled date remains, and otherwise stays
 * APPROVED. Any refusal rolls everything back, so a cancellation Attendance refuses
 * leaves the request as it was, and the same command retried once the cause is fixed
 * (such as a missing Approval Route) completes it. A retry with the same
 * `Idempotency-Key` after success returns the request and writes nothing.
 */
@Injectable()
export class CancelCtoRequestService {
  constructor(
    @Inject(OVERTIME_AUTHORITY_AUDIT_WRITER)
    private readonly auditWriter: OvertimeAuthorityAuditWriter,
    @Inject(CocAccountsService) private readonly coc: CocAccountsService,
    @Inject(AttendanceCtoInputsService) private readonly attendance: AttendanceCtoInputsService,
    @Inject(AttendanceCorrectionsService)
    private readonly corrections: AttendanceCorrectionsService,
  ) {}

  async execute(
    context: RequestContext,
    requestId: string,
    input: CtoRequestCancelInput,
    idempotencyKey?: string,
  ): Promise<CtoRequestSummary> {
    const today = manilaToday();
    // A locked Work Date's handoff opens an Attendance Correction approval.
    const database = requestDatabaseContext(context, 'approval-transition');
    return withDatabaseContext(database, async (transaction) => {
      const { agencyId, membershipId } = context;
      const current = await lockRequest(transaction, agencyId, requestId);
      await assertEmployeeAccess(transaction, context, CANCEL_PERMISSION, current.employeeId);
      await assertNotOwnRequest(transaction, context, current.employeeId);
      const fingerprint = JSON.stringify([
        input.kind,
        input.workDates ? [...input.workDates].sort() : null,
      ]);
      const replayed = await decisionAlreadyRecorded(transaction, context, {
        action: 'CTO_REQUEST_CANCELLED',
        requestId,
        idempotencyKey,
        reason: input.reason,
        fingerprint,
      });
      if (replayed) return readRequest(transaction, agencyId, requestId);
      assertStatus(current, ['APPROVED'], 'cancelled');
      const dates = datesToCancel(current.dates, input.workDates);
      const workDates = dates.map((date) => date.workDate);

      // The same lock approval takes, so a cancellation and an approval on one
      // account serialize. Credit is not restored to a closed account (§5.18).
      const account = await this.coc.lockAndReadAvailableInTransaction(
        transaction,
        agencyId,
        current.cocAccountId,
        workDates[0]!,
      );
      if (!account) {
        throw new CtoRequestError(
          "The request's COC Account is no longer active.",
          409,
          'CTO_NO_ACTIVE_COC_ACCOUNT',
        );
      }

      const cancellation = await transaction.ctoCancellation.create({
        data: {
          agencyId,
          ctoRequestId: requestId,
          kind: input.kind,
          reason: input.reason,
          cancelledByMembershipId: membershipId,
        },
        select: { id: true, cancelledAt: true },
      });
      const ledger = await this.coc.reverseCtoUsageInTransaction(transaction, agencyId, {
        cocAccountId: current.cocAccountId,
        ctoRequestId: requestId,
        ctoCancellationId: cancellation.id,
        workDates,
        reason: input.reason,
        postedByMembershipId: membershipId,
        asOf: today,
      });
      const inputs = [];
      for (const date of dates) {
        inputs.push(
          await this.cancelWorkDate(
            transaction,
            context,
            current,
            { ...cancellation, reason: input.reason },
            date,
          ),
        );
      }

      const remaining = current.dates.filter(
        (date) => date.cancelledByCtoCancellationId === null && !workDates.includes(date.workDate),
      );
      const newStatus = remaining.length === 0 ? 'CANCELLED' : 'APPROVED';
      if (newStatus === 'CANCELLED') {
        await transaction.ctoRequest.update({
          where: { agencyId_id: { agencyId, id: requestId } },
          data: { status: 'CANCELLED' },
        });
      }

      await this.auditWriter.write(transaction, {
        agencyId,
        actorUserId: context.userId,
        actorMembershipId: membershipId,
        actorType: 'USER',
        action: 'CTO_REQUEST_CANCELLED',
        entityType: 'CtoRequest',
        entityId: requestId,
        previousStatus: 'APPROVED',
        newStatus,
        reason: input.reason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          ctoCancellationId: cancellation.id,
          kind: input.kind,
          workDates,
          entries: ledger.entries,
          expiryEntryIds: ledger.expiryEntryIds,
          inputs,
          fingerprint,
        },
      });
      return readRequest(transaction, agencyId, requestId);
    });
  }

  /**
   * One cancelled Work Date's effect outside the ledger, chosen per date. An open
   * date's CTO input gets a `NONE` successor and Attendance recalculates it now. A
   * date in a locked Attendance Period is handed to Attendance as a `CTO_INPUT`
   * correction at FOR_AUTHORIZATION instead (hris-controls §5.19, §5.12): the
   * cancellation is its factual basis, and the date names the correction until a
   * different HR Administrator authorizes it. Either way the date names its
   * cancellation.
   */
  private async cancelWorkDate(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    request: CtoRequestSummary,
    cancellation: { id: string; cancelledAt: Date; reason: string },
    date: CtoRequestDateSummary,
  ): Promise<CancelledWorkDateEffect> {
    if (!date.attendanceCtoInputId) {
      throw new Error(`Approved CTO on ${date.workDate} has no Attendance CTO input.`);
    }
    const effectKey = ctoCancellationEffectKey(cancellation.id, date.workDate);
    const locked = await findLockedWorkDate(transaction, context.agencyId, [date.workDate]);
    let effect: CancelledWorkDateEffect;
    if (locked) {
      const correction = await this.corrections
        .handOffCtoInputInTransaction(transaction, context, {
          effectKey,
          employeeId: request.employeeId,
          predecessorInputId: date.attendanceCtoInputId,
          coverageMode: 'NONE',
          cancellation: {
            id: cancellation.id,
            approvingOfficialMembershipId: context.membershipId,
            approvedAt: cancellation.cancelledAt,
            reason: cancellation.reason,
          },
        })
        .catch((error: unknown) => {
          throw attendanceRefusal(date.workDate, error);
        });
      effect = { workDate: date.workDate, attendanceCorrectionId: correction.id };
    } else {
      const { id } = await this.attendance.voidInTransaction(transaction, context, {
        sourceKey: effectKey,
        employeeId: request.employeeId,
        predecessorInputId: date.attendanceCtoInputId,
        sourceType: CTO_CANCELLATION_SOURCE_TYPE,
        sourceId: cancellation.id,
      });
      effect = { workDate: date.workDate, attendanceCtoInputId: id };
    }
    await transaction.ctoRequestDate.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: date.id } },
      data: {
        cancelledByCtoCancellationId: cancellation.id,
        ...('attendanceCorrectionId' in effect
          ? { attendanceCorrectionId: effect.attendanceCorrectionId }
          : {}),
      },
    });
    return effect;
  }
}

/** The successor input an open date got, or the correction a locked date waits on. */
type CancelledWorkDateEffect =
  | { workDate: string; attendanceCtoInputId: string }
  | { workDate: string; attendanceCorrectionId: string };

/**
 * Attendance's refusal of a locked date's correction, including a missing or
 * unreadable Approval Route, blocks the whole cancellation: nothing is written, and
 * Attendance's own code is kept in `reasons`.
 */
function attendanceRefusal(workDate: string, error: unknown): unknown {
  if (
    error instanceof AttendanceCorrectionServiceError ||
    error instanceof AttendanceCtoInputError ||
    error instanceof AttendanceDayServiceError ||
    error instanceof ApprovalServiceError
  ) {
    return new CtoRequestError(
      `Attendance refused the correction for locked Work Date ${workDate}. ${error.message}`,
      409,
      'CTO_CANCELLATION_ATTENDANCE_REFUSED',
      [error.code, `WORK_DATE:${workDate}`],
    );
  }
  return error;
}
