'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/class-names';
import { useRecordNavigation } from './record-navigation';
import { StateCode, StateSurface } from './state-surface';
import { Button } from './ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Field, FormError, inputClass } from './ui/field';
import { PageHeader } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag, type StatusTone } from './ui/status-tag';
import { RowHeader, Table, Td, Th, Tr } from './ui/table';

export type AgencyProfileType = 'NGA' | 'LGU' | 'SUC' | 'GOCC_ORIGINAL_CHARTER' | 'OTHER';
export type AgencyProfileVersionState = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'VOIDED';
export type AgencyProfileDomainStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

export interface AgencyProfileVersion {
  id: string;
  versionNo: number;
  versionState: AgencyProfileVersionState;
  domainStatus: AgencyProfileDomainStatus;
  officialName: string;
  acronym: string | null;
  agencyType: AgencyProfileType;
  parentOrganization: string | null;
  reportingIdentifiers: string | null;
  appointingAuthorityTitle: string | null;
  defaultTimezone: string;
  defaultCurrency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface AgencyProfileResponse {
  current: AgencyProfileVersion | null;
  draft: AgencyProfileVersion | null;
  versions: AgencyProfileVersion[];
}

type EditableProfile = {
  officialName: string;
  acronym: string;
  agencyType: AgencyProfileType;
  parentOrganization: string;
  reportingIdentifiers: string;
  appointingAuthorityTitle: string;
  defaultTimezone: string;
  defaultCurrency: string;
  effectiveFrom: string;
};

type ProfileField = keyof EditableProfile;

const agencyTypes: readonly { value: AgencyProfileType; label: string }[] = [
  { value: 'NGA', label: 'National Government Agency' },
  { value: 'LGU', label: 'Local Government Unit' },
  { value: 'SUC', label: 'State University or College' },
  { value: 'GOCC_ORIGINAL_CHARTER', label: 'GOCC with Original Charter' },
  { value: 'OTHER', label: 'Other public agency' },
];

const timezoneOptions = ['Asia/Manila', 'UTC', 'Asia/Tokyo', 'Europe/London', 'America/New_York'];
const currencyOptions = ['PHP', 'USD', 'EUR', 'JPY', 'SGD'];

const editableFields: readonly { key: ProfileField; label: string; optional?: boolean }[] = [
  { key: 'officialName', label: 'Official name' },
  { key: 'acronym', label: 'Acronym', optional: true },
  { key: 'agencyType', label: 'Agency type' },
  { key: 'parentOrganization', label: 'Parent organization', optional: true },
  { key: 'reportingIdentifiers', label: 'Reporting identifiers', optional: true },
  { key: 'appointingAuthorityTitle', label: 'Appointing-authority title', optional: true },
  { key: 'defaultTimezone', label: 'Default timezone' },
  { key: 'defaultCurrency', label: 'Default currency' },
];

function dateLabel(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-PH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

function tomorrow(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + 24 * 60 * 60 * 1000));
}

function periodLabel(version: AgencyProfileVersion): string {
  if (version.versionState === 'DRAFT') return `Proposed from ${dateLabel(version.effectiveFrom)}`;
  return `${dateLabel(version.effectiveFrom)} – ${version.effectiveTo ? dateLabel(version.effectiveTo) : 'present'}`;
}

function agencyTypeLabel(value: AgencyProfileType): string {
  return agencyTypes.find((type) => type.value === value)?.label ?? value;
}

/** Keep a stored value selectable when it is outside the usual options. */
function optionsWith(options: string[], value: string): string[] {
  return options.includes(value) ? options : [value, ...options];
}

function currencyLabel(value: string): string {
  return value === 'PHP' ? 'PHP — Philippine peso' : value;
}

const versionTone: Record<AgencyProfileVersionState, StatusTone> = {
  DRAFT: 'warning',
  ACTIVE: 'success',
  SUPERSEDED: 'neutral',
  VOIDED: 'danger',
};

function StateBadge({ state }: { state: AgencyProfileVersionState }) {
  return <StatusTag tone={versionTone[state]}>{state}</StatusTag>;
}

