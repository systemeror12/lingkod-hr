import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import {
  DocumentsService,
  type DocumentSummary,
  type DocumentVersionSummary,
} from '../documents/documents.service';
import {
  SeparationsService,
  isEffectiveSeparationCase,
  type EffectiveSeparationCaseForTerminalLeaveInput,
  type SeparationCaseForTerminalLeaveInput,
} from '../separations/separations.service';

/**
 * Terminal Leave Input Preservation freezes the exact sources a later
 * terminal-leave computation will rely on without calculating or authorizing
 * anything. CSC MC No. 41, s. 1998, sections 35-37 establish terminal-leave
 * entitlement on retirement, resignation, and other separation. CSC MC No. 14,
 * s. 1999, section 65 and the 2025 RACCS, section 73 confirm that dismissal
 * retains it, and the 2025 RACCS, section 135 says the same of dropping from
 * rolls. No accepted authority states the treatment of every termination,
 * transfer, reorganization, or other separation, so those stay unresolved and
 * fail closed until the Separation-owned Separation Leave Credit Disposition
 * states it (#205).
 */
export const TERMINAL_LEAVE_INPUT_SOURCE_TYPE = 'SEPARATION_CASE';

export const TERMINAL_LEAVE_INPUT_LEAVE_TYPE_CODES = ['VACATION_LEAVE', 'SICK_LEAVE'] as const;

export const TERMINAL_LEAVE_INPUT_HANDOFF_RESULTS = [
  'ACCEPTED',
  'ALREADY_ACCEPTED',
  'REJECTED',
  'RETRYABLE_FAILURE',
] as const;

export type TerminalLeaveInputHandoffResult = (typeof TERMINAL_LEAVE_INPUT_HANDOFF_RESULTS)[number];
export type TerminalLeaveInputResult = 'READY' | 'INDETERMINATE';
export type SeparationQualification = 'QUALIFYING' | 'UNRESOLVED';

export const TERMINAL_LEAVE_SEPARATION_CLASSIFICATION: Readonly<
  Record<string, SeparationQualification>
> = {
  RETIREMENT: 'QUALIFYING',
  RESIGNATION: 'QUALIFYING',
  DEATH: 'QUALIFYING',
  EXPIRATION: 'QUALIFYING',
  DISMISSAL: 'QUALIFYING',
  DROPPING_FROM_ROLLS: 'QUALIFYING',
};

export function qualifySeparationType(separationType: string): SeparationQualification {
  return TERMINAL_LEAVE_SEPARATION_CLASSIFICATION[separationType] ?? 'UNRESOLVED';
}

export interface TerminalLeaveInputFactFinding {
  code: string;
  sourceType: string;
  sourceId: string | null;
  detail: string | null;
}

export interface TerminalLeaveInputDocumentReference {
  documentId: string;
  documentVersionId: string;
  documentNo: string | null;
  documentType: string;
  classification: string;
  status: string;
  versionNo: number;
  issuedAt: string | null;
}

export interface TerminalLeaveInputAssessmentSummary {
  id: string;
  agencyId: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  separationSourceType: string;
  separationSourceId: string;
  separationSourceVersionKey: string;
  separationClassification: string;
  separationEffectiveDate: string;
  ledgerCutoff: string;
  result: TerminalLeaveInputResult;
  inputFacts: Prisma.JsonValue;
  missingOrConflictingFacts: TerminalLeaveInputFactFinding[];
  assessedByMembershipId: string;
  assessedByName: string | null;
  assessedAt: string;
  snapshotId: string | null;
  snapshotKey: string | null;
  supersedesSnapshotId: string | null;
}

export interface TerminalLeaveInputSnapshotLineSummary {
  leaveAccountId: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  policyVersionId: string;
  policyVersionNo: number;
  balanceEffectiveDate: string;
  ledgerCutoff: string;
  postedBalance: string;
}

export interface TerminalLeaveInputHandoffOutcomeSummary {
  id: string;
  attemptKey: string;
  result: TerminalLeaveInputHandoffResult;
  separationReference: Prisma.JsonValue;
  reason: Prisma.JsonValue;
  recordedAt: string;
}

export interface TerminalLeaveInputSnapshotDetail {
  id: string;
  snapshotKey: string;
  supersedesSnapshotId: string | null;
  createdAt: string;
  serviceSourceSnapshot: Prisma.JsonValue;
  authoritySnapshot: Prisma.JsonValue;
  clearanceDocumentSnapshot: Prisma.JsonValue;
  salarySourceReference: Prisma.JsonValue;
  lines: TerminalLeaveInputSnapshotLineSummary[];
  outcomes: TerminalLeaveInputHandoffOutcomeSummary[];
}

export interface TerminalLeaveInputAssessmentDetail {
  assessment: TerminalLeaveInputAssessmentSummary;
  snapshot: TerminalLeaveInputSnapshotDetail | null;
}

export interface TerminalLeaveInputAssessmentFilters {
  employeeId?: string | undefined;
  separationCaseId?: string | undefined;
  result?: TerminalLeaveInputResult | undefined;
}

export interface TerminalLeaveInputCandidate {
  separationCaseId: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  separationType: string;
  separationEffectiveDate: string;
  effectuatedAt: string;
  hasReadySnapshot: boolean;
}

export interface PreserveTerminalLeaveInputsInput {
  separationCaseId: string;
  clearanceDocumentId?: string | undefined;
  supportingDocumentIds?: string[] | undefined;
  salarySourceDocumentId?: string | undefined;
  supersedesSnapshotId?: string | undefined;
  reason?: string | undefined;
}

export interface RecordTerminalLeaveInputHandoffOutcomeInput {
  snapshotId: string;
  attemptKey: string;
  result: TerminalLeaveInputHandoffResult;
  separationReference?: Record<string, unknown> | undefined;
  reason?: Record<string, unknown> | string | undefined;
}

