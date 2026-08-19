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
import { manilaToday } from '../lib/manila-date';

type OrganizationUnitType =
  'DEPARTMENT' | 'BUREAU' | 'SERVICE' | 'DIVISION' | 'SECTION' | 'OFFICE' | 'OTHER';

type OrganizationUnitStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ABOLISHED';

interface OrganizationUnit {
  id: string;
  code: string;
  officialName: string;
  unitType: OrganizationUnitType;
  effectiveDate: string;
  effectiveTo: string | null;
  parentUnitId: string | null;
  versionState: 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'VOIDED';
  lifecycleStatus: 'ACTIVE' | 'INACTIVE' | 'ABOLISHED';
  status: OrganizationUnitStatus;
}

interface OrganizationUnitListResponse {
  units: OrganizationUnit[];
}

interface OrganizationHierarchyUnit {
  id: string;
  code: string;
  officialName: string;
  unitType: OrganizationUnitType;
  parentUnitId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  lifecycleStatus: 'ACTIVE' | 'INACTIVE' | 'ABOLISHED';
  childCount: number;
}

interface OrganizationHierarchyResponse {
  asOf: string;
  eligibleParentIds: string[];
  units: OrganizationHierarchyUnit[];
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

function errorDetails(
  value: unknown,
  fallback = 'The Draft Organization Unit could not be saved. Try again.',
): {
  message: string;
  fields: Record<string, string>;
} {
  if (typeof value !== 'object' || value === null) {
    return { message: fallback, fields: {} };
  }
  const error = (value as OrganizationUnitErrorResponse).error;
  const fields: Record<string, string> = {};
  if (typeof error?.fields === 'object' && error.fields !== null) {
    for (const [key, message] of Object.entries(error.fields)) {
      if (typeof message === 'string') fields[key] = message;
    }
  }
  return {
    message: typeof error?.message === 'string' ? error.message : fallback,
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

function isOrganizationHierarchy(value: unknown): value is OrganizationHierarchyResponse {
  if (typeof value !== 'object' || value === null) return false;
  const hierarchy = value as Partial<OrganizationHierarchyResponse>;
  return (
    typeof hierarchy.asOf === 'string' &&
    Array.isArray(hierarchy.eligibleParentIds) &&
    Array.isArray(hierarchy.units)
  );
}

function hierarchyRows(units: OrganizationHierarchyUnit[]) {
  const byParent = new Map<string | null, OrganizationHierarchyUnit[]>();
  const ids = new Set(units.map((unit) => unit.id));
  for (const unit of units) {
    const parentId = unit.parentUnitId && ids.has(unit.parentUnitId) ? unit.parentUnitId : null;
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), unit]);
  }
  const rows: Array<{ unit: OrganizationHierarchyUnit; depth: number }> = [];
  const visit = (parentId: string | null, depth: number): void => {
    for (const unit of byParent.get(parentId) ?? []) {
      rows.push({ unit, depth });
      visit(unit.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

export function OrganizationWorkspace({
  agencyId,
  canActivate,
  canCreate,
  initial,
  initialHierarchy,
}: {
  agencyId: string;
  canActivate: boolean;
  canCreate: boolean;
  initial: OrganizationUnitListResponse;
  initialHierarchy: OrganizationHierarchyResponse;
}) {
  const [units, setUnits] = useState(initial.units);
  const [hierarchy, setHierarchy] = useState(initialHierarchy);
  const [asOf, setAsOf] = useState(initialHierarchy.asOf);
  const [selectedId, setSelectedId] = useState(initialHierarchy.units[0]?.id ?? null);
  const [hierarchyLoading, setHierarchyLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activationUnit, setActivationUnit] = useState<OrganizationUnit | null>(null);
  const [activationOpen, setActivationOpen] = useState(false);
  const [parentUnitId, setParentUnitId] = useState('');
  const [activationReason, setActivationReason] = useState('');
  const [activationIdempotencyKey, setActivationIdempotencyKey] = useState('');
  const [activationError, setActivationError] = useState('');
  const [activationFieldErrors, setActivationFieldErrors] = useState<Record<string, string>>({});
  const [activationSubmitting, setActivationSubmitting] = useState(false);
  const [parentOptions, setParentOptions] = useState<OrganizationHierarchyUnit[]>([]);
  const firstFieldRef = useRef<{ focus(): void } | null>(null);
  const codeFieldRef = useRef<{ focus(): void } | null>(null);
  const effectiveDateFieldRef = useRef<{ focus(): void } | null>(null);
  const parentFieldRef = useRef<{ focus(): void } | null>(null);
  const reasonFieldRef = useRef<{ focus(): void } | null>(null);
  const activationTriggerRef = useRef<{ focus(): void } | null>(null);

  const drafts = units.filter((unit) => unit.status === 'DRAFT');
  const selected = hierarchy.units.find((unit) => unit.id === selectedId) ?? null;
  const parentNames = new Map(hierarchy.units.map((unit) => [unit.id, unit.officialName]));

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

  async function requestHierarchy(
    date: string,
    parentForUnitId?: string,
  ): Promise<OrganizationHierarchyResponse> {
    const query = new URLSearchParams({ asOf: date });
    if (parentForUnitId) query.set('parentForUnitId', parentForUnitId);
    const response = await fetch(
      `/api/v1/agencies/${agencyId}/organization-units/hierarchy?${query}`,
      { credentials: 'include' },
    );
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok || !isOrganizationHierarchy(value)) {
      throw new Error('The effective Organization hierarchy could not be loaded.');
    }
    return value;
  }

  async function loadHierarchy(date: string, preferredId?: string): Promise<void> {
    setHierarchyLoading(true);
    try {
      const value = await requestHierarchy(date);
      setHierarchy(value);
      setSelectedId((current) =>
        value.units.some((unit) => unit.id === (preferredId ?? current))
          ? (preferredId ?? current)
          : (value.units[0]?.id ?? null),
      );
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'The hierarchy could not be loaded.');
    } finally {
      setHierarchyLoading(false);
    }
  }

  async function prepareActivation(unit: OrganizationUnit): Promise<void> {
    setActivationUnit(unit);
    setParentUnitId('');
    setActivationReason('');
    setActivationIdempotencyKey(crypto.randomUUID());
    setActivationError('');
    setActivationFieldErrors({});
    try {
      const eligibleHierarchy = await requestHierarchy(unit.effectiveDate, unit.id);
      const eligibleIds = new Set(eligibleHierarchy.eligibleParentIds);
      setParentOptions(
        eligibleHierarchy.units.filter((candidate) => eligibleIds.has(candidate.id)),
      );
    } catch {
      setParentOptions([]);
      setActivationError(
        'Eligible parent units could not be loaded. Close the dialog and try again.',
      );
    }
  }

  function handleActivationOpenChange(nextOpen: boolean): void {
    if (!nextOpen && activationSubmitting) return;
    setActivationOpen(nextOpen);
    if (!nextOpen) queueMicrotask(() => activationTriggerRef.current?.focus());
  }

  async function submitActivation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!activationUnit) return;
    if (!activationReason.trim()) {
      setActivationFieldErrors({ reason: 'Enter the activation reason.' });
      reasonFieldRef.current?.focus();
      return;
    }

    setActivationSubmitting(true);
    setActivationError('');
    setActivationFieldErrors({});
    try {
      const response = await fetch(
        `/api/v1/agencies/${agencyId}/organization-units/${activationUnit.id}/activate`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': activationIdempotencyKey,
          },
          body: JSON.stringify({
            parentUnitId: parentUnitId || null,
            reason: activationReason,
          }),
        },
      );
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const details = errorDetails(
          value,
          'The Organization Unit could not be activated. Review the hierarchy and try again.',
        );
        setActivationFieldErrors(details.fields);
        setActivationError(details.message);
        if (details.fields.parentUnitId) parentFieldRef.current?.focus();
        else if (details.fields.reason) reasonFieldRef.current?.focus();
        return;
      }
      if (!isOrganizationUnit(value)) {
        setActivationError(
          'Activation was not confirmed. Refresh the hierarchy before trying again.',
        );
        return;
      }
      setUnits((current) => current.map((unit) => (unit.id === value.id ? value : unit)));
      setSuccess(`${value.officialName} is now active.`);
      setActivationOpen(false);
      queueMicrotask(() => activationTriggerRef.current?.focus());
      await loadHierarchy(asOf, value.id);
    } catch {
      setActivationError(
        'The Organization Unit could not be activated. Check the connection and try again.',
      );
    } finally {
      setActivationSubmitting(false);
    }
  }

  const rows = hierarchyRows(hierarchy.units);

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <div className="grid min-w-0 gap-7">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="grid max-w-[680px] gap-2">
              <p className="m-0 text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
                Organization
              </p>
              <h1 className="m-0 text-[clamp(28px,3vw,38px)] leading-[1.08] font-[680] tracking-[-0.035em] text-midnight">
                Organization Units
              </h1>
              <p className="m-0 text-sm leading-[1.65] text-muted">
                Review the effective reporting structure and activate prepared Organization Units.
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
              {success}
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
            className="min-w-0 overflow-hidden rounded-[5px] border border-line bg-paper"
            aria-labelledby="effective-hierarchy-heading"
          >
            <header className="flex min-h-[68px] flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-3">
              <div className="grid gap-1">
                <h2
                  className="m-0 text-sm font-[670] text-midnight"
                  id="effective-hierarchy-heading"
                >
                  Effective hierarchy
                </h2>
                <span className="text-xs text-muted">
                  {hierarchy.units.length === 1
                    ? '1 active unit'
                    : `${hierarchy.units.length} active units`}
                </span>
              </div>
              <label className="flex items-center gap-2 text-xs font-[650] text-ink">
                Hierarchy as of
                <input
                  className="min-h-10 rounded-[3px] border border-line bg-paper px-3 text-sm font-normal text-ink"
                  type="date"
                  value={asOf}
                  onChange={(event) => {
                    const date = (event.currentTarget as unknown as { value: string }).value;
                    setAsOf(date);
                    if (date) {
                      const browser = globalThis as unknown as {
                        location: { href: string };
                        history: { replaceState(data: null, unused: string, url: URL): void };
                      };
                      const url = new URL(browser.location.href);
                      url.searchParams.set('asOf', date);
                      browser.history.replaceState(null, '', url);
                      void loadHierarchy(date);
                    }
                  }}
                />
              </label>
            </header>

            {rows.length === 0 ? (
              <div className="grid min-h-[240px] place-content-center gap-2 px-6 py-12">
                <strong className="text-[15px] font-[650] text-midnight">
                  No active Organization Units on this date.
                </strong>
                <p className="m-0 max-w-[520px] text-[13px] leading-[1.6] text-muted">
                  Activate a Draft Organization Unit effective on or before this date.
                </p>
              </div>
            ) : (
              <div className="grid min-w-0 md:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.1fr)]">
                <nav
                  className="min-w-0 overflow-x-auto border-b border-line bg-[#fafbfd] md:border-r md:border-b-0"
                  aria-label="Organization hierarchy"
                >
                  <div className="min-w-[280px] py-2">
                    {rows.map(({ unit, depth }) => (
                      <button
                        className={`group relative grid w-full grid-cols-[18px_1fr_auto] items-center gap-2 border-l-[3px] py-2.5 pr-4 text-left ${
                          depth === 0
                            ? 'border-midnight bg-midnight text-paper hover:bg-[#273650] aria-pressed:border-midnight aria-pressed:bg-midnight'
                            : 'border-transparent hover:bg-pale-blue aria-pressed:border-cobalt aria-pressed:bg-pale-blue'
                        }`}
                        style={{ paddingLeft: `${12 + depth * 22}px` }}
                        type="button"
                        key={unit.id}
                        aria-pressed={selectedId === unit.id}
                        onClick={() => setSelectedId(unit.id)}
                      >
                        <span
                          className={`h-px ${depth === 0 ? 'bg-[#aebbd0]' : 'bg-[#9aaabd]'}`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0">
                          <strong
                            className={`block truncate text-[13px] font-[660] ${depth === 0 ? 'text-paper' : 'text-midnight'}`}
                          >
                            {unit.officialName}
                          </strong>
                          <span
                            className={`block truncate font-mono text-[10px] tracking-[0.04em] uppercase ${depth === 0 ? 'text-[#b7c3d5]' : 'text-muted'}`}
                          >
                            {unit.code} · {unitTypeLabel(unit.unitType)}
                          </span>
                        </span>
                        <span
                          className={`text-[10px] font-[650] ${depth === 0 ? 'text-[#dbe4f1]' : 'text-muted'}`}
                        >
                          {unit.childCount}
                        </span>
                        {Array.from({ length: depth }, (_, connectorDepth) => (
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-[#aeb8c7]"
                            data-tree-connector="vertical"
                            key={connectorDepth}
                            style={{ left: `${12 + (connectorDepth + 1) * 22}px` }}
                          />
                        ))}
                      </button>
                    ))}
                  </div>
                </nav>

                <div
                  className="grid min-h-[300px] content-start gap-6 p-5 sm:p-6"
                  aria-label="Selected Organization Unit"
                  aria-busy={hierarchyLoading}
                  role="region"
                >
                  {selected ? (
                    <>
                      <div className="grid gap-2 border-b border-line pb-5">
                        <span className="font-mono text-[10px] font-bold tracking-[0.09em] text-cobalt uppercase">
                          Selected unit / {selected.code}
                        </span>
                        <h3 className="m-0 text-xl font-[680] tracking-[-0.02em] text-midnight">
                          {selected.officialName}
                        </h3>
                        <span className="w-fit rounded-full bg-[#e8f3ed] px-2.5 py-1 text-[10px] font-bold tracking-[0.07em] text-[#316647] uppercase">
                          {selected.lifecycleStatus}
                        </span>
                      </div>
                      <dl className="m-0 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                        <div className="grid gap-1">
                          <dt className="text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
                            Type
                          </dt>
                          <dd className="m-0 font-[620] text-ink">
                            {unitTypeLabel(selected.unitType)}
                          </dd>
                        </div>
                        <div className="grid gap-1">
                          <dt className="text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
                            Parent
                          </dt>
                          <dd className="m-0 font-[620] text-ink">
                            {selected.parentUnitId
                              ? parentNames.get(selected.parentUnitId)
                              : 'No parent · Agency root'}
                          </dd>
                        </div>
                        <div className="grid gap-1">
                          <dt className="text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
                            Direct reports
                          </dt>
                          <dd className="m-0 font-[620] text-ink">
                            {selected.childCount === 1
                              ? '1 child'
                              : `${selected.childCount} children`}
                          </dd>
                        </div>
                        <div className="grid gap-1">
                          <dt className="text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
                            Effective period
                          </dt>
                          <dd className="m-0 font-[620] text-ink">
                            {dateLabel(selected.effectiveFrom)} –{' '}
                            {selected.effectiveTo ? dateLabel(selected.effectiveTo) : 'Present'}
                          </dd>
                        </div>
                      </dl>
                    </>
                  ) : null}
                </div>
              </div>
            )}
          </section>

          <section
            className="min-w-0 overflow-hidden rounded-[5px] border border-line bg-paper"
            aria-labelledby="draft-organization-units-heading"
          >
            <header className="flex min-h-[60px] items-center justify-between gap-4 border-b border-line px-5">
              <div className="grid gap-1">
                <h2
                  className="m-0 text-sm font-[670] text-midnight"
                  id="draft-organization-units-heading"
                >
                  Draft Organization Units
                </h2>
                <span className="text-xs text-muted">
                  {drafts.length === 1
                    ? '1 draft awaiting placement'
                    : `${drafts.length} drafts awaiting placement`}
                </span>
              </div>
              <span className="rounded-full bg-[#fff3d6] px-2.5 py-1 text-[10px] font-bold tracking-[0.07em] text-[#79531c] uppercase">
                Preparation queue
              </span>
            </header>
            {drafts.length === 0 ? (
              <div className="grid min-h-[150px] place-content-center px-6 py-10">
                <strong className="text-[14px] font-[650] text-midnight">
                  No Draft Organization Units.
                </strong>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left">
                  <thead className="bg-[#fafbfd] text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
                    <tr>
                      <th className="border-b border-line px-5 py-3 font-bold">Official name</th>
                      <th className="border-b border-line px-5 py-3 font-bold">Code</th>
                      <th className="border-b border-line px-5 py-3 font-bold">Type</th>
                      <th className="border-b border-line px-5 py-3 font-bold">Effective</th>
                      <th className="border-b border-line px-5 py-3 font-bold">State</th>
                      <th className="border-b border-line px-5 py-3 text-right font-bold">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-[13px] text-ink">
                    {drafts.map((unit) => (
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
                          <span className="inline-flex rounded-full bg-[#fff3d6] px-2 py-1 text-[10px] font-bold tracking-[0.06em] text-[#79531c] uppercase">
                            DRAFT
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          {canActivate ? (
                            <button
                              className="min-h-9 rounded-[3px] border border-[#9eb6d1] px-3 text-xs font-[670] text-cobalt hover:bg-pale-blue"
                              type="button"
                              onClick={(event) => {
                                activationTriggerRef.current = event.currentTarget as unknown as {
                                  focus(): void;
                                };
                                setActivationOpen(true);
                                void prepareActivation(unit);
                              }}
                            >
                              Place and activate {unit.officialName}
                            </button>
                          ) : null}
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
                      Register the unit as a Draft, then place and activate it from the preparation
                      queue.
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
                  <label
                    className="text-sm font-[650] text-ink"
                    htmlFor="organization-official-name"
                  >
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
                      {draft.code || 'No code yet'} · {unitTypeLabel(draft.unitType).toLowerCase()}{' '}
                      · effective {draft.effectiveDate || '—'}
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
      <Dialog open={activationOpen} onOpenChange={handleActivationOpenChange}>
        {activationUnit ? (
          <DialogContent
            aria-busy={activationSubmitting}
            onEscapeKeyDown={(event) => {
              if (activationSubmitting) event.preventDefault();
            }}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              parentFieldRef.current?.focus();
            }}
          >
            <DialogHeader>
              <div className="grid min-w-0 gap-1.5">
                <p className="m-0 font-mono text-[10px] font-bold tracking-[0.1em] text-cobalt uppercase">
                  Organization hierarchy / Activation
                </p>
                <DialogTitle>Activate {activationUnit.officialName}</DialogTitle>
                <DialogDescription>
                  Choose where this unit reports, then activate its effective-dated version.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <button
                  className="min-h-9 min-w-9 shrink-0 rounded-[3px] text-xl text-muted hover:bg-canvas disabled:pointer-events-none disabled:opacity-50"
                  type="button"
                  aria-label="Close activation dialog"
                  disabled={activationSubmitting}
                >
                  ×
                </button>
              </DialogClose>
            </DialogHeader>

            <DialogBody>
              <form
                className="grid gap-5"
                id="activate-organization-unit-form"
                onSubmit={submitActivation}
              >
                <div className="grid min-w-0 grid-cols-[minmax(112px,0.4fr)_minmax(0,1fr)] overflow-hidden rounded-[4px] border border-line bg-[#fafbfd] text-xs">
                  <span className="grid min-w-0 place-items-center break-all border-r border-line bg-pale-blue px-2 text-center font-mono font-bold text-cobalt">
                    {activationUnit.code}
                  </span>
                  <span className="grid min-w-0 gap-1 px-4 py-3 text-muted">
                    <strong className="font-[680] text-ink">{activationUnit.officialName}</strong>
                    <span>
                      {unitTypeLabel(activationUnit.unitType)} · effective{' '}
                      {dateLabel(activationUnit.effectiveDate)}
                    </span>
                  </span>
                </div>

                <div className="grid gap-2">
                  <label className="text-sm font-[650] text-ink" htmlFor="activation-parent-unit">
                    Parent Organization Unit
                  </label>
                  <select
                    className="min-h-11 rounded-[3px] border border-line bg-paper px-3 text-sm text-ink"
                    id="activation-parent-unit"
                    ref={parentFieldRef}
                    value={parentUnitId}
                    aria-invalid={Boolean(activationFieldErrors.parentUnitId)}
                    aria-describedby={
                      activationFieldErrors.parentUnitId ? 'activation-parent-error' : undefined
                    }
                    onChange={(event) => {
                      setParentUnitId((event.currentTarget as unknown as { value: string }).value);
                      setActivationFieldErrors((current) => {
                        if (!current.parentUnitId) return current;
                        const next = { ...current };
                        delete next.parentUnitId;
                        return next;
                      });
                    }}
                  >
                    <option value="">No parent · Agency root</option>
                    {parentOptions.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.officialName}
                      </option>
                    ))}
                  </select>
                  {activationFieldErrors.parentUnitId ? (
                    <span
                      className="text-xs leading-[1.5] text-[#7a3036]"
                      id="activation-parent-error"
                      role="alert"
                    >
                      {activationFieldErrors.parentUnitId}
                    </span>
                  ) : null}
                </div>

                <div className="grid gap-2">
                  <label className="text-sm font-[650] text-ink" htmlFor="activation-reason">
                    Activation reason
                  </label>
                  <textarea
                    className="min-h-[96px] resize-y rounded-[3px] border border-line bg-paper px-3 py-2 text-sm text-ink"
                    id="activation-reason"
                    ref={reasonFieldRef}
                    maxLength={500}
                    value={activationReason}
                    aria-invalid={Boolean(activationFieldErrors.reason)}
                    aria-describedby={
                      activationFieldErrors.reason ? 'activation-reason-error' : undefined
                    }
                    onChange={(event) => {
                      setActivationReason(
                        (event.currentTarget as unknown as { value: string }).value,
                      );
                      setActivationFieldErrors((current) => {
                        if (!current.reason) return current;
                        const next = { ...current };
                        delete next.reason;
                        return next;
                      });
                    }}
                  />
                  {activationFieldErrors.reason ? (
                    <span
                      className="text-xs leading-[1.5] text-[#7a3036]"
                      id="activation-reason-error"
                      role="alert"
                    >
                      {activationFieldErrors.reason}
                    </span>
                  ) : null}
                </div>

                {activationError ? (
                  <p
                    className="m-0 rounded-[4px] border border-[#d6aeb0] bg-[#fff7f7] px-4 py-3 text-sm text-[#7a3036]"
                    role="alert"
                  >
                    {activationError}
                  </p>
                ) : null}
              </form>
            </DialogBody>

            <DialogFooter>
              <span className="mr-auto hidden text-[11px] text-muted min-[621px]:block">
                Activation is recorded in the audit trail.
              </span>
              <DialogClose asChild>
                <button
                  className="min-h-11 rounded-[3px] px-4 text-sm font-[650] text-muted hover:bg-canvas disabled:pointer-events-none disabled:opacity-50"
                  type="button"
                  disabled={activationSubmitting}
                >
                  Cancel
                </button>
              </DialogClose>
              <button
                className="min-h-11 rounded-[3px] bg-cobalt px-4 text-sm font-[650] text-white hover:bg-[#365f96] disabled:pointer-events-none disabled:opacity-50"
                type="submit"
                form="activate-organization-unit-form"
                disabled={
                  activationSubmitting || Boolean(activationError && parentOptions.length === 0)
                }
              >
                {activationSubmitting ? 'Activating…' : 'Activate Organization Unit'}
              </button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
