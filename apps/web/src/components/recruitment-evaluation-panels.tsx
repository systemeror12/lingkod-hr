'use client';

import { useState, type ReactNode } from 'react';
import { Button } from './ui/button';
import { Field, inputClass } from './ui/field';

export interface StageAggregateRecord {
  ruleVersionId: string;
  stageCode: string;
  stageType: string;
  evaluatorCount: number;
  method: string;
  evaluatorMethod: string;
  rounding: { mode: string; decimals: number };
  passingScore: string;
  value: string;
  passed: boolean;
  criteria: Array<{
    criterionCode: string;
    evaluatorCount: number;
    value: string;
    passed: boolean | null;
  }>;
  tieBreakValues: string[];
}

export interface AssessmentResultRecord {
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

export interface AssessmentRecord {
  id: string;
  criteriaSetId: string;
  stageCode: string;
  stageType: string;
  scheduledAt: string | null;
  status: string;
  outcomeReason: string | null;
  completedAt: string | null;
  outcomeAt: string | null;
  createdByMembershipId: string;
  createdAt: string;
  updatedAt: string;
  results: AssessmentResultRecord[];
  aggregate: StageAggregateRecord | null;
}

export interface InterviewFeedbackRecord {
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

export interface InterviewRecord {
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
  feedback: InterviewFeedbackRecord[];
  aggregate: StageAggregateRecord | null;
}

export interface SelectionCriterionRecord {
  criterionCode: string;
  label: string;
  criterionType: string;
  weight: number;
  minimumScore: number | null;
  maximumScore: number | null;
  ratingScale: Array<{ code: string; label: string; value: number }> | null;
  passValue: number | null;
  failValue: number | null;
  passingScore: number | null;
  evidenceRequired: boolean;
  commentsRequired: boolean;
  evaluatorRoleCodes: string[];
}

export interface SelectionStageRecord {
  stageCode: string;
  stageType: string;
  label: string;
  status: 'PENDING' | 'CURRENT' | 'COMPLETE';
  criteria: SelectionCriterionRecord[];
  feedback: {
    minimumScore: number;
    maximumScore: number;
    passingScore: number;
    evidenceRequired: boolean;
    commentsRequired: boolean;
    evaluatorRoleCodes: string[];
  } | null;
  aggregation: {
    method?: string;
    evaluatorMethod: string;
    rounding: { mode: string; decimals: number };
    passingScore: number;
    tieBreakers?: string[];
  };
}

export interface SelectionPlanRecord {
  criteriaSetId: string;
  criteriaCode: string;
  planVersionId: string;
  stages: SelectionStageRecord[];
}

export interface EvaluationDocumentOption {
  documentId: string;
  documentNo: string | null;
  documentType: string;
  status: string;
  version: { id: string; versionNo: number; issuedAt: string | null };
}

interface Props {
  record: {
    id: string;
    status: string;
    selectionPlan: SelectionPlanRecord | null;
    selectionPlanIssue: string | null;
    assessments: AssessmentRecord[];
    interviews: InterviewRecord[];
  };
  agencyId: string;
  membershipId: string;
  documents: EvaluationDocumentOption[];
  canManageAssessments: boolean;
  canManageInterviews: boolean;
  busy: boolean;
  onCommand: (path: string, body?: unknown) => Promise<void>;
}

function inputValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function dateTimeLabel(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

function statusTone(status: string): 'blue' | 'amber' | 'green' | 'gray' | 'red' {
  if (status === 'COMPLETED') return 'green';
  if (status === 'SCHEDULED') return 'amber';
  if (status === 'CANCELLED' || status === 'NO_SHOW') return 'red';
  return 'blue';
}

function StatusBadge({ status }: { status: string }) {
  const tones = {
    blue: 'border-[#b9cce5] bg-[#edf2f9] text-[#315d98]',
    amber: 'border-[#decba7] bg-[#fff8e9] text-[#755421]',
    green: 'border-[#b6d9c3] bg-[#eef9f1] text-[#296442]',
    gray: 'border-line bg-canvas text-muted',
    red: 'border-[#e8b6b6] bg-[#fff4f4] text-[#9a3030]',
  };
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-[0.06em] uppercase ${tones[statusTone(status)]}`}
    >
      {status.replaceAll('_', ' ')}
    </span>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 rounded-[4px] border border-line bg-paper p-5 shadow-[0_7px_20px_rgb(23_32_51/4%)]">
      <div className="grid gap-1">
        <h2 className="m-0 text-[17px] font-[720] tracking-[-0.02em] text-midnight">{title}</h2>
        {description ? (
          <p className="m-0 text-[13px] leading-[1.55] text-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line/70 py-3 last:border-b-0">
      <dt className="text-[10px] font-bold tracking-[0.07em] text-muted uppercase">{label}</dt>
      <dd className="m-0 text-sm leading-[1.5] text-ink">{children}</dd>
    </div>
  );
}

function aggregateSummary(aggregate: StageAggregateRecord | null): string {
  if (!aggregate) return 'No aggregate yet';
  return `${aggregate.value} · ${aggregate.passed ? 'Passed' : 'Below cutoff'} · ${aggregate.method.replaceAll('_', ' ')} · round ${aggregate.rounding.mode.replaceAll('_', ' ')} to ${aggregate.rounding.decimals} decimal(s)`;
}

const CLOSED_APPLICATION_STATUSES = [
  'FOR_DELIBERATION',
  'RECOMMENDED',
  'NOT_RECOMMENDED',
  'SELECTED',
  'NOT_SELECTED',
  'NOT_QUALIFIED',
  'WITHDRAWN',
  'CLOSED',
];

export function RecruitmentEvaluationPanels({
  record,
  agencyId,
  membershipId,
  documents,
  canManageAssessments,
  canManageInterviews,
  busy,
  onCommand,
}: Props) {
  const [assessmentStageCode, setAssessmentStageCode] = useState('');
  const [assessmentScheduledAt, setAssessmentScheduledAt] = useState('');
  const [interviewStageCode, setInterviewStageCode] = useState('');
  const [interviewScheduledAt, setInterviewScheduledAt] = useState('');
  const [interviewLocation, setInterviewLocation] = useState('');
  const [panelName, setPanelName] = useState('');
  const [outcomeReason, setOutcomeReason] = useState('');
  const [resultEditor, setResultEditor] = useState<{
    assessmentId: string;
    mode: 'record' | 'correct';
    criterionCode: string;
    resultId?: string;
    score: string;
    rating: string;
    comments: string;
    evidenceDocumentVersionId: string;
    correctionReason: string;
  } | null>(null);
  const [feedbackEditor, setFeedbackEditor] = useState<{
    interviewId: string;
    mode: 'record' | 'correct';
    feedbackId?: string;
    score: string;
    recommendation: string;
    comments: string;
    evidenceDocumentVersionId: string;
    correctionReason: string;
  } | null>(null);

  const plan = record.selectionPlan;
  const currentStage = plan?.stages.find(({ status }) => status === 'CURRENT') ?? null;
  const evaluationOpen = !CLOSED_APPLICATION_STATUSES.includes(record.status);
  const linkable = documents.filter(
    (document) => document.status !== 'VOIDED' && document.version.issuedAt,
  );

  const assessmentStage = currentStage?.stageType === 'ASSESSMENT' ? currentStage : null;
  const interviewStage = currentStage?.stageType === 'INTERVIEW' ? currentStage : null;
  const openAssessment = record.assessments.find(
    (assessment) =>
      assessmentStage &&
      assessment.stageCode === assessmentStage.stageCode &&
      assessment.status === 'SCHEDULED',
  );
  const openInterview = record.interviews.find(
    (interview) =>
      interviewStage &&
      interview.stageCode === interviewStage.stageCode &&
      interview.status === 'SCHEDULED',
  );

  const selectedAssessment = resultEditor
    ? (record.assessments.find(({ id }) => id === resultEditor.assessmentId) ?? null)
    : null;
  const editorCriteria =
    selectedAssessment && plan
      ? (plan.stages.find(({ stageCode }) => stageCode === selectedAssessment.stageCode)
          ?.criteria ?? [])
      : [];
  const selectedCriterion =
    editorCriteria.find(({ criterionCode }) => criterionCode === resultEditor?.criterionCode) ??
    null;

  function scheduleAssessmentPath(): string {
    return `/api/v1/agencies/${agencyId}/recruitment/applications/${record.id}/assessments`;
  }

  function assessmentActionPath(assessmentId: string, action: string): string {
    return `/api/v1/agencies/${agencyId}/recruitment/applications/${record.id}/assessments/${assessmentId}/${action}`;
  }

  function resultPath(assessmentId: string): string {
    return `/api/v1/agencies/${agencyId}/recruitment/applications/${record.id}/assessments/${assessmentId}/results`;
  }

  function resultCorrectionPath(assessmentId: string, resultId: string): string {
    return `/api/v1/agencies/${agencyId}/recruitment/applications/${record.id}/assessments/${assessmentId}/results/${resultId}/correct`;
  }

  function scheduleInterviewPath(): string {
    return `/api/v1/agencies/${agencyId}/recruitment/applications/${record.id}/interviews`;
  }

  function interviewActionPath(interviewId: string, action: string): string {
    return `/api/v1/agencies/${agencyId}/recruitment/applications/${record.id}/interviews/${interviewId}/${action}`;
  }

  function feedbackPath(interviewId: string): string {
    return `/api/v1/agencies/${agencyId}/recruitment/applications/${record.id}/interviews/${interviewId}/feedback`;
  }

  function feedbackCorrectionPath(interviewId: string, feedbackId: string): string {
    return `/api/v1/agencies/${agencyId}/recruitment/applications/${record.id}/interviews/${interviewId}/feedback/${feedbackId}/correct`;
  }

  function resultBody(): Record<string, unknown> | null {
    if (!resultEditor || !selectedCriterion) return null;
    let score: number | null = null;
    let rating: string | undefined;
    if (selectedCriterion.criterionType === 'RATING_SCALE') {
      const option = selectedCriterion.ratingScale?.find(
        ({ code }) => code === resultEditor.rating,
      );
      if (!option) return null;
      score = option.value;
      rating = option.code;
    } else if (selectedCriterion.criterionType === 'PASS_FAIL') {
      if (resultEditor.rating === 'PASS') score = selectedCriterion.passValue;
      else if (resultEditor.rating === 'FAIL') score = selectedCriterion.failValue;
      if (score === null) return null;
    } else {
      if (resultEditor.score.trim() === '') return null;
      const parsed = Number(resultEditor.score);
      if (!Number.isFinite(parsed)) return null;
      score = parsed;
    }
    return {
      criterionCode: resultEditor.criterionCode,
      score,
      ...(rating ? { rating } : {}),
      ...(resultEditor.comments ? { comments: resultEditor.comments } : {}),
      ...(resultEditor.evidenceDocumentVersionId
        ? { evidenceDocumentVersionId: resultEditor.evidenceDocumentVersionId }
        : {}),
      ...(resultEditor.mode === 'correct'
        ? { correctionReason: resultEditor.correctionReason }
        : {}),
    };
  }

  const feedbackBody = feedbackEditor
    ? {
        score: Number(feedbackEditor.score),
        recommendation: feedbackEditor.recommendation,
        ...(feedbackEditor.comments ? { comments: feedbackEditor.comments } : {}),
        ...(feedbackEditor.evidenceDocumentVersionId
          ? { evidenceDocumentVersionId: feedbackEditor.evidenceDocumentVersionId }
          : {}),
        ...(feedbackEditor.mode === 'correct'
          ? { correctionReason: feedbackEditor.correctionReason }
          : {}),
      }
    : null;

  return (
    <div className="grid gap-5">
      <Panel
        title="Merit selection stages"
        description="The bound Merit Selection Criteria Set defines the typed criteria, rating scales, cutoffs, evidence, evaluator eligibility, aggregation, rounding, and tie order. Stages advance in the configured order."
      >
        {record.selectionPlanIssue ? (
          <p className="m-0 rounded-[3px] border border-[#e8b6b6] bg-[#fff4f4] px-3 py-3 text-sm text-[#9a3030]">
            {record.selectionPlanIssue}
          </p>
        ) : plan ? (
          <div className="grid gap-3">
            <span className="text-xs text-muted">
              Criteria set {plan.criteriaCode} · plan version {plan.planVersionId}
            </span>
            {plan.stages.map((stage) => (
              <div
                className="grid gap-2 rounded-[3px] border border-line px-3 py-3"
                key={stage.stageCode}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={stage.status} />
                  <strong className="text-sm font-[680] text-midnight">{stage.label}</strong>
                  <span className="text-xs text-muted">
                    {stage.stageCode} · {stage.stageType.toLowerCase()}
                  </span>
                </div>
                {stage.criteria.length ? (
                  <div className="grid gap-1">
                    {stage.criteria.map((criterion) => (
                      <span className="text-xs text-muted" key={criterion.criterionCode}>
                        <strong className="text-ink">{criterion.criterionCode}</strong> ·{' '}
                        {criterion.criterionType.replaceAll('_', ' ').toLowerCase()} · weight{' '}
                        {criterion.weight} ·{' '}
                        {criterion.ratingScale
                          ? criterion.ratingScale
                              .map(({ code, value }) => `${code} (${value})`)
                              .join(' · ')
                          : `${criterion.minimumScore ?? criterion.passValue} to ${criterion.maximumScore ?? criterion.failValue}`}
                        {criterion.passingScore !== null ? ` · pass ${criterion.passingScore}` : ''}
                        {criterion.evidenceRequired ? ' · evidence required' : ''}
                        {criterion.commentsRequired ? ' · comment required' : ''}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-muted">
                    Feedback score {stage.feedback?.minimumScore} to {stage.feedback?.maximumScore}{' '}
                    · pass {stage.feedback?.passingScore}
                    {stage.feedback?.evidenceRequired ? ' · evidence required' : ''}
                    {stage.feedback?.commentsRequired ? ' · comment required' : ''}
                  </span>
                )}
                <span className="text-xs text-muted">
                  Aggregation {stage.aggregation.evaluatorMethod.replaceAll('_', ' ')} across
                  evaluators
                  {stage.aggregation.method
                    ? ` · ${stage.aggregation.method.replaceAll('_', ' ')} across criteria`
                    : ''}{' '}
                  · round {stage.aggregation.rounding.mode.replaceAll('_', ' ')} to{' '}
                  {stage.aggregation.rounding.decimals} decimal(s)
                  {stage.aggregation.tieBreakers?.length
                    ? ` · tie order ${stage.aggregation.tieBreakers.join(' → ')}`
                    : ''}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="m-0 text-sm text-muted">No supported selection configuration is bound.</p>
        )}
      </Panel>

      <Panel
        title="Assessments"
        description="Schedule the configured assessment stage and record typed criterion results. Results are immutable; a correction appends a linked replacement and every aggregate is recomputed from the recorded inputs."
      >
        <div className="grid gap-3 border-b border-line pb-4">
          {record.assessments.length ? (
            record.assessments.map((assessment) => (
              <div
                className="grid gap-3 rounded-[3px] border border-line px-3 py-3"
                key={assessment.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={assessment.status} />
                  <strong className="text-sm font-[680] text-midnight">
                    {plan?.stages.find(({ stageCode }) => stageCode === assessment.stageCode)
                      ?.label ?? assessment.stageCode}
                  </strong>
                  <span className="text-xs text-muted">
                    scheduled {dateTimeLabel(assessment.scheduledAt)}
                    {assessment.completedAt
                      ? ` · completed ${dateTimeLabel(assessment.completedAt)}`
                      : ''}
                    {assessment.outcomeAt
                      ? ` · ${assessment.status.toLowerCase()} ${dateTimeLabel(assessment.outcomeAt)}`
                      : ''}
                  </span>
                </div>
                {assessment.outcomeReason ? (
                  <span className="text-xs text-muted">
                    Outcome reason: {assessment.outcomeReason}
                  </span>
                ) : null}
                <div className="grid gap-1 min-[720px]:grid-cols-2">
                  <dl className="m-0">
                    <DetailRow label="Aggregate">
                      {aggregateSummary(assessment.aggregate)}
                      {assessment.aggregate
                        ? ` · cutoff ${assessment.aggregate.passingScore} · rule version ${assessment.aggregate.ruleVersionId}`
                        : ''}
                    </DetailRow>
                    <DetailRow label="Evaluators">
                      {assessment.aggregate?.evaluatorCount ?? 0}
                    </DetailRow>
                  </dl>
                  <dl className="m-0">
                    {assessment.aggregate?.criteria.map((criterion) => (
                      <DetailRow key={criterion.criterionCode} label={criterion.criterionCode}>
                        {criterion.value} · {criterion.evaluatorCount} evaluator(s)
                        {criterion.passed === null
                          ? ''
                          : criterion.passed
                            ? ' · passed'
                            : ' · below cutoff'}
                      </DetailRow>
                    )) ?? <DetailRow label="Criteria">No results recorded yet.</DetailRow>}
                  </dl>
                </div>
                <div className="grid gap-1">
                  {assessment.results.map((result) => (
                    <div
                      className="flex flex-wrap items-center justify-between gap-2 rounded-[3px] border border-line/70 px-3 py-2 text-xs"
                      key={result.id}
                    >
                      <span className="text-muted">
                        <strong className="text-ink">{result.criterionCode}</strong> · v
                        {result.versionNo} · score {result.score}
                        {result.rating ? ` · ${result.rating}` : ''} · evaluator{' '}
                        {result.evaluatedByMembershipId.slice(0, 8)}… ·{' '}
                        {dateTimeLabel(result.recordedAt)}
                        {result.evidenceDocumentVersionId ? ' · evidence linked' : ''}
                        {result.correctionReason ? ` · correction: ${result.correctionReason}` : ''}
                      </span>
                      {canManageAssessments &&
                      evaluationOpen &&
                      result.evaluatedByMembershipId === membershipId ? (
                        <button
                          className="rounded-[2px] text-cobalt underline-offset-2 hover:underline"
                          type="button"
                          onClick={() => {
                            const criterion = plan?.stages
                              .find(({ stageCode }) => stageCode === assessment.stageCode)
                              ?.criteria.find(
                                ({ criterionCode }) => criterionCode === result.criterionCode,
                              );
                            const rating =
                              result.rating ??
                              (criterion?.criterionType === 'PASS_FAIL'
                                ? Number(result.score) === criterion.passValue
                                  ? 'PASS'
                                  : Number(result.score) === criterion.failValue
                                    ? 'FAIL'
                                    : ''
                                : '');
                            setResultEditor({
                              assessmentId: assessment.id,
                              mode: 'correct',
                              criterionCode: result.criterionCode,
                              resultId: result.id,
                              score: result.score,
                              rating,
                              comments: result.comments ?? '',
                              evidenceDocumentVersionId: result.evidenceDocumentVersionId ?? '',
                              correctionReason: '',
                            });
                          }}
                        >
                          Correct result
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {assessment.results.length === 0 ? (
                    <span className="text-xs text-muted">No evaluator results recorded yet.</span>
                  ) : null}
                </div>
                {canManageAssessments && evaluationOpen && assessment.status === 'SCHEDULED' ? (
                  <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
                    <Field
                      label="Assessment outcome reason"
                      htmlFor={`assessment-outcome-${assessment.id}`}
                    >
                      <input
                        className={inputClass}
                        id={`assessment-outcome-${assessment.id}`}
                        value={outcomeReason}
                        onChange={(event) => setOutcomeReason(inputValue(event))}
                        placeholder="Required to cancel"
                      />
                    </Field>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void onCommand(assessmentActionPath(assessment.id, 'complete'))
                      }
                      size="default"
                      variant="primary"
                    >
                      Complete assessment
                    </Button>
                    <Button
                      disabled={busy || !outcomeReason}
                      onClick={() =>
                        void onCommand(assessmentActionPath(assessment.id, 'cancel'), {
                          reason: outcomeReason,
                        })
                      }
                      size="default"
                      variant="secondary"
                    >
                      Cancel assessment
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void onCommand(assessmentActionPath(assessment.id, 'no-show'), {
                          ...(outcomeReason ? { reason: outcomeReason } : {}),
                        })
                      }
                      size="default"
                      variant="secondary"
                    >
                      Record assessment no-show
                    </Button>
                    <Button
                      disabled={busy || !assessmentStage}
                      onClick={() => {
                        setResultEditor({
                          assessmentId: assessment.id,
                          mode: 'record',
                          criterionCode: '',
                          score: '',
                          rating: '',
                          comments: '',
                          evidenceDocumentVersionId: '',
                          correctionReason: '',
                        });
                      }}
                      size="default"
                      variant="secondary"
                    >
                      Record assessment result
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <span className="text-sm text-muted">No assessment recorded yet.</span>
          )}
        </div>

        {canManageAssessments &&
        evaluationOpen &&
        assessmentStage &&
        !openAssessment &&
        ['QUALIFIED', 'FOR_ASSESSMENT', 'FOR_INTERVIEW'].includes(record.status) ? (
          <div className="grid items-end gap-3 min-[720px]:grid-cols-3">
            <Field label="Assessment stage" htmlFor="assessment-stage">
              <select
                className={inputClass}
                id="assessment-stage"
                value={assessmentStageCode || assessmentStage.stageCode}
                onChange={(event) => setAssessmentStageCode(inputValue(event))}
              >
                <option value={assessmentStage.stageCode}>{assessmentStage.label}</option>
              </select>
            </Field>
            <Field label="Assessment scheduled at" htmlFor="assessment-scheduled-at">
              <input
                className={inputClass}
                id="assessment-scheduled-at"
                type="datetime-local"
                value={assessmentScheduledAt}
                onChange={(event) => setAssessmentScheduledAt(inputValue(event))}
              />
            </Field>
            <div>
              <Button
                disabled={busy}
                onClick={() =>
                  void onCommand(scheduleAssessmentPath(), {
                    stageCode: assessmentStageCode || assessmentStage.stageCode,
                    ...(assessmentScheduledAt
                      ? { scheduledAt: new Date(assessmentScheduledAt).toISOString() }
                      : {}),
                  })
                }
                size="default"
                variant="secondary"
              >
                Schedule assessment
              </Button>
            </div>
          </div>
        ) : null}

        {canManageAssessments && evaluationOpen && resultEditor ? (
          <div className="grid gap-3 border-t border-line pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-sm font-[680] text-midnight">
                {resultEditor.mode === 'record' ? 'Record result' : 'Correct result'}
              </strong>
              {resultEditor.mode === 'correct' ? (
                <span className="text-xs text-muted">
                  Version{' '}
                  {selectedAssessment?.results.find(({ id }) => id === resultEditor.resultId)
                    ?.versionNo ?? ''}{' '}
                  is preserved.
                </span>
              ) : null}
            </div>
            <div className="grid gap-3 min-[720px]:grid-cols-3">
              <Field label="Criterion" htmlFor="result-criterion">
                <select
                  className={inputClass}
                  id="result-criterion"
                  value={resultEditor.criterionCode}
                  onChange={(event) =>
                    setResultEditor({
                      ...resultEditor,
                      criterionCode: inputValue(event),
                      score: '',
                      rating: '',
                    })
                  }
                >
                  <option value="">Select criterion</option>
                  {editorCriteria.map((criterion) => (
                    <option key={criterion.criterionCode} value={criterion.criterionCode}>
                      {criterion.label} ({criterion.criterionCode})
                    </option>
                  ))}
                </select>
              </Field>
              {selectedCriterion?.criterionType === 'RATING_SCALE' ? (
                <Field label="Rating" htmlFor="result-rating">
                  <select
                    className={inputClass}
                    id="result-rating"
                    value={resultEditor.rating}
                    onChange={(event) =>
                      setResultEditor({ ...resultEditor, rating: inputValue(event) })
                    }
                  >
                    <option value="">Select rating</option>
                    {selectedCriterion.ratingScale?.map(({ code, label, value }) => (
                      <option key={code} value={code}>
                        {label} ({value})
                      </option>
                    ))}
                  </select>
                </Field>
              ) : selectedCriterion?.criterionType === 'PASS_FAIL' ? (
                <Field label="Pass or fail" htmlFor="result-pass-fail">
                  <select
                    className={inputClass}
                    id="result-pass-fail"
                    value={resultEditor.rating}
                    onChange={(event) =>
                      setResultEditor({ ...resultEditor, rating: inputValue(event) })
                    }
                  >
                    <option value="">Select outcome</option>
                    <option value="PASS">Pass ({selectedCriterion.passValue})</option>
                    <option value="FAIL">Fail ({selectedCriterion.failValue})</option>
                  </select>
                </Field>
              ) : (
                <Field label="Score" htmlFor="result-score">
                  <input
                    className={inputClass}
                    id="result-score"
                    inputMode="decimal"
                    value={resultEditor.score}
                    onChange={(event) =>
                      setResultEditor({ ...resultEditor, score: inputValue(event) })
                    }
                  />
                </Field>
              )}
              <Field label="Result comments" htmlFor="result-comments">
                <input
                  className={inputClass}
                  id="result-comments"
                  value={resultEditor.comments}
                  onChange={(event) =>
                    setResultEditor({ ...resultEditor, comments: inputValue(event) })
                  }
                />
              </Field>
              <Field label="Result evidence document version" htmlFor="result-evidence">
                <select
                  className={inputClass}
                  id="result-evidence"
                  value={resultEditor.evidenceDocumentVersionId}
                  onChange={(event) =>
                    setResultEditor({
                      ...resultEditor,
                      evidenceDocumentVersionId: inputValue(event),
                    })
                  }
                >
                  <option value="">No evidence</option>
                  {linkable.map((document) => (
                    <option key={document.version.id} value={document.version.id}>
                      {document.documentNo ?? document.documentType} · v{document.version.versionNo}
                    </option>
                  ))}
                </select>
              </Field>
              {resultEditor.mode === 'correct' ? (
                <Field label="Correction reason" htmlFor="result-correction-reason">
                  <input
                    className={inputClass}
                    id="result-correction-reason"
                    value={resultEditor.correctionReason}
                    onChange={(event) =>
                      setResultEditor({ ...resultEditor, correctionReason: inputValue(event) })
                    }
                  />
                </Field>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  busy ||
                  !resultEditor.criterionCode ||
                  (resultEditor.mode === 'correct' && !resultEditor.correctionReason) ||
                  resultBody() === null
                }
                onClick={() => {
                  const body = resultBody();
                  if (!body) return;
                  void onCommand(
                    resultEditor.mode === 'correct' && resultEditor.resultId
                      ? resultCorrectionPath(resultEditor.assessmentId, resultEditor.resultId)
                      : resultPath(resultEditor.assessmentId),
                    body,
                  ).then(() => setResultEditor(null));
                }}
                size="default"
                variant="primary"
              >
                {resultEditor.mode === 'record' ? 'Save assessment result' : 'Save correction'}
              </Button>
              <Button
                disabled={busy}
                onClick={() => setResultEditor(null)}
                size="default"
                variant="secondary"
              >
                Close result editor
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>

      <Panel
        title="Interviews"
        description="Schedule the configured interview stage and record versioned interviewer feedback. Completed feedback is immutable."
      >
        <div className="grid gap-3 border-b border-line pb-4">
          {record.interviews.length ? (
            record.interviews.map((interview) => (
              <div
                className="grid gap-3 rounded-[3px] border border-line px-3 py-3"
                key={interview.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={interview.status} />
                  <strong className="text-sm font-[680] text-midnight">
                    {plan?.stages.find(({ stageCode }) => stageCode === interview.stageCode)
                      ?.label ?? interview.stageCode}
                  </strong>
                  <span className="text-xs text-muted">
                    {dateTimeLabel(interview.scheduledAt)}
                    {interview.locationOrLink ? ` · ${interview.locationOrLink}` : ''}
                    {interview.panelName ? ` · ${interview.panelName}` : ''}
                  </span>
                </div>
                {interview.outcomeReason ? (
                  <span className="text-xs text-muted">
                    Outcome reason: {interview.outcomeReason}
                  </span>
                ) : null}
                <dl className="m-0">
                  <DetailRow label="Aggregate">
                    {aggregateSummary(interview.aggregate)}
                    {interview.aggregate
                      ? ` · cutoff ${interview.aggregate.passingScore} · rule version ${interview.aggregate.ruleVersionId}`
                      : ''}
                  </DetailRow>
                </dl>
                <div className="grid gap-1">
                  {interview.feedback.map((feedback) => (
                    <div
                      className="flex flex-wrap items-center justify-between gap-2 rounded-[3px] border border-line/70 px-3 py-2 text-xs"
                      key={feedback.id}
                    >
                      <span className="text-muted">
                        <strong className="text-ink">
                          {feedback.recommendation.replaceAll('_', ' ')}
                        </strong>
                        {feedback.score !== null ? ` · score ${feedback.score}` : ''} · v
                        {feedback.versionNo} · interviewer{' '}
                        {feedback.interviewerMembershipId.slice(0, 8)}… ·{' '}
                        {dateTimeLabel(feedback.submittedAt)}
                        {feedback.evidenceDocumentVersionId ? ' · evidence linked' : ''}
                        {feedback.correctionReason
                          ? ` · correction: ${feedback.correctionReason}`
                          : ''}
                      </span>
                      {canManageInterviews &&
                      evaluationOpen &&
                      feedback.interviewerMembershipId === membershipId ? (
                        <button
                          className="rounded-[2px] text-cobalt underline-offset-2 hover:underline"
                          type="button"
                          onClick={() =>
                            setFeedbackEditor({
                              interviewId: interview.id,
                              mode: 'correct',
                              feedbackId: feedback.id,
                              score: feedback.score ?? '',
                              recommendation: feedback.recommendation,
                              comments: feedback.comments ?? '',
                              evidenceDocumentVersionId: feedback.evidenceDocumentVersionId ?? '',
                              correctionReason: '',
                            })
                          }
                        >
                          Correct feedback
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {interview.feedback.length === 0 ? (
                    <span className="text-xs text-muted">
                      No interviewer feedback recorded yet.
                    </span>
                  ) : null}
                </div>
                {canManageInterviews && evaluationOpen && interview.status === 'SCHEDULED' ? (
                  <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
                    <Field
                      label="Interview outcome reason"
                      htmlFor={`interview-outcome-${interview.id}`}
                    >
                      <input
                        className={inputClass}
                        id={`interview-outcome-${interview.id}`}
                        value={outcomeReason}
                        onChange={(event) => setOutcomeReason(inputValue(event))}
                        placeholder="Required to cancel"
                      />
                    </Field>
                    <Button
                      disabled={busy}
                      onClick={() => void onCommand(interviewActionPath(interview.id, 'complete'))}
                      size="default"
                      variant="primary"
                    >
                      Complete interview
                    </Button>
                    <Button
                      disabled={busy || !outcomeReason}
                      onClick={() =>
                        void onCommand(interviewActionPath(interview.id, 'cancel'), {
                          reason: outcomeReason,
                        })
                      }
                      size="default"
                      variant="secondary"
                    >
                      Cancel interview
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void onCommand(interviewActionPath(interview.id, 'no-show'), {
                          ...(outcomeReason ? { reason: outcomeReason } : {}),
                        })
                      }
                      size="default"
                      variant="secondary"
                    >
                      Record interview no-show
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        setFeedbackEditor({
                          interviewId: interview.id,
                          mode: 'record',
                          score: '',
                          recommendation: 'PROCEED',
                          comments: '',
                          evidenceDocumentVersionId: '',
                          correctionReason: '',
                        })
                      }
                      size="default"
                      variant="secondary"
                    >
                      Record interview feedback
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <span className="text-sm text-muted">No interview recorded yet.</span>
          )}
        </div>

        {canManageInterviews &&
        evaluationOpen &&
        interviewStage &&
        !openInterview &&
        ['QUALIFIED', 'FOR_ASSESSMENT', 'FOR_INTERVIEW'].includes(record.status) ? (
          <div className="grid items-end gap-3 min-[720px]:grid-cols-4">
            <Field label="Interview stage" htmlFor="interview-stage">
              <select
                className={inputClass}
                id="interview-stage"
                value={interviewStageCode || interviewStage.stageCode}
                onChange={(event) => setInterviewStageCode(inputValue(event))}
              >
                <option value={interviewStage.stageCode}>{interviewStage.label}</option>
              </select>
            </Field>
            <Field label="Interview scheduled at" htmlFor="interview-scheduled-at">
              <input
                className={inputClass}
                id="interview-scheduled-at"
                type="datetime-local"
                value={interviewScheduledAt}
                onChange={(event) => setInterviewScheduledAt(inputValue(event))}
              />
            </Field>
            <Field label="Location or link" htmlFor="interview-location">
              <input
                className={inputClass}
                id="interview-location"
                value={interviewLocation}
                onChange={(event) => setInterviewLocation(inputValue(event))}
              />
            </Field>
            <Field label="Panel name" htmlFor="interview-panel">
              <input
                className={inputClass}
                id="interview-panel"
                value={panelName}
                onChange={(event) => setPanelName(inputValue(event))}
              />
            </Field>
            <div>
              <Button
                disabled={busy || !interviewScheduledAt}
                onClick={() =>
                  void onCommand(scheduleInterviewPath(), {
                    stageCode: interviewStageCode || interviewStage.stageCode,
                    scheduledAt: new Date(interviewScheduledAt).toISOString(),
                    ...(interviewLocation ? { locationOrLink: interviewLocation } : {}),
                    ...(panelName ? { panelName } : {}),
                  })
                }
                size="default"
                variant="secondary"
              >
                Schedule interview
              </Button>
            </div>
          </div>
        ) : null}

        {canManageInterviews && evaluationOpen && feedbackEditor ? (
          <div className="grid gap-3 border-t border-line pt-4">
            <strong className="text-sm font-[680] text-midnight">
              {feedbackEditor.mode === 'record'
                ? 'Record interview feedback'
                : 'Correct interview feedback'}
            </strong>
            <div className="grid gap-3 min-[720px]:grid-cols-3">
              <Field label="Feedback score" htmlFor="feedback-score">
                <input
                  className={inputClass}
                  id="feedback-score"
                  inputMode="decimal"
                  value={feedbackEditor.score}
                  onChange={(event) =>
                    setFeedbackEditor({ ...feedbackEditor, score: inputValue(event) })
                  }
                />
              </Field>
              <Field label="Recommendation" htmlFor="feedback-recommendation">
                <select
                  className={inputClass}
                  id="feedback-recommendation"
                  value={feedbackEditor.recommendation}
                  onChange={(event) =>
                    setFeedbackEditor({ ...feedbackEditor, recommendation: inputValue(event) })
                  }
                >
                  <option value="PROCEED">Proceed</option>
                  <option value="HOLD">Hold</option>
                  <option value="DO_NOT_PROCEED">Do not proceed</option>
                </select>
              </Field>
              <Field label="Feedback comments" htmlFor="feedback-comments">
                <input
                  className={inputClass}
                  id="feedback-comments"
                  value={feedbackEditor.comments}
                  onChange={(event) =>
                    setFeedbackEditor({ ...feedbackEditor, comments: inputValue(event) })
                  }
                />
              </Field>
              <Field label="Feedback evidence document version" htmlFor="feedback-evidence">
                <select
                  className={inputClass}
                  id="feedback-evidence"
                  value={feedbackEditor.evidenceDocumentVersionId}
                  onChange={(event) =>
                    setFeedbackEditor({
                      ...feedbackEditor,
                      evidenceDocumentVersionId: inputValue(event),
                    })
                  }
                >
                  <option value="">No evidence</option>
                  {linkable.map((document) => (
                    <option key={document.version.id} value={document.version.id}>
                      {document.documentNo ?? document.documentType} · v{document.version.versionNo}
                    </option>
                  ))}
                </select>
              </Field>
              {feedbackEditor.mode === 'correct' ? (
                <Field label="Feedback correction reason" htmlFor="feedback-correction-reason">
                  <input
                    className={inputClass}
                    id="feedback-correction-reason"
                    value={feedbackEditor.correctionReason}
                    onChange={(event) =>
                      setFeedbackEditor({
                        ...feedbackEditor,
                        correctionReason: inputValue(event),
                      })
                    }
                  />
                </Field>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  busy ||
                  feedbackEditor.score.trim() === '' ||
                  !Number.isFinite(Number(feedbackEditor.score)) ||
                  (feedbackEditor.mode === 'correct' && !feedbackEditor.correctionReason)
                }
                onClick={() => {
                  if (!feedbackBody) return;
                  void onCommand(
                    feedbackEditor.mode === 'correct' && feedbackEditor.feedbackId
                      ? feedbackCorrectionPath(
                          feedbackEditor.interviewId,
                          feedbackEditor.feedbackId,
                        )
                      : feedbackPath(feedbackEditor.interviewId),
                    feedbackBody,
                  ).then(() => setFeedbackEditor(null));
                }}
                size="default"
                variant="primary"
              >
                {feedbackEditor.mode === 'record' ? 'Submit feedback' : 'Save feedback correction'}
              </Button>
              <Button
                disabled={busy}
                onClick={() => setFeedbackEditor(null)}
                size="default"
                variant="secondary"
              >
                Close feedback editor
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
