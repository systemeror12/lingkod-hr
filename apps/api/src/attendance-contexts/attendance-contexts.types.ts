export const ATTENDANCE_CONTEXT_TYPES = [
  'OFFICIAL_BUSINESS',
  'OFFICIAL_TRAVEL',
  'TRAINING',
  'APPROVED_ABSENCE',
] as const;
export type AttendanceContextType = (typeof ATTENDANCE_CONTEXT_TYPES)[number];

export const ATTENDANCE_CONTEXT_COVERAGE_MODES = ['WHOLE_WORK_DATE', 'TIMED'] as const;
export type AttendanceContextCoverageMode = (typeof ATTENDANCE_CONTEXT_COVERAGE_MODES)[number];

/**
 * Blocking Attendance Exception raised when overlapping coverage carries more
 * than one classification. The resolution seam reports Attendance Context versus
 * Attendance Context conflicts; calculation (#166) extends the same exception
 * type to worked and posted-leave coverage. Attendance never assumes a
 * precedence between conflicting classifications.
 */
export const CONFLICTING_COVERAGE_EXCEPTION_TYPE = 'CONFLICTING_COVERAGE';

export interface RecordWholeWorkDateContextInput {
  employeeId: string;
  contextType: AttendanceContextType;
  coverageMode: 'WHOLE_WORK_DATE';
  workDate: string;
  reason: string;
  sourceType?: string | undefined;
  sourceId?: string | undefined;
  evidenceDocumentVersionId?: string | undefined;
}

export interface RecordTimedContextInput {
  employeeId: string;
  contextType: AttendanceContextType;
  coverageMode: 'TIMED';
  startsAt: string;
  endsAt: string;
  reason: string;
  sourceType?: string | undefined;
  sourceId?: string | undefined;
  evidenceDocumentVersionId?: string | undefined;
}

export type RecordAttendanceContextInput =
  RecordWholeWorkDateContextInput | RecordTimedContextInput;

export interface NormalizedAttendanceContextInput {
  employeeId: string;
  contextType: AttendanceContextType;
  coverageMode: AttendanceContextCoverageMode;
  workDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  reason: string;
  sourceType: string | null;
  sourceId: string | null;
  evidenceDocumentVersionId: string | null;
}

export interface AttendanceContextListFilters {
  employeeId?: string | undefined;
  contextType?: AttendanceContextType | undefined;
  coverageMode?: AttendanceContextCoverageMode | undefined;
}

export interface AttendanceContextEmployeeSummary {
  id: string;
  employeeNumber: string;
  legalName: string;
}

/**
 * Evidence linked to a Context. Readers without
 * `documents.evidence.read_sensitive` learn only that `HIGHLY_SENSITIVE`
 * evidence exists, never which Document Version it is.
 */
export type AttendanceContextEvidenceSummary =
  | {
      access: 'FULL';
      documentVersionId: string;
      documentId: string;
      documentNo: string | null;
      documentType: string;
      versionNo: number;
    }
  | { access: 'RESTRICTED' };

export interface AttendanceContextRecorderSummary {
  membershipId: string;
  legalName: string | null;
}

export interface AttendanceContextSummary {
  id: string;
  agencyId: string;
  employee: AttendanceContextEmployeeSummary;
  contextType: AttendanceContextType;
  coverageMode: AttendanceContextCoverageMode;
  workDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  reason: string;
  sourceType: string | null;
  sourceId: string | null;
  evidence: AttendanceContextEvidenceSummary | null;
  recordedBy: AttendanceContextRecorderSummary;
  recordedAt: string;
}

export interface AttendanceContextConflict {
  exceptionType: typeof CONFLICTING_COVERAGE_EXCEPTION_TYPE;
  startsAt: string;
  endsAt: string;
  contextIds: string[];
  contextTypes: AttendanceContextType[];
}

export interface AttendanceContextCoverageInterval {
  context: AttendanceContextSummary;
  startsAt: string;
  endsAt: string;
}

export interface AttendanceContextResolution {
  employeeId: string;
  workDate: string;
  window: AttendanceContextWorkDateWindow;
  intervals: AttendanceContextCoverageInterval[];
  conflicts: AttendanceContextConflict[];
}

/**
 * Instant window that the caller resolved for one Work Date. Attendance Context
 * stores Work Dates, while calculation owns the schedule-local time zone, so the
 * caller maps the Work Date boundaries to exact instants before asking how the
 * recorded context covers that window.
 */
export interface AttendanceContextWorkDateWindow {
  startsAt: string;
  endsAt: string;
}

export class AttendanceContextServiceError extends Error {
  readonly reasons: string[];

  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    reasons: string[] = [],
  ) {
    super(message);
    this.name = 'AttendanceContextServiceError';
    this.reasons = reasons;
  }
}

export function invalid(message: string): AttendanceContextServiceError {
  return new AttendanceContextServiceError(message, 400, 'ATTENDANCE_CONTEXT_INVALID_INPUT');
}

export function toDatabaseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid('Enter a valid calendar date.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw invalid('Enter a valid calendar date.');
  }
  return date;
}

export function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function toDatabaseInstant(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw invalid('Enter a valid exact date and time.');
  return date;
}

export function formatInstant(value: Date): string {
  return value.toISOString();
}

export function normalizeAttendanceContextInput(
  input: RecordAttendanceContextInput,
): NormalizedAttendanceContextInput {
  if (!(ATTENDANCE_CONTEXT_TYPES as readonly string[]).includes(input.contextType)) {
    throw invalid(
      'Select an official business, official travel, training, or approved absence type.',
    );
  }
  const reason = input.reason.trim();
  if (!reason) throw invalid('A reason is required for every Attendance Context.');

  let workDate: string | null = null;
  let startsAt: Date | null = null;
  let endsAt: Date | null = null;
  if (input.coverageMode === 'WHOLE_WORK_DATE') {
    workDate = formatDate(toDatabaseDate(input.workDate));
  } else if (input.coverageMode === 'TIMED') {
    startsAt = toDatabaseInstant(input.startsAt);
    endsAt = toDatabaseInstant(input.endsAt);
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw invalid('A timed Attendance Context must end after it starts.');
    }
  } else {
    throw invalid('Attendance Context covers a whole Work Date or an exact timed interval.');
  }

  const sourceType = input.sourceType?.trim() || null;
  const sourceId = input.sourceId?.trim() || null;
  if ((sourceType === null) !== (sourceId === null)) {
    throw invalid(
      'A linked authoritative source record requires both its type and its identifier.',
    );
  }
  const evidenceDocumentVersionId = input.evidenceDocumentVersionId?.trim() || null;
  if (sourceType === null && evidenceDocumentVersionId === null) {
    throw invalid(
      'Attendance Context requires a linked authoritative source record or a supporting Document Version.',
    );
  }

  return {
    employeeId: input.employeeId,
    contextType: input.contextType,
    coverageMode: input.coverageMode,
    workDate,
    startsAt: startsAt ? formatInstant(startsAt) : null,
    endsAt: endsAt ? formatInstant(endsAt) : null,
    reason,
    sourceType,
    sourceId,
    evidenceDocumentVersionId,
  };
}