export interface TerminalLeaveInputAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const TERMINAL_LEAVE_INPUT_AUDIT_WRITER = Symbol('TERMINAL_LEAVE_INPUT_AUDIT_WRITER');

export const terminalLeaveInputAuditWriter: TerminalLeaveInputAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};

export class TerminalLeaveInputServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly reasons: string[] = [],
  ) {
    super(message);
    this.name = 'TerminalLeaveInputServiceError';
  }
}

const ZERO = new Prisma.Decimal(0);

const assessmentListSelect = {
  id: true,
  agencyId: true,
  employeeId: true,
  separationSourceType: true,
  separationSourceId: true,
  separationSourceVersionKey: true,
  separationClassification: true,
  separationEffectiveDate: true,
  ledgerCutoff: true,
  result: true,
  inputFacts: true,
  missingOrConflictingFacts: true,
  assessedByMembershipId: true,
  assessedAt: true,
  employee: { select: { employeeNumber: true, legalName: true } },
  assessedBy: { select: { employee: { select: { legalName: true } } } },
  snapshot: { select: { id: true, snapshotKey: true, supersedesSnapshotId: true } },
} as const;

const assessmentDetailSelect = {
  ...assessmentListSelect,
  snapshot: {
    select: {
      id: true,
      snapshotKey: true,
      supersedesSnapshotId: true,
      createdAt: true,
      serviceSourceSnapshot: true,
      authoritySnapshot: true,
      clearanceDocumentSnapshot: true,
      salarySourceReference: true,
      lines: {
        orderBy: { leaveAccountId: 'asc' },
        select: {
          leaveAccountId: true,
          policyVersionId: true,
          balanceEffectiveDate: true,
          ledgerCutoff: true,
          postedBalance: true,
          leaveAccount: {
            select: {
              leaveTypeId: true,
              leaveType: { select: { code: true, name: true } },
            },
          },
          policyVersion: { select: { versionNo: true } },
        },
      },
      outcomes: {
        orderBy: { recordedAt: 'asc' },
        select: {
          id: true,
          attemptKey: true,
          result: true,
          separationReference: true,
          reason: true,
          recordedAt: true,
        },
      },
    },
  },
} as const;

type AssessmentListRecord = Prisma.TerminalLeaveInputAssessmentGetPayload<{
  select: typeof assessmentListSelect;
}>;
type AssessmentDetailRecord = Prisma.TerminalLeaveInputAssessmentGetPayload<{
  select: typeof assessmentDetailSelect;
}>;

