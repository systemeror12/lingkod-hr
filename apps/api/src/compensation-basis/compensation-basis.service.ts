import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import {
  findSalaryGradeRate,
  isoDateOf,
  listRuleVersionEffectivity,
  type SalaryGradeRateLookup,
} from '../payroll-rule-versions/national-payroll-rule-versions';
import { PersonnelSalaryFactsService } from '../personnel-salary-facts/personnel-salary-facts.service';
import type {
  SalaryFactsInService,
  SalaryFactsNoServiceSegment,
} from '../personnel-salary-facts/personnel-salary-facts.types';

export const READ_PERMISSION = 'payroll.compensation.read';

/**
 * The pay bases of the Appointed Personnel Payroll Rule Set (BRD PAY-001,
 * #27). Any other pay basis Personnel records is an unsupported category and
 * blocks rather than inheriting monthly full-time behavior.
 */
export const payBases = [
  'MONTHLY_FULL_TIME',
  'PART_TIME_PROPORTIONAL',
  'CASUAL_DAILY_WAGE',
] as const;
export type PayBasis = (typeof payBases)[number];

/**
 * The 22-working-day divisor: a daily rate is the monthly rate ÷ 22 (RA No.
 * 6758, sec. 7; docs/research/native-payroll-component-authorities.md, basic
 * salary row).
 */
export const WORKING_DAYS_PER_MONTH = 22;

/**
 * Personnel's salary facts as the resolver reads them. #619 returns null pay
 * basis and employment fraction until Personnel records them, and its stretches
 * fit this shape unchanged.
 */
export type SalaryFacts =
  | SalaryFactsNoServiceSegment
  | (Omit<SalaryFactsInService, 'payBasis' | 'employmentFraction'> & {
      payBasis: string | null;
      /** A decimal string, the share of full-time service. */
      employmentFraction: string | null;
    });

export type IndeterminateReasonCode =
  | 'NO_SERVICE_SEGMENT'
  | 'MISSING_SALARY_GRADE'
  | 'MISSING_SALARY_STEP'
  | 'MISSING_PAY_BASIS'
  | 'UNSUPPORTED_PAY_BASIS'
  | 'MISSING_EMPLOYMENT_FRACTION'
  | 'MISSING_SALARY_SCHEDULE'
  | 'MISSING_SALARY_RATE';

export interface IndeterminateReason {
  code: IndeterminateReasonCode;
  message: string;
}

/** Source: the Personnel Service Segment the facts come from (#619). */
export interface PersonnelFacts {
  serviceSegmentId: string;
  salaryGrade: number | null;
  salaryStep: number | null;
  payBasis: string | null;
  employmentFraction: string | null;
}

/** Source: the salary schedule National Payroll Rule Version in effect (#331). */
export interface SalaryScheduleRate {
  ruleVersionId: string;
  ruleVersionCode: string;
  /** Null when the schedule has no rate for the grade and step. */
  monthlyRate: string | null;
}

/**
 * Source: derived by Payroll from the Personnel facts and the schedule rate.
 * Amounts are unrounded decimal strings; the calculator rounds.
 */
export interface DerivedRate {
  /** Null on the casual daily-wage basis, which is paid by the day. */
  monthlyRate: string | null;
  dailyRate: string;
  derivation: string;
}

export interface ResolvedStretch {
  status: 'RESOLVED';
  from: string;
  to: string;
  personnel: PersonnelFacts & { salaryGrade: number; salaryStep: number; payBasis: PayBasis };
  salarySchedule: SalaryScheduleRate & { monthlyRate: string };
  rate: DerivedRate;
}

export interface IndeterminateStretch {
  status: 'INDETERMINATE';
  from: string;
  to: string;
  /** Null for dates no Service Segment covers. */
  personnel: PersonnelFacts | null;
  /** Null when no grade and step were looked up or no schedule is in effect. */
  salarySchedule: SalaryScheduleRate | null;
  reasons: IndeterminateReason[];
}

/** One continuous set of facts and one salary schedule over its dates. */
export type CompensationBasisStretch = ResolvedStretch | IndeterminateStretch;

/**
 * An Employee's compensation basis over an inclusive date range. It is
 * `INDETERMINATE` when any stretch is, and every date is in one stretch.
 */
export interface CompensationBasis {
  employeeId: string;
  from: string;
  to: string;
  status: 'RESOLVED' | 'INDETERMINATE';
  stretches: CompensationBasisStretch[];
}

export class CompensationBasisError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'CompensationBasisError';
  }
}

/**
 * Payroll's compensation basis: Personnel's salary facts matched to the
 * salary schedule rate in effect on each date. Every calculator starts here.
 * Grade, step, pay basis, and employment fraction are read from Personnel and
 * never edited in Payroll.
 */
