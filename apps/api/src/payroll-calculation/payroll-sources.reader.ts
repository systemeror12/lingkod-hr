import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AttendanceDeficitChargesService } from '../attendance-deficit-charges/attendance-deficit-charges.service';
import { AttendancePeriodsService } from '../attendance-periods/attendance-periods.service';
import {
  type CompensationBasis,
  CompensationBasisService,
} from '../compensation-basis/compensation-basis.service';
import { readPositionTitlesInTransaction } from '../personnel-salary-facts/position-titles';
import { readServiceSegmentAppointmentsInTransaction } from '../personnel-salary-facts/service-segment-appointments';
import { leaveWithoutPayDays } from './days-without-pay.calculator';
import type { DeductionPayeeCategory } from '../payroll-rule-versions/national-payroll-rule-versions';
import type {
  ClothingAllowanceGrant,
  DeductionObligationDue,
  EmployeePayrollSources,
  EmployeeSeparation,
  NightShiftDifferentialRate,
  OfficialVehicleAssignment,
  PendingPayrollInput,
  TaxYearToDate,
} from './payroll-calculator';
import { OFFICIAL_VEHICLE_ASSIGNMENT_COMPONENT_CODE } from './commutable-rata.calculator';
import { CLOTHING_ALLOWANCE_COMPONENT_CODE } from './clothing-allowance.calculator';
import { NIGHT_SHIFT_DIFFERENTIAL_COMPONENT_CODE } from './night-shift-differential.calculator';

/** The input kinds a calculator takes; any other kind stays for its own calculator. */
const CALCULATED_INPUT_KINDS = [
  'LEAVE_WITHOUT_PAY',
  'UNPAID_DEFICIT_REMAINDER',
  'MONETIZATION_EARNING',
  'OVERTIME_HOURS',
];

/**
 * The period a calculation covers, and the Agency Payroll Applicabilities and
 * Authorized Payroll Component Inputs its snapshot froze.
 */
export interface CalculationScope {
  runType: string;
  periodFrom: string;
  periodTo: string;
  agencyPayrollApplicabilityIds: readonly string[];
  authorizedPayrollComponentInputIds: readonly string[];
  paymentDate: string;
  /**
   * Set when a Payroll Adjustment recalculates a FINALIZED period (#356): the
   * Payroll Inputs and Attendance Payroll Facts read are those its final
   * version's lines rest on, as recorded, instead of the unconsumed ones.
   */
  original?: { payrollPeriodId: string; calculationVersion: number };
}

type MonthSources = Pick<
  EmployeePayrollSources,
  'positionTitles' | 'periodAttendance' | 'officialVehicleAssignments'
>;

type SpecialSources = Pick<
  EmployeePayrollSources,
  'clothingAllowanceGrants' | 'serviceSegmentAppointments'
>;

/** What one calculation takes at its cutoff, for every Employee of the Agency. */
export interface AgencyPayrollSources {
  forEmployee(employeeId: string): Omit<EmployeePayrollSources, 'valuationBases'>;
}

/**
 * Reads the sources a calculation takes at its rule snapshot's cutoff (ADR
 * 0014): every `PENDING` Payroll Input accepted at or before it, every
 * `ABSENCE` and `NIGHT_DUTY` fact published at or before it that no finalized
 * payroll consumed, and Leave's report of deficit facts owed a charge in those
 * publications (ADR 0012). It also reads the approved night-shift
 * differential rates the snapshot froze (#627). Attendance is read only through Attendance's
 * application service, and deficit charges only through Leave's.
 *
 * For a regular period's month it also reads the position titles Personnel
 * records, the Attendance published for its Work Dates by the cutoff, and the
 * official-vehicle assignments the snapshot froze, which commutable RATA takes.
 * A special period pays no RATA, so it reads none of them. For a special
 * period it reads instead the cash clothing allowance grants the snapshot
 * froze that are in effect on the payment date, and the appointment nature
 * behind each Service Segment Personnel records in the period.
 *
 * For every period it reads each Employee's tax figures from the Agency's
 * finalized payrolls of the tax year, the withholding tax's year to date.
 * A recalculation of a finalized period (`scope.original`) reads instead the
 * inputs and facts its lines rest on, whatever their status, and no deficit
 * charges: its finalization already settled them.
 * For a regular period it reads each Employee's Deduction Obligations in
 * effect on the period's last day, as they stood at the cutoff, and the
 * separation that ends the Employee's service in the period, if any.
 */