function databaseContext(context: RequestContext) {
  return requestDatabaseContext(context);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatDateTime(value: Date): string {
  return value.toISOString();
}

function formatQuantity(value: Prisma.Decimal): string {
  return value.toFixed(4);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function metadataString(metadata: Prisma.JsonValue, key: string): string | null {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function factFindings(value: Prisma.JsonValue): TerminalLeaveInputFactFinding[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    return [
      {
        code: typeof record.code === 'string' ? record.code : 'UNKNOWN',
        sourceType: typeof record.sourceType === 'string' ? record.sourceType : 'Unknown',
        sourceId: typeof record.sourceId === 'string' ? record.sourceId : null,
        detail: typeof record.detail === 'string' ? record.detail : null,
      },
    ];
  });
}

function documentReference(
  document: DocumentSummary & { currentVersion: DocumentVersionSummary },
): TerminalLeaveInputDocumentReference {
  return {
    documentId: document.id,
    documentVersionId: document.currentVersion.id,
    documentNo: document.documentNo,
    documentType: document.documentType,
    classification: document.classification,
    status: document.status,
    versionNo: document.currentVersion.versionNo,
    issuedAt: document.currentVersion.issuedAt,
  };
}

function assessmentSummary(record: AssessmentListRecord): TerminalLeaveInputAssessmentSummary {
  return {
    id: record.id,
    agencyId: record.agencyId,
    employeeId: record.employeeId,
    employeeNumber: record.employee.employeeNumber,
    employeeName: record.employee.legalName,
    separationSourceType: record.separationSourceType,
    separationSourceId: record.separationSourceId,
    separationSourceVersionKey: record.separationSourceVersionKey,
    separationClassification: record.separationClassification,
    separationEffectiveDate: formatDate(record.separationEffectiveDate),
    ledgerCutoff: formatDateTime(record.ledgerCutoff),
    result: record.result as TerminalLeaveInputResult,
    inputFacts: record.inputFacts,
    missingOrConflictingFacts: factFindings(record.missingOrConflictingFacts),
    assessedByMembershipId: record.assessedByMembershipId,
    assessedByName: record.assessedBy?.employee?.legalName ?? null,
    assessedAt: formatDateTime(record.assessedAt),
    snapshotId: record.snapshot?.id ?? null,
    snapshotKey: record.snapshot?.snapshotKey ?? null,
    supersedesSnapshotId: record.snapshot?.supersedesSnapshotId ?? null,
  };
}

function assessmentDetail(record: AssessmentDetailRecord): TerminalLeaveInputAssessmentDetail {
  const snapshot = record.snapshot;
  return {
    assessment: assessmentSummary(record),
    snapshot: snapshot
      ? {
          id: snapshot.id,
          snapshotKey: snapshot.snapshotKey,
          supersedesSnapshotId: snapshot.supersedesSnapshotId,
          createdAt: formatDateTime(snapshot.createdAt),
          serviceSourceSnapshot: snapshot.serviceSourceSnapshot,
          authoritySnapshot: snapshot.authoritySnapshot,
          clearanceDocumentSnapshot: snapshot.clearanceDocumentSnapshot,
          salarySourceReference: snapshot.salarySourceReference,
          lines: snapshot.lines.map((line) => ({
            leaveAccountId: line.leaveAccountId,
            leaveTypeId: line.leaveAccount.leaveTypeId,
            leaveTypeCode: line.leaveAccount.leaveType.code,
            leaveTypeName: line.leaveAccount.leaveType.name,
            policyVersionId: line.policyVersionId,
            policyVersionNo: line.policyVersion.versionNo,
            balanceEffectiveDate: formatDate(line.balanceEffectiveDate),
            ledgerCutoff: formatDateTime(line.ledgerCutoff),
            postedBalance: formatQuantity(line.postedBalance),
          })),
          outcomes: snapshot.outcomes.map((outcome) => ({
            id: outcome.id,
            attemptKey: outcome.attemptKey,
            result: outcome.result as TerminalLeaveInputHandoffResult,
            separationReference: outcome.separationReference,
            reason: outcome.reason,
            recordedAt: formatDateTime(outcome.recordedAt),
          })),
        }
      : null,
  };
}

interface PolicyAuthoritySnapshot {
  authorityClass: string;
  citation: string;
  documentId: string;
  documentVersionId: string;
  documentNo: string | null;
  documentType: string;
  versionNo: number;
  issuedAt: string | null;
}

interface PolicyVersionSnapshot {
  policyVersionId: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  versionNo: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  evaluatorKind: string;
  authorities: PolicyAuthoritySnapshot[];
}

interface LeaveAccountSnapshotFact {
  leaveAccountId: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
  unitCode: string;
  policyVersionId: string;
  policyVersionNo: number;
  balanceEffectiveDate: string;
  postedBalance: string;
}

interface ServiceSegmentSnapshot {
  serviceSegmentId: string;
  appointmentStatus: string | null;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  salaryGrade: number | null;
  salaryStep: number | null;
  positionId: string | null;
  organizationUnitId: string | null;
}

/**
 * Freezes and reads Terminal Leave Input Assessments under the
 * `leave.terminal_inputs.read` and `leave.terminal_inputs.preserve` permissions.
 * Separation sources are validated through `SeparationsService`; every fact the
 * later computation needs is preserved as an exact reference, and any gap
 * yields an INDETERMINATE assessment with no consumable snapshot.
 */
@Injectable()
export class TerminalLeaveInputsService {
  constructor(
    @Inject(TERMINAL_LEAVE_INPUT_AUDIT_WRITER)
    private readonly auditWriter: TerminalLeaveInputAuditWriter,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
    @Inject(SeparationsService) private readonly separationsService: SeparationsService,
  ) {}

  async list(
    context: RequestContext,
    filters: TerminalLeaveInputAssessmentFilters = {},
  ): Promise<TerminalLeaveInputAssessmentSummary[]> {
    this.assertPermission(
      context,
      'leave.terminal_inputs.read',
      'TERMINAL_LEAVE_INPUT_READ_FORBIDDEN',
    );
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const records = await transaction.terminalLeaveInputAssessment.findMany({
        where: {
          agencyId: context.agencyId,
          ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
          ...(filters.separationCaseId ? { separationSourceId: filters.separationCaseId } : {}),
          ...(filters.result ? { result: filters.result } : {}),
        },
        orderBy: [{ assessedAt: 'desc' }, { id: 'desc' }],
        take: 100,
        select: assessmentListSelect,
      });
      return records.map((record) => assessmentSummary(record));
    });
  }

  async findById(
    context: RequestContext,
    assessmentId: string,
  ): Promise<TerminalLeaveInputAssessmentDetail | null> {
    this.assertPermission(
      context,
      'leave.terminal_inputs.read',
      'TERMINAL_LEAVE_INPUT_READ_FORBIDDEN',
    );
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const record = await transaction.terminalLeaveInputAssessment.findFirst({
        where: { agencyId: context.agencyId, id: assessmentId },
        select: assessmentDetailSelect,
      });
      return record ? assessmentDetail(record) : null;
    });
  }

  /**
   * Effective Separation Cases that may be preserved. Until the Separation
   * Leave Credit Disposition handoff lands, Leave applies the accepted
   * authority map; unresolved classifications are withheld.
   */
  async listCandidates(context: RequestContext): Promise<TerminalLeaveInputCandidate[]> {
    this.assertPermission(
      context,
      'leave.terminal_inputs.read',
      'TERMINAL_LEAVE_INPUT_READ_FORBIDDEN',
    );
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const cases = await this.separationsService.listEffectiveCasesInTransaction(
        transaction,
        context.agencyId,
      );
      const qualifying = cases.filter(
        (record) => qualifySeparationType(record.separationType) === 'QUALIFYING',
      );
      if (qualifying.length === 0) return [];
      const assessments = await transaction.terminalLeaveInputAssessment.findMany({
        where: {
          agencyId: context.agencyId,
          separationSourceId: { in: qualifying.map((record) => record.id) },
          result: 'READY',
        },
        select: { separationSourceId: true, separationSourceVersionKey: true },
      });
      const preserved = new Set(
        assessments.map(
          (record) => `${record.separationSourceId}:${record.separationSourceVersionKey}`,
        ),
      );
      return qualifying.map((record) => ({
        separationCaseId: record.id,
        employeeId: record.employeeId,
        employeeNumber: record.employee.employeeNumber,
        employeeName: record.employee.legalName,
        separationType: record.separationType,
        separationEffectiveDate: formatDate(record.approvedEffectiveDate),
        effectuatedAt: formatDateTime(record.effectuatedAt),
        hasReadySnapshot: preserved.has(`${record.id}:${separationVersionKey(record)}`),
      }));
    });
  }

  async preserve(
    context: RequestContext,
    input: PreserveTerminalLeaveInputsInput,
    rawIdempotencyKey?: string,
  ): Promise<TerminalLeaveInputAssessmentDetail> {
    this.assertPermission(
      context,
      'leave.terminal_inputs.preserve',
      'TERMINAL_LEAVE_INPUT_PRESERVE_FORBIDDEN',
    );
    const documentIds = [
      ...(input.clearanceDocumentId ? [input.clearanceDocumentId] : []),
      ...(input.supportingDocumentIds ?? []),
      ...(input.salarySourceDocumentId ? [input.salarySourceDocumentId] : []),
    ];
    if (documentIds.length > 0) {
      this.assertPermission(
        context,
        'documents.evidence.read',
        'TERMINAL_LEAVE_INPUT_EVIDENCE_FORBIDDEN',
      );
    }
    const supersedesSnapshotId = input.supersedesSnapshotId ?? null;
    const reason = input.reason?.trim() || null;
    if (supersedesSnapshotId && !reason) throw reasonRequired();
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = canonicalJson({
      command: 'TERMINAL_LEAVE_INPUT_PRESERVED',
      separationCaseId: input.separationCaseId,
      clearanceDocumentId: input.clearanceDocumentId ?? null,
      supportingDocumentIds: input.supportingDocumentIds ?? [],
      salarySourceDocumentId: input.salarySourceDocumentId ?? null,
      supersedesSnapshotId,
      reason,
    });
    try {
      return await withDatabaseContext(databaseContext(context), async (transaction) => {
        if (idempotencyKey) {
          const completed = await this.completedWrite(transaction, context, {
            idempotencyKey,
            fingerprint,
          });
          if (completed) {
            const assessmentId = metadataString(completed.metadata, 'assessmentId');
            const existing = assessmentId
              ? await transaction.terminalLeaveInputAssessment.findFirst({
                  where: { agencyId: context.agencyId, id: assessmentId },
                  select: assessmentDetailSelect,
                })
              : null;
            if (!existing) throw idempotencyConflict();
            return assessmentDetail(existing);
          }
        }

        const separationCase = await this.separationsService.findCaseInTransaction(
          transaction,
          context.agencyId,
          input.separationCaseId,
        );
        if (!separationCase) throw separationCaseNotFound();
        assertEffectiveSeparation(separationCase);
        const qualification = qualifySeparationType(separationCase.separationType);
        if (qualification !== 'QUALIFYING') {
          throw separationClassificationUnresolved(separationCase.separationType);
        }
        const separationEffectiveDate = separationCase.approvedEffectiveDate;
        const versionKey = separationVersionKey(separationCase);
        const assessedAt = new Date();
        const ledgerCutoff = assessedAt;

        await this.assertPostingsComplete(
          transaction,
          context.agencyId,
          separationCase.employeeId,
          separationEffectiveDate,
        );

        const employee = await transaction.employee.findFirst({
          where: { agencyId: context.agencyId, id: separationCase.employeeId },
          select: { id: true, employeeNumber: true, legalName: true },
        });
        if (!employee) throw separationCaseNotFound();

        const liveSnapshot = await transaction.terminalLeaveInputSnapshot.findFirst({
          where: {
            agencyId: context.agencyId,
            supersededBy: null,
            assessment: {
              employeeId: separationCase.employeeId,
              separationSourceType: TERMINAL_LEAVE_INPUT_SOURCE_TYPE,
              separationSourceId: separationCase.id,
            },
          },
          select: { id: true },
        });
        if (liveSnapshot && liveSnapshot.id !== supersedesSnapshotId) throw supersedesRequired();
        if (supersedesSnapshotId) {
          await this.assertSupersession(
            transaction,
            context.agencyId,
            supersedesSnapshotId,
            separationCase,
          );
        }

        const findings: TerminalLeaveInputFactFinding[] = [];
        const clearanceDocument = input.clearanceDocumentId
          ? await this.resolveDocument(transaction, context, input.clearanceDocumentId)
          : null;
        if (!clearanceDocument) {
          findings.push({
            code: 'CLEARANCE_EVIDENCE_MISSING',
            sourceType: 'SeparationCase',
            sourceId: separationCase.id,
            detail: 'No finalized clearance Document Version was supplied.',
          });
        }
        const supportingDocuments: TerminalLeaveInputDocumentReference[] = [];
        for (const documentId of new Set(input.supportingDocumentIds ?? [])) {
          supportingDocuments.push(await this.resolveDocument(transaction, context, documentId));
        }
        const salarySourceDocument = input.salarySourceDocumentId
          ? await this.resolveDocument(transaction, context, input.salarySourceDocumentId)
          : null;

        const serviceSegments = await transaction.serviceSegment.findMany({
          where: {
            agencyId: context.agencyId,
            employeeId: separationCase.employeeId,
            effectiveFrom: { lte: separationEffectiveDate },
          },
          orderBy: [{ effectiveFrom: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            appointmentStatus: true,
            status: true,
            effectiveFrom: true,
            effectiveTo: true,
            salaryGrade: true,
            salaryStep: true,
            positionId: true,
            organizationUnitId: true,
          },
        });
        if (serviceSegments.length === 0) {
          findings.push({
            code: 'SERVICE_FACTS_MISSING',
            sourceType: 'Employee',
            sourceId: separationCase.employeeId,
            detail: 'No Service Segment covers the effective separation date.',
          });
        }
        for (const segment of serviceSegments) {
          if (segment.salaryGrade === null || segment.salaryStep === null) {
            findings.push({
              code: 'SALARY_SOURCE_INCOMPLETE',
              sourceType: 'ServiceSegment',
              sourceId: segment.id,
              detail: 'The Service Segment has no salary grade and step.',
            });
          }
        }

        const leaveTypes = await transaction.leaveType.findMany({
          where: {
            agencyId: context.agencyId,
            code: { in: [...TERMINAL_LEAVE_INPUT_LEAVE_TYPE_CODES] },
          },
          select: { id: true, code: true, name: true, status: true },
        });
        const accounts: LeaveAccountSnapshotFact[] = [];
        const policyVersions: PolicyVersionSnapshot[] = [];
        for (const code of TERMINAL_LEAVE_INPUT_LEAVE_TYPE_CODES) {
          const leaveType = leaveTypes.find((record) => record.code === code);
          if (!leaveType) {
            findings.push({
              code: 'LEAVE_TYPE_MISSING',
              sourceType: 'LeaveType',
              sourceId: null,
              detail: `${code} is not configured for this Agency.`,
            });
            continue;
          }
          const accountRecords = await transaction.leaveAccount.findMany({
            where: {
              agencyId: context.agencyId,
              employeeId: separationCase.employeeId,
              leaveTypeId: leaveType.id,
              openedAt: { lte: separationEffectiveDate },
              OR: [{ closedAt: null }, { closedAt: { gte: separationEffectiveDate } }],
            },
            orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
            select: { id: true, status: true, openedAt: true, closedAt: true, unitCode: true },
          });
          if (accountRecords.length === 0) {
            findings.push({
              code: 'LEAVE_ACCOUNT_MISSING',
              sourceType: 'LeaveType',
              sourceId: leaveType.id,
              detail: `${code} has no Leave Account on the effective separation date.`,
            });
            continue;
          }
          const policyVersion = await this.effectivePolicyVersion(
            transaction,
            context.agencyId,
            leaveType.id,
            separationEffectiveDate,
          );
          for (const account of accountRecords) {
            if (!policyVersion) {
              findings.push({
                code: 'LEAVE_POLICY_VERSION_MISSING',
                sourceType: 'LeaveAccount',
                sourceId: account.id,
                detail: 'No published Leave Policy Version governs the effective separation date.',
              });
            }
            const ledger = await transaction.leaveLedgerEntry.aggregate({
              where: {
                agencyId: context.agencyId,
                leaveAccountId: account.id,
                effectiveDate: { lte: separationEffectiveDate },
                postedAt: { lte: ledgerCutoff },
              },
              _sum: { quantity: true },
            });
            const posted = ledger._sum.quantity ?? ZERO;
            if (posted.isNegative()) {
              findings.push({
                code: 'POSTED_BALANCE_NEGATIVE',
                sourceType: 'LeaveAccount',
                sourceId: account.id,
                detail: `The posted balance is ${formatQuantity(posted)}.`,
              });
            }
            if (
              policyVersion &&
              !policyVersions.some((record) => record.policyVersionId === policyVersion.id)
            ) {
              policyVersions.push({
                policyVersionId: policyVersion.id,
                leaveTypeId: leaveType.id,
                leaveTypeCode: leaveType.code,
                versionNo: policyVersion.versionNo,
                effectiveFrom: formatDate(policyVersion.effectiveFrom),
                effectiveTo: policyVersion.effectiveTo
                  ? formatDate(policyVersion.effectiveTo)
                  : null,
                evaluatorKind: policyVersion.evaluatorKind,
                authorities: policyVersion.authorities.map((authority) => ({
                  authorityClass: authority.authorityClass,
                  citation: authority.citation,
                  documentId: authority.documentId,
                  documentVersionId: authority.documentVersionId,
                  documentNo: authority.document.documentNo,
                  documentType: authority.document.documentType,
                  versionNo: authority.documentVersion.versionNo,
                  issuedAt: authority.documentVersion.issuedAt
                    ? formatDateTime(authority.documentVersion.issuedAt)
                    : null,
                })),
              });
            }
            accounts.push({
              leaveAccountId: account.id,
              leaveTypeId: leaveType.id,
              leaveTypeCode: leaveType.code,
              status: account.status,
              openedAt: formatDate(account.openedAt),
              closedAt: account.closedAt ? formatDate(account.closedAt) : null,
              unitCode: account.unitCode,
              policyVersionId: policyVersion?.id ?? '',
              policyVersionNo: policyVersion?.versionNo ?? 0,
              balanceEffectiveDate: formatDate(separationEffectiveDate),
              postedBalance: formatQuantity(posted),
            });
          }
        }

        const segments: ServiceSegmentSnapshot[] = serviceSegments.map((segment) => ({
          serviceSegmentId: segment.id,
          appointmentStatus: segment.appointmentStatus,
          status: segment.status,
          effectiveFrom: formatDate(segment.effectiveFrom),
          effectiveTo: segment.effectiveTo ? formatDate(segment.effectiveTo) : null,
          salaryGrade: segment.salaryGrade,
          salaryStep: segment.salaryStep,
          positionId: segment.positionId,
          organizationUnitId: segment.organizationUnitId,
        }));

        const separationFacts = {
          sourceType: TERMINAL_LEAVE_INPUT_SOURCE_TYPE,
          separationCaseId: separationCase.id,
          separationType: separationCase.separationType,
          qualification,
          status: separationCase.status,
          approvedEffectiveDate: formatDate(separationEffectiveDate),
          effectuatedAt: formatDateTime(separationCase.effectuatedAt),
          serviceSegmentId: separationCase.serviceSegmentId,
          positionIncumbencyId: separationCase.positionIncumbencyId,
        };
        const inputFacts = {
          request: {
            clearanceDocumentId: input.clearanceDocumentId ?? null,
            supportingDocumentIds: input.supportingDocumentIds ?? [],
            salarySourceDocumentId: input.salarySourceDocumentId ?? null,
            supersedesSnapshotId,
            reason,
          },
          separation: separationFacts,
          employee: {
            employeeId: employee.id,
            employeeNumber: employee.employeeNumber,
            legalName: employee.legalName,
          },
          serviceSegments: segments,
          leaveAccounts: accounts,
          policyVersions,
        };

        const result: TerminalLeaveInputResult = findings.length === 0 ? 'READY' : 'INDETERMINATE';
        const assessment = await transaction.terminalLeaveInputAssessment.create({
          data: {
            agencyId: context.agencyId,
            employeeId: separationCase.employeeId,
            separationSourceType: TERMINAL_LEAVE_INPUT_SOURCE_TYPE,
            separationSourceId: separationCase.id,
            separationSourceVersionKey: versionKey,
            separationClassification: separationCase.separationType,
            separationEffectiveDate,
            ledgerCutoff,
            result,
            inputFacts: inputFacts as unknown as Prisma.InputJsonValue,
            missingOrConflictingFacts: findings as unknown as Prisma.InputJsonValue,
            assessedByMembershipId: context.membershipId,
            assessedAt,
          },
          select: { id: true },
        });

        let snapshotId: string | null = null;
        if (result === 'READY') {
          const snapshot = await transaction.terminalLeaveInputSnapshot.create({
            data: {
              agencyId: context.agencyId,
              terminalLeaveInputAssessmentId: assessment.id,
              supersedesSnapshotId,
              snapshotKey: assessment.id,
              serviceSourceSnapshot: {
                employee: {
                  employeeId: employee.id,
                  employeeNumber: employee.employeeNumber,
                  legalName: employee.legalName,
                },
                separation: separationFacts,
                serviceSegments: segments,
              } as unknown as Prisma.InputJsonValue,
              authoritySnapshot: {
                balanceEffectiveDate: formatDate(separationEffectiveDate),
                ledgerCutoff: formatDateTime(ledgerCutoff),
                policyVersions,
              } as unknown as Prisma.InputJsonValue,
              clearanceDocumentSnapshot: {
                clearanceDocument,
                supportingDocuments,
              } as unknown as Prisma.InputJsonValue,
              salarySourceReference: {
                owningModule: 'PERSONNEL',
                sourceType: 'ServiceSegmentSalaryHistory',
                serviceSegmentIds: segments.map((segment) => segment.serviceSegmentId),
                salaryFacts: segments.map((segment) => ({
                  serviceSegmentId: segment.serviceSegmentId,
                  salaryGrade: segment.salaryGrade,
                  salaryStep: segment.salaryStep,
                  effectiveFrom: segment.effectiveFrom,
                  effectiveTo: segment.effectiveTo,
                  appointmentStatus: segment.appointmentStatus,
                  status: segment.status,
                })),
                evidenceDocument: salarySourceDocument,
                valueResolution: 'DEFERRED_TO_PAYROLL',
              } as unknown as Prisma.InputJsonValue,
              createdAt: assessedAt,
            },
            select: { id: true },
          });
          snapshotId = snapshot.id;
          await transaction.terminalLeaveInputSnapshotLine.createMany({
            data: accounts.map((account) => ({
              agencyId: context.agencyId,
              terminalLeaveInputSnapshotId: snapshot.id,
              leaveAccountId: account.leaveAccountId,
              policyVersionId: account.policyVersionId,
              balanceEffectiveDate: separationEffectiveDate,
              ledgerCutoff,
              postedBalance: new Prisma.Decimal(account.postedBalance),
            })),
          });
        }

        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'TERMINAL_LEAVE_INPUT_PRESERVED',
          entityType: 'TerminalLeaveInputAssessment',
          entityId: assessment.id,
          newStatus: result,
          ...(reason ? { reason } : {}),
          requestId: context.requestId,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          metadata: {
            fingerprint,
            assessmentId: assessment.id,
            snapshotId,
            result,
            findingCount: findings.length,
            separationCaseId: separationCase.id,
            employeeId: separationCase.employeeId,
            supersedesSnapshotId,
          },
        });

        const detail = await transaction.terminalLeaveInputAssessment.findFirst({
          where: { agencyId: context.agencyId, id: assessment.id },
          select: assessmentDetailSelect,
        });
        if (!detail) throw assessmentNotFound();
        return assessmentDetail(detail);
      });
    } catch (error: unknown) {
      if (error instanceof TerminalLeaveInputServiceError) throw error;
      if (isUniqueViolation(error)) throw successorExists();
      throw error;
    }
  }

  /**
   * Owning-service contract used by the Separation application service to
   * record append-only handoff outcomes. It never mutates the snapshot and
   * never transfers ownership of Leave facts.
   */
  async recordHandoffOutcome(
    context: RequestContext,
    input: RecordTerminalLeaveInputHandoffOutcomeInput,
  ): Promise<TerminalLeaveInputHandoffOutcomeSummary> {
    return withDatabaseContext(databaseContext(context), (transaction) =>
      this.recordHandoffOutcomeInTransaction(transaction, context, input),
    );
  }

  async recordHandoffOutcomeInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: RecordTerminalLeaveInputHandoffOutcomeInput,
  ): Promise<TerminalLeaveInputHandoffOutcomeSummary> {
    const attemptKey = input.attemptKey.trim();
    if (!attemptKey) throw attemptKeyRequired();
    if (!TERMINAL_LEAVE_INPUT_HANDOFF_RESULTS.includes(input.result)) {
      throw handoffResultInvalid();
    }
    const accepted = input.result === 'ACCEPTED' || input.result === 'ALREADY_ACCEPTED';
    const separationReference = input.separationReference ?? null;
    const reason =
      typeof input.reason === 'string'
        ? input.reason.trim()
          ? { message: input.reason.trim() }
          : null
        : (input.reason ?? null);
    if (accepted && (!separationReference || Object.keys(separationReference).length === 0)) {
      throw handoffReferenceRequired();
    }
    if (!accepted && (!reason || Object.keys(reason).length === 0)) {
      throw handoffReasonRequired();
    }
    const snapshot = await transaction.terminalLeaveInputSnapshot.findFirst({
      where: { agencyId: context.agencyId, id: input.snapshotId },
      select: { id: true },
    });
    if (!snapshot) throw snapshotNotFound();
    const existing = await transaction.terminalLeaveInputHandoffOutcome.findFirst({
      where: { agencyId: context.agencyId, terminalLeaveInputSnapshotId: snapshot.id, attemptKey },
      select: {
        id: true,
        attemptKey: true,
        result: true,
        separationReference: true,
        reason: true,
        recordedAt: true,
      },
    });
    if (existing) {
      const matches =
        existing.result === input.result &&
        canonicalJson(existing.separationReference) === canonicalJson(separationReference) &&
        canonicalJson(existing.reason) === canonicalJson(reason);
      if (!matches) throw handoffAttemptConflict();
      return {
        id: existing.id,
        attemptKey: existing.attemptKey,
        result: existing.result as TerminalLeaveInputHandoffResult,
        separationReference: existing.separationReference,
        reason: existing.reason,
        recordedAt: formatDateTime(existing.recordedAt),
      };
    }
    const recordedAt = new Date();
    const outcome = await transaction.terminalLeaveInputHandoffOutcome.create({
      data: {
        agencyId: context.agencyId,
        terminalLeaveInputSnapshotId: snapshot.id,
        attemptKey,
        result: input.result,
        separationReference:
          separationReference === null
            ? Prisma.DbNull
            : (separationReference as Prisma.InputJsonValue),
        reason: reason === null ? Prisma.DbNull : (reason as Prisma.InputJsonValue),
        recordedAt,
      },
      select: {
        id: true,
        attemptKey: true,
        result: true,
        separationReference: true,
        reason: true,
        recordedAt: true,
      },
    });
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: 'TERMINAL_LEAVE_INPUT_HANDOFF_RECORDED',
      entityType: 'TerminalLeaveInputSnapshot',
      entityId: snapshot.id,
      newStatus: input.result,
      requestId: context.requestId,
      metadata: {
        snapshotId: snapshot.id,
        attemptKey,
        result: input.result,
      },
    });
    return {
      id: outcome.id,
      attemptKey: outcome.attemptKey,
      result: outcome.result as TerminalLeaveInputHandoffResult,
      separationReference: outcome.separationReference,
      reason: outcome.reason,
      recordedAt: formatDateTime(outcome.recordedAt),
    };
  }

  private async assertPostingsComplete(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    throughDate: Date,
  ): Promise<void> {
    const accounts = await transaction.leaveAccount.findMany({
      where: { agencyId, employeeId },
      select: { id: true },
    });
    if (accounts.length === 0) return;
    const pending = await transaction.leaveCreditCommitment.findMany({
      where: {
        agencyId,
        leaveAccountId: { in: accounts.map((account) => account.id) },
        status: 'ACTIVE',
        effectiveFrom: { lte: throughDate },
      },
      orderBy: [{ effectiveFrom: 'asc' }, { id: 'asc' }],
      select: { id: true, sourceType: true, sourceId: true },
    });
    if (pending.length === 0) return;
    throw postingsIncomplete(
      pending.map((commitment) => `${commitment.sourceType}:${commitment.sourceId}`),
    );
  }

  private async assertSupersession(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    supersedesSnapshotId: string,
    separationCase: EffectiveSeparationCaseForTerminalLeaveInput,
  ): Promise<void> {
    const snapshot = await transaction.terminalLeaveInputSnapshot.findFirst({
      where: { agencyId, id: supersedesSnapshotId },
      select: {
        id: true,
        agencyId: true,
        supersededBy: { select: { id: true } },
        assessment: {
          select: {
            employeeId: true,
            separationSourceType: true,
            separationSourceId: true,
          },
        },
      },
    });
    if (!snapshot) throw snapshotNotFound();
    if (snapshot.supersededBy) throw successorExists();
    if (
      snapshot.assessment.employeeId !== separationCase.employeeId ||
      snapshot.assessment.separationSourceType !== TERMINAL_LEAVE_INPUT_SOURCE_TYPE ||
      snapshot.assessment.separationSourceId !== separationCase.id
    ) {
      throw supersessionMismatch();
    }
  }

  private async resolveDocument(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    documentId: string,
  ): Promise<TerminalLeaveInputDocumentReference> {
    const evidence = await this.documentsService.resolveExternalEvidenceInTransaction(
      transaction,
      context,
      { documentId, allowSensitive: false, requirement: 'FINALIZED_VERSION' },
    );
    if (!evidence.ok) throw documentIneligible(evidence.reason);
    return documentReference(evidence.document);
  }

  private async effectivePolicyVersion(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    leaveTypeId: string,
    effectiveDate: Date,
  ): Promise<Prisma.LeavePolicyVersionGetPayload<{
    select: {
      id: true;
      versionNo: true;
      effectiveFrom: true;
      effectiveTo: true;
      evaluatorKind: true;
      authorities: {
        select: {
          authorityClass: true;
          citation: true;
          documentId: true;
          documentVersionId: true;
          document: { select: { documentNo: true; documentType: true } };
          documentVersion: { select: { versionNo: true; issuedAt: true } };
        };
      };
    };
  }> | null> {
    return transaction.leavePolicyVersion.findFirst({
      where: {
        agencyId,
        leaveTypeId,
        status: { in: ['ACTIVE', 'SUPERSEDED'] },
        effectiveFrom: { lte: effectiveDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveDate } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: {
        id: true,
        versionNo: true,
        effectiveFrom: true,
        effectiveTo: true,
        evaluatorKind: true,
        authorities: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            authorityClass: true,
            citation: true,
            documentId: true,
            documentVersionId: true,
            document: { select: { documentNo: true, documentType: true } },
            documentVersion: { select: { versionNo: true, issuedAt: true } },
          },
        },
      },
    });
  }

  private async completedWrite(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: { idempotencyKey: string; fingerprint: string },
  ): Promise<{ metadata: Prisma.JsonValue } | null> {
    const completed = await transaction.auditEvent.findFirst({
      where: {
        agencyId: context.agencyId,
        action: 'TERMINAL_LEAVE_INPUT_PRESERVED',
        idempotencyKey: input.idempotencyKey,
      },
      select: { metadata: true },
    });
    if (!completed) return null;
    if (metadataString(completed.metadata, 'fingerprint') !== input.fingerprint) {
      throw idempotencyConflict();
    }
    return completed;
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (!hasPermission(context, permission)) {
      throw new TerminalLeaveInputServiceError(
        `The ${permission} permission is required.`,
        403,
        code,
      );
    }
  }
}

