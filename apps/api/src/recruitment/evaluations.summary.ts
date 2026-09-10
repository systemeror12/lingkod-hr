import { Prisma } from '@prisma/client';
import {
  aggregateAssessmentStage,
  aggregateInterviewStage,
  type AssessmentCriterion,
  type AssessmentStage,
  type InterviewStage,
  type SelectionPlan,
  type StageAggregate,
} from './selection-plan';

export const assessmentResultSelect = {
  id: true,
  criterionCode: true,
  evaluatedByMembershipId: true,
  versionNo: true,
  score: true,
  rating: true,
  comments: true,
  evidenceDocumentVersionId: true,
  replacesResultId: true,
  correctionReason: true,
  recordedAt: true,
} as const;

export const assessmentSelect = {
  id: true,
  criteriaSetId: true,
  stageCode: true,
  stageType: true,
  scheduledAt: true,
  status: true,
  outcomeReason: true,
  completedAt: true,
  outcomeAt: true,
  createdByMembershipId: true,
  createdAt: true,
  updatedAt: true,
  results: {
    orderBy: { recordedAt: 'asc' as const },
    select: assessmentResultSelect,
  },
} as const;

export const interviewFeedbackSelect = {
  id: true,
  interviewerMembershipId: true,
  versionNo: true,
  score: true,
  recommendation: true,
  comments: true,
  evidenceDocumentVersionId: true,
  replacesFeedbackId: true,
  correctionReason: true,
  submittedAt: true,
} as const;

export const interviewSelect = {
  id: true,
  criteriaSetId: true,
  stageCode: true,
  scheduledAt: true,
  locationOrLink: true,
  panelName: true,
  status: true,
  outcomeReason: true,
  completedAt: true,
  outcomeAt: true,
  createdByMembershipId: true,
  createdAt: true,
  updatedAt: true,
  feedback: {
    orderBy: { submittedAt: 'asc' as const },
    select: interviewFeedbackSelect,
  },
} as const;

export type AssessmentRecord = Prisma.AssessmentGetPayload<{ select: typeof assessmentSelect }>;
export type InterviewRecord = Prisma.InterviewGetPayload<{ select: typeof interviewSelect }>;

export interface AssessmentResultSummary {
  id: string;
  criterionCode: string;
  evaluatedByMembershipId: string;
  versionNo: number;
  score: string;
  rating: string | null;
  comments: string | null;
  evidenceDocumentVersionId: string | null;
  recordedAt: string;
  replacesResultId: string | null;
  correctionReason: string | null;
}

export interface AssessmentSummary {
  id: string;
  criteriaSetId: string;
  stageCode: string;
  stageType: 'ASSESSMENT';
  scheduledAt: string | null;
  status: string;
  outcomeReason: string | null;
  completedAt: string | null;
  outcomeAt: string | null;
  createdByMembershipId: string;
  createdAt: string;
  updatedAt: string;
  results: AssessmentResultSummary[];
  aggregate: StageAggregate | null;
}

export interface InterviewFeedbackSummary {
  id: string;
  interviewerMembershipId: string;
  versionNo: number;
  score: string | null;
  recommendation: string;
  comments: string | null;
  evidenceDocumentVersionId: string | null;
  submittedAt: string;
  replacesFeedbackId: string | null;
  correctionReason: string | null;
}

export interface InterviewSummary {
  id: string;
  criteriaSetId: string;
  stageCode: string;
  scheduledAt: string;
  locationOrLink: string | null;
  panelName: string | null;
  status: string;
  outcomeReason: string | null;
  completedAt: string | null;
  outcomeAt: string | null;
  createdByMembershipId: string;
  createdAt: string;
  updatedAt: string;
  feedback: InterviewFeedbackSummary[];
  aggregate: StageAggregate | null;
}

