import { Inject, Injectable } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { AttendanceDaysService } from '../attendance-days/attendance-days.service';
import { CocAccountsService } from '../coc-accounts/coc-accounts.service';
import { requestDatabaseContext } from '../database-context';
import {
  OVERTIME_AUTHORITY_AUDIT_WRITER,
  type OvertimeAuthorityAuditWriter,
} from '../overtime-authorities/overtime-authorities.audit';
import {
  assertEmployeeAccess,
  assertWorkDatesNotLive,
  chargeWorkDates,
  readRequest,
  toDatabaseDate,
} from './cto-request.records';
import {
  CREATE_PERMISSION,
  CtoRequestError,
  type CtoRequestCreateInput,
  type CtoRequestSummary,
} from './cto-requests.types';

/**
 * Save a DRAFT against the Employee's active COC Account. Its dates are checked
 * against the schedule now and again at submission; the balance is read only at
 * submission.
 */
@Injectable()
export class CreateCtoRequestService {
  constructor(
    @Inject(OVERTIME_AUTHORITY_AUDIT_WRITER)
    private readonly auditWriter: OvertimeAuthorityAuditWriter,
    @Inject(AttendanceDaysService) private readonly days: AttendanceDaysService,
    @Inject(CocAccountsService) private readonly coc: CocAccountsService,
  ) {}

  async execute(context: RequestContext, input: CtoRequestCreateInput): Promise<CtoRequestSummary> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const { agencyId } = context;
      await assertEmployeeAccess(transaction, context, CREATE_PERMISSION, input.employeeId);
      const employee = await transaction.employee.findFirst({
        where: { agencyId, id: input.employeeId },
        select: { id: true },
      });
      if (!employee) {
        throw new CtoRequestError(
          'The Employee could not be found in this Agency.',
          404,
          'CTO_REQUEST_EMPLOYEE_NOT_FOUND',
        );
      }
      const dates = await chargeWorkDates(
        this.days,
        transaction,
        agencyId,
        input.employeeId,
        input.dates,
      );
      const workDates = dates.map((date) => date.workDate);
      const { cocAccountId } = await this.coc.readBalanceInTransaction(
        transaction,
        agencyId,
        input.employeeId,
        workDates[0]!,
      );
      if (!cocAccountId) {
        throw new CtoRequestError(
          'The Employee has no active COC Account.',
          409,
          'CTO_NO_ACTIVE_COC_ACCOUNT',
        );
      }
      await assertWorkDatesNotLive(transaction, agencyId, input.employeeId, workDates);
      const request = await transaction.ctoRequest.create({
        data: { agencyId, employeeId: input.employeeId, cocAccountId, status: 'DRAFT' },
        select: { id: true },
      });
      await transaction.ctoRequestDate.createMany({
        data: dates.map((date) => ({
          agencyId,
          ctoRequestId: request.id,
          workDate: toDatabaseDate(date.workDate),
          unit: date.unit,
          startsAt: date.unit === 'HALF' ? new Date(date.startsAt) : null,
          endsAt: date.unit === 'HALF' ? new Date(date.endsAt) : null,
          chargedMinutes: date.chargedMinutes,
        })),
      });
      await this.auditWriter.write(transaction, {
        agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'CTO_REQUEST_CREATED',
        entityType: 'CtoRequest',
        entityId: request.id,
        previousStatus: null,
        newStatus: 'DRAFT',
        requestId: context.requestId,
        metadata: {
          employeeId: input.employeeId,
          cocAccountId,
          workDates,
        },
      });
      return readRequest(transaction, agencyId, request.id);
    });
  }
}
