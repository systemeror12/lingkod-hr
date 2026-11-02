import type { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import {
  ApprovalServiceError,
  type ApprovalCompletionRegistry,
  type ApprovalEffectContext,
  type ApprovalRouteSummary,
  type ApprovalsService,
} from '../approvals/approval.service';
import {
  APPROVE_PERMISSION,
  COC_EARNED_CERTIFICATE_APPROVAL_EFFECT_KIND,
  COC_EARNED_CERTIFICATE_APPROVAL_SUBJECT_TYPE,
  COC_EARNED_CERTIFICATE_ROUTE_CODE,
  CocEarnedCertificateServiceError,
} from './coc-earned-certificates.types';

export const cocEarnedCertificateEffect: ApprovalEffectContext = {
  kind: COC_EARNED_CERTIFICATE_APPROVAL_EFFECT_KIND,
  payload: null,
};

/**
 * Make the generic Approval API fail closed for Certificates of COC Earned:
 * decisions go through the Overtime module, which moves the certificate with
 * its request in one transaction. Cancelling is allowed only once the module
 * has discarded the certificate, which closes a returned request.
 */
export function registerCocEarnedCertificateApproval(registry: ApprovalCompletionRegistry): void {
  const guard = async (
    _transaction: Prisma.TransactionClient,
    _context: RequestContext,
    request: { effectContext?: ApprovalEffectContext },
  ) => {
    if (request.effectContext?.kind !== COC_EARNED_CERTIFICATE_APPROVAL_EFFECT_KIND) {
      throw new ApprovalServiceError(
        'Decide a Certificate of COC Earned through the Overtime module.',
        409,
        'COC_EARNED_CERTIFICATE_APPROVAL_EFFECT_REQUIRED',
      );
    }
  };
  registry.register(COC_EARNED_CERTIFICATE_APPROVAL_SUBJECT_TYPE, guard);
  registry.registerDecision(COC_EARNED_CERTIFICATE_APPROVAL_SUBJECT_TYPE, guard);
  registry.registerCancel(
    COC_EARNED_CERTIFICATE_APPROVAL_SUBJECT_TYPE,
    async (transaction, _context, request) => {
      const certificate = await transaction.cocEarnedCertificate.findFirst({
        where: { agencyId: request.agencyId, id: request.subjectId },
        select: { status: true },
      });
      if (certificate?.status !== 'DISCARDED') {
        throw new ApprovalServiceError(
          'A Certificate of COC Earned Approval Request closes only when the certificate is discarded.',
          409,
          'COC_EARNED_CERTIFICATE_APPROVAL_CANCEL_FORBIDDEN',
        );
      }
    },
  );
}

/**
 * Resolve the Agency's active Certificate of COC Earned route. The Head of
 * Office grants the certificate, so the route has exactly one step, which
 * approves and returns with `overtime.coc_certificates.approve`.
 */
export async function resolveCocEarnedCertificateRoute(
  approvals: ApprovalsService,
  transaction: Prisma.TransactionClient,
  context: RequestContext,
): Promise<ApprovalRouteSummary> {
  const route = await approvals.resolveActiveRouteInTransaction(
    transaction,
    context,
    COC_EARNED_CERTIFICATE_ROUTE_CODE,
  );
  const [step, ...rest] = route.stepDefinition.steps;
  const valid =
    step !== undefined &&
    rest.length === 0 &&
    (step.approvePermission ?? step.requiredPermission) === APPROVE_PERMISSION &&
    (step.returnPermission ?? step.requiredPermission) === APPROVE_PERMISSION;
  if (!valid) {
    throw new CocEarnedCertificateServiceError(
      `The ${COC_EARNED_CERTIFICATE_ROUTE_CODE} Approval Route must have one step that approves and returns with ${APPROVE_PERMISSION}.`,
      409,
      'COC_EARNED_CERTIFICATE_ROUTE_INVALID',
    );
  }
  return route;
}
