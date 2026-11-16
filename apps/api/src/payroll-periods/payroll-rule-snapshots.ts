import type { Prisma } from '@prisma/client';
import {
  isInEffectOn,
  isoDateOf,
  listRuleVersionEffectivity,
  type NationalPayrollRuleKind,
  type RuleVersionWithEffectivity,
} from '../payroll-rule-versions/national-payroll-rule-versions';

/**
 * The rule kinds every calculation needs on every date of its period. A kind
 * joins this list with its calculator.
 */
export const REQUIRED_RULE_KINDS: readonly NationalPayrollRuleKind[] = ['SALARY_SCHEDULE'];

/**
 * The period-wide Payroll Exception a National Payroll Rule Version load
 * writes on each period past `DRAFT` whose current snapshot it postdates and
 * whose dates it covers (migration 0170, #328 D6 #13): `BLOCKING` while
 * `CALCULATING` or `FOR_REVIEW`, `WARNING` once `CERTIFIED` or `APPROVED`.
 */
export const RULE_VERSION_LOADED_AFTER_SNAPSHOT = 'RULE_VERSION_LOADED_AFTER_SNAPSHOT';

export type RuleCoverage =
  { status: 'COVERED'; ruleVersionIds: string[] } | { status: 'NOT_IN_EFFECT'; reason: string };

const DAY_MS = 86_400_000;

function* datesFrom(from: string, to: string): Generator<string> {
  for (
    let time = Date.parse(`${from}T00:00:00.000Z`);
    time <= Date.parse(`${to}T00:00:00.000Z`);
    time += DAY_MS
  ) {
    yield new Date(time).toISOString().slice(0, 10);
  }
}

/**
 * The versions of one kind in effect on any date from `from` through `to`, in
 * order, and the first date none covers. A tranche change inside the range
 * yields two.
 */
function versionsInEffectDuring(
  ruleKind: string,
  versions: readonly RuleVersionWithEffectivity[],
  from: string,
  to: string,
): { ruleVersionIds: string[]; uncoveredDate: string | null } {
  const ruleVersionIds: string[] = [];
  let uncoveredDate: string | null = null;
  for (const date of datesFrom(from, to)) {
    const inEffect = versions.filter((version) => isInEffectOn(version, date));
    if (inEffect.length > 1) {
      // The load refuses this; reaching it means the table was written around the load.
      throw new Error(`More than one ${ruleKind} version is in effect on ${date}.`);
    }
    const version = inEffect[0];
    if (!version) uncoveredDate ??= date;
    else if (ruleVersionIds.at(-1) !== version.id) ruleVersionIds.push(version.id);
  }
  return { ruleVersionIds, uncoveredDate };
}

/**
 * The versions of one required kind in effect on any date from `from` through
 * `to`, in order. A date that no version covers refuses the range, and the
 * reason names an expired version when one ended before that date.
 */
export function ruleVersionsInEffectDuring(
  ruleKind: string,
  versions: readonly RuleVersionWithEffectivity[],
  from: string,
  to: string,
): RuleCoverage {
  const { ruleVersionIds, uncoveredDate: date } = versionsInEffectDuring(
    ruleKind,
    versions,
    from,
    to,
  );
  if (date === null) return { status: 'COVERED', ruleVersionIds };
  let ended: { code: string; effectiveTo: string } | undefined;
  for (const { code, effectiveTo } of versions) {
    if (effectiveTo !== null && effectiveTo < date && (!ended || effectiveTo > ended.effectiveTo)) {
      ended = { code, effectiveTo };
    }
  }
  return {
    status: 'NOT_IN_EFFECT',
    reason: ended
      ? `${ruleKind} ${ended.code} ended on ${ended.effectiveTo}, and no version is in effect on ${date}.`
      : `No ${ruleKind} version is in effect on ${date}.`,
  };
}

/**
 * Every version, of every kind, in effect on any date from `from` through
 * `to`. A required kind must cover every date or the range is refused; any
 * other kind is referenced on the dates it covers.
 */
export function ruleVersionsForSnapshot(
  versionsByKind: ReadonlyMap<string, readonly RuleVersionWithEffectivity[]>,
  from: string,
  to: string,
  requiredKinds: readonly string[] = REQUIRED_RULE_KINDS,
): RuleCoverage {
  const ruleVersionIds: string[] = [];
  for (const ruleKind of requiredKinds) {
    const coverage = ruleVersionsInEffectDuring(
      ruleKind,
      versionsByKind.get(ruleKind) ?? [],
      from,
      to,
    );
    if (coverage.status === 'NOT_IN_EFFECT') return coverage;
    ruleVersionIds.push(...coverage.ruleVersionIds);
  }
  const optionalKinds = [...versionsByKind.keys()]
    .filter((ruleKind) => !requiredKinds.includes(ruleKind))
    .sort();
  for (const ruleKind of optionalKinds) {
    const versions = versionsByKind.get(ruleKind) ?? [];
    ruleVersionIds.push(...versionsInEffectDuring(ruleKind, versions, from, to).ruleVersionIds);
  }
  return { status: 'COVERED', ruleVersionIds };
}

