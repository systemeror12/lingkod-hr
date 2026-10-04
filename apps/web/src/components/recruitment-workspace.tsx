'use client';

import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { manilaToday } from '../lib/manila-date';
import {
  RecruitmentEvaluationPanels,
  type AssessmentRecord,
  type InterviewRecord,
  type SelectionPlanRecord,
} from './recruitment-evaluation-panels';
import { DetailRow, GuidedPanel, RecordStatus } from './recruitment-record';
import { useRecordNavigation } from './record-navigation';
import { StateCode, StateSurface } from './state-surface';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';
import { PageHeader } from './ui/page-header';
import { Panel } from './ui/panel';
import { SectionTabLinks } from './ui/section-tabs';
import { RowHeader, Table, TableFooter, Td, Th, Tr } from './ui/table';

type Section = 'requests' | 'publications' | 'applications' | 'sessions' | 'decisions';
type View = 'tree' | 'form' | 'kanban';
type NewRecord = 'request' | 'publication' | 'application' | 'session' | null;

export interface PlantillaPositionOption {
  id: string;
  itemNumber: string;
  status: string;
  currentVersion: {
    title: string;
    salaryGrade: number;
    organizationUnit: { id: string; code: string; name: string };
    employmentCategory: string;
    lifecycleStatus: string;
  } | null;
}

export interface DocumentOption {
  documentId: string;
  documentNo: string | null;
  documentType: string;
  status: string;
  version: { id: string; versionNo: number; issuedAt: string | null };
}

