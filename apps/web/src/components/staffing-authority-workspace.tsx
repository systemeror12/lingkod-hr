'use client';

import { Field, inputClass, FormError } from './ui/field';

import { useRecordNavigation } from './record-navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { Button } from './ui/button';
import { PageHeader, type Breadcrumb } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag, type StatusTone } from './ui/status-tag';
import { Table, TableFooter, Td, Th, Tr } from './ui/table';
import { StateSurface } from './state-surface';
import { manilaToday } from '../lib/manila-date';

type AuthorityType = 'LAW' | 'EXECUTIVE_ORDER' | 'DBM_APPROVAL' | 'BOARD_RESOLUTION' | 'OTHER';
type AuthorityStatus = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'REVOKED';

interface Evidence {
  documentId: string;
  documentNo: string | null;
  documentType: string;
  classification: string;
  status: string;
  versionNo: number | null;
  validatedAt: string;
  validationReason: string;
}

type LinkedEvidence = Omit<Evidence, 'validatedAt' | 'validationReason'>;

export interface StaffingAuthority {
  id: string;
  authorityType: AuthorityType;
  referenceNo: string;
  issuedDate: string;
  effectiveDate: string;
  sourceMetadata: Record<string, string>;
  status: AuthorityStatus;
  evidence: Evidence | null;
  revocationEvidence: LinkedEvidence | null;
  supersededEffectiveDate: string | null;
  revokedEffectiveDate: string | null;
  revocationReason: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

interface StaffingAuthorityDetail {
  authority: StaffingAuthority;
  history: Array<{
    id: string;
    action: string;
    previousStatus: string | null;
    newStatus: string | null;
    reason: string | null;
    effectiveDate: string | null;
    occurredAt: string;
  }>;
}

export interface StaffingAuthorityListResponse {
  authorities: StaffingAuthority[];
}

interface DraftValues {
  authorityType: AuthorityType;
  referenceNo: string;
  issuedDate: string;
  effectiveDate: string;
  sourceIssuer: string;
  sourceTitle: string;
  sourceLocator: string;
  rowVersion?: number;
}

type DialogKind = 'create' | 'edit' | 'evidence' | 'activate' | 'supersede' | 'revoke' | 'detail';

const authorityTypes: readonly { value: AuthorityType; label: string }[] = [
  { value: 'LAW', label: 'Law' },
  { value: 'EXECUTIVE_ORDER', label: 'Executive Order' },
  { value: 'DBM_APPROVAL', label: 'DBM Approval' },
  { value: 'BOARD_RESOLUTION', label: 'Board Resolution' },
  { value: 'OTHER', label: 'Other' },
];

function emptyDraft(): DraftValues {
  return {
    authorityType: 'LAW',
    referenceNo: '',
    issuedDate: manilaToday(),
    effectiveDate: manilaToday(),
    sourceIssuer: '',
    sourceTitle: '',
    sourceLocator: '',
  };
}

function dateLabel(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

function typeLabel(value: AuthorityType): string {
  return authorityTypes.find((type) => type.value === value)?.label ?? value;
}

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const error = (value as { error?: { message?: unknown } }).error;
  return typeof error?.message === 'string' ? error.message : fallback;
}

const statusTone: Record<AuthorityStatus, StatusTone> = {
  DRAFT: 'warning',
  ACTIVE: 'success',
  SUPERSEDED: 'neutral',
  REVOKED: 'neutral',
};

const sectionTitleClass = 'm-0 text-panel-title text-ink';

function authorityPayload(values: DraftValues): Record<string, unknown> {
  const sourceMetadata = Object.fromEntries(
    [
      ['issuer', values.sourceIssuer],
      ['title', values.sourceTitle],
      ['locator', values.sourceLocator],
    ].filter(([, value]) => typeof value === 'string' && value.trim()),
  );
  return {
    authorityType: values.authorityType,
    referenceNo: values.referenceNo,
    issuedDate: values.issuedDate,
    effectiveDate: values.effectiveDate,
    sourceMetadata,
    ...(values.rowVersion === undefined ? {} : { rowVersion: values.rowVersion }),
  };
}

function draftValues(authority: StaffingAuthority): DraftValues {
  return {
    authorityType: authority.authorityType,
    referenceNo: authority.referenceNo,
    issuedDate: authority.issuedDate,
    effectiveDate: authority.effectiveDate,
    sourceIssuer: authority.sourceMetadata.issuer ?? '',
    sourceTitle: authority.sourceMetadata.title ?? '',
    sourceLocator: authority.sourceMetadata.locator ?? '',
    rowVersion: authority.rowVersion,
  };
}

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function validForm(event: FormEvent<HTMLFormElement>): boolean {
  return (event.currentTarget as unknown as { reportValidity(): boolean }).reportValidity();
}

export function StaffingAuthorityWorkspace({
  agencyId,
  initial,
  canCreate,
  canUpdate,
  canValidateEvidence,
  canActivate,
  canSupersede,
  canRevoke,
}: {
  agencyId: string;
  initial: StaffingAuthorityListResponse;
  canCreate: boolean;
  canUpdate: boolean;
  canValidateEvidence: boolean;
  canActivate: boolean;
  canSupersede: boolean;
  canRevoke: boolean;
}) {
  const [authorities, setAuthorities] = useState(initial.authorities);
  const navigation = useRecordNavigation();
  const recordId = navigation.search.get('record');
  useEffect(() => {
    let active = true;
    setDetail(null);
    setSelected(null);
    setError('');
    if (!recordId) {
      setDialog(null);
      setSelected(null);
      return;
    }
    setDialog('detail');
    setDetailLoading(true);
    void request('/' + encodeURIComponent(recordId))
      .then((value) => {
        if (!active) return;
        const next = value as StaffingAuthorityDetail;
        setDetail(next);
        setSelected(next.authority);
      })
      .catch((error: unknown) => {
        if (active)
          setError(error instanceof Error ? error.message : 'This record is unavailable.');
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [recordId]);

  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [loadedSelected, setSelected] = useState<StaffingAuthority | null>(null);
  const selected =
    loadedSelected && (!recordId || loadedSelected.id === recordId) ? loadedSelected : null;
  const [draft, setDraft] = useState(emptyDraft);
  const [documentId, setDocumentId] = useState('');
  const [reason, setReason] = useState('');
  const [revocationDate, setRevocationDate] = useState(manilaToday());
  const [successorId, setSuccessorId] = useState('');
  const [loadedDetail, setDetail] = useState<StaffingAuthorityDetail | null>(null);
  const detail =
    loadedDetail && (!recordId || loadedDetail.authority.id === recordId) ? loadedDetail : null;
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  const returnFocusRef = useRef<{ focus(): void } | null>(null);

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(`/api/v1/agencies/${agencyId}/staffing-authorities${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorMessage(value, 'The Staffing Authority action failed.'));
    return value;
  }

  async function refresh(): Promise<void> {
    const value = await request('');
    if (
      typeof value !== 'object' ||
      value === null ||
      !Array.isArray((value as { authorities?: unknown }).authorities)
    ) {
      throw new Error('The Staffing Authority list response was invalid.');
    }
    setAuthorities((value as StaffingAuthorityListResponse).authorities);
  }

  function resetAction(): void {
    setError('');
    setReason('');
    setDocumentId('');
    setSuccessorId('');
    setRevocationDate(manilaToday());
  }

  function openDialog(
    kind: DialogKind,
    authority: StaffingAuthority | null,
    target: { focus(): void },
  ): void {
    returnFocusRef.current = target;
    resetAction();
    setSelected(authority);
    setDetail(null);
    setDialog(kind);
  }

  function closeDialog(force = false): void {
    if (busy && !force) return;
    navigation.navigate({ record: null, view: null });
    setDialog(null);
    setSelected(null);
    setDetail(null);
    setTimeout(() => returnFocusRef.current?.focus(), 0);
  }

  async function openDetail(
    authority: StaffingAuthority,
    target: { focus(): void },
  ): Promise<void> {
    returnFocusRef.current = target;
    navigation.navigate({ record: authority.id, view: 'form' });
  }

  async function submitDraft(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !validForm(event)) return;
    setBusy(true);
    setError('');
    try {
      const value = await request(dialog === 'edit' && selected ? `/${selected.id}` : '', {
        method: dialog === 'edit' ? 'PATCH' : 'POST',
        body: JSON.stringify(authorityPayload(draft)),
      });
      if (
        typeof value !== 'object' ||
        value === null ||
        typeof (value as StaffingAuthority).id !== 'string'
      ) {
        throw new Error('The Staffing Authority was not returned by the API.');
      }
      await refresh();
      setSuccess(
        dialog === 'edit'
          ? `Draft Staffing Authority “${draft.referenceNo}” was updated.`
          : `Draft Staffing Authority “${draft.referenceNo}” was created.`,
      );
      setBusy(false);
      closeDialog(true);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : 'The Draft could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitEvidence(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || busy || !validForm(event)) return;
    setBusy(true);
    setError('');
    try {
      await request(`/${selected.id}/evidence`, {
        method: 'POST',
        body: JSON.stringify({ documentId, validationReason: reason }),
      });
      await refresh();
      setSuccess(`External Evidence was validated for “${selected.referenceNo}”.`);
      setBusy(false);
      closeDialog(true);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The evidence could not be validated.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitActivation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || busy || !validForm(event)) return;
    setBusy(true);
    setError('');
    try {
      await request(`/${selected.id}/activate`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      await refresh();
      setSuccess(`Staffing Authority “${selected.referenceNo}” is now Active.`);
      setBusy(false);
      closeDialog(true);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The authority could not be activated.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitSupersession(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || busy || !validForm(event)) return;
    setBusy(true);
    setError('');
    try {
      await request(`/${selected.id}/supersede`, {
        method: 'POST',
        body: JSON.stringify({ successorId, reason }),
      });
      await refresh();
      setSuccess(`Staffing Authority “${selected.referenceNo}” was superseded prospectively.`);
      setBusy(false);
      closeDialog(true);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The authority could not be superseded.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitRevocation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || busy || !validForm(event)) return;
    setBusy(true);
    setError('');
    try {
      await request(`/${selected.id}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ effectiveDate: revocationDate, reason, documentId }),
      });
      await refresh();
      setSuccess(
        `Staffing Authority “${selected.referenceNo}” was revoked with its history preserved.`,
      );
      setBusy(false);
      closeDialog(true);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The authority could not be revoked.',
      );
    } finally {
      setBusy(false);
    }
  }

  function setDraftField<K extends keyof DraftValues>(field: K, value: DraftValues[K]): void {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function recordActions(authority: StaffingAuthority) {
    function openAction(kind: DialogKind) {
      return (event: { currentTarget: EventTarget }) =>
        openDialog(kind, authority, event.currentTarget as unknown as { focus(): void });
    }
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={(event) =>
            void openDetail(authority, event.currentTarget as unknown as { focus(): void })
          }
        >
          Details
        </Button>
        {authority.status === 'DRAFT' && canUpdate ? (
          <Button
            type="button"
            variant="secondary"
            onClick={(event) => {
              setDraft(draftValues(authority));
              openAction('edit')(event);
            }}
          >
            Edit Draft
          </Button>
        ) : null}
        {authority.status === 'DRAFT' && canValidateEvidence ? (
          <Button type="button" variant="secondary" onClick={openAction('evidence')}>
            Validate Evidence
          </Button>
        ) : null}
        {authority.status === 'DRAFT' && canActivate ? (
          <Button type="button" variant="primary" onClick={openAction('activate')}>
            Activate
          </Button>
        ) : null}
        {authority.status === 'ACTIVE' && canSupersede ? (
          <Button type="button" variant="secondary" onClick={openAction('supersede')}>
            Supersede
          </Button>
        ) : null}
        {authority.status === 'ACTIVE' && canRevoke ? (
          <Button
            className="border-danger text-danger hover:bg-danger/5"
            type="button"
            variant="secondary"
            onClick={openAction('revoke')}
          >
            Revoke
          </Button>
        ) : null}
      </div>
    );
  }

  const selectedTitle = selected?.referenceNo || 'Staffing Authority';
  const inline = dialog === 'detail' || dialog === 'create' || dialog === 'edit';
  const breadcrumbs: Breadcrumb[] = [{ label: 'Structure' }];
  // Create and Edit leave the URL alone, so only the detail view can link back to the register.
  if (dialog === 'detail') {
    breadcrumbs.push(
      { label: 'Staffing Authorities', href: navigation.href({ record: null, view: null }) },
      { label: selectedTitle },
    );
  } else if (dialog === 'create' || dialog === 'edit') {
    breadcrumbs.push(
      { label: 'Staffing Authorities' },
      { label: dialog === 'create' ? 'Register' : `Edit ${selectedTitle}` },
    );
  }

  // The Dialog root renders no markup. The page header stays mounted so its Register trigger can
  // take focus back when the inline form closes.
  return (
    <Dialog
      presentation={inline ? 'form' : 'dialog'}
      open={dialog !== null}
      onOpenChange={(open) => !open && closeDialog()}
    >
      <div className="grid gap-5">
        <PageHeader
          breadcrumbs={breadcrumbs}
          title="Staffing Authorities"
          actions={
            canCreate ? (
              <DialogTrigger asChild>
                <Button
                  // Hidden rather than unmounted, so focus can return here when the form closes.
                  hidden={inline}
                  type="button"
                  variant="primary"
                  onClick={(event) => {
                    setDraft(emptyDraft());
                    returnFocusRef.current = event.currentTarget as unknown as { focus(): void };
                    resetAction();
                    setDialog('create');
                  }}
                >
                  Register Staffing Authority
                </Button>
              </DialogTrigger>
            ) : null
          }
        />

        <Panel
          title="Agency register"
          flush
          hidden={inline}
          actions={
            <span className="text-caption text-ink-muted">Agency scoped · Evidence required</span>
          }
        >
          <div className="grid gap-3 px-4 pt-3">
            <p className="m-0 text-small text-ink-muted">
              Record the evidence-backed authorities that can support Organization and Plantilla
              actions. Drafts never authorize an action.
            </p>
            {success ? (
              <p role="status" className="m-0 text-small text-success">
                {success}
              </p>
            ) : null}
          </div>
          {authorities.length === 0 ? (
            <StateSurface compact label="Staffing Authority register">
              <strong className="text-body font-[650] text-ink">
                No Staffing Authorities yet.
              </strong>
              <p className="m-0 max-w-[520px]">
                Register a Draft with its official reference and source metadata, then link and
                validate External Evidence before activation.
              </p>
            </StateSurface>
          ) : (
            <>
              <Table className="mt-3 min-w-[760px]">
                <thead>
                  <tr>
                    <Th>Authority</Th>
                    <Th kind="date">Effectivity</Th>
                    <Th>Evidence</Th>
                    <Th>Status</Th>
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {authorities.map((authority) => (
                    <Tr key={authority.id}>
                      <Td>
                        <button
                          className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-primary hover:underline"
                          type="button"
                          onClick={(event) =>
                            void openDetail(
                              authority,
                              event.currentTarget as unknown as { focus(): void },
                            )
                          }
                        >
                          {authority.referenceNo}
                        </button>
                        <span className="block text-caption text-ink-muted">
                          {typeLabel(authority.authorityType)}
                        </span>
                      </Td>
                      <Td kind="date">{dateLabel(authority.effectiveDate)}</Td>
                      <Td className="text-ink-muted">
                        {authority.evidence
                          ? `Validated · ${authority.evidence.documentNo ?? authority.evidence.documentId}`
                          : 'Not linked'}
                      </Td>
                      <Td>
                        <StatusTag tone={statusTone[authority.status]}>
                          {authority.status}
                        </StatusTag>
                      </Td>
                      <Td>{recordActions(authority)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <TableFooter shown={authorities.length} total={authorities.length} />
            </>
          )}
        </Panel>

        <DialogContent aria-describedby="staffing-authority-dialog-description">
          <DialogHeader>
            <div className="grid min-w-0 gap-1.5">
              <DialogTitle>
                {dialog === 'create'
                  ? 'Register Staffing Authority'
                  : dialog === 'edit'
                    ? 'Edit Draft Staffing Authority'
                    : dialog === 'evidence'
                      ? `Validate Evidence · ${selectedTitle}`
                      : dialog === 'activate'
                        ? `Activate ${selectedTitle}`
                        : dialog === 'supersede'
                          ? `Supersede ${selectedTitle}`
                          : dialog === 'revoke'
                            ? `Revoke ${selectedTitle}`
                            : `Staffing Authority · ${selectedTitle}`}
              </DialogTitle>
              <DialogDescription id="staffing-authority-dialog-description">
                {dialog === 'create' || dialog === 'edit'
                  ? 'Record official metadata first. The record remains Draft until External Evidence is linked and validated.'
                  : dialog === 'evidence'
                    ? 'Review the same-Agency External Evidence and record why it supports this authority.'
                    : dialog === 'activate'
                      ? 'Activation is available only after validated External Evidence is present.'
                      : dialog === 'supersede'
                        ? 'Use a validated Draft successor to close this authority prospectively.'
                        : dialog === 'revoke'
                          ? 'Record the effective revocation and its supporting evidence. Existing position history is not rewritten.'
                          : 'Inspect the authority, its evidence, and its immutable transition history.'}
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button aria-label="Close Staffing Authority dialog" disabled={busy} type="button">
                <span aria-hidden="true" className="text-xl leading-none">
                  ×
                </span>
              </Button>
            </DialogClose>
          </DialogHeader>

          {dialog === 'detail' ? (
            <DialogBody className="grid gap-6">
              {selected ? recordActions(selected) : null}
              {detailLoading ? (
                <StateSurface compact busy label="Authority history">
                  <p className="m-0">Loading authority history…</p>
                </StateSurface>
              ) : null}
              <FormError message={error} />
              {detail ? (
                <>
                  <dl className="m-0 grid gap-x-10 gap-y-4 min-[621px]:grid-cols-2">
                    {(
                      [
                        ['Official reference', detail.authority.referenceNo],
                        ['Authority type', typeLabel(detail.authority.authorityType)],
                        ['Issue date', dateLabel(detail.authority.issuedDate)],
                        ['Effective date', dateLabel(detail.authority.effectiveDate)],
                        [
                          'Status',
                          <StatusTag key="status" tone={statusTone[detail.authority.status]}>
                            {detail.authority.status}
                          </StatusTag>,
                        ],
                        [
                          'Revocation effectivity',
                          detail.authority.revokedEffectiveDate
                            ? dateLabel(detail.authority.revokedEffectiveDate)
                            : '—',
                        ],
                      ] satisfies [string, ReactNode][]
                    ).map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-caption text-ink-muted">{label}</dt>
                        <dd className="m-0 text-body font-[600] text-ink">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <section className="grid gap-2" aria-labelledby="authority-source-metadata-title">
                    <h3 className={sectionTitleClass} id="authority-source-metadata-title">
                      Source metadata
                    </h3>
                    <pre className="m-0 overflow-auto rounded-control border border-border bg-canvas p-3 font-mono text-caption whitespace-pre-wrap text-ink">
                      {JSON.stringify(detail.authority.sourceMetadata, null, 2)}
                    </pre>
                  </section>
                  <section className="grid gap-2" aria-labelledby="authority-evidence-title">
                    <h3 className={sectionTitleClass} id="authority-evidence-title">
                      External Evidence
                    </h3>
                    <p className="m-0 text-body text-ink">
                      {detail.authority.evidence ? (
                        <>
                          {detail.authority.evidence.documentNo ??
                            detail.authority.evidence.documentId}{' '}
                          · {detail.authority.evidence.status} · validated{' '}
                          {dateLabel(detail.authority.evidence.validatedAt)}
                        </>
                      ) : (
                        'No validated External Evidence linked.'
                      )}
                    </p>
                    {detail.authority.revocationEvidence ? (
                      <p className="m-0 text-body text-ink">
                        Revocation evidence:{' '}
                        {detail.authority.revocationEvidence.documentNo ??
                          detail.authority.revocationEvidence.documentId}{' '}
                        · {detail.authority.revocationEvidence.status}
                      </p>
                    ) : null}
                  </section>
                  <section className="grid gap-2" aria-labelledby="authority-history-title">
                    <h3 className={sectionTitleClass} id="authority-history-title">
                      History
                    </h3>
                    {detail.history.length ? (
                      <div className="rounded-control border border-border">
                        <Table aria-labelledby="authority-history-title">
                          <thead>
                            <tr>
                              <Th>Action</Th>
                              <Th>Status change</Th>
                              <Th kind="date">Effective</Th>
                              <Th>Reason</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.history.map((event) => (
                              <Tr key={event.id}>
                                <Td className="font-[600] text-ink">{event.action}</Td>
                                <Td className="whitespace-nowrap">
                                  {event.previousStatus ?? 'None'} → {event.newStatus ?? '—'}
                                </Td>
                                <Td kind="date">
                                  {event.effectiveDate ? dateLabel(event.effectiveDate) : '—'}
                                </Td>
                                <Td className="text-ink-muted">{event.reason ?? '—'}</Td>
                              </Tr>
                            ))}
                          </tbody>
                        </Table>
                      </div>
                    ) : (
                      <p className="m-0 text-small text-ink-muted">
                        No transition history recorded.
                      </p>
                    )}
                  </section>
                </>
              ) : null}
            </DialogBody>
          ) : dialog === 'create' || dialog === 'edit' ? (
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={(event) => void submitDraft(event)}
            >
              <DialogBody className="grid gap-5">
                <div className="grid gap-5 min-[621px]:grid-cols-2">
                  <Field label="Authority type">
                    <select
                      className={inputClass}
                      value={draft.authorityType}
                      onChange={(event) =>
                        setDraftField('authorityType', targetValue(event) as AuthorityType)
                      }
                    >
                      {authorityTypes.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Official reference">
                    <input
                      className={inputClass}
                      autoFocus={dialog === 'create' || dialog === 'edit'}
                      data-autofocus={dialog === 'create' || dialog === 'edit' ? '' : undefined}
                      maxLength={200}
                      required
                      value={draft.referenceNo}
                      onChange={(event) => setDraftField('referenceNo', targetValue(event))}
                    />
                  </Field>
                  <Field label="Issue date">
                    <input
                      className={inputClass}
                      type="date"
                      required
                      value={draft.issuedDate}
                      onChange={(event) => setDraftField('issuedDate', targetValue(event))}
                    />
                  </Field>
                  <Field label="Effective date">
                    <input
                      className={inputClass}
                      type="date"
                      required
                      value={draft.effectiveDate}
                      onChange={(event) => setDraftField('effectiveDate', targetValue(event))}
                    />
                  </Field>
                </div>
                <div className="grid gap-3">
                  <div>
                    <h3 className={sectionTitleClass}>Source metadata</h3>
                    <p className="m-0 mt-1 text-caption text-ink-muted">
                      Optional locator details for the official source.
                    </p>
                  </div>
                  <div className="grid gap-5 min-[621px]:grid-cols-2">
                    <Field label="Source issuer">
                      <input
                        className={inputClass}
                        maxLength={500}
                        value={draft.sourceIssuer}
                        onChange={(event) => setDraftField('sourceIssuer', targetValue(event))}
                      />
                    </Field>
                    <Field label="Source title">
                      <input
                        className={inputClass}
                        maxLength={500}
                        value={draft.sourceTitle}
                        onChange={(event) => setDraftField('sourceTitle', targetValue(event))}
                      />
                    </Field>
                  </div>
                  <Field label="Source locator">
                    <input
                      className={inputClass}
                      maxLength={500}
                      value={draft.sourceLocator}
                      onChange={(event) => setDraftField('sourceLocator', targetValue(event))}
                    />
                  </Field>
                </div>
                <FormError message={error} />
              </DialogBody>
              <DialogFooter>
                <span className="mr-auto hidden self-center text-caption text-ink-muted min-[621px]:block">
                  Draft only · External Evidence is required before activation.
                </span>
                <DialogClose asChild>
                  <Button disabled={busy} size="default" type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} size="default" type="submit" variant="primary">
                  {busy ? 'Saving…' : dialog === 'edit' ? 'Save Draft' : 'Create Draft'}
                </Button>
              </DialogFooter>
            </form>
          ) : dialog === 'evidence' ? (
            <form onSubmit={(event) => void submitEvidence(event)}>
              <DialogBody className="grid gap-5">
                <Field label="External Evidence document ID">
                  <input
                    className={inputClass}
                    autoFocus
                    required
                    pattern="[0-9a-fA-F-]{36}"
                    value={documentId}
                    onChange={(event) => setDocumentId(targetValue(event))}
                  />
                </Field>
                <Field label="Validation reason">
                  <textarea
                    className={`${inputClass} min-h-28 py-3`}
                    maxLength={500}
                    required
                    value={reason}
                    onChange={(event) => setReason(targetValue(event))}
                  />
                </Field>
                <FormError message={error} />
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} size="default" type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} size="default" type="submit" variant="primary">
                  {busy ? 'Validating…' : 'Validate Evidence'}
                </Button>
              </DialogFooter>
            </form>
          ) : dialog === 'activate' ? (
            <form onSubmit={(event) => void submitActivation(event)}>
              <DialogBody className="grid gap-5">
                <Field label="Activation reason">
                  <textarea
                    className={`${inputClass} min-h-28 py-3`}
                    autoFocus
                    maxLength={500}
                    required
                    value={reason}
                    onChange={(event) => setReason(targetValue(event))}
                  />
                </Field>
                <FormError message={error} />
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} size="default" type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} size="default" type="submit" variant="primary">
                  {busy ? 'Activating…' : 'Activate Staffing Authority'}
                </Button>
              </DialogFooter>
            </form>
          ) : dialog === 'supersede' ? (
            <form onSubmit={(event) => void submitSupersession(event)}>
              <DialogBody className="grid gap-5">
                <Field label="Successor Draft ID">
                  <input
                    className={inputClass}
                    autoFocus
                    required
                    pattern="[0-9a-fA-F-]{36}"
                    value={successorId}
                    onChange={(event) => setSuccessorId(targetValue(event))}
                  />
                </Field>
                <Field label="Supersession reason">
                  <textarea
                    className={`${inputClass} min-h-28 py-3`}
                    maxLength={500}
                    required
                    value={reason}
                    onChange={(event) => setReason(targetValue(event))}
                  />
                </Field>
                <FormError message={error} />
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} size="default" type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} size="default" type="submit" variant="primary">
                  {busy ? 'Superseding…' : 'Supersede Staffing Authority'}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <form onSubmit={(event) => void submitRevocation(event)}>
              <DialogBody className="grid gap-5">
                <Field label="Revocation effective date">
                  <input
                    className={inputClass}
                    autoFocus
                    type="date"
                    required
                    value={revocationDate}
                    onChange={(event) => setRevocationDate(targetValue(event))}
                  />
                </Field>
                <Field label="Revocation reason">
                  <textarea
                    className={`${inputClass} min-h-28 py-3`}
                    maxLength={500}
                    required
                    value={reason}
                    onChange={(event) => setReason(targetValue(event))}
                  />
                </Field>
                <Field label="Revocation evidence document ID">
                  <input
                    className={inputClass}
                    required
                    pattern="[0-9a-fA-F-]{36}"
                    value={documentId}
                    onChange={(event) => setDocumentId(targetValue(event))}
                  />
                </Field>
                <FormError message={error} />
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} size="default" type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} size="default" type="submit" variant="primary">
                  {busy ? 'Revoking…' : 'Record Revocation'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </div>
    </Dialog>
  );
}
