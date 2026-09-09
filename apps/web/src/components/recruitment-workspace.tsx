'use client';

import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { manilaToday } from '../lib/manila-date';
import { useRecordNavigation } from './record-navigation';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';

type Section = 'requests' | 'publications';
type View = 'tree' | 'form';
type NewRecord = 'request' | 'publication' | null;

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

interface Props {
  agencyId: string;
  displayName: string;
  initialRequests: RecruitmentRequest[];
  initialPublications: VacancyPublication[];
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

export function RecruitmentWorkspace(props: Props) {
  const navigation = useRecordNavigation();
  const search = navigation.search;
  const section: Section =
    search.get('section') === 'publications' ? 'publications' : props.initialSection;
  const view: View = search.get('view') === 'form' ? 'form' : props.initialView;
  const selectedId = search.get('selected') ?? props.initialSelected ?? null;
  const newRecord: NewRecord =
    search.get('new') === 'request' || search.get('new') === 'publication'
      ? (search.get('new') as NewRecord)
      : props.initialNew;
  const [requests, setRequests] = useState(props.initialRequests);
  const [publications, setPublications] = useState(props.initialPublications);
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
  };

  const selectedRequest = useMemo(
    () => requests.find((record) => record.id === selectedId) ?? null,
    [requests, selectedId],
  );
  const selectedPublication = useMemo(
    () => publications.find((record) => record.id === selectedId) ?? null,
    [publications, selectedId],
  );
  const republishSource =
    newRecord === 'publication' &&
    selectedPublication &&
    ['CLOSED', 'CANCELLED'].includes(selectedPublication.status)
      ? selectedPublication
      : null;

  async function refresh() {
    const [nextRequests, nextPublications] = await Promise.all([
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
    ]);
    setRequests(nextRequests);
    setPublications(nextPublications);
  }

  async function command(path: string, body?: unknown) {
    setBusy(true);
    setError('');
    try {
      await sendCommand(path, body);
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

  const canCreateInSection =
    section === 'requests' ? props.canCreateRequest : props.canCreatePublication;
  const hasSectionRead = section === 'requests' ? props.canReadRequests : props.canReadPublications;

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
              Open a controlled Request to Fill from a Recruitable Vacancy, resolve its governing
              configuration, and publish an evidence-backed vacancy package.
            </p>
          </div>
          {canCreateInSection ? (
            <Button
              onClick={() =>
                navigation.navigate({
                  section,
                  view: 'form',
                  selected: null,
                  new: section === 'requests' ? 'request' : 'publication',
                })
              }
              size="default"
              variant="primary"
            >
              {section === 'requests' ? 'New request to fill' : 'New publication'}
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
          title={section === 'requests' ? 'Requests to Fill' : 'Vacancy Publications'}
          description="Select a record to inspect its status, immutable bindings, approval evidence, and next permitted action."
        >
          {section === 'requests' ? (
            <RequestTree
              records={requests}
              selectedId={selectedId}
              onSelect={(id) => navigation.navigate({ view: 'form', selected: id, new: null })}
            />
          ) : (
            <PublicationTree
              records={publications}
              selectedId={selectedId}
              onSelect={(id) => navigation.navigate({ view: 'form', selected: id, new: null })}
            />
          )}
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
      !selectedRequest &&
      !selectedPublication ? (
        <Panel title="Select a Recruitment record">
          <p className="m-0 text-sm text-muted">
            Choose a record from Tree view or start a new controlled case.
          </p>
        </Panel>
      ) : null}
    </div>
  );
}