@Injectable()
export class PayrollSourcesReader {
  constructor(
    @Inject(AttendancePeriodsService) private readonly attendance: AttendancePeriodsService,
    @Inject(AttendanceDeficitChargesService)
    private readonly deficitCharges: AttendanceDeficitChargesService,
    @Inject(CompensationBasisService) private readonly compensationBasis: CompensationBasisService,
  ) {}

  async readInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    cutoffAt: Date,
    scope: CalculationScope,
  ): Promise<AgencyPayrollSources> {
    const original = scope.original
      ? await originalSourceIdsInTransaction(transaction, agencyId, scope.original)
      : null;
    const inputs = await transaction.payrollInput.findMany({
      where: original
        ? {
            agencyId,
            id: { in: original.payrollInputIds },
            inputKind: { in: CALCULATED_INPUT_KINDS },
          }
        : {
            agencyId,
            status: 'PENDING',
            inputKind: { in: CALCULATED_INPUT_KINDS },
            acceptedAt: { lte: cutoffAt },
          },
      orderBy: [{ employeeId: 'asc' }, { effectiveDate: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        employeeId: true,
        inputKind: true,
        sourceType: true,
        sourceId: true,
        effectiveDate: true,
        quantity: true,
        amount: true,
        payloadSnapshot: true,
      },
    });
    const facts = await this.attendance.payrollFactsByCutoffInTransaction(
      transaction,
      agencyId,
      cutoffAt,
    );
    const consumed = original
      ? null
      : new Set(
          (
            await transaction.payrollConsumedAttendanceFact.findMany({
              where: {
                agencyId,
                releasedAt: null,
                attendancePayrollFactId: {
                  in: [...facts.absenceFacts, ...facts.nightDutyFacts].map((fact) => fact.id),
                },
              },
              select: { attendancePayrollFactId: true },
            })
          ).map((row) => row.attendancePayrollFactId),
        );
    const taken = (factId: string) =>
      original ? original.attendancePayrollFactIds.has(factId) : !consumed!.has(factId);
    const uncharged = new Map<string, EmployeePayrollSources['unchargedDeficitFacts']>();
    for (const publicationId of original ? [] : facts.publicationIds) {
      for (const employee of await this.deficitCharges.unchargedFactsInTransaction(
        transaction,
        agencyId,
        publicationId,
      )) {
        uncharged.set(employee.employeeId, [
          ...(uncharged.get(employee.employeeId) ?? []),
          ...employee.uncharged.map((fact) => ({ ...fact, publicationId })),
        ]);
      }
    }

    const rates = await this.nightShiftDifferentialRatesInTransaction(transaction, agencyId, scope);

    const month =
      scope.runType === 'REGULAR'
        ? await this.monthSourcesInTransaction(transaction, agencyId, cutoffAt, scope)
        : null;
    const special =
      scope.runType === 'SPECIAL'
        ? await this.specialSourcesInTransaction(transaction, agencyId, scope)
        : null;
    const taxYearToDate = await taxYearToDateInTransaction(
      transaction,
      agencyId,
      scope.paymentDate,
    );
    const deductionObligations =
      scope.runType === 'REGULAR'
        ? await deductionObligationsInTransaction(transaction, agencyId, cutoffAt, scope.periodTo)
        : () => [];
    const separations =
      scope.runType === 'REGULAR'
        ? await separationsInTransaction(transaction, agencyId, cutoffAt, scope)
        : new Map<string, EmployeeSeparation>();

    return {
      forEmployee: (employeeId) => ({
        payrollInputs: inputs
          .filter((input) => input.employeeId === employeeId)
          .map((input): PendingPayrollInput => ({
            id: input.id,
            inputKind: input.inputKind,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            effectiveDate: input.effectiveDate.toISOString().slice(0, 10),
            quantity: input.quantity?.toFixed(4) ?? null,
            amount: input.amount?.toFixed(4) ?? null,
            payloadSnapshot: input.payloadSnapshot,
          })),
        absenceFacts: facts.absenceFacts.filter(
          (fact) => fact.employeeId === employeeId && taken(fact.id),
        ),
        nightDutyFacts: facts.nightDutyFacts.filter(
          (fact) => fact.employeeId === employeeId && taken(fact.id),
        ),
        nightShiftDifferentialRates: rates
          .filter((row) => row.employeeId === null || row.employeeId === employeeId)
          .map((row) => row.rate),
        unchargedDeficitFacts: uncharged.get(employeeId) ?? [],
        ...(month?.(employeeId) ?? {
          positionTitles: [],
          periodAttendance: { coveredDates: [], workDates: [] },
          officialVehicleAssignments: [],
        }),
        ...(special?.(employeeId) ?? {
          clothingAllowanceGrants: [],
          serviceSegmentAppointments: [],
        }),
        taxYearToDate: taxYearToDate(employeeId),
        deductionObligations: deductionObligations(employeeId),
        ...(separations.has(employeeId) ? { separation: separations.get(employeeId)! } : {}),
      }),
    };
  }

  /** The approved `RATE` inputs of night-shift differential the snapshot froze. */
  private async nightShiftDifferentialRatesInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    scope: CalculationScope,
  ): Promise<{ employeeId: string | null; rate: NightShiftDifferentialRate }[]> {
    const component = await transaction.payComponent.findUniqueOrThrow({
      where: { code: NIGHT_SHIFT_DIFFERENTIAL_COMPONENT_CODE },
      select: { id: true },
    });
    const rows = await transaction.authorizedPayrollComponentInput.findMany({
      where: {
        agencyId,
        id: { in: [...scope.authorizedPayrollComponentInputIds] },
        payComponentId: component.id,
        valueKind: 'RATE',
        status: 'APPROVED',
      },
      orderBy: [{ effectiveFrom: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        scope: true,
        employeeId: true,
        value: true,
        authorityDocumentVersionId: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    });
    return rows.map((row) => ({
      employeeId: row.employeeId,
      rate: {
        authorizedPayrollComponentInputId: row.id,
        scope: row.scope as NightShiftDifferentialRate['scope'],
        rate: row.value.toFixed(8),
        authorityDocumentVersionId: row.authorityDocumentVersionId,
        effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: row.effectiveTo?.toISOString().slice(0, 10) ?? null,
      },
    }));
  }

  /** The clothing allowance's sources for a special period, by Employee. */
  private async specialSourcesInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    scope: CalculationScope,
  ): Promise<(employeeId: string) => SpecialSources> {
    const paymentDate = new Date(`${scope.paymentDate}T00:00:00.000Z`);
    const component = await transaction.payComponent.findUniqueOrThrow({
      where: { code: CLOTHING_ALLOWANCE_COMPONENT_CODE },
      select: { id: true },
    });
    const grants = await transaction.agencyPayrollApplicability.findMany({
      where: {
        agencyId,
        id: { in: [...scope.agencyPayrollApplicabilityIds] },
        payComponentId: component.id,
        effectiveFrom: { lte: paymentDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: paymentDate } }],
      },
      orderBy: { id: 'asc' },
      select: { id: true, scope: true, employeeId: true, authorityDocumentVersionId: true },
    });
    const appointments = await readServiceSegmentAppointmentsInTransaction(
      transaction,
      agencyId,
      scope.periodFrom,
      scope.periodTo,
    );
    return (employeeId) => ({
      clothingAllowanceGrants: grants
        .filter((row) => row.employeeId === null || row.employeeId === employeeId)
        .map((row): ClothingAllowanceGrant => ({
          agencyPayrollApplicabilityId: row.id,
          scope: row.scope as ClothingAllowanceGrant['scope'],
          authorityDocumentVersionId: row.authorityDocumentVersionId,
        })),
      serviceSegmentAppointments: appointments
        .filter((row) => row.employeeId === employeeId)
        .map(({ serviceSegmentId, natureOfAppointment }) => ({
          serviceSegmentId,
          natureOfAppointment,
        })),
    });
  }

  /** RATA's sources for a regular period's month, grouped by Employee. */
  private async monthSourcesInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    cutoffAt: Date,
    scope: CalculationScope,
  ) {
    const positionTitles = await readPositionTitlesInTransaction(
      transaction,
      agencyId,
      scope.periodFrom,
      scope.periodTo,
    );
    const attendance = await this.attendance.payrollWorkDatesByCutoffInTransaction(
      transaction,
      agencyId,
      cutoffAt,
      scope.periodFrom,
      scope.periodTo,
    );
    const vehicleComponent = await transaction.payComponent.findUniqueOrThrow({
      where: { code: OFFICIAL_VEHICLE_ASSIGNMENT_COMPONENT_CODE },
      select: { id: true },
    });
    const vehicleAssignments = await transaction.agencyPayrollApplicability.findMany({
      where: {
        agencyId,
        id: { in: [...scope.agencyPayrollApplicabilityIds] },
        payComponentId: vehicleComponent.id,
      },
      orderBy: { effectiveFrom: 'asc' },
      select: {
        id: true,
        scope: true,
        employeeId: true,
        authorityDocumentVersionId: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    });
    const assignments = vehicleAssignments.map((row) => ({
      employeeId: row.employeeId,
      assignment: {
        agencyPayrollApplicabilityId: row.id,
        scope: row.scope as OfficialVehicleAssignment['scope'],
        authorityDocumentVersionId: row.authorityDocumentVersionId,
        effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: row.effectiveTo?.toISOString().slice(0, 10) ?? null,
      } satisfies OfficialVehicleAssignment,
    }));
    const agencyWide = assignments.filter(({ employeeId }) => employeeId === null);

    const byEmployee = new Map<string, MonthSources>();
    const of = (employeeId: string) => {
      let sources = byEmployee.get(employeeId);
      if (!sources) {
        sources = {
          positionTitles: [],
          periodAttendance: { coveredDates: attendance.coveredDates, workDates: [] },
          officialVehicleAssignments: agencyWide.map(({ assignment }) => assignment),
        };
        byEmployee.set(employeeId, sources);
      }
      return sources;
    };
    for (const stretch of positionTitles) of(stretch.employeeId).positionTitles.push(stretch);
    for (const day of attendance.workDates) of(day.employeeId).periodAttendance.workDates.push(day);
    for (const { employeeId, assignment } of assignments) {
      if (employeeId) of(employeeId).officialVehicleAssignments.push(assignment);
    }
    return (employeeId: string) => of(employeeId);
  }

  /**
   * The compensation basis on each source Work Date outside the period, one
   * resolution per calendar month, so a day is valued at the salary in effect
   * on it (ADR 0014).
   */
  async valuationBasesInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    period: { from: string; to: string },
    sources: Omit<EmployeePayrollSources, 'valuationBases'>,
  ): Promise<CompensationBasis[]> {
    const dates = [
      ...sources.payrollInputs.flatMap((input) =>
        input.inputKind === 'LEAVE_WITHOUT_PAY'
          ? (leaveWithoutPayDays(input.payloadSnapshot)?.workDates.map((day) => day.workDate) ?? [])
          : [],
      ),
      ...sources.absenceFacts.map((fact) => fact.workDate),
      ...sources.nightDutyFacts.map((fact) => fact.workDate),
      ...sources.payrollInputs.flatMap((input) =>
        input.inputKind === 'OVERTIME_HOURS' ? [input.effectiveDate] : [],
      ),
    ].filter((date) => date < period.from || date > period.to);
    const byMonth = new Map<string, string[]>();
    for (const date of dates) {
      byMonth.set(date.slice(0, 7), [...(byMonth.get(date.slice(0, 7)) ?? []), date]);
    }
    const bases: CompensationBasis[] = [];
    for (const [, monthDates] of [...byMonth].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const sorted = [...monthDates].sort();
      bases.push(
        await this.compensationBasis.resolveInTransaction(
          transaction,
          agencyId,
          employeeId,
          sorted[0]!,
          sorted[sorted.length - 1]!,
        ),
      );
    }
    return bases;
  }
}

