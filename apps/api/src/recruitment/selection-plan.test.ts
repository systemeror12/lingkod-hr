import { expect, it } from 'vitest';
import {
  aggregateAssessmentStage,
  aggregateInterviewStage,
  parseSelectionPlan,
  rankStageAggregates,
  type AssessmentStage,
  type InterviewStage,
} from './selection-plan';

const assessmentStage: AssessmentStage = {
  stageCode: 'WRITTEN_EXAM',
  stageType: 'ASSESSMENT',
  label: 'Written examination',
  criteria: [
    {
      criterionCode: 'JOB_KNOWLEDGE',
      label: 'Job knowledge',
      criterionType: 'NUMERIC',
      weight: 60,
      minimumScore: 0,
      maximumScore: 100,
      passingScore: 70,
      evidenceRequired: false,
      commentsRequired: false,
      evaluatorRoleCodes: ['recruitment_officer'],
    },
    {
      criterionCode: 'DOCUMENTATION',
      label: 'Documentation quality',
      criterionType: 'RATING_SCALE',
      weight: 40,
      ratingScale: [
        { code: 'LOW', label: 'Low', value: 0 },
        { code: 'SATISFACTORY', label: 'Satisfactory', value: 50 },
        { code: 'HIGH', label: 'High', value: 100 },
      ],
      passingScore: 50,
      evidenceRequired: true,
      commentsRequired: false,
      evaluatorRoleCodes: ['recruitment_officer'],
    },
  ],
  aggregation: {
    method: 'WEIGHTED_AVERAGE',
    evaluatorMethod: 'MEAN',
    rounding: { mode: 'HALF_UP', decimals: 2 },
    passingScore: 70,
    tieBreakers: ['JOB_KNOWLEDGE'],
  },
};

const validPlan = {
  stages: [
    assessmentStage,
    {
      stageCode: 'PANEL_INTERVIEW',
      stageType: 'INTERVIEW',
      label: 'Panel interview',
      feedback: {
        minimumScore: 0,
        maximumScore: 100,
        passingScore: 70,
        evidenceRequired: false,
        commentsRequired: true,
        evaluatorRoleCodes: ['hrmo_administrator'],
      },
      aggregation: {
        evaluatorMethod: 'MEAN',
        rounding: { mode: 'HALF_UP', decimals: 2 },
        passingScore: 70,
      },
    },
  ],
};

it('accepts a typed, bounded selection plan', () => {
  const plan = parseSelectionPlan(validPlan);
  expect(plan?.stages.map(({ stageCode }) => stageCode)).toEqual([
    'WRITTEN_EXAM',
    'PANEL_INTERVIEW',
  ]);
});

it('rejects plans that invent unsupported rules or shapes', () => {
  expect(parseSelectionPlan({})).toBeNull();
  expect(parseSelectionPlan({ stages: [] })).toBeNull();
  expect(
    parseSelectionPlan({
      stages: [
        {
          stageCode: 'EXAM',
          stageType: 'ASSESSMENT',
          label: 'Exam',
          criteria: [{ ...assessmentStage.criteria[0], formula: 'score * 2' }],
          aggregation: assessmentStage.aggregation,
        },
      ],
    }),
  ).toBeNull();
  expect(
    parseSelectionPlan({
      stages: [assessmentStage, { ...assessmentStage, stageCode: 'WRITTEN_EXAM' }],
    }),
  ).toBeNull();
  expect(
    parseSelectionPlan({
      stages: [
        {
          ...assessmentStage,
          aggregation: { ...assessmentStage.aggregation, tieBreakers: ['UNKNOWN'] },
        },
      ],
    }),
  ).toBeNull();
  expect(
    parseSelectionPlan({
      stages: [
        {
          ...assessmentStage,
          criteria: [
            {
              ...assessmentStage.criteria[0],
              criterionType: 'PASS_FAIL',
              passValue: 1,
              failValue: 0,
              maximumScore: 1,
              minimumScore: 0,
            },
          ],
        },
      ],
    }),
  ).toBeNull();
  expect(
    parseSelectionPlan({
      stages: [
        {
          ...assessmentStage,
          criteria: [
            {
              ...assessmentStage.criteria[1],
              passingScore: 4,
            },
          ],
        },
      ],
    }),
  ).toBeNull();
});

it('aggregates weighted scores deterministically and keeps raw inputs visible', () => {
  const aggregate = aggregateAssessmentStage(assessmentStage, 'criteria-set-v1', [
    { criterionCode: 'JOB_KNOWLEDGE', evaluatedByMembershipId: 'evaluator-1', score: 85 },
    { criterionCode: 'JOB_KNOWLEDGE', evaluatedByMembershipId: 'evaluator-2', score: 95 },
    { criterionCode: 'DOCUMENTATION', evaluatedByMembershipId: 'evaluator-1', score: 50 },
    { criterionCode: 'DOCUMENTATION', evaluatedByMembershipId: 'evaluator-2', score: 100 },
  ]);
  expect(aggregate?.ruleVersionId).toBe('criteria-set-v1');
  expect(aggregate?.value).toBe('84.00');
  expect(aggregate?.passed).toBe(true);
  expect(aggregate?.evaluatorCount).toBe(2);
  expect(aggregate?.criteria).toEqual([
    {
      criterionCode: 'JOB_KNOWLEDGE',
      evaluatorCount: 2,
      value: '90.00',
      passed: true,
    },
    {
      criterionCode: 'DOCUMENTATION',
      evaluatorCount: 2,
      value: '75.00',
      passed: true,
    },
  ]);
  expect(aggregate?.tieBreakValues).toEqual(['90.00']);
  expect(aggregate?.rounding).toEqual({ mode: 'HALF_UP', decimals: 2 });
});

