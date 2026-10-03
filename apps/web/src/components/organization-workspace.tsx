'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { cn } from '../lib/class-names';
import { RecordReturn, useRecordNavigation } from './record-navigation';
import { StateSurface } from './state-surface';
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
  DialogTrigger,
} from './ui/dialog';
import { Field, FormError, inputClass } from './ui/field';
import { PageHeader } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag, type StatusTone } from './ui/status-tag';
import { RowHeader, Table, Td, Th, Tr } from './ui/table';
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

interface OrganizationUnitVersion {
  id: string;
  organizationUnitId: string;
  versionNo: number;
  code: string;
  unitType: OrganizationUnitType;
  officialName: string;
  parentUnitId: string | null;
  costCenterCode: string | null;
  responsibilityCenterCode: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  versionState: 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'VOIDED';
  lifecycleStatus: 'ACTIVE' | 'INACTIVE' | 'ABOLISHED';
}

interface OrganizationUnitSuccessor {
  current: OrganizationUnitVersion;
  draft: OrganizationUnitVersion;
}

interface OrganizationUnitHistory {
  asOf: string;
  effective: OrganizationUnitVersion | null;
  current: OrganizationUnitVersion | null;
  draft: OrganizationUnitVersion | null;
  versions: OrganizationUnitVersion[];
  transitions: Array<{
    id: string;
    action: string;
    previousStatus: string;
    newStatus: string;
    actorDisplayName: string | null;
    reason: string | null;
    effectiveDate: string | null;
    authorityReference: string | null;
    migrationPlan: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    occurredAt: string;
  }>;
}

