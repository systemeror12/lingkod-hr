import { Prisma } from '@prisma/client';
import { z } from 'zod';

export const CRITERION_TYPES = ['NUMERIC', 'RATING_SCALE', 'PASS_FAIL'] as const;
export const SELECTION_STAGE_TYPES = ['ASSESSMENT', 'INTERVIEW'] as const;
export const ASSESSMENT_AGGREGATION_METHODS = ['WEIGHTED_AVERAGE', 'WEIGHTED_SUM', 'MEAN'] as const;
export const EVALUATOR_AGGREGATION_METHODS = ['MEAN'] as const;
export const ROUNDING_MODES = ['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP'] as const;
export const INTERVIEW_RECOMMENDATIONS = ['PROCEED', 'HOLD', 'DO_NOT_PROCEED'] as const;

const codeSchema = z.string().trim().min(1).max(60);

const ratingScaleOptionSchema = z
  .object({
    code: codeSchema,
    label: z.string().trim().min(1).max(160),
    value: z.number().finite(),
  })
  .strict();

const criterionSchema = z
  .object({
    criterionCode: codeSchema,
    label: z.string().trim().min(1).max(200),
    criterionType: z.enum(CRITERION_TYPES),
    weight: z.number().finite().positive().max(1000),
    minimumScore: z.number().finite().optional(),
    maximumScore: z.number().finite().optional(),
    ratingScale: z.array(ratingScaleOptionSchema).min(2).max(10).optional(),
    passValue: z.number().finite().optional(),
    failValue: z.number().finite().optional(),
    passingScore: z.number().finite().optional(),
    evidenceRequired: z.boolean(),
    commentsRequired: z.boolean().default(false),
    evaluatorRoleCodes: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  })
  .strict()
  .superRefine((criterion, context) => {
    const fail = (message: string, field: string) =>
      context.addIssue({ code: 'custom', message, path: [field] });
    if (criterion.criterionType === 'NUMERIC') {
      if (criterion.maximumScore === undefined || criterion.minimumScore === undefined) {
        fail('A numeric criterion requires a minimum and maximum score.', 'minimumScore');
        return;
      }
      if (criterion.maximumScore <= criterion.minimumScore)
        fail('The maximum score must exceed the minimum score.', 'maximumScore');
      if (
        criterion.passingScore !== undefined &&
        (criterion.passingScore < criterion.minimumScore ||
          criterion.passingScore > criterion.maximumScore)
      )
        fail('The passing score must fall within the criterion score range.', 'passingScore');
      if (
        criterion.ratingScale ||
        criterion.passValue !== undefined ||
        criterion.failValue !== undefined
      )
        fail(
          'A numeric criterion cannot define a rating scale or pass/fail values.',
          'criterionType',
        );
    }
    if (criterion.criterionType === 'RATING_SCALE') {
      if (!criterion.ratingScale) {
        fail('A rating-scale criterion requires its typed scale options.', 'ratingScale');
        return;
      }
      const codes = criterion.ratingScale.map(({ code }) => code);
      const values = criterion.ratingScale.map(({ value }) => value);
      if (new Set(codes).size !== codes.length)
        fail('Rating scale option codes must be unique.', 'ratingScale');
      if (new Set(values).size !== values.length)
        fail('Rating scale option values must be unique.', 'ratingScale');
      if (criterion.passingScore !== undefined && !values.includes(criterion.passingScore))
        fail('The passing score must be one of the rating scale values.', 'passingScore');
      if (criterion.minimumScore !== undefined || criterion.maximumScore !== undefined)
        fail('A rating-scale criterion cannot define its own score range.', 'criterionType');
    }
    if (criterion.criterionType === 'PASS_FAIL') {
      if (criterion.passValue === undefined || criterion.failValue === undefined) {
        fail('A pass/fail criterion requires its pass and fail values.', 'passValue');
        return;
      }
      if (criterion.passValue === criterion.failValue)
        fail('The pass and fail values must differ.', 'failValue');
      if (
        criterion.minimumScore !== undefined ||
        criterion.maximumScore !== undefined ||
        criterion.ratingScale
      )
        fail('A pass/fail criterion cannot define a score range or rating scale.', 'criterionType');
    }
  });

const roundingSchema = z
  .object({
    mode: z.enum(ROUNDING_MODES),
    decimals: z.number().int().min(0).max(4),
  })
  .strict();

