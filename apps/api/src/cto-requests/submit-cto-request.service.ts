import { Inject, Injectable } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { ApprovalsService } from '../approvals/approval.service';
import { AttendanceDaysService } from '../attendance-days/attendance-days.service';
import { CocAccountsService } from '../coc-accounts/coc-accounts.service';
import { requestDatabaseContext } from '../database-context';
import {
  OVERTIME_AUTHORITY_AUDIT_WRITER,
  type OvertimeAuthorityAuditWriter,
} from '../overtime-authorities/overtime-authorities.audit';
import { resolveCtoRequestRoute } from './cto-request-approval';
import {
  assertEmployeeAccess,
  assertStatus,
  assertWorkDatesNotLive,
  chargeWorkDates,
  dateInputs,
  lockRequest,
  openApprovalRequest,
  readRequest,
  toDatabaseDate,
} from './cto-request.records';
import { firstUncoveredWorkDate } from './cto-request-rule';
import {
  CTO_REQUEST_APPROVAL_SUBJECT_TYPE,
  CTO_REQUEST_ROUTE_CODE,
  CtoRequestError,
  SUBMIT_PERMISSION,
  type CtoRequestSummary,
} from './cto-requests.types';

/**
 * Submit a DRAFT and start its Approval Route. The schedule is read again, since it
 * may have changed since the draft was saved. Under the COC Account lock, the dates
 * must be free of the Employee's live requests and covered by the COC available on
 * them. Nothing is reserved: approval (#543) rechecks the balance when it posts.
 *
 * A request returned from either step starts a new Approval Request, so it is
 * recommended again rather than resuming at the step that returned it.
 */
@Injectable()
export class SubmitCtoRequestService {
  constructor(
    @Inject(OVERTIME_AUTHORITY_AUDIT_WRITER)
    private readonly auditWriter: OvertimeAuthorityAuditWriter,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
    @Inject(AttendanceDaysService) private readonly days: AttendanceDaysService,
    @Inject(CocAccountsService) private readonly coc: CocAccountsService,
  ) {}

  async execute(context: RequestContext, requestId: string): Promise<CtoRequestSummary> {
    return withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition'),
      async (transaction) => {
        const { agencyId } = context;
        const current = await lockRequest(transaction, agencyId, requestId);
        await assertEmployeeAccess(transaction, context, SUBMIT_PERMISSION, current.employeeId);
        assertStatus(current, ['DRAFT'], 'submitted');
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
        const dates = await chargeWorkDates(
          this.days,
          transaction,
          agencyId,
          current.employeeId,
          dateInputs(current),
        );
        await assertWorkDatesNotLive(
          transaction,
          agencyId,
          current.employeeId,
          dates.map((date) => date.workDate),
        );
        const uncovered = firstUncoveredWorkDate(available, dates);
        if (uncovered) {
          throw new CtoRequestError(
            `The COC available on ${uncovered} does not cover this CTO Request.`,
            422,
            'CTO_COC_INSUFFICIENT',
          );
        }
        for (const date of dates) {
          await transaction.ctoRequestDate.update({
            where: {
              ctoRequestId_workDate: {
                ctoRequestId: requestId,
                workDate: toDatabaseDate(date.workDate),
              },
            },
            data: { chargedMinutes: date.chargedMinutes },
          });
        }

        const route = await resolveCtoRequestRoute(this.approvals, transaction, context);
        const returned = await openApprovalRequest(transaction, agencyId, requestId, 'RETURNED');
        if (returned) {
          await this.approvals.cancelInTransaction(
            transaction,
            context,
            returned.id,
            'The returned CTO Request was submitted again.',
          );
        }
        const request = await this.approvals.createRequestInTransaction(
          transaction,
          context,
          {
            routeCode: CTO_REQUEST_ROUTE_CODE,
            subjectType: CTO_REQUEST_APPROVAL_SUBJECT_TYPE,
            subjectId: requestId,
            subjectEmployeeId: current.employeeId,
          },
          undefined,
          route.id,
        );
        await this.approvals.submitInTransaction(transaction, context, request.id, undefined, {
          requireDrafter: false,
        });
        await transaction.ctoRequest.update({
          where: { agencyId_id: { agencyId, id: requestId } },
          data: { status: 'SUBMITTED' },
        });
        await this.auditWriter.write(transaction, {
          agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'CTO_REQUEST_SUBMITTED',
          entityType: 'CtoRequest',
          entityId: requestId,
          previousStatus: 'DRAFT',
          newStatus: 'SUBMITTED',
          requestId: context.requestId,
          metadata: {
            approvalRequestId: request.id,
            chargedMinutes: dates.map((date) => ({
              workDate: date.workDate,
              minutes: date.chargedMinutes,
            })),
          },
        });
        return readRequest(transaction, agencyId, requestId);
      },
    );
  }
}
