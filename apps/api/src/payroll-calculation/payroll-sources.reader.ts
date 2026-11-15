import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AttendanceDeficitChargesService } from '../attendance-deficit-charges/attendance-deficit-charges.service';
import { AttendancePeriodsService } from '../attendance-periods/attendance-periods.service';
import {
  type CompensationBasis,
  CompensationBasisService,
} from '../compensation-basis/compensation-basis.service';
import { leaveWithoutPayDays } from './days-without-pay.calculator';
import type { EmployeePayrollSources, PendingPayrollInput } from './payroll-calculator';

/** The input kinds a calculator takes; any other kind stays for its own calculator. */
const SALARY_INPUT_KINDS = ['LEAVE_WITHOUT_PAY', 'UNPAID_DEFICIT_REMAINDER'];

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
      }),
    };
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