const assessmentAggregationSchema = z
  .object({
    method: z.enum(ASSESSMENT_AGGREGATION_METHODS),
    evaluatorMethod: z.enum(EVALUATOR_AGGREGATION_METHODS),
    rounding: roundingSchema,
    passingScore: z.number().finite(),
    tieBreakers: z.array(codeSchema).max(5).default([]),
  })
  .strict();

const interviewAggregationSchema = z
  .object({
    evaluatorMethod: z.enum(EVALUATOR_AGGREGATION_METHODS),
    rounding: roundingSchema,
    passingScore: z.number().finite(),
  })
  .strict();

const assessmentStageSchema = z
  .object({
    stageCode: codeSchema,
    stageType: z.literal('ASSESSMENT'),
    label: z.string().trim().min(1).max(200),
    criteria: z.array(criterionSchema).min(1).max(20),
    aggregation: assessmentAggregationSchema,
  })
  .strict();

const interviewStageSchema = z
  .object({
    stageCode: codeSchema,
    stageType: z.literal('INTERVIEW'),
    label: z.string().trim().min(1).max(200),
    feedback: z
      .object({
        minimumScore: z.number().finite(),
        maximumScore: z.number().finite(),
        passingScore: z.number().finite(),
        evidenceRequired: z.boolean(),
        commentsRequired: z.boolean().default(false),
        evaluatorRoleCodes: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
      })
      .strict(),
    aggregation: interviewAggregationSchema,
  })
  .strict();

function criterionRange(criterion: AssessmentCriterion): { minimum: number; maximum: number } {
  if (criterion.criterionType === 'RATING_SCALE') {
    const values = criterion.ratingScale!.map(({ value }) => value);
    return { minimum: Math.min(...values), maximum: Math.max(...values) };
  }
  if (criterion.criterionType === 'PASS_FAIL') {
    return {
      minimum: Math.min(criterion.passValue!, criterion.failValue!),
      maximum: Math.max(criterion.passValue!, criterion.failValue!),
    };
  }
  return { minimum: criterion.minimumScore!, maximum: criterion.maximumScore! };
}

export const selectionPlanSchema = z
  .object({
    stages: z
      .array(z.discriminatedUnion('stageType', [assessmentStageSchema, interviewStageSchema]))
      .min(1)
      .max(10),
  })
  .strict()
  .superRefine((plan, context) => {
    const stageCodes = plan.stages.map(({ stageCode }) => stageCode);
    if (new Set(stageCodes).size !== stageCodes.length)
      context.addIssue({
        code: 'custom',
        message: 'Configured stage codes must be unique.',
        path: ['stages'],
      });
    for (const [index, stage] of plan.stages.entries()) {
      if (stage.stageType !== 'ASSESSMENT') continue;
      const criterionCodes = stage.criteria.map(({ criterionCode }) => criterionCode);
      if (new Set(criterionCodes).size !== criterionCodes.length)
        context.addIssue({
          code: 'custom',
          message: 'Criterion codes must be unique within a stage.',
          path: ['stages', index, 'criteria'],
        });
      const breaker = stage.aggregation.tieBreakers.find(
        (criterionCode) => !criterionCodes.includes(criterionCode),
      );
      if (breaker !== undefined)
        context.addIssue({
          code: 'custom',
          message: `The tie-breaker ${breaker} is not a criterion of stage ${stage.stageCode}.`,
          path: ['stages', index, 'aggregation', 'tieBreakers'],
        });
      const [first, ...rest] = stage.criteria;
      const range = criterionRange(first!);
      if (
        rest.some(
          (criterion) =>
            criterionRange(criterion).minimum !== range.minimum ||
            criterionRange(criterion).maximum !== range.maximum,
        )
      )
        context.addIssue({
          code: 'custom',
          message: `Criteria of stage ${stage.stageCode} must share one score range.`,
          path: ['stages', index, 'criteria'],
        });
    }
  });

export type SelectionPlan = z.infer<typeof selectionPlanSchema>;
export type SelectionStage = SelectionPlan['stages'][number];
export type AssessmentStage = Extract<SelectionStage, { stageType: 'ASSESSMENT' }>;
export type InterviewStage = Extract<SelectionStage, { stageType: 'INTERVIEW' }>;
export type AssessmentCriterion = AssessmentStage['criteria'][number];

