/**
 * How a CTO input covers its Work Date. `NONE` is reserved for a successor
 * that withdraws coverage, so a first input is always one of these two.
 */
export const CTO_COVERAGE_MODES = ['WHOLE_WORK_DATE', 'TIMED'] as const;
export type CtoCoverageMode = (typeof CTO_COVERAGE_MODES)[number];

/** One approved CTO Work Date as the COC module hands it to Attendance. */
export interface RecordCtoInput {
  /** Stable key the CTO approval derives per Work Date, so a retry returns the same input. */
  sourceKey: string;
  employeeId: string;
  /** The CTO record the input traces back to. */
  sourceType: string;
  sourceId: string;
  workDate: string;
  coverageMode: CtoCoverageMode;
  /** ISO instants of the timed interval; required for `TIMED`, absent otherwise. */
  startsAt?: string | undefined;
  endsAt?: string | undefined;
}

/** The withdrawal of one current CTO input, as a CTO cancellation hands it to Attendance. */
export interface VoidCtoInput {
  /** Stable effect key the cancellation derives per Work Date, so a retry returns the same successor. */
  sourceKey: string;
  employeeId: string;
  predecessorInputId: string;
  /** The cancellation record the successor traces back to. */
  sourceType: string;
  sourceId: string;
}

/** A current CTO input covering one Work Date. A `null` interval covers the whole Work Date. */
export interface CtoDayCoverage {
  inputId: string;
  interval: { startsAt: Date; endsAt: Date } | null;
}

export class AttendanceCtoInputError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'AttendanceCtoInputError';
  }
}

export function invalid(message: string): AttendanceCtoInputError {
  return new AttendanceCtoInputError(message, 400, 'CTO_INPUT_INVALID');
}

export function toDatabaseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || date.toISOString().slice(0, 10) !== value) {
    throw invalid('Enter a valid calendar date.');
  }
  return date;
}

function toInstant(value: string | undefined): Date | null {
  if (value === undefined) return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw invalid('Enter a valid CTO interval.');
  return instant;
}

export function assertValidVoidCtoInput(input: VoidCtoInput): void {
  if (input.sourceKey.trim().length === 0) throw invalid('A stable source key is required.');
  if (input.sourceType.trim().length === 0) throw invalid('A CTO source reference is required.');
}

/** The validated facts a CTO input stores, or a `CTO_INPUT_INVALID` error. */
export function ctoInputFacts(input: RecordCtoInput): {
  workDate: Date;
  startsAt: Date | null;
  endsAt: Date | null;
} {
  if (input.sourceKey.trim().length === 0) throw invalid('A stable source key is required.');
  if (input.sourceType.trim().length === 0) throw invalid('A CTO source reference is required.');
  if (!CTO_COVERAGE_MODES.includes(input.coverageMode)) {
    throw invalid('Enter a valid CTO coverage mode.');
  }
  const workDate = toDatabaseDate(input.workDate);
  const startsAt = toInstant(input.startsAt);
  const endsAt = toInstant(input.endsAt);
  if (input.coverageMode === 'WHOLE_WORK_DATE') {
    if (startsAt || endsAt) throw invalid('Whole Work Date CTO carries no interval.');
  } else if (!startsAt || !endsAt || endsAt <= startsAt) {
    throw invalid('Timed CTO needs an interval that ends after it starts.');
  }
  return { workDate, startsAt, endsAt };
}
