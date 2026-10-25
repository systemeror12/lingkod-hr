import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import {
  ApprovalCompletionRegistry,
  ApprovalsService,
  type ApprovalCompletionRequest,
} from '../approvals/approval.service';
import { requestDatabaseContext } from '../database-context';
import { resolveEmployeeScope, scopeCovers, type EmployeeScope } from '../employee-scope';
import { DocumentsService } from '../documents/documents.service';
import { MandatoryLeaveAssessmentsService } from '../mandatory-leave-assessments/mandatory-leave-assessments.service';
import {
  MONETIZATION_CALCULATOR_KIND,
  MONETIZATION_FACTOR,
  REGULAR_MONETIZATION_RULES,
  assessMonetization,
  type MonetizationAssessmentFacts,
  type MonetizationAuthoritySnapshot,
  type MonetizationKind,
  type MonetizationStatus,
} from './monetization-catalogue';
import {
  LeaveMonetizationServiceError,
  canonicalJson,
  formatDate,
  formatDateTime,
  formatQuantity,
  manilaToday,
  metadataString,
  toDatabaseDate,
  yearBounds,
} from './monetization-support';
import {
  PAYROLL_MONETIZATION_PORT,
  isAccepted,
  type MonetizationEarningAllocation,
  type MonetizationPortFailure,
  type PayrollMonetizationPort,
} from './payroll-monetization.port';
import type {
  MonetizationAdjustmentCreateInput,
  MonetizationAssessmentInput,
  MonetizationCertificationInput,
  MonetizationCreateInput,
  MonetizationDecisionInput,
  MonetizationFundingInput,
  MonetizationReturnInput,
  MonetizationSubmitInput,
} from './leave-monetization.schemas';

export const LEAVE_MONETIZATION_ROUTE_CODE = 'LEAVE_MONETIZATION';
export const LEAVE_MONETIZATION_ADJUSTMENT_ROUTE_CODE = 'LEAVE_MONETIZATION_ADJUSTMENT';

const CERTIFICATION_LINE_SOURCE_TYPE = 'MonetizationCreditCertificationLine';
const POSTING_SOURCE_TYPE = 'MONETIZATION_POSTING';
const ADJUSTMENT_SOURCE_TYPE = 'MONETIZATION_ADJUSTMENT';

export interface MonetizationListFilters {
  status?: MonetizationStatus | undefined;
  employeeId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface MonetizationRequestSummary {
  id: string;
  agencyId: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  status: MonetizationStatus;
  currentVersionId: string | null;
  versionNo: number | null;
  kind: MonetizationKind | null;
  reason: string | null;
  requestedQuantity: string;
  certifiedQuantity: string | null;
  approvedQuantity: string | null;
  createdAt: string;
  submittedAt: string | null;
}

export interface MonetizationAllocationSummary {
  id: string;
  leaveAccountId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  policyVersionId: string;
  requestedQuantity: string;
  certifiedQuantity: string | null;
  approvedQuantity: string | null;
}

export interface MonetizationAssessmentSummary {
  id: string;
  result: string;
  balanceEffectiveDate: string;
  ledgerCutoff: string;
  ruleResults: Prisma.JsonValue;
  assessedAt: string;
}

export interface MonetizationCertificationSummary {
  id: string;
  certifiedAt: string;
  lines: Array<{
    id: string;
    leaveAccountId: string;
    postedBalance: string;
    otherActiveCommitments: string;
    certifiedQuantity: string;
    resultingAvailableQuantity: string;
    leaveCreditCommitmentId: string;
  }>;
}

export interface MonetizationFundingSummary {
  id: string;
  result: string;
  fiscalAuthorityDocumentVersionId: string;
  fundingSourceSnapshot: Prisma.JsonValue;
  evidenceSnapshot: Prisma.JsonValue;
  reviewedAt: string;
}

export interface MonetizationPostingSummary {
  id: string;
  postingKey: string;
  valuationDate: string;
  calculatorKind: string;
  factor: string;
  payrollInputId: string;
  postedAt: string;
}

export interface MonetizationAdjustmentSummary {
  id: string;
  scope: string;
  reason: string;
  status: string;
  approvalRequestId: string;
  ownerResult: Prisma.JsonValue;
  appliedAt: string | null;
  lines: Array<{
    id: string;
    originalLedgerEntryId: string;
    retainedQuantity: string;
    reversalLedgerEntryId: string | null;
    replacementLedgerEntryId: string | null;
  }>;
}

export interface MonetizationDetail {
  request: MonetizationRequestSummary;
  allocations: MonetizationAllocationSummary[];
  assessment: MonetizationAssessmentSummary | null;
  certification: MonetizationCertificationSummary | null;
  funding: MonetizationFundingSummary | null;
  posting: MonetizationPostingSummary | null;
  adjustments: MonetizationAdjustmentSummary[];
}

export interface MonetizationPage {
  items: MonetizationRequestSummary[];
  hasMore: boolean;
  nextOffset: number | null;
  /** The acting Membership's own Employee; only that Employee may attest by authenticated submission. */
  actorEmployeeId: string | null;
}

export interface MonetizationPostResult {
  outcome: 'POSTED' | 'ALREADY_POSTED';
  request: MonetizationRequestSummary;
  posting: MonetizationPostingSummary | null;
}

export interface MonetizationAdjustmentApplyResult {
  adjustment: MonetizationAdjustmentSummary;
  ownerResult: Prisma.JsonValue;
}

const requestEmployeeSelect = {
  employeeNumber: true,
  legalName: true,
} as const;

const allocationSelect = {
  id: true,
  leaveAccountId: true,
  policyVersionId: true,
  requestedQuantity: true,
  approvedQuantity: true,
  leaveAccount: {
    select: {
      leaveType: { select: { code: true, name: true } },
    },
  },
} as const;

const versionSelect = {
  id: true,
  versionNo: true,
  kind: true,
  reason: true,
  approvalRouteVersionId: true,
  approvalRequestId: true,
  formTemplateDocumentVersionId: true,
  attestationType: true,
  attestationDocumentVersionId: true,
  submittedByMembershipId: true,
  employeeAttestedAt: true,
  authoritySnapshot: true,
  submittedAt: true,
} as const;

const assessmentSelect = {
  id: true,
  result: true,
  balanceEffectiveDate: true,
  ledgerCutoff: true,
  ruleResults: true,
  assessedAt: true,
} as const;

const certificationSelect = {
  id: true,
  certifiedAt: true,
  lines: {
    orderBy: { leaveAccountId: 'asc' as const },
    select: {
      id: true,
      leaveAccountId: true,
      postedBalance: true,
      otherActiveCommitments: true,
      certifiedQuantity: true,
      resultingAvailableQuantity: true,
      leaveCreditCommitmentId: true,
    },
  },
} as const;

const fundingSelect = {
  id: true,
  result: true,
  fiscalAuthorityDocumentVersionId: true,
  fundingSourceSnapshot: true,
  evidenceSnapshot: true,
  reviewedAt: true,
} as const;

const postingSelect = {
  id: true,
  postingKey: true,
  valuationDate: true,
  calculatorKind: true,
  factor: true,
  payrollInputId: true,
  postedAt: true,
} as const;

const adjustmentSelect = {
  id: true,
  scope: true,
  reason: true,
  status: true,
  approvalRequestId: true,
  ownerResult: true,
  appliedAt: true,
  lines: {
    orderBy: { originalLedgerEntryId: 'asc' as const },
    select: {
      id: true,
      originalLedgerEntryId: true,
      retainedQuantity: true,
      reversalLedgerEntryId: true,
      replacementLedgerEntryId: true,
    },
  },
} as const;

type RequestRecord = Prisma.LeaveMonetizationRequestGetPayload<{
  include: {
    employee: { select: typeof requestEmployeeSelect };
    currentVersion: {
      select: typeof versionSelect & {
        allocations: { select: typeof allocationSelect };
        assessments: { select: typeof assessmentSelect; orderBy: { assessedAt: 'desc' }; take: 1 };
        certification: { select: typeof certificationSelect };
        fundingDeterminations: {
          select: typeof fundingSelect;
          orderBy: { reviewedAt: 'desc' };
          take: 1;
        };
        posting: {
          select: typeof postingSelect & {
            adjustments: { select: typeof adjustmentSelect; orderBy: { id: 'asc' } };
          };
        };
      };
    };
    versions: { select: { id: true } };
  };
}>;

@Injectable()
export class LeaveMonetizationService implements OnModuleInit {
  constructor(
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
    @Inject(ApprovalCompletionRegistry)
    private readonly completionRegistry: ApprovalCompletionRegistry,
    @Inject(PAYROLL_MONETIZATION_PORT)
    private readonly payroll: PayrollMonetizationPort,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
    @Inject(MandatoryLeaveAssessmentsService)
    private readonly mandatoryLeave: MandatoryLeaveAssessmentsService,
  ) {}

  onModuleInit(): void {
    this.completionRegistry.register('LEAVE_MONETIZATION', (transaction, context, request) =>
      this.completeMonetizationRequest(transaction, context, request),
    );
    this.completionRegistry.registerDecision(
      'LEAVE_MONETIZATION',
      (transaction, context, request, outcome) =>
        this.decideMonetizationRequest(transaction, context, request, outcome),
    );
    this.completionRegistry.register('LEAVE_MONETIZATION_ADJUSTMENT', (transaction, _, request) =>
      this.completeAdjustment(transaction, request),
    );
    this.completionRegistry.registerDecision(
      'LEAVE_MONETIZATION_ADJUSTMENT',
      (transaction, _, request, outcome) =>
        this.handleAdjustmentDecision(transaction, request, outcome),
    );
  }

  async list(
    context: RequestContext,
    filter: MonetizationListFilters = {},
  ): Promise<MonetizationPage> {
    const scope = await this.requireScope(
      context,
      'leave.accounts.read',
      'MONETIZATION_READ_FORBIDDEN',
    );
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 100);
    const offset = Math.max(filter.offset ?? 0, 0);
    const { records, actorEmployeeId } = await withDatabaseContext(
      this.databaseContext(context),
      async (transaction) => ({
        records: await transaction.leaveMonetizationRequest.findMany({
          where: {
            agencyId: context.agencyId,
            ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
            ...(scope.kind === 'SCOPED'
              ? { AND: [{ employeeId: { in: scope.employeeIds } }] }
              : {}),
            ...(filter.status ? { status: filter.status } : {}),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: offset,
          take: limit + 1,
          include: this.requestInclude(),
        }),
        actorEmployeeId: await this.actorEmployeeId(transaction, context),
      }),
    );
    const hasMore = records.length > limit;
    return {
      items: records.slice(0, limit).map((record) => this.requestSummary(record)),
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
      actorEmployeeId,
    };
  }

  async findById(context: RequestContext, requestId: string): Promise<MonetizationDetail | null> {
    const scope = await this.requireScope(
      context,
      'leave.accounts.read',
      'MONETIZATION_READ_FORBIDDEN',
    );
    const record = await withDatabaseContext(this.databaseContext(context), (transaction) =>
      transaction.leaveMonetizationRequest.findFirst({
        where: { agencyId: context.agencyId, id: requestId },
        include: this.requestInclude(),
      }),
    );
    if (!record) return null;
    if (!scopeCovers(scope, record.employeeId)) throw notFound();
    return this.detail(record);
  }

  async create(
    context: RequestContext,
    input: MonetizationCreateInput,
    rawIdempotencyKey?: string,
  ): Promise<MonetizationRequestSummary> {
    this.assertPermission(context, 'leave.monetization.create', 'MONETIZATION_CREATE_FORBIDDEN');
    const scope = await this.requireScope(
      context,
      'leave.monetization.create',
      'MONETIZATION_CREATE_FORBIDDEN',
    );
    const employeeId =
      scope.kind === 'SCOPED'
        ? (input.employeeId ?? (await this.requireMembershipEmployeeId(context)))
        : input.employeeId;
    if (!employeeId) throw employeeRequired();
    if (!scopeCovers(scope, employeeId)) throw scopeForbidden();
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = canonicalJson({ employeeId });
    return withDatabaseContext(this.databaseContext(context), async (transaction) => {
      if (idempotencyKey) {
        const completed = await this.completedWrite(transaction, context, {
          action: 'LEAVE_MONETIZATION_REQUEST_CREATED',
          idempotencyKey,
          fingerprint,
        });
        if (completed) {
          const record = await this.requireRequest(
            transaction,
            context.agencyId,
            completed.entityId,
          );
          return this.requestSummary(record);
        }
      }
      const employee = await transaction.employee.findFirst({
        where: { agencyId: context.agencyId, id: employeeId },
        select: { id: true },
      });
      if (!employee) throw employeeNotFound();
      const created = await transaction.leaveMonetizationRequest.create({
        data: {
          agencyId: context.agencyId,
          employeeId,
          status: 'DRAFT',
          createdByMembershipId: context.membershipId,
        },
        include: this.requestInclude(),
      });
      await this.audit(transaction, context, {
        action: 'LEAVE_MONETIZATION_REQUEST_CREATED',
        entityId: created.id,
        previousStatus: null,
        newStatus: 'DRAFT',
        reason: 'Leave Monetization Request drafted.',
        idempotencyKey,
        fingerprint,
        metadata: { employeeId },
      });
      return this.requestSummary(created);
    });
  }