function separationVersionKey(
  separationCase: EffectiveSeparationCaseForTerminalLeaveInput,
): string {
  return separationCase.effectuatedAt.toISOString();
}

function assertEffectiveSeparation(
  separationCase: SeparationCaseForTerminalLeaveInput,
): asserts separationCase is EffectiveSeparationCaseForTerminalLeaveInput {
  if (!isEffectiveSeparationCase(separationCase)) {
    throw separationNotEffective(separationCase.status);
  }
}

function separationCaseNotFound(): TerminalLeaveInputServiceError {
  return new TerminalLeaveInputServiceError(
    'The Separation Case could not be found in this Agency.',
    404,
    'TERMINAL_LEAVE_INPUT_SEPARATION_NOT_FOUND',
  );
}

function separationNotEffective(status: string): TerminalLeaveInputServiceError {
  return new TerminalLeaveInputServiceError(
    'The Separation Case must be effective before its inputs can be preserved.',
    409,
    'TERMINAL_LEAVE_INPUT_SEPARATION_NOT_EFFECTIVE',
    [`STATUS:${status}`],
  );
}

function separationClassificationUnresolved(
  separationType: string,
): TerminalLeaveInputServiceError {
  return new TerminalLeaveInputServiceError(
    'That Separation type stays unresolved until the Separation Leave Credit Disposition establishes its terminal-leave treatment.',
    409,
    'TERMINAL_LEAVE_INPUT_SEPARATION_CLASSIFICATION_UNRESOLVED',
    [`CLASSIFICATION:${separationType}`],
  );
}