export type PayrollRuleSnapshotResult =
  | {
      outcome: 'FROZEN';
      snapshotId: string;
      calculationVersion: number;
      nationalPayrollRuleVersionIds: string[];
      authorizedPayrollComponentInputIds: string[];
      agencyPayrollApplicabilityIds: string[];
    }
  | { outcome: 'REFUSED'; code: 'PAYROLL_RULE_NOT_IN_EFFECT'; reason: string };

/**
 * Freeze the rule snapshot of the period's current calculation version, inside
 * the transaction that starts the calculation (#621) and under its Agency
 * database context. Advance `calculation_version` first: one snapshot exists
 * per version. Items reference every National Payroll Rule Version, of every
 * kind, in effect on any date of the period, and every APPROVED Authorized
 * Payroll Component Input and every Agency Payroll Applicability of the Agency
 * whose effective period overlaps the period; they copy no values. Whether an input is paid is the calculation's
 * (#626). A required rule missing or expired on any date refuses the snapshot
 * and writes nothing.
 */
export async function freezePayrollRuleSnapshot(
  transaction: Prisma.TransactionClient,
  input: { agencyId: string; payrollPeriodId: string },
): Promise<PayrollRuleSnapshotResult> {
  const period = await transaction.payrollPeriod.findUnique({
    where: { agencyId_id: { agencyId: input.agencyId, id: input.payrollPeriodId } },
    select: { periodFrom: true, periodTo: true, cutoffAt: true, calculationVersion: true },
  });
  if (!period) throw new Error('The Payroll Period is not in this Agency.');
  if (period.calculationVersion < 1) {
    throw new Error('Start the calculation version before freezing its rule snapshot.');
  }
  const from = isoDateOf(period.periodFrom);
  const to = isoDateOf(period.periodTo);

  // A rule version load waits for this snapshot, then marks its period; a
  // load already under way finishes first, so the snapshot references it.
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended('payroll_rule_snapshots', 0))`;

  // Earlier versions stay in the lists so an expiry can be named.
  const startedBy = { effectiveFrom: { lte: period.periodTo } };
  const loadedKinds = await transaction.nationalPayrollRuleVersion.findMany({
    where: startedBy,
    distinct: ['ruleKind'],
    select: { ruleKind: true },
  });
  const versionsByKind = new Map<string, RuleVersionWithEffectivity[]>();
  for (const ruleKind of new Set([
    ...REQUIRED_RULE_KINDS,
    ...loadedKinds.map((row) => row.ruleKind as NationalPayrollRuleKind),
  ])) {
    versionsByKind.set(
      ruleKind,
      await listRuleVersionEffectivity(transaction, ruleKind, startedBy),
    );
  }
  const coverage = ruleVersionsForSnapshot(versionsByKind, from, to);
  if (coverage.status === 'NOT_IN_EFFECT') {
    return { outcome: 'REFUSED', code: 'PAYROLL_RULE_NOT_IN_EFFECT', reason: coverage.reason };
  }
  const nationalPayrollRuleVersionIds = coverage.ruleVersionIds;

  const overlapsPeriod = {
    agencyId: input.agencyId,
    effectiveFrom: { lte: period.periodTo },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.periodFrom } }],
  };
  const authorizedInputs = await transaction.authorizedPayrollComponentInput.findMany({
    where: { ...overlapsPeriod, status: 'APPROVED' },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  const authorizedPayrollComponentInputIds = authorizedInputs.map((row) => row.id);
  const applicabilities = await transaction.agencyPayrollApplicability.findMany({
    where: overlapsPeriod,
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  const agencyPayrollApplicabilityIds = applicabilities.map((row) => row.id);

  const snapshot = await transaction.payrollRuleSnapshot.create({
    data: {
      agencyId: input.agencyId,
      payrollPeriodId: input.payrollPeriodId,
      calculationVersion: period.calculationVersion,
      cutoffAt: period.cutoffAt,
    },
    select: { id: true },
  });
  const item = { agencyId: input.agencyId, payrollRuleSnapshotId: snapshot.id };
  await transaction.payrollRuleSnapshotItem.createMany({
    data: [
      ...nationalPayrollRuleVersionIds.map((nationalPayrollRuleVersionId) => ({
        ...item,
        nationalPayrollRuleVersionId,
      })),
      ...authorizedPayrollComponentInputIds.map((authorizedPayrollComponentInputId) => ({
        ...item,
        authorizedPayrollComponentInputId,
      })),
      ...agencyPayrollApplicabilityIds.map((agencyPayrollApplicabilityId) => ({
        ...item,
        agencyPayrollApplicabilityId,
      })),
    ],
  });
  return {
    outcome: 'FROZEN',
    snapshotId: snapshot.id,
    calculationVersion: period.calculationVersion,
    nationalPayrollRuleVersionIds,
    authorizedPayrollComponentInputIds,
    agencyPayrollApplicabilityIds,
  };
}