interface OrganizationUnitListResponse {
  units: OrganizationUnit[];
  drafts?: OrganizationUnitVersion[];
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

interface SuccessorValues {
  officialName: string;
  parentUnitId: string;
  costCenterCode: string;
  responsibilityCenterCode: string;
  effectiveDate: string;
}

type TransitionTarget = 'INACTIVE' | 'ACTIVE' | 'ABOLISHED';

const unitTypes: readonly { value: OrganizationUnitType; label: string }[] = [
  { value: 'DEPARTMENT', label: 'Department' },
  { value: 'BUREAU', label: 'Bureau' },
  { value: 'SERVICE', label: 'Service' },
  { value: 'DIVISION', label: 'Division' },
  { value: 'SECTION', label: 'Section' },
  { value: 'OFFICE', label: 'Office' },
  { value: 'OTHER', label: 'Other' },
];

const lifecycleTone: Record<OrganizationUnit['lifecycleStatus'], StatusTone> = {
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  ABOLISHED: 'danger',
};

const statusTone: Record<OrganizationUnitStatus, StatusTone> = {
  DRAFT: 'warning',
  ...lifecycleTone,
};

const versionTone: Record<OrganizationUnitVersion['versionState'], StatusTone> = {
  DRAFT: 'warning',
  ACTIVE: 'success',
  SUPERSEDED: 'neutral',
  VOIDED: 'danger',
};

function emptyDraft(): DraftValues {
  return {
    officialName: '',
    code: '',
    unitType: 'OFFICE',
    effectiveDate: manilaToday(),
  };
}

function tomorrowManila(): string {
  const date = new Date(`${manilaToday()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
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

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function withoutField(errors: Record<string, string>, field: string): Record<string, string> {
  if (!errors[field]) return errors;
  const next = { ...errors };
  delete next[field];
  return next;
}

function CloseButton({ label, disabled }: { label: string; disabled: boolean }) {
  return (
    <DialogClose asChild>
      <Button
        className="min-w-9 shrink-0 px-0 text-xl"
        type="button"
        aria-label={label}
        disabled={disabled}
      >
        ×
      </Button>
    </DialogClose>
  );
}

function OptionalLabel({ children }: { children: string }) {
  return (
    <>
      {children} <span className="font-normal text-ink-muted">(optional)</span>
    </>
  );
}

function auditField(data: Record<string, unknown> | null, key: string): string | null {
  const value = data?.[key];
  return typeof value === 'string' ? value : null;
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

function isOrganizationUnitVersion(value: unknown): value is OrganizationUnitVersion {
  if (typeof value !== 'object' || value === null) return false;
  const version = value as Partial<OrganizationUnitVersion>;
  return (
    typeof version.id === 'string' &&
    typeof version.organizationUnitId === 'string' &&
    typeof version.officialName === 'string' &&
    typeof version.effectiveFrom === 'string' &&
    typeof version.versionState === 'string'
  );
}

function isOrganizationUnitSuccessor(value: unknown): value is OrganizationUnitSuccessor {
  if (typeof value !== 'object' || value === null) return false;
  const successor = value as Partial<OrganizationUnitSuccessor>;
  return isOrganizationUnitVersion(successor.current) && isOrganizationUnitVersion(successor.draft);
}

function isOrganizationUnitHistory(value: unknown): value is OrganizationUnitHistory {
  if (typeof value !== 'object' || value === null) return false;
  const history = value as Partial<OrganizationUnitHistory>;
  return Array.isArray(history.versions) && Array.isArray(history.transitions);
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
  canAbolish,
  canCreate,
  canInactivate,
  canUpdate,
  initial,
  initialHierarchy,
  tabs,
}: {
  agencyId: string;
  canActivate: boolean;
  canAbolish: boolean;
  canCreate: boolean;
  canInactivate: boolean;
  canUpdate: boolean;
  initial: OrganizationUnitListResponse;
  initialHierarchy: OrganizationHierarchyResponse;
  /** Workspace tabs for the page header band. */
  tabs: ReactNode;
}) {
  const [units, setUnits] = useState(initial.units);
  const [successorDrafts, setSuccessorDrafts] = useState(initial.drafts ?? []);
  const [hierarchy, setHierarchy] = useState(initialHierarchy);
  const [asOf, setAsOf] = useState(initialHierarchy.asOf);
  const navigation = useRecordNavigation();
  const selectedId = navigation.search.get('unit');
  const showHistory = navigation.search.get('section') === 'history';
  function setSelectedId(id: string) {
    navigation.navigate({ unit: id, view: 'form', section: null });
  }
  const historyRequest = useRef(0);
  useEffect(() => {
    setHistory(null);
    setHistoryError('');
    if (selectedId) void loadHistory(selectedId);
    return () => {
      historyRequest.current += 1;
    };
  }, [selectedId, showHistory, asOf]);
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
  const [successor, setSuccessor] = useState<OrganizationUnitSuccessor | null>(null);
  const [successorValues, setSuccessorValues] = useState<SuccessorValues | null>(null);
  const successorCloseAfterSave = useRef(false);
  const showSuccessor = navigation.search.get('section') === 'successor';
  useEffect(() => {
    if (!selectedId || !showSuccessor) return;
    setSuccessor(null);
    let active = true;
    void (async () => {
      const response = await fetch(
        `/api/v1/agencies/${agencyId}/organization-units/${encodeURIComponent(selectedId)}/history?asOf=${asOf}`,
        { credentials: 'include' },
      );
      const value: unknown = await response.json();
      if (!response.ok || !isOrganizationUnitHistory(value) || !value.current || !value.draft)
        throw new Error('The successor draft is unavailable.');
      if (!active) return;
      setSuccessor({ current: value.current, draft: value.draft });
      setSuccessorValues(successorValuesFromVersion(value.draft));
      try {
        const parents = await requestHierarchy(value.draft.effectiveFrom, selectedId);
        if (active)
          setSuccessorParentOptions(
            parents.units.filter((unit) => parents.eligibleParentIds.includes(unit.id)),
          );
      } catch {
        if (!active) return;
        setSuccessorParentOptions([]);
        setSuccessorError(
          'Eligible parent units could not be loaded. You can still review the draft.',
        );
      }
    })().catch((cause: unknown) => {
      if (!active) return;
      setFormError(cause instanceof Error ? cause.message : 'The successor could not be loaded.');
      // Leave the section so reviewing again retries the load.
      navigation.show({ section: null });
    });
    return () => {
      active = false;
    };
  }, [selectedId, showSuccessor, asOf]);

  const [successorReason, setSuccessorReason] = useState('');
  const [successorAuthority, setSuccessorAuthority] = useState('');
  const [successorMigrationPlan, setSuccessorMigrationPlan] = useState('');
  const [successorError, setSuccessorError] = useState('');
  const [successorFieldErrors, setSuccessorFieldErrors] = useState<Record<string, string>>({});
  const [successorSubmitting, setSuccessorSubmitting] = useState(false);
  const [successorParentOptions, setSuccessorParentOptions] = useState<OrganizationHierarchyUnit[]>(
    [],
  );
  const [transitionUnit, setTransitionUnit] = useState<OrganizationUnit | null>(null);
  const [transitionTarget, setTransitionTarget] = useState<TransitionTarget | null>(null);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [transitionDate, setTransitionDate] = useState(tomorrowManila);
  const [transitionReason, setTransitionReason] = useState('');
  const [transitionAuthority, setTransitionAuthority] = useState('');
  const [transitionMigrationPlan, setTransitionMigrationPlan] = useState('');
  const [transitionError, setTransitionError] = useState('');
  const [transitionFieldErrors, setTransitionFieldErrors] = useState<Record<string, string>>({});
  const [transitionSubmitting, setTransitionSubmitting] = useState(false);
  const [history, setHistory] = useState<OrganizationUnitHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const firstFieldRef = useRef<{ focus(): void } | null>(null);
  const codeFieldRef = useRef<{ focus(): void } | null>(null);
  const effectiveDateFieldRef = useRef<{ focus(): void } | null>(null);
  const parentFieldRef = useRef<{ focus(): void } | null>(null);
  const reasonFieldRef = useRef<{ focus(): void } | null>(null);
  const activationTriggerRef = useRef<{ focus(): void } | null>(null);
  const successorNameRef = useRef<{ focus(): void } | null>(null);
  const successorDateRef = useRef<{ focus(): void } | null>(null);
  const successorReasonRef = useRef<{ focus(): void } | null>(null);
  const transitionDateRef = useRef<{ focus(): void } | null>(null);
  const transitionReasonRef = useRef<{ focus(): void } | null>(null);

  const drafts = units.filter(
    (unit) => unit.status === 'DRAFT' && (!selectedId || unit.id === selectedId),
  );
  const selectedListUnit = units.find((unit) => unit.id === selectedId) ?? null;
  const selectedVersion =
    history?.asOf === asOf && history.effective?.organizationUnitId === selectedId
      ? history.effective
      : null;
  const selected =
    hierarchy.units.find((unit) => unit.id === selectedId) ??
    (selectedVersion
      ? {
          id: selectedVersion.organizationUnitId,
          code: selectedVersion.code,
          officialName: selectedVersion.officialName,
          unitType: selectedVersion.unitType,
          parentUnitId: selectedVersion.parentUnitId,
          effectiveFrom: selectedVersion.effectiveFrom,
          effectiveTo: selectedVersion.effectiveTo,
          lifecycleStatus: selectedVersion.lifecycleStatus,
          childCount: 0,
        }
      : selectedListUnit?.status === 'DRAFT'
        ? {
            id: selectedListUnit.id,
            code: selectedListUnit.code,
            officialName: selectedListUnit.officialName,
            unitType: selectedListUnit.unitType,
            parentUnitId: selectedListUnit.parentUnitId,
            effectiveFrom: selectedListUnit.effectiveDate,
            effectiveTo: selectedListUnit.effectiveTo,
            lifecycleStatus: selectedListUnit.lifecycleStatus,
            childCount: 0,
          }
        : null);
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
    setFieldErrors((current) => withoutField(current, field));
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
      setSelectedId(value.id);
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
      if (preferredId) setSelectedId(preferredId);
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

  function successorValuesFromVersion(version: OrganizationUnitVersion): SuccessorValues {
    return {
      officialName: version.officialName,
      parentUnitId: version.parentUnitId ?? '',
      costCenterCode: version.costCenterCode ?? '',
      responsibilityCenterCode: version.responsibilityCenterCode ?? '',
      effectiveDate: version.effectiveFrom,
    };
  }

  function updateSuccessorValue(field: keyof SuccessorValues, value: string): void {
    setSuccessorValues((current) => (current ? { ...current, [field]: value } : current));
    setSuccessorFieldErrors((current) => withoutField(current, field));
  }

  async function loadHistory(unitId: string, date = asOf): Promise<void> {
    const requestId = ++historyRequest.current;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await fetch(
        `/api/v1/agencies/${agencyId}/organization-units/${unitId}/history?asOf=${date}`,
        { credentials: 'include' },
      );
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok || !isOrganizationUnitHistory(value)) {
        throw new Error('The Organization Unit history could not be loaded.');
      }
      if (requestId !== historyRequest.current) return;
      setHistory(value);
    } catch (error) {
      if (requestId !== historyRequest.current) return;
      setHistory(null);
      setHistoryError(error instanceof Error ? error.message : 'The history could not be loaded.');
    } finally {
      if (requestId === historyRequest.current) setHistoryLoading(false);
    }
  }

  async function prepareSuccessor(unitId = selectedListUnit?.id): Promise<void> {
    if (!unitId) return;
    setSuccessorError('');
    setSuccessorFieldErrors({});
    setSuccessorReason('');
    setSuccessorAuthority('');
    setSuccessorMigrationPlan('');
    try {
      const response = await fetch(
        `/api/v1/agencies/${agencyId}/organization-units/${unitId}/successor`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
        },
      );
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setSuccessorError(
          errorDetails(value, 'The Organization Unit successor could not be prepared.').message,
        );
        return;
      }
      if (!isOrganizationUnitSuccessor(value)) {
        setSuccessorError('The proposed successor was not confirmed. Refresh and try again.');
        return;
      }
      setSuccessorDrafts((current) => [
        value.draft,
        ...current.filter((draft) => draft.organizationUnitId !== unitId),
      ]);
      navigation.show({ unit: unitId, view: 'form', section: 'successor' });
    } catch {
      setSuccessorError(
        'The Organization Unit successor could not be prepared. Check the connection and try again.',
      );
    }
  }

  async function saveSuccessor(): Promise<OrganizationUnitVersion | null> {
    if (!successor || !successorValues) return null;
    const errors: Record<string, string> = {};
    if (!successorValues.officialName.trim()) errors.officialName = 'Enter the official name.';
    if (!successorValues.effectiveDate) errors.effectiveDate = 'Choose an effective date.';
    setSuccessorFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      if (errors.officialName) successorNameRef.current?.focus();
      else successorDateRef.current?.focus();
      return null;
    }
    try {
      const response = await fetch(
        `/api/v1/agencies/${agencyId}/organization-units/${successor.draft.organizationUnitId}/draft/${successor.draft.id}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            officialName: successorValues.officialName,
            parentUnitId: successorValues.parentUnitId || null,
            costCenterCode: successorValues.costCenterCode || null,
            responsibilityCenterCode: successorValues.responsibilityCenterCode || null,
            effectiveDate: successorValues.effectiveDate,
          }),
        },
      );
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok || !isOrganizationUnitVersion(value)) {
        const details = errorDetails(value, 'The successor draft could not be saved.');
        setSuccessorFieldErrors(details.fields);
        setSuccessorError(details.message);
        return null;
      }
      setSuccessor((current) => (current ? { ...current, draft: value } : current));
      setSuccessorDrafts((current) => [value, ...current.filter((draft) => draft.id !== value.id)]);
      return value;
    } catch {
      setSuccessorError(
        'The successor draft could not be saved. Check the connection and try again.',
      );
      return null;
    }
  }

  async function submitSuccessor(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!successor) return;
    if (!successorReason.trim()) {
      setSuccessorFieldErrors({ reason: 'Enter the change reason.' });
      successorReasonRef.current?.focus();
      return;
    }
    setSuccessorSubmitting(true);
    setSuccessorError('');
    try {
      const saved = await saveSuccessor();
      if (!saved) return;
      const response = await fetch(
        `/api/v1/agencies/${agencyId}/organization-units/${saved.organizationUnitId}/draft/${saved.id}/activate`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            reason: successorReason,
            authorityReference: successorAuthority || null,
            migrationPlan: successorMigrationPlan || null,
          }),
        },
      );
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setSuccessorError(
          errorDetails(value, 'The Organization Unit successor could not be activated.').message,
        );
        return;
      }
      if (!isOrganizationUnit(value)) {
        setSuccessorError('The successor activation was not confirmed. Refresh and try again.');
        return;
      }
      if (value.effectiveDate <= manilaToday()) {
        setUnits((current) => current.map((unit) => (unit.id === value.id ? value : unit)));
      }
      setSuccessorDrafts((current) =>
        current.filter((draft) => draft.organizationUnitId !== saved.organizationUnitId),
      );
      setSuccess(
        `${value.officialName} is scheduled as the new Organization Unit version effective ${dateLabel(value.effectiveDate)}.`,
      );
      navigation.show({ section: null });
      await loadHierarchy(asOf, value.id);
      await loadHistory(value.id);
    } catch {
      setSuccessorError(
        'The Organization Unit successor could not be activated. Check the connection and try again.',
      );
    } finally {
      setSuccessorSubmitting(false);
    }
  }

  async function submitSavedSuccessor(): Promise<void> {
    setSuccessorSubmitting(true);
    setSuccessorError('');
    try {
      const saved = await saveSuccessor();
      const closeAfterSave = successorCloseAfterSave.current;
      successorCloseAfterSave.current = false;
      if (saved) {
        setSuccess(`Draft successor saved for ${dateLabel(saved.effectiveFrom)}.`);
        if (closeAfterSave) navigation.show({ section: null });
      }
    } finally {
      setSuccessorSubmitting(false);
    }
  }

  function openTransition(target: TransitionTarget): void {
    if (!selectedListUnit) return;
    setTransitionUnit(selectedListUnit);
    setTransitionTarget(target);
    setTransitionDate(tomorrowManila());
    setTransitionReason('');
    setTransitionAuthority('');
    setTransitionMigrationPlan('');
    setTransitionError('');
    setTransitionFieldErrors({});
    setTransitionOpen(true);
  }

  async function submitTransition(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!transitionUnit || !transitionTarget) return;
    const errors: Record<string, string> = {};
    if (!transitionDate) errors.effectiveDate = 'Choose an effective date.';
    if (!transitionReason.trim()) errors.reason = 'Enter the transition reason.';
    if (transitionTarget !== 'INACTIVE' && !transitionAuthority.trim()) {
      errors.authorityReference = 'Enter the authority reference.';
    }
    setTransitionFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      if (errors.effectiveDate) transitionDateRef.current?.focus();
      else transitionReasonRef.current?.focus();
      return;
    }
    setTransitionSubmitting(true);
    setTransitionError('');
    try {
      const action = transitionTarget === 'ACTIVE' ? 'reactivate' : transitionTarget.toLowerCase();
      const response = await fetch(
        `/api/v1/agencies/${agencyId}/organization-units/${transitionUnit.id}/${action}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            effectiveDate: transitionDate,
            reason: transitionReason,
            authorityReference: transitionAuthority || null,
            migrationPlan: transitionMigrationPlan || null,
          }),
        },
      );
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setTransitionError(
          errorDetails(value, 'The Organization Unit transition could not be recorded.').message,
        );
        return;
      }
      if (!isOrganizationUnit(value)) {
        setTransitionError('The transition was not confirmed. Refresh and try again.');
        return;
      }
      if (value.effectiveDate <= manilaToday()) {
        setUnits((current) => current.map((unit) => (unit.id === value.id ? value : unit)));
      }
      setSuccess(
        `${value.officialName} is scheduled to become ${value.lifecycleStatus.toLowerCase()} effective ${dateLabel(value.effectiveDate)}.`,
      );
      setTransitionOpen(false);
      await loadHierarchy(asOf, value.id);
      await loadHistory(value.id);
    } catch {
      setTransitionError(
        'The Organization Unit transition could not be recorded. Check the connection and try again.',
      );
    } finally {
      setTransitionSubmitting(false);
    }
  }

  const rows = hierarchyRows(hierarchy.units);
  const visibleSuccessorDrafts = successorDrafts.filter(
    (draft) => !selectedId || draft.organizationUnitId === selectedId,
  );
  const draftCount = drafts.length + visibleSuccessorDrafts.length;
  const registeredUnits = units.filter((unit) => unit.status !== 'DRAFT');

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <div className="grid min-w-0 gap-5">
          <PageHeader
            breadcrumbs={[{ label: 'Structure' }, { label: 'Organization' }]}
            title="Organization Units"
            actions={
              canCreate ? (
                <DialogTrigger asChild>
                  <Button variant="primary" type="button">
                    Create Organization Unit
                  </Button>
                </DialogTrigger>
              ) : null
            }
            tabs={tabs}
          />

          {success ? (
            <p className="m-0 text-small text-success" role="status">
              {success}
            </p>
          ) : null}
          {!open ? <FormError message={formError} /> : null}

          <Panel
            title="Effective hierarchy"
            flush
            actions={
              <>
                <span className="text-caption text-ink-muted tabular-nums">
                  {hierarchy.units.length === 1
                    ? '1 active unit'
                    : `${hierarchy.units.length} active units`}
                </span>
                <label className="flex items-center gap-2 text-caption font-[650] text-ink">
                  Hierarchy as of
                  <input
                    className={cn(inputClass, 'w-auto')}
                    type="date"
                    value={asOf}
                    onChange={(event) => {
                      const date = targetValue(event);
                      setAsOf(date);
                      if (date) {
                        setHierarchyLoading(true);
                        navigation.navigate({ asOf: date });
                      }
                    }}
                  />
                </label>
              </>
            }
          >
            {hierarchyLoading ? (
              <StateSurface label="Effective hierarchy status" compact busy>
                <p className="m-0" role="status">
                  Loading effective hierarchy…
                </p>
              </StateSurface>
            ) : rows.length === 0 && !selectedId ? (
              <StateSurface label="Effective hierarchy status" compact>
                <strong className="font-[650] text-ink">
                  No active Organization Units on this date.
                </strong>
                <p className="m-0">
                  Activate a Draft Organization Unit effective on or before this date.
                </p>
              </StateSurface>
            ) : selectedId ? (
              <div
                className="grid content-start gap-5 p-4"
                aria-label="Selected Organization Unit"
                role="region"
              >
                <div>
                  <RecordReturn href={navigation.href({ unit: null, view: null, section: null })}>
                    ← Organization Units
                  </RecordReturn>
                </div>
                {selected ? (
                  <>
                    <div className="grid gap-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="m-0 text-page-title text-ink">{selected.officialName}</h3>
                        <StatusTag tone={lifecycleTone[selected.lifecycleStatus]}>
                          {selected.lifecycleStatus}
                        </StatusTag>
                      </div>
                      <p className="m-0 text-caption text-ink-muted">
                        {selected.code} · {selectedListUnit?.versionState ?? 'ACTIVE'}
                      </p>
                    </div>
                    <dl className="m-0 grid gap-x-10 gap-y-4 min-[620px]:grid-cols-2">
                      {[
                        ['Type', unitTypeLabel(selected.unitType)],
                        [
                          'Parent',
                          selected.parentUnitId
                            ? parentNames.get(selected.parentUnitId)
                            : 'No parent · Agency root',
                        ],
                        [
                          'Direct reports',
                          selected.childCount === 1 ? '1 child' : `${selected.childCount} children`,
                        ],
                        [
                          'Effective period',
                          `${dateLabel(selected.effectiveFrom)} – ${
                            selected.effectiveTo ? dateLabel(selected.effectiveTo) : 'Present'
                          }`,
                        ],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt className="text-caption text-ink-muted">{label}</dt>
                          <dd className="m-0 text-body font-[600] text-ink">{value}</dd>
                        </div>
                      ))}
                    </dl>
                    {selectedListUnit && selectedListUnit.status !== 'DRAFT' ? (
                      <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-4">
                        {canUpdate && selected.lifecycleStatus !== 'ABOLISHED' ? (
                          <Button
                            variant="primary"
                            type="button"
                            onClick={() => void prepareSuccessor(selected.id)}
                          >
                            Prepare change
                          </Button>
                        ) : null}
                        {canInactivate && selected.lifecycleStatus === 'ACTIVE' ? (
                          <Button
                            variant="secondary"
                            type="button"
                            onClick={() => openTransition('INACTIVE')}
                          >
                            Inactivate
                          </Button>
                        ) : null}
                        {canActivate && selected.lifecycleStatus === 'INACTIVE' ? (
                          <Button
                            variant="secondary"
                            type="button"
                            onClick={() => openTransition('ACTIVE')}
                          >
                            Reactivate
                          </Button>
                        ) : null}
                        {canAbolish && selected.lifecycleStatus !== 'ABOLISHED' ? (
                          <Button
                            variant="secondary"
                            className="border-danger text-danger"
                            type="button"
                            onClick={() => openTransition('ABOLISHED')}
                          >
                            Abolish
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          onClick={() => navigation.navigate({ section: 'history' })}
                        >
                          View history
                        </Button>
                      </div>
                    ) : null}
                  </>
                ) : historyLoading ? (
                  <p className="m-0 text-small text-ink-muted" role="status">
                    Loading Organization Unit…
                  </p>
                ) : (
                  <p className="m-0 text-small text-danger" role="alert">
                    This Organization Unit is unavailable. It may be missing or outside your
                    permitted scope.
                  </p>
                )}
              </div>
            ) : (
              <nav className="min-w-0 overflow-x-auto py-1" aria-label="Organization hierarchy">
                <div className="min-w-[280px]">
                  {rows.map(({ unit, depth }) => (
                    <button
                      className="relative grid w-full cursor-pointer grid-cols-[18px_1fr_auto] items-center gap-2 border-0 bg-surface py-2 pr-4 text-left hover:bg-canvas aria-pressed:bg-primary/8 aria-pressed:shadow-[inset_3px_0_0_var(--color-primary)]"
                      style={{ paddingLeft: `${12 + depth * 22}px` }}
                      type="button"
                      key={unit.id}
                      aria-pressed={selectedId === unit.id}
                      onClick={() => setSelectedId(unit.id)}
                    >
                      <span className="h-px bg-border" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block truncate text-small font-[600] text-ink">
                          {unit.officialName}
                        </span>
                        <span className="block truncate text-caption text-ink-muted">
                          {unit.code} · {unitTypeLabel(unit.unitType)}
                        </span>
                      </span>
                      <span className="text-caption text-ink-muted tabular-nums">
                        {unit.childCount}
                      </span>
                      {Array.from({ length: depth }, (_, connectorDepth) => (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute top-0 bottom-0 w-px bg-border"
                          data-tree-connector="vertical"
                          key={connectorDepth}
                          style={{ left: `${12 + (connectorDepth + 1) * 22}px` }}
                        />
                      ))}
                    </button>
                  ))}
                </div>
              </nav>
            )}
          </Panel>

          {selectedId && showHistory ? (
            <Panel
              title="Organization Unit history"
              flush
              actions={
                selected ? (
                  <Button type="button" onClick={() => void loadHistory(selected.id)}>
                    Refresh history
                  </Button>
                ) : null
              }
            >
              <p className="m-0 border-b border-border-subtle px-4 py-2 text-caption text-ink-muted">
                Version and transition evidence as of {dateLabel(asOf)}
              </p>
              {historyLoading ? (
                <StateSurface label="Organization Unit history status" compact busy>
                  <p className="m-0" role="status">
                    Loading history…
                  </p>
                </StateSurface>
              ) : historyError ? (
                <StateSurface label="Organization Unit history status" compact>
                  <p className="m-0 text-danger" role="alert">
                    {historyError}
                  </p>
                </StateSurface>
              ) : history ? (
                <>
                  <dl className="m-0 grid gap-x-10 gap-y-4 p-4 min-[620px]:grid-cols-3">
                    {[
                      {
                        label: 'Effective on date',
                        name: history.effective?.officialName ?? 'No published version',
                        detail: history.effective?.lifecycleStatus ?? '—',
                      },
                      {
                        label: 'Current projection',
                        name: history.current?.officialName ?? 'No current version',
                        detail: history.current?.lifecycleStatus ?? '—',
                      },
                      {
                        label: 'Draft successor',
                        name: history.draft?.officialName ?? 'None',
                        detail: history.draft
                          ? `Effective ${dateLabel(history.draft.effectiveFrom)}`
                          : 'No pending draft',
                      },
                    ].map((fact) => (
                      <div key={fact.label}>
                        <dt className="text-caption text-ink-muted">{fact.label}</dt>
                        <dd className="m-0 text-body font-[600] text-ink">{fact.name}</dd>
                        <dd className="m-0 text-caption text-ink-muted">{fact.detail}</dd>
                      </div>
                    ))}
                  </dl>
                  <Table className="min-w-[900px] border-t border-border">
                    <thead>
                      <tr>
                        <Th>Version</Th>
                        <Th>Official name</Th>
                        <Th>Parent</Th>
                        <Th>Centers</Th>
                        <Th kind="date">Period</Th>
                        <Th>State</Th>
                        <Th>Lifecycle</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.versions.map((version) => (
                        <Tr key={version.id}>
                          <Td className="tabular-nums">v{version.versionNo}</Td>
                          <RowHeader>{version.officialName}</RowHeader>
                          <Td>
                            {version.parentUnitId
                              ? (parentNames.get(version.parentUnitId) ?? version.parentUnitId)
                              : 'Agency root'}
                          </Td>
                          <Td>
                            {version.costCenterCode ?? '—'} ·{' '}
                            {version.responsibilityCenterCode ?? '—'}
                          </Td>
                          <Td kind="date">
                            {dateLabel(version.effectiveFrom)} –{' '}
                            {version.effectiveTo ? dateLabel(version.effectiveTo) : 'Present'}
                          </Td>
                          <Td>
                            <StatusTag tone={versionTone[version.versionState]}>
                              {version.versionState}
                            </StatusTag>
                          </Td>
                          <Td>
                            <StatusTag tone={lifecycleTone[version.lifecycleStatus]}>
                              {version.lifecycleStatus}
                            </StatusTag>
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                  {history.transitions.length > 0 ? (
                    <div className="grid gap-3 p-4">
                      <h3 className="m-0 text-caption font-[650] text-ink-muted">
                        Transition evidence
                      </h3>
                      {history.transitions.map((transition) => (
                        <div
                          className="grid gap-0.5 border-l-2 border-border pl-3 text-caption text-ink-muted"
                          key={transition.id}
                        >
                          <strong className="text-small font-[650] text-ink">
                            {transition.action.replaceAll('_', ' ')}
                          </strong>
                          <span>
                            {transition.actorDisplayName
                              ? `Actor ${transition.actorDisplayName} · `
                              : ''}
                            {transition.previousStatus} → {transition.newStatus} ·{' '}
                            {transition.effectiveDate
                              ? `Effective ${dateLabel(transition.effectiveDate)} · `
                              : ''}
                            {transition.reason ?? 'No reason recorded'}
                          </span>
                          {transition.authorityReference ? (
                            <span>Authority: {transition.authorityReference}</span>
                          ) : null}
                          {transition.migrationPlan ? (
                            <span>Migration plan: {transition.migrationPlan}</span>
                          ) : null}
                          {transition.before || transition.after ? (
                            <span>
                              Before: {auditField(transition.before, 'officialName') ?? '—'} ·{' '}
                              {auditField(transition.before, 'parentUnitId') ?? 'Agency root'} →
                              After: {auditField(transition.after, 'officialName') ?? '—'} ·{' '}
                              {auditField(transition.after, 'parentUnitId') ?? 'Agency root'}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </Panel>
          ) : null}

          {!selectedId ? (
            <Panel
              title="Organization Unit register"
              flush
              actions={
                <span className="text-caption text-ink-muted tabular-nums">
                  {registeredUnits.length === 1 ? '1 record' : `${registeredUnits.length} records`}
                </span>
              }
            >
              {registeredUnits.length === 0 ? (
                <StateSurface label="Organization Unit register status" compact>
                  <p className="m-0">No activated Organization Units yet.</p>
                </StateSurface>
              ) : (
                <Table className="min-w-[700px]">
                  <thead>
                    <tr>
                      <Th>Official name</Th>
                      <Th>Code</Th>
                      <Th>Lifecycle</Th>
                      <Th kind="date">Effective</Th>
                      <Th className="text-right">Action</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {registeredUnits.map((unit) => (
                      <Tr key={unit.id}>
                        <RowHeader>{unit.officialName}</RowHeader>
                        <Td className="whitespace-nowrap">{unit.code}</Td>
                        <Td>
                          <StatusTag tone={statusTone[unit.status]}>{unit.status}</StatusTag>
                        </Td>
                        <Td kind="date">{dateLabel(unit.effectiveDate)}</Td>
                        <Td className="text-right">
                          <Button
                            className="-my-2"
                            type="button"
                            onClick={() => setSelectedId(unit.id)}
                          >
                            Inspect record
                          </Button>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Panel>
          ) : null}

          <Panel
            title="Draft Organization Units"
            flush
            actions={
              <span className="text-caption text-ink-muted tabular-nums">
                {draftCount === 1
                  ? '1 draft awaiting placement'
                  : `${draftCount} drafts awaiting placement`}
              </span>
            }
          >
            {draftCount === 0 ? (
              <StateSurface label="Draft Organization Units status" compact>
                <p className="m-0">No Draft Organization Units.</p>
              </StateSurface>
            ) : (
              <Table className="min-w-[760px]">
                <thead>
                  <tr>
                    <Th>Official name</Th>
                    <Th>Code</Th>
                    <Th>Type</Th>
                    <Th kind="date">Effective</Th>
                    <Th>State</Th>
                    <Th className="text-right">Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((unit) => (
                    <Tr
                      className="data-[highlighted=true]:bg-primary/8"
                      data-highlighted={highlightedId === unit.id}
                      key={unit.id}
                    >
                      <RowHeader>
                        <button
                          type="button"
                          className="cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-primary hover:underline"
                          onClick={() => setSelectedId(unit.id)}
                        >
                          {unit.officialName}
                        </button>
                      </RowHeader>
                      <Td className="whitespace-nowrap">{unit.code}</Td>
                      <Td>{unitTypeLabel(unit.unitType)}</Td>
                      <Td kind="date">{dateLabel(unit.effectiveDate)}</Td>
                      <Td>
                        <StatusTag tone="warning">DRAFT</StatusTag>
                      </Td>
                      <Td className="text-right">
                        {canActivate ? (
                          <Button
                            className="-my-2"
                            variant="secondary"
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
                          </Button>
                        ) : null}
                      </Td>
                    </Tr>
                  ))}
                  {visibleSuccessorDrafts.map((draft) => (
                    <Tr key={draft.id}>
                      <RowHeader>{draft.officialName}</RowHeader>
                      <Td className="whitespace-nowrap">{draft.code}</Td>
                      <Td>{unitTypeLabel(draft.unitType)}</Td>
                      <Td kind="date">{dateLabel(draft.effectiveFrom)}</Td>
                      <Td>
                        <StatusTag tone="warning">DRAFT SUCCESSOR</StatusTag>
                      </Td>
                      <Td className="text-right">
                        {canUpdate || canActivate ? (
                          <Button
                            className="-my-2"
                            variant="secondary"
                            type="button"
                            onClick={() =>
                              navigation.show({
                                unit: draft.organizationUnitId,
                                view: 'form',
                                section: 'successor',
                              })
                            }
                          >
                            Review successor
                          </Button>
                        ) : null}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          <DialogContent
            aria-busy={submitting}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              firstFieldRef.current?.focus();
            }}
          >
            <DialogHeader>
              <div className="grid min-w-0 gap-1.5">
                <DialogTitle>Create Organization Unit</DialogTitle>
                <DialogDescription>
                  Register the unit as a Draft, then place and activate it from the preparation
                  queue.
                </DialogDescription>
              </div>
              <CloseButton label="Close Organization Unit dialog" disabled={submitting} />
            </DialogHeader>

            <DialogBody>
              <form className="grid gap-4" id="create-organization-unit-form" onSubmit={submit}>
                <Field label="Official name" error={fieldErrors.officialName}>
                  <input
                    className={inputClass}
                    ref={firstFieldRef}
                    type="text"
                    autoComplete="organization"
                    value={draft.officialName}
                    onChange={(event) => updateDraft('officialName', targetValue(event))}
                  />
                </Field>
                <Field label="Agency-unique code" error={fieldErrors.code}>
                  <input
                    className={cn(inputClass, 'uppercase')}
                    ref={codeFieldRef}
                    type="text"
                    autoComplete="off"
                    maxLength={50}
                    value={draft.code}
                    aria-describedby="organization-code-help"
                    onChange={(event) => updateDraft('code', targetValue(event))}
                  />
                </Field>
                <p className="-mt-2 mb-0 text-caption text-ink-muted" id="organization-code-help">
                  The same code may be used by another Agency, but not twice here.
                </p>
                <Field label="Unit type">
                  <select
                    className={inputClass}
                    value={draft.unitType}
                    onChange={(event) => updateDraft('unitType', targetValue(event))}
                  >
                    {unitTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Effective date" error={fieldErrors.effectiveDate}>
                  <input
                    className={inputClass}
                    ref={effectiveDateFieldRef}
                    type="date"
                    value={draft.effectiveDate}
                    onChange={(event) => updateDraft('effectiveDate', targetValue(event))}
                  />
                </Field>
                <FormError message={formError} />
              </form>
            </DialogBody>

            <DialogFooter>
              <span className="mr-auto hidden self-center text-caption text-ink-muted min-[621px]:block">
                Agency scoped · Four required fields
              </span>
              <DialogClose asChild>
                <Button variant="secondary" type="button" disabled={submitting}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                variant="primary"
                type="submit"
                form="create-organization-unit-form"
                disabled={submitting}
              >
                {submitting ? 'Creating…' : 'Create Draft'}
              </Button>
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
                <DialogTitle>Activate {activationUnit.officialName}</DialogTitle>
                <DialogDescription>
                  Choose where this unit reports, then activate its effective-dated version.
                </DialogDescription>
              </div>
              <CloseButton label="Close activation dialog" disabled={activationSubmitting} />
            </DialogHeader>

            <DialogBody>
              <form
                className="grid gap-4"
                id="activate-organization-unit-form"
                onSubmit={submitActivation}
              >
                <dl className="m-0 grid gap-x-8 gap-y-3 rounded-control border border-border bg-canvas px-3 py-2.5 min-[621px]:grid-cols-3">
                  {[
                    ['Code', activationUnit.code],
                    ['Type', unitTypeLabel(activationUnit.unitType)],
                    ['Effective', dateLabel(activationUnit.effectiveDate)],
                  ].map(([label, value]) => (
                    <div className="min-w-0" key={label}>
                      <dt className="text-caption text-ink-muted">{label}</dt>
                      <dd className="m-0 text-small font-[600] break-all text-ink">{value}</dd>
                    </div>
                  ))}
                </dl>
                <Field label="Parent Organization Unit" error={activationFieldErrors.parentUnitId}>
                  <select
                    className={inputClass}
                    ref={parentFieldRef}
                    value={parentUnitId}
                    onChange={(event) => {
                      setParentUnitId(targetValue(event));
                      setActivationFieldErrors((current) => withoutField(current, 'parentUnitId'));
                    }}
                  >
                    <option value="">No parent · Agency root</option>
                    {parentOptions.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.officialName}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Activation reason" error={activationFieldErrors.reason}>
                  <textarea
                    className={cn(inputClass, 'min-h-24 resize-y py-2')}
                    ref={reasonFieldRef}
                    maxLength={500}
                    value={activationReason}
                    onChange={(event) => {
                      setActivationReason(targetValue(event));
                      setActivationFieldErrors((current) => withoutField(current, 'reason'));
                    }}
                  />
                </Field>
                <FormError message={activationError} />
              </form>
            </DialogBody>

            <DialogFooter>
              <span className="mr-auto hidden self-center text-caption text-ink-muted min-[621px]:block">
                Activation is recorded in the audit trail.
              </span>
              <DialogClose asChild>
                <Button variant="secondary" type="button" disabled={activationSubmitting}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                variant="primary"
                type="submit"
                form="activate-organization-unit-form"
                disabled={
                  activationSubmitting || Boolean(activationError && parentOptions.length === 0)
                }
              >
                {activationSubmitting ? 'Activating…' : 'Activate Organization Unit'}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
      <Dialog
        presentation="form"
        open={showSuccessor && successor !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !successorSubmitting) navigation.show({ section: null });
        }}
      >
        {successor && successorValues ? (
          <DialogContent
            aria-busy={successorSubmitting}
            aria-describedby="organization-successor-description"
            onEscapeKeyDown={(event) => {
              if (successorSubmitting) {
                successorCloseAfterSave.current = true;
                event.preventDefault();
              }
            }}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              successorNameRef.current?.focus();
            }}
          >
            <DialogHeader>
              <div className="grid min-w-0 gap-1.5">
                <DialogTitle>Review Organization Unit successor</DialogTitle>
                <DialogDescription id="organization-successor-description">
                  Edit the proposed values and effective date. The current version remains unchanged
                  until activation.
                </DialogDescription>
              </div>
              <CloseButton label="Close successor dialog" disabled={successorSubmitting} />
            </DialogHeader>

            <DialogBody>
              <form
                className="grid gap-4"
                id="organization-successor-form"
                onSubmit={submitSuccessor}
              >
                <div className="grid gap-3 min-[621px]:grid-cols-2">
                  {[
                    {
                      label: 'Current version',
                      name: successor.current.officialName,
                      period: `Effective ${dateLabel(successor.current.effectiveFrom)} · ${successor.current.lifecycleStatus}`,
                      parentUnitId: successor.current.parentUnitId,
                      costCenterCode: successor.current.costCenterCode,
                      responsibilityCenterCode: successor.current.responsibilityCenterCode,
                    },
                    {
                      label: 'Proposed successor',
                      name: successorValues.officialName || 'Untitled Organization Unit',
                      period: `Effective ${dateLabel(successorValues.effectiveDate)} · successor draft`,
                      parentUnitId: successorValues.parentUnitId || null,
                      costCenterCode: successorValues.costCenterCode || null,
                      responsibilityCenterCode: successorValues.responsibilityCenterCode || null,
                    },
                  ].map((version) => (
                    <div
                      className="grid gap-0.5 rounded-control border border-border bg-canvas px-3 py-2.5 text-caption text-ink-muted"
                      key={version.label}
                    >
                      <span className="font-[650]">{version.label}</span>
                      <strong className="text-small font-[650] text-ink">{version.name}</strong>
                      <span>{version.period}</span>
                      <span>
                        Parent:{' '}
                        {version.parentUnitId
                          ? (parentNames.get(version.parentUnitId) ?? version.parentUnitId)
                          : 'Agency root'}
                      </span>
                      <span>
                        Cost center: {version.costCenterCode ?? '—'} · Responsibility:{' '}
                        {version.responsibilityCenterCode ?? '—'}
                      </span>
                    </div>
                  ))}
                </div>
                <Field label="Proposed official name" error={successorFieldErrors.officialName}>
                  <input
                    className={cn(inputClass, 'disabled:bg-canvas')}
                    ref={successorNameRef}
                    type="text"
                    value={successorValues.officialName}
                    disabled={!canUpdate || successorSubmitting}
                    onChange={(event) => updateSuccessorValue('officialName', targetValue(event))}
                  />
                </Field>
                <Field label="Proposed parent Organization Unit">
                  <select
                    className={cn(inputClass, 'disabled:bg-canvas')}
                    value={successorValues.parentUnitId}
                    disabled={!canUpdate || successorSubmitting}
                    onChange={(event) => updateSuccessorValue('parentUnitId', targetValue(event))}
                  >
                    <option value="">No parent · Agency root</option>
                    {successorParentOptions.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.officialName}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid gap-4 min-[621px]:grid-cols-2">
                  <Field label="Cost center">
                    <input
                      className={cn(inputClass, 'disabled:bg-canvas')}
                      type="text"
                      value={successorValues.costCenterCode}
                      disabled={!canUpdate || successorSubmitting}
                      onChange={(event) =>
                        updateSuccessorValue('costCenterCode', targetValue(event))
                      }
                    />
                  </Field>
                  <Field label="Responsibility center">
                    <input
                      className={cn(inputClass, 'disabled:bg-canvas')}
                      type="text"
                      value={successorValues.responsibilityCenterCode}
                      disabled={!canUpdate || successorSubmitting}
                      onChange={(event) =>
                        updateSuccessorValue('responsibilityCenterCode', targetValue(event))
                      }
                    />
                  </Field>
                </div>
                <Field label="Successor effective date" error={successorFieldErrors.effectiveDate}>
                  <input
                    className={cn(inputClass, 'disabled:bg-canvas')}
                    ref={successorDateRef}
                    type="date"
                    value={successorValues.effectiveDate}
                    disabled={!canUpdate || successorSubmitting}
                    onChange={(event) => updateSuccessorValue('effectiveDate', targetValue(event))}
                  />
                </Field>
                {canActivate ? (
                  <>
                    <Field label="Change reason" error={successorFieldErrors.reason}>
                      <textarea
                        className={cn(inputClass, 'min-h-22 resize-y py-2')}
                        ref={successorReasonRef}
                        maxLength={500}
                        value={successorReason}
                        onChange={(event) => setSuccessorReason(targetValue(event))}
                      />
                    </Field>
                    <Field label={<OptionalLabel>Authority reference</OptionalLabel>}>
                      <input
                        className={inputClass}
                        type="text"
                        value={successorAuthority}
                        disabled={successorSubmitting}
                        onChange={(event) => setSuccessorAuthority(targetValue(event))}
                      />
                    </Field>
                    <Field label={<OptionalLabel>Migration plan</OptionalLabel>}>
                      <textarea
                        className={cn(inputClass, 'min-h-18 resize-y py-2')}
                        value={successorMigrationPlan}
                        disabled={successorSubmitting}
                        onChange={(event) => setSuccessorMigrationPlan(targetValue(event))}
                      />
                    </Field>
                  </>
                ) : null}
                <FormError message={successorError} />
              </form>
            </DialogBody>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="quiet" type="button" disabled={successorSubmitting}>
                  Cancel
                </Button>
              </DialogClose>
              {canUpdate ? (
                <Button
                  variant="secondary"
                  type="button"
                  disabled={successorSubmitting}
                  onClick={() => void submitSavedSuccessor()}
                >
                  {successorSubmitting ? 'Saving…' : 'Save Draft'}
                </Button>
              ) : null}
              {canActivate ? (
                <Button
                  variant="primary"
                  type="submit"
                  form="organization-successor-form"
                  disabled={successorSubmitting}
                >
                  {successorSubmitting ? 'Activating…' : 'Activate successor'}
                </Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
      <Dialog
        open={transitionOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && transitionSubmitting) return;
          setTransitionOpen(nextOpen);
        }}
      >
        {transitionUnit && transitionTarget ? (
          <DialogContent
            aria-busy={transitionSubmitting}
            onEscapeKeyDown={(event) => {
              if (transitionSubmitting) event.preventDefault();
            }}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              transitionDateRef.current?.focus();
            }}
          >
            <DialogHeader>
              <div className="grid min-w-0 gap-1.5">
                <DialogTitle>
                  {transitionTarget === 'ACTIVE'
                    ? 'Reactivate'
                    : transitionTarget === 'INACTIVE'
                      ? 'Inactivate'
                      : 'Abolish'}{' '}
                  {transitionUnit.officialName}
                </DialogTitle>
                <DialogDescription>
                  Record a new effective-dated version. Existing history and assignments are not
                  rewritten.
                </DialogDescription>
              </div>
              <CloseButton label="Close lifecycle dialog" disabled={transitionSubmitting} />
            </DialogHeader>
            <DialogBody>
              <form
                className="grid gap-4"
                id="organization-transition-form"
                onSubmit={submitTransition}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-border bg-canvas px-3 py-2.5 text-caption text-ink-muted">
                  <strong className="text-small font-[650] text-ink">
                    {transitionUnit.officialName}
                  </strong>
                  <span>{transitionUnit.code}</span>
                  <StatusTag tone={lifecycleTone[transitionUnit.lifecycleStatus]}>
                    {transitionUnit.lifecycleStatus}
                  </StatusTag>
                </div>
                <Field label="Effective date" error={transitionFieldErrors.effectiveDate}>
                  <input
                    className={inputClass}
                    ref={transitionDateRef}
                    type="date"
                    value={transitionDate}
                    onChange={(event) => setTransitionDate(targetValue(event))}
                  />
                </Field>
                <Field label="Reason" error={transitionFieldErrors.reason}>
                  <textarea
                    className={cn(inputClass, 'min-h-22 resize-y py-2')}
                    ref={transitionReasonRef}
                    maxLength={500}
                    value={transitionReason}
                    onChange={(event) => setTransitionReason(targetValue(event))}
                  />
                </Field>
                {transitionTarget !== 'INACTIVE' ? (
                  <Field
                    label="Authority reference"
                    error={transitionFieldErrors.authorityReference}
                  >
                    <input
                      className={inputClass}
                      type="text"
                      value={transitionAuthority}
                      onChange={(event) => setTransitionAuthority(targetValue(event))}
                    />
                  </Field>
                ) : null}
                {transitionTarget !== 'ACTIVE' ? (
                  <Field
                    label={
                      <>
                        Migration plan{' '}
                        <span className="font-normal text-ink-muted">
                          (required when dependencies remain)
                        </span>
                      </>
                    }
                  >
                    <textarea
                      className={cn(inputClass, 'min-h-22 resize-y py-2')}
                      value={transitionMigrationPlan}
                      onChange={(event) => setTransitionMigrationPlan(targetValue(event))}
                    />
                  </Field>
                ) : null}
                <FormError message={transitionError} />
              </form>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary" type="button" disabled={transitionSubmitting}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                variant="primary"
                type="submit"
                form="organization-transition-form"
                disabled={transitionSubmitting}
              >
                {transitionSubmitting ? 'Saving…' : `Record ${transitionTarget.toLowerCase()}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
