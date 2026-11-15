import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AttendanceDeficitChargesService } from '../attendance-deficit-charges/attendance-deficit-charges.service';
import { AttendancePeriodsService } from '../attendance-periods/attendance-periods.service';
import {
  type CompensationBasis,
  CompensationBasisService,
} from '../compensation-basis/compensation-basis.service';
import { readPositionTitlesInTransaction } from '../personnel-salary-facts/position-titles';
import { leaveWithoutPayDays } from './days-without-pay.calculator';
import type {
  EmployeePayrollSources,
  OfficialVehicleAssignment,
  PendingPayrollInput,
} from './payroll-calculator';
import { OFFICIAL_VEHICLE_ASSIGNMENT_COMPONENT_CODE } from './commutable-rata.calculator';

/** The input kinds a calculator takes; any other kind stays for its own calculator. */
const SALARY_INPUT_KINDS = ['LEAVE_WITHOUT_PAY', 'UNPAID_DEFICIT_REMAINDER', 'OVERTIME_HOURS'];

/** The period a calculation covers and the Agency Payroll Applicabilities its snapshot froze. */
export interface CalculationScope {
  runType: string;
  periodFrom: string;
  periodTo: string;
  agencyPayrollApplicabilityIds: readonly string[];
}

type MonthSources = Pick<
  EmployeePayrollSources,
  'positionTitles' | 'periodAttendance' | 'officialVehicleAssignments'
>;

/** What one calculation takes at its cutoff, for every Employee of the Agency. */
export interface AgencyPayrollSources {
  forEmployee(employeeId: string): Omit<EmployeePayrollSources, 'valuationBases'>;
}

/**
 * Reads the sources a calculation takes at its rule snapshot's cutoff (ADR
 * 0014): every `PENDING` Payroll Input accepted at or before it, every
 * `ABSENCE` fact published at or before it that no finalized payroll
 * consumed, and Leave's report of deficit facts owed a charge in those
 * publications (ADR 0012). Attendance is read only through Attendance's
 * application service, and deficit charges only through Leave's.
 *
 * For a regular period's month it also reads the position titles Personnel
 * records, the Attendance published for its Work Dates by the cutoff, and the
 * official-vehicle assignments the snapshot froze, which commutable RATA takes.
 * A special period pays no RATA, so it reads none of them.
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
    const inputs = await transaction.payrollInput.findMany({
      where: {
        agencyId,
        status: 'PENDING',
        inputKind: { in: SALARY_INPUT_KINDS },
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
        payloadSnapshot: true,
      },
    });
    const facts = await this.attendance.payrollFactsByCutoffInTransaction(
      transaction,
      agencyId,
      cutoffAt,
    );
    const consumed = new Set(
      (
        await transaction.payrollConsumedAttendanceFact.findMany({
          where: {
            agencyId,
            releasedAt: null,
            attendancePayrollFactId: { in: facts.absenceFacts.map((fact) => fact.id) },
          },
          select: { attendancePayrollFactId: true },
        })
      ).map((row) => row.attendancePayrollFactId),
    );
    const uncharged = new Map<string, EmployeePayrollSources['unchargedDeficitFacts']>();
    for (const publicationId of facts.publicationIds) {
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

    const month =
      scope.runType === 'REGULAR'
        ? await this.monthSourcesInTransaction(transaction, agencyId, cutoffAt, scope)
        : null;

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
            payloadSnapshot: input.payloadSnapshot,
          })),
        absenceFacts: facts.absenceFacts.filter(
          (fact) => fact.employeeId === employeeId && !consumed.has(fact.id),
        ),
        unchargedDeficitFacts: uncharged.get(employeeId) ?? [],
        ...(month?.(employeeId) ?? {
          positionTitles: [],
          periodAttendance: { coveredDates: [], workDates: [] },
          officialVehicleAssignments: [],
        }),
      }),
    };
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