function postingsIncomplete(reasons: string[]): TerminalLeaveInputServiceError {
  return new TerminalLeaveInputServiceError(
    'Required Leave postings through the last service date are not complete.',
    409,
    'TERMINAL_LEAVE_INPUT_POSTINGS_INCOMPLETE',
    reasons,
  );
}

function documentIneligible(reason: string): TerminalLeaveInputServiceError {
  return new TerminalLeaveInputServiceError(
    'The document must be an exact finalized Document Version in this Agency.',
    400,
    'TERMINAL_LEAVE_INPUT_DOCUMENT_INELIGIBLE',
    [reason],
  );
}

function reasonRequired(): TerminalLeaveInputServiceError {
  return new TerminalLeaveInputServiceError(
    'A reason is required when superseding a Terminal Leave Input Snapshot.',
    400,
    'TERMINAL_LEAVE_INPUT_REASON_REQUIRED',
  );
}

function snapshotNotFound(): TerminalLeaveInputServiceError {
  return new TerminalLeaveInputServiceError(
    'The Terminal Leave Input Snapshot could not be found.',
    404,
    'TERMINAL_LEAVE_INPUT_SNAPSHOT_NOT_FOUND',
  );
}

function assessmentNotFound(): TerminalLeaveInputServiceError {
  return new TerminalLeaveInputServiceError(
    'The Terminal Leave Input Assessment could not be found.',
    404,
    'TERMINAL_LEAVE_INPUT_ASSESSMENT_NOT_FOUND',
  );
}

