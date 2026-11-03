import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { ApprovalsService } from '../approvals/approval.service';
import { requestDatabaseContext } from '../database-context';
import {
  OVERTIME_AUTHORITY_AUDIT_WRITER,
  type OvertimeAuthorityAuditWriter,
} from '../overtime-authorities/overtime-authorities.audit';
import {
  cocEarnedCertificateEffect,
  resolveCocEarnedCertificateRoute,
} from './coc-earned-certificate-approval';
import {
  assertAgencyGrant,
  assertStatus,
  lockCertificate,
  monthBounds,
  readCertificate,
} from './coc-earned-certificate.records';
import {
  APPROVE_PERMISSION,
  COC_EARNED_CERTIFICATE_APPROVAL_SUBJECT_TYPE,
  COC_EARNED_CERTIFICATE_ROUTE_CODE,
  CocEarnedCertificateServiceError,
  PREPARE_PERMISSION,
  type CocEarnedCertificatePrepareInput,
  type CocEarnedCertificateReturnInput,
  type CocEarnedCertificateStatus,
  type CocEarnedCertificateSummary,
} from './coc-earned-certificates.types';

const ENTITY_TYPE = 'CocEarnedCertificate';

/**
 * Prepare, submit, return, and discard Certificates of COC Earned
 * (hris-controls, Certificate of COC Earned; ADR 0008). Approval and the COC
 * award are a separate command (#538).
 */
@Injectable()
export class CocEarnedCertificatesService {
  constructor(
    @Inject(OVERTIME_AUTHORITY_AUDIT_WRITER)
    private readonly auditWriter: OvertimeAuthorityAuditWriter,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
  ) {}