@Injectable()
export class CompensationBasisService {
  constructor(
    @Inject(PersonnelSalaryFactsService)
    private readonly salaryFacts: PersonnelSalaryFactsService,
  ) {}

  /** The read endpoint: needs `payroll.compensation.read` for the whole Agency. */
  async read(
    context: RequestContext,
    employeeId: string,
    from: string,
    to: string,
  ): Promise<CompensationBasis> {
    if (!holdsAgencyWide(context, READ_PERMISSION)) {
      throw new CompensationBasisError(
        `Reading a compensation basis needs the ${READ_PERMISSION} permission for the whole Agency.`,
        403,
        'COMPENSATION_BASIS_READ_FORBIDDEN',
      );
    }
    return withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      this.resolveInTransaction(transaction, context.agencyId, employeeId, from, to),
    );
  }

  /**
   * Resolve one Employee's basis from `from` to `to`, inclusive `YYYY-MM-DD`
   * dates, inside a caller-owned transaction. An Employee outside the Agency
   * and an invalid range are refused by Personnel's salary facts read.
   */
  async resolveInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    from: string,
    to: string,
  ): Promise<CompensationBasis> {
    const facts: SalaryFacts[] = await this.salaryFacts.readInTransaction(
      transaction,
      agencyId,
      employeeId,
      from,
      to,
    );
    const boundaries = await salaryScheduleBoundaries(transaction, from, to);
    const stretches: CompensationBasisStretch[] = [];
    for (const stretch of facts) {
      if (
        stretch.status !== 'IN_SERVICE' ||
        stretch.salaryGrade === null ||
        stretch.salaryStep === null
      ) {
        stretches.push(resolveStretch(stretch, null));
        continue;
      }
      for (const piece of splitAt(stretch, boundaries)) {
        const rate = await findSalaryGradeRate(transaction, {
          salaryGrade: stretch.salaryGrade,
          salaryStep: stretch.salaryStep,
          on: piece.from,
        });
        stretches.push(resolveStretch(piece, rate));
      }
    }
    return {
      employeeId,
      from,
      to,
      status: stretches.every((stretch) => stretch.status === 'RESOLVED')
        ? 'RESOLVED'
        : 'INDETERMINATE',
      stretches,
    };
  }
}

/**
 * The dates inside the range on which the salary schedule in effect can
 * change: a version starts, ends, or is replaced by its successor.
 */
async function salaryScheduleBoundaries(
  transaction: Prisma.TransactionClient,
  from: string,
  to: string,
): Promise<string[]> {
  const versions = await listRuleVersionEffectivity(transaction, 'SALARY_SCHEDULE', {
    effectiveFrom: { lte: dateOf(to) },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: dateOf(from) } }],
  });
  return versions
    .flatMap((version) => [
      version.effectiveFrom,
      version.effectiveTo === null ? null : addDays(version.effectiveTo, 1),
      version.successorEffectiveFrom,
    ])
    .filter((date): date is string => date !== null && date > from && date <= to)
    .sort();
}

/** Split a stretch so each piece starts on a boundary or the stretch's own start. */
export function splitAt<T extends { from: string; to: string }>(
  stretch: T,
  boundaries: readonly string[],
): T[] {
  const pieces: T[] = [];
  let start = stretch.from;
  for (const boundary of [...boundaries].sort()) {
    if (boundary > start && boundary <= stretch.to) {
      pieces.push({ ...stretch, from: start, to: addDays(boundary, -1) });
      start = boundary;
    }
  }
  pieces.push({ ...stretch, from: start });
  return pieces;
}

/**
 * Resolve one stretch of facts against the schedule rate looked up for it,
 * or null when no grade and step could be looked up. Each missing fact, an
 * unsupported pay basis, and a missing schedule or rate is a reason.
 */