/** The Payroll Inputs and Attendance Payroll Facts a finalized version's own lines rest on. */
async function originalSourceIdsInTransaction(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  original: NonNullable<CalculationScope['original']>,
) {
  const sources = await transaction.$queryRaw<
    { payroll_input_id: string | null; attendance_payroll_fact_id: string | null }[]
  >`
    SELECT DISTINCT s."payroll_input_id"::text, s."attendance_payroll_fact_id"::text
    FROM "payroll_line_sources" s
    JOIN "payroll_lines" l ON l."agency_id" = s."agency_id" AND l."id" = s."payroll_line_id"
    JOIN "payroll_employees" e
      ON e."agency_id" = l."agency_id" AND e."id" = l."payroll_employee_id"
    WHERE e."agency_id" = CAST(${agencyId} AS uuid)
      AND e."payroll_period_id" = CAST(${original.payrollPeriodId} AS uuid)
      AND e."calculation_version" = ${original.calculationVersion}
      AND l."payroll_adjustment_id" IS NULL
  `;
  return {
    payrollInputIds: sources.flatMap((source) => source.payroll_input_id ?? []),
    attendancePayrollFactIds: new Set(
      sources.flatMap((source) => source.attendance_payroll_fact_id ?? []),
    ),
  };
}

/**
 * Each Employee's Deduction Obligations in effect on `periodTo`, a regular
 * period's last day, as they stood at `cutoffAt` (ADR 0014; #634): the version
 * recorded by the cutoff that started by `periodTo`, has not ended before it,
 * and has no successor recorded by the cutoff that started by then. An end
 * recorded after the cutoff is ignored, because ending changes the row in place.
 *
 * A COA recovery of a Payroll Adjustment (#648, ADR 0017) has no issuer to
 * report its balance, so its balance is the version's less what `FINALIZED`
 * results deducted against that version, and one fully collected is not due.
 */
