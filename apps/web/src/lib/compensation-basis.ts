import type { StatusDisplay } from '../components/ui/status-tag';

/** Source: the Personnel Service Segment the facts come from. */
export interface PersonnelFacts {
  serviceSegmentId: string;
  salaryGrade: number | null;
  salaryStep: number | null;
  payBasis: string | null;
  employmentFraction: string | null;
}

/** Source: the salary schedule rule version in effect, and its rate for the grade and step. */
export interface SalaryScheduleRate {
  ruleVersionId: string;
  ruleVersionCode: string;
  monthlyRate: string | null;
}

/** Source: derived by Payroll from the Personnel facts and the schedule rate. */
export interface DerivedRate {
  monthlyRate: string | null;
  dailyRate: string;
  derivation: string;
}

export type CompensationBasisStretch =
  | {
      status: 'RESOLVED';
      from: string;
      to: string;
      personnel: PersonnelFacts;
      salarySchedule: SalaryScheduleRate;
      rate: DerivedRate;
    }
  | {
      status: 'INDETERMINATE';
      from: string;
      to: string;
      personnel: PersonnelFacts | null;
      salarySchedule: SalaryScheduleRate | null;
      reasons: { code: string; message: string }[];
    };

/** An Employee's compensation basis as `GET /employees/:id/compensation-basis` returns it. */
export interface CompensationBasis {
  employeeId: string;
  from: string;
  to: string;
  status: 'RESOLVED' | 'INDETERMINATE';
  stretches: CompensationBasisStretch[];
}

/** An indeterminate basis blocks payroll, so it never reads as resolved. */
export const basisStatusDisplay: Record<CompensationBasis['status'], StatusDisplay> = {
  RESOLVED: { label: 'Resolved', tone: 'info' },
  INDETERMINATE: { label: 'Indeterminate', tone: 'warning' },
};

export const payBasisLabel: Record<string, string> = {
  MONTHLY_FULL_TIME: 'Monthly, full-time',
  PART_TIME_PROPORTIONAL: 'Part-time, proportional',
  CASUAL_DAILY_WAGE: 'Casual daily wage',
};

/** The first and last dates of the calendar month that holds `date` (`YYYY-MM-DD`). */
export function monthRange(date: string): { from: string; to: string } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = date.slice(0, 7);
  return { from: `${prefix}-01`, to: `${prefix}-${String(lastDay).padStart(2, '0')}` };
}