export function resolveStretch(
  facts: SalaryFacts,
  rate: SalaryGradeRateLookup | null,
): CompensationBasisStretch {
  const { from, to } = facts;
  if (facts.status === 'NO_SERVICE_SEGMENT') {
    return {
      status: 'INDETERMINATE',
      from,
      to,
      personnel: null,
      salarySchedule: null,
      reasons: [
        { code: 'NO_SERVICE_SEGMENT', message: `No Service Segment covers ${from} to ${to}.` },
      ],
    };
  }

  const personnel: PersonnelFacts = {
    serviceSegmentId: facts.serviceSegmentId,
    salaryGrade: facts.salaryGrade,
    salaryStep: facts.salaryStep,
    payBasis: facts.payBasis,
    employmentFraction: facts.employmentFraction,
  };
  const reasons: IndeterminateReason[] = [];
  if (facts.salaryGrade === null) {
    reasons.push({
      code: 'MISSING_SALARY_GRADE',
      message: 'The Service Segment records no salary grade.',
    });
  }
  if (facts.salaryStep === null) {
    reasons.push({
      code: 'MISSING_SALARY_STEP',
      message: 'The Service Segment records no salary step.',
    });
  }

  const payBasis = facts.payBasis;
  let basis: PayBasis | null = null;
  if (payBasis === null) {
    reasons.push({
      code: 'MISSING_PAY_BASIS',
      message: 'Personnel records no pay basis for the Service Segment.',
    });
  } else if (isPayBasis(payBasis)) {
    basis = payBasis;
  } else {
    reasons.push({
      code: 'UNSUPPORTED_PAY_BASIS',
      message: `The ${payBasis} pay basis is not in the Appointed Personnel Payroll Rule Set.`,
    });
  }
  const fraction = toEmploymentFraction(facts.employmentFraction);
  if (basis === 'PART_TIME_PROPORTIONAL' && fraction === null) {
    reasons.push({
      code: 'MISSING_EMPLOYMENT_FRACTION',
      message:
        'A part-time pay basis needs an employment fraction greater than 0 and at most 1 from Personnel.',
    });
  }

  let salarySchedule: SalaryScheduleRate | null = null;
  if (rate?.status === 'MISSING_RULE') {
    reasons.push({
      code: 'MISSING_SALARY_SCHEDULE',
      message: `No salary schedule is in effect on ${from}.`,
    });
  } else if (rate) {
    salarySchedule = {
      ruleVersionId: rate.ruleVersionId,
      ruleVersionCode: rate.ruleVersionCode,
      monthlyRate: rate.status === 'FOUND' ? rate.monthlyRate.toFixed() : null,
    };
    if (rate.status === 'MISSING_RATE') {
      reasons.push({
        code: 'MISSING_SALARY_RATE',
        message: `Salary schedule ${rate.ruleVersionCode} has no rate for Salary Grade ${rate.salaryGrade}, step ${rate.salaryStep}.`,
      });
    }
  }

  const { salaryGrade, salaryStep } = facts;
  if (
    reasons.length > 0 ||
    rate?.status !== 'FOUND' ||
    basis === null ||
    salaryGrade === null ||
    salaryStep === null
  ) {
    return { status: 'INDETERMINATE', from, to, personnel, salarySchedule, reasons };
  }
  return {
    status: 'RESOLVED',
    from,
    to,
    personnel: { ...personnel, salaryGrade, salaryStep, payBasis: basis },
    salarySchedule: {
      ruleVersionId: rate.ruleVersionId,
      ruleVersionCode: rate.ruleVersionCode,
      monthlyRate: rate.monthlyRate.toFixed(),
    },
    rate: deriveRate(basis, rate.monthlyRate, fraction),
  };
}

/**
 * The basis's own rates from the schedule's monthly full-time rate. Part-time
 * pay is proportional to service, and a casual daily wage is the monthly rate
 * ÷ 22 (EO No. 64, secs. 2-5; DBM NBC No. 601; native-payroll-component-authorities.md).
 * A part-time basis reaches here only with a valid employment fraction.
 */
function deriveRate(
  payBasis: PayBasis,
  scheduleRate: Prisma.Decimal,
  fraction: Prisma.Decimal | null,
): DerivedRate {
  const daily = (monthly: Prisma.Decimal) => monthly.div(WORKING_DAYS_PER_MONTH).toFixed();
  switch (payBasis) {
    case 'MONTHLY_FULL_TIME':
      return {
        monthlyRate: scheduleRate.toFixed(),
        dailyRate: daily(scheduleRate),
        derivation: 'Monthly rate is the schedule rate; daily rate is the monthly rate ÷ 22.',
      };
    case 'PART_TIME_PROPORTIONAL': {
      if (fraction === null) throw new Error('A part-time basis needs its employment fraction.');
      const monthly = scheduleRate.mul(fraction);
      return {
        monthlyRate: monthly.toFixed(),
        dailyRate: daily(monthly),
        derivation:
          'Monthly rate is the schedule rate × the employment fraction; daily rate is the monthly rate ÷ 22.',
      };
    }
    case 'CASUAL_DAILY_WAGE':
      return {
        monthlyRate: null,
        dailyRate: daily(scheduleRate),
        derivation: 'Daily wage is the schedule rate ÷ 22.',
      };
  }
}

function isPayBasis(value: string): value is PayBasis {
  return (payBases as readonly string[]).includes(value);
}

function toEmploymentFraction(value: string | null): Prisma.Decimal | null {
  if (value === null || !/^\d+(\.\d+)?$/.test(value)) return null;
  const fraction = new Prisma.Decimal(value);
  return fraction.gt(0) && fraction.lte(1) ? fraction : null;
}

const dateOf = (value: string) => new Date(`${value}T00:00:00.000Z`);
const addDays = (value: string, days: number) =>
  isoDateOf(new Date(dateOf(value).getTime() + days * 86_400_000));
