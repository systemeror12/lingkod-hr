import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import { RecruitmentServiceError } from './recruitment.service';
import {
  applicationSelect,
  applicationSummary,
  type ApplicationRecord,
  type ApplicationSummary,
} from './applications.service';
import {
  assessmentSelect,
  assessmentSummary,
  interviewSelect,
  interviewSummary,
  latestFeedbackPerInterviewer,
  latestResultsPerEvaluator,
} from './evaluations.summary';
import {
  parseSelectionPlan,
  type AssessmentCriterion,
  type AssessmentStage,
  type InterviewStage,
  type SelectionPlan,
  type SelectionStage,
} from './selection-plan';
import {
  assessmentResultCorrectionSchema,
  assessmentResultSchema,
  assessmentScheduleSchema,
  interviewFeedbackCorrectionSchema,
  interviewFeedbackSchema,
  interviewScheduleSchema,
} from './evaluations.schemas';

type AssessmentScheduleInput = typeof assessmentScheduleSchema._output;
type AssessmentResultInput = typeof assessmentResultSchema._output;
type AssessmentResultCorrectionInput = typeof assessmentResultCorrectionSchema._output;
type InterviewScheduleInput = typeof interviewScheduleSchema._output;
type InterviewFeedbackInput = typeof interviewFeedbackSchema._output;
type InterviewFeedbackCorrectionInput = typeof interviewFeedbackCorrectionSchema._output;

const STAGE_TYPES = {
  ASSESSMENT: 'FOR_ASSESSMENT',
  INTERVIEW: 'FOR_INTERVIEW',
} as const;

const EVALUATION_OPEN_STATUSES = ['QUALIFIED', 'FOR_ASSESSMENT', 'FOR_INTERVIEW'] as const;

function safeEvaluationAuditMetadata(value: Prisma.InputJsonObject): Prisma.InputJsonObject {
  const allowed = new Set([
    'applicationId',
    'assessmentId',
    'interviewId',
    'resultId',
    'feedbackId',
    'replacesResultId',
    'replacesFeedbackId',
    'stageCode',
    'stageType',
    'criterionCode',
    'versionNo',
    'resultCount',
    'evidenceLinked',
  ]);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => allowed.has(key)),
  ) as Prisma.InputJsonObject;
}

function jsonObject(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, Prisma.JsonValue>;
}

function assessmentStage(plan: SelectionPlan, stageCode: string): AssessmentStage | null {
  const stage = plan.stages.find((candidate) => candidate.stageCode === stageCode);
  return stage?.stageType === 'ASSESSMENT' ? stage : null;
}

function interviewStage(plan: SelectionPlan, stageCode: string): InterviewStage | null {
  const stage = plan.stages.find((candidate) => candidate.stageCode === stageCode);
  return stage?.stageType === 'INTERVIEW' ? stage : null;
}