async function deductionObligationsInTransaction(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  cutoffAt: Date,
  periodTo: string,
): Promise<(employeeId: string) => DeductionObligationDue[]> {
  const on = new Date(`${periodTo}T00:00:00.000Z`);
  const started = await transaction.deductionObligation.findMany({
    where: { agencyId, effectiveFrom: { lte: on }, recordedAt: { lte: cutoffAt } },
    orderBy: [{ employeeId: 'asc' }, { incurredOn: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      employeeId: true,
      payeeCategory: true,
      payeeName: true,
      issuerReference: true,
      incurredOn: true,
      outstandingBalance: true,
      scheduledAmount: true,
      effectiveTo: true,
      endedAt: true,
      supersedesObligationId: true,
      payrollAdjustmentId: true,
    },
  });
  const superseded = new Set(started.flatMap((row) => row.supersedesObligationId ?? []));
  const endedBy = (row: (typeof started)[number]) =>
    row.endedAt !== null && row.endedAt <= cutoffAt ? row.effectiveTo : null;
  const inEffect = started.filter((row) => {
    const effectiveTo = endedBy(row);
    return !superseded.has(row.id) && (effectiveTo === null || effectiveTo >= on);
  });
  const recoveryIds = inEffect.flatMap((row) => (row.payrollAdjustmentId ? [row.id] : []));
  const collected = new Map(
    recoveryIds.length === 0
      ? []
      : (
          await transaction.$queryRaw<{ id: string; deducted: Prisma.Decimal }[]>`
            SELECT l."deduction_obligation_id"::text AS "id", sum(l."deducted_amount") AS "deducted"
            FROM "loan_deduction_lines" l
            JOIN "payroll_employees" e
              ON e."agency_id" = l."agency_id" AND e."id" = l."payroll_employee_id"
            WHERE l."agency_id" = CAST(${agencyId} AS uuid)
              AND l."deduction_obligation_id" = ANY(CAST(${recoveryIds} AS uuid[]))
              AND e."status" = 'FINALIZED'
            GROUP BY 1
          `
        ).map((row) => [row.id, new Prisma.Decimal(row.deducted)]),
  );
  return (employeeId) =>
    inEffect
      .filter((row) => row.employeeId === employeeId)
      .flatMap((row) => {
        const balance = row.outstandingBalance.sub(collected.get(row.id) ?? 0);
        if (!balance.gt(0)) return [];
        return [
          {
            id: row.id,
            payeeCategory: row.payeeCategory as DeductionPayeeCategory,
            payeeName: row.payeeName,
            issuerReference: row.issuerReference,
            incurredOn: row.incurredOn.toISOString().slice(0, 10),
            outstandingBalance: balance.toFixed(4),
            scheduledAmount: row.scheduledAmount.toFixed(4),
            ...(row.payrollAdjustmentId ? { payrollAdjustmentId: row.payrollAdjustmentId } : {}),
          },
        ];
      });
}

/**
 * Each Employee's `EFFECTIVE` Separation Case, effectuated by `cutoffAt`, whose
 * last day of service, the day before its approved effective date, falls in
 * the period (#633). The withholding tax makes its year-end adjustment then.
 */
async function separationsInTransaction(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  cutoffAt: Date,
  scope: CalculationScope,
): Promise<Map<string, EmployeeSeparation>> {
  const dayAfter = new Date(`${scope.periodTo}T00:00:00.000Z`);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  const cases = await transaction.separationCase.findMany({
    where: {
      agencyId,
      status: 'EFFECTIVE',
      effectuatedAt: { lte: cutoffAt },
      approvedEffectiveDate: { gt: new Date(`${scope.periodFrom}T00:00:00.000Z`), lte: dayAfter },
    },
    orderBy: [{ approvedEffectiveDate: 'asc' }, { id: 'asc' }],
    select: { id: true, employeeId: true, approvedEffectiveDate: true },
  });
  return new Map(
    cases.map((row) => [
      row.employeeId,
      {
        separationCaseId: row.id,
        effectiveDate: row.approvedEffectiveDate!.toISOString().slice(0, 10),
      },
    ]),
  );
}

/**
 * Each Employee's tax figures from the Agency's `FINALIZED` Payroll Periods
 * whose payment date falls in the calendar year of `paymentDate`, at each
 * period's final calculation version: the sums of their tax lines, the
 * amount of each de minimis benefit their lines paid, and the 13th-month pay
 * and other benefits their lines paid. A held Employee has no result in a
 * period, so the period adds nothing for them.
 */
async function taxYearToDateInTransaction(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  paymentDate: string,
): Promise<(employeeId: string) => TaxYearToDate> {
  const taxYear = Number(paymentDate.slice(0, 4));
  const periods = await transaction.payrollPeriod.findMany({
    where: {
      agencyId,
      status: 'FINALIZED',
      paymentDate: {
        gte: new Date(`${taxYear}-01-01T00:00:00.000Z`),
        lte: new Date(`${taxYear}-12-31T00:00:00.000Z`),
      },
    },
    orderBy: [{ paymentDate: 'asc' }, { id: 'asc' }],
    select: { id: true, calculationVersion: true },
  });
  const results =
    periods.length === 0
      ? []
      : await transaction.payrollEmployee.findMany({
          where: {
            agencyId,
            OR: periods.map((period) => ({
              payrollPeriodId: period.id,
              calculationVersion: period.calculationVersion,
            })),
          },
          select: {
            employeeId: true,
            payrollPeriodId: true,
            taxLine: {
              select: {
                taxableCompensation: true,
                nonTaxableCompensation: true,
                withholdingTax: true,
              },
            },
            lines: {
              where: {
                OR: ['DE_MINIMIS', 'THIRTEENTH_MONTH_AND_OTHER_BENEFITS'].map((treatment) => ({
                  sourceSnapshot: { path: ['taxTreatment'], equals: treatment },
                })),
              },
              select: { amount: true, sourceSnapshot: true },
            },
          },
        });
  const zero = new Prisma.Decimal(0);
  return (employeeId) => {
    const own = results.filter((result) => result.employeeId === employeeId);
    const sum = (amounts: Prisma.Decimal[]) =>
      amounts.reduce((total, amount) => total.add(amount), zero).toFixed(4);
    const deMinimis = new Map<string, Prisma.Decimal>();
    let benefits = zero;
    for (const line of own.flatMap((result) => result.lines)) {
      const source = line.sourceSnapshot as { taxTreatment?: unknown; deMinimisBenefit?: unknown };
      if (source.taxTreatment !== 'DE_MINIMIS') {
        benefits = benefits.add(line.amount);
        continue;
      }
      const benefit = String(source.deMinimisBenefit);
      deMinimis.set(benefit, (deMinimis.get(benefit) ?? zero).add(line.amount));
    }
    const taxLines = own.flatMap((result) => (result.taxLine ? [result.taxLine] : []));
    return {
      taxYear,
      payrollPeriodIds: periods
        .filter((period) => own.some((result) => result.payrollPeriodId === period.id))
        .map((period) => period.id),
      taxableCompensation: sum(taxLines.map((line) => line.taxableCompensation)),
      nonTaxableCompensation: sum(taxLines.map((line) => line.nonTaxableCompensation)),
      withholdingTax: sum(taxLines.map((line) => line.withholdingTax)),
      deMinimisBenefits: Object.fromEntries(
        [...deMinimis].map(([benefit, amount]) => [benefit, amount.toFixed(4)]),
      ),
      thirteenthMonthAndOtherBenefits: benefits.toFixed(4),
    };
  };
}