function supersessionMismatch(): TerminalLeaveInputServiceError {
  return new TerminalLeaveInputServiceError(
    'A successor snapshot must correct the same Separation source and Employee.',
    409,
    'TERMINAL_LEAVE_INPUT_SUPERSESSION_MISMATCH',
  );
}

function supersedesRequired(): TerminalLeaveInputServiceError {
  return new TerminalLeaveInputServiceError(
    'Supersede the current Terminal Leave Input Snapshot with a reason instead of preserving a second live snapshot.',
    409,
    'TERMINAL_LEAVE_INPUT_SUPERSEDES_REQUIRED',
  );
}

function successorExists(): TerminalLeaveInputServiceError {
  return new TerminalLeaveInputServiceError(
    'That Terminal Leave Input Snapshot already has a successor.',
    409,
    'TERMINAL_LEAVE_INPUT_SUCCESSOR_EXISTS',
  );
}

function idempotencyConflict(): TerminalLeaveInputServiceError {
  return new TerminalLeaveInputServiceError(
    'The Idempotency-Key was already used with different input.',
    409,
    'IDEMPOTENCY_CONFLICT',
  );
}

function attemptKeyRequired(): TerminalLeaveInputServiceError {
  return new TerminalLeaveInputServiceError(
    'An attempt key is required for a Terminal Leave Input handoff outcome.',
    400,
    'TERMINAL_LEAVE_INPUT_ATTEMPT_KEY_REQUIRED',
  );
}

function handoffResultInvalid(): TerminalLeaveInputServiceError {
  return new TerminalLeaveInputServiceError(
    'Enter a supported Terminal Leave Input handoff result.',
    400,
    'TERMINAL_LEAVE_INPUT_HANDOFF_RESULT_INVALID',
  );
}

function handoffReferenceRequired(): TerminalLeaveInputServiceError {
  return new TerminalLeaveInputServiceError(
    'An accepted handoff requires the exact owning-service separation reference.',
    400,
    'TERMINAL_LEAVE_INPUT_HANDOFF_REFERENCE_REQUIRED',
  );
}

function handoffReasonRequired(): TerminalLeaveInputServiceError {
  return new TerminalLeaveInputServiceError(
    'A rejected or retryable handoff requires a reason.',
    400,
    'TERMINAL_LEAVE_INPUT_HANDOFF_REASON_REQUIRED',
  );
}

function handoffAttemptConflict(): TerminalLeaveInputServiceError {
  return new TerminalLeaveInputServiceError(
    'That handoff attempt key was already recorded with a different outcome.',
    409,
    'TERMINAL_LEAVE_INPUT_HANDOFF_ATTEMPT_CONFLICT',
  );
}
