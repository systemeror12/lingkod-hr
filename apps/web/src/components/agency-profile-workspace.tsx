'use client';

import { useEffect, useRef, useState } from 'react';
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

function currencyLabel(value: string): string {
  return value === 'PHP' ? 'PHP — Philippine peso' : value;
}

function stateClass(state: AgencyProfileVersionState): string {
  return {
    DRAFT: 'bg-[#fff3d6] text-[#79531c]',
    ACTIVE: 'bg-[#e8f3ec] text-[#27613e]',
    SUPERSEDED: 'bg-pale-blue text-cobalt',
    VOIDED: 'bg-[#f2e9ea] text-[#7a3036]',
  }[state];
}

function StateBadge({ state }: { state: AgencyProfileVersionState }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-[760] tracking-[0.08em] ${stateClass(state)}`}
    >
      {state}
    </span>
  );
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
    <dl className="m-0 grid gap-0 sm:grid-cols-2">
      {editableFields.map(({ key, label }) => (
        <div className="border-t border-line py-4 sm:odd:pr-6 sm:even:pl-6" key={key}>
          <dt className="text-[10px] font-bold tracking-[0.08em] text-muted uppercase">{label}</dt>
          <dd className="m-0 mt-1.5 text-[13px] leading-[1.5] font-[620] text-ink">
            {values[key]}
          </dd>
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

function PageHeading({
  draft,
  canUpdate,
  selected,
  onPrepare,
  onEdit,
}: {
  draft: AgencyProfileVersion | null;
  canUpdate: boolean;
  selected: AgencyProfileVersion | null;
  onPrepare(): void;
  onEdit(opener: FocusableField): void;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-5">
      <div className="grid max-w-[700px] gap-2">
        <p className="m-0 text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
          Organization / Agency Profile
        </p>
        <h1 className="m-0 text-[clamp(28px,3vw,38px)] leading-[1.08] font-[680] tracking-[-0.035em] text-midnight">
          Agency record through time
        </h1>
        <p className="m-0 max-w-[660px] text-sm leading-[1.65] text-muted">
          Choose an effective period first. The workbench shows exactly which Agency identity
          applied, including retained corrections.
        </p>
      </div>
      {canUpdate && !draft ? (
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-[3px] bg-cobalt px-4 text-sm font-[650] text-white hover:bg-[#365f96]"
          type="button"
          onClick={onPrepare}
        >
          Prepare successor
        </button>
      ) : canUpdate && draft && selected?.id === draft.id ? (
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-[3px] bg-cobalt px-4 text-sm font-[650] text-white hover:bg-[#365f96]"
          type="button"
          onClick={(event) => onEdit(event.currentTarget as unknown as FocusableField)}
        >
          Continue draft
        </button>
      ) : null}
    </header>
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
  onRestoreFocus,
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
  onRestoreFocus(): void;
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

  return (
    <Dialog
      open={mode !== null && draft !== null}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent
        aria-busy={submitting}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          firstFieldRef.current?.focus?.();
        }}
      >
        <DialogHeader>
          <div className="grid min-w-0 gap-1.5">
            <p className="m-0 font-mono text-[10px] font-bold tracking-[0.1em] text-cobalt uppercase">
              Agency Profile / {draft?.id.slice(0, 8)}
            </p>
            <DialogTitle>
              {mode === 'activate' ? 'Review activation' : 'Edit draft successor'}
            </DialogTitle>
            <DialogDescription>
              {mode === 'activate'
                ? 'Confirm when this version becomes authoritative. Prior versions remain available for every as-of read.'
                : 'Edit the successor fields before activation. Activated versions cannot be rewritten.'}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button
              className="min-h-9 min-w-9 shrink-0 rounded-[3px] text-xl text-muted hover:bg-canvas disabled:pointer-events-none disabled:opacity-50"
              type="button"
              aria-label="Close Agency Profile dialog"
              disabled={submitting}
            >
              ×
            </button>
          </DialogClose>
        </DialogHeader>

        <DialogBody>
          {formError ? (
            <p
              className="mb-5 rounded-[4px] border border-[#d6aeb0] bg-[#fff7f7] px-4 py-3 text-sm text-[#7a3036]"
              role="alert"
            >
              {formError}
            </p>
          ) : null}
          {mode === 'activate' ? (
            <form
              className="grid gap-5"
              id="activate-agency-profile-form"
              onSubmit={(event) => {
                event.preventDefault();
                onActivate(effectiveDate, reason);
              }}
            >
              <div className="rounded-[4px] border border-[#c9d5e5] bg-[#f1f5fb] p-4">
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-sm text-midnight">{draft?.officialName}</strong>
                  <StateBadge state="DRAFT" />
                </div>
                <p className="mt-2 mb-0 text-xs leading-[1.55] text-muted">
                  The prior version closes the day before this effectivity. Current reads remain
                  date-aware, and the activation is recorded in the Audit Log.
                </p>
              </div>
              <label
                className="grid gap-2 text-sm font-[650] text-ink"
                htmlFor="agency-profile-effective-date"
              >
                Effective date
                <input
                  ref={(element) => {
                    registerField('effectiveDate', element);
                    if (mode === 'activate') firstFieldRef.current = element;
                  }}
                  className="min-h-11 rounded-[3px] border border-line bg-paper px-3 font-normal"
                  id="agency-profile-effective-date"
                  type="date"
                  min={tomorrow()}
                  value={effectiveDate}
                  aria-invalid={Boolean(fieldErrors.effectiveDate)}
                  aria-describedby={
                    fieldErrors.effectiveDate ? 'agency-profile-effective-date-error' : undefined
                  }
                  onChange={(event) =>
                    setEffectiveDate((event.target as unknown as { value: string }).value)
                  }
                  required
                />
                {fieldErrors.effectiveDate ? (
                  <span
                    className="text-xs leading-[1.5] text-[#7a3036]"
                    id="agency-profile-effective-date-error"
                  >
                    {fieldErrors.effectiveDate}
                  </span>
                ) : null}
              </label>
              <label
                className="grid gap-2 text-sm font-[650] text-ink"
                htmlFor="agency-profile-activation-reason"
              >
                Reason for change
                <textarea
                  ref={(element) => registerField('reason', element)}
                  className="min-h-24 resize-y rounded-[3px] border border-line bg-paper p-3 font-normal"
                  id="agency-profile-activation-reason"
                  value={reason}
                  aria-invalid={Boolean(fieldErrors.reason)}
                  aria-describedby={
                    fieldErrors.reason ? 'agency-profile-activation-reason-error' : undefined
                  }
                  onChange={(event) =>
                    setReason((event.target as unknown as { value: string }).value)
                  }
                  required
                />
                {fieldErrors.reason ? (
                  <span
                    className="text-xs leading-[1.5] text-[#7a3036]"
                    id="agency-profile-activation-reason-error"
                  >
                    {fieldErrors.reason}
                  </span>
                ) : null}
              </label>
              <div className="grid grid-cols-[92px_1fr] overflow-hidden rounded-[4px] border border-line text-xs">
                <span className="grid place-items-center bg-midnight font-mono font-bold text-white">
                  ATOMIC
                </span>
                <span className="px-4 py-3 leading-[1.55] text-muted">
                  Close prior period · activate successor · refresh the current projection · append
                  the audit event
                </span>
              </div>
            </form>
          ) : activeValues ? (
            <form
              className="grid gap-5"
              id="edit-agency-profile-form"
              onSubmit={(event) => {
                event.preventDefault();
                onSave(activeValues);
              }}
            >
              {editableFields.map(({ key, label, optional }, index) => (
                <label
                  className="grid gap-2 text-sm font-[650] text-ink"
                  htmlFor={`agency-profile-${key}`}
                  key={key}
                >
                  {label}
                  {optional ? (
                    <span className="ml-1 font-normal text-muted">(optional)</span>
                  ) : null}
                  {key === 'agencyType' ? (
                    <select
                      ref={(element) => {
                        registerField(key, element);
                        if (index === 0) firstFieldRef.current = element;
                      }}
                      className="min-h-11 rounded-[3px] border border-line bg-paper px-3 font-normal text-ink"
                      id={`agency-profile-${key}`}
                      value={activeValues[key]}
                      aria-invalid={Boolean(fieldErrors[key])}
                      aria-describedby={
                        fieldErrors[key] ? `agency-profile-${key}-error` : undefined
                      }
                      onChange={(event) =>
                        setField(key, (event.target as unknown as { value: string }).value)
                      }
                    >
                      {agencyTypes.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  ) : key === 'defaultTimezone' ? (
                    <select
                      ref={(element) => {
                        registerField(key, element);
                        if (index === 0) firstFieldRef.current = element;
                      }}
                      className="min-h-11 rounded-[3px] border border-line bg-paper px-3 font-normal text-ink"
                      id={`agency-profile-${key}`}
                      value={activeValues[key]}
                      aria-invalid={Boolean(fieldErrors[key])}
                      aria-describedby={
                        fieldErrors[key] ? `agency-profile-${key}-error` : undefined
                      }
                      onChange={(event) =>
                        setField(key, (event.target as unknown as { value: string }).value)
                      }
                    >
                      {timezoneOptions.includes(activeValues.defaultTimezone) ? null : (
                        <option value={activeValues.defaultTimezone}>
                          {activeValues.defaultTimezone}
                        </option>
                      )}
                      {timezoneOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : key === 'defaultCurrency' ? (
                    <select
                      ref={(element) => {
                        registerField(key, element);
                        if (index === 0) firstFieldRef.current = element;
                      }}
                      className="min-h-11 rounded-[3px] border border-line bg-paper px-3 font-normal text-ink"
                      id={`agency-profile-${key}`}
                      value={activeValues[key]}
                      aria-invalid={Boolean(fieldErrors[key])}
                      aria-describedby={
                        fieldErrors[key] ? `agency-profile-${key}-error` : undefined
                      }
                      onChange={(event) =>
                        setField(key, (event.target as unknown as { value: string }).value)
                      }
                    >
                      {currencyOptions.includes(activeValues.defaultCurrency) ? null : (
                        <option value={activeValues.defaultCurrency}>
                          {activeValues.defaultCurrency}
                        </option>
                      )}
                      {currencyOptions.map((option) => (
                        <option key={option} value={option}>
                          {currencyLabel(option)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      ref={(element) => {
                        registerField(key, element);
                        if (index === 0) firstFieldRef.current = element;
                      }}
                      className="min-h-11 rounded-[3px] border border-line bg-paper px-3 font-normal text-ink"
                      id={`agency-profile-${key}`}
                      type="text"
                      value={activeValues[key]}
                      aria-invalid={Boolean(fieldErrors[key])}
                      aria-describedby={
                        fieldErrors[key] ? `agency-profile-${key}-error` : undefined
                      }
                      onChange={(event) =>
                        setField(key, (event.target as unknown as { value: string }).value)
                      }
                    />
                  )}
                  {fieldErrors[key] ? (
                    <span
                      className="text-xs leading-[1.5] text-[#7a3036]"
                      id={`agency-profile-${key}-error`}
                    >
                      {fieldErrors[key]}
                    </span>
                  ) : null}
                </label>
              ))}
              <label
                className="grid gap-2 text-sm font-[650] text-ink"
                htmlFor="agency-profile-proposed-date"
              >
                Proposed effective date
                <input
                  ref={(element) => registerField('effectiveFrom', element)}
                  className="min-h-11 rounded-[3px] border border-line bg-paper px-3 font-normal"
                  id="agency-profile-proposed-date"
                  type="date"
                  min={tomorrow()}
                  value={activeValues.effectiveFrom}
                  aria-invalid={Boolean(fieldErrors.effectiveFrom)}
                  aria-describedby={
                    fieldErrors.effectiveFrom ? 'agency-profile-proposed-date-error' : undefined
                  }
                  onChange={(event) =>
                    setField('effectiveFrom', (event.target as unknown as { value: string }).value)
                  }
                  required
                />
                {fieldErrors.effectiveFrom ? (
                  <span
                    className="text-xs leading-[1.5] text-[#7a3036]"
                    id="agency-profile-proposed-date-error"
                  >
                    {fieldErrors.effectiveFrom}
                  </span>
                ) : null}
              </label>
            </form>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <span className="mr-auto hidden text-[11px] text-muted min-[621px]:block">
            Draft changes are saved to this Agency Context only.
          </span>
          <DialogClose asChild>
            <button
              className="min-h-11 rounded-[3px] px-4 text-sm font-[650] text-muted hover:bg-canvas disabled:pointer-events-none disabled:opacity-50"
              type="button"
              disabled={submitting}
            >
              Cancel
            </button>
          </DialogClose>
          <button
            className="min-h-11 rounded-[3px] bg-cobalt px-4 text-sm font-[650] text-white disabled:pointer-events-none disabled:opacity-60"
            type="submit"
            form={mode === 'activate' ? 'activate-agency-profile-form' : 'edit-agency-profile-form'}
            disabled={submitting}
          >
            {submitting ? 'Saving…' : mode === 'activate' ? 'Activate successor' : 'Save draft'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AgencyProfileWorkspace({
  agencyId,
  canUpdate,
  initial,
}: {
  agencyId: string;
  canUpdate: boolean;
  initial: AgencyProfileResponse;
}) {
  const [data, setData] = useState(initial);
  const [selectedId, setSelectedId] = useState(
    initial.current?.id ?? initial.draft?.id ?? initial.versions[0]?.id ?? null,
  );
  const [dialogMode, setDialogMode] = useState<'edit' | 'activate' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const fieldRefs = useRef<Record<string, FocusableField | null>>({});
  const returnFocusRef = useRef<FocusableField | null>(null);

  const selected = data.versions.find((version) => version.id === selectedId) ?? data.current;
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

  return (
    <div className="grid gap-7">
      {notice ? (
        <p
          className="m-0 rounded-[4px] border border-[#b8cbe4] bg-pale-blue px-4 py-3 text-sm text-ink"
          role="status"
        >
          {notice}
        </p>
      ) : null}
      {formError && !dialogMode ? (
        <p
          className="m-0 rounded-[4px] border border-[#d6aeb0] bg-[#fff7f7] px-4 py-3 text-sm text-[#7a3036]"
          role="alert"
        >
          {formError}
        </p>
      ) : null}
      <PageHeading
        draft={draft}
        canUpdate={canUpdate}
        selected={selected}
        onPrepare={() => void prepareDraft()}
        onEdit={(opener) => openDialog('edit', opener)}
      />

      {selected ? (
        <section className="grid min-h-[610px] overflow-hidden rounded-[5px] border border-line bg-paper lg:grid-cols-[280px_1fr]">
          <nav
            className="border-b border-line bg-[#f8fafc] p-4 lg:border-r lg:border-b-0"
            aria-label="Agency Profile Versions"
          >
            <p className="mt-1 mb-4 px-2 text-[10px] font-bold tracking-[0.1em] text-muted uppercase">
              Effective-date rail
            </p>
            <div className="grid grid-cols-[repeat(5,minmax(190px,1fr))] gap-2 overflow-x-auto pb-2 lg:grid-cols-1 lg:overflow-visible lg:pb-0">
              {data.versions.map((version) => (
                <button
                  className={`relative grid min-h-[84px] gap-1 rounded-[3px] border p-3 text-left before:absolute before:top-0 before:bottom-0 before:left-0 before:w-[3px] before:bg-transparent ${selected.id === version.id ? 'border-[#aebfd6] bg-paper shadow-[0_5px_16px_rgb(23_32_51/8%)] before:bg-cobalt' : 'border-transparent hover:bg-paper'}`}
                  key={version.id}
                  type="button"
                  aria-pressed={selected.id === version.id}
                  onClick={() => selectVersion(version.id)}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-bold text-cobalt">
                      V{version.versionNo}
                    </span>
                    {version.versionState === 'DRAFT' ? (
                      <span className="text-[9px] font-bold text-muted">NEXT</span>
                    ) : null}
                  </span>
                  <span className="text-xs font-[650] text-midnight">{periodLabel(version)}</span>
                  <span className="text-[11px] text-muted">
                    {version.versionState.toLowerCase()}
                  </span>
                </button>
              ))}
            </div>
          </nav>

          <article className="min-w-0">
            <header className="border-b border-line p-5 sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <StateBadge state={selected.versionState} />
                  <span className="font-mono text-xs text-muted">Version {selected.versionNo}</span>
                </div>
                <span className="rounded-[3px] border border-line bg-[#fafbfd] px-3 py-2 font-mono text-xs text-ink">
                  {periodLabel(selected)}
                </span>
              </div>
              <h2 className="mt-6 mb-2 text-[clamp(23px,3vw,34px)] leading-[1.15] font-[680] tracking-[-0.03em] text-midnight">
                {selected.officialName}
              </h2>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                <span>{selected.acronym ?? 'No acronym recorded'}</span>
                <span aria-hidden="true">·</span>
                <span>{agencyTypeLabel(selected.agencyType)}</span>
                <span className="rounded-full bg-[#f0f2f5] px-2 py-1 text-[10px] font-bold tracking-[0.06em] text-muted uppercase">
                  Domain status: {selected.domainStatus}
                </span>
              </div>
            </header>
            <div className="p-5 sm:p-7">
              <FieldList version={selected} />
              {canUpdate && draft && selected.id === draft.id ? (
                <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-6">
                  <button
                    className="min-h-10 rounded-[3px] border border-line px-4 text-sm font-[650] text-cobalt hover:bg-pale-blue"
                    type="button"
                    onClick={(event) =>
                      openDialog('edit', event.currentTarget as unknown as FocusableField)
                    }
                  >
                    Edit proposed fields
                  </button>
                  <button
                    className="min-h-10 rounded-[3px] bg-midnight px-4 text-sm font-[650] text-white hover:bg-[#273650]"
                    type="button"
                    onClick={(event) =>
                      openDialog('activate', event.currentTarget as unknown as FocusableField)
                    }
                  >
                    Review activation
                  </button>
                </div>
              ) : null}
            </div>
          </article>
        </section>
      ) : (
        <section className="rounded-[5px] border border-line bg-paper px-6 py-12">
          <strong className="text-[15px] font-[650] text-midnight">
            No Agency Profile version is available.
          </strong>
          <p className="mt-2 mb-0 text-[13px] leading-[1.6] text-muted">
            The Agency must have an effective-dated profile before this surface can be administered.
          </p>
        </section>
      )}

      <section
        className="rounded-[5px] border border-line bg-paper"
        aria-labelledby="profile-history-heading"
      >
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="m-0 text-sm font-[680] text-midnight" id="profile-history-heading">
              Retained history
            </h2>
            <p className="mt-1 mb-0 text-xs text-muted">
              Every published definition remains reconstructable by effective date.
            </p>
          </div>
          <span className="font-mono text-[11px] text-muted">
            {data.versions.length} version{data.versions.length === 1 ? '' : 's'}
          </span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
            <thead className="bg-[#fafbfd] text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
              <tr>
                <th className="px-5 py-3" scope="col">
                  Version
                </th>
                <th className="px-5 py-3" scope="col">
                  Effective period
                </th>
                <th className="px-5 py-3" scope="col">
                  Official name
                </th>
                <th className="px-5 py-3" scope="col">
                  State
                </th>
              </tr>
            </thead>
            <tbody>
              {data.versions.map((version) => (
                <tr className="border-t border-line hover:bg-[#fafbfd]" key={version.id}>
                  <th className="px-5 py-4 text-left font-mono text-xs text-cobalt" scope="row">
                    <button
                      className="font-mono text-xs text-cobalt underline-offset-2 hover:underline"
                      type="button"
                      onClick={() => selectVersion(version.id)}
                    >
                      V{version.versionNo}
                    </button>
                  </th>
                  <td className="px-5 py-4 text-muted">{periodLabel(version)}</td>
                  <td className="px-5 py-4 font-[620] text-ink">{version.officialName}</td>
                  <td className="px-5 py-4">
                    <StateBadge state={version.versionState} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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
        onRestoreFocus={restoreFocus}
        registerField={(field, element) => {
          fieldRefs.current[field] = element;
        }}
      />
    </div>
  );
}