export interface RecruitmentRequest {
  id: string;
  requestNo: string;
  position: {
    id: string;
    itemNumber: string;
    title: string;
    parentheticalTitle: string | null;
    salaryGrade: number;
    organizationUnitId: string;
    organizationUnitCode: string;
    organizationUnitName: string;
  };
  requestingUnit: { id: string; code: string; name: string };
  justification: string;
  qualificationStandard: { id: string; versionNo: number; code: string; name: string };
  governingConfiguration: {
    mspPlanVersionId: string | null;
    criteriaSetId: string | null;
    boardDefinitionId: string | null;
    bindingSetNo: number;
    resolvedAt: string | null;
    frozenAt: string | null;
  };
  approvalRequestId: string | null;
  routeBindings: Array<{
    bindingSetNo: number;
    checkpointCode: string;
    routeVersionId: string;
    routeCode: string;
    routeVersionNo: number;
  }>;
  rebaselines: Array<{
    id: string;
    fromMspPlanVersionId: string | null;
    fromCriteriaSetId: string | null;
    fromBoardDefinitionId: string | null;
    toMspPlanVersionId: string | null;
    toCriteriaSetId: string | null;
    toBoardDefinitionId: string | null;
    reason: string;
    authorityDocumentVersionId: string | null;
    authorizedByMembershipId: string;
    createdAt: string;
  }>;
  status: string;
  submittedAt: string | null;
  approvedAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VacancyPublication {
  id: string;
  publicationNo: string;
  requestToFillId: string;
  requestNo: string;
  position: RecruitmentRequest['position'];
  qualificationStandard: { id: string; versionNo: number; code: string; name: string };
  formDocumentVersionId: string;
  approvalRouteVersionId: string;
  approvalRequestId: string | null;
  openingDate: string;
  closingDate: string;
  channels: unknown;
  positionDetails: unknown;
  applicationRequirements: unknown;
  contactDetails: unknown;
  hrmoCertification: unknown | null;
  certifiedByMembershipId: string | null;
  certifiedAt: string | null;
  publishedAt: string | null;
  republicationOfId: string | null;
  republicationReason: string | null;
  republicationAuthorityDocumentVersionId: string | null;
  status: string;
  closedAt: string | null;
  closureReason: string | null;
  closureAuthorityDocumentVersionId: string | null;
  cancellationReason: string | null;
  cancellationAuthorityDocumentVersionId: string | null;
  evidence: Array<{
    id: string;
    channelType: string;
    location: string;
    reference: string | null;
    publishedAt: string;
    evidenceDocumentVersionId: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationScreeningRecord {
  id: string;
  versionNo: number;
  result: string;
  reason: string;
  areaResults: Array<{
    area: string;
    result: string;
    evidenceDocumentVersionIds: string[];
    note: string | null;
  }>;
  screenedByMembershipId: string;
  screenedAt: string;
  replacesScreeningId: string | null;
  correctionReason: string | null;
  correctionAuthorityDocumentVersionId: string | null;
}

export interface VacancyApplication {
  id: string;
  applicationNo: string;
  publicationId: string;
  publicationNo: string;
  publicationStatus: string;
  openingDate: string;
  closingDate: string;
  requestToFillId: string;
  requestNo: string;
  position: RecruitmentRequest['position'];
  applicant: {
    id: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    suffix: string | null;
    fullName: string;
    email: string | null;
    mobileNumber: string | null;
    privacyNoticeVersion: string;
    consentedAt: string;
    createdAt: string;
  };
  qualificationStandard: {
    id: string;
    versionNo: number;
    code: string;
    name: string;
    effectiveFrom: string;
    educationRequirement: string | null;
    trainingHoursRequired: number | null;
    experienceMonthsRequired: number | null;
    eligibilityRequirement: string | null;
    licenseRequirements: unknown;
    competencyRequirements: unknown;
    specialRequirements: string | null;
    applicableAreas: string[];
  };
  status: string;
  receivedAt: string;
  receivedByMembershipId: string;
  lateAcceptance: { reason: string; authorityDocumentVersionId: string } | null;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
  closedAt: string | null;
  closureReason: string | null;
  documents: Array<{
    id: string;
    documentId: string;
    documentNo: string | null;
    documentType: string;
    classification: string;
    documentVersionId: string;
    versionNo: number;
    purpose: string;
    note: string | null;
    linkedAt: string;
  }>;
  screenings: ApplicationScreeningRecord[];
  latestScreening: ApplicationScreeningRecord | null;
  selectionPlan: SelectionPlanRecord | null;
  selectionPlanIssue: string | null;
  assessments: AssessmentRecord[];
  interviews: InterviewRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface BoardRosterMember {
  id: string;
  boardAppointmentId: string;
  membershipId: string;
  memberName: string;
  seatCode: string;
  boardRole: string;
  appointmentKind: string;
  isAlternate: boolean;
  isVoting: boolean;
}

export interface BoardParticipation {
  id: string;
  rosterSnapshotMemberId: string;
  membershipId: string;
  boardRole: string;
  attendanceStatus: string;
  signedAt: string | null;
  recordedAt: string;
}

export interface BoardConflict {
  id: string;
  participationId: string;
  membershipId: string;
  applicationId: string;
  hasConflict: boolean;
  details: string | null;
  declaredAt: string;
}

export interface BoardQuorum {
  id: string;
  applicationId: string;
  applicationNo: string;
  applicantName: string;
  applicationStatus: string;
  votingSeats: number;
  nationalFloor: number;
  eligibleVotingMembers: number;
  requiredVotingMembers: number;
  presentVotingMembers: number;
  satisfied: boolean;
  frozenAt: string;
}

export interface BoardRecommendation {
  id: string;
  applicationId: string;
  applicationNo: string;
  applicantName: string;
  rankNo: number | null;
  recommendation: string;
  compositeScore: number | null;
  reason: string | null;
  recordedByMembershipId: string;
  recordedAt: string;
}

export interface BoardReport {
  id: string;
  versionNo: number;
  reportDocumentVersionId: string;
  reason: string | null;
  issuedByMembershipId: string;
  issuedAt: string;
}

export interface BoardDecisionReference {
  id: string;
  applicationId: string;
  decision: string;
  reason: string;
  decidedByMembershipId: string;
  decidedAt: string;
}

export interface BoardSession {
  id: string;
  publicationId: string;
  publicationNo: string;
  publicationStatus: string;
  openingDate: string;
  closingDate: string;
  requestToFillId: string;
  requestNo: string;
  position: {
    id: string;
    itemNumber: string;
    title: string | null;
    salaryGrade: number | null;
    organizationUnitId: string | null;
  };
  boardDefinitionId: string;
  boardCode: string;
  boardVersionNo: number;
  sessionDate: string;
  status: string;
  rosterFrozenAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  minutesDocumentVersionId: string | null;
  roster: BoardRosterMember[];
  participations: BoardParticipation[];
  conflicts: BoardConflict[];
  quorum: BoardQuorum[];
  recommendations: BoardRecommendation[];
  reports: BoardReport[];
  decisions: BoardDecisionReference[];
  createdAt: string;
  updatedAt: string;
}

export interface SelectionPackagePreview {
  applicationId?: string;
  applicationNo?: string;
  publicationNo?: string;
  position?: { itemNumber?: string; title?: string | null };
  boardRecommendation?: { recommendation?: string; rankNo?: number | null };
  report?: { versionNo?: number };
  [key: string]: unknown;
}

export interface SelectionDecisionRecord {
  id: string;
  applicationId: string;
  applicationNo: string;
  applicantName: string;
  applicationStatus: string;
  decision: string;
  reason: string;
  authorityDocumentVersionId: string | null;
  decidedByMembershipId: string;
  decidedAt: string;
  sessionId: string;
  sessionStatus: string;
  boardDefinitionCode: string;
  boardDefinitionVersionNo: number;
  boardRecommendation: {
    id: string;
    recommendation: string;
    rankNo: number | null;
    compositeScore: number | null;
    reason: string | null;
  };
  report: { id: string; versionNo: number; reportDocumentVersionId: string } | null;
  position: {
    id: string;
    itemNumber: string;
    title: string | null;
    salaryGrade: number | null;
    organizationUnitId: string | null;
  };
  handoff: {
    id: string;
    positionId: string;
    itemNumber: string;
    handedOffAt: string;
    acceptedAt: string | null;
    selectionPackage: unknown;
  } | null;
}

const BOARD_ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'RECUSED'] as const;

const APPLICATION_DOCUMENT_PURPOSES = [
  'PRIVACY_CONSENT',
  'EDUCATION',
  'TRAINING',
  'EXPERIENCE',
  'ELIGIBILITY',
  'LICENSE',
  'COMPETENCY',
  'SPECIAL_REQUIREMENT',
  'OTHER',
] as const;

const SCREENING_MANAGED_STATUSES = ['RECEIVED', 'INCOMPLETE', 'QUALIFIED', 'NOT_QUALIFIED'];

function areaLabel(area: string): string {
  return area
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^\w/, (value) => value.toUpperCase());
}

function derivedScreeningResult(
  areaResults: Array<{ area: string; result: string }>,
  applicableAreas: string[],
): string {
  const applicable = areaResults.filter((entry) => applicableAreas.includes(entry.area));
  if (applicable.some((entry) => entry.result === 'UNVERIFIED')) return 'INCOMPLETE';
  if (applicable.some((entry) => entry.result === 'DOES_NOT_MEET')) return 'NOT_QUALIFIED';
  return 'QUALIFIED';
}

function evidenceSummary(record: VacancyApplication): string {
  const latest = record.latestScreening;
  if (!latest)
    return `${record.documents.length} document${record.documents.length === 1 ? '' : 's'}`;
  if (latest.result === 'INCOMPLETE') return 'Missing evidence';
  if (latest.result === 'NOT_QUALIFIED') return 'Does not meet';
  return 'Evidence complete';
}

interface Props {
  agencyId: string;
  membershipId: string;
  displayName: string;
  initialRequests: RecruitmentRequest[];
  initialPublications: VacancyPublication[];
  initialApplications: VacancyApplication[];
  initialSessions: BoardSession[];
  initialDecisions: SelectionDecisionRecord[];
  positions: PlantillaPositionOption[];
  documents: DocumentOption[];
  initialSection: Section;
  initialView: View;
  initialSelected: string | undefined;
  initialNew: NewRecord;
  canCreateRequest: boolean;
  canSubmitRequest: boolean;
  canReviewRequest: boolean;
  canRebaselineRequest: boolean;
  canApproveRequest: boolean;
  canRejectRequest: boolean;
  canCancelRequest: boolean;
  canCloseRequest: boolean;
  canCreatePublication: boolean;
  canSubmitPublication: boolean;
  canPublishPublication: boolean;
  canClosePublication: boolean;
  canCancelPublication: boolean;
  canRepublishPublication: boolean;
  canReadRequests: boolean;
  canReadPublications: boolean;
  canReadApplications: boolean;
  canReadDeliberations: boolean;
  canCreateApplication: boolean;
  canUpdateApplication: boolean;
  canScreenApplication: boolean;
  canDisqualifyApplication: boolean;
  canWithdrawApplication: boolean;
  canCloseApplication: boolean;
  canManageAssessments: boolean;
  canManageInterviews: boolean;
  canSubmitDeliberations: boolean;
  canRecommendBoard: boolean;
  canSelectCandidate: boolean;
  canDecideSelection: boolean;
}

interface Permissions {
  submitRequest: boolean;
  reviewRequest: boolean;
  rebaselineRequest: boolean;
  approveRequest: boolean;
  rejectRequest: boolean;
  cancelRequest: boolean;
  closeRequest: boolean;
  submitPublication: boolean;
  publishPublication: boolean;
  closePublication: boolean;
  cancelPublication: boolean;
  republishPublication: boolean;
  updateApplication: boolean;
  screenApplication: boolean;
  disqualifyApplication: boolean;
  withdrawApplication: boolean;
  closeApplication: boolean;
  manageAssessments: boolean;
  manageInterviews: boolean;
  submitDeliberations: boolean;
  recommendBoard: boolean;
  selectCandidate: boolean;
  decideSelection: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inputValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function confirmAction(message: string): boolean {
  const browser = globalThis as unknown as {
    confirm?: (value: string) => boolean;
  };
  return browser.confirm?.(message) ?? false;
}

function errorMessage(value: unknown, fallback: string): string {
  if (!isObject(value)) return fallback;
  const error = value.error;
  if (isObject(error) && typeof error.message === 'string') return error.message;
  return fallback;
}

function randomKey(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function dateLabel(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

function dateTimeLabel(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

function addDays(value: string, days: number): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function channelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    isObject(item) && typeof item.type === 'string' ? [item.type.replaceAll('_', ' ')] : [],
  );
}

async function fetchList<T>(path: string, key: string): Promise<T[]> {
  const response = await fetch(path, { credentials: 'include' });
  if (response.status === 403) return [];
  if (!response.ok) throw new Error('The Recruitment records could not be refreshed.');
  const value: unknown = await response.json();
  if (!isObject(value) || !Array.isArray(value[key])) return [];
  return value[key] as T[];
}

async function sendCommand(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': randomKey('recruitment'),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(errorMessage(value, 'The Recruitment command could not be completed.'));
  return value;
}

async function sendDelete(path: string): Promise<unknown> {
  const response = await fetch(path, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Idempotency-Key': randomKey('recruitment') },
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(errorMessage(value, 'The Recruitment command could not be completed.'));
  return value;
}

/** A section's register table, or its empty state when there are no records. */
function Register({
  label,
  empty,
  count,
  head,
  children,
}: {
  label: string;
  empty: string;
  count: number;
  head: ReactNode;
  children: ReactNode;
}) {
  if (count === 0) {
    return (
      <StateSurface compact label={`${label} status`}>
        <p className="m-0">{empty}</p>
      </StateSurface>
    );
  }
  return (
    <>
      <Table aria-label={label} className="min-w-[760px]">
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </Table>
      <TableFooter shown={count} total={count} />
    </>
  );
}

function RecordLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-primary hover:underline"
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Secondary({ children }: { children: ReactNode }) {
  return <span className="block text-caption font-normal text-ink-muted">{children}</span>;
}

function RequestTree({
  records,
  selectedId,
  onSelect,
}: {
  records: RecruitmentRequest[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Register
      label="Requests to Fill"
      empty="No Requests to Fill yet."
      count={records.length}
      head={
        <>
          <Th>Record</Th>
          <Th>Vacancy</Th>
          <Th>Office</Th>
          <Th>Status</Th>
        </>
      }
    >
      {records.map((record) => (
        <Tr key={record.id} selected={selectedId === record.id}>
          <RowHeader>
            <RecordLink onClick={() => onSelect(record.id)}>{record.requestNo}</RecordLink>
          </RowHeader>
          <Td>
            {record.position.itemNumber} · {record.position.title}
            <Secondary>SG {record.position.salaryGrade}</Secondary>
          </Td>
          <Td>{record.position.organizationUnitName}</Td>
          <Td>
            <RecordStatus status={record.status} />
          </Td>
        </Tr>
      ))}
    </Register>
  );
}

function PublicationTree({
  records,
  selectedId,
  onSelect,
}: {
  records: VacancyPublication[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Register
      label="Vacancy Publications"
      empty="No Vacancy Publications yet."
      count={records.length}
      head={
        <>
          <Th>Record</Th>
          <Th>Vacancy</Th>
          <Th kind="date">Posting period</Th>
          <Th>Status</Th>
        </>
      }
    >
      {records.map((record) => (
        <Tr key={record.id} selected={selectedId === record.id}>
          <RowHeader>
            <RecordLink onClick={() => onSelect(record.id)}>{record.publicationNo}</RecordLink>
            <Secondary>{record.requestNo}</Secondary>
          </RowHeader>
          <Td>
            {record.position.itemNumber} · {record.position.title}
          </Td>
          <Td kind="date">
            {dateLabel(record.openingDate)} — {dateLabel(record.closingDate)}
          </Td>
          <Td>
            <RecordStatus status={record.status} />
          </Td>
        </Tr>
      ))}
    </Register>
  );
}

function RequestDraft({
  agencyId,
  positions,
  busy,
  error,
  onError,
  onCreated,
}: {
  agencyId: string;
  positions: PlantillaPositionOption[];
  busy: boolean;
  error: string;
  onError: (message: string) => void;
  onCreated: (record: RecruitmentRequest) => Promise<void>;
}) {
  const vacancies = positions.filter(
    (position) =>
      position.status === 'VACANT' &&
      position.currentVersion?.lifecycleStatus === 'VACANT' &&
      position.currentVersion.employmentCategory === 'PLANTILLA',
  );
  const [positionId, setPositionId] = useState(vacancies[0]?.id ?? '');
  const [justification, setJustification] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const position = vacancies.find((item) => item.id === positionId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!position?.currentVersion || submitting) return;
    setSubmitting(true);
    onError('');
    try {
      const response = await sendCommand(
        `/api/v1/agencies/${agencyId}/recruitment/requests-to-fill`,
        {
          positionId,
          requestingUnitId: position.currentVersion.organizationUnit.id,
          justification,
        },
      );
      if (isObject(response) && typeof response.id === 'string')
        await onCreated(response as unknown as RecruitmentRequest);
    } catch (caught: unknown) {
      onError(caught instanceof Error ? caught.message : 'The request could not be opened.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <GuidedPanel
      title="Open a Request to Fill"
      description="Start only from an authorized, current VACANT Plantilla Position. The server resolves the governing MSP and approval routes during review."
    >
      <form className="grid max-w-[780px] gap-5" onSubmit={submit}>
        <FormError message={error} />
        {vacancies.length === 0 ? (
          <StateSurface compact label="Request to Fill intake status">
            <p className="m-0">No Recruitable Vacancy is available in this Agency Context.</p>
          </StateSurface>
        ) : (
          <>
            <Field label="Recruitable Vacancy" htmlFor="request-position">
              <select
                className={inputClass}
                id="request-position"
                value={positionId}
                onChange={(event) => setPositionId(inputValue(event))}
              >
                {vacancies.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.itemNumber} · {item.currentVersion?.title} ·{' '}
                    {item.currentVersion?.organizationUnit.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Justification" htmlFor="request-justification">
              <textarea
                className={`${inputClass} min-h-28 py-2`}
                id="request-justification"
                required
                value={justification}
                onChange={(event) => setJustification(inputValue(event))}
                placeholder="State the service need for filling this authorized vacancy."
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={busy || submitting || !position} type="submit" variant="primary">
                {busy || submitting ? 'Opening…' : 'Open draft request'}
              </Button>
              <span className="text-caption text-ink-muted">
                The draft remains editable only through Recruitment controls.
              </span>
            </div>
          </>
        )}
      </form>
    </GuidedPanel>
  );
}

function PublicationDraft({
  agencyId,
  displayName,
  requests,
  documents,
  republishSourceId,
  republishRequestToFillId,
  busy,
  error,
  onError,
  onCreated,
}: {
  agencyId: string;
  displayName: string;
  requests: RecruitmentRequest[];
  documents: DocumentOption[];
  republishSourceId: string | null;
  republishRequestToFillId: string | null;
  busy: boolean;
  error: string;
  onError: (message: string) => void;
  onCreated: (record: VacancyPublication) => Promise<void>;
}) {
  const approved = requests.filter((record) => record.status === 'APPROVED');
  const formOptions = documents.filter((document) =>
    /(?:FORM[ _-]*(?:NO[ _-]*)?9|CS[ _-]*FORM[ _-]*9)/i.test(document.documentType),
  );
  const evidenceOptions = documents.filter(
    (document) => document.status !== 'VOIDED' && document.version.issuedAt,
  );
  const today = manilaToday();
  const [requestToFillId, setRequestToFillId] = useState(
    republishRequestToFillId ?? approved[0]?.id ?? '',
  );
  const [formDocumentVersionId, setFormDocumentVersionId] = useState(
    formOptions[0]?.version.id ?? '',
  );
  const [openingDate, setOpeningDate] = useState(today);
  const [closingDate, setClosingDate] = useState(addDays(today, 10));
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [certification, setCertification] = useState('');
  const [republishReason, setRepublishReason] = useState('');
  const [republishAuthorityDocumentVersionId, setRepublishAuthorityDocumentVersionId] = useState(
    evidenceOptions[0]?.version.id ?? '',
  );
  const [submitting, setSubmitting] = useState(false);
  const request = approved.find((record) => record.id === requestToFillId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!request || !formDocumentVersionId || evidenceOptions.length < 5 || submitting) return;
    const evidenceDocumentVersionId = evidenceOptions[0]?.version.id;
    if (!evidenceDocumentVersionId) return;
    setSubmitting(true);
    onError('');
    const path = republishSourceId
      ? `/api/v1/agencies/${agencyId}/recruitment/vacancy-publications/${republishSourceId}/republish`
      : `/api/v1/agencies/${agencyId}/recruitment/vacancy-publications`;
    try {
      const response = await sendCommand(path, {
        requestToFillId,
        formDocumentVersionId,
        openingDate,
        closingDate,
        channels: [
          { type: 'CSC_FIELD_OFFICE', location: 'CSC Field Office' },
          { type: 'CSC_JOB_PORTAL', location: 'CSC Job Portal' },
          { type: 'AGENCY_POSTING_PLACE', location: 'Agency Main Office' },
          { type: 'AGENCY_POSTING_PLACE', location: 'Agency Regional Office' },
          { type: 'AGENCY_POSTING_PLACE', location: 'Agency HRMO Bulletin Board' },
        ],
        positionDetails: {
          positionId: request.position.id,
          itemNumber: request.position.itemNumber,
          title: request.position.title,
          salaryGrade: request.position.salaryGrade,
          qualificationStandardVersionId: request.qualificationStandard.id,
        },
        applicationRequirements: [],
        contactDetails: { name: contactName, email: contactEmail },
        hrmoCertification: { certifier: displayName, statement: certification },
        evidence: [
          {
            channelType: 'CSC_FIELD_OFFICE',
            location: 'CSC Field Office',
            publishedAt: new Date().toISOString(),
            evidenceDocumentVersionId,
          },
          {
            channelType: 'CSC_JOB_PORTAL',
            location: 'CSC Job Portal',
            publishedAt: new Date().toISOString(),
            evidenceDocumentVersionId,
          },
          {
            channelType: 'AGENCY_POSTING_PLACE',
            location: 'Agency Main Office',
            publishedAt: new Date().toISOString(),
            evidenceDocumentVersionId,
          },
          {
            channelType: 'AGENCY_POSTING_PLACE',
            location: 'Agency Regional Office',
            publishedAt: new Date().toISOString(),
            evidenceDocumentVersionId,
          },
          {
            channelType: 'AGENCY_POSTING_PLACE',
            location: 'Agency HRMO Bulletin Board',
            publishedAt: new Date().toISOString(),
            evidenceDocumentVersionId,
          },
        ],
        ...(republishSourceId
          ? {
              reason: republishReason,
              authorityDocumentVersionId: republishAuthorityDocumentVersionId,
            }
          : {}),
      });
      if (isObject(response) && typeof response.id === 'string')
        await onCreated(response as unknown as VacancyPublication);
    } catch (caught: unknown) {
      onError(caught instanceof Error ? caught.message : 'The publication could not be prepared.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <GuidedPanel
      title={republishSourceId ? 'Prepare a linked republication' : 'Prepare a Vacancy Publication'}
      description={
        republishSourceId
          ? 'This creates a new publication version linked to the closed or cancelled source. Fresh dates, channels, evidence, and certification are required.'
          : 'Publication details are versioned. CS Form No. 9, posting dates, channels, evidence, contact details, and HRMO certification are validated again at approval.'
      }
    >
      <form className="grid max-w-[900px] gap-5" onSubmit={submit}>
        <FormError message={error} />
        {approved.length === 0 ? (
          <StateSurface compact label="Vacancy Publication intake status">
            <p className="m-0">
              An approved Request to Fill is required before a publication draft can be prepared.
            </p>
          </StateSurface>
        ) : (
          <>
            <div className="grid gap-4 min-[720px]:grid-cols-2">
              <Field label="Approved Request to Fill" htmlFor="publication-request">
                <select
                  className={inputClass}
                  id="publication-request"
                  value={requestToFillId}
                  onChange={(event) => setRequestToFillId(inputValue(event))}
                >
                  {approved.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.requestNo} · {item.position.itemNumber} · {item.position.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Exact CS Form No. 9 Document Version" htmlFor="publication-form">
                <select
                  className={inputClass}
                  id="publication-form"
                  required
                  value={formDocumentVersionId}
                  onChange={(event) => setFormDocumentVersionId(inputValue(event))}
                >
                  <option value="">Select a finalized form</option>
                  {formOptions.map((document) => (
                    <option key={document.version.id} value={document.version.id}>
                      {document.documentNo ?? document.documentType} · v{document.version.versionNo}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid gap-4 min-[720px]:grid-cols-2">
              <Field label="Opening date" htmlFor="publication-opening">
                <input
                  className={inputClass}
                  id="publication-opening"
                  type="date"
                  required
                  value={openingDate}
                  onChange={(event) => setOpeningDate(inputValue(event))}
                />
              </Field>
              <Field label="Closing date" htmlFor="publication-closing">
                <input
                  className={inputClass}
                  id="publication-closing"
                  type="date"
                  required
                  value={closingDate}
                  onChange={(event) => setClosingDate(inputValue(event))}
                />
              </Field>
            </div>
            <div className="grid gap-4 min-[720px]:grid-cols-2">
              <Field label="HR contact name" htmlFor="publication-contact-name">
                <input
                  className={inputClass}
                  id="publication-contact-name"
                  required
                  value={contactName}
                  onChange={(event) => setContactName(inputValue(event))}
                />
              </Field>
              <Field label="HR contact email" htmlFor="publication-contact-email">
                <input
                  className={inputClass}
                  id="publication-contact-email"
                  required
                  type="email"
                  value={contactEmail}
                  onChange={(event) => setContactEmail(inputValue(event))}
                />
              </Field>
            </div>
            <Field label="HRMO certification" htmlFor="publication-certification">
              <textarea
                className={`${inputClass} min-h-24 py-2`}
                id="publication-certification"
                required
                value={certification}
                onChange={(event) => setCertification(inputValue(event))}
                placeholder="Certify the position details, dates, channels, and evidence."
              />
            </Field>
            {republishSourceId ? (
              <div className="grid gap-4 min-[720px]:grid-cols-2">
                <Field label="Republication basis" htmlFor="publication-republish-reason">
                  <input
                    className={inputClass}
                    id="publication-republish-reason"
                    required
                    value={republishReason}
                    onChange={(event) => setRepublishReason(inputValue(event))}
                    placeholder="Approved basis for the new publication"
                  />
                </Field>
                <Field
                  label="Republication authority document version"
                  htmlFor="publication-republish-authority"
                >
                  <select
                    className={inputClass}
                    id="publication-republish-authority"
                    required
                    value={republishAuthorityDocumentVersionId}
                    onChange={(event) => setRepublishAuthorityDocumentVersionId(inputValue(event))}
                  >
                    <option value="">Select finalized authority evidence</option>
                    {evidenceOptions.map((document) => (
                      <option key={document.version.id} value={document.version.id}>
                        {document.documentNo ?? document.documentType} · v
                        {document.version.versionNo}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : null}
            <div className="grid gap-2 rounded-control border border-info/40 bg-info/5 px-4 py-3 text-caption text-ink">
              <strong className="font-[650] text-ink">Required posting package</strong>
              <span>
                CSC Field Office, CSC Job Portal, and three agency posting places are prepared with
                finalized evidence documents ({evidenceOptions.length} available).
              </span>
              {evidenceOptions.length < 5 ? (
                <span className="font-[650] text-danger">
                  At least five finalized Agency Documents are needed for this guided package.
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={
                  busy ||
                  submitting ||
                  !request ||
                  !formDocumentVersionId ||
                  evidenceOptions.length < 5 ||
                  (Boolean(republishSourceId) &&
                    (!republishReason || !republishAuthorityDocumentVersionId))
                }
                type="submit"
                variant="primary"
              >
                {busy || submitting
                  ? 'Preparing…'
                  : republishSourceId
                    ? 'Prepare linked republication'
                    : 'Prepare draft publication'}
              </Button>
              <span className="text-caption text-ink-muted">
                The publication remains a DRAFT until submitted for approval.
              </span>
            </div>
          </>
        )}
      </form>
    </GuidedPanel>
  );
}

function RequestDetail({
  record,
  agencyId,
  permissions,
  busy,
  onCommand,
}: {
  record: RecruitmentRequest;
  agencyId: string;
  permissions: Permissions;
  busy: boolean;
  onCommand: (path: string, body?: unknown) => Promise<void>;
}) {
  const [rebaselineReason, setRebaselineReason] = useState('');
  const [authorityDocumentVersionId, setAuthorityDocumentVersionId] = useState('');
  return (
    <div className="grid gap-5">
      <GuidedPanel
        title={`${record.requestNo} · ${record.position.title}`}
        description={`${record.position.itemNumber} · ${record.position.organizationUnitName}`}
      >
        <div className="grid gap-4 min-[720px]:grid-cols-2">
          <dl className="m-0">
            <DetailRow label="Status">
              <RecordStatus status={record.status} />
            </DetailRow>
            <DetailRow label="Requesting office">
              {record.requestingUnit.name} ({record.requestingUnit.code})
            </DetailRow>
            <DetailRow label="Qualification Standard">
              {record.qualificationStandard.code} · v{record.qualificationStandard.versionNo} ·{' '}
              {record.qualificationStandard.name}
            </DetailRow>
            <DetailRow label="Submitted">{dateTimeLabel(record.submittedAt)}</DetailRow>
          </dl>
          <dl className="m-0">
            <DetailRow label="Justification">{record.justification}</DetailRow>
            <DetailRow label="Governing binding set">
              {record.governingConfiguration.bindingSetNo} · resolved{' '}
              {dateTimeLabel(record.governingConfiguration.resolvedAt)} · frozen{' '}
              {dateTimeLabel(record.governingConfiguration.frozenAt)}
            </DetailRow>
            <DetailRow label="Approval Request">
              {record.approvalRequestId ?? 'No active Approval Request'}
            </DetailRow>
            <DetailRow label="Bound routes">
              {record.routeBindings
                .filter(
                  (binding) => binding.bindingSetNo === record.governingConfiguration.bindingSetNo,
                )
                .map((binding) => `${binding.checkpointCode} v${binding.routeVersionNo}`)
                .join(' · ') || '—'}
            </DetailRow>
          </dl>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {record.status === 'DRAFT' && permissions.submitRequest ? (
            <Button
              disabled={busy}
              onClick={() =>
                onCommand(
                  `/api/v1/agencies/${agencyId}/recruitment/requests-to-fill/${record.id}/submit`,
                )
              }
              variant="primary"
            >
              Submit for review
            </Button>
          ) : null}
          {record.status === 'SUBMITTED' && permissions.reviewRequest ? (
            <Button
              disabled={busy}
              onClick={() =>
                onCommand(
                  `/api/v1/agencies/${agencyId}/recruitment/requests-to-fill/${record.id}/review`,
                )
              }
              variant="primary"
            >
              Begin controlled review
            </Button>
          ) : null}
          {record.status === 'FOR_REVIEW' && permissions.approveRequest ? (
            <Button
              disabled={busy}
              onClick={() =>
                onCommand(
                  `/api/v1/agencies/${agencyId}/recruitment/requests-to-fill/${record.id}/approve`,
                  {},
                )
              }
              variant="primary"
            >
              Approve request
            </Button>
          ) : null}
          {record.status === 'FOR_REVIEW' && permissions.rejectRequest ? (
            <Button
              disabled={busy}
              onClick={() =>
                onCommand(
                  `/api/v1/agencies/${agencyId}/recruitment/requests-to-fill/${record.id}/reject`,
                  { comments: 'Request rejected during controlled review.' },
                )
              }
              variant="secondary"
            >
              Reject
            </Button>
          ) : null}
          {['DRAFT', 'SUBMITTED'].includes(record.status) && permissions.cancelRequest ? (
            <Button
              disabled={busy}
              onClick={() => {
                if (!confirmAction('Cancel this Request to Fill?')) return;
                void onCommand(
                  `/api/v1/agencies/${agencyId}/recruitment/requests-to-fill/${record.id}/cancel`,
                  { reason: 'Request cancelled by Recruitment.' },
                );
              }}
              variant="secondary"
            >
              Cancel request
            </Button>
          ) : null}
          {record.status === 'APPROVED' && permissions.closeRequest ? (
            <Button
              disabled={busy}
              onClick={() => {
                if (!confirmAction('Close this Request to Fill?')) return;
                void onCommand(
                  `/api/v1/agencies/${agencyId}/recruitment/requests-to-fill/${record.id}/close`,
                  { reason: 'Request closed after Recruitment.' },
                );
              }}
              variant="secondary"
            >
              Close request
            </Button>
          ) : null}
        </div>
      </GuidedPanel>
      {record.status === 'FOR_REVIEW' && permissions.rebaselineRequest ? (
        <GuidedPanel
          title="MSP rebaseline"
          description="This appends a new governing binding set before publication. The former bindings and reason remain in the audit history."
        >
          <div className="grid max-w-[780px] gap-4 min-[720px]:grid-cols-2">
            <Field label="Authority Document Version ID" htmlFor="rebaseline-authority">
              <input
                className={inputClass}
                id="rebaseline-authority"
                required
                value={authorityDocumentVersionId}
                onChange={(event) => setAuthorityDocumentVersionId(inputValue(event))}
                placeholder="UUID of finalized authority evidence"
              />
            </Field>
            <Field label="Reason" htmlFor="rebaseline-reason">
              <input
                className={inputClass}
                id="rebaseline-reason"
                required
                value={rebaselineReason}
                onChange={(event) => setRebaselineReason(inputValue(event))}
                placeholder="Why the governing MSP must be replaced"
              />
            </Field>
          </div>
          <div>
            <Button
              disabled={busy || !authorityDocumentVersionId || !rebaselineReason}
              onClick={() =>
                onCommand(
                  `/api/v1/agencies/${agencyId}/recruitment/requests-to-fill/${record.id}/rebaseline`,
                  { reason: rebaselineReason, authorityDocumentVersionId },
                )
              }
              variant="secondary"
            >
              Record rebaseline
            </Button>
          </div>
        </GuidedPanel>
      ) : null}
      {record.rebaselines.length ? (
        <GuidedPanel
          title="Rebaseline history"
          description="Append-only snapshots of changes made before publication."
        >
          <div className="grid gap-3">
            {record.rebaselines.map((item) => (
              <div
                className="grid gap-1 rounded-control border border-border px-3 py-3 text-caption"
                key={item.id}
              >
                <strong className="text-ink">
                  {dateTimeLabel(item.createdAt)} · {item.reason}
                </strong>
                <span className="text-ink-muted">
                  Authority evidence: {item.authorityDocumentVersionId ?? '—'} · binding set{' '}
                  {record.governingConfiguration.bindingSetNo}
                </span>
              </div>
            ))}
          </div>
        </GuidedPanel>
      ) : null}
    </div>
  );
}

function PublicationDetail({
  record,
  agencyId,
  documents,
  permissions,
  busy,
  onCommand,
  onRepublish,
}: {
  record: VacancyPublication;
  agencyId: string;
  documents: DocumentOption[];
  permissions: Permissions;
  busy: boolean;
  onCommand: (path: string, body?: unknown) => Promise<void>;
  onRepublish: (record: VacancyPublication) => void;
}) {
  const [transitionReason, setTransitionReason] = useState('');
  const [authorityDocumentVersionId, setAuthorityDocumentVersionId] = useState(
    documents.find((document) => document.status !== 'VOIDED' && document.version.issuedAt)?.version
      .id ?? '',
  );
  const authorityDocuments = documents.filter(
    (document) => document.status !== 'VOIDED' && document.version.issuedAt,
  );
  return (
    <div className="grid gap-5">
      <GuidedPanel
        title={`${record.publicationNo} · ${record.position.title}`}
        description={`${record.position.itemNumber} · linked to ${record.requestNo}`}
      >
        <div className="grid gap-4 min-[720px]:grid-cols-2">
          <dl className="m-0">
            <DetailRow label="Status">
              <RecordStatus status={record.status} />
            </DetailRow>
            <DetailRow label="Opening period">
              {dateLabel(record.openingDate)} — {dateLabel(record.closingDate)}
            </DetailRow>
            <DetailRow label="Qualification Standard">
              {record.qualificationStandard.code} · v{record.qualificationStandard.versionNo}
            </DetailRow>
            <DetailRow label="CS Form No. 9 Version">{record.formDocumentVersionId}</DetailRow>
          </dl>
          <dl className="m-0">
            <DetailRow label="Channels">
              {channelNames(record.channels).join(' · ') || '—'}
            </DetailRow>
            <DetailRow label="Posting evidence">
              {record.evidence.length} retained evidence records
            </DetailRow>
            <DetailRow label="Certified">
              {dateTimeLabel(record.certifiedAt)} · {record.certifiedByMembershipId ?? '—'}
            </DetailRow>
            <DetailRow label="Lineage">
              {record.republicationOfId
                ? `Republication of ${record.republicationOfId}`
                : 'Original publication'}
            </DetailRow>
          </dl>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {record.status === 'DRAFT' && permissions.submitPublication ? (
            <Button
              disabled={busy}
              onClick={() =>
                onCommand(
                  `/api/v1/agencies/${agencyId}/recruitment/vacancy-publications/${record.id}/submit`,
                )
              }
              variant="primary"
            >
              Submit for approval
            </Button>
          ) : null}
          {record.status === 'FOR_APPROVAL' && permissions.publishPublication ? (
            <Button
              disabled={busy}
              onClick={() =>
                onCommand(
                  `/api/v1/agencies/${agencyId}/recruitment/vacancy-publications/${record.id}/publish`,
                  {},
                )
              }
              variant="primary"
            >
              Approve and publish
            </Button>
          ) : null}
          {record.status === 'PUBLISHED' && permissions.closePublication ? (
            <Button
              disabled={busy || !transitionReason}
              onClick={() => {
                if (!confirmAction('Close this Vacancy Publication?')) return;
                void onCommand(
                  `/api/v1/agencies/${agencyId}/recruitment/vacancy-publications/${record.id}/close`,
                  {
                    reason: transitionReason,
                    ...(authorityDocumentVersionId ? { authorityDocumentVersionId } : {}),
                  },
                );
              }}
              variant="secondary"
            >
              Close publication
            </Button>
          ) : null}
          {record.status === 'PUBLISHED' && permissions.cancelPublication ? (
            <Button
              disabled={busy || !transitionReason || !authorityDocumentVersionId}
              onClick={() => {
                if (!confirmAction('Cancel this Vacancy Publication?')) return;
                void onCommand(
                  `/api/v1/agencies/${agencyId}/recruitment/vacancy-publications/${record.id}/cancel`,
                  { reason: transitionReason, authorityDocumentVersionId },
                );
              }}
              variant="secondary"
            >
              Cancel publication
            </Button>
          ) : null}
          {(['CLOSED', 'CANCELLED'] as string[]).includes(record.status) &&
          permissions.republishPublication ? (
            <Button disabled={busy} onClick={() => onRepublish(record)} variant="secondary">
              Prepare republication
            </Button>
          ) : null}
        </div>
        {(record.status === 'PUBLISHED' && permissions.closePublication) ||
        (record.status === 'PUBLISHED' && permissions.cancelPublication) ? (
          <div className="grid gap-3 border-t border-border pt-4 min-[720px]:grid-cols-2">
            <Field label="Transition reason" htmlFor="publication-transition-reason">
              <input
                className={inputClass}
                id="publication-transition-reason"
                required
                value={transitionReason}
                onChange={(event) => setTransitionReason(inputValue(event))}
                placeholder="Explain the closure or cancellation"
              />
            </Field>
            <Field
              label="Authority document version (required for cancellation or early closure)"
              htmlFor="publication-transition-authority"
            >
              <select
                className={inputClass}
                id="publication-transition-authority"
                value={authorityDocumentVersionId}
                onChange={(event) => setAuthorityDocumentVersionId(inputValue(event))}
              >
                <option value="">No authority evidence</option>
                {authorityDocuments.map((document) => (
                  <option key={document.version.id} value={document.version.id}>
                    {document.documentNo ?? document.documentType} · v{document.version.versionNo}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : null}
      </GuidedPanel>
      <GuidedPanel
        title="Publication evidence"
        description="Each posting channel keeps its own evidence reference and document version."
      >
        <div className="grid gap-2">
          {record.evidence.length ? (
            record.evidence.map((item) => (
              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border px-3 py-2 text-caption"
                key={item.id}
              >
                <span className="font-[650] text-ink">
                  {item.channelType.replaceAll('_', ' ')} · {item.location}
                </span>
                <span className="text-ink-muted">
                  {dateTimeLabel(item.publishedAt)} ·{' '}
                  {item.evidenceDocumentVersionId ?? 'No evidence version'}
                </span>
              </div>
            ))
          ) : (
            <span className="text-body text-ink-muted">No evidence records.</span>
          )}
        </div>
      </GuidedPanel>
    </div>
  );
}

function ApplicationTree({
  records,
  selectedId,
  onSelect,
}: {
  records: VacancyApplication[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Register
      label="Applications"
      empty="No Applications received yet."
      count={records.length}
      head={
        <>
          <Th>Record</Th>
          <Th>Applicant</Th>
          <Th>Vacancy</Th>
          <Th>Evidence</Th>
          <Th>Standing</Th>
        </>
      }
    >
      {records.map((record) => (
        <Tr key={record.id} selected={selectedId === record.id}>
          <RowHeader>
            <RecordLink onClick={() => onSelect(record.id)}>{record.applicationNo}</RecordLink>
          </RowHeader>
          <Td>
            {record.applicant.fullName}
            {record.applicant.email ? <Secondary>{record.applicant.email}</Secondary> : null}
          </Td>
          <Td>
            {record.position.title}
            <Secondary>{record.publicationNo}</Secondary>
          </Td>
          <Td>{evidenceSummary(record)}</Td>
          <Td>
            <RecordStatus status={record.status} />
          </Td>
        </Tr>
      ))}
    </Register>
  );
}

const KANBAN_COLUMNS = [
  ['RECEIVED', 'Received'],
  ['INCOMPLETE', 'Incomplete'],
  ['QUALIFIED', 'Qualified'],
  ['FOR_ASSESSMENT', 'For assessment'],
  ['FOR_INTERVIEW', 'For interview'],
  ['FOR_DELIBERATION', 'For deliberation'],
  ['RECOMMENDED', 'Recommended'],
  ['NOT_RECOMMENDED', 'Not recommended'],
  ['SELECTED', 'Selected'],
  ['NOT_SELECTED', 'Not selected'],
  ['NOT_QUALIFIED', 'Not qualified'],
  ['WITHDRAWN', 'Withdrawn'],
  ['CLOSED', 'Closed'],
] as const;

function ApplicationKanban({
  records,
  selectedId,
  onSelect,
}: {
  records: VacancyApplication[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto p-4" aria-label="Application board">
      {KANBAN_COLUMNS.map(([status, label]) => {
        const cards = records.filter((record) => record.status === status);
        return (
          <section
            aria-labelledby={`kanban-${status}`}
            className="grid min-w-[230px] flex-1 content-start gap-2 rounded-panel border border-border bg-canvas p-3"
            key={status}
          >
            <h3
              className="m-0 flex items-center justify-between gap-2 text-caption font-[650] text-ink"
              id={`kanban-${status}`}
            >
              {label}
              <span className="text-ink-muted">{cards.length}</span>
            </h3>
            {cards.length === 0 ? (
              <p className="m-0 px-1 py-3 text-caption text-ink-muted">No Applications</p>
            ) : (
              cards.map((record) => (
                <button
                  aria-current={selectedId === record.id ? 'true' : undefined}
                  className="grid cursor-pointer gap-1 rounded-control border border-border bg-surface px-3 py-2.5 text-left hover:border-primary aria-[current=true]:border-primary aria-[current=true]:shadow-[inset_3px_0_0_var(--color-primary)]"
                  key={record.id}
                  type="button"
                  onClick={() => onSelect(record.id)}
                >
                  <span className="text-caption font-[650] text-primary">
                    {record.applicationNo}
                  </span>
                  <strong className="text-small font-[650] text-ink">
                    {record.applicant.fullName}
                  </strong>
                  <span className="text-caption text-ink-muted">
                    {record.position.title} · {evidenceSummary(record)}
                  </span>
                </button>
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

function ApplicationDraft({
  agencyId,
  publications,
  documents,
  busy,
  error,
  onError,
  onCreated,
}: {
  agencyId: string;
  publications: VacancyPublication[];
  documents: DocumentOption[];
  busy: boolean;
  error: string;
  onError: (message: string) => void;
  onCreated: (record: VacancyApplication) => Promise<void>;
}) {
  const open = publications.filter((record) => record.status === 'PUBLISHED');
  const [vacancyPublicationId, setVacancyPublicationId] = useState(open[0]?.id ?? '');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [suffix, setSuffix] = useState('');
  const [email, setEmail] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [privacyNoticeVersion, setPrivacyNoticeVersion] = useState('Privacy Notice v1');
  const [consented, setConsented] = useState(false);
  const [lateAcceptanceReason, setLateAcceptanceReason] = useState('');
  const [lateAuthorityDocumentVersionId, setLateAuthorityDocumentVersionId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const publication = open.find((record) => record.id === vacancyPublicationId);
  const today = manilaToday();
  const beforeOpening = publication !== undefined && today < publication.openingDate;
  const lateAcceptanceRequired = publication !== undefined && today > publication.closingDate;
  const authorityOptions = documents.filter(
    (document) => document.status !== 'VOIDED' && document.version.issuedAt,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!publication || submitting) return;
    setSubmitting(true);
    onError('');
    try {
      const response = await sendCommand(`/api/v1/agencies/${agencyId}/recruitment/applications`, {
        vacancyPublicationId,
        applicant: {
          firstName,
          lastName,
          ...(middleName ? { middleName } : {}),
          ...(suffix ? { suffix } : {}),
          ...(email ? { email } : {}),
          ...(mobileNumber ? { mobileNumber } : {}),
          privacyNoticeVersion,
          consentedAt: new Date().toISOString(),
        },
        ...(lateAcceptanceRequired
          ? {
              lateAcceptanceReason,
              lateAcceptanceAuthorityDocumentVersionId: lateAuthorityDocumentVersionId,
            }
          : {}),
        documents: [],
      });
      if (isObject(response) && typeof response.id === 'string')
        await onCreated(response as unknown as VacancyApplication);
    } catch (caught: unknown) {
      onError(caught instanceof Error ? caught.message : 'The Application could not be recorded.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <GuidedPanel
      title="Record an Application"
      description="Normal intake is accepted only while the Vacancy Publication is open. Intake beyond the period requires an explicit late-handling reason and finalized authority evidence."
    >
      <form className="grid max-w-[900px] gap-5" onSubmit={submit}>
        <FormError message={error} />
        {open.length === 0 ? (
          <StateSurface compact label="Application intake status">
            <p className="m-0">No open Vacancy Publication is available for intake.</p>
          </StateSurface>
        ) : (
          <>
            <Field label="Open Vacancy Publication" htmlFor="application-publication">
              <select
                className={inputClass}
                id="application-publication"
                value={vacancyPublicationId}
                onChange={(event) => setVacancyPublicationId(inputValue(event))}
              >
                {open.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.publicationNo} · {record.position.itemNumber} · {record.position.title}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid gap-4 min-[720px]:grid-cols-2">
              <Field label="First name" htmlFor="application-first-name">
                <input
                  className={inputClass}
                  id="application-first-name"
                  required
                  value={firstName}
                  onChange={(event) => setFirstName(inputValue(event))}
                />
              </Field>
              <Field label="Middle name" htmlFor="application-middle-name">
                <input
                  className={inputClass}
                  id="application-middle-name"
                  value={middleName}
                  onChange={(event) => setMiddleName(inputValue(event))}
                />
              </Field>
              <Field label="Last name" htmlFor="application-last-name">
                <input
                  className={inputClass}
                  id="application-last-name"
                  required
                  value={lastName}
                  onChange={(event) => setLastName(inputValue(event))}
                />
              </Field>
              <Field label="Suffix" htmlFor="application-suffix">
                <input
                  className={inputClass}
                  id="application-suffix"
                  value={suffix}
                  onChange={(event) => setSuffix(inputValue(event))}
                  placeholder="Jr., III, or leave blank"
                />
              </Field>
              <Field label="Email" htmlFor="application-email">
                <input
                  className={inputClass}
                  id="application-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(inputValue(event))}
                />
              </Field>
              <Field label="Mobile number" htmlFor="application-mobile">
                <input
                  className={inputClass}
                  id="application-mobile"
                  value={mobileNumber}
                  onChange={(event) => setMobileNumber(inputValue(event))}
                />
              </Field>
            </div>
            <Field label="Privacy notice version" htmlFor="application-privacy-notice">
              <input
                className={inputClass}
                id="application-privacy-notice"
                required
                value={privacyNoticeVersion}
                onChange={(event) => setPrivacyNoticeVersion(inputValue(event))}
              />
            </Field>
            <label className="flex items-start gap-3 text-small text-ink">
              <input
                checked={consented}
                className="mt-1 h-4 w-4"
                required
                type="checkbox"
                onChange={(event) =>
                  setConsented((event.target as unknown as { checked: boolean }).checked)
                }
              />
              <span>
                The Applicant was given this privacy notice version and consented to its processing.
              </span>
            </label>
            {publication && beforeOpening ? (
              <p className="m-0 rounded-control border border-info/40 bg-info/5 px-4 py-3 text-body text-ink">
                This Vacancy Publication opens on {dateLabel(publication.openingDate)}. Intake is
                not yet accepted.
              </p>
            ) : null}
            {publication && lateAcceptanceRequired ? (
              <div className="grid gap-4 rounded-control border border-warning/40 bg-warning/5 p-4">
                <strong className="text-body font-[650] text-warning">
                  Authorized late handling required
                </strong>
                <p className="m-0 text-caption text-warning">
                  The publication period has elapsed. Record the source-backed basis and finalized
                  authority evidence together.
                </p>
                <Field label="Late handling basis" htmlFor="application-late-reason">
                  <input
                    className={inputClass}
                    id="application-late-reason"
                    required
                    value={lateAcceptanceReason}
                    onChange={(event) => setLateAcceptanceReason(inputValue(event))}
                  />
                </Field>
                <Field
                  label="Late handling authority document version"
                  htmlFor="application-late-authority"
                >
                  <select
                    className={inputClass}
                    id="application-late-authority"
                    required
                    value={lateAuthorityDocumentVersionId}
                    onChange={(event) => setLateAuthorityDocumentVersionId(inputValue(event))}
                  >
                    <option value="">Select finalized authority evidence</option>
                    {authorityOptions.map((document) => (
                      <option key={document.version.id} value={document.version.id}>
                        {document.documentNo ?? document.documentType} · v
                        {document.version.versionNo}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={
                  busy ||
                  submitting ||
                  !publication ||
                  beforeOpening ||
                  !consented ||
                  (lateAcceptanceRequired &&
                    (!lateAcceptanceReason || !lateAuthorityDocumentVersionId))
                }
                type="submit"
                variant="primary"
              >
                {busy || submitting ? 'Recording…' : 'Record Application'}
              </Button>
              <span className="text-caption text-ink-muted">
                Evidence documents are linked on the Application record before screening.
              </span>
            </div>
          </>
        )}
      </form>
    </GuidedPanel>
  );
}

interface AreaEntry {
  area: string;
  result: string;
  evidenceDocumentVersionIds: string[];
  note: string;
}

function ScreeningEditor({
  record,
  agencyId,
  mode,
  canDisqualify,
  busy,
  onCommand,
}: {
  record: VacancyApplication;
  agencyId: string;
  mode: 'screen' | 'correct';
  canDisqualify: boolean;
  busy: boolean;
  onCommand: (path: string, body?: unknown, method?: 'POST' | 'DELETE') => Promise<void>;
}) {
  const source = mode === 'correct' ? record.latestScreening : null;
  const [entries, setEntries] = useState<AreaEntry[]>(() =>
    record.qualificationStandard.applicableAreas.map((area) => {
      const existing = source?.areaResults.find((entry) => entry.area === area);
      return {
        area,
        result: existing?.result ?? 'UNVERIFIED',
        evidenceDocumentVersionIds: existing?.evidenceDocumentVersionIds ?? [],
        note: existing?.note ?? '',
      };
    }),
  );
  const [reason, setReason] = useState(source?.reason ?? '');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionAuthorityDocumentVersionId, setCorrectionAuthorityDocumentVersionId] =
    useState('');
  const authorityOptions = record.documents;
  const derived = derivedScreeningResult(entries, record.qualificationStandard.applicableAreas);

  function updateEntry(area: string, patch: Partial<AreaEntry>) {
    setEntries((current) =>
      current.map((entry) => (entry.area === area ? { ...entry, ...patch } : entry)),
    );
  }

  function toggleEvidence(area: string, documentVersionId: string) {
    setEntries((current) =>
      current.map((entry) => {
        if (entry.area !== area) return entry;
        const selected = entry.evidenceDocumentVersionIds.includes(documentVersionId);
        return {
          ...entry,
          evidenceDocumentVersionIds: selected
            ? entry.evidenceDocumentVersionIds.filter((value) => value !== documentVersionId)
            : [...entry.evidenceDocumentVersionIds, documentVersionId],
        };
      }),
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        {entries.map((entry) => (
          <div className="grid gap-2 rounded-control border border-border p-3" key={entry.area}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-small font-[650] text-ink">{areaLabel(entry.area)}</strong>
              <label className="flex items-center gap-2 text-caption text-ink-muted">
                Result
                <select
                  aria-label={`${areaLabel(entry.area)} result`}
                  className={`${inputClass} min-h-8 w-auto py-1`}
                  value={entry.result}
                  onChange={(event) => updateEntry(entry.area, { result: inputValue(event) })}
                >
                  <option value="MEETS">Meets</option>
                  <option value="DOES_NOT_MEET">Does not meet</option>
                  <option value="UNVERIFIED">Unverified</option>
                </select>
              </label>
            </div>
            {entry.result === 'MEETS' || entry.result === 'DOES_NOT_MEET' ? (
              <div className="grid gap-1">
                <span className="text-caption font-normal text-ink-muted">Evidence</span>
                {record.documents.length === 0 ? (
                  <span className="text-caption text-danger">
                    Link at least one evidence document before assessing this area.
                  </span>
                ) : (
                  record.documents.map((document) => (
                    <label
                      className="flex items-center gap-2 text-caption text-ink"
                      key={document.id}
                    >
                      <input
                        aria-label={`${areaLabel(entry.area)} evidence ${
                          document.documentNo ?? document.documentType
                        }`}
                        checked={entry.evidenceDocumentVersionIds.includes(
                          document.documentVersionId,
                        )}
                        className="h-3.5 w-3.5"
                        type="checkbox"
                        onChange={() => toggleEvidence(entry.area, document.documentVersionId)}
                      />
                      {document.documentNo ?? document.documentType} · v{document.versionNo} ·{' '}
                      {document.purpose.replaceAll('_', ' ')}
                    </label>
                  ))
                )}
              </div>
            ) : null}
            <input
              aria-label={`${areaLabel(entry.area)} note`}
              className={`${inputClass} min-h-8 py-1 text-caption`}
              placeholder="Optional note for this area"
              value={entry.note}
              onChange={(event) => updateEntry(entry.area, { note: inputValue(event) })}
            />
          </div>
        ))}
      </div>
      <div className="grid gap-4 min-[720px]:grid-cols-2">
        <Field label="Screening reason" htmlFor={`application-reason-${mode}`}>
          <input
            className={inputClass}
            id={`application-reason-${mode}`}
            required
            value={reason}
            onChange={(event) => setReason(inputValue(event))}
          />
        </Field>
        {mode === 'correct' ? (
          <Field label="Correction reason" htmlFor="application-correction-reason">
            <input
              className={inputClass}
              id="application-correction-reason"
              required
              value={correctionReason}
              onChange={(event) => setCorrectionReason(inputValue(event))}
            />
          </Field>
        ) : null}
      </div>
      {mode === 'correct' ? (
        <Field
          label="Correction authority evidence (optional)"
          htmlFor="application-correction-authority"
        >
          <select
            className={inputClass}
            id="application-correction-authority"
            value={correctionAuthorityDocumentVersionId}
            onChange={(event) => setCorrectionAuthorityDocumentVersionId(inputValue(event))}
          >
            <option value="">No additional authority evidence</option>
            {authorityOptions.map((document) => (
              <option key={document.documentVersionId} value={document.documentVersionId}>
                {document.documentNo ?? document.documentType} · v{document.versionNo}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={
            busy ||
            !reason ||
            (mode === 'correct' && !correctionReason) ||
            entries.some(
              (entry) =>
                (entry.result === 'MEETS' || entry.result === 'DOES_NOT_MEET') &&
                entry.evidenceDocumentVersionIds.length === 0,
            ) ||
            (derived === 'NOT_QUALIFIED' && !canDisqualify) ||
            !SCREENING_MANAGED_STATUSES.includes(record.status)
          }
          onClick={() => {
            const body = {
              result: derived,
              reason,
              areaResults: entries.map((entry) => ({
                area: entry.area,
                result: entry.result,
                evidenceDocumentVersionIds: entry.evidenceDocumentVersionIds,
                ...(entry.note ? { note: entry.note } : {}),
              })),
              ...(mode === 'correct'
                ? {
                    correctionReason,
                    ...(correctionAuthorityDocumentVersionId
                      ? { correctionAuthorityDocumentVersionId }
                      : {}),
                  }
                : {}),
            };
            const target =
              mode === 'correct' && record.latestScreening
                ? `/api/v1/agencies/${agencyId}/recruitment/applications/${record.id}/screenings/${record.latestScreening.id}/correct`
                : `/api/v1/agencies/${agencyId}/recruitment/applications/${record.id}/screen`;
            void onCommand(target, body);
          }}
          variant="primary"
        >
          {busy ? 'Saving…' : mode === 'correct' ? 'Record correction' : 'Record screening'}
        </Button>
        <span className="text-caption text-ink-muted">
          Recorded outcome: <strong className="text-ink">{derived.replaceAll('_', ' ')}</strong>
          {derived === 'NOT_QUALIFIED' && !canDisqualify
            ? ' · Your Membership cannot record a not-qualified result.'
            : ''}
        </span>
      </div>
    </div>
  );
}

function ApplicationDetail({
  record,
  agencyId,
  membershipId,
  documents,
  sessions,
  decisions,
  permissions,
  busy,
  onCommand,
}: {
  record: VacancyApplication;
  agencyId: string;
  membershipId: string;
  documents: DocumentOption[];
  sessions: BoardSession[];
  decisions: SelectionDecisionRecord[];
  permissions: Permissions;
  busy: boolean;
  onCommand: (path: string, body?: unknown, method?: 'POST' | 'DELETE') => Promise<void>;
}) {
  const [purpose, setPurpose] = useState<string>('EDUCATION');
  const [documentVersionId, setDocumentVersionId] = useState('');
  const [note, setNote] = useState('');
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [withdrawalDocumentVersionId, setWithdrawalDocumentVersionId] = useState('');
  const linkable = documents.filter(
    (document) => document.status !== 'VOIDED' && document.version.issuedAt,
  );
  const editable = SCREENING_MANAGED_STATUSES.includes(record.status);
  const qualification = record.qualificationStandard;
  const requirements: Array<[string, string | null]> = [
    ['Education', qualification.educationRequirement],
    [
      'Training',
      qualification.trainingHoursRequired === null
        ? null
        : `${qualification.trainingHoursRequired} hours`,
    ],
    [
      'Experience',
      qualification.experienceMonthsRequired === null
        ? null
        : `${qualification.experienceMonthsRequired} months`,
    ],
    ['Eligibility', qualification.eligibilityRequirement],
    [
      'Licenses',
      Array.isArray(qualification.licenseRequirements) && qualification.licenseRequirements.length
        ? qualification.licenseRequirements
            .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
            .join(' · ')
        : null,
    ],
    [
      'Competencies',
      Array.isArray(qualification.competencyRequirements) &&
      qualification.competencyRequirements.length
        ? qualification.competencyRequirements
            .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
            .join(' · ')
        : null,
    ],
    ['Special requirements', qualification.specialRequirements],
  ];

  return (
    <div className="grid gap-5">
      <GuidedPanel
        title={`${record.applicationNo} · ${record.applicant.fullName}`}
        description={`${record.position.itemNumber} · ${record.position.title} · ${record.publicationNo}`}
      >
        <div className="grid gap-4 min-[720px]:grid-cols-2">
          <dl className="m-0">
            <DetailRow label="Standing">
              <RecordStatus status={record.status} />
            </DetailRow>
            <DetailRow label="Applicant">
              {record.applicant.fullName}
              {record.applicant.email ? ` · ${record.applicant.email}` : ''}
              {record.applicant.mobileNumber ? ` · ${record.applicant.mobileNumber}` : ''}
            </DetailRow>
            <DetailRow label="Privacy notice">
              {record.applicant.privacyNoticeVersion} · consented{' '}
              {dateTimeLabel(record.applicant.consentedAt)}
            </DetailRow>
            <DetailRow label="Received">{dateTimeLabel(record.receivedAt)}</DetailRow>
          </dl>
          <dl className="m-0">
            <DetailRow label="Publication">
              {record.publicationNo} · {dateLabel(record.openingDate)} —{' '}
              {dateLabel(record.closingDate)}
            </DetailRow>
            <DetailRow label="Bound Qualification Standard">
              {qualification.code} · v{qualification.versionNo} · {qualification.name}
            </DetailRow>
            <DetailRow label="Late acceptance">
              {record.lateAcceptance
                ? `${record.lateAcceptance.reason} · authority ${record.lateAcceptance.authorityDocumentVersionId}`
                : 'Not applicable'}
            </DetailRow>
            <DetailRow label="Lineage">
              {record.withdrawalReason
                ? `Withdrawn: ${record.withdrawalReason}`
                : record.closureReason
                  ? `Closed: ${record.closureReason}`
                  : 'Application retained on the record'}
            </DetailRow>
          </dl>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {record.status === 'INCOMPLETE' && permissions.updateApplication ? (
            <Button
              disabled={busy || !lifecycleReason}
              onClick={() =>
                onCommand(
                  `/api/v1/agencies/${agencyId}/recruitment/applications/${record.id}/reopen`,
                  { reason: lifecycleReason },
                )
              }
              variant="primary"
            >
              Complete application
            </Button>
          ) : null}
          {editable && permissions.withdrawApplication ? (
            <Button
              disabled={busy || !lifecycleReason || !withdrawalDocumentVersionId}
              onClick={() => {
                if (!confirmAction('Withdraw this Application?')) return;
                void onCommand(
                  `/api/v1/agencies/${agencyId}/recruitment/applications/${record.id}/withdraw`,
                  {
                    reason: lifecycleReason,
                    evidenceDocumentVersionId: withdrawalDocumentVersionId,
                  },
                );
              }}
              variant="secondary"
            >
              Withdraw
            </Button>
          ) : null}
          {record.status === 'NOT_QUALIFIED' && permissions.closeApplication ? (
            <Button
              disabled={busy || !lifecycleReason}
              onClick={() => {
                if (!confirmAction('Close this Application?')) return;
                void onCommand(
                  `/api/v1/agencies/${agencyId}/recruitment/applications/${record.id}/close`,
                  { reason: lifecycleReason },
                );
              }}
              variant="secondary"
            >
              Close application
            </Button>
          ) : null}
        </div>
        {editable &&
        (permissions.updateApplication ||
          permissions.withdrawApplication ||
          permissions.closeApplication) ? (
          <div className="grid gap-3 min-[720px]:grid-cols-2">
            <Field label="Lifecycle reason" htmlFor="application-lifecycle-reason">
              <input
                className={inputClass}
                id="application-lifecycle-reason"
                value={lifecycleReason}
                onChange={(event) => setLifecycleReason(inputValue(event))}
                placeholder="Required for reopening, withdrawal, or closure"
              />
            </Field>
            {permissions.withdrawApplication ? (
              <Field
                label="Withdrawal evidence document version"
                htmlFor="application-withdrawal-evidence"
              >
                <select
                  className={inputClass}
                  id="application-withdrawal-evidence"
                  value={withdrawalDocumentVersionId}
                  onChange={(event) => setWithdrawalDocumentVersionId(inputValue(event))}
                >
                  <option value="">Select finalized withdrawal evidence</option>
                  {linkable.map((document) => (
                    <option key={document.version.id} value={document.version.id}>
                      {document.documentNo ?? document.documentType} · v{document.version.versionNo}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>
        ) : null}
      </GuidedPanel>

      <GuidedPanel
        title="Bound Qualification Standard"
        description="Screening compares evidence with this exact Qualification Standard Version bound to the Recruitment Case."
      >
        <div className="grid gap-4 min-[720px]:grid-cols-2">
          <dl className="m-0">
            {requirements.map(([label, value]) => (
              <DetailRow key={label} label={label}>
                {value ?? '—'}
              </DetailRow>
            ))}
          </dl>
          <div className="grid content-start gap-2 text-body text-ink">
            <strong className="text-caption font-normal text-ink-muted">
              Applicable screening areas
            </strong>
            {qualification.applicableAreas.map((area) => (
              <span key={area}>{areaLabel(area)}</span>
            ))}
          </div>
        </div>
      </GuidedPanel>

      <GuidedPanel
        title="Application evidence"
        description="Finalized Agency Document Versions linked to this Application. Evidence cannot be removed once a completed screening cites it."
      >
        <div className="grid gap-2">
          {record.documents.length ? (
            record.documents.map((document) => (
              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border px-3 py-2 text-caption"
                key={document.id}
              >
                <span className="font-[650] text-ink">
                  {document.documentNo ?? document.documentType} · v{document.versionNo} ·{' '}
                  {document.purpose.replaceAll('_', ' ')}
                </span>
                <span className="flex items-center gap-3 text-ink-muted">
                  {dateTimeLabel(document.linkedAt)}
                  {permissions.updateApplication &&
                  (record.status === 'RECEIVED' || record.status === 'INCOMPLETE') ? (
                    <button
                      className="cursor-pointer border-0 bg-transparent p-0 font-[600] text-danger hover:underline"
                      type="button"
                      onClick={() =>
                        void onCommand(
                          `/api/v1/agencies/${agencyId}/recruitment/applications/${record.id}/documents/${document.id}`,
                          undefined,
                          'DELETE',
                        )
                      }
                    >
                      Remove
                    </button>
                  ) : null}
                </span>
              </div>
            ))
          ) : (
            <span className="text-body text-ink-muted">No evidence linked yet.</span>
          )}
        </div>
        {editable && permissions.updateApplication ? (
          <div className="grid gap-3 border-t border-border pt-4 min-[720px]:grid-cols-3">
            <Field label="Purpose" htmlFor="application-document-purpose">
              <select
                className={inputClass}
                id="application-document-purpose"
                value={purpose}
                onChange={(event) => setPurpose(inputValue(event))}
              >
                {APPLICATION_DOCUMENT_PURPOSES.map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Finalized Document Version" htmlFor="application-document-version">
              <select
                className={inputClass}
                id="application-document-version"
                value={documentVersionId}
                onChange={(event) => setDocumentVersionId(inputValue(event))}
              >
                <option value="">Select finalized evidence</option>
                {linkable.map((document) => (
                  <option key={document.version.id} value={document.version.id}>
                    {document.documentNo ?? document.documentType} · v{document.version.versionNo}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Note" htmlFor="application-document-note">
              <input
                className={inputClass}
                id="application-document-note"
                value={note}
                onChange={(event) => setNote(inputValue(event))}
              />
            </Field>
            <div>
              <Button
                disabled={busy || !documentVersionId}
                onClick={() =>
                  onCommand(
                    `/api/v1/agencies/${agencyId}/recruitment/applications/${record.id}/documents`,
                    {
                      documentVersionId,
                      purpose,
                      ...(note ? { note } : {}),
                    },
                  )
                }
                variant="secondary"
              >
                Link evidence
              </Button>
            </div>
          </div>
        ) : null}
      </GuidedPanel>

      <GuidedPanel
        title="Qualification screening"
        description="Assess each applicable area against the bound standard. The recorded outcome follows from the area results and requires supporting evidence; completed results are never overwritten."
      >
        {record.latestScreening ? (
          <div className="grid gap-3 border-b border-border pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <RecordStatus status={record.latestScreening.result} />
              <span className="text-caption text-ink-muted">
                v{record.latestScreening.versionNo} ·{' '}
                {dateTimeLabel(record.latestScreening.screenedAt)}
              </span>
            </div>
            <p className="m-0 text-body text-ink">{record.latestScreening.reason}</p>
            <div className="grid gap-1">
              {record.latestScreening.areaResults.map((entry) => (
                <span className="text-caption text-ink-muted" key={entry.area}>
                  <strong className="text-ink">{areaLabel(entry.area)}</strong>{' '}
                  {entry.result.replaceAll('_', ' ')}
                  {entry.evidenceDocumentVersionIds.length
                    ? ` · ${entry.evidenceDocumentVersionIds.length} evidence document(s)`
                    : ''}
                  {entry.note ? ` · ${entry.note}` : ''}
                </span>
              ))}
            </div>
            {record.latestScreening.correctionReason ? (
              <span className="text-caption text-warning">
                Correction basis: {record.latestScreening.correctionReason}
              </span>
            ) : null}
          </div>
        ) : (
          <p className="m-0 border-b border-border pb-4 text-body text-ink-muted">
            No screening result recorded yet.
          </p>
        )}
        {permissions.screenApplication && editable ? (
          <ScreeningEditor
            agencyId={agencyId}
            canDisqualify={permissions.disqualifyApplication}
            key={record.latestScreening?.id ?? 'new-screening'}
            record={record}
            mode={record.latestScreening ? 'correct' : 'screen'}
            busy={busy}
            onCommand={onCommand}
          />
        ) : null}
      </GuidedPanel>

      {record.screenings.length > 1 ? (
        <GuidedPanel
          title="Screening history"
          description="Every completed result is preserved. Corrections append a linked replacement version."
        >
          <div className="grid gap-3">
            {record.screenings
              .slice(0, -1)
              .reverse()
              .map((screening) => (
                <div
                  className="grid gap-1 rounded-control border border-border px-3 py-3 text-caption"
                  key={screening.id}
                >
                  <strong className="text-ink">
                    v{screening.versionNo} · {screening.result.replaceAll('_', ' ')} ·{' '}
                    {dateTimeLabel(screening.screenedAt)}
                  </strong>
                  <span className="text-ink-muted">{screening.reason}</span>
                </div>
              ))}
          </div>
        </GuidedPanel>
      ) : null}

      <RecruitmentEvaluationPanels
        record={record}
        agencyId={agencyId}
        membershipId={membershipId}
        documents={documents}
        canManageAssessments={permissions.manageAssessments}
        canManageInterviews={permissions.manageInterviews}
        busy={busy}
        onCommand={onCommand}
      />

      <ApplicationBoardPanel
        record={record}
        sessions={sessions}
        decisions={decisions}
        documents={documents}
        permissions={permissions}
        busy={busy}
        onCommand={onCommand}
        agencyId={agencyId}
      />
    </div>
  );
}

function ApplicationBoardPanel({
  record,
  sessions,
  decisions,
  documents,
  permissions,
  busy,
  onCommand,
  agencyId,
}: {
  record: VacancyApplication;
  sessions: BoardSession[];
  decisions: SelectionDecisionRecord[];
  documents: DocumentOption[];
  permissions: Permissions;
  busy: boolean;
  onCommand: (path: string, body?: unknown, method?: 'POST' | 'DELETE') => Promise<void>;
  agencyId: string;
}) {
  const related = sessions.filter((session) => session.publicationId === record.publicationId);
  const recordDecisions = decisions
    .filter((decision) => decision.applicationId === record.id)
    .sort((left, right) => right.decidedAt.localeCompare(left.decidedAt));
  const latestDecision = recordDecisions[0] ?? null;
  const canAct =
    record.status === 'RECOMMENDED' && (permissions.selectCandidate || permissions.decideSelection);
  if (related.length === 0 && !latestDecision) {
    return (
      <GuidedPanel
        title="HRMPSB deliberation"
        description="This Application is included in the board process when deliberation starts."
      >
        <p className="m-0 text-body text-ink-muted">
          No Selection Board Session or Selection Decision references this Application yet.
        </p>
      </GuidedPanel>
    );
  }
  return (
    <GuidedPanel
      title="HRMPSB deliberation"
      description="Participation, conflict declarations, quorum, and the advisory recommendation for this Application. The Board Recommendation is advisory; the Selection Decision is separate."
    >
      <div className="grid gap-4">
        {related.map((session) => {
          const quorum = session.quorum.find((entry) => entry.applicationId === record.id) ?? null;
          const recommendation =
            session.recommendations.find((entry) => entry.applicationId === record.id) ?? null;
          const conflicts = session.conflicts.filter(
            (conflict) => conflict.applicationId === record.id,
          );
          return (
            <div
              className="grid gap-3 rounded-control border border-border px-4 py-4"
              key={session.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-body font-[650] text-ink">
                  {session.requestNo} · {dateLabel(session.sessionDate)} · {session.boardCode} v
                  {session.boardVersionNo}
                </strong>
                <RecordStatus status={session.status} />
              </div>
              <span className="text-caption text-ink-muted">
                Eligible participation:{' '}
                {quorum
                  ? `${quorum.presentVotingMembers} of ${quorum.eligibleVotingMembers} present · requires ${quorum.requiredVotingMembers} · national floor ${quorum.nationalFloor} of ${quorum.votingSeats} voting seats`
                  : 'quorum not yet frozen'}
                {quorum ? ` · ${quorum.satisfied ? 'satisfied' : 'not satisfied'}` : ''}
              </span>
              <div className="grid gap-1">
                {session.roster.map((member) => {
                  const conflict = conflicts.find(
                    ({ membershipId }) => membershipId === member.membershipId,
                  );
                  const participation = session.participations.find(
                    ({ membershipId }) => membershipId === member.membershipId,
                  );
                  return (
                    <span className="text-caption text-ink-muted" key={member.id}>
                      <strong className="text-ink">{member.memberName}</strong> · {member.seatCode}{' '}
                      · {member.isAlternate ? 'Alternate' : 'Principal'} ·{' '}
                      {participation?.attendanceStatus ?? 'Not recorded'}
                      {conflict
                        ? ` · ${conflict.hasConflict ? 'Conflicted (excluded)' : 'No conflict declared'}`
                        : ''}
                    </span>
                  );
                })}
              </div>
              {recommendation ? (
                <span className="text-body text-ink">
                  Board Recommendation: {recommendation.recommendation.replaceAll('_', ' ')}
                  {recommendation.rankNo ? ` · rank ${recommendation.rankNo}` : ''}
                  {recommendation.reason ? ` · ${recommendation.reason}` : ''}
                </span>
              ) : (
                <span className="text-caption text-ink-muted">
                  No Board Recommendation recorded yet.
                </span>
              )}
            </div>
          );
        })}

        {latestDecision ? (
          <div className="grid gap-2 rounded-control border border-border px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-body font-[650] text-ink">Selection Decision</strong>
              <RecordStatus status={latestDecision.decision} />
            </div>
            <span className="text-body text-ink">{latestDecision.reason}</span>
            <span className="text-caption text-ink-muted">
              {dateTimeLabel(latestDecision.decidedAt)}
              {latestDecision.handoff
                ? ` · Plantilla Position ${latestDecision.handoff.itemNumber} reserved and handed to Appointment`
                : ''}
            </span>
          </div>
        ) : null}

        {canAct ? (
          <AuthorityActionPanel
            applicationId={record.id}
            canSelect={permissions.selectCandidate}
            canDecide={permissions.decideSelection}
            documents={documents}
            busy={busy}
            onCommand={onCommand}
            agencyId={agencyId}
          />
        ) : null}
      </div>
    </GuidedPanel>
  );
}

function AuthorityActionPanel({
  applicationId,
  canSelect,
  canDecide,
  documents,
  busy,
  onCommand,
  agencyId,
}: {
  applicationId: string;
  canSelect: boolean;
  canDecide: boolean;
  documents: DocumentOption[];
  busy: boolean;
  onCommand: (path: string, body?: unknown, method?: 'POST' | 'DELETE') => Promise<void>;
  agencyId: string;
}) {
  const [decision, setDecision] = useState(canSelect ? 'SELECTED' : 'NOT_SELECTED');
  const [reason, setReason] = useState('');
  const [authorityDocumentVersionId, setAuthorityDocumentVersionId] = useState('');
  const linkable = documents.filter(
    (document) => document.status !== 'VOIDED' && document.version.issuedAt,
  );
  return (
    <div className="grid gap-4 rounded-control border border-border bg-canvas px-4 py-4 min-[900px]:grid-cols-2">
      <div className="min-[900px]:col-span-2">
        <strong className="text-body font-[650] text-ink">Appointing authority action</strong>
        <p className="m-0 text-caption text-ink-muted">
          Selection does not issue an Appointment or establish service. A no-selection decision can
          be closed afterwards; a returned board output reopens deliberation.
        </p>
      </div>
      <Field label="Decision" htmlFor={`application-decision-${applicationId}`}>
        <select
          className={inputClass}
          id={`application-decision-${applicationId}`}
          value={decision}
          onChange={(event) => setDecision(inputValue(event))}
        >
          {canSelect ? <option value="SELECTED">Select</option> : null}
          {canDecide ? (
            <>
              <option value="NOT_SELECTED">No selection</option>
              <option value="RETURNED">Return for further review</option>
            </>
          ) : null}
        </select>
      </Field>
      <Field label="Recorded basis" htmlFor={`application-decision-reason-${applicationId}`}>
        <input
          className={inputClass}
          id={`application-decision-reason-${applicationId}`}
          value={reason}
          onChange={(event) => setReason(inputValue(event))}
        />
      </Field>
      <Field
        label="Appointing authority evidence"
        htmlFor={`application-decision-authority-${applicationId}`}
      >
        <select
          className={inputClass}
          id={`application-decision-authority-${applicationId}`}
          value={authorityDocumentVersionId}
          onChange={(event) => setAuthorityDocumentVersionId(inputValue(event))}
        >
          <option value="">Select finalized authority evidence</option>
          {linkable.map((document) => (
            <option key={document.version.id} value={document.version.id}>
              {document.documentNo ?? document.documentType} · v{document.version.versionNo}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex items-end">
        <Button
          disabled={busy || !reason || (decision === 'SELECTED' && !authorityDocumentVersionId)}
          onClick={() =>
            onCommand(
              `/api/v1/agencies/${agencyId}/recruitment/applications/${applicationId}/selection-decision`,
              {
                decision,
                reason,
                ...(decision === 'SELECTED' ? { authorityDocumentVersionId } : {}),
              },
            )
          }
          variant="primary"
        >
          Record Selection Decision
        </Button>
      </div>
    </div>
  );
}

function SessionTree({
  records,
  selectedId,
  onSelect,
}: {
  records: BoardSession[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Register
      label="HRMPSB Sessions"
      empty="No HRMPSB Session has been convened yet."
      count={records.length}
      head={
        <>
          <Th>Record</Th>
          <Th>Vacancy</Th>
          <Th>Roster</Th>
          <Th kind="numeric">Applicants</Th>
          <Th>Standing</Th>
        </>
      }
    >
      {records.map((record) => (
        <Tr key={record.id} selected={selectedId === record.id}>
          <RowHeader>
            <RecordLink onClick={() => onSelect(record.id)}>
              {record.requestNo} · {dateLabel(record.sessionDate)}
            </RecordLink>
            <Secondary>
              {record.boardCode} v{record.boardVersionNo}
            </Secondary>
          </RowHeader>
          <Td>
            {record.publicationNo}
            <Secondary>
              {record.position.itemNumber} · {record.position.title ?? '—'}
            </Secondary>
          </Td>
          <Td>
            {record.roster.length} member{record.roster.length === 1 ? '' : 's'}
            <Secondary>{record.participations.length} participation recorded</Secondary>
          </Td>
          <Td kind="numeric">{record.quorum.length}</Td>
          <Td>
            <RecordStatus status={record.status} />
          </Td>
        </Tr>
      ))}
    </Register>
  );
}

function SelectionDecisionTree({
  records,
  selectedId,
  onSelect,
}: {
  records: SelectionDecisionRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Register
      label="Selection Decisions"
      empty="No Selection Decision has been recorded yet."
      count={records.length}
      head={
        <>
          <Th>Record</Th>
          <Th>Application</Th>
          <Th>Vacancy</Th>
          <Th>Basis</Th>
          <Th>Standing</Th>
        </>
      }
    >
      {records.map((record) => (
        <Tr key={record.id} selected={selectedId === record.id}>
          <RowHeader>
            <RecordLink onClick={() => onSelect(record.id)}>
              {record.applicationNo} · {dateLabel(record.decidedAt)}
            </RecordLink>
            <Secondary>
              {record.boardDefinitionCode} v{record.boardDefinitionVersionNo}
            </Secondary>
          </RowHeader>
          <Td>{record.applicantName}</Td>
          <Td>
            {record.position.itemNumber}
            <Secondary>{record.position.title ?? '—'}</Secondary>
          </Td>
          <Td>
            {record.reason}
            {record.handoff ? (
              <Secondary>Handed off {dateTimeLabel(record.handoff.handedOffAt)}</Secondary>
            ) : null}
          </Td>
          <Td>
            <RecordStatus status={record.decision} />
          </Td>
        </Tr>
      ))}
    </Register>
  );
}

function SessionDraft({
  agencyId,
  publications,
  busy,
  error,
  onError,
  onCreated,
}: {
  agencyId: string;
  publications: VacancyPublication[];
  busy: boolean;
  error: string;
  onError: (message: string) => void;
  onCreated: (record: BoardSession) => Promise<void>;
}) {
  const eligible = publications.filter((record) => record.status === 'PUBLISHED');
  const [vacancyPublicationId, setVacancyPublicationId] = useState(eligible[0]?.id ?? '');
  const [sessionDate, setSessionDate] = useState(manilaToday());
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vacancyPublicationId || submitting) return;
    setSubmitting(true);
    onError('');
    try {
      const response = await sendCommand(`/api/v1/agencies/${agencyId}/recruitment/sessions`, {
        vacancyPublicationId,
        sessionDate,
      });
      if (isObject(response) && typeof response.id === 'string')
        await onCreated(response as unknown as BoardSession);
    } catch (caught: unknown) {
      onError(
        caught instanceof Error ? caught.message : 'The HRMPSB Session could not be convened.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <GuidedPanel
      title="Convene an HRMPSB Session"
      description="The bound Board Definition and its effective Board Appointments are resolved server-side. The roster snapshot is frozen when deliberation begins."
    >
      <form className="grid max-w-[900px] gap-5" onSubmit={submit}>
        <FormError message={error} />
        {eligible.length === 0 ? (
          <StateSurface compact label="HRMPSB Session intake status">
            <p className="m-0">No published Vacancy Publication is available for deliberation.</p>
          </StateSurface>
        ) : (
          <>
            <Field label="Published vacancy" htmlFor="session-publication">
              <select
                className={inputClass}
                id="session-publication"
                value={vacancyPublicationId}
                onChange={(event) => setVacancyPublicationId(inputValue(event))}
              >
                {eligible.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.publicationNo} · {record.position.itemNumber} · {record.position.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Session date" htmlFor="session-date">
              <input
                className={inputClass}
                id="session-date"
                required
                type="date"
                value={sessionDate}
                onChange={(event) => setSessionDate(inputValue(event))}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={busy || submitting || !vacancyPublicationId}
                type="submit"
                variant="primary"
              >
                {busy || submitting ? 'Convening…' : 'Convene Session'}
              </Button>
              <span className="text-caption text-ink-muted">
                Participant attendance and conflict declarations are recorded on the draft Session.
              </span>
            </div>
          </>
        )}
      </form>
    </GuidedPanel>
  );
}

function RecommendationEditor({
  record,
  applicationId,
  busy,
  onCommand,
  agencyId,
}: {
  record: BoardSession;
  applicationId: string;
  busy: boolean;
  onCommand: (path: string, body?: unknown, method?: 'POST' | 'DELETE') => Promise<void>;
  agencyId: string;
}) {
  const [rankNo, setRankNo] = useState('1');
  const [recommendation, setRecommendation] = useState('RECOMMENDED');
  const [reason, setReason] = useState('');
  return (
    <div className="grid gap-3 min-[720px]:grid-cols-[140px_180px_1fr_auto]">
      <Field label="Rank" htmlFor={`recommendation-rank-${applicationId}`}>
        <input
          className={inputClass}
          id={`recommendation-rank-${applicationId}`}
          min={1}
          type="number"
          value={rankNo}
          onChange={(event) => setRankNo(inputValue(event))}
        />
      </Field>
      <Field label="Recommendation" htmlFor={`recommendation-value-${applicationId}`}>
        <select
          className={inputClass}
          id={`recommendation-value-${applicationId}`}
          value={recommendation}
          onChange={(event) => setRecommendation(inputValue(event))}
        >
          <option value="RECOMMENDED">Recommended</option>
          <option value="NOT_RECOMMENDED">Not recommended</option>
        </select>
      </Field>
      <Field label="Board reason" htmlFor={`recommendation-reason-${applicationId}`}>
        <input
          className={inputClass}
          id={`recommendation-reason-${applicationId}`}
          value={reason}
          onChange={(event) => setReason(inputValue(event))}
        />
      </Field>
      <div className="flex items-end">
        <Button
          disabled={busy || (recommendation === 'NOT_RECOMMENDED' && !reason)}
          onClick={() =>
            onCommand(
              `/api/v1/agencies/${agencyId}/recruitment/sessions/${record.id}/recommendations`,
              {
                applicationId,
                recommendation,
                rankNo: Number(rankNo) || 1,
                ...(reason ? { reason } : {}),
              },
            )
          }
          variant="primary"
        >
          Record
        </Button>
      </div>
    </div>
  );
}

function ApplicantDeliberationPanel({
  record,
  applications,
  permissions,
  busy,
  onCommand,
  agencyId,
}: {
  record: BoardSession;
  applications: VacancyApplication[];
  permissions: Permissions;
  busy: boolean;
  onCommand: (path: string, body?: unknown, method?: 'POST' | 'DELETE') => Promise<void>;
  agencyId: string;
}) {
  const frozen = record.status === 'IN_PROGRESS' || record.status === 'COMPLETED';
  const recommendationFor = (applicationId: string) =>
    record.recommendations.find((entry) => entry.applicationId === applicationId) ?? null;
  return (
    <div className="grid gap-4">
      {record.quorum.length === 0 ? (
        <p className="m-0 text-body text-ink-muted">
          Applicant-specific quorum is frozen when deliberation starts.
        </p>
      ) : (
        record.quorum.map((quorum) => {
          const recommendation = recommendationFor(quorum.applicationId);
          return (
            <div
              className="grid gap-3 rounded-control border border-border px-4 py-4"
              key={quorum.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-body font-[650] text-ink">
                  {quorum.applicationNo} · {quorum.applicantName}
                </strong>
                <RecordStatus status={quorum.applicationStatus} />
              </div>
              <span className="text-caption text-ink-muted">
                {quorum.presentVotingMembers} of {quorum.eligibleVotingMembers} eligible voting
                members present · requires {quorum.requiredVotingMembers} · national floor{' '}
                {quorum.nationalFloor} of {quorum.votingSeats} voting seats ·{' '}
                {quorum.satisfied ? 'quorum satisfied' : 'quorum not satisfied'}
              </span>
              {recommendation ? (
                <span className="text-body text-ink">
                  Board Recommendation: {recommendation.recommendation.replaceAll('_', ' ')}
                  {recommendation.rankNo ? ` · rank ${recommendation.rankNo}` : ''}
                  {recommendation.reason ? ` · ${recommendation.reason}` : ''}
                  <span className="block text-caption text-ink-muted">
                    Advisory only. The Selection Decision is separate.
                  </span>
                </span>
              ) : frozen && permissions.recommendBoard ? (
                <RecommendationEditor
                  record={record}
                  applicationId={quorum.applicationId}
                  busy={busy}
                  onCommand={onCommand}
                  agencyId={agencyId}
                />
              ) : (
                <span className="text-caption text-ink-muted">
                  No Board Recommendation recorded for this Application yet.
                </span>
              )}
            </div>
          );
        })
      )}
      {!frozen && permissions.submitDeliberations ? (
        <p className="m-0 text-caption text-ink-muted">
          {applications.length} qualified Application(s) are included when deliberation starts.
        </p>
      ) : null}
    </div>
  );
}

function SessionDetail({
  record,
  applications,
  documents,
  permissions,
  busy,
  onCommand,
  agencyId,
}: {
  record: BoardSession;
  applications: VacancyApplication[];
  documents: DocumentOption[];
  permissions: Permissions;
  busy: boolean;
  onCommand: (path: string, body?: unknown, method?: 'POST' | 'DELETE') => Promise<void>;
  agencyId: string;
}) {
  const publicationApplications = applications.filter(
    (application) => application.publicationId === record.publicationId,
  );
  const [attendance, setAttendance] = useState<Record<string, string>>({});
  const [conflictParticipationId, setConflictParticipationId] = useState('');
  const [conflictApplicationId, setConflictApplicationId] = useState('');
  const [conflictValue, setConflictValue] = useState('true');
  const [conflictDetails, setConflictDetails] = useState('');
  const [reportDocumentVersionId, setReportDocumentVersionId] = useState('');
  const [reportReason, setReportReason] = useState('');
  const [minutesDocumentVersionId, setMinutesDocumentVersionId] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const linkable = documents.filter(
    (document) => document.status !== 'VOIDED' && document.version.issuedAt,
  );
  const participationFor = (membershipId: string) =>
    record.participations.find((entry) => entry.membershipId === membershipId) ?? null;
  const draft = record.status === 'DRAFT';

  return (
    <div className="grid gap-5">
      <GuidedPanel
        title={`HRMPSB Session · ${record.requestNo}`}
        description={`${record.sessionDate} · ${record.boardCode} v${record.boardVersionNo} · ${record.publicationNo}`}
      >
        <div className="grid gap-4 min-[720px]:grid-cols-2">
          <dl className="m-0">
            <DetailRow label="Standing">
              <RecordStatus status={record.status} />
            </DetailRow>
            <DetailRow label="Vacancy">
              {record.position.itemNumber} · {record.position.title ?? '—'} ·{' '}
              {dateLabel(record.openingDate)} — {dateLabel(record.closingDate)}
            </DetailRow>
            <DetailRow label="Roster frozen">
              {record.rosterFrozenAt ? dateTimeLabel(record.rosterFrozenAt) : 'Not yet frozen'}
            </DetailRow>
          </dl>
          <dl className="m-0">
            <DetailRow label="Deliberated applications">{record.quorum.length}</DetailRow>
            <DetailRow label="Recommendations">{record.recommendations.length}</DetailRow>
            <DetailRow label="Evaluation report">
              {record.reports.length
                ? `v${record.reports[record.reports.length - 1]?.versionNo} · ${dateTimeLabel(
                    record.reports[record.reports.length - 1]?.issuedAt ?? null,
                  )}`
                : 'Not issued'}
            </DetailRow>
            <DetailRow label="Minutes">{record.minutesDocumentVersionId ?? 'Not linked'}</DetailRow>
            {record.cancellationReason ? (
              <DetailRow label="Cancellation">{record.cancellationReason}</DetailRow>
            ) : null}
          </dl>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {draft && permissions.submitDeliberations ? (
            <Button
              disabled={busy}
              onClick={() =>
                onCommand(
                  `/api/v1/agencies/${agencyId}/recruitment/sessions/${record.id}/start`,
                  {},
                )
              }
              variant="primary"
            >
              Start deliberation
            </Button>
          ) : null}
        </div>
      </GuidedPanel>

      <Panel title="Roster and attendance" flush>
        <p className="m-0 px-4 pt-3 text-small text-ink-muted">
          The roster snapshot copies each Board Appointment, seat, and voting standing. One person
          cannot hold two voting seats or act as both voting member and secretariat. Attendance is
          recorded before deliberation begins.
        </p>
        <Table aria-label="Roster and attendance" className="mt-3 min-w-[720px]">
          <thead>
            <tr>
              <Th>Member</Th>
              <Th>Seat</Th>
              <Th>Role</Th>
              <Th>Appointment</Th>
              <Th>Attendance</Th>
            </tr>
          </thead>
          <tbody>
            {record.roster.map((member) => {
              const participation = participationFor(member.membershipId);
              return (
                <Tr key={member.id}>
                  <RowHeader>
                    {member.memberName}
                    {participation?.signedAt ? (
                      <Secondary>Acknowledged {dateTimeLabel(participation.signedAt)}</Secondary>
                    ) : null}
                  </RowHeader>
                  <Td>{member.seatCode}</Td>
                  <Td>
                    {member.boardRole.replaceAll('_', ' ')}
                    {member.isVoting ? '' : ' · non-voting'}
                  </Td>
                  <Td>{member.isAlternate ? 'Alternate' : 'Principal'}</Td>
                  <Td>
                    {participation ? (
                      <RecordStatus status={participation.attendanceStatus} />
                    ) : draft && permissions.submitDeliberations ? (
                      <span className="flex items-center gap-2">
                        <select
                          aria-label={`Attendance for ${member.memberName}`}
                          className={inputClass}
                          value={attendance[member.id] ?? 'PRESENT'}
                          onChange={(event) =>
                            setAttendance((current) => ({
                              ...current,
                              [member.id]: inputValue(event),
                            }))
                          }
                        >
                          {BOARD_ATTENDANCE_STATUSES.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            onCommand(
                              `/api/v1/agencies/${agencyId}/recruitment/sessions/${record.id}/participation`,
                              {
                                rosterSnapshotMemberId: member.id,
                                attendanceStatus: attendance[member.id] ?? 'PRESENT',
                              },
                            )
                          }
                          variant="secondary"
                        >
                          Record
                        </Button>
                      </span>
                    ) : (
                      <span className="text-caption text-ink-muted">Not recorded</span>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
        <p className="m-0 px-4 py-2.5 text-caption text-ink-muted">
          An alternate counts only through their own recorded participation and declaration.
        </p>
      </Panel>

      <GuidedPanel
        title="Conflict declarations and recusals"
        description="A conflicted or recused participant is excluded from the affected applicant's evaluation and quorum."
      >
        <div className="grid gap-3">
          {record.conflicts.length === 0 ? (
            <span className="text-body text-ink-muted">No conflict declaration recorded.</span>
          ) : (
            record.conflicts.map((conflict) => (
              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border px-3 py-2 text-caption"
                key={conflict.id}
              >
                <span className="font-[650] text-ink">
                  {record.roster.find(({ membershipId }) => membershipId === conflict.membershipId)
                    ?.memberName ?? conflict.membershipId}{' '}
                  ·{' '}
                  {record.quorum.find(
                    ({ applicationId }) => applicationId === conflict.applicationId,
                  )?.applicationNo ?? conflict.applicationId}{' '}
                  · {conflict.hasConflict ? 'Conflicted' : 'No conflict'}
                </span>
                <span className="text-ink-muted">{conflict.details ?? ''}</span>
              </div>
            ))
          )}
          {draft && (permissions.recommendBoard || permissions.submitDeliberations) ? (
            <div className="grid gap-3 border-t border-border pt-4 min-[900px]:grid-cols-2">
              <Field label="Participant" htmlFor="conflict-participation">
                <select
                  className={inputClass}
                  id="conflict-participation"
                  value={conflictParticipationId}
                  onChange={(event) => setConflictParticipationId(inputValue(event))}
                >
                  <option value="">Select a recorded participant</option>
                  {record.participations.map((participation) => (
                    <option key={participation.id} value={participation.id}>
                      {record.roster.find(
                        ({ membershipId }) => membershipId === participation.membershipId,
                      )?.memberName ?? participation.membershipId}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Applicant" htmlFor="conflict-application">
                <select
                  className={inputClass}
                  id="conflict-application"
                  value={conflictApplicationId}
                  onChange={(event) => setConflictApplicationId(inputValue(event))}
                >
                  <option value="">Select an Application</option>
                  {publicationApplications.map((application) => (
                    <option key={application.id} value={application.id}>
                      {application.applicationNo} · {application.applicant.fullName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Declaration" htmlFor="conflict-value">
                <select
                  className={inputClass}
                  id="conflict-value"
                  value={conflictValue}
                  onChange={(event) => setConflictValue(inputValue(event))}
                >
                  <option value="true">Has a conflict of interest</option>
                  <option value="false">No conflict of interest</option>
                </select>
              </Field>
              <Field label="Details" htmlFor="conflict-details">
                <input
                  className={inputClass}
                  id="conflict-details"
                  value={conflictDetails}
                  onChange={(event) => setConflictDetails(inputValue(event))}
                />
              </Field>
              <div>
                <Button
                  disabled={busy || !conflictParticipationId || !conflictApplicationId}
                  onClick={() =>
                    onCommand(
                      `/api/v1/agencies/${agencyId}/recruitment/sessions/${record.id}/conflicts`,
                      {
                        participationId: conflictParticipationId,
                        applicationId: conflictApplicationId,
                        hasConflict: conflictValue === 'true',
                        ...(conflictDetails ? { details: conflictDetails } : {}),
                      },
                    )
                  }
                  variant="secondary"
                >
                  Declare
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </GuidedPanel>

      <GuidedPanel
        title="Applicant deliberations"
        description="Quorum is validated per Application. Board Recommendations remain advisory and distinct from the Selection Decision."
      >
        <ApplicantDeliberationPanel
          record={record}
          applications={publicationApplications}
          permissions={permissions}
          busy={busy}
          onCommand={onCommand}
          agencyId={agencyId}
        />
      </GuidedPanel>

      {record.status === 'IN_PROGRESS' && permissions.submitDeliberations ? (
        <GuidedPanel
          title="Board output"
          description="Issue the versioned Comprehensive Candidate Evaluation Report, link the minutes, and complete the Session."
        >
          <div className="grid gap-4 min-[900px]:grid-cols-2">
            <Field label="Evaluation report Document Version" htmlFor="session-report">
              <select
                className={inputClass}
                id="session-report"
                value={reportDocumentVersionId}
                onChange={(event) => setReportDocumentVersionId(inputValue(event))}
              >
                <option value="">Select finalized report evidence</option>
                {linkable.map((document) => (
                  <option key={document.version.id} value={document.version.id}>
                    {document.documentNo ?? document.documentType} · v{document.version.versionNo}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Report reason" htmlFor="session-report-reason">
              <input
                className={inputClass}
                id="session-report-reason"
                value={reportReason}
                onChange={(event) => setReportReason(inputValue(event))}
                placeholder="Required only for a corrected report version"
              />
            </Field>
            <div className="flex items-end">
              <Button
                disabled={busy || !reportDocumentVersionId}
                onClick={() =>
                  onCommand(
                    `/api/v1/agencies/${agencyId}/recruitment/sessions/${record.id}/reports`,
                    {
                      reportDocumentVersionId,
                      ...(reportReason ? { reason: reportReason } : {}),
                    },
                  )
                }
                variant="secondary"
              >
                Issue report
              </Button>
            </div>
            <Field label="Minutes Document Version" htmlFor="session-minutes">
              <select
                className={inputClass}
                id="session-minutes"
                value={minutesDocumentVersionId}
                onChange={(event) => setMinutesDocumentVersionId(inputValue(event))}
              >
                <option value="">No minutes linked</option>
                {linkable.map((document) => (
                  <option key={document.version.id} value={document.version.id}>
                    {document.documentNo ?? document.documentType} · v{document.version.versionNo}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-end">
              <Button
                disabled={busy || record.reports.length === 0}
                onClick={() =>
                  onCommand(
                    `/api/v1/agencies/${agencyId}/recruitment/sessions/${record.id}/complete`,
                    {
                      ...(minutesDocumentVersionId ? { minutesDocumentVersionId } : {}),
                    },
                  )
                }
                variant="primary"
              >
                Complete deliberation
              </Button>
            </div>
          </div>
          {record.reports.length === 0 ? (
            <p className="m-0 text-caption text-ink-muted">
              The advisory Evaluation Report must be issued before the Session can complete.
            </p>
          ) : null}
        </GuidedPanel>
      ) : null}

      {draft && permissions.submitDeliberations ? (
        <GuidedPanel
          title="Cancel Session"
          description="A draft Session can be cancelled before deliberation begins."
        >
          <div className="grid gap-3 min-[900px]:grid-cols-[1fr_auto]">
            <Field label="Cancellation reason" htmlFor="session-cancel-reason">
              <input
                className={inputClass}
                id="session-cancel-reason"
                value={cancelReason}
                onChange={(event) => setCancelReason(inputValue(event))}
              />
            </Field>
            <div className="flex items-end">
              <Button
                disabled={busy || !cancelReason}
                onClick={() => {
                  if (!confirmAction('Cancel this HRMPSB Session?')) return;
                  void onCommand(
                    `/api/v1/agencies/${agencyId}/recruitment/sessions/${record.id}/cancel`,
                    { reason: cancelReason },
                  );
                }}
                variant="secondary"
              >
                Cancel Session
              </Button>
            </div>
          </div>
        </GuidedPanel>
      ) : null}
    </div>
  );
}

function SelectionDecisionDetail({
  record,
  documents,
  permissions,
  busy,
  onCommand,
  agencyId,
}: {
  record: SelectionDecisionRecord;
  documents: DocumentOption[];
  permissions: Permissions;
  busy: boolean;
  onCommand: (path: string, body?: unknown, method?: 'POST' | 'DELETE') => Promise<void>;
  agencyId: string;
}) {
  const [showPackage, setShowPackage] = useState(false);
  const canDecide =
    record.applicationStatus === 'RECOMMENDED' &&
    (permissions.selectCandidate || permissions.decideSelection);
  return (
    <div className="grid gap-5">
      <GuidedPanel
        title={`Selection Decision · ${record.applicationNo}`}
        description={`${record.applicantName} · ${record.position.itemNumber} · ${record.position.title ?? '—'}`}
      >
        <div className="grid gap-4 min-[720px]:grid-cols-2">
          <dl className="m-0">
            <DetailRow label="Decision">
              <RecordStatus status={record.decision} />
            </DetailRow>
            <DetailRow label="Recorded basis">{record.reason}</DetailRow>
            <DetailRow label="Decided">{dateTimeLabel(record.decidedAt)}</DetailRow>
            <DetailRow label="Authority evidence">
              {record.authorityDocumentVersionId ?? 'Not linked'}
            </DetailRow>
          </dl>
          <dl className="m-0">
            <DetailRow label="Board output">
              {record.boardRecommendation.recommendation.replaceAll('_', ' ')}
              {record.boardRecommendation.rankNo
                ? ` · rank ${record.boardRecommendation.rankNo}`
                : ''}
            </DetailRow>
            <DetailRow label="Evaluation report">
              {record.report
                ? `v${record.report.versionNo} · ${record.report.reportDocumentVersionId}`
                : 'Not issued'}
            </DetailRow>
            <DetailRow label="Board Session">
              {record.sessionId} · {record.boardDefinitionCode} v{record.boardDefinitionVersionNo}
            </DetailRow>
            <DetailRow label="Application standing">
              <RecordStatus status={record.applicationStatus} />
            </DetailRow>
          </dl>
        </div>
        <p className="m-0 border-t border-border pt-4 text-caption text-ink-muted">
          The Selection Decision is the appointing authority&apos;s recruitment-domain choice. It
          does not issue an Appointment, reserve Employee service, or occupy the Plantilla Position
          beyond the Plantilla reservation.
        </p>
      </GuidedPanel>

      {record.handoff ? (
        <GuidedPanel
          title="Selected-candidate handoff"
          description="Immutable selected-candidate package handed to Appointment. Recruitment never inserts Appointment rows."
        >
          <div className="grid gap-3">
            <dl className="m-0">
              <DetailRow label="Reserved Plantilla Position">
                {record.handoff.itemNumber} · reserved through Plantilla
              </DetailRow>
              <DetailRow label="Handed off">{dateTimeLabel(record.handoff.handedOffAt)}</DetailRow>
              <DetailRow label="Appointment accepted">
                {record.handoff.acceptedAt ? dateTimeLabel(record.handoff.acceptedAt) : 'Not yet'}
              </DetailRow>
            </dl>
            <div>
              <Button onClick={() => setShowPackage((current) => !current)} variant="secondary">
                {showPackage
                  ? 'Hide selected-candidate package'
                  : 'Preview selected-candidate package'}
              </Button>
            </div>
            {showPackage ? (
              <pre className="m-0 max-h-[420px] overflow-auto rounded-control border border-border bg-canvas p-4 text-caption text-ink">
                {JSON.stringify(record.handoff.selectionPackage, null, 2)}
              </pre>
            ) : null}
          </div>
        </GuidedPanel>
      ) : null}

      {canDecide ? (
        <GuidedPanel
          title="Appointing authority action"
          description="Select the recommended candidate, record no selection, or return the board output for further review. Each action records the required basis."
        >
          <AuthorityActionPanel
            applicationId={record.applicationId}
            canSelect={permissions.selectCandidate}
            canDecide={permissions.decideSelection}
            documents={documents}
            busy={busy}
            onCommand={onCommand}
            agencyId={agencyId}
          />
        </GuidedPanel>
      ) : null}
    </div>
  );
}

export function RecruitmentWorkspace(props: Props) {
  const navigation = useRecordNavigation();
  const search = navigation.search;
  const requestedSection = search.get('section');
  const section: Section =
    requestedSection === 'publications' ||
    requestedSection === 'applications' ||
    requestedSection === 'sessions' ||
    requestedSection === 'decisions'
      ? requestedSection
      : props.initialSection;
  const applicationsOnly = section === 'applications';
  const requestedView = search.get('view');
  const view: View =
    requestedView === 'kanban' && applicationsOnly
      ? 'kanban'
      : requestedView === 'form'
        ? 'form'
        : requestedView === 'tree'
          ? 'tree'
          : applicationsOnly && props.initialView === 'kanban'
            ? 'kanban'
            : props.initialView === 'form'
              ? 'form'
              : 'tree';
  const selectedId = search.get('selected') ?? props.initialSelected ?? null;
  const newRecord: NewRecord =
    search.get('new') === 'request' ||
    search.get('new') === 'publication' ||
    search.get('new') === 'application' ||
    search.get('new') === 'session'
      ? (search.get('new') as NewRecord)
      : props.initialNew;
  const [requests, setRequests] = useState(props.initialRequests);
  const [publications, setPublications] = useState(props.initialPublications);
  const [applications, setApplications] = useState(props.initialApplications);
  const [sessions, setSessions] = useState(props.initialSessions);
  const [decisions, setDecisions] = useState(props.initialDecisions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const permissions: Permissions = {
    submitRequest: props.canSubmitRequest,
    reviewRequest: props.canReviewRequest,
    rebaselineRequest: props.canRebaselineRequest,
    approveRequest: props.canApproveRequest,
    rejectRequest: props.canRejectRequest,
    cancelRequest: props.canCancelRequest,
    closeRequest: props.canCloseRequest,
    submitPublication: props.canSubmitPublication,
    publishPublication: props.canPublishPublication,
    closePublication: props.canClosePublication,
    cancelPublication: props.canCancelPublication,
    republishPublication: props.canRepublishPublication,
    updateApplication: props.canUpdateApplication,
    screenApplication: props.canScreenApplication,
    disqualifyApplication: props.canDisqualifyApplication,
    withdrawApplication: props.canWithdrawApplication,
    closeApplication: props.canCloseApplication,
    manageAssessments: props.canManageAssessments,
    manageInterviews: props.canManageInterviews,
    submitDeliberations: props.canSubmitDeliberations,
    recommendBoard: props.canRecommendBoard,
    selectCandidate: props.canSelectCandidate,
    decideSelection: props.canDecideSelection,
  };

  const selectedRequest = useMemo(
    () => requests.find((record) => record.id === selectedId) ?? null,
    [requests, selectedId],
  );
  const selectedPublication = useMemo(
    () => publications.find((record) => record.id === selectedId) ?? null,
    [publications, selectedId],
  );
  const selectedApplication = useMemo(
    () => applications.find((record) => record.id === selectedId) ?? null,
    [applications, selectedId],
  );
  const selectedSession = useMemo(
    () => sessions.find((record) => record.id === selectedId) ?? null,
    [sessions, selectedId],
  );
  const selectedDecision = useMemo(
    () => decisions.find((record) => record.id === selectedId) ?? null,
    [decisions, selectedId],
  );
  const republishSource =
    newRecord === 'publication' &&
    selectedPublication &&
    ['CLOSED', 'CANCELLED'].includes(selectedPublication.status)
      ? selectedPublication
      : null;

  async function refresh() {
    const [nextRequests, nextPublications, nextApplications, nextSessions, nextDecisions] =
      await Promise.all([
        props.canReadRequests
          ? fetchList<RecruitmentRequest>(
              `/api/v1/agencies/${props.agencyId}/recruitment/requests-to-fill`,
              'requests',
            )
          : Promise.resolve(requests),
        props.canReadPublications
          ? fetchList<VacancyPublication>(
              `/api/v1/agencies/${props.agencyId}/recruitment/vacancy-publications`,
              'publications',
            )
          : Promise.resolve(publications),
        props.canReadApplications
          ? fetchList<VacancyApplication>(
              `/api/v1/agencies/${props.agencyId}/recruitment/applications`,
              'applications',
            )
          : Promise.resolve(applications),
        props.canReadDeliberations
          ? fetchList<BoardSession>(
              `/api/v1/agencies/${props.agencyId}/recruitment/sessions`,
              'sessions',
            )
          : Promise.resolve(sessions),
        props.canReadDeliberations
          ? fetchList<SelectionDecisionRecord>(
              `/api/v1/agencies/${props.agencyId}/recruitment/selection-decisions`,
              'decisions',
            )
          : Promise.resolve(decisions),
      ]);
    setRequests(nextRequests);
    setPublications(nextPublications);
    setApplications(nextApplications);
    setSessions(nextSessions);
    setDecisions(nextDecisions);
  }

  async function command(path: string, body?: unknown, method: 'POST' | 'DELETE' = 'POST') {
    setBusy(true);
    setError('');
    try {
      if (method === 'DELETE') {
        await sendDelete(path);
      } else {
        await sendCommand(path, body);
      }
      await refresh();
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The Recruitment command could not be completed.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function createdRequest(record: RecruitmentRequest) {
    setRequests((current) => [record, ...current.filter((item) => item.id !== record.id)]);
    navigation.navigate({ section: 'requests', view: 'form', selected: record.id, new: null });
  }

  async function createdPublication(record: VacancyPublication) {
    setPublications((current) => [record, ...current.filter((item) => item.id !== record.id)]);
    navigation.navigate({ section: 'publications', view: 'form', selected: record.id, new: null });
  }

  async function createdApplication(record: VacancyApplication) {
    setApplications((current) => [record, ...current.filter((item) => item.id !== record.id)]);
    navigation.navigate({ section: 'applications', view: 'form', selected: record.id, new: null });
  }

  async function createdSession(record: BoardSession) {
    setSessions((current) => [record, ...current.filter((item) => item.id !== record.id)]);
    navigation.navigate({ section: 'sessions', view: 'form', selected: record.id, new: null });
  }

  const canCreateInSection =
    section === 'requests'
      ? props.canCreateRequest
      : section === 'publications'
        ? props.canCreatePublication
        : section === 'applications'
          ? props.canCreateApplication
          : section === 'sessions'
            ? props.canSubmitDeliberations
            : false;
  const sections: { value: Section; label: string; canRead: boolean }[] = [
    { value: 'requests', label: 'Requests to Fill', canRead: props.canReadRequests },
    { value: 'publications', label: 'Vacancy Publications', canRead: props.canReadPublications },
    { value: 'applications', label: 'Applications', canRead: props.canReadApplications },
    { value: 'sessions', label: 'HRMPSB Sessions', canRead: props.canReadDeliberations },
    { value: 'decisions', label: 'Selection Decisions', canRead: props.canReadDeliberations },
  ];
  const current = sections.find(({ value }) => value === section);
  const sectionTitle = current?.label ?? '';
  const hasSectionRead = current?.canRead ?? false;
  const newLabel =
    section === 'requests'
      ? 'New request to fill'
      : section === 'publications'
        ? 'New publication'
        : section === 'applications'
          ? 'New application'
          : 'Convene HRMPSB Session';
  const views: [View, string][] = [
    ['tree', 'Tree'],
    ['form', 'Form'],
    ...(applicationsOnly ? [['kanban', 'Kanban'] as [View, string]] : []),
  ];
  const openRecord = (id: string) => navigation.navigate({ view: 'form', selected: id, new: null });

  return (
    <div className="grid gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Merit selection' }, { label: 'Recruitment' }]}
        title="Recruitment"
        actions={
          <>
            <div
              className="flex items-center gap-0.5 rounded-control border border-border bg-surface p-0.5"
              role="group"
              aria-label="Record view"
            >
              {views.map(([value, label]) => (
                <button
                  className="cursor-pointer rounded-control border-0 bg-transparent px-3 py-1.5 text-caption font-[650] text-ink-muted hover:text-ink aria-pressed:bg-canvas aria-pressed:text-ink"
                  key={value}
                  type="button"
                  aria-pressed={view === value}
                  onClick={() =>
                    // Form keeps an open draft; Tree and Kanban leave it.
                    navigation.navigate(
                      value === 'form' ? { view: value } : { view: value, new: null },
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            {canCreateInSection ? (
              <Button
                onClick={() =>
                  navigation.navigate({
                    section,
                    view: 'form',
                    selected: null,
                    new:
                      section === 'requests'
                        ? 'request'
                        : section === 'publications'
                          ? 'publication'
                          : section === 'applications'
                            ? 'application'
                            : 'session',
                  })
                }
                variant="primary"
              >
                {newLabel}
              </Button>
            ) : null}
          </>
        }
        tabs={
          <SectionTabLinks
            label="Recruitment records"
            tabs={sections
              .filter(({ canRead }) => canRead)

              .map(({ value, label }) => ({
                href: navigation.href({ section: value, selected: null, new: null }),
                label,
                current: section === value,
              }))}
          />
        }
      />

      <FormError message={error} />
      {!hasSectionRead ? (
        <StateSurface labelledBy="recruitment-access-title">
          <StateCode>Not authorized</StateCode>
          <h2 className="m-0 text-panel-title text-ink" id="recruitment-access-title">
            No access in this view
          </h2>
          <p className="m-0 max-w-[500px] text-body text-ink-muted">
            Your active Agency Membership does not permit this Recruitment register.
          </p>
        </StateSurface>
      ) : null}
      {hasSectionRead && view === 'tree' ? (
        <Panel title={sectionTitle} flush>
          <p className="m-0 px-4 pt-3 pb-3 text-small text-ink-muted">
            Select a record to inspect its status, evidence, and next permitted action.
          </p>
          {section === 'requests' ? (
            <RequestTree records={requests} selectedId={selectedId} onSelect={openRecord} />
          ) : section === 'publications' ? (
            <PublicationTree records={publications} selectedId={selectedId} onSelect={openRecord} />
          ) : section === 'applications' ? (
            <ApplicationTree records={applications} selectedId={selectedId} onSelect={openRecord} />
          ) : section === 'sessions' ? (
            <SessionTree records={sessions} selectedId={selectedId} onSelect={openRecord} />
          ) : (
            <SelectionDecisionTree
              records={decisions}
              selectedId={selectedId}
              onSelect={openRecord}
            />
          )}
        </Panel>
      ) : null}
      {hasSectionRead && view === 'kanban' && applicationsOnly ? (
        <Panel title="Applications" flush>
          <p className="m-0 px-4 pt-3 text-small text-ink-muted">
            Tree and Kanban show the same Applications. Open a card to record evidence and screening
            on its Form.
          </p>
          <ApplicationKanban records={applications} selectedId={selectedId} onSelect={openRecord} />
        </Panel>
      ) : null}
      {hasSectionRead && view === 'form' && newRecord === 'request' ? (
        <RequestDraft
          agencyId={props.agencyId}
          positions={props.positions}
          busy={busy}
          error={error}
          onError={setError}
          onCreated={createdRequest}
        />
      ) : null}
      {hasSectionRead && view === 'form' && newRecord === 'publication' ? (
        <PublicationDraft
          agencyId={props.agencyId}
          displayName={props.displayName}
          requests={requests}
          documents={props.documents}
          republishSourceId={republishSource?.id ?? null}
          republishRequestToFillId={republishSource?.requestToFillId ?? null}
          busy={busy}
          error={error}
          onError={setError}
          onCreated={createdPublication}
        />
      ) : null}
      {hasSectionRead && view === 'form' && newRecord === 'application' ? (
        <ApplicationDraft
          agencyId={props.agencyId}
          publications={publications}
          documents={props.documents}
          busy={busy}
          error={error}
          onError={setError}
          onCreated={createdApplication}
        />
      ) : null}
      {hasSectionRead && view === 'form' && newRecord === 'session' ? (
        <SessionDraft
          agencyId={props.agencyId}
          publications={publications}
          busy={busy}
          error={error}
          onError={setError}
          onCreated={createdSession}
        />
      ) : null}
      {hasSectionRead &&
      view === 'form' &&
      !newRecord &&
      section === 'requests' &&
      selectedRequest ? (
        <RequestDetail
          record={selectedRequest}
          agencyId={props.agencyId}
          permissions={permissions}
          busy={busy}
          onCommand={command}
        />
      ) : null}
      {hasSectionRead &&
      view === 'form' &&
      !newRecord &&
      section === 'publications' &&
      selectedPublication ? (
        <PublicationDetail
          record={selectedPublication}
          agencyId={props.agencyId}
          documents={props.documents}
          permissions={permissions}
          busy={busy}
          onCommand={command}
          onRepublish={(record) =>
            navigation.navigate({
              section: 'publications',
              view: 'form',
              selected: record.id,
              new: 'publication',
            })
          }
        />
      ) : null}
      {hasSectionRead &&
      view === 'form' &&
      !newRecord &&
      section === 'applications' &&
      selectedApplication ? (
        <ApplicationDetail
          record={selectedApplication}
          agencyId={props.agencyId}
          membershipId={props.membershipId}
          documents={props.documents}
          sessions={sessions}
          decisions={decisions}
          permissions={permissions}
          busy={busy}
          onCommand={command}
        />
      ) : null}
      {hasSectionRead &&
      view === 'form' &&
      !newRecord &&
      section === 'sessions' &&
      selectedSession ? (
        <SessionDetail
          record={selectedSession}
          applications={applications}
          documents={props.documents}
          permissions={permissions}
          busy={busy}
          onCommand={command}
          agencyId={props.agencyId}
        />
      ) : null}
      {hasSectionRead &&
      view === 'form' &&
      !newRecord &&
      section === 'decisions' &&
      selectedDecision ? (
        <SelectionDecisionDetail
          record={selectedDecision}
          documents={props.documents}
          permissions={permissions}
          busy={busy}
          onCommand={command}
          agencyId={props.agencyId}
        />
      ) : null}
      {hasSectionRead &&
      view === 'form' &&
      !newRecord &&
      !selectedRequest &&
      !selectedPublication &&
      !selectedApplication &&
      !selectedSession &&
      !selectedDecision ? (
        <StateSurface labelledBy="recruitment-select-title">
          <StateCode>No record selected</StateCode>
          <h2 className="m-0 text-panel-title text-ink" id="recruitment-select-title">
            Select a Recruitment record
          </h2>
          <p className="m-0 max-w-[500px] text-body text-ink-muted">
            Choose a record from Tree view or start a new controlled case.
          </p>
        </StateSurface>
      ) : null}
    </div>
  );
}
