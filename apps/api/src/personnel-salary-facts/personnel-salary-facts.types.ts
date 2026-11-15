/**
 * One continuous stretch of an Employee's salary facts: a single Service
 * Segment, clipped to the requested range. A step increment inside the range
 * closes one Service Segment and opens the next, so it yields two stretches.
 * These are Personnel facts only: no rate, ratio, or money.
 */
export interface SalaryFactsInService {
  status: 'IN_SERVICE';
  from: string;
  to: string;
  serviceSegmentId: string;
  /** Null when the Service Segment records none, as a baseline may not. */
  salaryGrade: number | null;
  salaryStep: number | null;
  /**
   * Personnel records no pay basis or employment fraction yet, so these are
   * always null. Treat null as a missing fact, never as monthly full-time.
   */
  payBasis: null;
  employmentFraction: null;
}

/** No effective Service Segment covers these dates. */
export interface SalaryFactsNoServiceSegment {
  status: 'NO_SERVICE_SEGMENT';
  from: string;
  to: string;
}

export type SalaryFactsStretch = SalaryFactsInService | SalaryFactsNoServiceSegment;

export class PersonnelSalaryFactsError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PersonnelSalaryFactsError';
  }
}
