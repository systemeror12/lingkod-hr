'use client';

import { useRef, useState, type FormEvent } from 'react';
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

type OrganizationUnitType =
  'DEPARTMENT' | 'BUREAU' | 'SERVICE' | 'DIVISION' | 'SECTION' | 'OFFICE' | 'OTHER';

type OrganizationUnitStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ABOLISHED';

interface OrganizationUnit {
  id: string;
  code: string;
  officialName: string;
  unitType: OrganizationUnitType;
  effectiveDate: string;
  status: OrganizationUnitStatus;
}

interface OrganizationUnitListResponse {
  units: OrganizationUnit[];
}

interface OrganizationUnitErrorResponse {
  error?: {
    code?: unknown;
    message?: unknown;
    fields?: unknown;
  };
}

interface DraftValues {
  officialName: string;
  code: string;
  unitType: OrganizationUnitType;
  effectiveDate: string;
}

const unitTypes: readonly { value: OrganizationUnitType; label: string }[] = [
  { value: 'DEPARTMENT', label: 'Department' },
  { value: 'BUREAU', label: 'Bureau' },
  { value: 'SERVICE', label: 'Service' },
  { value: 'DIVISION', label: 'Division' },
  { value: 'SECTION', label: 'Section' },
  { value: 'OFFICE', label: 'Office' },
  { value: 'OTHER', label: 'Other' },
];

function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function emptyDraft(): DraftValues {
  return {
    officialName: '',
    code: '',
    unitType: 'OFFICE',
    effectiveDate: manilaToday(),
  };
}

function unitTypeLabel(value: OrganizationUnitType): string {
  return unitTypes.find((type) => type.value === value)?.label ?? value;
}

function dateLabel(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

function errorDetails(value: unknown): {
  message: string;
  fields: Record<string, string>;
} {
  if (typeof value !== 'object' || value === null) {
    return { message: 'The Draft Organization Unit could not be saved. Try again.', fields: {} };
  }
  const error = (value as OrganizationUnitErrorResponse).error;
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
        : 'The Draft Organization Unit could not be saved. Try again.',
    fields,
  };
}

function isOrganizationUnit(value: unknown): value is OrganizationUnit {
  if (typeof value !== 'object' || value === null) return false;
  const unit = value as Partial<OrganizationUnit>;
  return (
    typeof unit.id === 'string' &&
    typeof unit.code === 'string' &&
    typeof unit.officialName === 'string' &&
    typeof unit.unitType === 'string' &&
    typeof unit.effectiveDate === 'string' &&
    typeof unit.status === 'string'
  );
}

