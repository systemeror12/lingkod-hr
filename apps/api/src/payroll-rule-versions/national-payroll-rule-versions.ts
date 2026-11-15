import { Prisma } from '@prisma/client';
import { z } from 'zod';

/**
 * National Payroll Rule Versions are platform-wide and immutable from load
 * (ADR 0013). Each rule kind has one calculator in code; a version carries
 * only that kind's typed parameters, validated here at load.
 */
export type NationalPayrollRuleKind = 'SALARY_SCHEDULE';

const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const isoDate = z.iso.date();
const monthlyRate = z
  .string()
  .regex(/^\d{1,15}(\.\d{1,4})?$/, 'A monthly rate is a decimal string with up to 4 places.')
  .refine((value) => new Prisma.Decimal(value).gt(0), 'A monthly rate is greater than zero.');

const ruleVersionFields = {
  code: text(100),
  name: text(255),
  issuingAuthority: text(255),
  issuanceReference: text(255),
  sourceUrl: z.url({ protocol: /^https?$/ }),
  /** The research register entry the reviewer checked the values against. */
  researchRegister: z
    .string()
    .regex(/^docs\/research\/[a-z0-9-]+\.md(#\S+)?$/, 'Cite a docs/research/ register entry.'),
  verifiedOn: isoDate,
  verifiedBy: text(255),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullable(),
  supersedesCode: text(100).nullable(),
};

const salaryScheduleFile = z
  .object({
    ruleKind: z.literal('SALARY_SCHEDULE'),
    ...ruleVersionFields,
    // A salary schedule's values are its rate rows.
    parameters: z.object({}).strict().default({}),
    salaryGradeRates: z
      .array(
        z
          .object({
            salaryGrade: z.int().positive(),
            salaryStep: z.int().positive(),
            monthlyRate,
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .refine(
    ({ salaryGradeRates }) =>
      new Set(salaryGradeRates.map((rate) => `${rate.salaryGrade}:${rate.salaryStep}`)).size ===
      salaryGradeRates.length,
    { message: 'A Salary Grade and step appear once.', path: ['salaryGradeRates'] },
  );

/** The reviewed file the `hris_operator` load command reads. */
export const nationalPayrollRuleVersionFileSchema = z
  .discriminatedUnion('ruleKind', [salaryScheduleFile])
  .refine((file) => file.effectiveTo === null || file.effectiveTo >= file.effectiveFrom, {
    message: 'effectiveTo is on or after effectiveFrom.',
    path: ['effectiveTo'],
  });

export type NationalPayrollRuleVersionFile = z.infer<typeof nationalPayrollRuleVersionFileSchema>;

/** A version's own dates and the date its successor, if any, replaces it from. */
export interface RuleVersionEffectivity {
  effectiveFrom: string;
  effectiveTo: string | null;
  successorEffectiveFrom: string | null;
}

/**
 * A version is in effect on a date its effectivity covers and that no
 * successor has replaced it from. Dates are ISO `YYYY-MM-DD` strings.
 */
export function isInEffectOn(version: RuleVersionEffectivity, date: string): boolean {
  return (
    version.effectiveFrom <= date &&
    (version.effectiveTo === null || date <= version.effectiveTo) &&
    (version.successorEffectiveFrom === null || date < version.successorEffectiveFrom)
  );
}

/** Two versions share a date in effect exactly when both are in effect on the later start. */
export function sharesDateInEffect(a: RuleVersionEffectivity, b: RuleVersionEffectivity): boolean {
  const laterStart = a.effectiveFrom > b.effectiveFrom ? a.effectiveFrom : b.effectiveFrom;
  return isInEffectOn(a, laterStart) && isInEffectOn(b, laterStart);
}

export const isoDateOf = (value: Date): string => value.toISOString().slice(0, 10);

const effectivitySelect = {
  id: true,
  code: true,
  effectiveFrom: true,
  effectiveTo: true,
  supersededBy: { select: { effectiveFrom: true } },
} satisfies Prisma.NationalPayrollRuleVersionSelect;

type EffectivityRow = Prisma.NationalPayrollRuleVersionGetPayload<{
  select: typeof effectivitySelect;
}>;

export interface RuleVersionWithEffectivity extends RuleVersionEffectivity {
  id: string;
  code: string;
}

function toEffectivity(row: EffectivityRow): RuleVersionWithEffectivity {
  return {
    id: row.id,
    code: row.code,
    effectiveFrom: isoDateOf(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? isoDateOf(row.effectiveTo) : null,
    successorEffectiveFrom: row.supersededBy ? isoDateOf(row.supersededBy.effectiveFrom) : null,
  };
}

type RuleVersionReader = Pick<Prisma.TransactionClient, 'nationalPayrollRuleVersion'>;

/** Every version of a kind, with the date its successor replaces it from. */
export async function listRuleVersionEffectivity(
  database: RuleVersionReader,
  ruleKind: NationalPayrollRuleKind,
  where: Prisma.NationalPayrollRuleVersionWhereInput = {},
): Promise<RuleVersionWithEffectivity[]> {
  const rows = await database.nationalPayrollRuleVersion.findMany({
    where: { ...where, ruleKind },
    select: effectivitySelect,
    orderBy: { effectiveFrom: 'asc' },
  });
  return rows.map(toEffectivity);
}

export type SalaryGradeRateLookup =
  | {
      status: 'FOUND';
      ruleVersionId: string;
      ruleVersionCode: string;
      salaryGrade: number;
      salaryStep: number;
      monthlyRate: Prisma.Decimal;
    }
  | { status: 'MISSING_RULE'; ruleKind: 'SALARY_SCHEDULE'; on: string }
  | {
      status: 'MISSING_RATE';
      ruleVersionId: string;
      ruleVersionCode: string;
      salaryGrade: number;
      salaryStep: number;
    };

type SalaryGradeRateReader = Pick<
  Prisma.TransactionClient,
  'nationalPayrollRuleVersion' | 'salaryGradeRate'
>;

/**
 * The monthly rate of a Salary Grade and step under the salary schedule in
 * effect on `on`. With no schedule in effect it returns `MISSING_RULE`, and a
 * schedule without the grade and step returns `MISSING_RATE`: it never falls
 * back to an older or superseded version.
 */
export async function findSalaryGradeRate(
  database: SalaryGradeRateReader,
  input: { salaryGrade: number; salaryStep: number; on: string },
): Promise<SalaryGradeRateLookup> {
  const on = isoDate.parse(input.on);
  const onDate = new Date(`${on}T00:00:00.000Z`);
  const candidates = await listRuleVersionEffectivity(database, 'SALARY_SCHEDULE', {
    effectiveFrom: { lte: onDate },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
  });
  const inEffect = candidates.filter((version) => isInEffectOn(version, on));
  if (inEffect.length > 1) {
    // The load refuses this; reaching it means the table was written around the load.
    throw new Error(`More than one salary schedule is in effect on ${on}.`);
  }
  const version = inEffect[0];
  if (!version) return { status: 'MISSING_RULE', ruleKind: 'SALARY_SCHEDULE', on };

  const { salaryGrade, salaryStep } = input;
  const rate = await database.salaryGradeRate.findUnique({
    where: {
      ruleVersionId_salaryGrade_salaryStep: { ruleVersionId: version.id, salaryGrade, salaryStep },
    },
    select: { monthlyRate: true },
  });
  const found = {
    ruleVersionId: version.id,
    ruleVersionCode: version.code,
    salaryGrade,
    salaryStep,
  };
  return rate
    ? { status: 'FOUND', ...found, monthlyRate: rate.monthlyRate }
    : { status: 'MISSING_RATE', ...found };
}
