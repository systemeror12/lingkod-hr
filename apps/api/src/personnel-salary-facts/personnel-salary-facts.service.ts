import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PersonnelSalaryFactsError, type SalaryFactsStretch } from './personnel-salary-facts.types';

const DAY_MS = 86_400_000;

interface SegmentPeriod {
  id: string;
  salaryGrade: number | null;
  salaryStep: number | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/**
 * Personnel's read of an Employee's salary facts for other modules. Payroll
 * reads salary grade, step, pay basis, and employment fraction only through
 * here, never from Personnel tables.
 */
@Injectable()
export class PersonnelSalaryFactsService {
  /**
   * Read one Employee's salary facts from `from` to `to`, both inclusive
   * `YYYY-MM-DD` dates, inside a caller-owned transaction. The result covers
   * every date of the range once, in order: one `IN_SERVICE` stretch per
   * primary Service Segment, and `NO_SERVICE_SEGMENT` for dates none covers.
   * Voided Service Segments are ignored. An Employee outside the Agency is
   * refused.
   */
  async readInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    from: string,
    to: string,
  ): Promise<SalaryFactsStretch[]> {
    const rangeFrom = toSalaryFactsDate(from);
    const rangeTo = toSalaryFactsDate(to);
    if (rangeTo < rangeFrom) {
      throw new PersonnelSalaryFactsError(
        `The salary facts range ends on ${to}, before it starts on ${from}.`,
        400,
        'PERSONNEL_SALARY_FACTS_INVALID_RANGE',
      );
    }
    const employee = await transaction.employee.findFirst({
      where: { agencyId, id: employeeId },
      select: { id: true },
    });
    if (!employee) {
      throw new PersonnelSalaryFactsError(
        'The Employee does not belong to this Agency.',
        404,
        'PERSONNEL_SALARY_FACTS_EMPLOYEE_NOT_FOUND',
      );
    }
    // Primary, non-voided Service Segments never overlap (service_segments_primary_no_overlap).
    const segments = await transaction.serviceSegment.findMany({
      where: {
        agencyId,
        employeeId,
        segmentType: 'PRIMARY',
        status: { in: ['ACTIVE', 'CLOSED'] },
        effectiveFrom: { lte: rangeTo },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: rangeFrom } }],
      },
      orderBy: { effectiveFrom: 'asc' },
      select: {
        id: true,
        salaryGrade: true,
        salaryStep: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    });
    return coverRange(segments, rangeFrom, rangeTo);
  }
}

/**
 * Clip ordered, non-overlapping Service Segments that each overlap the range,
 * and fill the dates they leave uncovered with `NO_SERVICE_SEGMENT`.
 */
export function coverRange(
  segments: readonly SegmentPeriod[],
  rangeFrom: Date,
  rangeTo: Date,
): SalaryFactsStretch[] {
  const stretches: SalaryFactsStretch[] = [];
  let cursor = rangeFrom;
  for (const segment of segments) {
    const start = segment.effectiveFrom > cursor ? segment.effectiveFrom : cursor;
    const end =
      segment.effectiveTo && segment.effectiveTo < rangeTo ? segment.effectiveTo : rangeTo;
    if (start > cursor) {
      stretches.push({
        status: 'NO_SERVICE_SEGMENT',
        from: formatDate(cursor),
        to: formatDate(addDays(start, -1)),
      });
    }
    stretches.push({
      status: 'IN_SERVICE',
      from: formatDate(start),
      to: formatDate(end),
      serviceSegmentId: segment.id,
      salaryGrade: segment.salaryGrade,
      salaryStep: segment.salaryStep,
      payBasis: null,
      employmentFraction: null,
    });
    cursor = addDays(end, 1);
  }
  if (cursor <= rangeTo) {
    stretches.push({
      status: 'NO_SERVICE_SEGMENT',
      from: formatDate(cursor),
      to: formatDate(rangeTo),
    });
  }
  return stretches;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parse a `YYYY-MM-DD` date, refusing anything that is not a calendar date. */
function toSalaryFactsDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(date.getTime()) ||
    formatDate(date) !== value
  ) {
    throw new PersonnelSalaryFactsError(
      `${value} is not a valid calendar date.`,
      400,
      'PERSONNEL_SALARY_FACTS_INVALID_DATE',
    );
  }
  return date;
}
