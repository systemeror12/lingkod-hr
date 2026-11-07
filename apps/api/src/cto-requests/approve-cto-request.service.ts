import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { ApprovalsService } from '../approvals/approval.service';
import { AttendanceCtoInputsService } from '../attendance-cto-inputs/attendance-cto-inputs.service';
import { AttendanceDaysService } from '../attendance-days/attendance-days.service';
import { CocAccountsService } from '../coc-accounts/coc-accounts.service';
import { requestDatabaseContext } from '../database-context';
import {
  OVERTIME_AUTHORITY_AUDIT_WRITER,
  type OvertimeAuthorityAuditWriter,
} from '../overtime-authorities/overtime-authorities.audit';
import {
  approvalRequestMissing,
  assertEmployeeAccess,
  assertNotOwnRequest,
  assertStatus,
  chargeWorkDates,
  dateInputs,
  decisionAlreadyRecorded,
  lockRequest,
  openApprovalRequest,
  readRequest,
  toDatabaseDate,
} from './cto-request.records';
import { drawCtoUsage } from './cto-request-rule';
import {
  APPROVE_PERMISSION,
  CTO_ATTENDANCE_SOURCE_TYPE,
  CtoRequestError,
  type CtoRequestApproveInput,
  type CtoRequestSummary,
} from './cto-requests.types';

/**
 * The Approving Official approves a FOR_APPROVAL request. In one transaction this
 * decides the route's last step, posts the COC usage, and asks Attendance for one
 * CTO input per Work Date (ADR 0009), so any refusal leaves the request FOR_APPROVAL
 * with nothing written. A retry with the same `Idempotency-Key` returns the request
 * and writes nothing, since the request lock makes it wait for the first attempt.
 */
@Injectable()
export class ApproveCtoRequestService {
  constructor(
    @Inject(OVERTIME_AUTHORITY_AUDIT_WRITER)
    private readonly auditWriter: OvertimeAuthorityAuditWriter,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
    @Inject(AttendanceDaysService) private readonly days: AttendanceDaysService,
    @Inject(CocAccountsService) private readonly coc: CocAccountsService,
    @Inject(AttendanceCtoInputsService) private readonly attendance: AttendanceCtoInputsService,
  ) {}

  async execute(
    context: RequestContext,
    requestId: string,
    input: CtoRequestApproveInput,
    idempotencyKey?: string,
  ): Promise<CtoRequestSummary> {
    return withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition'),
      async (transaction) => {
        const { agencyId, membershipId } = context;
        const current = await lockRequest(transaction, agencyId, requestId);
        await assertEmployeeAccess(transaction, context, APPROVE_PERMISSION, current.employeeId);
        await assertNotOwnRequest(transaction, context, current.employeeId);
        const replayed = await decisionAlreadyRecorded(transaction, context, {
          action: 'CTO_REQUEST_APPROVED',
          requestId,
          idempotencyKey,
          reason: input.comment ?? null,
        });
        if (replayed) return readRequest(transaction, agencyId, requestId);
        assertStatus(current, ['FOR_APPROVAL'], 'approved');
        const open = await openApprovalRequest(transaction, agencyId, requestId, 'IN_PROGRESS');
        if (!open) throw approvalRequestMissing();
        await this.approvals.decideInTransaction(
          transaction,
          context,
          open.id,
          'APPROVE',
          input.comment,
          undefined,
          undefined,
          current.employeeId,
        );

        // Two approvals on one account serialize here, so the later one reads the
        // earlier one's entries.
        const available = await this.coc.lockAndReadAvailableInTransaction(
          transaction,
          agencyId,
          current.cocAccountId,
          current.dates[0]!.workDate,
        );
        if (!available) {
          throw new CtoRequestError(
            "The request's COC Account is no longer active.",
            409,
            'CTO_NO_ACTIVE_COC_ACCOUNT',
          );
        }
        await this.assertChargesCurrent(transaction, agencyId, current);
        const { draws, uncovered } = drawCtoUsage(available, current.dates);
        if (uncovered) {
          throw new CtoRequestError(
            `The COC available on ${uncovered} does not cover this CTO Request.`,
            422,
            'CTO_COC_INSUFFICIENT',
          );
        }
        const entries = await this.coc.postCtoUsageInTransaction(transaction, agencyId, {
          cocAccountId: current.cocAccountId,
          ctoRequestId: requestId,
          postedByMembershipId: membershipId,
          draws,
        });

        await transaction.ctoRequest.update({
          where: { agencyId_id: { agencyId, id: requestId } },
          data: {
            status: 'APPROVED',
            approvedByMembershipId: membershipId,
            approvedAt: new Date(),
          },
        });
        const inputs = [];
        for (const date of current.dates) {
          const { id } = await this.attendance.recordInTransaction(transaction, context, {
            sourceKey: `cto-request:${requestId}:${date.workDate}`,
            employeeId: current.employeeId,
            sourceType: CTO_ATTENDANCE_SOURCE_TYPE,
            sourceId: requestId,
            workDate: date.workDate,
            ...(date.unit === 'HALF'
              ? { coverageMode: 'TIMED', startsAt: date.startsAt!, endsAt: date.endsAt! }
              : { coverageMode: 'WHOLE_WORK_DATE' }),
          });
          await transaction.ctoRequestDate.update({
            where: {
              ctoRequestId_workDate: {
                ctoRequestId: requestId,
                workDate: toDatabaseDate(date.workDate),
              },
            },
            data: { attendanceCtoInputId: id },
          });
          inputs.push({ workDate: date.workDate, attendanceCtoInputId: id });
        }

        await this.auditWriter.write(transaction, {
          agencyId,
          actorUserId: context.userId,
          actorMembershipId: membershipId,
          actorType: 'USER',
          action: 'CTO_REQUEST_APPROVED',
          entityType: 'CtoRequest',
          entityId: requestId,
          previousStatus: 'FOR_APPROVAL',
          newStatus: 'APPROVED',
          ...(input.comment ? { reason: input.comment } : {}),
          requestId: context.requestId,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          metadata: { approvalRequestId: open.id, entries, inputs },
        });
        return readRequest(transaction, agencyId, requestId);
      },
    );
  }

  /**
   * Refuse when the schedule no longer gives the charge the route reviewed. A charge
   * changes only on a DRAFT, so the request goes back through Return and resubmission.
   */
  private async assertChargesCurrent(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    current: CtoRequestSummary,
  ): Promise<void> {
    const charged = await chargeWorkDates(
      this.days,
      transaction,
      agencyId,
      current.employeeId,
      dateInputs(current),
    );
    for (const [index, date] of charged.entries()) {
      const stored = current.dates[index]!.chargedMinutes;
      if (date.chargedMinutes !== stored) {
        throw new CtoRequestError(
          `The schedule now charges ${date.chargedMinutes} minutes on ${date.workDate}, not the ${stored} submitted. Return the request so it can be submitted again.`,
          409,
          'CTO_CHARGE_CHANGED',
        );
      }
    }
  }
}