export interface SelectionCriterionSummary {
  criterionCode: string;
  label: string;
  criterionType: AssessmentCriterion['criterionType'];
  weight: number;
  minimumScore: number | null;
  maximumScore: number | null;
  ratingScale: AssessmentCriterion['ratingScale'] | null;
  passValue: number | null;
  failValue: number | null;
  passingScore: number | null;
  evidenceRequired: boolean;
  commentsRequired: boolean;
  evaluatorRoleCodes: string[];
}

export interface SelectionStageSummary {
  stageCode: string;
  stageType: 'ASSESSMENT' | 'INTERVIEW';
  label: string;
  status: 'PENDING' | 'CURRENT' | 'COMPLETE';
  criteria: SelectionCriterionSummary[];
  feedback: InterviewStage['feedback'] | null;
  aggregation: AssessmentStage['aggregation'] | InterviewStage['aggregation'];
}

export interface SelectionPlanSummary {
  criteriaSetId: string;
  criteriaCode: string;
  planVersionId: string;
  stages: SelectionStageSummary[];
}

function stageCriteria(stage: AssessmentStage | InterviewStage): SelectionCriterionSummary[] {
  if (stage.stageType !== 'ASSESSMENT') return [];
  return stage.criteria.map((criterion) => ({
    criterionCode: criterion.criterionCode,
    label: criterion.label,
    criterionType: criterion.criterionType,
    weight: criterion.weight,
    minimumScore: criterion.minimumScore ?? null,
    maximumScore: criterion.maximumScore ?? null,
    ratingScale: criterion.ratingScale ?? null,
    passValue: criterion.passValue ?? null,
    failValue: criterion.failValue ?? null,
    passingScore: criterion.passingScore ?? null,
    evidenceRequired: criterion.evidenceRequired,
    commentsRequired: criterion.commentsRequired,
    evaluatorRoleCodes: criterion.evaluatorRoleCodes,
  }));
}

export function selectionPlanSummary(
  criteriaSet: { id: string; criteriaCode: string; planVersionId: string },
  plan: SelectionPlan,
  completedStageCodes: ReadonlySet<string>,
): SelectionPlanSummary {
  const current = plan.stages.find(({ stageCode }) => !completedStageCodes.has(stageCode));
  return {
    criteriaSetId: criteriaSet.id,
    criteriaCode: criteriaSet.criteriaCode,
    planVersionId: criteriaSet.planVersionId,
    stages: plan.stages.map((stage) => ({
      stageCode: stage.stageCode,
      stageType: stage.stageType,
      label: stage.label,
      status: completedStageCodes.has(stage.stageCode)
        ? 'COMPLETE'
        : current?.stageCode === stage.stageCode
          ? 'CURRENT'
          : 'PENDING',
      criteria: stageCriteria(stage),
      feedback: stage.stageType === 'INTERVIEW' ? stage.feedback : null,
      aggregation: stage.aggregation,
    })),
  };
}

export function completedStageCodes(
  assessments: ReadonlyArray<{ stageCode: string; status: string }>,
  interviews: ReadonlyArray<{ stageCode: string; status: string }>,
): Set<string> {
  return new Set(
    [...assessments, ...interviews]
      .filter(({ status }) => status === 'COMPLETED')
      .map(({ stageCode }) => stageCode),
  );
}

/** The latest recorded version per criterion and evaluator is the standing input. */
export function latestResultsPerEvaluator(
  results: AssessmentResultSummary[],
): AssessmentResultSummary[] {
  const latest = new Map<string, AssessmentResultSummary>();
  for (const result of results) {
    const key = `${result.criterionCode}\u0000${result.evaluatedByMembershipId}`;
    const current = latest.get(key);
    if (!current || current.versionNo < result.versionNo) latest.set(key, result);
  }
  return [...latest.values()];
}

export function latestFeedbackPerInterviewer(
  feedback: InterviewFeedbackSummary[],
): InterviewFeedbackSummary[] {
  const latest = new Map<string, InterviewFeedbackSummary>();
  for (const entry of feedback) {
    const current = latest.get(entry.interviewerMembershipId);
    if (!current || current.versionNo < entry.versionNo)
      latest.set(entry.interviewerMembershipId, entry);
  }
  return [...latest.values()];
}

