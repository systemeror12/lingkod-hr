import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { manilaToday } from '../attendance-configuration/attendance-configuration.types';
import { CTO_CANCELLATION_SOURCE_TYPE } from '../attendance-corrections/attendance-corrections.types';
import { AttendanceCtoInputsService } from '../attendance-cto-inputs/attendance-cto-inputs.service';
import {
  ATTENDANCE_WORK_DATE_LOCKED,
  findLockedWorkDate,
  lockedWorkDateMessage,
} from '../attendance-work-date-lock';
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
 * the cancellation, exactly reverses each cancelled date's usage entries, gives each
 * date's Attendance CTO input a `NONE` successor, and marks the dates cancelled. The
 * request becomes CANCELLED once no uncancelled date remains, and otherwise stays
 * APPROVED. Any refusal rolls everything back.
 *
 * A Work Date in a locked Attendance Period is refused with
 * `ATTENDANCE_WORK_DATE_LOCKED` before anything is written; #549 hands those dates
 * to Attendance Correction instead. A retry with the same `Idempotency-Key` returns
 * the request and writes nothing.
 */
@Injectable()
export class CancelCtoRequestService {
  constructor(
    @Inject(OVERTIME_AUTHORITY_AUDIT_WRITER)
    private readonly auditWriter: OvertimeAuthorityAuditWriter,
    @Inject(CocAccountsService) private readonly coc: CocAccountsService,
    @Inject(AttendanceCtoInputsService) private readonly attendance: AttendanceCtoInputsService,
  ) {}

  async execute(
    context: RequestContext,
    requestId: string,
    input: CtoRequestCancelInput,
    idempotencyKey?: string,
  ): Promise<CtoRequestSummary> {
    const today = manilaToday();
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
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

      // Refused before any write. #549 replaces this with a per-date choice in
      // cancelWorkDate: supersede an open date, or hand a locked one to Attendance.
      const locked = await findLockedWorkDate(transaction, agencyId, workDates);
      if (locked) {
        throw new CtoRequestError(lockedWorkDateMessage(locked), 409, ATTENDANCE_WORK_DATE_LOCKED);
      }

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
        select: { id: true },
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
          await this.cancelWorkDate(transaction, context, current, cancellation.id, date),
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
   * One cancelled Work Date's effect outside the ledger: Attendance gives its CTO
   * input a `NONE` successor and recalculates the date, then the date names its
   * cancellation. #549 adds the locked-date handoff here.
   */
  private async cancelWorkDate(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    request: CtoRequestSummary,
    cancellationId: string,
    date: CtoRequestDateSummary,
  ): Promise<{ workDate: string; attendanceCtoInputId: string }> {
    if (!date.attendanceCtoInputId) {
      throw new Error(`Approved CTO on ${date.workDate} has no Attendance CTO input.`);
    }
    const { id } = await this.attendance.voidInTransaction(transaction, context, {
      sourceKey: ctoCancellationEffectKey(cancellationId, date.workDate),
      employeeId: request.employeeId,
      predecessorInputId: date.attendanceCtoInputId,
      sourceType: CTO_CANCELLATION_SOURCE_TYPE,
      sourceId: cancellationId,
    });
    await transaction.ctoRequestDate.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: date.id } },
      data: { cancelledByCtoCancellationId: cancellationId },
    });
    return { workDate: date.workDate, attendanceCtoInputId: id };
  }
}
