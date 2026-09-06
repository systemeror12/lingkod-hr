'use client';

import { Field, inputClass, FormError } from './ui/field';

import { RecordReturn, useRecordNavigation } from './record-navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
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

function statusClass(status: AuthorityStatus): string {
  if (status === 'ACTIVE') return 'bg-[#e8f3ed] text-[#316647]';
  if (status === 'REVOKED' || status === 'SUPERSEDED') return 'bg-[#f0f2f5] text-muted';
  return 'bg-[#fff3d6] text-[#79531c]';
}

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
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="default"
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
            size="default"
            type="button"
            variant="secondary"
            onClick={(event) => {
              setDraft(draftValues(authority));
              openDialog('edit', authority, event.currentTarget as unknown as { focus(): void });
            }}
          >
            Edit Draft
          </Button>
        ) : null}
        {authority.status === 'DRAFT' && canValidateEvidence ? (
          <Button
            size="default"
            type="button"
            variant="secondary"
            onClick={(event) =>
              openDialog('evidence', authority, event.currentTarget as unknown as { focus(): void })
            }
          >
            Validate Evidence
          </Button>
        ) : null}
        {authority.status === 'DRAFT' && canActivate ? (
          <Button
            className="min-h-9 px-3 text-xs"
            size="default"
            type="button"
            variant="primary"
            onClick={(event) =>
              openDialog('activate', authority, event.currentTarget as unknown as { focus(): void })
            }
          >
            Activate
          </Button>
        ) : null}
        {authority.status === 'ACTIVE' && canSupersede ? (
          <Button
            size="default"
            type="button"
            variant="secondary"
            onClick={(event) =>
              openDialog(
                'supersede',
                authority,
                event.currentTarget as unknown as { focus(): void },
              )
            }
          >
            Supersede
          </Button>
        ) : null}
        {authority.status === 'ACTIVE' && canRevoke ? (
          <Button
            className="border border-[#d9a5a5] bg-paper px-3 py-2 text-xs font-[650] text-[#9a3030] hover:bg-[#fff4f4]"
            size="default"
            type="button"
            onClick={(event) =>
              openDialog('revoke', authority, event.currentTarget as unknown as { focus(): void })
            }
          >
            Revoke
          </Button>
        ) : null}
      </div>
    );
  }

  const selectedTitle = selected?.referenceNo || 'Staffing Authority';

  return (
    <Dialog
      presentation={
        dialog === 'detail' || dialog === 'create' || dialog === 'edit' ? 'form' : 'dialog'
      }
      open={dialog !== null}
      onOpenChange={(open) => !open && closeDialog()}
    >
      <div
        hidden={dialog === 'detail' || dialog === 'create' || dialog === 'edit'}
        className="min-w-0 space-y-5"
      >
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div className="grid max-w-[720px] gap-2">
            <p className="m-0 text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
              Authority register
            </p>
            <h1 className="m-0 text-[clamp(28px,3vw,38px)] leading-[1.08] font-[680] tracking-[-0.035em] text-midnight">
              Staffing Authorities
            </h1>
            <p className="m-0 text-sm leading-[1.65] text-muted">
              Record the evidence-backed authorities that can support Organization and Plantilla
              actions. Drafts never authorize an action.
            </p>
          </div>
          {canCreate ? (
            <DialogTrigger asChild>
              <Button
                className="min-h-11"
                size="default"
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
          ) : null}
        </header>

        {success ? (
          <p
            className="m-0 rounded-[3px] border border-[#b9d8c3] bg-[#f2faf4] px-4 py-3 text-sm text-[#316647]"
            role="status"
          >
            {success}
          </p>
        ) : null}

        <section
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
          aria-labelledby="staffing-authority-register-heading"
        >
          <header className="flex min-h-[60px] flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
            <div className="grid gap-1">
              <h2
                className="m-0 text-sm font-[670] text-midnight"
                id="staffing-authority-register-heading"
              >
                Agency register
              </h2>
              <span className="text-xs text-muted">
                {authorities.length === 1 ? '1 authority' : `${authorities.length} authorities`}
              </span>
            </div>
            <span className="rounded-full bg-pale-blue px-2.5 py-1 text-xs font-[650] text-cobalt">
              Agency scoped · Evidence required
            </span>
          </header>

          {authorities.length === 0 ? (
            <div className="grid min-h-[260px] place-content-center gap-2 px-6 py-12">
              <strong className="text-[15px] font-[650] text-midnight">
                No Staffing Authorities yet.
              </strong>
              <p className="m-0 max-w-[520px] text-[13px] leading-[1.6] text-muted">
                Register a Draft with its official reference and source metadata, then link and
                validate External Evidence before activation.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead className="bg-canvas text-[11px] tracking-[0.07em] text-muted uppercase">
                  <tr>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Authority
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Effectivity
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Evidence
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Status
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {authorities.map((authority) => (
                    <tr key={authority.id}>
                      <td className="px-5 py-4 align-top">
                        <div className="grid gap-1">
                          <button
                            className="w-fit cursor-pointer text-left font-[670] text-cobalt underline-offset-2 hover:underline"
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
                          <span className="text-xs text-muted">
                            {typeLabel(authority.authorityType)}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-ink">
                        {dateLabel(authority.effectiveDate)}
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-muted">
                        {authority.evidence
                          ? `Validated · ${authority.evidence.documentNo ?? authority.evidence.documentId}`
                          : 'Not linked'}
                      </td>
                      <td className="px-5 py-4 align-top">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.07em] uppercase ${statusClass(authority.status)}`}
                        >
                          {authority.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-top">{recordActions(authority)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {dialog === 'detail' ? (
        <div className="mb-4">
          <RecordReturn href={navigation.href({ record: null, view: null })}>
            ← Staffing Authorities
          </RecordReturn>
        </div>
      ) : null}
      <DialogContent aria-describedby="staffing-authority-dialog-description">
        <DialogHeader>
          <div className="grid min-w-0 gap-1.5">
            <p className="m-0 text-[11px] font-bold tracking-[0.08em] text-cobalt uppercase">
              Staffing Authority register
            </p>
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
            <Button
              aria-label="Close Staffing Authority dialog"
              className="border border-line bg-paper text-muted hover:bg-canvas"
              disabled={busy}
              type="button"
            >
              <span aria-hidden="true" className="text-xl leading-none">
                ×
              </span>
            </Button>
          </DialogClose>
        </DialogHeader>

        {dialog === 'detail' ? (
          <DialogBody>
            {selected ? recordActions(selected) : null}
            {detailLoading ? (
              <p className="m-0 text-sm text-muted">Loading authority history…</p>
            ) : null}
            {error ? <FormError message={error} /> : null}
            {detail ? (
              <div className="grid gap-7">
                <dl className="grid gap-4 text-sm min-[621px]:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted">Official reference</dt>
                    <dd className="m-0 font-[650] text-ink">{detail.authority.referenceNo}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Authority type</dt>
                    <dd className="m-0 text-ink">{typeLabel(detail.authority.authorityType)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Issue date</dt>
                    <dd className="m-0 text-ink">{dateLabel(detail.authority.issuedDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Effective date</dt>
                    <dd className="m-0 text-ink">{dateLabel(detail.authority.effectiveDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Status</dt>
                    <dd className="m-0 text-ink">{detail.authority.status}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Revocation effectivity</dt>
                    <dd className="m-0 text-ink">
                      {detail.authority.revokedEffectiveDate
                        ? dateLabel(detail.authority.revokedEffectiveDate)
                        : '—'}
                    </dd>
                  </div>
                </dl>
                <section className="grid gap-2" aria-labelledby="authority-source-metadata-title">
                  <h3
                    className="m-0 text-[11px] font-bold tracking-[0.08em] text-cobalt uppercase"
                    id="authority-source-metadata-title"
                  >
                    Source metadata
                  </h3>
                  <pre className="m-0 overflow-auto rounded-[3px] border border-line bg-canvas p-3 font-mono text-xs leading-[1.6] whitespace-pre-wrap text-ink">
                    {JSON.stringify(detail.authority.sourceMetadata, null, 2)}
                  </pre>
                </section>
                <section className="grid gap-2" aria-labelledby="authority-evidence-title">
                  <h3
                    className="m-0 text-[11px] font-bold tracking-[0.08em] text-cobalt uppercase"
                    id="authority-evidence-title"
                  >
                    External Evidence
                  </h3>
                  <div className="rounded-[3px] border border-line bg-canvas px-3 py-3 text-sm text-ink">
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
                  </div>
                  {detail.authority.revocationEvidence ? (
                    <div className="rounded-[3px] border border-line bg-canvas px-3 py-3 text-sm text-ink">
                      Revocation evidence:{' '}
                      {detail.authority.revocationEvidence.documentNo ??
                        detail.authority.revocationEvidence.documentId}{' '}
                      · {detail.authority.revocationEvidence.status}
                    </div>
                  ) : null}
                </section>
                <section className="grid gap-2" aria-labelledby="authority-history-title">
                  <h3
                    className="m-0 text-[11px] font-bold tracking-[0.08em] text-cobalt uppercase"
                    id="authority-history-title"
                  >
                    History
                  </h3>
                  {detail.history.length ? (
                    <ol className="m-0 grid list-none gap-3 p-0">
                      {detail.history.map((event) => (
                        <li
                          className="rounded-[3px] border border-line bg-canvas px-3 py-3 text-xs leading-[1.6] text-ink"
                          key={event.id}
                        >
                          <strong className="font-[680]">{event.action}</strong> ·{' '}
                          {event.previousStatus ?? 'None'} → {event.newStatus ?? '—'}
                          {event.effectiveDate
                            ? ` · effective ${dateLabel(event.effectiveDate)}`
                            : ''}
                          {event.reason ? (
                            <span className="block text-muted">{event.reason}</span>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="m-0 text-sm text-muted">No transition history recorded.</p>
                  )}
                </section>
              </div>
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
                  <h3 className="m-0 text-sm font-[670] text-midnight">Source metadata</h3>
                  <p className="m-0 mt-1 text-xs text-muted">
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
              {error ? <FormError message={error} /> : null}
            </DialogBody>
            <DialogFooter>
              <span className="mr-auto hidden text-[11px] text-muted min-[621px]:block">
                Draft only · External Evidence is required before activation.
              </span>
              <DialogClose asChild>
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                className="min-h-11"
                disabled={busy}
                size="default"
                type="submit"
                variant="primary"
              >
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
              {error ? <FormError message={error} /> : null}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                className="min-h-11"
                disabled={busy}
                size="default"
                type="submit"
                variant="primary"
              >
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
              {error ? <FormError message={error} /> : null}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                className="min-h-11"
                disabled={busy}
                size="default"
                type="submit"
                variant="primary"
              >
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
              {error ? <FormError message={error} /> : null}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                className="min-h-11"
                disabled={busy}
                size="default"
                type="submit"
                variant="primary"
              >
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
              {error ? <FormError message={error} /> : null}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                className="min-h-11"
                disabled={busy}
                size="default"
                type="submit"
                variant="primary"
              >
                {busy ? 'Revoking…' : 'Record Revocation'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