function assessmentStage(plan: SelectionPlan | null, stageCode: string): AssessmentStage | null {
  const stage = plan?.stages.find(
    (candidate) => candidate.stageCode === stageCode && candidate.stageType === 'ASSESSMENT',
  );
  return stage?.stageType === 'ASSESSMENT' ? stage : null;
}

function interviewStage(plan: SelectionPlan | null, stageCode: string): InterviewStage | null {
  const stage = plan?.stages.find(
    (candidate) => candidate.stageCode === stageCode && candidate.stageType === 'INTERVIEW',
  );
  return stage?.stageType === 'INTERVIEW' ? stage : null;
}

function resultSummary(record: AssessmentRecord['results'][number]): AssessmentResultSummary {
  return {
    id: record.id,
    criterionCode: record.criterionCode,
    evaluatedByMembershipId: record.evaluatedByMembershipId,
    versionNo: record.versionNo,
    score: record.score.toFixed(),
    rating: record.rating,
    comments: record.comments,
    evidenceDocumentVersionId: record.evidenceDocumentVersionId,
    recordedAt: record.recordedAt.toISOString(),
    replacesResultId: record.replacesResultId,
    correctionReason: record.correctionReason,
  };
}

export function assessmentSummary(
  record: AssessmentRecord,
  plan: SelectionPlan | null,
): AssessmentSummary {
  const results = record.results.map(resultSummary);
  const stage = assessmentStage(plan, record.stageCode);
  const aggregate =
    stage === null
      ? null
      : aggregateAssessmentStage(
          stage,
          record.criteriaSetId,
          latestResultsPerEvaluator(results).map((result) => ({
            criterionCode: result.criterionCode,
            evaluatedByMembershipId: result.evaluatedByMembershipId,
            score: result.score,
          })),
        );
  return {
    id: record.id,
    criteriaSetId: record.criteriaSetId,
    stageCode: record.stageCode,
    stageType: 'ASSESSMENT',
    scheduledAt: record.scheduledAt?.toISOString() ?? null,
    status: record.status,
    outcomeReason: record.outcomeReason,
    completedAt: record.completedAt?.toISOString() ?? null,
    outcomeAt: record.outcomeAt?.toISOString() ?? null,
    createdByMembershipId: record.createdByMembershipId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    results,
    aggregate,
  };
}

function feedbackSummary(record: InterviewRecord['feedback'][number]): InterviewFeedbackSummary {
  return {
    id: record.id,
    interviewerMembershipId: record.interviewerMembershipId,
    versionNo: record.versionNo,
    score: record.score?.toFixed() ?? null,
    recommendation: record.recommendation,
    comments: record.comments,
    evidenceDocumentVersionId: record.evidenceDocumentVersionId,
    submittedAt: record.submittedAt.toISOString(),
    replacesFeedbackId: record.replacesFeedbackId,
    correctionReason: record.correctionReason,
  };
}

export function interviewSummary(
  record: InterviewRecord,
  plan: SelectionPlan | null,
): InterviewSummary {
  const feedback = record.feedback.map(feedbackSummary);
  const stage = interviewStage(plan, record.stageCode);
  const aggregate =
    stage === null
      ? null
      : aggregateInterviewStage(
          stage,
          record.criteriaSetId,
          latestFeedbackPerInterviewer(feedback).map((entry) => ({
            interviewerMembershipId: entry.interviewerMembershipId,
            score: entry.score,
          })),
        );
  return {
    id: record.id,
    criteriaSetId: record.criteriaSetId,
    stageCode: record.stageCode,
    scheduledAt: record.scheduledAt.toISOString(),
    locationOrLink: record.locationOrLink,
    panelName: record.panelName,
    status: record.status,
    outcomeReason: record.outcomeReason,
    completedAt: record.completedAt?.toISOString() ?? null,
    outcomeAt: record.outcomeAt?.toISOString() ?? null,
    createdByMembershipId: record.createdByMembershipId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    feedback,
    aggregate,
  };
}