  async submit(
    context: RequestContext,
    requestId: string,
    input: MonetizationSubmitInput,
    rawIdempotencyKey?: string,
  ): Promise<MonetizationDetail> {
    this.assertPermission(context, 'leave.monetization.submit', 'MONETIZATION_SUBMIT_FORBIDDEN');
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = canonicalJson(input);
    const effectiveDate = manilaToday();
    return withDatabaseContext(this.databaseContext(context), async (transaction) => {
      const request = await this.lockRequest(transaction, context.agencyId, requestId);
      await this.assertRequestScope(transaction, context, request, 'leave.monetization.submit');
      if (
        input.attestationType === 'AUTHENTICATED_SUBMISSION' &&
        (await this.actorEmployeeId(transaction, context)) !== request.employeeId
      ) {
        throw attestationForbidden();
      }
      if (idempotencyKey) {
        const completed = await this.completedWrite(transaction, context, {
          action: 'LEAVE_MONETIZATION_REQUEST_SUBMITTED',
          entityId: requestId,
          idempotencyKey,
          fingerprint,
        });
        if (completed) {
          const record = await this.requireRequest(transaction, context.agencyId, requestId);
          return this.detail(record);
        }
      }
      if (!['DRAFT', 'NEEDS_INFORMATION'].includes(request.status)) {
        throw statusInvalid('DRAFT or NEEDS_INFORMATION', request.status);
      }
      if (input.kind === 'SPECIAL' && !input.reason?.trim()) throw specialReasonRequired();
      await this.releaseCommitments(
        transaction,
        context.agencyId,
        request.versions.map(({ id }) => id),
      );
      await this.requireDocumentVersion(
        transaction,
        context.agencyId,
        input.formTemplateDocumentVersionId,
        'MONETIZATION_FORM_TEMPLATE_INVALID',
      );
      if (input.attestationDocumentVersionId) {
        await this.requireDocumentVersion(
          transaction,
          context.agencyId,
          input.attestationDocumentVersionId,
          'MONETIZATION_ATTESTATION_INVALID',
        );
      }
      const accounts = new Map(
        (
          await transaction.leaveAccount.findMany({
            where: {
              agencyId: context.agencyId,
              id: { in: input.allocations.map(({ leaveAccountId }) => leaveAccountId) },
            },
            select: {
              id: true,
              employeeId: true,
              status: true,
              leaveType: { select: { code: true } },
            },
          })
        ).map((account) => [account.id, account]),
      );
      const seen = new Set<string>();
      for (const allocation of input.allocations) {
        const account = accounts.get(allocation.leaveAccountId);
        if (!account || account.employeeId !== request.employeeId) {
          throw allocationInvalid('The allocation must reference this Employee Leave Account.');
        }
        if (account.status !== 'ACTIVE') {
          throw allocationInvalid('Leave Monetization requires ACTIVE Leave Accounts.');
        }
        if (seen.has(allocation.leaveAccountId)) {
          throw allocationInvalid('Each Leave Account may appear only once per version.');
        }
        seen.add(allocation.leaveAccountId);
      }
      const policyByAccount = await this.resolvePolicyVersions(
        transaction,
        context.agencyId,
        request.employeeId,
        input.allocations.map(({ leaveAccountId }) => leaveAccountId),
        toDatabaseDate(effectiveDate),
      );
      const versionId = randomUUID();
      const versionNo =
        (
          await transaction.leaveMonetizationRequestVersion.aggregate({
            where: { agencyId: context.agencyId, monetizationRequestId: requestId },
            _max: { versionNo: true },
          })
        )._max.versionNo ?? 0;
      const approval = await this.approvals.createRequestInTransaction(
        transaction,
        context,
        {
          routeCode: LEAVE_MONETIZATION_ROUTE_CODE,
          subjectType: 'LEAVE_MONETIZATION',
          subjectId: versionId,
          effectiveDate,
        },
        idempotencyKey ? `${idempotencyKey}:approval-create` : undefined,
      );
      await transaction.leaveMonetizationRequestVersion.create({
        data: {
          id: versionId,
          agencyId: context.agencyId,
          monetizationRequestId: requestId,
          versionNo: versionNo + 1,
          kind: input.kind,
          approvalRouteVersionId: approval.route.id,
          approvalRequestId: approval.id,
          formTemplateDocumentVersionId: input.formTemplateDocumentVersionId,
          attestationType: input.attestationType,
          attestationDocumentVersionId: input.attestationDocumentVersionId ?? null,
          submittedByMembershipId: context.membershipId,
          employeeAttestedAt:
            input.attestationType === 'AUTHENTICATED_SUBMISSION' ? new Date() : null,
          reason: input.reason?.trim() || null,
          authoritySnapshot: input.authoritySnapshot as Prisma.InputJsonValue,
          submittedAt: new Date(),
          allocations: {
            create: input.allocations.map((allocation) => ({
              agency: { connect: { id: context.agencyId } },
              leaveAccount: {
                connect: {
                  agencyId_id: {
                    agencyId: context.agencyId,
                    id: allocation.leaveAccountId,
                  },
                },
              },
              policyVersion: {
                connect: {
                  agencyId_id: {
                    agencyId: context.agencyId,
                    id: policyByAccount.get(allocation.leaveAccountId)!,
                  },
                },
              },
              requestedQuantity: new Prisma.Decimal(allocation.requestedQuantity),
            })),
          },
        },
      });
      const updated = await transaction.leaveMonetizationRequest.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: requestId } },
        data: { status: 'SUBMITTED', currentVersionId: versionId },
        include: this.requestInclude(),
      });
      await this.audit(transaction, context, {
        action: 'LEAVE_MONETIZATION_REQUEST_SUBMITTED',
        entityId: requestId,
        previousStatus: request.status,
        newStatus: 'SUBMITTED',
        reason: 'Leave Monetization Request version submitted for assessment.',
        idempotencyKey,
        fingerprint,
        metadata: { versionId, versionNo: versionNo + 1, kind: input.kind },
      });
      return this.detail(updated);
    });
  }

  private async resolvePolicyVersions(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    leaveAccountIds: readonly string[],
    effectiveDate: Date,
  ): Promise<Map<string, string>> {
    const accounts = await transaction.leaveAccount.findMany({
      where: { agencyId, employeeId, id: { in: [...leaveAccountIds] } },
      select: { id: true, leaveTypeId: true },
    });
    const resolved = new Map<string, string>();
    for (const account of accounts) {
      const policy = await transaction.leavePolicyVersion.findFirst({
        where: {
          agencyId,
          leaveTypeId: account.leaveTypeId,
          status: { in: ['ACTIVE', 'SUPERSEDED'] },
          effectiveFrom: { lte: effectiveDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveDate } }],
        },
        orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
        select: { id: true },
      });
      if (!policy) throw policyNotEffective();
      resolved.set(account.id, policy.id);
    }
    return resolved;
  }

  async assess(
    context: RequestContext,
    requestId: string,
    input: MonetizationAssessmentInput,
    rawIdempotencyKey?: string,
  ): Promise<MonetizationDetail> {
    this.assertPermission(context, 'leave.monetization.certify', 'MONETIZATION_CERTIFY_FORBIDDEN');
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = canonicalJson(input);
    const effectiveDate = input.balanceEffectiveDate ?? manilaToday();
    return withDatabaseContext(this.databaseContext(context), async (transaction) => {
      const request = await this.lockRequest(transaction, context.agencyId, requestId);
      if (!request.currentVersionId) throw versionMissing();
      if (request.status !== 'SUBMITTED') throw statusInvalid('SUBMITTED', request.status);
      await this.assertActorSeparation(transaction, context, request, {
        prohibitSubject: true,
      });
      if (idempotencyKey) {
        const completed = await this.completedWrite(transaction, context, {
          action: 'MONETIZATION_ELIGIBILITY_ASSESSED',
          entityId: requestId,
          idempotencyKey,
          fingerprint,
        });
        if (completed) {
          const record = await this.requireRequest(transaction, context.agencyId, requestId);
          return this.detail(record);
        }
      }
      const version = await this.requireCurrentVersion(transaction, context.agencyId, request);
      const facts = await this.buildAssessmentFacts(
        transaction,
        context.agencyId,
        request,
        version,
        effectiveDate,
      );
      const assessment = assessMonetization(facts);
      await transaction.monetizationEligibilityAssessment.create({
        data: {
          agencyId: context.agencyId,
          monetizationRequestVersionId: version.id,
          result: assessment.result,
          balanceEffectiveDate: toDatabaseDate(effectiveDate),
          ledgerCutoff: new Date(),
          inputFacts: this.serializeFacts(facts),
          ruleResults: assessment.ruleResults as unknown as Prisma.InputJsonValue,
          assessedByMembershipId: context.membershipId,
          assessedAt: new Date(),
        },
      });
      await this.audit(transaction, context, {
        action: 'MONETIZATION_ELIGIBILITY_ASSESSED',
        entityId: requestId,
        previousStatus: request.status,
        newStatus: request.status,
        reason: 'Monetization eligibility assessed against the current accounts and authorities.',
        idempotencyKey,
        fingerprint,
        metadata: { result: assessment.result, versionId: version.id },
      });
      const record = await this.requireRequest(transaction, context.agencyId, requestId);
      return this.detail(record);
    });
  }

  async certify(
    context: RequestContext,
    requestId: string,
    input: MonetizationCertificationInput,
    rawIdempotencyKey?: string,
  ): Promise<MonetizationDetail> {
    this.assertPermission(context, 'leave.monetization.certify', 'MONETIZATION_CERTIFY_FORBIDDEN');
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = canonicalJson(input);
    return withDatabaseContext(this.databaseContext(context), async (transaction) => {
      const request = await this.lockRequest(transaction, context.agencyId, requestId);
      await this.assertRequestScope(transaction, context, request, 'leave.monetization.certify');
      if (request.status !== 'SUBMITTED') throw statusInvalid('SUBMITTED', request.status);
      await this.assertActorSeparation(transaction, context, request, {
        prohibitSubject: true,
        prohibitSubmitter: true,
        prohibitRecorder: true,
      });
      if (idempotencyKey) {
        const completed = await this.completedWrite(transaction, context, {
          action: 'MONETIZATION_CREDITS_CERTIFIED',
          entityId: requestId,
          idempotencyKey,
          fingerprint,
        });
        if (completed) {
          const record = await this.requireRequest(transaction, context.agencyId, requestId);
          return this.detail(record);
        }
      }
      const version = await this.requireCurrentVersion(transaction, context.agencyId, request);
      const assessment = await transaction.monetizationEligibilityAssessment.findFirst({
        where: { agencyId: context.agencyId, monetizationRequestVersionId: version.id },
        orderBy: { assessedAt: 'desc' },
      });
      if (!assessment || assessment.result !== 'ELIGIBLE') {
        throw assessmentNotEligible(assessment?.result ?? null);
      }
      const allocations = await transaction.leaveMonetizationAllocation.findMany({
        where: { agencyId: context.agencyId, monetizationRequestVersionId: version.id },
        orderBy: { leaveAccountId: 'asc' },
      });
      const certifiedByAllocation = new Map(
        input.allocations.map(({ allocationId, certifiedQuantity }) => [
          allocationId,
          certifiedQuantity,
        ]),
      );
      const now = new Date();
      const certificationId = randomUUID();
      const lines: Array<{
        allocationId: string;
        leaveAccountId: string;
        postedBalance: Prisma.Decimal;
        otherActiveCommitments: Prisma.Decimal;
        certifiedQuantity: Prisma.Decimal;
        resultingAvailableQuantity: Prisma.Decimal;
      }> = [];
      for (const allocation of allocations) {
        await this.lockAccount(transaction, context.agencyId, allocation.leaveAccountId);
        const certifiedQuantity = new Prisma.Decimal(
          certifiedByAllocation.get(allocation.id) ?? allocation.requestedQuantity,
        );
        if (
          certifiedQuantity.lessThanOrEqualTo(0) ||
          certifiedQuantity.greaterThan(allocation.requestedQuantity)
        ) {
          throw allocationInvalid(
            'Certified quantities must be positive and may only narrow the request.',
          );
        }
        const balances = await this.balanceSnapshot(
          transaction,
          context.agencyId,
          allocation.leaveAccountId,
          assessment.balanceEffectiveDate,
          now,
        );
        const available = balances.posted.minus(balances.committed);
        if (certifiedQuantity.greaterThan(available))
          throw insufficientBalance(available, certifiedQuantity);
        if (version.kind === 'REGULAR') {
          if (available.lessThan(REGULAR_MONETIZATION_RULES.minimumPostedBalance)) {
            throw ruleFailed(
              'REGULAR_MINIMUM_BALANCE',
              'At least 15 vacation-leave days must stand to the credit of the employee.',
            );
          }
          if (
            available.minus(certifiedQuantity).lessThan(REGULAR_MONETIZATION_RULES.retainedQuantity)
          ) {
            throw ruleFailed(
              'REGULAR_RETAIN_FIVE_DAYS',
              'At least five vacation-leave days must remain after monetization.',
            );
          }
        }
        lines.push({
          allocationId: allocation.id,
          leaveAccountId: allocation.leaveAccountId,
          postedBalance: balances.posted,
          otherActiveCommitments: balances.committed,
          certifiedQuantity,
          resultingAvailableQuantity: available.minus(certifiedQuantity),
        });
      }
      await transaction.monetizationCreditCertification.create({
        data: {
          id: certificationId,
          agencyId: context.agencyId,
          monetizationRequestVersionId: version.id,
          eligibilityAssessmentId: assessment.id,
          certifiedByMembershipId: context.membershipId,
          certifiedAt: now,
        },
      });
      for (const line of lines) {
        const lineId = randomUUID();
        const commitmentId = randomUUID();
        await transaction.leaveCreditCommitment.create({
          data: {
            id: commitmentId,
            agencyId: context.agencyId,
            leaveAccountId: line.leaveAccountId,
            quantity: line.certifiedQuantity,
            sourceType: CERTIFICATION_LINE_SOURCE_TYPE,
            sourceId: lineId,
            sourceCommitmentKey: 'CERTIFIED',
            status: 'ACTIVE',
            effectiveFrom: now,
          },
        });
        await transaction.monetizationCreditCertificationLine.create({
          data: {
            id: lineId,
            agencyId: context.agencyId,
            monetizationCreditCertificationId: certificationId,
            monetizationAllocationId: line.allocationId,
            leaveAccountId: line.leaveAccountId,
            postedBalance: line.postedBalance,
            otherActiveCommitments: line.otherActiveCommitments,
            certifiedQuantity: line.certifiedQuantity,
            resultingAvailableQuantity: line.resultingAvailableQuantity,
            leaveCreditCommitmentId: commitmentId,
          },
        });
      }
      const updated = await transaction.leaveMonetizationRequest.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: requestId } },
        data: { status: 'CREDIT_CERTIFIED' },
        include: this.requestInclude(),
      });
      await this.audit(transaction, context, {
        action: 'MONETIZATION_CREDITS_CERTIFIED',
        entityId: requestId,
        previousStatus: request.status,
        newStatus: 'CREDIT_CERTIFIED',
        reason: 'Monetization credits certified with one Leave Credit Commitment per allocation.',
        idempotencyKey,
        fingerprint,
        metadata: {
          versionId: version.id,
          certificationId,
          lines: lines.map((line) => ({
            leaveAccountId: line.leaveAccountId,
            certifiedQuantity: formatQuantity(line.certifiedQuantity),
          })),
        },
      });
      return this.detail(updated);
    });
  }

  async returnRequest(
    context: RequestContext,
    requestId: string,
    input: MonetizationReturnInput,
    rawIdempotencyKey?: string,
  ): Promise<MonetizationDetail> {
    this.assertPermission(context, 'leave.monetization.return', 'MONETIZATION_RETURN_FORBIDDEN');
    return withDatabaseContext(this.databaseContext(context), async (transaction) => {
      const request = await this.lockRequest(transaction, context.agencyId, requestId);
      if (!['SUBMITTED', 'CREDIT_CERTIFIED'].includes(request.status)) {
        throw statusInvalid('SUBMITTED or CREDIT_CERTIFIED', request.status);
      }
      await this.assertActorSeparation(transaction, context, request, {
        prohibitSubject: true,
      });
      if (request.currentVersionId) {
        const version = await transaction.leaveMonetizationRequestVersion.findFirst({
          where: { agencyId: context.agencyId, id: request.currentVersionId },
          select: { approvalRequestId: true },
        });
        if (version) {
          await this.cancelApprovalRequest(
            transaction,
            context,
            version.approvalRequestId,
            input.reason,
            rawIdempotencyKey,
          );
        }
      }
      await this.releaseCommitments(
        transaction,
        context.agencyId,
        request.versions.map(({ id }) => id),
      );
      const updated = await transaction.leaveMonetizationRequest.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: requestId } },
        data: { status: 'NEEDS_INFORMATION' },
        include: this.requestInclude(),
      });
      await this.audit(transaction, context, {
        action: 'LEAVE_MONETIZATION_REQUEST_RETURNED',
        entityId: requestId,
        previousStatus: request.status,
        newStatus: 'NEEDS_INFORMATION',
        reason: input.reason,
        idempotencyKey: rawIdempotencyKey?.trim() || null,
        metadata: {},
      });
      return this.detail(updated);
    });
  }

  async withdraw(
    context: RequestContext,
    requestId: string,
    input: MonetizationReturnInput,
  ): Promise<MonetizationDetail> {
    this.assertPermission(
      context,
      'leave.monetization.withdraw',
      'MONETIZATION_WITHDRAW_FORBIDDEN',
    );
    return withDatabaseContext(this.databaseContext(context), async (transaction) => {
      const request = await this.lockRequest(transaction, context.agencyId, requestId);
      await this.assertRequestScope(transaction, context, request, 'leave.monetization.withdraw');
      if (
        !['SUBMITTED', 'CREDIT_CERTIFIED', 'NEEDS_INFORMATION', 'FOR_APPROVAL'].includes(
          request.status,
        )
      ) {
        throw statusInvalid(
          'SUBMITTED, CREDIT_CERTIFIED, NEEDS_INFORMATION or FOR_APPROVAL',
          request.status,
        );
      }
      if (request.currentVersionId) {
        const version = await transaction.leaveMonetizationRequestVersion.findFirst({
          where: { agencyId: context.agencyId, id: request.currentVersionId },
          select: { approvalRequestId: true },
        });
        if (version) {
          await this.cancelApprovalRequest(
            transaction,
            context,
            version.approvalRequestId,
            input.reason,
          );
        }
      }
      await this.releaseCommitments(
        transaction,
        context.agencyId,
        request.versions.map(({ id }) => id),
      );
      const updated = await transaction.leaveMonetizationRequest.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: requestId } },
        data: { status: 'WITHDRAWN' },
        include: this.requestInclude(),
      });
      await this.audit(transaction, context, {
        action: 'LEAVE_MONETIZATION_REQUEST_WITHDRAWN',
        entityId: requestId,
        previousStatus: request.status,
        newStatus: 'WITHDRAWN',
        reason: input.reason,
        metadata: {},
      });
      return this.detail(updated);
    });
  }

  async cancel(
    context: RequestContext,
    requestId: string,
    input: MonetizationReturnInput,
  ): Promise<MonetizationDetail> {
    this.assertPermission(context, 'leave.monetization.cancel', 'MONETIZATION_CANCEL_FORBIDDEN');
    return withDatabaseContext(this.databaseContext(context), async (transaction) => {
      const request = await this.lockRequest(transaction, context.agencyId, requestId);
      if (!['DRAFT', 'APPROVED'].includes(request.status)) {
        throw statusInvalid('DRAFT or APPROVED', request.status);
      }
      if (request.currentVersionId) {
        const version = await transaction.leaveMonetizationRequestVersion.findFirst({
          where: { agencyId: context.agencyId, id: request.currentVersionId },
          select: { approvalRequestId: true },
        });
        if (version) {
          await this.cancelApprovalRequest(
            transaction,
            context,
            version.approvalRequestId,
            input.reason,
          );
        }
      }
      await this.releaseCommitments(
        transaction,
        context.agencyId,
        request.versions.map(({ id }) => id),
      );
      const updated = await transaction.leaveMonetizationRequest.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: requestId } },
        data: { status: 'CANCELLED' },
        include: this.requestInclude(),
      });
      await this.audit(transaction, context, {
        action: 'LEAVE_MONETIZATION_REQUEST_CANCELLED',
        entityId: requestId,
        previousStatus: request.status,
        newStatus: 'CANCELLED',
        reason: input.reason,
        metadata: {},
      });
      return this.detail(updated);
    });
  }

  async determineFunding(
    context: RequestContext,
    requestId: string,
    input: MonetizationFundingInput,
    rawIdempotencyKey?: string,
  ): Promise<MonetizationDetail> {
    this.assertPermission(
      context,
      'leave.monetization.review_funding',
      'MONETIZATION_FUNDING_FORBIDDEN',
    );
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = canonicalJson(input);
    return withDatabaseContext(this.databaseContext(context), async (transaction) => {
      const request = await this.lockRequest(transaction, context.agencyId, requestId);
      if (request.status !== 'CREDIT_CERTIFIED') {
        throw statusInvalid('CREDIT_CERTIFIED', request.status);
      }
      await this.assertActorSeparation(transaction, context, request, {
        prohibitSubject: true,
        prohibitSubmitter: true,
        prohibitCertifier: true,
      });
      if (idempotencyKey) {
        const completed = await this.completedWrite(transaction, context, {
          action: 'MONETIZATION_FUNDING_DETERMINED',
          entityId: requestId,
          idempotencyKey,
          fingerprint,
        });
        if (completed) {
          const record = await this.requireRequest(transaction, context.agencyId, requestId);
          return this.detail(record);
        }
      }
      const version = await this.requireCurrentVersion(transaction, context.agencyId, request);
      await this.requireDocumentVersion(
        transaction,
        context.agencyId,
        input.fiscalAuthorityDocumentVersionId,
        'MONETIZATION_FISCAL_AUTHORITY_INVALID',
      );
      const now = new Date();
      await transaction.monetizationFundingDetermination.create({
        data: {
          agencyId: context.agencyId,
          monetizationRequestVersionId: version.id,
          result: input.result,
          fiscalAuthorityDocumentVersionId: input.fiscalAuthorityDocumentVersionId,
          fundingSourceSnapshot: input.fundingSourceSnapshot as Prisma.InputJsonValue,
          evidenceSnapshot: input.evidenceSnapshot as Prisma.InputJsonValue,
          reviewedByMembershipId: context.membershipId,
          reviewedAt: now,
        },
      });
      let status: MonetizationStatus = 'NEEDS_INFORMATION';
      if (input.result === 'SUPPORTED') {
        await this.approvals.submitInTransaction(
          transaction,
          context,
          version.approvalRequestId,
          idempotencyKey ? `${idempotencyKey}:approval-submit` : undefined,
          { requireDrafter: false },
        );
        status = 'FOR_APPROVAL';
      } else {
        await this.cancelApprovalRequest(
          transaction,
          context,
          version.approvalRequestId,
          'Funding determination blocked the request.',
          idempotencyKey ? `${idempotencyKey}:approval-cancel` : undefined,
        );
        await this.releaseCommitments(transaction, context.agencyId, [version.id]);
      }
      const updated = await transaction.leaveMonetizationRequest.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: requestId } },
        data: { status },
        include: this.requestInclude(),
      });
      await this.audit(transaction, context, {
        action: 'MONETIZATION_FUNDING_DETERMINED',
        entityId: requestId,
        previousStatus: request.status,
        newStatus: status,
        reason:
          input.result === 'SUPPORTED'
            ? 'Funding is supported; the bound Approval Route proceeds to review.'
            : 'Funding is not supported and blocks the request.',
        idempotencyKey,
        fingerprint,
        metadata: { result: input.result, versionId: version.id },
      });
      return this.detail(updated);
    });
  }

  async decide(
    context: RequestContext,
    requestId: string,
    input: MonetizationDecisionInput,
    rawIdempotencyKey?: string,
  ): Promise<MonetizationDetail> {
    const permission =
      input.decision === 'APPROVE' ? 'leave.monetization.approve' : 'leave.monetization.reject';
    this.assertPermission(context, permission, 'MONETIZATION_DECISION_FORBIDDEN');
    return withDatabaseContext(this.databaseContext(context), async (transaction) => {
      const request = await this.lockRequest(transaction, context.agencyId, requestId);
      if (request.status !== 'FOR_APPROVAL') throw statusInvalid('FOR_APPROVAL', request.status);
      await this.assertActorSeparation(transaction, context, request, {
        prohibitSubject: true,
        prohibitSubmitter: true,
        prohibitCertifier: true,
        prohibitFunding: true,
      });
      const version = await this.requireCurrentVersion(transaction, context.agencyId, request);
      if (input.decision === 'APPROVE' && input.approvedAllocations?.length) {
        await this.narrowAllocations(transaction, context, version.id, input.approvedAllocations);
      }
      await this.approvals.decideInTransaction(
        transaction,
        context,
        version.approvalRequestId,
        input.decision,
        input.comments,
        rawIdempotencyKey,
      );
      const record = await this.requireRequest(transaction, context.agencyId, requestId);
      return this.detail(record);
    });
  }

  async post(
    context: RequestContext,
    requestId: string,
    rawIdempotencyKey?: string,
  ): Promise<MonetizationPostResult> {
    this.assertPermission(context, 'leave.monetization.post', 'MONETIZATION_POST_FORBIDDEN');
    const existing = await withDatabaseContext(this.databaseContext(context), (transaction) =>
      this.postingForRequest(transaction, context.agencyId, requestId),
    );
    if (existing) {
      const record = await this.requireRequestWithContext(context, requestId);
      return { outcome: 'ALREADY_POSTED', request: this.requestSummary(record), posting: existing };
    }
    const preparation = await withDatabaseContext(
      this.databaseContext(context),
      async (transaction) => {
        const request = await this.lockRequest(transaction, context.agencyId, requestId);
        if (request.status !== 'APPROVED') throw statusInvalid('APPROVED', request.status);
        await this.assertActorSeparation(transaction, context, request, {
          prohibitSubject: true,
          prohibitSubmitter: true,
          prohibitCertifier: true,
          prohibitFunding: true,
          prohibitApprover: true,
        });
        const version = await this.requireCurrentVersion(transaction, context.agencyId, request);
        const certification = await transaction.monetizationCreditCertification.findFirst({
          where: { agencyId: context.agencyId, monetizationRequestVersionId: version.id },
          include: {
            lines: {
              include: {
                allocation: { select: { approvedQuantity: true, policyVersionId: true } },
              },
            },
          },
        });
        if (!certification || certification.lines.length === 0) throw certificationMissing();
        const funding = await transaction.monetizationFundingDetermination.findFirst({
          where: {
            agencyId: context.agencyId,
            monetizationRequestVersionId: version.id,
            result: 'SUPPORTED',
          },
          orderBy: { reviewedAt: 'desc' },
        });
        if (!funding) throw fundingMissing();
        const authority = version.authoritySnapshot as unknown as MonetizationAuthoritySnapshot;
        const valuationDate = authority.valuationDate ?? formatDate(certification.certifiedAt);
        return {
          requestVersionId: version.id,
          employeeId: request.employeeId,
          employeeNumber: request.employee.employeeNumber,
          employeeName: request.employee.legalName,
          kind: version.kind,
          valuationDate,
          fiscalPeriod: authority.fiscalPeriod ?? null,
          authoritySnapshot: version.authoritySnapshot,
          fundingId: funding.id,
          fundingSnapshot: funding.fundingSourceSnapshot,
          approvalRequestId: version.approvalRequestId,
          allocationLines: certification.lines.map((line) => ({
            lineId: line.id,
            leaveAccountId: line.leaveAccountId,
            policyVersionId: line.allocation.policyVersionId,
            certifiedQuantity: line.certifiedQuantity,
            approvedQuantity: line.allocation?.approvedQuantity ?? null,
          })),
        };
      },
    );
    const postingKey = `MONETIZATION:${preparation.requestVersionId}`;
    const allocations: MonetizationEarningAllocation[] = preparation.allocationLines.map(
      (line) => ({
        leaveAccountId: line.leaveAccountId,
        leaveTypeCode: preparation.kind,
        policyVersionId: line.policyVersionId,
        quantity: formatQuantity(line.approvedQuantity ?? line.certifiedQuantity),
      }),
    );
    const quantity = allocations.reduce(
      (total, allocation) => total.plus(new Prisma.Decimal(allocation.quantity)),
      new Prisma.Decimal(0),
    );
    const result = await this.payroll.submitEarningInput(
      { agencyId: context.agencyId, userId: context.userId, membershipId: context.membershipId },
      {
        agencyId: context.agencyId,
        employeeId: preparation.employeeId,
        postingKey,
        monetizationRequestId: requestId,
        monetizationRequestVersionId: preparation.requestVersionId,
        fundingDeterminationId: preparation.fundingId,
        approvalRequestId: preparation.approvalRequestId,
        valuationDate: preparation.valuationDate,
        fiscalPeriod: preparation.fiscalPeriod,
        calculatorKind: MONETIZATION_CALCULATOR_KIND,
        factor: MONETIZATION_FACTOR,
        quantity: formatQuantity(quantity),
        allocations,
        authoritySnapshot: preparation.authoritySnapshot,
        fundingSnapshot: preparation.fundingSnapshot,
        approvalSnapshot: { approvalRequestId: preparation.approvalRequestId },
      },
    );
    if (!isAccepted(result)) {
      throw payrollHandoffError(result);
    }
    await withDatabaseContext(this.databaseContext(context), async (transaction) => {
      const request = await this.lockRequest(transaction, context.agencyId, requestId);
      const alreadyPosted = await transaction.monetizationPosting.findFirst({
        where: {
          agencyId: context.agencyId,
          monetizationRequestVersionId: preparation.requestVersionId,
        },
        select: { id: true },
      });
      if (alreadyPosted || request.status === 'POSTED') return;
      const now = new Date();
      for (const line of preparation.allocationLines) {
        const quantity = new Prisma.Decimal(
          formatQuantity(line.approvedQuantity ?? line.certifiedQuantity),
        );
        await this.lockAccount(transaction, context.agencyId, line.leaveAccountId);
        await transaction.leaveLedgerEntry.create({
          data: {
            agencyId: context.agencyId,
            leaveAccountId: line.leaveAccountId,
            quantity: quantity.negated(),
            effectiveDate: toDatabaseDate(preparation.valuationDate),
            sourceType: POSTING_SOURCE_TYPE,
            sourceId: preparation.requestVersionId,
            sourcePostingKey: `${postingKey}:${line.lineId}`,
            policyVersionId: line.policyVersionId,
            postedByMembershipId: context.membershipId,
          },
        });
        await transaction.leaveCreditCommitment.updateMany({
          where: {
            agencyId: context.agencyId,
            leaveAccountId: line.leaveAccountId,
            sourceType: CERTIFICATION_LINE_SOURCE_TYPE,
            sourceId: line.lineId,
            status: 'ACTIVE',
          },
          data: { status: 'CONSUMED', endedAt: now },
        });
      }
      await this.mandatoryLeave.reevaluateLeaveAccounts(
        transaction,
        context,
        preparation.allocationLines.map(({ leaveAccountId }) => ({
          leaveAccountId,
          effectiveDate: toDatabaseDate(preparation.valuationDate),
        })),
      );
      await transaction.monetizationPosting.create({
        data: {
          agencyId: context.agencyId,
          monetizationRequestVersionId: preparation.requestVersionId,
          postingKey,
          valuationDate: toDatabaseDate(preparation.valuationDate),
          calculatorKind: MONETIZATION_CALCULATOR_KIND,
          factor: new Prisma.Decimal(MONETIZATION_FACTOR),
          payrollInputId: result.payrollInputId,
          payrollResult: {
            kind: result.kind,
            amount: result.amount,
            payrollResult: result.payrollResult as Prisma.JsonValue,
          },
          postedByMembershipId: context.membershipId,
          postedAt: now,
        },
      });
      await transaction.leaveMonetizationRequest.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: requestId } },
        data: { status: 'POSTED' },
      });
      await this.audit(transaction, context, {
        action: 'MONETIZATION_POSTED',
        entityId: requestId,
        previousStatus: request.status,
        newStatus: 'POSTED',
        reason: 'Payroll accepted the Monetization Earning Input; credits and commitments settled.',
        idempotencyKey: rawIdempotencyKey?.trim() || null,
        metadata: {
          versionId: preparation.requestVersionId,
          postingKey,
          payrollInputId: result.payrollInputId,
          amount: result.amount,
        },
      });
    });
    const record = await this.requireRequestWithContext(context, requestId);
    const posting = await withDatabaseContext(this.databaseContext(context), (transaction) =>
      this.postingForRequest(transaction, context.agencyId, requestId),
    );
    return { outcome: 'POSTED', request: this.requestSummary(record), posting };
  }

  async createAdjustment(
    context: RequestContext,
    postingId: string,
    input: MonetizationAdjustmentCreateInput,
    rawIdempotencyKey?: string,
  ): Promise<MonetizationAdjustmentSummary> {
    this.assertPermission(context, 'leave.monetization.adjust', 'MONETIZATION_ADJUST_FORBIDDEN');
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = canonicalJson(input);
    const effectiveDate = manilaToday();
    return withDatabaseContext(this.databaseContext(context), async (transaction) => {
      const posting = await transaction.monetizationPosting.findFirst({
        where: { agencyId: context.agencyId, id: postingId },
        include: {
          requestVersion: {
            select: {
              id: true,
              monetizationRequestId: true,
              request: { select: { employeeId: true } },
            },
          },
        },
      });
      if (!posting) throw postingNotFound();
      if (idempotencyKey) {
        const completed = await this.completedWrite(transaction, context, {
          action: 'MONETIZATION_ADJUSTMENT_CREATED',
          idempotencyKey,
          fingerprint,
        });
        if (completed) {
          const adjustment = await transaction.monetizationAdjustment.findFirst({
            where: { agencyId: context.agencyId, id: completed.entityId },
            select: adjustmentSelect,
          });
          if (!adjustment) throw adjustmentNotFound();
          return this.adjustmentSummary(adjustment);
        }
      }
      const originals = await transaction.leaveLedgerEntry.findMany({
        where: {
          agencyId: context.agencyId,
          sourceType: POSTING_SOURCE_TYPE,
          sourceId: posting.monetizationRequestVersionId,
        },
        select: { id: true, leaveAccountId: true, quantity: true, policyVersionId: true },
      });
      const originalById = new Map(originals.map((entry) => [entry.id, entry]));
      const adjustedAlready = new Set(
        (
          await transaction.monetizationAdjustmentLine.findMany({
            where: {
              agencyId: context.agencyId,
              originalLedgerEntryId: { in: originals.map(({ id }) => id) },
            },
            select: { originalLedgerEntryId: true },
          })
        ).map(({ originalLedgerEntryId }) => originalLedgerEntryId),
      );
      for (const line of input.lines) {
        const original = originalById.get(line.originalLedgerEntryId);
        if (!original)
          throw adjustmentLineInvalid('The line must reference a posting ledger entry.');
        if (adjustedAlready.has(line.originalLedgerEntryId)) {
          throw adjustmentLineInvalid('That ledger entry already has a Monetization Adjustment.');
        }
        const retained = new Prisma.Decimal(line.retainedQuantity);
        const originalQuantity = original.quantity.negated();
        if (retained.greaterThan(originalQuantity)) {
          throw adjustmentLineInvalid('Retained quantities may not exceed the original deduction.');
        }
        if (input.scope === 'WHOLE' && !retained.isZero()) {
          throw adjustmentLineInvalid('A whole adjustment retains no credits.');
        }
      }
      if (input.scope === 'PARTIAL') {
        const reversed = input.lines.reduce(
          (total, line) =>
            total.plus(
              new Prisma.Decimal(
                originalById.get(line.originalLedgerEntryId)!.quantity.negated(),
              ).minus(line.retainedQuantity),
            ),
          new Prisma.Decimal(0),
        );
        if (reversed.lessThanOrEqualTo(0)) {
          throw adjustmentLineInvalid('A partial adjustment must reverse a positive quantity.');
        }
      }
      const adjustmentId = randomUUID();
      const approval = await this.approvals.createRequestInTransaction(
        transaction,
        context,
        {
          routeCode: LEAVE_MONETIZATION_ADJUSTMENT_ROUTE_CODE,
          subjectType: 'LEAVE_MONETIZATION_ADJUSTMENT',
          subjectId: adjustmentId,
          effectiveDate,
        },
        idempotencyKey ? `${idempotencyKey}:approval-create` : undefined,
      );
      await transaction.monetizationAdjustment.create({
        data: {
          id: adjustmentId,
          agencyId: context.agencyId,
          monetizationPostingId: posting.id,
          scope: input.scope,
          reason: input.reason,
          approvalRouteVersionId: approval.route.id,
          approvalRequestId: approval.id,
          status: 'DRAFT',
        },
      });
      for (const line of input.lines) {
        await transaction.monetizationAdjustmentLine.create({
          data: {
            agencyId: context.agencyId,
            monetizationAdjustmentId: adjustmentId,
            originalLedgerEntryId: line.originalLedgerEntryId,
            retainedQuantity: new Prisma.Decimal(line.retainedQuantity),
          },
        });
      }
      await this.audit(transaction, context, {
        action: 'MONETIZATION_ADJUSTMENT_CREATED',
        entityType: 'MonetizationAdjustment',
        entityId: adjustmentId,
        previousStatus: null,
        newStatus: 'DRAFT',
        reason: input.reason,
        idempotencyKey,
        fingerprint,
        metadata: { postingId, scope: input.scope, lines: input.lines.length },
      });
      const adjustment = await transaction.monetizationAdjustment.findFirst({
        where: { agencyId: context.agencyId, id: adjustmentId },
        select: adjustmentSelect,
      });
      if (!adjustment) throw adjustmentNotFound();
      return this.adjustmentSummary(adjustment);
    });
  }

  async submitAdjustment(
    context: RequestContext,
    adjustmentId: string,
    rawIdempotencyKey?: string,
  ): Promise<MonetizationAdjustmentSummary> {
    this.assertPermission(context, 'leave.monetization.adjust', 'MONETIZATION_ADJUST_FORBIDDEN');
    return withDatabaseContext(this.databaseContext(context), async (transaction) => {
      const adjustment = await this.lockAdjustment(transaction, context.agencyId, adjustmentId);
      if (adjustment.status !== 'DRAFT') throw adjustmentStatusInvalid('DRAFT', adjustment.status);
      await this.approvals.submitInTransaction(
        transaction,
        context,
        adjustment.approvalRequestId,
        rawIdempotencyKey ? `${rawIdempotencyKey.trim()}:approval-submit` : undefined,
        { requireDrafter: false },
      );
      const updated = await transaction.monetizationAdjustment.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: adjustmentId } },
        data: { status: 'FOR_APPROVAL' },
        select: adjustmentSelect,
      });
      await this.audit(transaction, context, {
        action: 'MONETIZATION_ADJUSTMENT_SUBMITTED',
        entityType: 'MonetizationAdjustment',
        entityId: adjustmentId,
        previousStatus: adjustment.status,
        newStatus: 'FOR_APPROVAL',
        reason: 'Monetization Adjustment submitted for approval.',
        idempotencyKey: rawIdempotencyKey?.trim() || null,
        metadata: {},
      });
      return this.adjustmentSummary(updated);
    });
  }

  async decideAdjustment(
    context: RequestContext,
    adjustmentId: string,
    input: MonetizationDecisionInput,
    rawIdempotencyKey?: string,
  ): Promise<MonetizationAdjustmentApplyResult> {
    const permission =
      input.decision === 'APPROVE' ? 'leave.monetization.approve' : 'leave.monetization.reject';
    this.assertPermission(context, permission, 'MONETIZATION_DECISION_FORBIDDEN');
    const summary = await withDatabaseContext(
      this.databaseContext(context),
      async (transaction) => {
        const adjustment = await this.lockAdjustment(transaction, context.agencyId, adjustmentId);
        if (adjustment.status !== 'FOR_APPROVAL') {
          throw adjustmentStatusInvalid('FOR_APPROVAL', adjustment.status);
        }
        await this.approvals.decideInTransaction(
          transaction,
          context,
          adjustment.approvalRequestId,
          input.decision,
          input.comments,
          rawIdempotencyKey,
        );
        const updated = await transaction.monetizationAdjustment.findFirst({
          where: { agencyId: context.agencyId, id: adjustmentId },
          select: adjustmentSelect,
        });
        if (!updated) throw adjustmentNotFound();
        return this.adjustmentSummary(updated);
      },
    );
    if (summary.status !== 'APPROVED')
      return { adjustment: summary, ownerResult: summary.ownerResult };
    const applied = await this.apply(context, adjustmentId, rawIdempotencyKey);
    return { adjustment: applied.adjustment, ownerResult: applied.ownerResult };
  }

  async apply(
    context: RequestContext,
    adjustmentId: string,
    rawIdempotencyKey?: string,
  ): Promise<MonetizationAdjustmentApplyResult> {
    this.assertPermission(context, 'leave.monetization.adjust', 'MONETIZATION_ADJUST_FORBIDDEN');
    const preparation = await withDatabaseContext(
      this.databaseContext(context),
      async (transaction) => {
        const adjustment = await transaction.monetizationAdjustment.findFirst({
          where: { agencyId: context.agencyId, id: adjustmentId },
          include: {
            posting: {
              include: {
                requestVersion: {
                  select: { request: { select: { employeeId: true } } },
                },
              },
            },
            lines: {
              include: {
                originalEntry: {
                  select: { id: true, leaveAccountId: true, quantity: true, policyVersionId: true },
                },
              },
            },
          },
        });
        if (!adjustment) throw adjustmentNotFound();
        if (adjustment.status === 'APPLIED') {
          return {
            applied: true,
            scope: adjustment.scope,
            reason: adjustment.reason,
            postingId: adjustment.monetizationPostingId,
            payrollInputId: adjustment.posting.payrollInputId,
            employeeId: adjustment.posting.requestVersion.request.employeeId,
            lines: adjustment.lines.map((line) => ({
              originalLedgerEntryId: line.originalLedgerEntryId,
              leaveAccountId: line.originalEntry.leaveAccountId,
              originalQuantity: line.originalEntry.quantity.negated(),
              retainedQuantity: line.retainedQuantity,
              policyVersionId: line.originalEntry.policyVersionId,
            })),
            ownerResult: adjustment.ownerResult,
          };
        }
        if (!['APPROVED', 'RETRYABLE'].includes(adjustment.status)) {
          throw adjustmentStatusInvalid('APPROVED or RETRYABLE', adjustment.status);
        }
        return {
          applied: false,
          scope: adjustment.scope,
          reason: adjustment.reason,
          postingId: adjustment.monetizationPostingId,
          payrollInputId: adjustment.posting.payrollInputId,
          employeeId: adjustment.posting.requestVersion.request.employeeId,
          lines: adjustment.lines.map((line) => ({
            originalLedgerEntryId: line.originalLedgerEntryId,
            leaveAccountId: line.originalEntry.leaveAccountId,
            originalQuantity: line.originalEntry.quantity.negated(),
            retainedQuantity: line.retainedQuantity,
            policyVersionId: line.originalEntry.policyVersionId,
          })),
          ownerResult: adjustment.ownerResult,
        };
      },
    );
    if (preparation.applied) {
      const summary = await this.findAdjustment(context, adjustmentId);
      return { adjustment: summary, ownerResult: preparation.ownerResult };
    }
    const reversedQuantity = preparation.lines.reduce(
      (total, line) => total.plus(line.originalQuantity).minus(line.retainedQuantity),
      new Prisma.Decimal(0),
    );
    const retainedQuantity = preparation.lines.reduce(
      (total, line) => total.plus(line.retainedQuantity),
      new Prisma.Decimal(0),
    );
    const result = await this.payroll.adjustEarningInput(
      { agencyId: context.agencyId, userId: context.userId, membershipId: context.membershipId },
      {
        agencyId: context.agencyId,
        employeeId: preparation.employeeId,
        adjustmentId,
        adjustmentKey: `MONETIZATION_ADJUSTMENT:${adjustmentId}`,
        monetizationPostingId: preparation.postingId,
        originalPayrollInputId: preparation.payrollInputId,
        scope: preparation.scope as 'WHOLE' | 'PARTIAL',
        reversedQuantity: formatQuantity(reversedQuantity),
        retainedQuantity: formatQuantity(retainedQuantity),
        reason: preparation.reason,
      },
    );
    const ownerResult: Prisma.InputJsonValue = isAccepted(result)
      ? {
          kind: result.kind,
          payrollInputId: result.payrollInputId,
          payrollResult: (result.payrollResult ?? null) as Prisma.InputJsonValue,
        }
      : {
          kind: result.kind,
          code: result.code,
          reason: result.reason,
          missingFacts: result.missingFacts,
        };
    if (!isAccepted(result)) {
      const summary = await withDatabaseContext(
        this.databaseContext(context),
        async (transaction) => {
          const adjustment = await this.lockAdjustment(transaction, context.agencyId, adjustmentId);
          const status = result.kind === 'RETRYABLE_FAILURE' ? 'RETRYABLE' : 'BLOCKED';
          const updated = await transaction.monetizationAdjustment.update({
            where: { agencyId_id: { agencyId: context.agencyId, id: adjustmentId } },
            data: { status, ownerResult },
            select: adjustmentSelect,
          });
          await this.audit(transaction, context, {
            action: 'MONETIZATION_ADJUSTMENT_HANDOFF_FAILED',
            entityType: 'MonetizationAdjustment',
            entityId: adjustmentId,
            previousStatus: adjustment.status,
            newStatus: status,
            reason: result.reason,
            idempotencyKey: rawIdempotencyKey?.trim() || null,
            metadata: { ownerResult },
          });
          return this.adjustmentSummary(updated);
        },
      );
      return { adjustment: summary, ownerResult: ownerResult as Prisma.JsonValue };
    }
    const summary = await withDatabaseContext(
      this.databaseContext(context),
      async (transaction) => {
        const adjustment = await this.lockAdjustment(transaction, context.agencyId, adjustmentId);
        if (adjustment.status === 'APPLIED') {
          const current = await transaction.monetizationAdjustment.findFirst({
            where: { agencyId: context.agencyId, id: adjustmentId },
            select: adjustmentSelect,
          });
          if (!current) throw adjustmentNotFound();
          return this.adjustmentSummary(current);
        }
        const now = new Date();
        const appliedAt = now;
        for (const line of preparation.lines) {
          await this.lockAccount(transaction, context.agencyId, line.leaveAccountId);
          const reversalKey = `ADJ:${adjustmentId}:REV:${line.originalLedgerEntryId}`;
          const existingReversal = await transaction.leaveLedgerEntry.findFirst({
            where: {
              agencyId: context.agencyId,
              leaveAccountId: line.leaveAccountId,
              sourceType: ADJUSTMENT_SOURCE_TYPE,
              sourceId: adjustmentId,
              sourcePostingKey: reversalKey,
            },
            select: { id: true },
          });
          const reversal =
            existingReversal ??
            (await transaction.leaveLedgerEntry.create({
              data: {
                agencyId: context.agencyId,
                leaveAccountId: line.leaveAccountId,
                quantity: line.originalQuantity,
                effectiveDate: toDatabaseDate(manilaToday()),
                sourceType: ADJUSTMENT_SOURCE_TYPE,
                sourceId: adjustmentId,
                sourcePostingKey: reversalKey,
                policyVersionId: line.policyVersionId,
                reversesEntryId: line.originalLedgerEntryId,
                postedByMembershipId: context.membershipId,
              },
              select: { id: true },
            }));
          let replacementId =
            adjustment.lines.find(
              (candidate) => candidate.originalLedgerEntryId === line.originalLedgerEntryId,
            )?.replacementLedgerEntryId ?? null;
          if (line.retainedQuantity.greaterThan(0) && !replacementId) {
            const replacementKey = `ADJ:${adjustmentId}:REP:${line.originalLedgerEntryId}`;
            const existingReplacement = await transaction.leaveLedgerEntry.findFirst({
              where: {
                agencyId: context.agencyId,
                leaveAccountId: line.leaveAccountId,
                sourceType: ADJUSTMENT_SOURCE_TYPE,
                sourceId: adjustmentId,
                sourcePostingKey: replacementKey,
              },
              select: { id: true },
            });
            replacementId =
              existingReplacement?.id ??
              (
                await transaction.leaveLedgerEntry.create({
                  data: {
                    agencyId: context.agencyId,
                    leaveAccountId: line.leaveAccountId,
                    quantity: line.retainedQuantity.negated(),
                    effectiveDate: toDatabaseDate(manilaToday()),
                    sourceType: ADJUSTMENT_SOURCE_TYPE,
                    sourceId: adjustmentId,
                    sourcePostingKey: replacementKey,
                    policyVersionId: line.policyVersionId,
                    postedByMembershipId: context.membershipId,
                  },
                  select: { id: true },
                })
              ).id;
          }
          await transaction.monetizationAdjustmentLine.updateMany({
            where: {
              agencyId: context.agencyId,
              monetizationAdjustmentId: adjustmentId,
              originalLedgerEntryId: line.originalLedgerEntryId,
            },
            data: { reversalLedgerEntryId: reversal.id, replacementLedgerEntryId: replacementId },
          });
        }
        await this.mandatoryLeave.reevaluateLeaveAccounts(
          transaction,
          context,
          preparation.lines.map(({ leaveAccountId }) => ({
            leaveAccountId,
            effectiveDate: toDatabaseDate(manilaToday()),
          })),
        );
        const updated = await transaction.monetizationAdjustment.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: adjustmentId } },
          data: {
            status: 'APPLIED',
            appliedAt,
            payrollAdjustmentInputId: result.payrollInputId,
            ownerResult,
          },
          select: adjustmentSelect,
        });
        await this.audit(transaction, context, {
          action: 'MONETIZATION_ADJUSTMENT_APPLIED',
          entityType: 'MonetizationAdjustment',
          entityId: adjustmentId,
          previousStatus: adjustment.status,
          newStatus: 'APPLIED',
          reason: 'Payroll accepted the linked adjustment; credits restored.',
          idempotencyKey: rawIdempotencyKey?.trim() || null,
          metadata: { ownerResult },
        });
        return this.adjustmentSummary(updated);
      },
    );
    return { adjustment: summary, ownerResult: ownerResult as Prisma.JsonValue };
  }

  private async findAdjustment(
    context: RequestContext,
    adjustmentId: string,
  ): Promise<MonetizationAdjustmentSummary> {
    return withDatabaseContext(this.databaseContext(context), async (transaction) => {
      const adjustment = await transaction.monetizationAdjustment.findFirst({
        where: { agencyId: context.agencyId, id: adjustmentId },
        select: adjustmentSelect,
      });
      if (!adjustment) throw adjustmentNotFound();
      return this.adjustmentSummary(adjustment);
    });
  }

  private async narrowAllocations(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    versionId: string,
    approvedAllocations: readonly { allocationId: string; approvedQuantity: string }[],
  ): Promise<void> {
    const lines = await transaction.monetizationCreditCertificationLine.findMany({
      where: {
        agencyId: context.agencyId,
        certification: { monetizationRequestVersionId: versionId },
      },
      select: {
        id: true,
        leaveAccountId: true,
        certifiedQuantity: true,
        monetizationAllocationId: true,
      },
    });
    const now = new Date();
    for (const approved of approvedAllocations) {
      const line = lines.find(
        (candidate) => candidate.monetizationAllocationId === approved.allocationId,
      );
      if (!line)
        throw adjustmentLineInvalid('The narrowed allocation is not part of this version.');
      const quantity = new Prisma.Decimal(approved.approvedQuantity);
      if (!quantity.isPositive() || quantity.greaterThan(line.certifiedQuantity)) {
        throw allocationInvalid('A partial approval may only narrow a certified allocation.');
      }
      const allocation = await transaction.leaveMonetizationAllocation.findFirst({
        where: { agencyId: context.agencyId, id: approved.allocationId },
        select: { approvedQuantity: true },
      });
      if (allocation?.approvedQuantity && quantity.greaterThan(allocation.approvedQuantity)) {
        throw allocationInvalid('Approved quantities may only narrow, never increase.');
      }
      await transaction.leaveMonetizationAllocation.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: approved.allocationId } },
        data: { approvedQuantity: quantity },
      });
      const active = await transaction.leaveCreditCommitment.findFirst({
        where: {
          agencyId: context.agencyId,
          leaveAccountId: line.leaveAccountId,
          sourceType: CERTIFICATION_LINE_SOURCE_TYPE,
          sourceId: line.id,
          status: 'ACTIVE',
        },
        select: { id: true, quantity: true },
      });
      if (active && quantity.lessThan(active.quantity)) {
        await transaction.leaveCreditCommitment.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: active.id } },
          data: { status: 'RELEASED', endedAt: now },
        });
        await transaction.leaveCreditCommitment.create({
          data: {
            agencyId: context.agencyId,
            leaveAccountId: line.leaveAccountId,
            quantity,
            sourceType: CERTIFICATION_LINE_SOURCE_TYPE,
            sourceId: line.id,
            sourceCommitmentKey: `NARROWED:${now.getTime()}`,
            succeedsCommitmentId: active.id,
            status: 'ACTIVE',
            effectiveFrom: now,
          },
        });
      }
    }
  }

  private async completeMonetizationRequest(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    request: ApprovalCompletionRequest,
  ): Promise<void> {
    void context;
    const version = await transaction.leaveMonetizationRequestVersion.findFirst({
      where: { agencyId: request.agencyId, id: request.subjectId },
      select: { id: true, monetizationRequestId: true },
    });
    if (!version) throw versionMissing();
    const current = await transaction.leaveMonetizationRequest.findFirst({
      where: { agencyId: request.agencyId, id: version.monetizationRequestId },
      select: { id: true, status: true, currentVersionId: true },
    });
    if (!current || current.currentVersionId !== version.id || current.status !== 'FOR_APPROVAL') {
      throw versionMissing();
    }
    await transaction.leaveMonetizationRequest.update({
      where: { agencyId_id: { agencyId: request.agencyId, id: current.id } },
      data: { status: 'APPROVED' },
    });
  }

  private async decideMonetizationRequest(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    request: ApprovalCompletionRequest,
    outcome: 'RETURNED' | 'REJECTED',
  ): Promise<void> {
    const version = await transaction.leaveMonetizationRequestVersion.findFirst({
      where: { agencyId: request.agencyId, id: request.subjectId },
      select: { id: true, monetizationRequestId: true },
    });
    if (!version) throw versionMissing();
    const current = await transaction.leaveMonetizationRequest.findFirst({
      where: { agencyId: request.agencyId, id: version.monetizationRequestId },
      select: {
        id: true,
        status: true,
        currentVersionId: true,
        versions: { select: { id: true } },
      },
    });
    if (!current || current.currentVersionId !== version.id || current.status !== 'FOR_APPROVAL') {
      throw versionMissing();
    }
    await this.releaseCommitments(
      transaction,
      request.agencyId,
      current.versions.map(({ id }) => id),
    );
    await transaction.leaveMonetizationRequest.update({
      where: { agencyId_id: { agencyId: request.agencyId, id: current.id } },
      data: { status: outcome === 'RETURNED' ? 'NEEDS_INFORMATION' : 'REJECTED' },
    });
    void context;
  }

  private async completeAdjustment(
    transaction: Prisma.TransactionClient,
    request: ApprovalCompletionRequest,
  ): Promise<void> {
    const adjustment = await transaction.monetizationAdjustment.findFirst({
      where: { agencyId: request.agencyId, id: request.subjectId },
      select: { id: true, status: true },
    });
    if (!adjustment || adjustment.status !== 'FOR_APPROVAL') throw adjustmentNotFound();
    await transaction.monetizationAdjustment.update({
      where: { agencyId_id: { agencyId: request.agencyId, id: adjustment.id } },
      data: { status: 'APPROVED' },
    });
  }

  private async handleAdjustmentDecision(
    transaction: Prisma.TransactionClient,
    request: ApprovalCompletionRequest,
    outcome: 'RETURNED' | 'REJECTED',
  ): Promise<void> {
    const adjustment = await transaction.monetizationAdjustment.findFirst({
      where: { agencyId: request.agencyId, id: request.subjectId },
      select: { id: true, status: true },
    });
    if (!adjustment || adjustment.status !== 'FOR_APPROVAL') throw adjustmentNotFound();
    await transaction.monetizationAdjustment.update({
      where: { agencyId_id: { agencyId: request.agencyId, id: adjustment.id } },
      data: { status: outcome === 'RETURNED' ? 'DRAFT' : 'REJECTED' },
    });
  }

  private async buildAssessmentFacts(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    request: { employeeId: string },
    version: {
      id: string;
      kind: string;
      reason: string | null;
      authoritySnapshot: Prisma.JsonValue;
    },
    effectiveDate: string,
  ): Promise<MonetizationAssessmentFacts> {
    const allocations = await transaction.leaveMonetizationAllocation.findMany({
      where: { agencyId, monetizationRequestVersionId: version.id },
      select: {
        leaveAccountId: true,
        requestedQuantity: true,
        leaveAccount: { select: { leaveType: { select: { code: true } } } },
      },
    });
    const asOf = toDatabaseDate(effectiveDate);
    const balances = await this.balanceMap(
      transaction,
      agencyId,
      allocations.map(({ leaveAccountId }) => leaveAccountId),
      asOf,
      new Date(),
    );
    const { start, end } = yearBounds(asOf);
    const priorEntries = await transaction.leaveLedgerEntry.findMany({
      where: {
        agencyId,
        sourceType: POSTING_SOURCE_TYPE,
        effectiveDate: { gte: start, lte: end },
        leaveAccount: { employeeId: request.employeeId },
      },
      select: { quantity: true },
    });
    const priorMonetizedQuantityInYear = priorEntries.reduce(
      (total, entry) =>
        total.plus(entry.quantity.isNegative() ? entry.quantity.negated() : entry.quantity),
      new Prisma.Decimal(0),
    );
    return {
      kind: version.kind as MonetizationKind,
      reason: version.reason,
      accounts: allocations.map((allocation) => {
        const balance = balances.get(allocation.leaveAccountId) ?? {
          posted: new Prisma.Decimal(0),
          committed: new Prisma.Decimal(0),
        };
        return {
          leaveAccountId: allocation.leaveAccountId,
          leaveTypeCode: allocation.leaveAccount.leaveType.code,
          postedBalance: balance.posted,
          activeCommitments: balance.committed,
        };
      }),
      allocations: allocations.map((allocation) => ({
        leaveAccountId: allocation.leaveAccountId,
        requestedQuantity: allocation.requestedQuantity,
      })),
      priorMonetizedQuantityInYear,
      authoritySnapshot: version.authoritySnapshot as unknown as MonetizationAuthoritySnapshot,
    };
  }

  private serializeFacts(facts: MonetizationAssessmentFacts): Prisma.InputJsonValue {
    return {
      kind: facts.kind,
      reason: facts.reason,
      accounts: facts.accounts.map((account) => ({
        leaveAccountId: account.leaveAccountId,
        leaveTypeCode: account.leaveTypeCode,
        postedBalance: formatQuantity(account.postedBalance),
        activeCommitments: formatQuantity(account.activeCommitments),
      })),
      allocations: facts.allocations.map((allocation) => ({
        leaveAccountId: allocation.leaveAccountId,
        requestedQuantity: formatQuantity(allocation.requestedQuantity),
      })),
      priorMonetizedQuantityInYear: formatQuantity(facts.priorMonetizedQuantityInYear),
      authoritySnapshot: facts.authoritySnapshot as unknown as Prisma.InputJsonValue,
    };
  }

  private async balanceSnapshot(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    accountId: string,
    asOf: Date,
    recordedThrough: Date,
  ): Promise<{ posted: Prisma.Decimal; committed: Prisma.Decimal }> {
    const map = await this.balanceMap(transaction, agencyId, [accountId], asOf, recordedThrough);
    return (
      map.get(accountId) ?? { posted: new Prisma.Decimal(0), committed: new Prisma.Decimal(0) }
    );
  }

  private async balanceMap(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    accountIds: readonly string[],
    asOf: Date,
    recordedThrough: Date,
  ): Promise<Map<string, { posted: Prisma.Decimal; committed: Prisma.Decimal }>> {
    const balances = new Map<string, { posted: Prisma.Decimal; committed: Prisma.Decimal }>();
    if (accountIds.length === 0) return balances;
    const ledger = await transaction.leaveLedgerEntry.groupBy({
      by: ['leaveAccountId'],
      where: {
        agencyId,
        leaveAccountId: { in: [...accountIds] },
        effectiveDate: { lte: asOf },
        postedAt: { lte: recordedThrough },
      },
      _sum: { quantity: true },
    });
    const commitments = await transaction.leaveCreditCommitment.groupBy({
      by: ['leaveAccountId'],
      where: {
        agencyId,
        leaveAccountId: { in: [...accountIds] },
        effectiveFrom: { lte: recordedThrough },
        OR: [{ endedAt: null }, { endedAt: { gt: recordedThrough } }],
      },
      _sum: { quantity: true },
    });
    const posted = new Map(
      ledger.map((row) => [row.leaveAccountId, row._sum.quantity ?? new Prisma.Decimal(0)]),
    );
    const committed = new Map(
      commitments.map((row) => [row.leaveAccountId, row._sum.quantity ?? new Prisma.Decimal(0)]),
    );
    for (const accountId of accountIds) {
      balances.set(accountId, {
        posted: posted.get(accountId) ?? new Prisma.Decimal(0),
        committed: committed.get(accountId) ?? new Prisma.Decimal(0),
      });
    }
    return balances;
  }

  private async releaseCommitments(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    versionIds: readonly string[],
  ): Promise<void> {
    if (versionIds.length === 0) return;
    const lines = await transaction.monetizationCreditCertificationLine.findMany({
      where: {
        agencyId,
        certification: { monetizationRequestVersionId: { in: [...versionIds] } },
      },
      select: { id: true },
    });
    if (lines.length === 0) return;
    await transaction.leaveCreditCommitment.updateMany({
      where: {
        agencyId,
        sourceType: CERTIFICATION_LINE_SOURCE_TYPE,
        sourceId: { in: lines.map(({ id }) => id) },
        status: 'ACTIVE',
      },
      data: { status: 'RELEASED', endedAt: new Date() },
    });
  }

  private async assertActorSeparation(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    request: {
      id: string;
      employeeId: string;
      createdByMembershipId: string;
      currentVersionId: string | null;
    },
    options: {
      prohibitSubject?: boolean;
      prohibitRecorder?: boolean;
      prohibitSubmitter?: boolean;
      prohibitCertifier?: boolean;
      prohibitFunding?: boolean;
      prohibitApprover?: boolean;
    },
  ): Promise<void> {
    if (
      options.prohibitSubject &&
      (await this.actorEmployeeId(transaction, context)) === request.employeeId
    ) {
      throw actorSeparation('The subject Employee cannot perform this Monetization step.');
    }
    if (options.prohibitRecorder && request.createdByMembershipId === context.membershipId) {
      throw actorSeparation('The recording actor cannot perform this Monetization step.');
    }
    if (!request.currentVersionId) return;
    const version = await transaction.leaveMonetizationRequestVersion.findFirst({
      where: { agencyId: context.agencyId, id: request.currentVersionId },
      select: { submittedByMembershipId: true, approvalRequestId: true },
    });
    if (!version) return;
    if (options.prohibitSubmitter && version.submittedByMembershipId === context.membershipId) {
      throw actorSeparation('The submitting actor cannot perform this Monetization step.');
    }
    if (options.prohibitCertifier) {
      const certification = await transaction.monetizationCreditCertification.findFirst({
        where: {
          agencyId: context.agencyId,
          monetizationRequestVersionId: request.currentVersionId,
        },
        select: { certifiedByMembershipId: true },
      });
      if (certification?.certifiedByMembershipId === context.membershipId) {
        throw actorSeparation('The certifying actor cannot perform this Monetization step.');
      }
    }
    if (options.prohibitFunding) {
      const funding = await transaction.monetizationFundingDetermination.findFirst({
        where: {
          agencyId: context.agencyId,
          monetizationRequestVersionId: request.currentVersionId,
        },
        orderBy: { reviewedAt: 'desc' },
        select: { reviewedByMembershipId: true },
      });
      if (funding?.reviewedByMembershipId === context.membershipId) {
        throw actorSeparation('The funding reviewer cannot perform this Monetization step.');
      }
    }
    if (options.prohibitApprover) {
      const decision = await transaction.approvalDecision.findFirst({
        where: {
          agencyId: context.agencyId,
          decidedByMembershipId: context.membershipId,
          approvalStep: { approvalRequestId: version.approvalRequestId },
        },
        select: { id: true },
      });
      if (decision) {
        throw actorSeparation('An approving actor cannot perform this Monetization step.');
      }
    }
  }

  private async cancelApprovalRequest(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    approvalRequestId: string,
    reason: string,
    rawIdempotencyKey?: string,
  ): Promise<void> {
    const approval = await transaction.approvalRequest.findFirst({
      where: { agencyId: context.agencyId, id: approvalRequestId },
      select: { status: true },
    });
    if (!approval || !['PENDING', 'IN_PROGRESS', 'RETURNED'].includes(approval.status)) return;
    await this.approvals.cancelInTransaction(
      transaction,
      context,
      approvalRequestId,
      reason,
      rawIdempotencyKey,
    );
  }

  private async requireDocumentVersion(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    documentVersionId: string,
    code: string,
  ): Promise<void> {
    const version = await this.documentsService.resolveFinalizedVersionInTransaction(
      transaction,
      { agencyId },
      documentVersionId,
    );
    if (!version) {
      throw new LeaveMonetizationServiceError(
        'The exact finalized Document Version could not be found in this Agency.',
        400,
        code,
      );
    }
  }

  private async postingForRequest(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    requestId: string,
  ): Promise<MonetizationPostingSummary | null> {
    const posting = await transaction.monetizationPosting.findFirst({
      where: { agencyId, requestVersion: { monetizationRequestId: requestId } },
      orderBy: { postedAt: 'desc' },
      select: postingSelect,
    });
    return posting ? this.postingSummary(posting) : null;
  }

  private async requireRequestWithContext(
    context: RequestContext,
    requestId: string,
  ): Promise<RequestRecord> {
    return withDatabaseContext(this.databaseContext(context), async (transaction) => {
      const record = await this.requireRequest(transaction, context.agencyId, requestId);
      return record;
    });
  }

  private requestInclude() {
    return {
      employee: { select: requestEmployeeSelect },
      currentVersion: {
        select: {
          ...versionSelect,
          allocations: { select: allocationSelect },
          assessments: {
            orderBy: { assessedAt: 'desc' as const },
            take: 1,
            select: assessmentSelect,
          },
          certification: { select: certificationSelect },
          fundingDeterminations: {
            orderBy: { reviewedAt: 'desc' as const },
            take: 1,
            select: fundingSelect,
          },
          posting: {
            select: {
              ...postingSelect,
              adjustments: {
                orderBy: { id: 'asc' as const },
                select: adjustmentSelect,
              },
            },
          },
        },
      },
      versions: { select: { id: true } },
    } as const;
  }

  private async requireRequest(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    requestId: string,
  ): Promise<RequestRecord> {
    const request = await transaction.leaveMonetizationRequest.findFirst({
      where: { agencyId, id: requestId },
      include: this.requestInclude(),
    });
    if (!request) throw notFound();
    return request;
  }

  private async requireCurrentVersion(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    request: { currentVersionId: string | null },
  ) {
    if (!request.currentVersionId) throw versionMissing();
    const version = await transaction.leaveMonetizationRequestVersion.findFirst({
      where: { agencyId, id: request.currentVersionId },
    });
    if (!version) throw versionMissing();
    return version;
  }

  private async lockRequest(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    requestId: string,
  ): Promise<RequestRecord> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "leave_monetization_requests" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${requestId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) throw notFound();
    return this.requireRequest(transaction, agencyId, requestId);
  }

  private async lockAdjustment(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    adjustmentId: string,
  ) {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "monetization_adjustments" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${adjustmentId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) throw adjustmentNotFound();
    const adjustment = await transaction.monetizationAdjustment.findFirst({
      where: { agencyId, id: adjustmentId },
      select: adjustmentSelect,
    });
    if (!adjustment) throw adjustmentNotFound();
    return adjustment;
  }

  private async lockAccount(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    accountId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "leave_accounts" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${accountId} AS uuid) FOR NO KEY UPDATE`,
    );
    if (rows.length !== 1) throw allocationInvalid('The Leave Account could not be locked.');
  }

  private requestSummary(request: {
    id: string;
    agencyId: string;
    employeeId: string;
    status: string;
    currentVersionId: string | null;
    createdAt: Date;
    employee: { employeeNumber: string; legalName: string };
    currentVersion?: {
      versionNo: number;
      kind: string;
      reason: string | null;
      submittedAt: Date;
      allocations: ReadonlyArray<{
        requestedQuantity: Prisma.Decimal;
        approvedQuantity: Prisma.Decimal | null;
      }>;
      certification: { lines: ReadonlyArray<{ certifiedQuantity: Prisma.Decimal }> } | null;
    } | null;
  }): MonetizationRequestSummary {
    const version = request.currentVersion ?? null;
    const requestedQuantity = (version?.allocations ?? []).reduce(
      (total, allocation) => total.plus(allocation.requestedQuantity),
      new Prisma.Decimal(0),
    );
    const certifiedQuantity = version?.certification
      ? version.certification.lines.reduce(
          (total, line) => total.plus(line.certifiedQuantity),
          new Prisma.Decimal(0),
        )
      : null;
    const approvedQuantity = version
      ? version.allocations.some(({ approvedQuantity: value }) => value !== null)
        ? version.allocations.reduce(
            (total, allocation) =>
              total.plus(allocation.approvedQuantity ?? allocation.requestedQuantity),
            new Prisma.Decimal(0),
          )
        : null
      : null;
    return {
      id: request.id,
      agencyId: request.agencyId,
      employeeId: request.employeeId,
      employeeNumber: request.employee.employeeNumber,
      employeeName: request.employee.legalName,
      status: request.status as MonetizationStatus,
      currentVersionId: request.currentVersionId,
      versionNo: version?.versionNo ?? null,
      kind: (version?.kind as MonetizationKind) ?? null,
      reason: version?.reason ?? null,
      requestedQuantity: formatQuantity(requestedQuantity),
      certifiedQuantity: certifiedQuantity ? formatQuantity(certifiedQuantity) : null,
      approvedQuantity: approvedQuantity ? formatQuantity(approvedQuantity) : null,
      createdAt: formatDateTime(request.createdAt),
      submittedAt: version ? formatDateTime(version.submittedAt) : null,
    };
  }

  private adjustmentSummary(adjustment: {
    id: string;
    scope: string;
    reason: string;
    status: string;
    approvalRequestId: string;
    ownerResult: Prisma.JsonValue;
    appliedAt: Date | null;
    lines: ReadonlyArray<{
      id: string;
      originalLedgerEntryId: string;
      retainedQuantity: Prisma.Decimal;
      reversalLedgerEntryId: string | null;
      replacementLedgerEntryId: string | null;
    }>;
  }): MonetizationAdjustmentSummary {
    return {
      id: adjustment.id,
      scope: adjustment.scope,
      reason: adjustment.reason,
      status: adjustment.status,
      approvalRequestId: adjustment.approvalRequestId,
      ownerResult: adjustment.ownerResult,
      appliedAt: adjustment.appliedAt ? formatDateTime(adjustment.appliedAt) : null,
      lines: adjustment.lines.map((line) => ({
        id: line.id,
        originalLedgerEntryId: line.originalLedgerEntryId,
        retainedQuantity: formatQuantity(line.retainedQuantity),
        reversalLedgerEntryId: line.reversalLedgerEntryId,
        replacementLedgerEntryId: line.replacementLedgerEntryId,
      })),
    };
  }

  private postingSummary(posting: {
    id: string;
    postingKey: string;
    valuationDate: Date;
    calculatorKind: string;
    factor: Prisma.Decimal;
    payrollInputId: string;
    postedAt: Date;
  }): MonetizationPostingSummary {
    return {
      id: posting.id,
      postingKey: posting.postingKey,
      valuationDate: formatDate(posting.valuationDate),
      calculatorKind: posting.calculatorKind,
      factor: posting.factor.toFixed(7),
      payrollInputId: posting.payrollInputId,
      postedAt: formatDateTime(posting.postedAt),
    };
  }

  private detail(request: RequestRecord): MonetizationDetail {
    const version = request.currentVersion ?? null;
    const assessment = version?.assessments[0] ?? null;
    const certification = version?.certification ?? null;
    const funding = version?.fundingDeterminations[0] ?? null;
    const posting = version?.posting ?? null;
    return {
      request: this.requestSummary(request),
      allocations: (version?.allocations ?? []).map((allocation) => ({
        id: allocation.id,
        leaveAccountId: allocation.leaveAccountId,
        leaveTypeCode: allocation.leaveAccount.leaveType.code,
        leaveTypeName: allocation.leaveAccount.leaveType.name,
        policyVersionId: allocation.policyVersionId,
        requestedQuantity: formatQuantity(allocation.requestedQuantity),
        certifiedQuantity:
          certification?.lines
            .find((line) => line.leaveAccountId === allocation.leaveAccountId)
            ?.certifiedQuantity.toFixed(4) ?? null,
        approvedQuantity: allocation.approvedQuantity
          ? formatQuantity(allocation.approvedQuantity)
          : null,
      })),
      assessment: assessment
        ? {
            id: assessment.id,
            result: assessment.result,
            balanceEffectiveDate: formatDate(assessment.balanceEffectiveDate),
            ledgerCutoff: formatDateTime(assessment.ledgerCutoff),
            ruleResults: assessment.ruleResults,
            assessedAt: formatDateTime(assessment.assessedAt),
          }
        : null,
      certification: certification
        ? {
            id: certification.id,
            certifiedAt: formatDateTime(certification.certifiedAt),
            lines: certification.lines.map((line) => ({
              id: line.id,
              leaveAccountId: line.leaveAccountId,
              postedBalance: formatQuantity(line.postedBalance),
              otherActiveCommitments: formatQuantity(line.otherActiveCommitments),
              certifiedQuantity: formatQuantity(line.certifiedQuantity),
              resultingAvailableQuantity: formatQuantity(line.resultingAvailableQuantity),
              leaveCreditCommitmentId: line.leaveCreditCommitmentId,
            })),
          }
        : null,
      funding: funding
        ? {
            id: funding.id,
            result: funding.result,
            fiscalAuthorityDocumentVersionId: funding.fiscalAuthorityDocumentVersionId,
            fundingSourceSnapshot: funding.fundingSourceSnapshot,
            evidenceSnapshot: funding.evidenceSnapshot,
            reviewedAt: formatDateTime(funding.reviewedAt),
          }
        : null,
      posting: posting ? this.postingSummary(posting) : null,
      adjustments: (posting?.adjustments ?? []).map((adjustment) =>
        this.adjustmentSummary(adjustment),
      ),
    };
  }

  private async completedWrite(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: { action: string; entityId?: string; idempotencyKey: string; fingerprint: string },
  ): Promise<{ entityId: string; metadata: Prisma.JsonValue } | null> {
    const completed = await transaction.auditEvent.findFirst({
      where: {
        agencyId: context.agencyId,
        action: input.action,
        ...(input.entityId ? { entityId: input.entityId } : {}),
        idempotencyKey: input.idempotencyKey,
      },
      select: { entityId: true, metadata: true },
    });
    if (!completed) return null;
    if (metadataString(completed.metadata, 'fingerprint') !== input.fingerprint) {
      throw new LeaveMonetizationServiceError(
        'The Idempotency-Key was already used with different input.',
        409,
        'IDEMPOTENCY_CONFLICT',
      );
    }
    return { entityId: completed.entityId, metadata: completed.metadata };
  }

  private async audit(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: {
      action: string;
      entityId: string;
      previousStatus: string | null;
      newStatus: string;
      reason: string;
      idempotencyKey?: string | null;
      fingerprint?: string;
      metadata: Record<string, unknown>;
      entityType?: string;
    },
  ): Promise<void> {
    await transaction.auditEvent.create({
      data: {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: input.action,
        entityType: input.entityType ?? 'LeaveMonetizationRequest',
        entityId: input.entityId,
        previousStatus: input.previousStatus,
        newStatus: input.newStatus,
        reason: input.reason,
        requestId: context.requestId,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        metadata: {
          ...input.metadata,
          ...(input.fingerprint ? { fingerprint: input.fingerprint } : {}),
        },
      },
    });
  }

  private databaseContext(context: RequestContext) {
    return requestDatabaseContext(context, 'approval-transition');
  }

  private async requireScope(
    context: RequestContext,
    permission: string,
    code: string,
    transaction?: Prisma.TransactionClient,
  ): Promise<EmployeeScope> {
    const scope = await resolveEmployeeScope(context, permission, transaction);
    if (!scope)
      throw new LeaveMonetizationServiceError(
        `The ${permission} permission is required.`,
        403,
        code,
      );
    return scope;
  }

  private async assertRequestScope(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    request: { employeeId: string },
    permission: string,
  ): Promise<void> {
    const scope = await this.requireScope(
      context,
      permission,
      `${permission.toUpperCase()}_FORBIDDEN`,
      transaction,
    );
    if (!scopeCovers(scope, request.employeeId)) throw scopeForbidden();
  }

  /** The Employee linked to the acting Membership, or null when none is linked. */
  private async actorEmployeeId(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
  ): Promise<string | null> {
    const actor = await transaction.agencyMembership.findFirst({
      where: { agencyId: context.agencyId, id: context.membershipId },
      select: { employeeId: true },
    });
    return actor?.employeeId ?? null;
  }

  private async requireMembershipEmployeeId(context: RequestContext): Promise<string> {
    const employee = await withDatabaseContext(this.databaseContext(context), (transaction) =>
      transaction.employee.findFirst({
        where: {
          agencyId: context.agencyId,
          memberships: { some: { id: context.membershipId } },
        },
        select: { id: true },
      }),
    );
    if (!employee) {
      throw new LeaveMonetizationServiceError(
        'The current Membership is not linked to an Employee.',
        403,
        'MONETIZATION_EMPLOYEE_LINK_REQUIRED',
      );
    }
    return employee.id;
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (!hasPermission(context, permission)) {
      throw new LeaveMonetizationServiceError(
        `The ${permission} permission is required.`,
        403,
        code,
      );
    }
  }
}

function notFound(): LeaveMonetizationServiceError {
  return new LeaveMonetizationServiceError(
    'The Leave Monetization Request could not be found.',
    404,
    'MONETIZATION_REQUEST_NOT_FOUND',
  );
}

function employeeNotFound(): LeaveMonetizationServiceError {
  return new LeaveMonetizationServiceError(
    'The Employee could not be found in this Agency.',
    404,
    'MONETIZATION_EMPLOYEE_NOT_FOUND',
  );
}

function employeeRequired(): LeaveMonetizationServiceError {
  return new LeaveMonetizationServiceError(
    'Select the Employee who is requesting monetization.',
    400,
    'MONETIZATION_EMPLOYEE_REQUIRED',
  );
}

function versionMissing(): LeaveMonetizationServiceError {
  return new LeaveMonetizationServiceError(
    'The Leave Monetization Request has no current submitted version.',
    409,
    'MONETIZATION_VERSION_MISSING',
  );
}

function statusInvalid(expected: string, actual: string): LeaveMonetizationServiceError {
  return new LeaveMonetizationServiceError(
    `The Leave Monetization Request must be ${expected} for this action; it is ${actual}.`,
    409,
    'MONETIZATION_STATUS_INVALID',
    [`EXPECTED:${expected}`, `ACTUAL:${actual}`],
  );
}

function adjustmentStatusInvalid(expected: string, actual: string): LeaveMonetizationServiceError {
  return new LeaveMonetizationServiceError(
    `The Monetization Adjustment must be ${expected} for this action; it is ${actual}.`,
    409,
    'MONETIZATION_ADJUSTMENT_STATUS_INVALID',
    [`EXPECTED:${expected}`, `ACTUAL:${actual}`],
  );
}

function adjustmentNotFound(): LeaveMonetizationServiceError {
  return new LeaveMonetizationServiceError(
    'The Monetization Adjustment could not be found.',
    404,
    'MONETIZATION_ADJUSTMENT_NOT_FOUND',
  );
}

function postingNotFound(): LeaveMonetizationServiceError {
  return new LeaveMonetizationServiceError(
    'The Monetization Posting could not be found.',
    404,
    'MONETIZATION_POSTING_NOT_FOUND',
  );
}

function certificationMissing(): LeaveMonetizationServiceError {
  return new LeaveMonetizationServiceError(
    'Certify the monetization credits before posting.',
    409,
    'MONETIZATION_CERTIFICATION_MISSING',
  );
}

function fundingMissing(): LeaveMonetizationServiceError {
  return new LeaveMonetizationServiceError(
    'A supported Monetization Funding Determination is required before posting.',
    409,
    'MONETIZATION_FUNDING_MISSING',
  );
}

function assessmentNotEligible(result: string | null): LeaveMonetizationServiceError {
  return new LeaveMonetizationServiceError(
    result
      ? `The current eligibility assessment is ${result}; certification requires ELIGIBLE.`
      : 'An eligibility assessment is required before certification.',
    409,
    result ? 'MONETIZATION_ASSESSMENT_NOT_ELIGIBLE' : 'MONETIZATION_ASSESSMENT_MISSING',
    result ? [`RESULT:${result}`] : [],
  );
}

function ruleFailed(rule: string, message: string): LeaveMonetizationServiceError {
  return new LeaveMonetizationServiceError(message, 409, 'MONETIZATION_RULE_FAILED', [
    `RULE:${rule}`,
  ]);
}

function insufficientBalance(
  available: Prisma.Decimal,
  quantity: Prisma.Decimal,
): LeaveMonetizationServiceError {
  return new LeaveMonetizationServiceError(
    'The Leave Account does not have enough available credits for this certification.',
    409,
    'MONETIZATION_INSUFFICIENT_BALANCE',
    [`AVAILABLE:${formatQuantity(available)}`, `REQUESTED:${formatQuantity(quantity)}`],
  );
}

function allocationInvalid(message: string): LeaveMonetizationServiceError {
  return new LeaveMonetizationServiceError(message, 400, 'MONETIZATION_ALLOCATION_INVALID');
}

function adjustmentLineInvalid(message: string): LeaveMonetizationServiceError {
  return new LeaveMonetizationServiceError(message, 400, 'MONETIZATION_ADJUSTMENT_LINE_INVALID');
}

function specialReasonRequired(): LeaveMonetizationServiceError {
  return new LeaveMonetizationServiceError(
    'Special monetization requires a valid and justifiable reason.',
    400,
    'MONETIZATION_SPECIAL_REASON_REQUIRED',
  );
}

function policyNotEffective(): LeaveMonetizationServiceError {
  return new LeaveMonetizationServiceError(
    'No published Leave Policy Version governs the effective date for an allocated account.',
    409,
    'MONETIZATION_POLICY_NOT_EFFECTIVE',
  );
}

function scopeForbidden(): LeaveMonetizationServiceError {
  return new LeaveMonetizationServiceError(
    'The current Membership cannot act on another Employee request.',
    403,
    'MONETIZATION_SCOPE_FORBIDDEN',
  );
}

function attestationForbidden(): LeaveMonetizationServiceError {
  return new LeaveMonetizationServiceError(
    "An authenticated submission must be made by the Employee themself; record another Employee's request with the exact signed Document Version.",
    403,
    'MONETIZATION_ATTESTATION_FORBIDDEN',
  );
}

function actorSeparation(message: string): LeaveMonetizationServiceError {
  return new LeaveMonetizationServiceError(message, 403, 'MONETIZATION_ACTOR_SEPARATION');
}

function payrollHandoffError(failure: MonetizationPortFailure): LeaveMonetizationServiceError {
  const status = failure.kind === 'REJECTED' ? 422 : 503;
  return new LeaveMonetizationServiceError(
    failure.reason,
    status,
    failure.code,
    failure.missingFacts,
  );
}

export { LeaveMonetizationServiceError } from './monetization-support';
