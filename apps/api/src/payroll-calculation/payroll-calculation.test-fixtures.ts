import type { Prisma } from '@prisma/client';
import { AttendanceDeficitChargesService } from '../attendance-deficit-charges/attendance-deficit-charges.service';
import { AttendancePeriodsService } from '../attendance-periods/attendance-periods.service';
import type { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import {
  mandatoryLeaveAssessmentAuditWriter,
  MandatoryLeaveAssessmentsService,
} from '../mandatory-leave-assessments/mandatory-leave-assessments.service';
import { PayrollInputsService } from '../payroll-inputs/payroll-inputs.service';
import { PersonnelSalaryFactsService } from '../personnel-salary-facts/personnel-salary-facts.service';
import { PayrollSourcesReader } from './payroll-sources.reader';

/** Attendance's read and Leave's charge report, wired as the API wires them. */
export function attendanceAndLeave() {
  // Payroll's and Leave's reads use none of the period workflow's collaborators.
  const attendance = new AttendancePeriodsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const deficitCharges = new AttendanceDeficitChargesService(
    attendance,
    new PayrollInputsService(),
    new MandatoryLeaveAssessmentsService(mandatoryLeaveAssessmentAuditWriter),
  );
  return { attendance, deficitCharges };
}

export function payrollSourcesReader(basis: CompensationBasisService) {
  const { attendance, deficitCharges } = attendanceAndLeave();
  return new PayrollSourcesReader(attendance, deficitCharges, basis);
}

type RecordedBasis = { payBasis: string; employmentFraction: string | null };

/**
 * Personnel records no pay basis yet (#619). This stands in for the facts it
 * will record, per Employee, on the same Service Segments.
 */
export class RecordedPayBases extends PersonnelSalaryFactsService {
  readonly bases = new Map<string, RecordedBasis>();

  override async readInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    from: string,
    to: string,
  ) {
    const stretches = await super.readInTransaction(transaction, agencyId, employeeId, from, to);
    const basis = this.bases.get(employeeId);
    return stretches.map((stretch) =>
      stretch.status === 'IN_SERVICE' && basis ? { ...stretch, ...basis } : stretch,
    ) as never;
  }
}
