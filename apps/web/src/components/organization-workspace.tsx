'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

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
  const triggerRef = useRef<{ focus(): void } | null>(null);
  const firstDialogControlRef = useRef<{ focus(): void } | null>(null);
  const firstFieldRef = useRef<{ focus(): void } | null>(null);
  const lastDialogControlRef = useRef<{ focus(): void } | null>(null);
  const dialogWasOpenRef = useRef(false);

  useEffect(() => {
    if (open) {
      dialogWasOpenRef.current = true;
      firstFieldRef.current?.focus();
    } else if (dialogWasOpenRef.current) {
      triggerRef.current?.focus();
    }
  }, [open]);

  function openPanel(): void {
    setFieldErrors({});
    setFormError('');
    setSuccess('');
    setDraft(emptyDraft());
    setOpen(true);
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
    if (Object.keys(localErrors).length > 0) return;

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
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-[3px] bg-cobalt px-4 text-sm font-[650] text-white hover:bg-[#365f96]"
            type="button"
            ref={triggerRef}
            onClick={openPanel}
          >
            Create Organization Unit
          </button>
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
              Create a Draft Organization Unit with its official name, Agency-unique code, type, and
              effective date.
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

      {open ? (
        <div className="fixed inset-0 z-20 bg-midnight/35" role="presentation">
          <section
            className="fixed inset-2 z-30 grid max-h-[calc(100dvh-16px)] grid-rows-[auto_1fr] overflow-y-auto rounded-[5px] border border-line bg-paper shadow-[0_18px_55px_rgb(23_32_51/20%)] min-[820px]:inset-y-0 min-[820px]:right-0 min-[820px]:left-auto min-[820px]:w-[520px] min-[820px]:max-w-[calc(100vw-32px)] min-[820px]:rounded-none min-[820px]:rounded-l-[5px]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="organization-panel-title"
            aria-describedby="organization-panel-help"
            aria-busy={submitting}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                closePanel();
                return;
              }
              if (event.key !== 'Tab') return;
              const target = event.target as unknown;
              if (event.shiftKey && target === firstDialogControlRef.current) {
                event.preventDefault();
                lastDialogControlRef.current?.focus();
              } else if (!event.shiftKey && target === lastDialogControlRef.current) {
                event.preventDefault();
                firstDialogControlRef.current?.focus();
              }
            }}
          >
            <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5 min-[621px]:px-8">
              <div className="grid gap-1.5">
                <p className="m-0 text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
                  New Draft
                </p>
                <h2
                  className="m-0 text-xl font-[680] tracking-[-0.025em] text-midnight"
                  id="organization-panel-title"
                >
                  Create Organization Unit
                </h2>
              </div>
              <button
                className="min-h-9 min-w-9 rounded-[3px] text-xl text-muted hover:bg-canvas"
                type="button"
                ref={firstDialogControlRef}
                aria-label="Close Organization Unit panel"
                onClick={closePanel}
              >
                ×
              </button>
            </header>

            <form className="grid content-start gap-5 px-6 py-6 min-[621px]:px-8" onSubmit={submit}>
              <p className="m-0 text-[13px] leading-[1.6] text-muted" id="organization-panel-help">
                The new record starts as <strong className="font-[700] text-ink">DRAFT</strong>.
                Activation, hierarchy, leadership, and Plantilla details are handled in later work.
              </p>

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

              <div className="flex flex-wrap justify-end gap-3 border-t border-line pt-5">
                <button
                  className="min-h-11 rounded-[3px] px-4 text-sm font-[650] text-muted hover:bg-canvas"
                  type="button"
                  onClick={closePanel}
                >
                  Cancel
                </button>
                <button
                  className="min-h-11 rounded-[3px] bg-cobalt px-4 text-sm font-[650] text-white hover:bg-[#365f96]"
                  type="submit"
                  ref={lastDialogControlRef}
                  disabled={submitting}
                >
                  {submitting ? 'Creating…' : 'Create Draft'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