  /**
   * Prepare a DRAFT for one Employee and calendar month. Its lines are every
   * CERTIFIED record of the Employee under a COC authority with a Work Date in
   * the month that no unreleased line holds. A concurrent draft that takes a
   * record first makes this one fail on coc_earned_certificate_lines_one_active_uq.
   */
  async prepare(
    context: RequestContext,
    input: CocEarnedCertificatePrepareInput,
  ): Promise<CocEarnedCertificateSummary> {
    assertAgencyGrant(context, PREPARE_PERMISSION);
    const { from, to } = monthBounds(input.earnedMonth);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const employee = await transaction.employee.findFirst({
        where: { agencyId: context.agencyId, id: input.employeeId },
        select: { id: true },
      });
      if (!employee) {
        throw new CocEarnedCertificateServiceError(
          'The Employee could not be found in this Agency.',
          404,
          'COC_EARNED_CERTIFICATE_EMPLOYEE_NOT_FOUND',
        );
      }
      const records = await transaction.overtimeServiceRecord.findMany({
        where: {
          agencyId: context.agencyId,
          employeeId: input.employeeId,
          status: 'CERTIFIED',
          certifiedMinutes: { gt: 0 },
          workDate: { gte: from, lt: to },
          authorityEmployee: { authority: { compensationMethod: 'COC' } },
          cocCertificateLines: { none: { releasedAt: null } },
        },
        orderBy: { workDate: 'asc' },
        select: { id: true, certifiedMinutes: true },
      });
      if (records.length === 0) {
        throw new CocEarnedCertificateServiceError(
          'The Employee has no certified COC service in the month that is not on another certificate.',
          422,
          'COC_EARNED_CERTIFICATE_NO_ELIGIBLE_SERVICE',
        );
      }
      const certificate = await transaction.cocEarnedCertificate.create({
        data: {
          agencyId: context.agencyId,
          employeeId: input.employeeId,
          earnedMonth: from,
          status: 'DRAFT',
          preparedByMembershipId: context.membershipId,
        },
        select: { id: true },
      });
      try {
        await transaction.cocEarnedCertificateLine.createMany({
          data: records.map((record) => ({
            agencyId: context.agencyId,
            cocEarnedCertificateId: certificate.id,
            overtimeServiceRecordId: record.id,
            certifiedMinutes: record.certifiedMinutes!,
          })),
        });
      } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new CocEarnedCertificateServiceError(
            'Another Certificate of COC Earned took some of this service first. Prepare the certificate again.',
            409,
            'COC_EARNED_CERTIFICATE_SERVICE_TAKEN',
          );
        }
        throw error;
      }
      await this.audit(transaction, context, certificate.id, null, 'DRAFT', 'PREPARED', {
        employeeId: input.employeeId,
        earnedMonth: input.earnedMonth,
        overtimeServiceRecordIds: records.map((record) => record.id),
      });
      return readCertificate(transaction, context.agencyId, certificate.id);
    });
  }

  /**
   * Submit a DRAFT to the shared Approval Route. A returned certificate
   * resumes the request it was returned on.
   */
  async submit(
    context: RequestContext,
    certificateId: string,
  ): Promise<CocEarnedCertificateSummary> {
    assertAgencyGrant(context, PREPARE_PERMISSION);
    return withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition'),
      async (transaction) => {
        const current = await lockCertificate(transaction, context.agencyId, certificateId);
        assertStatus(current, 'DRAFT', 'submitted');
        if (!current.lines.some((line) => line.releasedAt === null)) {
          throw new CocEarnedCertificateServiceError(
            'A Certificate of COC Earned needs at least one line to be submitted.',
            422,
            'COC_EARNED_CERTIFICATE_NO_LINES',
          );
        }
        const returned = await this.openRequest(transaction, context, certificateId, 'RETURNED');
        let requestId = returned?.id;
        if (!requestId) {
          const route = await resolveCocEarnedCertificateRoute(
            this.approvals,
            transaction,
            context,
          );
          const request = await this.approvals.createRequestInTransaction(
            transaction,
            context,
            {
              routeCode: COC_EARNED_CERTIFICATE_ROUTE_CODE,
              subjectType: COC_EARNED_CERTIFICATE_APPROVAL_SUBJECT_TYPE,
              subjectId: certificateId,
              subjectEmployeeId: current.employeeId,
            },
            undefined,
            route.id,
          );
          requestId = request.id;
        }
        await this.approvals.submitInTransaction(transaction, context, requestId, undefined, {
          requireDrafter: false,
        });
        await transaction.cocEarnedCertificate.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: certificateId } },
          data: { status: 'FOR_APPROVAL' },
        });
        await this.audit(
          transaction,
          context,
          certificateId,
          'DRAFT',
          'FOR_APPROVAL',
          'SUBMITTED',
          {
            approvalRequestId: requestId,
          },
        );
        return readCertificate(transaction, context.agencyId, certificateId);
      },
    );
  }

  /** Return a certificate awaiting approval to its preparer, with a reason. */
  async return(
    context: RequestContext,
    certificateId: string,
    input: CocEarnedCertificateReturnInput,
  ): Promise<CocEarnedCertificateSummary> {
    assertAgencyGrant(context, APPROVE_PERMISSION);
    return withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition'),
      async (transaction) => {
        const current = await lockCertificate(transaction, context.agencyId, certificateId);
        assertStatus(current, 'FOR_APPROVAL', 'returned');
        const request = await this.openRequest(transaction, context, certificateId, 'IN_PROGRESS');
        if (!request) {
          throw new CocEarnedCertificateServiceError(
            'The Certificate of COC Earned has no Approval Request awaiting a decision.',
            409,
            'COC_EARNED_CERTIFICATE_APPROVAL_REQUEST_MISSING',
          );
        }
        await this.approvals.decideInTransaction(
          transaction,
          context,
          request.id,
          'RETURN',
          input.reason,
          undefined,
          cocEarnedCertificateEffect,
        );
        await transaction.cocEarnedCertificate.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: certificateId } },
          data: { status: 'DRAFT' },
        });
        await this.audit(
          transaction,
          context,
          certificateId,
          'FOR_APPROVAL',
          'DRAFT',
          'RETURNED',
          { approvalRequestId: request.id },
          input.reason,
        );
        return readCertificate(transaction, context.agencyId, certificateId);
      },
    );
  }

  /**
   * Discard a DRAFT that is not awaiting approval and release its lines, so
   * their records can go on another certificate. A request the certificate
   * was returned on is cancelled with it.
   */
  async discard(
    context: RequestContext,
    certificateId: string,
  ): Promise<CocEarnedCertificateSummary> {
    assertAgencyGrant(context, PREPARE_PERMISSION);
    return withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition'),
      async (transaction) => {
        const current = await lockCertificate(transaction, context.agencyId, certificateId);
        assertStatus(current, 'DRAFT', 'discarded');
        await transaction.cocEarnedCertificate.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: certificateId } },
          data: { status: 'DISCARDED' },
        });
        await transaction.cocEarnedCertificateLine.updateMany({
          where: {
            agencyId: context.agencyId,
            cocEarnedCertificateId: certificateId,
            releasedAt: null,
          },
          data: { releasedAt: new Date() },
        });
        const returned = await this.openRequest(transaction, context, certificateId, 'RETURNED');
        if (returned) {
          await this.approvals.cancelInTransaction(
            transaction,
            context,
            returned.id,
            'The Certificate of COC Earned was discarded.',
          );
        }
        await this.audit(transaction, context, certificateId, 'DRAFT', 'DISCARDED', 'DISCARDED', {
          releasedLineIds: current.lines.map((line) => line.id),
          ...(returned ? { approvalRequestId: returned.id } : {}),
        });
        return readCertificate(transaction, context.agencyId, certificateId);
      },
    );
  }

  /** The certificate's one open Approval Request in `status`, if any. */
  private openRequest(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    certificateId: string,
    status: 'IN_PROGRESS' | 'RETURNED',
  ) {
    return transaction.approvalRequest.findFirst({
      where: {
        agencyId: context.agencyId,
        subjectType: COC_EARNED_CERTIFICATE_APPROVAL_SUBJECT_TYPE,
        subjectId: certificateId,
        status,
      },
      select: { id: true },
    });
  }

  private audit(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    certificateId: string,
    previousStatus: CocEarnedCertificateStatus | null,
    newStatus: CocEarnedCertificateStatus,
    verb: 'PREPARED' | 'SUBMITTED' | 'RETURNED' | 'DISCARDED',
    metadata: Prisma.InputJsonObject,
    reason?: string,
  ): Promise<void> {
    return this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: `COC_EARNED_CERTIFICATE_${verb}`,
      entityType: ENTITY_TYPE,
      entityId: certificateId,
      previousStatus,
      newStatus,
      ...(reason ? { reason } : {}),
      requestId: context.requestId,
      metadata,
    });
  }
}