function FieldList({ version }: { version: AgencyProfileVersion }) {
  const values: Record<ProfileField, string> = {
    officialName: version.officialName,
    acronym: version.acronym ?? 'Not recorded',
    agencyType: agencyTypeLabel(version.agencyType),
    parentOrganization: version.parentOrganization ?? 'Not recorded',
    reportingIdentifiers: version.reportingIdentifiers ?? 'Not recorded',
    appointingAuthorityTitle: version.appointingAuthorityTitle ?? 'Not recorded',
    defaultTimezone: version.defaultTimezone,
    defaultCurrency: currencyLabel(version.defaultCurrency),
    effectiveFrom: periodLabel(version),
  };
  return (
    <dl className="m-0 grid gap-x-10 gap-y-4 min-[620px]:grid-cols-2">
      {editableFields.map(({ key, label }) => (
        <div key={key}>
          <dt className="text-caption text-ink-muted">{label}</dt>
          <dd className="m-0 text-body font-[600] text-ink">{values[key]}</dd>
        </div>
      ))}
    </dl>
  );
}

function emptyEditable(version: AgencyProfileVersion): EditableProfile {
  return {
    officialName: version.officialName,
    acronym: version.acronym ?? '',
    agencyType: version.agencyType,
    parentOrganization: version.parentOrganization ?? '',
    reportingIdentifiers: version.reportingIdentifiers ?? '',
    appointingAuthorityTitle: version.appointingAuthorityTitle ?? '',
    defaultTimezone: version.defaultTimezone,
    defaultCurrency: version.defaultCurrency,
    effectiveFrom: version.effectiveFrom,
  };
}

interface ErrorResponse {
  error?: { code?: unknown; message?: unknown; fields?: unknown };
}

type FocusableField = { focus?: (...args: never[]) => void };

function errorDetails(value: unknown): { message: string; fields: Record<string, string> } {
  if (typeof value !== 'object' || value === null) {
    return { message: 'The Agency Profile change could not be saved. Try again.', fields: {} };
  }
  const error = (value as ErrorResponse).error;
  const fields: Record<string, string> = {};
  if (typeof error?.fields === 'object' && error.fields !== null) {
    for (const [key, message] of Object.entries(error.fields)) {
      if (typeof message === 'string') fields[key] = message;
    }
  }
  return {
    message:
      typeof error?.message === 'string'
        ? error.message
        : 'The Agency Profile change could not be saved. Try again.',
    fields,
  };
}

function isProfileVersion(value: unknown): value is AgencyProfileVersion {
  if (typeof value !== 'object' || value === null) return false;
  const version = value as Partial<AgencyProfileVersion>;
  return (
    typeof version.id === 'string' &&
    typeof version.versionNo === 'number' &&
    typeof version.versionState === 'string' &&
    typeof version.domainStatus === 'string' &&
    typeof version.officialName === 'string' &&
    typeof version.agencyType === 'string' &&
    typeof version.defaultTimezone === 'string' &&
    typeof version.defaultCurrency === 'string' &&
    typeof version.effectiveFrom === 'string'
  );
}

function isProfileResponse(value: unknown): value is AgencyProfileResponse {
  if (typeof value !== 'object' || value === null) return false;
  const response = value as Partial<AgencyProfileResponse>;
  return (
    (response.current === null || isProfileVersion(response.current)) &&
    (response.draft === null || isProfileVersion(response.draft)) &&
    Array.isArray(response.versions) &&
    response.versions.every(isProfileVersion)
  );
}