export function OrganizationWorkspace({
  agencyId,
  canCreate,
  initial,
}: {
  agencyId: string;
  canCreate: boolean;
  initial: OrganizationUnitListResponse;
}) {
  const [units, setUnits] = useState(initial.units);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const firstFieldRef = useRef<{ focus(): void } | null>(null);
  const codeFieldRef = useRef<{ focus(): void } | null>(null);
  const effectiveDateFieldRef = useRef<{ focus(): void } | null>(null);

  function handleOpenChange(nextOpen: boolean): void {
    if (nextOpen) {
      setFieldErrors({});
      setFormError('');
      setSuccess('');
      setDraft(emptyDraft());
      setOpen(true);
      return;
    }
    closePanel();
  }

  function focusFirstError(errors: Record<string, string>): void {
    if (errors.officialName) {
      firstFieldRef.current?.focus();
    } else if (errors.code) {
      codeFieldRef.current?.focus();
    } else if (errors.effectiveDate) {
      effectiveDateFieldRef.current?.focus();
    }
  }

  function closePanel(): void {
    if (submitting) return;
    setOpen(false);
    setFieldErrors({});
    setFormError('');
  }

  function updateDraft(field: keyof DraftValues, value: string): void {
    setDraft((current) => ({ ...current, [field]: value }) as DraftValues);
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function validateDraft(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!draft.officialName.trim()) errors.officialName = 'Enter the official name.';
    if (!draft.code.trim()) errors.code = 'Enter an Agency-unique code.';
    if (!draft.effectiveDate) errors.effectiveDate = 'Choose an effective date.';
    return errors;
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const localErrors = validateDraft();
    setFieldErrors(localErrors);
    setFormError('');
    setSuccess('');
    if (Object.keys(localErrors).length > 0) {
      focusFirstError(localErrors);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/v1/agencies/${agencyId}/organization-units`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          officialName: draft.officialName,
          code: draft.code,
          unitType: draft.unitType,
          effectiveDate: draft.effectiveDate,
        }),
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const details = errorDetails(value);
        setFieldErrors(details.fields);
        setFormError(details.message);
        focusFirstError(details.fields);
        return;
      }
      if (!isOrganizationUnit(value)) {
        setFormError(
          'The Draft Organization Unit was not confirmed. Check the list before trying again.',
        );
        return;
      }
      setUnits((current) => [value, ...current.filter((unit) => unit.id !== value.id)]);
      setHighlightedId(value.id);
      setSuccess(`Draft Organization Unit “${value.officialName}” was created.`);
      setOpen(false);
      setDraft(emptyDraft());
    } catch {
      setFormError(
        'The Draft Organization Unit could not be saved. Check the connection and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <div className="grid gap-7">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid max-w-[680px] gap-2">
            <p className="m-0 text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
              Organization
            </p>
            <h1 className="m-0 text-[clamp(28px,3vw,38px)] leading-[1.08] font-[680] tracking-[-0.035em] text-midnight">
              Organization Units
            </h1>
            <p className="m-0 text-sm leading-[1.65] text-muted">
              Keep the Agency structure ready for later activation and Plantilla work.
            </p>
          </div>
          {canCreate ? (
            <DialogTrigger asChild>
              <button
                className="inline-flex min-h-11 items-center justify-center rounded-[3px] bg-cobalt px-4 text-sm font-[650] text-white hover:bg-[#365f96]"
                type="button"
              >
                Create Organization Unit
              </button>
            </DialogTrigger>
          ) : null}
        </header>

        {success ? (
          <p
            className="m-0 rounded-[4px] border border-[#b8cbe4] bg-pale-blue px-4 py-3 text-sm text-ink"
            role="status"
          >
            {success} The new Draft is highlighted below.
          </p>
        ) : null}
        {formError && !open ? (
          <p
            className="m-0 rounded-[4px] border border-[#d6aeb0] bg-[#fff7f7] px-4 py-3 text-sm text-[#7a3036]"
            role="alert"
          >
            {formError}
          </p>
        ) : null}

        <section
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
          aria-labelledby="organization-units-heading"
        >
          <header className="flex min-h-[60px] items-center justify-between gap-4 border-b border-line px-5">
            <div className="grid gap-1">
              <h2 className="m-0 text-sm font-[670] text-midnight" id="organization-units-heading">
                Organization list
              </h2>
              <span className="text-xs text-muted">
                {units.length === 1 ? '1 unit' : `${units.length} units`}
              </span>
            </div>
            <span className="rounded-full bg-pale-blue px-2.5 py-1 text-xs font-[650] text-cobalt">
              Agency scoped
            </span>
          </header>
          {units.length === 0 ? (
            <div className="grid min-h-[260px] place-content-center gap-2 px-6 py-12 text-left">
              <strong className="text-[15px] font-[650] text-midnight">
                No Organization Units yet.
              </strong>
              <p className="m-0 max-w-[520px] text-[13px] leading-[1.6] text-muted">
                Create a Draft Organization Unit with its official name, Agency-unique code, type,
                and effective date.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] border-collapse text-left">
                <thead className="bg-[#fafbfd] text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
                  <tr>
                    <th className="border-b border-line px-5 py-3 font-bold">Official name</th>
                    <th className="border-b border-line px-5 py-3 font-bold">Code</th>
                    <th className="border-b border-line px-5 py-3 font-bold">Type</th>
                    <th className="border-b border-line px-5 py-3 font-bold">Effective</th>
                    <th className="border-b border-line px-5 py-3 font-bold">Status</th>
                  </tr>
                </thead>
                <tbody className="text-[13px] text-ink">
                  {units.map((unit) => (
                    <tr
                      className="border-b border-line last:border-b-0 data-[highlighted=true]:bg-pale-blue"
                      data-highlighted={highlightedId === unit.id}
                      key={unit.id}
                    >
                      <th className="px-5 py-4 text-left font-[650] text-midnight" scope="row">
                        {unit.officialName}
                      </th>
                      <td className="px-5 py-4 font-mono text-xs">{unit.code}</td>
                      <td className="px-5 py-4">{unitTypeLabel(unit.unitType)}</td>
                      <td className="px-5 py-4 text-muted">{dateLabel(unit.effectiveDate)}</td>
                      <td className="px-5 py-4">
                        <span className="inline-flex rounded-full bg-pale-blue px-2 py-1 text-[11px] font-[700] tracking-[0.04em] text-cobalt uppercase">
                          {unit.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <DialogContent
          aria-busy={submitting}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            firstFieldRef.current?.focus();
          }}
        >
          <DialogHeader>
            <div className="grid min-w-0 gap-1.5">
              <p className="m-0 font-mono text-[10px] font-bold tracking-[0.1em] text-cobalt uppercase">
                Organization registry / New record
              </p>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="grid gap-1.5">
                  <DialogTitle>Create Organization Unit</DialogTitle>
                  <DialogDescription>
                    Register the unit now. Hierarchy and activation come later.
                  </DialogDescription>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff3d6] px-2.5 py-1 text-[10px] font-[760] tracking-[0.08em] text-[#79531c] uppercase">
                  <span className="size-1.5 rounded-full bg-[#b27625]" aria-hidden="true" />
                  DRAFT
                </span>
              </div>
            </div>
            <DialogClose asChild>
              <button
                className="min-h-9 min-w-9 shrink-0 rounded-[3px] text-xl text-muted hover:bg-canvas disabled:pointer-events-none disabled:opacity-50"
                type="button"
                aria-label="Close Organization Unit dialog"
                disabled={submitting}
              >
                ×
              </button>
            </DialogClose>
          </DialogHeader>

          <DialogBody>
            <form className="grid gap-5" id="create-organization-unit-form" onSubmit={submit}>
              <div className="grid gap-2">
                <label className="text-sm font-[650] text-ink" htmlFor="organization-official-name">
                  Official name
                </label>
                <input
                  className="min-h-11 rounded-[3px] border border-line bg-paper px-3 text-sm text-ink"
                  id="organization-official-name"
                  ref={firstFieldRef}
                  type="text"
                  autoComplete="organization"
                  value={draft.officialName}
                  aria-invalid={Boolean(fieldErrors.officialName)}
                  aria-describedby={
                    fieldErrors.officialName ? 'organization-name-error' : undefined
                  }
                  onChange={(event) =>
                    updateDraft(
                      'officialName',
                      (event.target as unknown as { value: string }).value,
                    )
                  }
                />
                {fieldErrors.officialName ? (
                  <span
                    className="text-xs leading-[1.5] text-[#7a3036]"
                    id="organization-name-error"
                    role="alert"
                  >
                    {fieldErrors.officialName}
                  </span>
                ) : null}
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-[650] text-ink" htmlFor="organization-code">
                  Agency-unique code
                </label>
                <input
                  className="min-h-11 rounded-[3px] border border-line bg-paper px-3 text-sm text-ink uppercase"
                  id="organization-code"
                  ref={codeFieldRef}
                  type="text"
                  autoComplete="off"
                  maxLength={50}
                  value={draft.code}
                  aria-invalid={Boolean(fieldErrors.code)}
                  aria-describedby={
                    fieldErrors.code ? 'organization-code-error' : 'organization-code-help'
                  }
                  onChange={(event) =>
                    updateDraft('code', (event.target as unknown as { value: string }).value)
                  }
                />
                <span className="text-xs leading-[1.5] text-muted" id="organization-code-help">
                  The same code may be used by another Agency, but not twice here.
                </span>
                {fieldErrors.code ? (
                  <span
                    className="text-xs leading-[1.5] text-[#7a3036]"
                    id="organization-code-error"
                    role="alert"
                  >
                    {fieldErrors.code}
                  </span>
                ) : null}
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-[650] text-ink" htmlFor="organization-unit-type">
                  Unit type
                </label>
                <select
                  className="min-h-11 rounded-[3px] border border-line bg-paper px-3 text-sm text-ink"
                  id="organization-unit-type"
                  value={draft.unitType}
                  onChange={(event) =>
                    updateDraft(
                      'unitType',
                      (event.target as unknown as { value: OrganizationUnitType }).value,
                    )
                  }
                >
                  {unitTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <label
                  className="text-sm font-[650] text-ink"
                  htmlFor="organization-effective-date"
                >
                  Effective date
                </label>
                <input
                  className="min-h-11 rounded-[3px] border border-line bg-paper px-3 text-sm text-ink"
                  id="organization-effective-date"
                  ref={effectiveDateFieldRef}
                  type="date"
                  value={draft.effectiveDate}
                  aria-invalid={Boolean(fieldErrors.effectiveDate)}
                  aria-describedby={
                    fieldErrors.effectiveDate ? 'organization-date-error' : undefined
                  }
                  onChange={(event) =>
                    updateDraft(
                      'effectiveDate',
                      (event.target as unknown as { value: string }).value,
                    )
                  }
                />
                {fieldErrors.effectiveDate ? (
                  <span
                    className="text-xs leading-[1.5] text-[#7a3036]"
                    id="organization-date-error"
                    role="alert"
                  >
                    {fieldErrors.effectiveDate}
                  </span>
                ) : null}
              </div>

              {formError ? (
                <p
                  className="m-0 rounded-[4px] border border-[#d6aeb0] bg-[#fff7f7] px-4 py-3 text-sm text-[#7a3036]"
                  role="alert"
                >
                  {formError}
                </p>
              ) : null}

              <div className="grid grid-cols-[72px_1fr] overflow-hidden rounded-[4px] border border-line bg-[#fafbfd] text-xs">
                <span className="grid place-items-center border-r border-line bg-pale-blue font-mono font-bold text-cobalt">
                  DRAFT
                </span>
                <span className="grid gap-1 px-4 py-3 text-muted">
                  <strong className="font-[680] text-ink">
                    {draft.officialName || 'Untitled Organization Unit'}
                  </strong>
                  <span>
                    {draft.code || 'No code yet'} · {unitTypeLabel(draft.unitType).toLowerCase()} ·
                    effective {draft.effectiveDate || '—'}
                  </span>
                </span>
              </div>
            </form>
          </DialogBody>

          <DialogFooter>
            <span className="mr-auto hidden text-[11px] text-muted min-[621px]:block">
              Agency scoped · Four required fields
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
              className="min-h-11 rounded-[3px] bg-cobalt px-4 text-sm font-[650] text-white hover:bg-[#365f96] disabled:pointer-events-none disabled:opacity-50"
              type="submit"
              form="create-organization-unit-form"
              disabled={submitting}
            >
              {submitting ? 'Creating…' : 'Create Draft'}
            </button>
          </DialogFooter>
        </DialogContent>
      </div>
    </Dialog>
  );
}