@Injectable()
export class EvaluationsService {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  async scheduleAssessment(
    context: RequestContext,
    applicationId: string,
    input: AssessmentScheduleInput,
    rawIdempotencyKey?: string,
  ): Promise<ApplicationSummary> {
    this.assertPermission(
      context,
      'recruitment.assessments.manage',
      'RECRUITMENT_ASSESSMENT_MANAGE_FORBIDDEN',
    );
    return this.runCommand(
      context,
      'ASSESSMENT_SCHEDULED',
      rawIdempotencyKey,
      applicationId,
      async (transaction, current, previous) => {
        if (previous) {
          if (!this.matchesReplay(previous, applicationId, { stageCode: input.stageCode })) {
            throw this.idempotencyConflict();
          }
          return;
        }
        this.assertEvaluationOpen(current, 'schedule an Assessment');
        const { plan, criteriaSetId } = this.resolvePlan(current);
        const stage = this.requireCurrentStage(plan, current, input.stageCode, 'ASSESSMENT');
        const open = await transaction.assessment.findFirst({
          where: {
            agencyId: context.agencyId,
            applicationId,
            stageCode: stage.stageCode,
            status: 'SCHEDULED',
          },
          select: { id: true },
        });
        if (open) {
          throw new RecruitmentServiceError(
            'An Assessment for the current stage is already scheduled.',
            409,
            'RECRUITMENT_ASSESSMENT_ALREADY_SCHEDULED',
          );
        }
        const assessment = await transaction.assessment.create({
          data: {
            agencyId: context.agencyId,
            applicationId,
            criteriaSetId,
            stageCode: stage.stageCode,
            stageType: 'ASSESSMENT',
            scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
            status: 'SCHEDULED',
            createdByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        await this.setApplicationStageStatus(
          transaction,
          context,
          applicationId,
          current.status,
          STAGE_TYPES.ASSESSMENT,
        );
        await this.writeAudit(transaction, context, {
          action: 'ASSESSMENT_SCHEDULED',
          entityType: 'Assessment',
          entityId: assessment.id,
          previousStatus: null,
          newStatus: 'SCHEDULED',
          reason: `Assessment scheduled for configured stage ${stage.stageCode}.`,
          metadata: safeEvaluationAuditMetadata({
            applicationId,
            assessmentId: assessment.id,
            stageCode: stage.stageCode,
            stageType: 'ASSESSMENT',
          }),
          idempotencyKey: rawIdempotencyKey,
        });
      },
    );
  }

  async completeAssessment(
    context: RequestContext,
    applicationId: string,
    assessmentId: string,
    rawIdempotencyKey?: string,
  ): Promise<ApplicationSummary> {
    this.assertPermission(
      context,
      'recruitment.assessments.manage',
      'RECRUITMENT_ASSESSMENT_MANAGE_FORBIDDEN',
    );
    return this.runCommand(
      context,
      'ASSESSMENT_COMPLETED',
      rawIdempotencyKey,
      applicationId,
      async (transaction, current, previous) => {
        if (previous) {
          if (!this.matchesReplay(previous, applicationId, { assessmentId })) {
            throw this.idempotencyConflict();
          }
          return;
        }
        const assessment = await this.requireAssessment(
          transaction,
          context.agencyId,
          applicationId,
          assessmentId,
        );
        if (assessment.status !== 'SCHEDULED') {
          throw this.workflowError('complete the Assessment', assessment.status);
        }
        const { plan } = this.resolvePlan(current);
        const stage = assessmentStage(plan, assessment.stageCode);
        if (!stage) {
          throw new RecruitmentServiceError(
            'The Assessment stage is not part of the supported bound plan.',
            409,
            'RECRUITMENT_SELECTION_PLAN_INVALID',
          );
        }
        const summary = assessmentSummary(assessment, plan);
        const latest = latestResultsPerEvaluator(summary.results);
        const missing = stage.criteria.find(
          ({ criterionCode }) => !latest.some((result) => result.criterionCode === criterionCode),
        );
        if (missing) {
          throw new RecruitmentServiceError(
            `Every configured criterion needs at least one result before completion. Missing: ${missing.criterionCode}.`,
            409,
            'RECRUITMENT_ASSESSMENT_RESULT_REQUIRED',
          );
        }
        await transaction.assessment.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: assessmentId } },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'ASSESSMENT_COMPLETED',
          entityType: 'Assessment',
          entityId: assessmentId,
          previousStatus: 'SCHEDULED',
          newStatus: 'COMPLETED',
          reason: 'Every configured criterion has a recorded evaluator result.',
          metadata: safeEvaluationAuditMetadata({
            applicationId,
            assessmentId,
            stageCode: assessment.stageCode,
            stageType: 'ASSESSMENT',
            resultCount: latest.length,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
      },
    );
  }

  async cancelAssessment(
    context: RequestContext,
    applicationId: string,
    assessmentId: string,
    reason: string,
    rawIdempotencyKey?: string,
  ): Promise<ApplicationSummary> {
    this.assertPermission(
      context,
      'recruitment.assessments.manage',
      'RECRUITMENT_ASSESSMENT_MANAGE_FORBIDDEN',
    );
    return this.closeStageEvent(
      context,
      applicationId,
      'ASSESSMENT',
      assessmentId,
      'CANCELLED',
      reason,
      rawIdempotencyKey,
    );
  }

  async recordAssessmentNoShow(
    context: RequestContext,
    applicationId: string,
    assessmentId: string,
    reason: string | undefined,
    rawIdempotencyKey?: string,
  ): Promise<ApplicationSummary> {
    this.assertPermission(
      context,
      'recruitment.assessments.manage',
      'RECRUITMENT_ASSESSMENT_MANAGE_FORBIDDEN',
    );
    return this.closeStageEvent(
      context,
      applicationId,
      'ASSESSMENT',
      assessmentId,
      'NO_SHOW',
      reason,
      rawIdempotencyKey,
    );
  }

  async recordAssessmentResult(
    context: RequestContext,
    applicationId: string,
    assessmentId: string,
    input: AssessmentResultInput,
    rawIdempotencyKey?: string,
  ): Promise<ApplicationSummary> {
    this.assertPermission(
      context,
      'recruitment.assessments.manage',
      'RECRUITMENT_ASSESSMENT_MANAGE_FORBIDDEN',
    );
    return this.runCommand(
      context,
      'ASSESSMENT_RESULT_RECORDED',
      rawIdempotencyKey,
      applicationId,
      async (transaction, current, previous) => {
        if (previous) {
          if (
            !this.matchesReplay(previous, applicationId, {
              assessmentId,
              criterionCode: input.criterionCode,
            })
          ) {
            throw this.idempotencyConflict();
          }
          return;
        }
        const assessment = await this.requireAssessment(
          transaction,
          context.agencyId,
          applicationId,
          assessmentId,
        );
        this.assertResultWindow(current, assessment.status);
        const { plan } = this.resolvePlan(current);
        const criterion = this.requireCriterion(plan, assessment.stageCode, input.criterionCode);
        await this.assertEvaluatorEligible(transaction, context, criterion.evaluatorRoleCodes);
        await this.validateAssessmentResult(transaction, context, criterion, input);
        const existing = await transaction.assessmentResultVersion.findFirst({
          where: {
            agencyId: context.agencyId,
            assessmentId,
            criterionCode: input.criterionCode,
            evaluatedByMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        if (existing) {
          throw new RecruitmentServiceError(
            'An existing result for this criterion is corrected through a linked replacement.',
            409,
            'RECRUITMENT_ASSESSMENT_RESULT_CORRECTION_REQUIRED',
          );
        }
        const result = await transaction.assessmentResultVersion.create({
          data: {
            agencyId: context.agencyId,
            assessmentId,
            criterionCode: input.criterionCode,
            evaluatedByMembershipId: context.membershipId,
            versionNo: 1,
            score: new Prisma.Decimal(input.score),
            rating: input.rating ?? null,
            comments: input.comments ?? null,
            evidenceDocumentVersionId: input.evidenceDocumentVersionId ?? null,
          },
          select: { id: true },
        });
        await this.writeAudit(transaction, context, {
          action: 'ASSESSMENT_RESULT_RECORDED',
          entityType: 'AssessmentResultVersion',
          entityId: result.id,
          previousStatus: null,
          newStatus: null,
          reason: `Result recorded for criterion ${input.criterionCode}.`,
          metadata: safeEvaluationAuditMetadata({
            applicationId,
            assessmentId,
            resultId: result.id,
            stageCode: assessment.stageCode,
            criterionCode: input.criterionCode,
            versionNo: 1,
            evidenceLinked: input.evidenceDocumentVersionId !== undefined,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
      },
    );
  }

  async correctAssessmentResult(
    context: RequestContext,
    applicationId: string,
    assessmentId: string,
    resultId: string,
    input: AssessmentResultCorrectionInput,
    rawIdempotencyKey?: string,
  ): Promise<ApplicationSummary> {
    this.assertPermission(
      context,
      'recruitment.assessments.manage',
      'RECRUITMENT_ASSESSMENT_MANAGE_FORBIDDEN',
    );
    return this.runCommand(
      context,
      'ASSESSMENT_RESULT_CORRECTED',
      rawIdempotencyKey,
      applicationId,
      async (transaction, current, previous) => {
        if (previous) {
          if (!this.matchesReplay(previous, applicationId, { replacesResultId: resultId })) {
            throw this.idempotencyConflict();
          }
          return;
        }
        const assessment = await this.requireAssessment(
          transaction,
          context.agencyId,
          applicationId,
          assessmentId,
        );
        this.assertResultWindow(current, assessment.status);
        const source = await this.requireAssessmentResult(
          transaction,
          context,
          assessmentId,
          resultId,
        );
        if (source.criterionCode !== input.criterionCode) {
          throw new RecruitmentServiceError(
            'A result correction must preserve the criterion and evaluator of its source.',
            409,
            'RECRUITMENT_ASSESSMENT_RESULT_SOURCE_INVALID',
          );
        }
        const latest = await transaction.assessmentResultVersion.findFirst({
          where: {
            agencyId: context.agencyId,
            assessmentId,
            criterionCode: source.criterionCode,
            evaluatedByMembershipId: source.evaluatedByMembershipId,
          },
          orderBy: { versionNo: 'desc' },
          select: { id: true, versionNo: true },
        });
        if (!latest || latest.id !== resultId) {
          throw new RecruitmentServiceError(
            'Only the latest result version can be corrected.',
            409,
            'RECRUITMENT_ASSESSMENT_RESULT_SOURCE_INVALID',
          );
        }
        const { plan } = this.resolvePlan(current);
        const criterion = this.requireCriterion(plan, assessment.stageCode, input.criterionCode);
        await this.assertEvaluatorEligible(transaction, context, criterion.evaluatorRoleCodes);
        await this.validateAssessmentResult(transaction, context, criterion, input);
        const result = await transaction.assessmentResultVersion.create({
          data: {
            agencyId: context.agencyId,
            assessmentId,
            criterionCode: source.criterionCode,
            evaluatedByMembershipId: source.evaluatedByMembershipId,
            versionNo: latest.versionNo + 1,
            score: new Prisma.Decimal(input.score),
            rating: input.rating ?? null,
            comments: input.comments ?? null,
            evidenceDocumentVersionId: input.evidenceDocumentVersionId ?? null,
            replacesResultId: resultId,
            correctionReason: input.correctionReason,
          },
          select: { id: true },
        });
        await this.writeAudit(transaction, context, {
          action: 'ASSESSMENT_RESULT_CORRECTED',
          entityType: 'AssessmentResultVersion',
          entityId: result.id,
          previousStatus: null,
          newStatus: null,
          reason: input.correctionReason,
          metadata: safeEvaluationAuditMetadata({
            applicationId,
            assessmentId,
            resultId: result.id,
            replacesResultId: resultId,
            stageCode: assessment.stageCode,
            criterionCode: source.criterionCode,
            versionNo: latest.versionNo + 1,
            evidenceLinked: input.evidenceDocumentVersionId !== undefined,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
      },
    );
  }

  async scheduleInterview(
    context: RequestContext,
    applicationId: string,
    input: InterviewScheduleInput,
    rawIdempotencyKey?: string,
  ): Promise<ApplicationSummary> {
    this.assertPermission(
      context,
      'recruitment.interviews.manage',
      'RECRUITMENT_INTERVIEW_MANAGE_FORBIDDEN',
    );
    return this.runCommand(
      context,
      'INTERVIEW_SCHEDULED',
      rawIdempotencyKey,
      applicationId,
      async (transaction, current, previous) => {
        if (previous) {
          if (!this.matchesReplay(previous, applicationId, { stageCode: input.stageCode })) {
            throw this.idempotencyConflict();
          }
          return;
        }
        this.assertEvaluationOpen(current, 'schedule an Interview');
        const { plan, criteriaSetId } = this.resolvePlan(current);
        const stage = this.requireCurrentStage(plan, current, input.stageCode, 'INTERVIEW');
        const open = await transaction.interview.findFirst({
          where: {
            agencyId: context.agencyId,
            applicationId,
            stageCode: stage.stageCode,
            status: 'SCHEDULED',
          },
          select: { id: true },
        });
        if (open) {
          throw new RecruitmentServiceError(
            'An Interview for the current stage is already scheduled.',
            409,
            'RECRUITMENT_INTERVIEW_ALREADY_SCHEDULED',
          );
        }
        const interview = await transaction.interview.create({
          data: {
            agencyId: context.agencyId,
            applicationId,
            criteriaSetId,
            stageCode: stage.stageCode,
            scheduledAt: new Date(input.scheduledAt),
            locationOrLink: input.locationOrLink ?? null,
            panelName: input.panelName ?? null,
            status: 'SCHEDULED',
            createdByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        await this.setApplicationStageStatus(
          transaction,
          context,
          applicationId,
          current.status,
          STAGE_TYPES.INTERVIEW,
        );
        await this.writeAudit(transaction, context, {
          action: 'INTERVIEW_SCHEDULED',
          entityType: 'Interview',
          entityId: interview.id,
          previousStatus: null,
          newStatus: 'SCHEDULED',
          reason: `Interview scheduled for configured stage ${stage.stageCode}.`,
          metadata: safeEvaluationAuditMetadata({
            applicationId,
            interviewId: interview.id,
            stageCode: stage.stageCode,
            stageType: 'INTERVIEW',
          }),
          idempotencyKey: rawIdempotencyKey,
        });
      },
    );
  }

  async completeInterview(
    context: RequestContext,
    applicationId: string,
    interviewId: string,
    rawIdempotencyKey?: string,
  ): Promise<ApplicationSummary> {
    this.assertPermission(
      context,
      'recruitment.interviews.manage',
      'RECRUITMENT_INTERVIEW_MANAGE_FORBIDDEN',
    );
    return this.runCommand(
      context,
      'INTERVIEW_COMPLETED',
      rawIdempotencyKey,
      applicationId,
      async (transaction, current, previous) => {
        if (previous) {
          if (!this.matchesReplay(previous, applicationId, { interviewId })) {
            throw this.idempotencyConflict();
          }
          return;
        }
        const interview = await this.requireInterview(
          transaction,
          context.agencyId,
          applicationId,
          interviewId,
        );
        if (interview.status !== 'SCHEDULED') {
          throw this.workflowError('complete the Interview', interview.status);
        }
        const { plan } = this.resolvePlan(current);
        const stage = interviewStage(plan, interview.stageCode);
        if (!stage) {
          throw new RecruitmentServiceError(
            'The Interview stage is not part of the supported bound plan.',
            409,
            'RECRUITMENT_SELECTION_PLAN_INVALID',
          );
        }
        const latest = latestFeedbackPerInterviewer(interviewSummary(interview, plan).feedback);
        if (latest.length === 0) {
          throw new RecruitmentServiceError(
            'A completed Interview requires at least one interviewer feedback version.',
            409,
            'RECRUITMENT_INTERVIEW_FEEDBACK_REQUIRED',
          );
        }
        if (
          stage.feedback.evidenceRequired &&
          latest.some(({ evidenceDocumentVersionId }) => !evidenceDocumentVersionId)
        ) {
          throw new RecruitmentServiceError(
            'Every feedback version must cite evidence for this configured stage.',
            409,
            'RECRUITMENT_INTERVIEW_FEEDBACK_EVIDENCE_REQUIRED',
          );
        }
        await transaction.interview.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: interviewId } },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'INTERVIEW_COMPLETED',
          entityType: 'Interview',
          entityId: interviewId,
          previousStatus: 'SCHEDULED',
          newStatus: 'COMPLETED',
          reason: 'Interviewer feedback is recorded and immutable.',
          metadata: safeEvaluationAuditMetadata({
            applicationId,
            interviewId,
            stageCode: interview.stageCode,
            stageType: 'INTERVIEW',
            resultCount: latest.length,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
      },
    );
  }

  async cancelInterview(
    context: RequestContext,
    applicationId: string,
    interviewId: string,
    reason: string,
    rawIdempotencyKey?: string,
  ): Promise<ApplicationSummary> {
    this.assertPermission(
      context,
      'recruitment.interviews.manage',
      'RECRUITMENT_INTERVIEW_MANAGE_FORBIDDEN',
    );
    return this.closeStageEvent(
      context,
      applicationId,
      'INTERVIEW',
      interviewId,
      'CANCELLED',
      reason,
      rawIdempotencyKey,
    );
  }

  async recordInterviewNoShow(
    context: RequestContext,
    applicationId: string,
    interviewId: string,
    reason: string | undefined,
    rawIdempotencyKey?: string,
  ): Promise<ApplicationSummary> {
    this.assertPermission(
      context,
      'recruitment.interviews.manage',
      'RECRUITMENT_INTERVIEW_MANAGE_FORBIDDEN',
    );
    return this.closeStageEvent(
      context,
      applicationId,
      'INTERVIEW',
      interviewId,
      'NO_SHOW',
      reason,
      rawIdempotencyKey,
    );
  }

  async recordInterviewFeedback(
    context: RequestContext,
    applicationId: string,
    interviewId: string,
    input: InterviewFeedbackInput,
    rawIdempotencyKey?: string,
  ): Promise<ApplicationSummary> {
    this.assertPermission(
      context,
      'recruitment.interviews.manage',
      'RECRUITMENT_INTERVIEW_MANAGE_FORBIDDEN',
    );
    return this.runCommand(
      context,
      'INTERVIEW_FEEDBACK_RECORDED',
      rawIdempotencyKey,
      applicationId,
      async (transaction, current, previous) => {
        if (previous) {
          if (!this.matchesReplay(previous, applicationId, { interviewId })) {
            throw this.idempotencyConflict();
          }
          return;
        }
        const interview = await this.requireInterview(
          transaction,
          context.agencyId,
          applicationId,
          interviewId,
        );
        this.assertFeedbackWindow(current, interview.status);
        const { plan } = this.resolvePlan(current);
        const stage = this.requireInterviewStage(plan, interview.stageCode);
        await this.assertEvaluatorEligible(transaction, context, stage.feedback.evaluatorRoleCodes);
        await this.validateInterviewFeedback(transaction, context, stage, input);
        const existing = await transaction.interviewFeedbackVersion.findFirst({
          where: {
            agencyId: context.agencyId,
            interviewId,
            interviewerMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        if (existing) {
          throw new RecruitmentServiceError(
            'Existing interview feedback is corrected through a linked replacement.',
            409,
            'RECRUITMENT_INTERVIEW_FEEDBACK_CORRECTION_REQUIRED',
          );
        }
        const feedback = await transaction.interviewFeedbackVersion.create({
          data: {
            agencyId: context.agencyId,
            interviewId,
            interviewerMembershipId: context.membershipId,
            versionNo: 1,
            score: new Prisma.Decimal(input.score),
            recommendation: input.recommendation,
            comments: input.comments ?? null,
            evidenceDocumentVersionId: input.evidenceDocumentVersionId ?? null,
          },
          select: { id: true },
        });
        await this.writeAudit(transaction, context, {
          action: 'INTERVIEW_FEEDBACK_RECORDED',
          entityType: 'InterviewFeedbackVersion',
          entityId: feedback.id,
          previousStatus: null,
          newStatus: null,
          reason: `Interview feedback recorded with recommendation ${input.recommendation}.`,
          metadata: safeEvaluationAuditMetadata({
            applicationId,
            interviewId,
            feedbackId: feedback.id,
            stageCode: interview.stageCode,
            versionNo: 1,
            evidenceLinked: input.evidenceDocumentVersionId !== undefined,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
      },
    );
  }

  async correctInterviewFeedback(
    context: RequestContext,
    applicationId: string,
    interviewId: string,
    feedbackId: string,
    input: InterviewFeedbackCorrectionInput,
    rawIdempotencyKey?: string,
  ): Promise<ApplicationSummary> {
    this.assertPermission(
      context,
      'recruitment.interviews.manage',
      'RECRUITMENT_INTERVIEW_MANAGE_FORBIDDEN',
    );
    return this.runCommand(
      context,
      'INTERVIEW_FEEDBACK_CORRECTED',
      rawIdempotencyKey,
      applicationId,
      async (transaction, current, previous) => {
        if (previous) {
          if (!this.matchesReplay(previous, applicationId, { replacesFeedbackId: feedbackId })) {
            throw this.idempotencyConflict();
          }
          return;
        }
        const interview = await this.requireInterview(
          transaction,
          context.agencyId,
          applicationId,
          interviewId,
        );
        this.assertFeedbackWindow(current, interview.status);
        const source = await transaction.interviewFeedbackVersion.findFirst({
          where: { agencyId: context.agencyId, interviewId, id: feedbackId },
          select: { id: true, interviewerMembershipId: true },
        });
        if (!source) throw this.notFound('Interview feedback');
        const latest = await transaction.interviewFeedbackVersion.findFirst({
          where: {
            agencyId: context.agencyId,
            interviewId,
            interviewerMembershipId: source.interviewerMembershipId,
          },
          orderBy: { versionNo: 'desc' },
          select: { id: true, versionNo: true },
        });
        if (!latest || latest.id !== feedbackId) {
          throw new RecruitmentServiceError(
            'Only the latest interview feedback version can be corrected.',
            409,
            'RECRUITMENT_INTERVIEW_FEEDBACK_SOURCE_INVALID',
          );
        }
        const { plan } = this.resolvePlan(current);
        const stage = this.requireInterviewStage(plan, interview.stageCode);
        await this.assertEvaluatorEligible(transaction, context, stage.feedback.evaluatorRoleCodes);
        await this.validateInterviewFeedback(transaction, context, stage, input);
        const feedback = await transaction.interviewFeedbackVersion.create({
          data: {
            agencyId: context.agencyId,
            interviewId,
            interviewerMembershipId: source.interviewerMembershipId,
            versionNo: latest.versionNo + 1,
            score: new Prisma.Decimal(input.score),
            recommendation: input.recommendation,
            comments: input.comments ?? null,
            evidenceDocumentVersionId: input.evidenceDocumentVersionId ?? null,
            replacesFeedbackId: feedbackId,
            correctionReason: input.correctionReason,
          },
          select: { id: true },
        });
        await this.writeAudit(transaction, context, {
          action: 'INTERVIEW_FEEDBACK_CORRECTED',
          entityType: 'InterviewFeedbackVersion',
          entityId: feedback.id,
          previousStatus: null,
          newStatus: null,
          reason: input.correctionReason,
          metadata: safeEvaluationAuditMetadata({
            applicationId,
            interviewId,
            feedbackId: feedback.id,
            replacesFeedbackId: feedbackId,
            stageCode: interview.stageCode,
            versionNo: latest.versionNo + 1,
            evidenceLinked: input.evidenceDocumentVersionId !== undefined,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
      },
    );
  }

  private async runCommand(
    context: RequestContext,
    action: string,
    rawIdempotencyKey: string | undefined,
    applicationId: string,
    command: (
      transaction: Prisma.TransactionClient,
      current: ApplicationRecord,
      previous: { entityId: string; metadata: Prisma.JsonValue } | null,
    ) => Promise<void>,
  ): Promise<ApplicationSummary> {
    return withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const current = await this.lockApplication(transaction, context.agencyId, applicationId);
        if (!current) throw this.notFound('Application');
        const previous = await this.idempotentEvent(
          transaction,
          context,
          action,
          rawIdempotencyKey,
        );
        await command(transaction, current, previous);
        return applicationSummary(
          await this.requireApplication(transaction, context.agencyId, applicationId),
        );
      },
    );
  }

  private async closeStageEvent(
    context: RequestContext,
    applicationId: string,
    stageType: 'ASSESSMENT' | 'INTERVIEW',
    eventId: string,
    status: 'CANCELLED' | 'NO_SHOW',
    reason: string | undefined,
    rawIdempotencyKey: string | undefined,
  ): Promise<ApplicationSummary> {
    const permission =
      stageType === 'ASSESSMENT'
        ? 'recruitment.assessments.manage'
        : 'recruitment.interviews.manage';
    const action =
      stageType === 'ASSESSMENT'
        ? status === 'CANCELLED'
          ? 'ASSESSMENT_CANCELLED'
          : 'ASSESSMENT_NO_SHOW'
        : status === 'CANCELLED'
          ? 'INTERVIEW_CANCELLED'
          : 'INTERVIEW_NO_SHOW';
    this.assertPermission(
      context,
      permission,
      stageType === 'ASSESSMENT'
        ? 'RECRUITMENT_ASSESSMENT_MANAGE_FORBIDDEN'
        : 'RECRUITMENT_INTERVIEW_MANAGE_FORBIDDEN',
    );
    return this.runCommand(
      context,
      action,
      rawIdempotencyKey,
      applicationId,
      async (transaction, current, previous) => {
        if (previous) {
          const replayFields =
            stageType === 'ASSESSMENT' ? { assessmentId: eventId } : { interviewId: eventId };
          if (!this.matchesReplay(previous, applicationId, replayFields)) {
            throw this.idempotencyConflict();
          }
          return;
        }
        this.assertEvaluationOpen(current, 'close a configured stage event');
        const event =
          stageType === 'ASSESSMENT'
            ? await this.requireAssessment(transaction, context.agencyId, applicationId, eventId)
            : await this.requireInterview(transaction, context.agencyId, applicationId, eventId);
        if (event.status !== 'SCHEDULED') {
          throw this.workflowError(
            status === 'CANCELLED' ? 'cancel the stage event' : 'record the no-show outcome',
            event.status,
          );
        }
        const outcome = {
          status,
          outcomeAt: new Date(),
          outcomeReason: reason ?? null,
          updatedByMembershipId: context.membershipId,
          rowVersion: { increment: 1 },
        };
        if (stageType === 'ASSESSMENT') {
          await transaction.assessment.update({
            where: { agencyId_id: { agencyId: context.agencyId, id: eventId } },
            data: outcome,
          });
        } else {
          await transaction.interview.update({
            where: { agencyId_id: { agencyId: context.agencyId, id: eventId } },
            data: outcome,
          });
        }
        await this.writeAudit(transaction, context, {
          action,
          entityType: stageType === 'ASSESSMENT' ? 'Assessment' : 'Interview',
          entityId: eventId,
          previousStatus: 'SCHEDULED',
          newStatus: status,
          reason:
            reason ??
            (status === 'CANCELLED'
              ? 'Stage event cancelled before completion.'
              : 'Applicant recorded as no-show for the stage event.'),
          metadata: safeEvaluationAuditMetadata({
            applicationId,
            ...(stageType === 'ASSESSMENT' ? { assessmentId: eventId } : { interviewId: eventId }),
            stageCode: event.stageCode,
            stageType,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
      },
    );
  }

  private resolvePlan(record: ApplicationRecord): {
    plan: SelectionPlan;
    criteriaSetId: string;
  } {
    const criteriaSet = record.publication.request.criteriaSet;
    if (!criteriaSet) {
      throw new RecruitmentServiceError(
        'The Recruitment Case has no bound Merit Selection Criteria Set.',
        409,
        'RECRUITMENT_SELECTION_PLAN_MISSING',
      );
    }
    const plan = parseSelectionPlan(criteriaSet.criteriaDefinition);
    if (!plan) {
      throw new RecruitmentServiceError(
        'The bound Merit Selection Criteria Set is not a supported configuration.',
        409,
        'RECRUITMENT_SELECTION_PLAN_INVALID',
      );
    }
    return { plan, criteriaSetId: criteriaSet.id };
  }

  private currentStage(plan: SelectionPlan, record: ApplicationRecord): SelectionStage | null {
    const completed = new Set(
      [...record.assessments, ...record.interviews]
        .filter(({ status }) => status === 'COMPLETED')
        .map(({ stageCode }) => stageCode),
    );
    return plan.stages.find(({ stageCode }) => !completed.has(stageCode)) ?? null;
  }

  private requireCurrentStage(
    plan: SelectionPlan,
    record: ApplicationRecord,
    stageCode: string,
    stageType: 'ASSESSMENT' | 'INTERVIEW',
  ): SelectionStage {
    const stage = plan.stages.find((candidate) => candidate.stageCode === stageCode);
    if (!stage) {
      throw new RecruitmentServiceError(
        'The requested stage is not part of the bound Merit Selection Criteria Set.',
        409,
        'RECRUITMENT_STAGE_NOT_CONFIGURED',
      );
    }
    if (stage.stageType !== stageType) {
      throw new RecruitmentServiceError(
        'The requested stage does not match the configured stage type.',
        409,
        'RECRUITMENT_STAGE_TYPE_MISMATCH',
      );
    }
    const current = this.currentStage(plan, record);
    if (!current) {
      throw new RecruitmentServiceError(
        'Every configured selection stage is complete for this Application.',
        409,
        'RECRUITMENT_STAGE_SEQUENCE_COMPLETE',
      );
    }
    if (current.stageCode !== stage.stageCode) {
      throw new RecruitmentServiceError(
        `The next configured stage is ${current.stageCode}. Stages advance in the bound plan order.`,
        409,
        'RECRUITMENT_STAGE_OUT_OF_ORDER',
      );
    }
    return stage;
  }

  private requireCriterion(
    plan: SelectionPlan,
    stageCode: string,
    criterionCode: string,
  ): AssessmentCriterion {
    const stage = assessmentStage(plan, stageCode);
    const criterion = stage?.criteria.find(({ criterionCode: code }) => code === criterionCode);
    if (!criterion) {
      throw new RecruitmentServiceError(
        'The requested criterion is not configured for this Assessment stage.',
        409,
        'RECRUITMENT_CRITERION_NOT_CONFIGURED',
      );
    }
    return criterion;
  }

  private requireInterviewStage(plan: SelectionPlan, stageCode: string): InterviewStage {
    const stage = interviewStage(plan, stageCode);
    if (!stage) {
      throw new RecruitmentServiceError(
        'The Interview stage is not part of the supported bound plan.',
        409,
        'RECRUITMENT_SELECTION_PLAN_INVALID',
      );
    }
    return stage;
  }

  private assertEvaluationOpen(record: ApplicationRecord, action: string): void {
    if (
      !EVALUATION_OPEN_STATUSES.includes(record.status as (typeof EVALUATION_OPEN_STATUSES)[number])
    ) {
      throw this.workflowError(action, record.status);
    }
  }

  private assertResultWindow(record: ApplicationRecord, assessmentStatus: string): void {
    if (assessmentStatus !== 'SCHEDULED' && assessmentStatus !== 'COMPLETED') {
      throw this.workflowError('record results for the Assessment', assessmentStatus);
    }
    this.assertEvaluationOpen(record, 'record results');
  }

  private assertFeedbackWindow(record: ApplicationRecord, interviewStatus: string): void {
    if (interviewStatus !== 'SCHEDULED' && interviewStatus !== 'COMPLETED') {
      throw this.workflowError('record feedback for the Interview', interviewStatus);
    }
    this.assertEvaluationOpen(record, 'record feedback');
  }

  private async validateAssessmentResult(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    criterion: AssessmentCriterion,
    input: AssessmentResultInput | AssessmentResultCorrectionInput,
  ): Promise<void> {
    const invalid = (message: string): never => {
      throw new RecruitmentServiceError(message, 409, 'RECRUITMENT_ASSESSMENT_RESULT_INVALID');
    };
    if (criterion.criterionType === 'NUMERIC') {
      if (input.rating !== undefined)
        invalid('A numeric criterion does not accept a rating label.');
      if (
        input.score < (criterion.minimumScore ?? Number.NEGATIVE_INFINITY) ||
        input.score > (criterion.maximumScore ?? Number.POSITIVE_INFINITY)
      )
        invalid('The score must fall within the configured criterion range.');
    }
    if (criterion.criterionType === 'RATING_SCALE') {
      const option = criterion.ratingScale?.find(({ value }) => value === input.score);
      if (!option || input.rating !== option.code)
        invalid('The score and rating must match one configured rating scale option.');
    }
    if (criterion.criterionType === 'PASS_FAIL') {
      if (input.rating !== undefined)
        invalid('A pass/fail criterion does not accept a rating label.');
      if (input.score !== criterion.passValue && input.score !== criterion.failValue)
        invalid('The score must be the configured pass or fail value.');
    }
    if (criterion.commentsRequired && !input.comments)
      invalid('This criterion requires an evaluator comment.');
    if (criterion.evidenceRequired && !input.evidenceDocumentVersionId)
      invalid('This criterion requires finalized evidence.');
    if (input.evidenceDocumentVersionId) {
      await this.requireFinalizedDocumentVersion(
        transaction,
        context,
        input.evidenceDocumentVersionId,
        'RECRUITMENT_ASSESSMENT_EVIDENCE_INVALID',
      );
    }
  }

  private async validateInterviewFeedback(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    stage: InterviewStage,
    input: InterviewFeedbackInput | InterviewFeedbackCorrectionInput,
  ): Promise<void> {
    const invalid = (message: string): never => {
      throw new RecruitmentServiceError(message, 409, 'RECRUITMENT_INTERVIEW_FEEDBACK_INVALID');
    };
    if (input.score < stage.feedback.minimumScore || input.score > stage.feedback.maximumScore)
      invalid('The feedback score must fall within the configured range.');
    if (stage.feedback.commentsRequired && !input.comments)
      invalid('This stage requires an interviewer comment.');
    if (stage.feedback.evidenceRequired && !input.evidenceDocumentVersionId)
      invalid('This stage requires finalized feedback evidence.');
    if (input.evidenceDocumentVersionId) {
      await this.requireFinalizedDocumentVersion(
        transaction,
        context,
        input.evidenceDocumentVersionId,
        'RECRUITMENT_INTERVIEW_EVIDENCE_INVALID',
      );
    }
  }

  private async assertEvaluatorEligible(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    roleCodes: string[],
  ): Promise<void> {
    const now = new Date();
    const role = await transaction.membershipRole.findFirst({
      where: {
        agencyId: context.agencyId,
        membershipId: context.membershipId,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        role: { code: { in: roleCodes }, status: 'ACTIVE' },
      },
      select: { id: true },
    });
    if (!role) {
      throw new RecruitmentServiceError(
        'The current Agency Membership is not an eligible evaluator for this configured stage.',
        409,
        'RECRUITMENT_EVALUATOR_NOT_ELIGIBLE',
      );
    }
  }

  private async setApplicationStageStatus(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    applicationId: string,
    currentStatus: string,
    status: (typeof STAGE_TYPES)[keyof typeof STAGE_TYPES],
  ): Promise<void> {
    if (currentStatus === status) return;
    await transaction.application.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: applicationId } },
      data: {
        status,
        updatedByMembershipId: context.membershipId,
        rowVersion: { increment: 1 },
      },
    });
  }

  private async requireAssessment(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    applicationId: string,
    assessmentId: string,
  ) {
    const assessment = await transaction.assessment.findFirst({
      where: { agencyId, applicationId, id: assessmentId },
      select: assessmentSelect,
    });
    if (!assessment) throw this.notFound('Assessment');
    return assessment;
  }

  private async requireInterview(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    applicationId: string,
    interviewId: string,
  ) {
    const interview = await transaction.interview.findFirst({
      where: { agencyId, applicationId, id: interviewId },
      select: interviewSelect,
    });
    if (!interview) throw this.notFound('Interview');
    return interview;
  }

  private async requireAssessmentResult(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    assessmentId: string,
    resultId: string,
  ) {
    const result = await transaction.assessmentResultVersion.findFirst({
      where: { agencyId: context.agencyId, assessmentId, id: resultId },
      select: { id: true, criterionCode: true, evaluatedByMembershipId: true },
    });
    if (!result) throw this.notFound('Assessment result');
    return result;
  }

  private async requireApplication(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    applicationId: string,
  ): Promise<ApplicationRecord> {
    const record = await transaction.application.findUnique({
      where: { agencyId_id: { agencyId, id: applicationId } },
      select: applicationSelect,
    });
    if (!record) throw this.notFound('Application');
    return record;
  }

  private async lockApplication(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    applicationId: string,
  ): Promise<ApplicationRecord | null> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "applications" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${applicationId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) return null;
    return this.requireApplication(transaction, agencyId, applicationId);
  }

  private async requireFinalizedDocumentVersion(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    documentVersionId: string,
    errorCode: string,
  ): Promise<void> {
    const version = await this.documents.resolveFinalizedVersionInTransaction(
      transaction,
      context,
      documentVersionId,
    );
    if (!version) {
      throw new RecruitmentServiceError(
        'A finalized Agency Document Version is required as evidence.',
        409,
        errorCode,
      );
    }
  }

  private async idempotentEvent(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    action: string,
    idempotencyKey?: string,
  ): Promise<{ entityId: string; metadata: Prisma.JsonValue } | null> {
    const key = idempotencyKey?.trim();
    if (!key) return null;
    return transaction.auditEvent.findFirst({
      where: {
        agencyId: context.agencyId,
        action,
        idempotencyKey: key,
      },
      select: { entityId: true, metadata: true },
    });
  }

  private matchesReplay(
    previous: { metadata: Prisma.JsonValue } | null,
    applicationId: string,
    fields: Record<string, string>,
  ): boolean {
    if (!previous) return false;
    const metadata = jsonObject(previous.metadata);
    return (
      metadata?.applicationId === applicationId &&
      Object.entries(fields).every(([key, value]) => metadata?.[key] === value)
    );
  }

  private async writeAudit(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: {
      action: string;
      entityType: string;
      entityId: string;
      previousStatus: string | null;
      newStatus: string | null;
      reason: string;
      metadata: Prisma.InputJsonObject;
      idempotencyKey?: string | null | undefined;
    },
  ): Promise<void> {
    await transaction.auditEvent.create({
      data: {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        previousStatus: input.previousStatus,
        newStatus: input.newStatus,
        reason: input.reason,
        requestId: context.requestId,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        metadata: input.metadata,
      },
    });
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (
      !context.agencyId ||
      !context.userId ||
      !context.membershipId ||
      !hasPermission(context, permission, { agencyId: context.agencyId })
    )
      throw new RecruitmentServiceError(
        'The current Agency Membership lacks the required permission.',
        403,
        code,
      );
  }

  private notFound(entity: string): RecruitmentServiceError {
    return new RecruitmentServiceError(
      `The ${entity} could not be found.`,
      404,
      'RECRUITMENT_NOT_FOUND',
    );
  }

  private workflowError(action: string, status: string): RecruitmentServiceError {
    return new RecruitmentServiceError(
      `The Recruitment record cannot ${action} from ${status}.`,
      409,
      'RECRUITMENT_INVALID_TRANSITION',
    );
  }

  private idempotencyConflict(): RecruitmentServiceError {
    return new RecruitmentServiceError(
      'The Idempotency-Key was already used for a different Recruitment command.',
      409,
      'RECRUITMENT_IDEMPOTENCY_CONFLICT',
    );
  }
}
