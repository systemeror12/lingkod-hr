import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import {
  AuthorizedInputServiceError,
  assertAdjustPermission,
  readAuthorizedInput,
  type AuthorizedInputSummary,
} from './authorized-payroll-component-inputs.records';

/**
 * Approve a `RECORDED` input. The approver is a different person from the
 * recorder (#27); after approval the input is never edited.
 */
@Injectable()
export class ApproveAuthorizedPayrollComponentInputService {
  async execute(context: RequestContext, inputId: string): Promise<AuthorizedInputSummary> {
    assertAdjustPermission(context);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const locked = await transaction.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT "id" FROM "authorized_payroll_component_inputs" WHERE "agency_id" = CAST(${context.agencyId} AS uuid) AND "id" = CAST(${inputId} AS uuid) FOR UPDATE`,
      );
      if (locked.length !== 1) {
        throw new AuthorizedInputServiceError(
          'The Authorized Payroll Component Input could not be found.',
          404,
          'AUTHORIZED_INPUT_NOT_FOUND',
        );
      }
      const current = await readAuthorizedInput(transaction, context.agencyId, inputId);
      if (current.status !== 'RECORDED') {
        throw new AuthorizedInputServiceError(
          `Only a RECORDED input can be approved; this one is ${current.status}.`,
          409,
          'AUTHORIZED_INPUT_STATUS_INVALID',
        );
      }
      const recorder = await transaction.agencyMembership.findFirst({
        where: { agencyId: context.agencyId, id: current.recordedByMembershipId },
        select: { userId: true },
      });
      if (!recorder || recorder.userId === context.userId) {
        throw new AuthorizedInputServiceError(
          'The recorder of an Authorized Payroll Component Input cannot approve it.',
          403,
          'AUTHORIZED_INPUT_SELF_APPROVAL',
        );
      }

      await transaction.authorizedPayrollComponentInput.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: inputId } },
        data: {
          status: 'APPROVED',
          approvedByMembershipId: context.membershipId,
          approvedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      await transaction.auditEvent.create({
        data: {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'AUTHORIZED_PAYROLL_COMPONENT_INPUT_APPROVED',
          entityType: 'AuthorizedPayrollComponentInput',
          entityId: inputId,
          previousStatus: 'RECORDED',
          newStatus: 'APPROVED',
          requestId: context.requestId,
          metadata: { recordedByMembershipId: current.recordedByMembershipId },
        },
      });
      return readAuthorizedInput(transaction, context.agencyId, inputId);
    });
  }
}
