'use client';

import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { manilaToday } from '../lib/manila-date';
import { useRecordNavigation } from './record-navigation';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';

type Section = 'requests' | 'publications' | 'applications';
type View = 'tree' | 'form' | 'kanban';
type NewRecord = 'request' | 'publication' | 'application' | null;

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
  createdAt: string;
  updatedAt: string;
}

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
  displayName: string;
  initialRequests: RecruitmentRequest[];
  initialPublications: VacancyPublication[];
  initialApplications: VacancyApplication[];
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
  canCreateApplication: boolean;
  canUpdateApplication: boolean;
  canScreenApplication: boolean;
  canDisqualifyApplication: boolean;
  canWithdrawApplication: boolean;
  canCloseApplication: boolean;
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

function statusTone(status: string): 'blue' | 'amber' | 'green' | 'gray' | 'red' {
  if (status === 'APPROVED' || status === 'PUBLISHED') return 'green';
  if (status === 'FOR_REVIEW' || status === 'FOR_APPROVAL') return 'amber';
  if (status === 'REJECTED' || status === 'CANCELLED') return 'red';
  if (status === 'CLOSED' || status === 'REPUBLISHED') return 'gray';
  return 'blue';
}

function StatusBadge({ status }: { status: string }) {
  const tones = {
    blue: 'border-[#b9cce5] bg-[#edf2f9] text-[#315d98]',
    amber: 'border-[#decba7] bg-[#fff8e9] text-[#755421]',
    green: 'border-[#b6d9c3] bg-[#eef9f1] text-[#296442]',
    gray: 'border-line bg-canvas text-muted',
    red: 'border-[#e8b6b6] bg-[#fff4f4] text-[#9a3030]',
  };
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-[0.06em] uppercase ${tones[statusTone(status)]}`}
    >
      {status.replaceAll('_', ' ')}
    </span>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 rounded-[4px] border border-line bg-paper p-5 shadow-[0_7px_20px_rgb(23_32_51/4%)]">
      <div className="grid gap-1">
        <h2 className="m-0 text-[17px] font-[720] tracking-[-0.02em] text-midnight">{title}</h2>
        {description ? (
          <p className="m-0 text-[13px] leading-[1.55] text-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line/70 py-3 last:border-b-0">
      <dt className="text-[10px] font-bold tracking-[0.07em] text-muted uppercase">{label}</dt>
      <dd className="m-0 text-sm leading-[1.5] text-ink">{children}</dd>
    </div>
  );
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
    <div className="grid gap-2" aria-label="Requests to Fill">
      {records.length === 0 ? (
        <p className="m-0 rounded-[3px] border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          No Requests to Fill yet.
        </p>
      ) : (
        records.map((record) => (
          <button
            className={`grid gap-2 rounded-[3px] border px-4 py-3 text-left transition-colors ${selectedId === record.id ? 'border-cobalt bg-[#f1f5fb]' : 'border-line bg-paper hover:border-[#aebed3]'}`}
            key={record.id}
            type="button"
            onClick={() => onSelect(record.id)}
          >
            <span className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm font-[680] text-midnight">{record.requestNo}</strong>
              <StatusBadge status={record.status} />
            </span>
            <span className="text-[13px] text-ink">
              {record.position.itemNumber} · {record.position.title}
            </span>
            <span className="text-xs text-muted">
              {record.position.organizationUnitName} · SG {record.position.salaryGrade}
            </span>
          </button>
        ))
      )}
    </div>
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
    <div className="grid gap-2" aria-label="Vacancy Publications">
      {records.length === 0 ? (
        <p className="m-0 rounded-[3px] border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          No Vacancy Publications yet.
        </p>
      ) : (
        records.map((record) => (
          <button
            className={`grid gap-2 rounded-[3px] border px-4 py-3 text-left transition-colors ${selectedId === record.id ? 'border-cobalt bg-[#f1f5fb]' : 'border-line bg-paper hover:border-[#aebed3]'}`}
            key={record.id}
            type="button"
            onClick={() => onSelect(record.id)}
          >
            <span className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm font-[680] text-midnight">{record.publicationNo}</strong>
              <StatusBadge status={record.status} />
            </span>
            <span className="text-[13px] text-ink">
              {record.position.itemNumber} · {record.position.title}
            </span>
            <span className="text-xs text-muted">
              {dateLabel(record.openingDate)} — {dateLabel(record.closingDate)} · {record.requestNo}
            </span>
          </button>
        ))
      )}
    </div>
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
    <Panel
      title="Open a Request to Fill"
      description="Start only from an authorized, current VACANT Plantilla Position. The server resolves the governing MSP and approval routes during review."
    >
      <form className="grid max-w-[780px] gap-5" onSubmit={submit}>
        {error ? <FormError message={error} /> : null}
        {vacancies.length === 0 ? (
          <p className="m-0 rounded-[3px] border border-dashed border-line px-4 py-4 text-sm text-muted">
            No Recruitable Vacancy is available in this Agency Context.
          </p>
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
              <Button
                disabled={busy || submitting || !position}
                size="default"
                type="submit"
                variant="primary"
              >
                {busy || submitting ? 'Opening…' : 'Open draft request'}
              </Button>
              <span className="text-xs text-muted">
                The draft remains editable only through Recruitment controls.
              </span>
            </div>
          </>
        )}
      </form>
    </Panel>
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
    <Panel
      title={republishSourceId ? 'Prepare a linked republication' : 'Prepare a Vacancy Publication'}
      description={
        republishSourceId
          ? 'This creates a new publication version linked to the closed or cancelled source. Fresh dates, channels, evidence, and certification are required.'
          : 'Publication details are versioned. CS Form No. 9, posting dates, channels, evidence, contact details, and HRMO certification are validated again at approval.'
      }
    >
      <form className="grid max-w-[900px] gap-5" onSubmit={submit}>
        {error ? <FormError message={error} /> : null}
        {approved.length === 0 ? (
          <p className="m-0 rounded-[3px] border border-dashed border-line px-4 py-4 text-sm text-muted">
            An approved Request to Fill is required before a publication draft can be prepared.
          </p>
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
            <div className="grid gap-2 rounded-[3px] border border-[#c7d6e8] bg-[#f4f7fb] px-4 py-3 text-xs leading-[1.55] text-ink">
              <strong className="font-[680] text-midnight">Required posting package</strong>
              <span>
                CSC Field Office, CSC Job Portal, and three agency posting places are prepared with
                finalized evidence documents ({evidenceOptions.length} available).
              </span>
              {evidenceOptions.length < 5 ? (
                <span className="font-[650] text-[#9a3030]">
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
                size="default"
                type="submit"
                variant="primary"
              >
                {busy || submitting
                  ? 'Preparing…'
                  : republishSourceId
                    ? 'Prepare linked republication'
                    : 'Prepare draft publication'}
              </Button>
              <span className="text-xs text-muted">
                The publication remains a DRAFT until submitted for approval.
              </span>
            </div>
          </>
        )}
      </form>
    </Panel>
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
      <Panel
        title={`${record.requestNo} · ${record.position.title}`}
        description={`${record.position.itemNumber} · ${record.position.organizationUnitName}`}
      >
        <div className="grid gap-4 min-[720px]:grid-cols-2">
          <dl className="m-0">
            <DetailRow label="Status">
              <StatusBadge status={record.status} />
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
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          {record.status === 'DRAFT' && permissions.submitRequest ? (
            <Button
              disabled={busy}
              onClick={() =>
                onCommand(
                  `/api/v1/agencies/${agencyId}/recruitment/requests-to-fill/${record.id}/submit`,
                )
              }
              size="default"
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
              size="default"
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
              size="default"
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
              size="default"
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
              size="default"
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
              size="default"
              variant="secondary"
            >
              Close request
            </Button>
          ) : null}
        </div>
      </Panel>
      {record.status === 'FOR_REVIEW' && permissions.rebaselineRequest ? (
        <Panel
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
              size="default"
              variant="secondary"
            >
              Record rebaseline
            </Button>
          </div>
        </Panel>
      ) : null}
      {record.rebaselines.length ? (
        <Panel
          title="Rebaseline history"
          description="Append-only snapshots of changes made before publication."
        >
          <div className="grid gap-3">
            {record.rebaselines.map((item) => (
              <div
                className="grid gap-1 rounded-[3px] border border-line px-3 py-3 text-xs"
                key={item.id}
              >
                <strong className="text-ink">
                  {dateTimeLabel(item.createdAt)} · {item.reason}
                </strong>
                <span className="text-muted">
                  Authority evidence: {item.authorityDocumentVersionId ?? '—'} · binding set{' '}
                  {record.governingConfiguration.bindingSetNo}
                </span>
              </div>
            ))}
          </div>
        </Panel>
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
      <Panel
        title={`${record.publicationNo} · ${record.position.title}`}
        description={`${record.position.itemNumber} · linked to ${record.requestNo}`}
      >
        <div className="grid gap-4 min-[720px]:grid-cols-2">
          <dl className="m-0">
            <DetailRow label="Status">
              <StatusBadge status={record.status} />
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
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          {record.status === 'DRAFT' && permissions.submitPublication ? (
            <Button
              disabled={busy}
              onClick={() =>
                onCommand(
                  `/api/v1/agencies/${agencyId}/recruitment/vacancy-publications/${record.id}/submit`,
                )
              }
              size="default"
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
              size="default"
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
              size="default"
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
              size="default"
              variant="secondary"
            >
              Cancel publication
            </Button>
          ) : null}
          {(['CLOSED', 'CANCELLED'] as string[]).includes(record.status) &&
          permissions.republishPublication ? (
            <Button
              disabled={busy}
              onClick={() => onRepublish(record)}
              size="default"
              variant="secondary"
            >
              Prepare republication
            </Button>
          ) : null}
        </div>
        {(record.status === 'PUBLISHED' && permissions.closePublication) ||
        (record.status === 'PUBLISHED' && permissions.cancelPublication) ? (
          <div className="grid gap-3 border-t border-line pt-4 min-[720px]:grid-cols-2">
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
      </Panel>
      <Panel
        title="Publication evidence"
        description="Each posting channel keeps its own evidence reference and document version."
      >
        <div className="grid gap-2">
          {record.evidence.length ? (
            record.evidence.map((item) => (
              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-[3px] border border-line px-3 py-2 text-xs"
                key={item.id}
              >
                <span className="font-[650] text-ink">
                  {item.channelType.replaceAll('_', ' ')} · {item.location}
                </span>
                <span className="text-muted">
                  {dateTimeLabel(item.publishedAt)} ·{' '}
                  {item.evidenceDocumentVersionId ?? 'No evidence version'}
                </span>
              </div>
            ))
          ) : (
            <span className="text-sm text-muted">No evidence records.</span>
          )}
        </div>
      </Panel>
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
    <div className="overflow-x-auto" aria-label="Applications">
      {records.length === 0 ? (
        <p className="m-0 rounded-[3px] border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          No Applications received yet.
        </p>
      ) : (
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-[10px] font-bold tracking-[0.07em] text-muted uppercase">
              <th className="px-3 py-2">Record</th>
              <th className="px-3 py-2">Reference</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Evidence</th>
              <th className="px-3 py-2">Standing</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr
                className={`border-b border-line/70 align-top ${selectedId === record.id ? 'bg-[#f1f5fb]' : ''}`}
                key={record.id}
              >
                <td className="px-3 py-2">
                  <button
                    className="rounded-[2px] text-left text-sm font-[680] text-cobalt underline-offset-2 hover:underline"
                    type="button"
                    onClick={() => onSelect(record.id)}
                  >
                    {record.applicationNo}
                  </button>
                </td>
                <td className="px-3 py-2 text-[13px] text-ink">
                  {record.applicant.fullName}
                  {record.applicant.email ? (
                    <span className="block text-xs text-muted">{record.applicant.email}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-[13px] text-ink">
                  {record.position.title}
                  <span className="block text-xs text-muted">{record.publicationNo}</span>
                </td>
                <td className="px-3 py-2 text-[13px] text-ink">{evidenceSummary(record)}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={record.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const KANBAN_COLUMNS = [
  ['RECEIVED', 'Received'],
  ['INCOMPLETE', 'Incomplete'],
  ['QUALIFIED', 'Qualified'],
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
    <div className="flex gap-3 overflow-x-auto pb-2" aria-label="Application board">
      {KANBAN_COLUMNS.map(([status, label]) => {
        const cards = records.filter((record) => record.status === status);
        return (
          <section
            className="grid min-w-[230px] flex-1 content-start gap-2 rounded-[3px] border border-line bg-canvas/60 p-3"
            key={status}
          >
            <h3 className="m-0 flex items-center justify-between gap-2 text-[11px] font-bold tracking-[0.06em] text-muted uppercase">
              {label}
              <span className="rounded-full border border-line bg-paper px-2 py-0.5 text-[10px] text-ink">
                {cards.length}
              </span>
            </h3>
            {cards.length === 0 ? (
              <p className="m-0 rounded-[3px] border border-dashed border-line px-3 py-4 text-center text-xs text-muted">
                No Applications
              </p>
            ) : (
              cards.map((record) => (
                <button
                  className={`grid gap-1.5 rounded-[3px] border bg-paper px-3 py-3 text-left transition-colors ${selectedId === record.id ? 'border-cobalt bg-[#f1f5fb]' : 'border-line hover:border-[#aebed3]'}`}
                  key={record.id}
                  type="button"
                  onClick={() => onSelect(record.id)}
                >
                  <span className="text-xs font-bold text-cobalt">{record.applicationNo}</span>
                  <strong className="text-sm font-[680] text-midnight">
                    {record.applicant.fullName}
                  </strong>
                  <span className="text-xs text-muted">
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
    <Panel
      title="Record an Application"
      description="Normal intake is accepted only while the Vacancy Publication is open. Intake beyond the period requires an explicit late-handling reason and finalized authority evidence."
    >
      <form className="grid max-w-[900px] gap-5" onSubmit={submit}>
        {error ? <FormError message={error} /> : null}
        {open.length === 0 ? (
          <p className="m-0 rounded-[3px] border border-dashed border-line px-4 py-4 text-sm text-muted">
            No open Vacancy Publication is available for intake.
          </p>
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
            <label className="flex items-start gap-3 text-[13px] leading-[1.6] text-ink">
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
              <p className="m-0 rounded-[3px] border border-[#c7d6e8] bg-[#f4f7fb] px-4 py-3 text-sm text-ink">
                This Vacancy Publication opens on {dateLabel(publication.openingDate)}. Intake is
                not yet accepted.
              </p>
            ) : null}
            {publication && lateAcceptanceRequired ? (
              <div className="grid gap-4 rounded-[3px] border border-[#decba7] bg-[#fff8e9] p-4">
                <strong className="text-sm font-[680] text-[#755421]">
                  Authorized late handling required
                </strong>
                <p className="m-0 text-xs leading-[1.6] text-[#755421]">
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
                size="default"
                type="submit"
                variant="primary"
              >
                {busy || submitting ? 'Recording…' : 'Record Application'}
              </Button>
              <span className="text-xs text-muted">
                Evidence documents are linked on the Application record before screening.
              </span>
            </div>
          </>
        )}
      </form>
    </Panel>
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
          <div className="grid gap-2 rounded-[3px] border border-line p-3" key={entry.area}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-[13px] font-[680] text-midnight">
                {areaLabel(entry.area)}
              </strong>
              <label className="flex items-center gap-2 text-xs text-muted">
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
                <span className="text-[10px] font-bold tracking-[0.06em] text-muted uppercase">
                  Evidence
                </span>
                {record.documents.length === 0 ? (
                  <span className="text-xs text-[#9a3030]">
                    Link at least one evidence document before assessing this area.
                  </span>
                ) : (
                  record.documents.map((document) => (
                    <label className="flex items-center gap-2 text-xs text-ink" key={document.id}>
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
              className={`${inputClass} min-h-8 py-1 text-xs`}
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
          size="default"
          variant="primary"
        >
          {busy ? 'Saving…' : mode === 'correct' ? 'Record correction' : 'Record screening'}
        </Button>
        <span className="text-xs text-muted">
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
  documents,
  permissions,
  busy,
  onCommand,
}: {
  record: VacancyApplication;
  agencyId: string;
  documents: DocumentOption[];
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
      <Panel
        title={`${record.applicationNo} · ${record.applicant.fullName}`}
        description={`${record.position.itemNumber} · ${record.position.title} · ${record.publicationNo}`}
      >
        <div className="grid gap-4 min-[720px]:grid-cols-2">
          <dl className="m-0">
            <DetailRow label="Standing">
              <StatusBadge status={record.status} />
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
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          {record.status === 'INCOMPLETE' && permissions.updateApplication ? (
            <Button
              disabled={busy || !lifecycleReason}
              onClick={() =>
                onCommand(
                  `/api/v1/agencies/${agencyId}/recruitment/applications/${record.id}/reopen`,
                  { reason: lifecycleReason },
                )
              }
              size="default"
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
              size="default"
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
              size="default"
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
      </Panel>

      <Panel
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
          <div className="grid content-start gap-2 text-sm text-ink">
            <strong className="text-[10px] font-bold tracking-[0.07em] text-muted uppercase">
              Applicable screening areas
            </strong>
            {qualification.applicableAreas.map((area) => (
              <span key={area}>{areaLabel(area)}</span>
            ))}
          </div>
        </div>
      </Panel>

      <Panel
        title="Application evidence"
        description="Finalized Agency Document Versions linked to this Application. Evidence cannot be removed once a completed screening cites it."
      >
        <div className="grid gap-2">
          {record.documents.length ? (
            record.documents.map((document) => (
              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-[3px] border border-line px-3 py-2 text-xs"
                key={document.id}
              >
                <span className="font-[650] text-ink">
                  {document.documentNo ?? document.documentType} · v{document.versionNo} ·{' '}
                  {document.purpose.replaceAll('_', ' ')}
                </span>
                <span className="flex items-center gap-3 text-muted">
                  {dateTimeLabel(document.linkedAt)}
                  {permissions.updateApplication &&
                  (record.status === 'RECEIVED' || record.status === 'INCOMPLETE') ? (
                    <button
                      className="rounded-[2px] text-[#9a3030] underline-offset-2 hover:underline"
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
            <span className="text-sm text-muted">No evidence linked yet.</span>
          )}
        </div>
        {editable && permissions.updateApplication ? (
          <div className="grid gap-3 border-t border-line pt-4 min-[720px]:grid-cols-3">
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
                size="default"
                variant="secondary"
              >
                Link evidence
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>

      <Panel
        title="Qualification screening"
        description="Assess each applicable area against the bound standard. The recorded outcome follows from the area results and requires supporting evidence; completed results are never overwritten."
      >
        {record.latestScreening ? (
          <div className="grid gap-3 border-b border-line pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={record.latestScreening.result} />
              <span className="text-xs text-muted">
                v{record.latestScreening.versionNo} ·{' '}
                {dateTimeLabel(record.latestScreening.screenedAt)}
              </span>
            </div>
            <p className="m-0 text-sm leading-[1.6] text-ink">{record.latestScreening.reason}</p>
            <div className="grid gap-1">
              {record.latestScreening.areaResults.map((entry) => (
                <span className="text-xs text-muted" key={entry.area}>
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
              <span className="text-xs text-[#755421]">
                Correction basis: {record.latestScreening.correctionReason}
              </span>
            ) : null}
          </div>
        ) : (
          <p className="m-0 border-b border-line pb-4 text-sm text-muted">
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
      </Panel>

      {record.screenings.length > 1 ? (
        <Panel
          title="Screening history"
          description="Every completed result is preserved. Corrections append a linked replacement version."
        >
          <div className="grid gap-3">
            {record.screenings
              .slice(0, -1)
              .reverse()
              .map((screening) => (
                <div
                  className="grid gap-1 rounded-[3px] border border-line px-3 py-3 text-xs"
                  key={screening.id}
                >
                  <strong className="text-ink">
                    v{screening.versionNo} · {screening.result.replaceAll('_', ' ')} ·{' '}
                    {dateTimeLabel(screening.screenedAt)}
                  </strong>
                  <span className="text-muted">{screening.reason}</span>
                </div>
              ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

export function RecruitmentWorkspace(props: Props) {
  const navigation = useRecordNavigation();
  const search = navigation.search;
  const section: Section =
    search.get('section') === 'publications'
      ? 'publications'
      : search.get('section') === 'applications'
        ? 'applications'
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
    search.get('new') === 'application'
      ? (search.get('new') as NewRecord)
      : props.initialNew;
  const [requests, setRequests] = useState(props.initialRequests);
  const [publications, setPublications] = useState(props.initialPublications);
  const [applications, setApplications] = useState(props.initialApplications);
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
  const republishSource =
    newRecord === 'publication' &&
    selectedPublication &&
    ['CLOSED', 'CANCELLED'].includes(selectedPublication.status)
      ? selectedPublication
      : null;

  async function refresh() {
    const [nextRequests, nextPublications, nextApplications] = await Promise.all([
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
    ]);
    setRequests(nextRequests);
    setPublications(nextPublications);
    setApplications(nextApplications);
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

  const canCreateInSection =
    section === 'requests'
      ? props.canCreateRequest
      : section === 'publications'
        ? props.canCreatePublication
        : props.canCreateApplication;
  const hasSectionRead =
    section === 'requests'
      ? props.canReadRequests
      : section === 'publications'
        ? props.canReadPublications
        : props.canReadApplications;
  const sectionTitle =
    section === 'requests'
      ? 'Requests to Fill'
      : section === 'publications'
        ? 'Vacancy Publications'
        : 'Applications';
  const newLabel =
    section === 'requests'
      ? 'New request to fill'
      : section === 'publications'
        ? 'New publication'
        : 'New application';

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-1">
            <span className="text-[10px] font-bold tracking-[0.09em] text-cobalt uppercase">
              Recruitment Casework
            </span>
            <h1 className="m-0 text-[28px] font-[760] tracking-[-0.035em] text-midnight">
              Recruitment
            </h1>
            <p className="m-0 max-w-[720px] text-sm leading-[1.6] text-muted">
              Open a controlled Request to Fill from a Recruitable Vacancy, publish an
              evidence-backed vacancy package, and screen applicant evidence against the bound
              Qualification Standard Version.
            </p>
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
                        : 'application',
                })
              }
              size="default"
              variant="primary"
            >
              {newLabel}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <nav className="flex flex-wrap gap-1" aria-label="Recruitment records">
          {props.canReadRequests ? (
            <button
              className={`rounded-[3px] px-3 py-2 text-xs font-[680] ${section === 'requests' ? 'bg-midnight text-paper' : 'text-muted hover:bg-canvas hover:text-ink'}`}
              type="button"
              onClick={() =>
                navigation.navigate({ section: 'requests', selected: null, new: null })
              }
            >
              Requests to Fill
            </button>
          ) : null}
          {props.canReadPublications ? (
            <button
              className={`rounded-[3px] px-3 py-2 text-xs font-[680] ${section === 'publications' ? 'bg-midnight text-paper' : 'text-muted hover:bg-canvas hover:text-ink'}`}
              type="button"
              onClick={() =>
                navigation.navigate({ section: 'publications', selected: null, new: null })
              }
            >
              Vacancy Publications
            </button>
          ) : null}
          {props.canReadApplications ? (
            <button
              className={`rounded-[3px] px-3 py-2 text-xs font-[680] ${section === 'applications' ? 'bg-midnight text-paper' : 'text-muted hover:bg-canvas hover:text-ink'}`}
              type="button"
              onClick={() =>
                navigation.navigate({ section: 'applications', selected: null, new: null })
              }
            >
              Applications
            </button>
          ) : null}
        </nav>
        <div
          className="flex items-center gap-1 rounded-[3px] border border-line bg-paper p-1"
          aria-label="Record view"
        >
          <button
            className={`rounded-[2px] px-3 py-1.5 text-xs font-[650] ${view === 'tree' ? 'bg-canvas text-ink' : 'text-muted'}`}
            type="button"
            aria-pressed={view === 'tree'}
            onClick={() => navigation.navigate({ view: 'tree', new: null })}
          >
            Tree
          </button>
          <button
            className={`rounded-[2px] px-3 py-1.5 text-xs font-[650] ${view === 'form' ? 'bg-canvas text-ink' : 'text-muted'}`}
            type="button"
            aria-pressed={view === 'form'}
            onClick={() => navigation.navigate({ view: 'form' })}
          >
            Form
          </button>
          {applicationsOnly ? (
            <button
              className={`rounded-[2px] px-3 py-1.5 text-xs font-[650] ${view === 'kanban' ? 'bg-canvas text-ink' : 'text-muted'}`}
              type="button"
              aria-pressed={view === 'kanban'}
              onClick={() => navigation.navigate({ view: 'kanban', new: null })}
            >
              Kanban
            </button>
          ) : null}
        </div>
      </div>

      {error ? <FormError message={error} /> : null}
      {!hasSectionRead ? (
        <Panel title="No access in this view">
          <p className="m-0 text-sm text-muted">
            Your active Agency Membership does not permit this Recruitment register.
          </p>
        </Panel>
      ) : null}
      {hasSectionRead && view === 'tree' ? (
        <Panel
          title={sectionTitle}
          description="Select a record to inspect its status, evidence, and next permitted action."
        >
          {section === 'requests' ? (
            <RequestTree
              records={requests}
              selectedId={selectedId}
              onSelect={(id) => navigation.navigate({ view: 'form', selected: id, new: null })}
            />
          ) : section === 'publications' ? (
            <PublicationTree
              records={publications}
              selectedId={selectedId}
              onSelect={(id) => navigation.navigate({ view: 'form', selected: id, new: null })}
            />
          ) : (
            <ApplicationTree
              records={applications}
              selectedId={selectedId}
              onSelect={(id) => navigation.navigate({ view: 'form', selected: id, new: null })}
            />
          )}
        </Panel>
      ) : null}
      {hasSectionRead && view === 'kanban' && applicationsOnly ? (
        <Panel
          title="Applications"
          description="Tree and Kanban show the same Applications. Open a card to record evidence and screening on its Form."
        >
          <ApplicationKanban
            records={applications}
            selectedId={selectedId}
            onSelect={(id) => navigation.navigate({ view: 'form', selected: id, new: null })}
          />
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
          documents={props.documents}
          permissions={permissions}
          busy={busy}
          onCommand={command}
        />
      ) : null}
      {hasSectionRead &&
      view === 'form' &&
      !newRecord &&
      !selectedRequest &&
      !selectedPublication &&
      !selectedApplication ? (
        <Panel title="Select a Recruitment record">
          <p className="m-0 text-sm text-muted">
            Choose a record from Tree view or start a new controlled case.
          </p>
        </Panel>
      ) : null}
    </div>
  );
}