function ProfileDialog({
  mode,
  draft,
  submitting,
  fieldErrors,
  formError,
  onClose,
  onSave,
  onActivate,
  registerField,
}: {
  mode: 'edit' | 'activate' | null;
  draft: AgencyProfileVersion | null;
  submitting: boolean;
  fieldErrors: Record<string, string>;
  formError: string;
  onClose(): void;
  onSave(values: EditableProfile): void;
  onActivate(effectiveDate: string, reason: string): void;
  registerField(field: string, element: FocusableField | null): void;
}) {
  const [values, setValues] = useState<EditableProfile | null>(null);
  const [effectiveDate, setEffectiveDate] = useState('');
  const [reason, setReason] = useState('');
  const firstFieldRef = useRef<FocusableField | null>(null);

  useEffect(() => {
    if (!mode || !draft) return;
    setValues(emptyEditable(draft));
    setEffectiveDate(draft.effectiveFrom);
    setReason('Approved prospective Agency identity and operating-context change.');
  }, [draft, mode]);

  const activeValues = values ?? (draft ? emptyEditable(draft) : null);

  function setField(field: ProfileField, value: string): void {
    setValues((current) => (current ? { ...current, [field]: value } : current));
  }

  function fieldRef(field: string, first: boolean) {
    return (element: FocusableField | null) => {
      registerField(field, element);
      if (first) firstFieldRef.current = element;
    };
  }

  function control(key: ProfileField, values: EditableProfile, first: boolean): ReactNode {
    const props = {
      ref: fieldRef(key, first),
      className: inputClass,
      value: values[key],
      onChange: (event: { target: unknown }) =>
        setField(key, (event.target as { value: string }).value),
    };
    const options =
      key === 'agencyType'
        ? agencyTypes
        : key === 'defaultTimezone'
          ? optionsWith(timezoneOptions, values.defaultTimezone).map((value) => ({
              value,
              label: value,
            }))
          : key === 'defaultCurrency'
            ? optionsWith(currencyOptions, values.defaultCurrency).map((value) => ({
                value,
                label: currencyOptions.includes(value) ? currencyLabel(value) : value,
              }))
            : null;
    return options ? (
      <select {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ) : (
      <input {...props} type="text" />
    );
  }

  return (
    <Dialog
      presentation={mode === 'edit' ? 'form' : 'dialog'}
      open={mode !== null && draft !== null}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent
        aria-busy={submitting}
        aria-describedby="agency-profile-dialog-description"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          firstFieldRef.current?.focus?.();
        }}
      >
        <DialogHeader>
          <div className="grid min-w-0 gap-1.5">
            <DialogTitle>
              {mode === 'activate' ? 'Review activation' : 'Edit draft successor'}
            </DialogTitle>
            <DialogDescription id="agency-profile-dialog-description">
              {mode === 'activate'
                ? 'Confirm when this version becomes authoritative. Prior versions remain available for every as-of read.'
                : 'Edit the successor fields before activation. Activated versions cannot be rewritten.'}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button
              className="min-w-9 shrink-0 px-0 text-xl"
              type="button"
              aria-label="Close Agency Profile dialog"
              disabled={submitting}
            >
              ×
            </Button>
          </DialogClose>
        </DialogHeader>

        <DialogBody>
          <FormError className="mb-4" message={formError} />
          {mode === 'activate' ? (
            <form
              className="grid gap-4"
              id="activate-agency-profile-form"
              onSubmit={(event) => {
                event.preventDefault();
                onActivate(effectiveDate, reason);
              }}
            >
              <div className="grid gap-1 rounded-control border border-border bg-canvas px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-small font-[650] text-ink">{draft?.officialName}</strong>
                  <StateBadge state="DRAFT" />
                </div>
                <p className="m-0 text-caption text-ink-muted">
                  In one step, the prior version closes the day before this effectivity, the
                  successor activates, the current projection refreshes, and the activation is
                  recorded in the Audit Log.
                </p>
              </div>
              <Field label="Effective date" error={fieldErrors.effectiveDate}>
                <input
                  ref={fieldRef('effectiveDate', mode === 'activate')}
                  className={inputClass}
                  type="date"
                  min={tomorrow()}
                  value={effectiveDate}
                  onChange={(event) =>
                    setEffectiveDate((event.target as unknown as { value: string }).value)
                  }
                  required
                />
              </Field>
              <Field label="Reason for change" error={fieldErrors.reason}>
                <textarea
                  ref={fieldRef('reason', false)}
                  className={cn(inputClass, 'min-h-24 resize-y py-2')}
                  value={reason}
                  onChange={(event) =>
                    setReason((event.target as unknown as { value: string }).value)
                  }
                  required
                />
              </Field>
            </form>
          ) : activeValues ? (
            <form
              className="grid gap-4"
              id="edit-agency-profile-form"
              onSubmit={(event) => {
                event.preventDefault();
                onSave(activeValues);
              }}
            >
              {editableFields.map(({ key, label, optional }, index) => (
                <Field
                  key={key}
                  label={
                    optional ? (
                      <>
                        {label} <span className="font-normal text-ink-muted">(optional)</span>
                      </>
                    ) : (
                      label
                    )
                  }
                  error={fieldErrors[key]}
                >
                  {control(key, activeValues, index === 0)}
                </Field>
              ))}
              <Field label="Proposed effective date" error={fieldErrors.effectiveFrom}>
                <input
                  ref={fieldRef('effectiveFrom', false)}
                  className={inputClass}
                  type="date"
                  min={tomorrow()}
                  value={activeValues.effectiveFrom}
                  onChange={(event) =>
                    setField('effectiveFrom', (event.target as unknown as { value: string }).value)
                  }
                  required
                />
              </Field>
            </form>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <span className="mr-auto hidden self-center text-caption text-ink-muted min-[621px]:block">
            Draft changes are saved to this Agency Context only.
          </span>
          <DialogClose asChild>
            <Button variant="secondary" type="button" disabled={submitting}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="primary"
            type="submit"
            form={mode === 'activate' ? 'activate-agency-profile-form' : 'edit-agency-profile-form'}
            disabled={submitting}
          >
            {submitting ? 'Saving…' : mode === 'activate' ? 'Activate successor' : 'Save draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AgencyProfileWorkspace({
  agencyId,
  canUpdate,
  initial,
  tabs,
}: {
  agencyId: string;
  canUpdate: boolean;
  initial: AgencyProfileResponse;
  /** Workspace tabs for the page header band. */
  tabs: ReactNode;
}) {
  const [data, setData] = useState(initial);
  const navigation = useRecordNavigation();
  const selectedId =
    navigation.search.get('agencyVersion') ?? data.current?.id ?? data.draft?.id ?? null;
  function setSelectedId(id: string) {
    navigation.navigate({ agencyVersion: id });
  }

  const [dialogMode, setDialogMode] = useState<'edit' | 'activate' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const fieldRefs = useRef<Record<string, FocusableField | null>>({});
  const returnFocusRef = useRef<FocusableField | null>(null);
  const previousDialogMode = useRef(dialogMode);

  useEffect(() => {
    const wasOpen = previousDialogMode.current !== null;
    previousDialogMode.current = dialogMode;
    if (!wasOpen || dialogMode !== null) return;
    const frame = setTimeout(() => restoreFocus(), 0);
    return () => clearTimeout(frame);
  }, [dialogMode]);

  const selected = data.versions.find((version) => version.id === selectedId) ?? null;
  const draft = data.draft;

  function focusField(field: string): void {
    const fieldKey =
      field === 'effectiveDate'
        ? 'effectiveDate'
        : field === 'reason'
          ? 'reason'
          : field === 'effectiveFrom'
            ? 'effectiveFrom'
            : field;
    fieldRefs.current[fieldKey]?.focus?.();
  }

  function focusFirstError(errors: Record<string, string>): void {
    const first = Object.keys(errors)[0];
    if (first) focusField(first);
  }

  function selectVersion(id: string): void {
    setSelectedId(id);
    setNotice('');
  }

  function openDialog(mode: 'edit' | 'activate', opener: FocusableField): void {
    if (!draft || selected?.id !== draft.id) return;
    setFieldErrors({});
    setFormError('');
    returnFocusRef.current = opener;
    setDialogMode(mode);
  }

  function restoreFocus(): void {
    const opener = returnFocusRef.current;
    returnFocusRef.current = null;
    opener?.focus?.();
  }

  async function prepareDraft(): Promise<void> {
    if (loadingDraft) return;
    setLoadingDraft(true);
    setFormError('');
    try {
      const response = await fetch(`/api/v1/agencies/${agencyId}/agency-profile/draft`, {
        method: 'POST',
        credentials: 'include',
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok || !isProfileVersion(value)) {
        setFormError(errorDetails(value).message);
        return;
      }
      setData((current) => ({
        ...current,
        draft: value,
        versions: [value, ...current.versions.filter((version) => version.id !== value.id)],
      }));
      setSelectedId(value.id);
      setNotice('Draft successor ready. Review its fields before activation.');
    } catch {
      setFormError('The Draft successor could not be prepared. Try again.');
    } finally {
      setLoadingDraft(false);
    }
  }

  async function saveDraft(values: EditableProfile): Promise<void> {
    const errors: Record<string, string> = {};
    if (!values.officialName.trim()) errors.officialName = 'Enter the official name.';
    if (!values.defaultTimezone.trim()) errors.defaultTimezone = 'Choose a default timezone.';
    if (!values.defaultCurrency.trim()) errors.defaultCurrency = 'Choose a default currency.';
    if (!values.effectiveFrom) errors.effectiveFrom = 'Choose a proposed effective date.';
    setFieldErrors(errors);
    setFormError('');
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors);
      return;
    }
    if (!draft) return;
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/v1/agencies/${agencyId}/agency-profile/draft/${draft.id}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(values),
        },
      );
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok || !isProfileVersion(value)) {
        const details = errorDetails(value);
        setFieldErrors(details.fields);
        setFormError(details.message);
        focusFirstError(details.fields);
        return;
      }
      setData((current) => ({
        ...current,
        draft: value,
        versions: [value, ...current.versions.filter((version) => version.id !== value.id)],
      }));
      setSelectedId(value.id);
      setDialogMode(null);
      setNotice('Draft successor saved. It remains a Draft until activation.');
    } catch {
      setFormError('The Draft successor could not be saved. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function refresh(): Promise<void> {
    const response = await fetch(`/api/v1/agencies/${agencyId}/agency-profile`, {
      credentials: 'include',
      cache: 'no-store',
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok || !isProfileResponse(value))
      throw new Error('Agency Profile refresh failed.');
    setData(value);
  }

  async function activate(effectiveDate: string, reason: string): Promise<void> {
    const errors: Record<string, string> = {};
    if (!effectiveDate) errors.effectiveDate = 'Choose an effective date.';
    if (!reason.trim()) errors.reason = 'Enter a reason for activation.';
    setFieldErrors(errors);
    setFormError('');
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors);
      return;
    }
    if (!draft) return;
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/v1/agencies/${agencyId}/agency-profile/draft/${draft.id}/activate`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ effectiveDate, reason }),
        },
      );
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok || !isProfileVersion(value)) {
        const details = errorDetails(value);
        setFieldErrors(details.fields);
        setFormError(details.message);
        focusFirstError(details.fields);
        return;
      }
      await refresh();
      setSelectedId(value.id);
      setDialogMode(null);
      setNotice(`Version ${value.versionNo} is activated for ${dateLabel(value.effectiveFrom)}.`);
    } catch {
      setFormError('The successor could not be activated. No profile version was changed.');
    } finally {
      setSubmitting(false);
    }
  }

  const canEditSelected = canUpdate && draft !== null && selected?.id === draft.id;

  return (
    <div className="grid min-w-0 gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Structure' }, { label: 'Organization' }]}
        title="Agency record through time"
        actions={
          canUpdate && !draft ? (
            <Button variant="primary" type="button" onClick={() => void prepareDraft()}>
              Prepare successor
            </Button>
          ) : canEditSelected ? (
            <Button
              variant="primary"
              type="button"
              onClick={(event) =>
                openDialog('edit', event.currentTarget as unknown as FocusableField)
              }
            >
              Continue draft
            </Button>
          ) : null
        }
        tabs={tabs}
      />
      {navigation.search.has('agencyVersion') && !selected ? (
        <p className="m-0 text-small text-danger" role="alert">
          This Agency Profile version is missing or unavailable.
        </p>
      ) : null}
      {notice ? (
        <p className="m-0 text-small text-success" role="status">
          {notice}
        </p>
      ) : null}
      {!dialogMode ? <FormError message={formError} /> : null}

      {selected ? (
        <div className="grid items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <Panel title="Effective-date rail" flush>
            <nav
              className="grid grid-cols-[repeat(5,minmax(180px,1fr))] overflow-x-auto lg:grid-cols-1"
              aria-label="Agency Profile Versions"
            >
              {data.versions.map((version) => (
                <button
                  className="grid cursor-pointer gap-0.5 border-0 border-b border-border-subtle bg-surface px-4 py-3 text-left last:border-b-0 hover:bg-canvas aria-pressed:bg-primary/8 aria-pressed:shadow-[inset_3px_0_0_var(--color-primary)]"
                  key={version.id}
                  type="button"
                  aria-pressed={selected.id === version.id}
                  onClick={() => selectVersion(version.id)}
                >
                  <span className="flex items-center justify-between gap-2 text-caption font-[650] text-primary">
                    V{version.versionNo}
                    {version.versionState === 'DRAFT' ? (
                      <span className="text-ink-muted">NEXT</span>
                    ) : null}
                  </span>
                  <span className="text-small font-[600] text-ink">{periodLabel(version)}</span>
                  <span className="text-caption text-ink-muted">
                    {version.versionState.toLowerCase()}
                  </span>
                </button>
              ))}
            </nav>
          </Panel>

          <article className="min-w-0 rounded-panel border border-border bg-surface">
            <header className="grid gap-2 border-b border-border px-4 py-4">
              <div className="flex flex-wrap items-center gap-3 text-caption text-ink-muted">
                <StateBadge state={selected.versionState} />
                <span>Version {selected.versionNo}</span>
                <span>{periodLabel(selected)}</span>
              </div>
              <h2 className="m-0 text-page-title text-ink">{selected.officialName}</h2>
              <p className="m-0 text-small text-ink-muted">
                {selected.acronym ?? 'No acronym recorded'} · {agencyTypeLabel(selected.agencyType)}{' '}
                · Domain status: {selected.domainStatus}
              </p>
            </header>
            <div className="p-4">
              <FieldList version={selected} />
              {canEditSelected ? (
                <div className="mt-5 flex flex-wrap gap-2 border-t border-border-subtle pt-4">
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={(event) =>
                      openDialog('edit', event.currentTarget as unknown as FocusableField)
                    }
                  >
                    Edit proposed fields
                  </Button>
                  <Button
                    variant="primary"
                    type="button"
                    onClick={(event) =>
                      openDialog('activate', event.currentTarget as unknown as FocusableField)
                    }
                  >
                    Review activation
                  </Button>
                </div>
              ) : null}
            </div>
          </article>
        </div>
      ) : (
        <StateSurface labelledBy="agency-profile-empty-title">
          <StateCode>Empty</StateCode>
          <h2 className="m-0 text-panel-title text-ink" id="agency-profile-empty-title">
            No Agency Profile version is available.
          </h2>
          <p className="m-0 max-w-[500px] text-body text-ink-muted">
            The Agency must have an effective-dated profile before this surface can be administered.
          </p>
        </StateSurface>
      )}

      <Panel
        title="Retained history"
        flush
        actions={
          <span className="text-caption text-ink-muted tabular-nums">
            {data.versions.length} version{data.versions.length === 1 ? '' : 's'}
          </span>
        }
      >
        <Table className="min-w-[720px]">
          <thead>
            <tr>
              <Th>Version</Th>
              <Th kind="date">Effective period</Th>
              <Th>Official name</Th>
              <Th>State</Th>
            </tr>
          </thead>
          <tbody>
            {data.versions.map((version) => (
              <Tr key={version.id} selected={selected?.id === version.id}>
                <RowHeader>
                  <button
                    className="cursor-pointer border-0 bg-transparent p-0 font-[600] text-primary hover:underline"
                    type="button"
                    onClick={() => selectVersion(version.id)}
                  >
                    V{version.versionNo}
                  </button>
                </RowHeader>
                <Td kind="date">{periodLabel(version)}</Td>
                <Td>{version.officialName}</Td>
                <Td>
                  <StateBadge state={version.versionState} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <ProfileDialog
        mode={dialogMode}
        draft={draft && selected?.id === draft.id ? draft : null}
        submitting={submitting}
        fieldErrors={fieldErrors}
        formError={formError}
        onClose={() => {
          if (submitting) return;
          setDialogMode(null);
          setFieldErrors({});
          setFormError('');
        }}
        onSave={(values) => void saveDraft(values)}
        onActivate={(effectiveDate, reason) => void activate(effectiveDate, reason)}
        registerField={(field, element) => {
          fieldRefs.current[field] = element;
        }}
      />
    </div>
  );
}