export function parseSelectionPlan(value: unknown): SelectionPlan | null {
  const parsed = selectionPlanSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface StageCriterionAggregate {
  criterionCode: string;
  evaluatorCount: number;
  value: string;
  passed: boolean | null;
}

export interface StageAggregate {
  ruleVersionId: string;
  stageCode: string;
  stageType: (typeof SELECTION_STAGE_TYPES)[number];
  evaluatorCount: number;
  method: string;
  evaluatorMethod: string;
  rounding: { mode: (typeof ROUNDING_MODES)[number]; decimals: number };
  passingScore: string;
  value: string;
  passed: boolean;
  criteria: StageCriterionAggregate[];
  tieBreakValues: string[];
}

export interface AssessmentResultInput {
  criterionCode: string;
  evaluatedByMembershipId: string;
  score: Prisma.Decimal | number | string;
}

export interface InterviewFeedbackInput {
  interviewerMembershipId: string;
  score: Prisma.Decimal | number | string | null;
}

const ROUNDING_TABLE = {
  HALF_UP: Prisma.Decimal.ROUND_HALF_UP,
  HALF_EVEN: Prisma.Decimal.ROUND_HALF_EVEN,
  DOWN: Prisma.Decimal.ROUND_DOWN,
  UP: Prisma.Decimal.ROUND_UP,
} as const;

function decimal(value: Prisma.Decimal | number | string): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

function roundValue(
  value: Prisma.Decimal,
  rounding: { mode: (typeof ROUNDING_MODES)[number]; decimals: number },
): Prisma.Decimal {
  return value.toDecimalPlaces(rounding.decimals, ROUNDING_TABLE[rounding.mode]);
}

function mean(values: Prisma.Decimal[]): Prisma.Decimal {
  return values
    .reduce((total, value) => total.plus(value), new Prisma.Decimal(0))
    .div(values.length);
}

function criterionPassed(criterion: AssessmentCriterion, value: Prisma.Decimal): boolean | null {
  if (criterion.criterionType === 'PASS_FAIL') {
    return value.greaterThanOrEqualTo(criterion.passValue!);
  }
  if (criterion.passingScore === undefined) return null;
  return value.greaterThanOrEqualTo(criterion.passingScore);
}

function criterionValue(evaluatorScores: Prisma.Decimal[]): Prisma.Decimal {
  return mean(evaluatorScores);
}

/**
 * Aggregates the latest result per evaluator and criterion into one deterministic
 * stage standing. Returns null until every configured criterion has a result.
 */
export function aggregateAssessmentStage(
  stage: AssessmentStage,
  ruleVersionId: string,
  results: AssessmentResultInput[],
): StageAggregate | null {
  const byCriterion = new Map<string, Map<string, Prisma.Decimal>>();
  for (const result of results) {
    const evaluators = byCriterion.get(result.criterionCode) ?? new Map<string, Prisma.Decimal>();
    evaluators.set(result.evaluatedByMembershipId, decimal(result.score));
    byCriterion.set(result.criterionCode, evaluators);
  }
  if (stage.criteria.some(({ criterionCode }) => !byCriterion.get(criterionCode)?.size))
    return null;

  const criteriaAggregates: StageCriterionAggregate[] = [];
  const unrounded = new Map<string, Prisma.Decimal>();
  for (const criterion of stage.criteria) {
    const evaluatorScores = [...(byCriterion.get(criterion.criterionCode)?.values() ?? [])];
    const value = criterionValue(evaluatorScores);
    unrounded.set(criterion.criterionCode, value);
    criteriaAggregates.push({
      criterionCode: criterion.criterionCode,
      evaluatorCount: evaluatorScores.length,
      value: roundValue(value, stage.aggregation.rounding).toFixed(
        stage.aggregation.rounding.decimals,
      ),
      passed: criterionPassed(criterion, value),
    });
  }

  const weightTotal = stage.criteria.reduce(
    (total, criterion) => total.plus(criterion.weight),
    new Prisma.Decimal(0),
  );
  let aggregate: Prisma.Decimal;
  if (stage.aggregation.method === 'MEAN') {
    aggregate = mean(stage.criteria.map(({ criterionCode }) => unrounded.get(criterionCode)!));
  } else if (stage.aggregation.method === 'WEIGHTED_SUM') {
    aggregate = stage.criteria.reduce(
      (total, criterion) =>
        total.plus(unrounded.get(criterion.criterionCode)!.times(criterion.weight)),
      new Prisma.Decimal(0),
    );
  } else {
    aggregate = stage.criteria
      .reduce(
        (total, criterion) =>
          total.plus(unrounded.get(criterion.criterionCode)!.times(criterion.weight)),
        new Prisma.Decimal(0),
      )
      .div(weightTotal);
  }
  const value = roundValue(aggregate, stage.aggregation.rounding);
  const passed = value.greaterThanOrEqualTo(stage.aggregation.passingScore);
  const criterionValues = new Map(
    criteriaAggregates.map(({ criterionCode, value: criterionValueText }) => [
      criterionCode,
      new Prisma.Decimal(criterionValueText),
    ]),
  );

  return {
    ruleVersionId,
    stageCode: stage.stageCode,
    stageType: stage.stageType,
    evaluatorCount: new Set(results.map(({ evaluatedByMembershipId }) => evaluatedByMembershipId))
      .size,
    method: stage.aggregation.method,
    evaluatorMethod: stage.aggregation.evaluatorMethod,
    rounding: stage.aggregation.rounding,
    passingScore: new Prisma.Decimal(stage.aggregation.passingScore).toFixed(),
    value: value.toFixed(stage.aggregation.rounding.decimals),
    passed,
    criteria: criteriaAggregates,
    tieBreakValues: stage.aggregation.tieBreakers.map((criterionCode) =>
      criterionValues.get(criterionCode)!.toFixed(stage.aggregation.rounding.decimals),
    ),
  };
}

/** Aggregates interview feedback scores into the standing defined by the stage plan. */
export function aggregateInterviewStage(
  stage: InterviewStage,
  ruleVersionId: string,
  feedback: InterviewFeedbackInput[],
): StageAggregate | null {
  const scores = feedback.flatMap(({ score }) => (score === null ? [] : [decimal(score)]));
  if (scores.length === 0) return null;
  const value = roundValue(mean(scores), stage.aggregation.rounding);
  return {
    ruleVersionId,
    stageCode: stage.stageCode,
    stageType: stage.stageType,
    evaluatorCount: scores.length,
    method: 'MEAN',
    evaluatorMethod: stage.aggregation.evaluatorMethod,
    rounding: stage.aggregation.rounding,
    passingScore: new Prisma.Decimal(stage.aggregation.passingScore).toFixed(),
    value: value.toFixed(stage.aggregation.rounding.decimals),
    passed: value.greaterThanOrEqualTo(stage.aggregation.passingScore),
    criteria: [],
    tieBreakValues: [],
  };
}

export interface StageStandingInput {
  applicationId: string;
  aggregate: StageAggregate;
}

export interface StageStanding {
  applicationId: string;
  rank: number;
  tied: boolean;
}

function compareAggregates(left: StageAggregate, right: StageAggregate): number {
  const primary = new Prisma.Decimal(left.value).comparedTo(right.value);
  if (primary !== 0) return primary;
  for (
    let index = 0;
    index < Math.min(left.tieBreakValues.length, right.tieBreakValues.length);
    index += 1
  ) {
    const comparison = new Prisma.Decimal(left.tieBreakValues[index]!).comparedTo(
      right.tieBreakValues[index]!,
    );
    if (comparison !== 0) return comparison;
  }
  return 0;
}

/**
 * Ranks stage aggregates by the plan's tie-breaker order. Aggregates that remain
 * equal share a competition rank and are reported as tied rather than broken by
 * an invented rule.
 */
export function rankStageAggregates(inputs: StageStandingInput[]): StageStanding[] {
  const sorted = [...inputs].sort(
    (left, right) => -compareAggregates(left.aggregate, right.aggregate),
  );
  const standings: StageStanding[] = [];
  for (const [index, input] of sorted.entries()) {
    const previous = sorted[index - 1];
    const equal =
      previous !== undefined && compareAggregates(previous.aggregate, input.aggregate) === 0;
    const rank = equal ? standings[index - 1]!.rank : index + 1;
    standings.push({ applicationId: input.applicationId, rank, tied: false });
  }
  for (const [index, standing] of standings.entries()) {
    const next = standings[index + 1];
    const previous = standings[index - 1];
    const equal =
      (next !== undefined && next.rank === standing.rank) ||
      (previous !== undefined && previous.rank === standing.rank);
    standing.tied = equal;
  }
  return standings;
}