it('does not produce a stage aggregate before every criterion has a result', () => {
  expect(
    aggregateAssessmentStage(assessmentStage, 'criteria-set-v1', [
      { criterionCode: 'JOB_KNOWLEDGE', evaluatedByMembershipId: 'evaluator-1', score: 90 },
    ]),
  ).toBeNull();
});

it('applies each configured rounding mode', () => {
  const stage: AssessmentStage = {
    ...assessmentStage,
    criteria: [assessmentStage.criteria[0]!],
    aggregation: { ...assessmentStage.aggregation, method: 'MEAN', tieBreakers: [] },
  };
  const scoreFor = (mode: 'HALF_UP' | 'HALF_EVEN' | 'DOWN' | 'UP') =>
    aggregateAssessmentStage(
      { ...stage, aggregation: { ...stage.aggregation, rounding: { mode, decimals: 1 } } },
      'criteria-set-v1',
      [{ criterionCode: 'JOB_KNOWLEDGE', evaluatedByMembershipId: 'evaluator-1', score: 85.25 }],
    )?.value;
  expect(scoreFor('HALF_UP')).toBe('85.3');
  expect(scoreFor('HALF_EVEN')).toBe('85.2');
  expect(scoreFor('DOWN')).toBe('85.2');
  expect(scoreFor('UP')).toBe('85.3');
});

it('aggregates interview feedback and withholds a standing without scores', () => {
  const interview = validPlan.stages[1] as InterviewStage;
  expect(
    aggregateInterviewStage(interview, 'criteria-set-v1', [
      { interviewerMembershipId: 'one', score: 80 },
      { interviewerMembershipId: 'two', score: 90 },
      { interviewerMembershipId: 'three', score: null },
    ])?.value,
  ).toBe('85.00');
  expect(
    aggregateInterviewStage(interview, 'criteria-set-v1', [
      { interviewerMembershipId: 'one', score: null },
    ]),
  ).toBeNull();
});

it('reports configured pass/fail criterion results', () => {
  const stage: AssessmentStage = {
    stageCode: 'ELIGIBILITY_CHECK',
    stageType: 'ASSESSMENT',
    label: 'Eligibility check',
    criteria: [
      {
        criterionCode: 'ELIGIBILITY',
        label: 'Eligibility',
        criterionType: 'PASS_FAIL',
        weight: 100,
        passValue: 1,
        failValue: 0,
        evidenceRequired: false,
        commentsRequired: false,
        evaluatorRoleCodes: ['recruitment_officer'],
      },
    ],
    aggregation: {
      method: 'MEAN',
      evaluatorMethod: 'MEAN',
      rounding: { mode: 'HALF_UP', decimals: 2 },
      passingScore: 1,
      tieBreakers: [],
    },
  };
  const passed = aggregateAssessmentStage(stage, 'criteria-set-v1', [
    { criterionCode: 'ELIGIBILITY', evaluatedByMembershipId: 'evaluator-1', score: 1 },
  ]);
  expect(passed?.criteria[0]?.passed).toBe(true);
  const failed = aggregateAssessmentStage(stage, 'criteria-set-v1', [
    { criterionCode: 'ELIGIBILITY', evaluatedByMembershipId: 'evaluator-1', score: 0 },
  ]);
  expect(failed?.criteria[0]?.passed).toBe(false);
});

it('breaks ties by the configured criterion order and reports unresolved ties', () => {
  const aggregate = (value: string, jobKnowledge: string) => ({
    ruleVersionId: 'criteria-set-v1',
    stageCode: 'WRITTEN_EXAM',
    stageType: 'ASSESSMENT' as const,
    evaluatorCount: 1,
    method: 'WEIGHTED_AVERAGE',
    evaluatorMethod: 'MEAN',
    rounding: { mode: 'HALF_UP' as const, decimals: 2 },
    passingScore: '70',
    value,
    passed: true,
    criteria: [],
    tieBreakValues: [jobKnowledge],
  });
  const standings = rankStageAggregates([
    { applicationId: 'b', aggregate: aggregate('90', '95') },
    { applicationId: 'a', aggregate: aggregate('90', '85') },
    { applicationId: 'c', aggregate: aggregate('90', '85') },
    { applicationId: 'd', aggregate: aggregate('80', '100') },
  ]);
  expect(standings).toEqual([
    { applicationId: 'b', rank: 1, tied: false },
    { applicationId: 'a', rank: 2, tied: true },
    { applicationId: 'c', rank: 2, tied: true },
    { applicationId: 'd', rank: 4, tied: false },
  ]);
});
