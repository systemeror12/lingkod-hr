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
}: {
  agencyId: string;
  canActivate: boolean;
  canAbolish: boolean;
  canCreate: boolean;
  canInactivate: boolean;
  canUpdate: boolean;
  initial: OrganizationUnitListResponse;
  initialHierarchy: OrganizationHierarchyResponse;
}) {
  const [units, setUnits] = useState(initial.units);
  const [successorDrafts, setSuccessorDrafts] = useState(initial.drafts ?? []);
  const [hierarchy, setHierarchy] = useState(initialHierarchy);
  const [asOf, setAsOf] = useState(initialHierarchy.asOf);
  const [selectedId, setSelectedId] = useState(
    initialHierarchy.units[0]?.id ?? initial.units[0]?.id ?? null,
  );
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
  const [successorOpen, setSuccessorOpen] = useState(false);
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

  const drafts = units.filter((unit) => unit.status === 'DRAFT');
  const selectedListUnit = units.find((unit) => unit.id === selectedId) ?? null;
  const selected =
    hierarchy.units.find((unit) => unit.id === selectedId) ??
    (selectedListUnit
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
    setSuccessorFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function loadHistory(unitId: string, date = asOf): Promise<void> {
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
      setHistory(value);
    } catch (error) {
      setHistory(null);
      setHistoryError(error instanceof Error ? error.message : 'The history could not be loaded.');
    } finally {
      setHistoryLoading(false);
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
      setSuccessor(value);
      setSuccessorValues(successorValuesFromVersion(value.draft));
      setSuccessorDrafts((current) => [
        value.draft,
        ...current.filter((draft) => draft.organizationUnitId !== unitId),
      ]);
      setSuccessorOpen(true);
      try {
        const eligibleHierarchy = await requestHierarchy(value.draft.effectiveFrom, unitId);
        const eligibleIds = new Set(eligibleHierarchy.eligibleParentIds);
        setSuccessorParentOptions(
          eligibleHierarchy.units.filter((candidate) => eligibleIds.has(candidate.id)),
        );
      } catch {
        setSuccessorParentOptions([]);
        setSuccessorError(
          'Eligible parent units could not be loaded. You can still review the draft.',
        );
      }
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
      setSuccessorOpen(false);
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
      if (saved) setSuccess(`Draft successor saved for ${dateLabel(saved.effectiveFrom)}.`);
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
  const draftCount = drafts.length + successorDrafts.length;
  const registeredUnits = units.filter((unit) => unit.status !== 'DRAFT');

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
                      {selectedListUnit ? (
                        <div className="flex flex-wrap gap-2 border-t border-line pt-5">
                          {canUpdate && selected.lifecycleStatus !== 'ABOLISHED' ? (
                            <button
                              className="min-h-10 rounded-[3px] bg-cobalt px-3 text-xs font-[670] text-white hover:bg-[#365f96]"
                              type="button"
                              onClick={() => void prepareSuccessor(selected.id)}
                            >
                              Prepare change
                            </button>
                          ) : null}
                          {canInactivate && selected.lifecycleStatus === 'ACTIVE' ? (
                            <button
                              className="min-h-10 rounded-[3px] border border-[#9eb6d1] px-3 text-xs font-[670] text-cobalt hover:bg-pale-blue"
                              type="button"
                              onClick={() => openTransition('INACTIVE')}
                            >
                              Inactivate
                            </button>
                          ) : null}
                          {canActivate && selected.lifecycleStatus === 'INACTIVE' ? (
                            <button
                              className="min-h-10 rounded-[3px] border border-[#9eb6d1] px-3 text-xs font-[670] text-cobalt hover:bg-pale-blue"
                              type="button"
                              onClick={() => openTransition('ACTIVE')}
                            >
                              Reactivate
                            </button>
                          ) : null}
                          {canAbolish && selected.lifecycleStatus !== 'ABOLISHED' ? (
                            <button
                              className="min-h-10 rounded-[3px] border border-[#d6aeb0] px-3 text-xs font-[670] text-[#7a3036] hover:bg-[#fff7f7]"
                              type="button"
                              onClick={() => openTransition('ABOLISHED')}
                            >
                              Abolish
                            </button>
                          ) : null}
                          <button
                            className="min-h-10 rounded-[3px] border border-line px-3 text-xs font-[670] text-ink hover:bg-canvas"
                            type="button"
                            onClick={() => void loadHistory(selected.id)}
                          >
                            View history
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            )}
          </section>

          {history || historyLoading || historyError ? (
            <section
              className="min-w-0 overflow-hidden rounded-[5px] border border-line bg-paper"
              aria-labelledby="organization-unit-history-heading"
            >
              <header className="flex min-h-[60px] flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
                <div className="grid gap-1">
                  <h2
                    className="m-0 text-sm font-[670] text-midnight"
                    id="organization-unit-history-heading"
                  >
                    Organization Unit history
                  </h2>
                  <span className="text-xs text-muted">
                    Version and transition evidence as of {asOf}
                  </span>
                </div>
                {selected ? (
                  <button
                    className="min-h-9 rounded-[3px] border border-line px-3 text-xs font-[670] text-ink hover:bg-canvas"
                    type="button"
                    onClick={() => void loadHistory(selected.id)}
                  >
                    Refresh history
                  </button>
                ) : null}
              </header>
              {historyLoading ? (
                <p className="m-0 px-5 py-8 text-sm text-muted" role="status">
                  Loading history…
                </p>
              ) : historyError ? (
                <p className="m-0 px-5 py-8 text-sm text-[#7a3036]" role="alert">
                  {historyError}
                </p>
              ) : history ? (
                <div className="grid gap-6 p-5 sm:p-6">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="grid gap-1 rounded-[4px] border border-line bg-[#fafbfd] px-4 py-3">
                      <span className="text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
                        Effective on date
                      </span>
                      <strong className="text-sm font-[680] text-midnight">
                        {history.effective?.officialName ?? 'No published version'}
                      </strong>
                      <span className="text-xs text-muted">
                        {history.effective?.lifecycleStatus ?? '—'}
                      </span>
                    </div>
                    <div className="grid gap-1 rounded-[4px] border border-line bg-[#fafbfd] px-4 py-3">
                      <span className="text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
                        Current projection
                      </span>
                      <strong className="text-sm font-[680] text-midnight">
                        {history.current?.officialName ?? 'No current version'}
                      </strong>
                      <span className="text-xs text-muted">
                        {history.current?.lifecycleStatus ?? '—'}
                      </span>
                    </div>
                    <div className="grid gap-1 rounded-[4px] border border-[#9eb6d1] bg-pale-blue px-4 py-3">
                      <span className="text-[10px] font-bold tracking-[0.08em] text-cobalt uppercase">
                        Draft successor
                      </span>
                      <strong className="text-sm font-[680] text-midnight">
                        {history.draft?.officialName ?? 'None'}
                      </strong>
                      <span className="text-xs text-muted">
                        {history.draft
                          ? `Effective ${dateLabel(history.draft.effectiveFrom)}`
                          : 'No pending draft'}
                      </span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1000px] border-collapse text-left text-xs">
                      <thead className="bg-[#fafbfd] font-bold tracking-[0.08em] text-muted uppercase">
                        <tr>
                          <th className="border-b border-line px-4 py-3">Version</th>
                          <th className="border-b border-line px-4 py-3">Official name</th>
                          <th className="border-b border-line px-4 py-3">Parent</th>
                          <th className="border-b border-line px-4 py-3">Centers</th>
                          <th className="border-b border-line px-4 py-3">Period</th>
                          <th className="border-b border-line px-4 py-3">State</th>
                          <th className="border-b border-line px-4 py-3">Lifecycle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.versions.map((version) => (
                          <tr className="border-b border-line last:border-b-0" key={version.id}>
                            <td className="px-4 py-3 font-mono">v{version.versionNo}</td>
                            <th
                              className="px-4 py-3 text-left font-[650] text-midnight"
                              scope="row"
                            >
                              {version.officialName}
                            </th>
                            <td className="px-4 py-3 text-muted">
                              {version.parentUnitId
                                ? (parentNames.get(version.parentUnitId) ?? version.parentUnitId)
                                : 'Agency root'}
                            </td>
                            <td className="px-4 py-3 text-muted">
                              {version.costCenterCode ?? '—'} ·{' '}
                              {version.responsibilityCenterCode ?? '—'}
                            </td>
                            <td className="px-4 py-3 text-muted">
                              {dateLabel(version.effectiveFrom)} –{' '}
                              {version.effectiveTo ? dateLabel(version.effectiveTo) : 'Present'}
                            </td>
                            <td className="px-4 py-3">{version.versionState}</td>
                            <td className="px-4 py-3">{version.lifecycleStatus}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {history.transitions.length > 0 ? (
                    <div className="grid gap-3">
                      <h3 className="m-0 text-xs font-bold tracking-[0.08em] text-muted uppercase">
                        Transition evidence
                      </h3>
                      {history.transitions.map((transition) => (
                        <div
                          className="grid gap-1 border-l-2 border-[#9eb6d1] pl-3 text-xs"
                          key={transition.id}
                        >
                          <strong className="font-[680] text-midnight">
                            {transition.action.replaceAll('_', ' ')}
                          </strong>
                          <span className="text-muted">
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
                            <span className="text-muted">
                              Authority: {transition.authorityReference}
                            </span>
                          ) : null}
                          {transition.migrationPlan ? (
                            <span className="text-muted">
                              Migration plan: {transition.migrationPlan}
                            </span>
                          ) : null}
                          {transition.before || transition.after ? (
                            <span className="text-muted">
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
                </div>
              ) : null}
            </section>
          ) : null}

          <section
            className="min-w-0 overflow-hidden rounded-[5px] border border-line bg-paper"
            aria-labelledby="organization-unit-register-heading"
          >
            <header className="flex min-h-[60px] items-center justify-between gap-4 border-b border-line px-5">
              <div className="grid gap-1">
                <h2
                  className="m-0 text-sm font-[670] text-midnight"
                  id="organization-unit-register-heading"
                >
                  Organization Unit register
                </h2>
                <span className="text-xs text-muted">
                  All current lifecycle states in this Agency
                </span>
              </div>
              <span className="font-mono text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
                {registeredUnits.length} records
              </span>
            </header>
            {registeredUnits.length === 0 ? (
              <div className="px-5 py-8 text-sm text-muted">
                No activated Organization Units yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] border-collapse text-left">
                  <thead className="bg-[#fafbfd] text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
                    <tr>
                      <th className="border-b border-line px-5 py-3 font-bold">Official name</th>
                      <th className="border-b border-line px-5 py-3 font-bold">Code</th>
                      <th className="border-b border-line px-5 py-3 font-bold">Lifecycle</th>
                      <th className="border-b border-line px-5 py-3 font-bold">Effective</th>
                      <th className="border-b border-line px-5 py-3 text-right font-bold">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-[13px] text-ink">
                    {registeredUnits.map((unit) => (
                      <tr className="border-b border-line last:border-b-0" key={unit.id}>
                        <th className="px-5 py-4 text-left font-[650] text-midnight" scope="row">
                          {unit.officialName}
                        </th>
                        <td className="px-5 py-4 font-mono text-xs">{unit.code}</td>
                        <td className="px-5 py-4">
                          <span className="inline-flex rounded-full bg-[#e8f3ed] px-2 py-1 text-[10px] font-bold tracking-[0.06em] text-[#316647] uppercase">
                            {unit.status}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-muted">{dateLabel(unit.effectiveDate)}</td>
                        <td className="px-5 py-4 text-right">
                          <button
                            className="min-h-9 rounded-[3px] border border-line px-3 text-xs font-[670] text-ink hover:bg-canvas"
                            type="button"
                            onClick={() => setSelectedId(unit.id)}
                          >
                            Inspect record
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                  {draftCount === 1
                    ? '1 draft awaiting placement'
                    : `${draftCount} drafts awaiting placement`}
                </span>
              </div>
              <span className="rounded-full bg-[#fff3d6] px-2.5 py-1 text-[10px] font-bold tracking-[0.07em] text-[#79531c] uppercase">
                Preparation queue
              </span>
            </header>
            {draftCount === 0 ? (
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
                    {successorDrafts.map((draft) => (
                      <tr className="border-b border-line last:border-b-0" key={draft.id}>
                        <th className="px-5 py-4 text-left font-[650] text-midnight" scope="row">
                          {draft.officialName}
                        </th>
                        <td className="px-5 py-4 font-mono text-xs">{draft.code}</td>
                        <td className="px-5 py-4">{unitTypeLabel(draft.unitType)}</td>
                        <td className="px-5 py-4 text-muted">{dateLabel(draft.effectiveFrom)}</td>
                        <td className="px-5 py-4">
                          <span className="inline-flex rounded-full bg-[#fff3d6] px-2 py-1 text-[10px] font-bold tracking-[0.06em] text-[#79531c] uppercase">
                            DRAFT SUCCESSOR
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          {canUpdate || canActivate ? (
                            <button
                              className="min-h-9 rounded-[3px] border border-[#9eb6d1] px-3 text-xs font-[670] text-cobalt hover:bg-pale-blue"
                              type="button"
                              onClick={() => void prepareSuccessor(draft.organizationUnitId)}
                            >
                              Review successor
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
      <Dialog
        open={successorOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && successorSubmitting) return;
          setSuccessorOpen(nextOpen);
        }}
      >
        {successor && successorValues ? (
          <DialogContent
            aria-busy={successorSubmitting}
            onEscapeKeyDown={(event) => {
              if (successorSubmitting) event.preventDefault();
            }}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              successorNameRef.current?.focus();
            }}
          >
            <DialogHeader>
              <div className="grid min-w-0 gap-1.5">
                <p className="m-0 font-mono text-[10px] font-bold tracking-[0.1em] text-cobalt uppercase">
                  Organization change / Successor draft
                </p>
                <DialogTitle>Review Organization Unit successor</DialogTitle>
                <DialogDescription>
                  Edit the proposed values and effective date. The current version remains unchanged
                  until activation.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <button
                  className="min-h-9 min-w-9 shrink-0 rounded-[3px] text-xl text-muted hover:bg-canvas disabled:pointer-events-none disabled:opacity-50"
                  type="button"
                  aria-label="Close successor dialog"
                  disabled={successorSubmitting}
                >
                  ×
                </button>
              </DialogClose>
            </DialogHeader>

            <DialogBody>
              <form
                className="grid gap-5"
                id="organization-successor-form"
                onSubmit={submitSuccessor}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1 rounded-[4px] border border-line bg-[#fafbfd] px-4 py-3">
                    <span className="text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
                      Current version
                    </span>
                    <strong className="text-sm font-[680] text-midnight">
                      {successor.current.officialName}
                    </strong>
                    <span className="text-xs text-muted">
                      Effective {dateLabel(successor.current.effectiveFrom)} ·{' '}
                      {successor.current.lifecycleStatus}
                    </span>
                    <span className="text-xs text-muted">
                      Parent:{' '}
                      {successor.current.parentUnitId
                        ? (parentNames.get(successor.current.parentUnitId) ??
                          successor.current.parentUnitId)
                        : 'Agency root'}
                    </span>
                    <span className="text-xs text-muted">
                      Cost center: {successor.current.costCenterCode ?? '—'} · Responsibility:{' '}
                      {successor.current.responsibilityCenterCode ?? '—'}
                    </span>
                  </div>
                  <div className="grid gap-1 rounded-[4px] border border-[#9eb6d1] bg-pale-blue px-4 py-3">
                    <span className="text-[10px] font-bold tracking-[0.08em] text-cobalt uppercase">
                      Proposed successor
                    </span>
                    <strong className="text-sm font-[680] text-midnight">
                      {successorValues.officialName || 'Untitled Organization Unit'}
                    </strong>
                    <span className="text-xs text-muted">
                      Effective {dateLabel(successorValues.effectiveDate)} · successor draft
                    </span>
                    <span className="text-xs text-muted">
                      Parent:{' '}
                      {successorValues.parentUnitId
                        ? (parentNames.get(successorValues.parentUnitId) ??
                          successorValues.parentUnitId)
                        : 'Agency root'}
                    </span>
                    <span className="text-xs text-muted">
                      Cost center: {successorValues.costCenterCode || '—'} · Responsibility:{' '}
                      {successorValues.responsibilityCenterCode || '—'}
                    </span>
                  </div>
                </div>

                <div className="grid gap-2">
                  <label className="text-sm font-[650] text-ink" htmlFor="successor-official-name">
                    Proposed official name
                  </label>
                  <input
                    className="min-h-11 rounded-[3px] border border-line bg-paper px-3 text-sm text-ink disabled:bg-canvas"
                    id="successor-official-name"
                    ref={successorNameRef}
                    type="text"
                    value={successorValues.officialName}
                    disabled={!canUpdate || successorSubmitting}
                    aria-invalid={Boolean(successorFieldErrors.officialName)}
                    aria-describedby={
                      successorFieldErrors.officialName
                        ? 'successor-official-name-error'
                        : undefined
                    }
                    onChange={(event) => updateSuccessorValue('officialName', targetValue(event))}
                  />
                  {successorFieldErrors.officialName ? (
                    <span
                      className="text-xs text-[#7a3036]"
                      id="successor-official-name-error"
                      role="alert"
                    >
                      {successorFieldErrors.officialName}
                    </span>
                  ) : null}
                </div>

                <div className="grid gap-2">
                  <label className="text-sm font-[650] text-ink" htmlFor="successor-parent-unit">
                    Proposed parent Organization Unit
                  </label>
                  <select
                    className="min-h-11 rounded-[3px] border border-line bg-paper px-3 text-sm text-ink disabled:bg-canvas"
                    id="successor-parent-unit"
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
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <label className="text-sm font-[650] text-ink" htmlFor="successor-cost-center">
                      Cost center
                    </label>
                    <input
                      className="min-h-11 rounded-[3px] border border-line bg-paper px-3 text-sm text-ink disabled:bg-canvas"
                      id="successor-cost-center"
                      type="text"
                      value={successorValues.costCenterCode}
                      disabled={!canUpdate || successorSubmitting}
                      onChange={(event) =>
                        updateSuccessorValue('costCenterCode', targetValue(event))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <label
                      className="text-sm font-[650] text-ink"
                      htmlFor="successor-responsibility-center"
                    >
                      Responsibility center
                    </label>
                    <input
                      className="min-h-11 rounded-[3px] border border-line bg-paper px-3 text-sm text-ink disabled:bg-canvas"
                      id="successor-responsibility-center"
                      type="text"
                      value={successorValues.responsibilityCenterCode}
                      disabled={!canUpdate || successorSubmitting}
                      onChange={(event) =>
                        updateSuccessorValue('responsibilityCenterCode', targetValue(event))
                      }
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <label className="text-sm font-[650] text-ink" htmlFor="successor-effective-date">
                    Successor effective date
                  </label>
                  <input
                    className="min-h-11 rounded-[3px] border border-line bg-paper px-3 text-sm text-ink disabled:bg-canvas"
                    id="successor-effective-date"
                    ref={successorDateRef}
                    type="date"
                    value={successorValues.effectiveDate}
                    disabled={!canUpdate || successorSubmitting}
                    aria-invalid={Boolean(successorFieldErrors.effectiveDate)}
                    aria-describedby={
                      successorFieldErrors.effectiveDate
                        ? 'successor-effective-date-error'
                        : undefined
                    }
                    onChange={(event) => updateSuccessorValue('effectiveDate', targetValue(event))}
                  />
                  {successorFieldErrors.effectiveDate ? (
                    <span
                      className="text-xs text-[#7a3036]"
                      id="successor-effective-date-error"
                      role="alert"
                    >
                      {successorFieldErrors.effectiveDate}
                    </span>
                  ) : null}
                </div>

                {canActivate ? (
                  <>
                    <div className="grid gap-2">
                      <label className="text-sm font-[650] text-ink" htmlFor="successor-reason">
                        Change reason
                      </label>
                      <textarea
                        className="min-h-[88px] resize-y rounded-[3px] border border-line bg-paper px-3 py-2 text-sm text-ink"
                        id="successor-reason"
                        ref={successorReasonRef}
                        maxLength={500}
                        value={successorReason}
                        aria-invalid={Boolean(successorFieldErrors.reason)}
                        aria-describedby={
                          successorFieldErrors.reason ? 'successor-reason-error' : undefined
                        }
                        onChange={(event) => setSuccessorReason(targetValue(event))}
                      />
                      {successorFieldErrors.reason ? (
                        <span
                          className="text-xs text-[#7a3036]"
                          id="successor-reason-error"
                          role="alert"
                        >
                          {successorFieldErrors.reason}
                        </span>
                      ) : null}
                    </div>
                    <div className="grid gap-2">
                      <label className="text-sm font-[650] text-ink" htmlFor="successor-authority">
                        Authority reference{' '}
                        <span className="font-normal text-muted">(optional)</span>
                      </label>
                      <input
                        className="min-h-11 rounded-[3px] border border-line bg-paper px-3 text-sm text-ink"
                        id="successor-authority"
                        type="text"
                        value={successorAuthority}
                        disabled={successorSubmitting}
                        onChange={(event) => setSuccessorAuthority(targetValue(event))}
                      />
                    </div>
                    <div className="grid gap-2">
                      <label
                        className="text-sm font-[650] text-ink"
                        htmlFor="successor-migration-plan"
                      >
                        Migration plan <span className="font-normal text-muted">(optional)</span>
                      </label>
                      <textarea
                        className="min-h-[72px] resize-y rounded-[3px] border border-line bg-paper px-3 py-2 text-sm text-ink"
                        id="successor-migration-plan"
                        value={successorMigrationPlan}
                        disabled={successorSubmitting}
                        onChange={(event) => setSuccessorMigrationPlan(targetValue(event))}
                      />
                    </div>
                  </>
                ) : null}

                {successorError ? (
                  <p
                    className="m-0 rounded-[4px] border border-[#d6aeb0] bg-[#fff7f7] px-4 py-3 text-sm text-[#7a3036]"
                    role="alert"
                  >
                    {successorError}
                  </p>
                ) : null}
              </form>
            </DialogBody>

            <DialogFooter>
              <DialogClose asChild>
                <button
                  className="min-h-11 rounded-[3px] px-4 text-sm font-[650] text-muted hover:bg-canvas disabled:pointer-events-none disabled:opacity-50"
                  type="button"
                  disabled={successorSubmitting}
                >
                  Cancel
                </button>
              </DialogClose>
              {canUpdate ? (
                <button
                  className="min-h-11 rounded-[3px] border border-[#9eb6d1] px-4 text-sm font-[650] text-cobalt hover:bg-pale-blue disabled:pointer-events-none disabled:opacity-50"
                  type="button"
                  disabled={successorSubmitting}
                  onClick={() => void submitSavedSuccessor()}
                >
                  {successorSubmitting ? 'Saving…' : 'Save Draft'}
                </button>
              ) : null}
              {canActivate ? (
                <button
                  className="min-h-11 rounded-[3px] bg-cobalt px-4 text-sm font-[650] text-white hover:bg-[#365f96] disabled:pointer-events-none disabled:opacity-50"
                  type="submit"
                  form="organization-successor-form"
                  disabled={successorSubmitting}
                >
                  {successorSubmitting ? 'Activating…' : 'Activate successor'}
                </button>
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
                <p className="m-0 font-mono text-[10px] font-bold tracking-[0.1em] text-cobalt uppercase">
                  Organization lifecycle / {transitionTarget}
                </p>
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
              <DialogClose asChild>
                <button
                  className="min-h-9 min-w-9 shrink-0 rounded-[3px] text-xl text-muted hover:bg-canvas disabled:pointer-events-none disabled:opacity-50"
                  type="button"
                  aria-label="Close lifecycle dialog"
                  disabled={transitionSubmitting}
                >
                  ×
                </button>
              </DialogClose>
            </DialogHeader>
            <DialogBody>
              <form
                className="grid gap-5"
                id="organization-transition-form"
                onSubmit={submitTransition}
              >
                <div className="grid gap-1 rounded-[4px] border border-line bg-[#fafbfd] px-4 py-3 text-xs text-muted">
                  <strong className="text-sm font-[680] text-midnight">
                    {transitionUnit.officialName}
                  </strong>
                  <span>
                    {transitionUnit.code} · current lifecycle {transitionUnit.lifecycleStatus}
                  </span>
                </div>
                <div className="grid gap-2">
                  <label
                    className="text-sm font-[650] text-ink"
                    htmlFor="transition-effective-date"
                  >
                    Effective date
                  </label>
                  <input
                    className="min-h-11 rounded-[3px] border border-line bg-paper px-3 text-sm text-ink"
                    id="transition-effective-date"
                    ref={transitionDateRef}
                    type="date"
                    value={transitionDate}
                    aria-invalid={Boolean(transitionFieldErrors.effectiveDate)}
                    aria-describedby={
                      transitionFieldErrors.effectiveDate
                        ? 'transition-effective-date-error'
                        : undefined
                    }
                    onChange={(event) => setTransitionDate(targetValue(event))}
                  />
                  {transitionFieldErrors.effectiveDate ? (
                    <span
                      className="text-xs text-[#7a3036]"
                      id="transition-effective-date-error"
                      role="alert"
                    >
                      {transitionFieldErrors.effectiveDate}
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-[650] text-ink" htmlFor="transition-reason">
                    Reason
                  </label>
                  <textarea
                    className="min-h-[88px] resize-y rounded-[3px] border border-line bg-paper px-3 py-2 text-sm text-ink"
                    id="transition-reason"
                    ref={transitionReasonRef}
                    maxLength={500}
                    value={transitionReason}
                    aria-invalid={Boolean(transitionFieldErrors.reason)}
                    aria-describedby={
                      transitionFieldErrors.reason ? 'transition-reason-error' : undefined
                    }
                    onChange={(event) => setTransitionReason(targetValue(event))}
                  />
                  {transitionFieldErrors.reason ? (
                    <span
                      className="text-xs text-[#7a3036]"
                      id="transition-reason-error"
                      role="alert"
                    >
                      {transitionFieldErrors.reason}
                    </span>
                  ) : null}
                </div>
                {transitionTarget !== 'INACTIVE' ? (
                  <div className="grid gap-2">
                    <label className="text-sm font-[650] text-ink" htmlFor="transition-authority">
                      Authority reference
                    </label>
                    <input
                      className="min-h-11 rounded-[3px] border border-line bg-paper px-3 text-sm text-ink"
                      id="transition-authority"
                      type="text"
                      value={transitionAuthority}
                      aria-invalid={Boolean(transitionFieldErrors.authorityReference)}
                      aria-describedby={
                        transitionFieldErrors.authorityReference
                          ? 'transition-authority-error'
                          : undefined
                      }
                      onChange={(event) => setTransitionAuthority(targetValue(event))}
                    />
                    {transitionFieldErrors.authorityReference ? (
                      <span
                        className="text-xs text-[#7a3036]"
                        id="transition-authority-error"
                        role="alert"
                      >
                        {transitionFieldErrors.authorityReference}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {transitionTarget !== 'ACTIVE' ? (
                  <div className="grid gap-2">
                    <label
                      className="text-sm font-[650] text-ink"
                      htmlFor="transition-migration-plan"
                    >
                      Migration plan{' '}
                      <span className="font-normal text-muted">
                        (required when dependencies remain)
                      </span>
                    </label>
                    <textarea
                      className="min-h-[88px] resize-y rounded-[3px] border border-line bg-paper px-3 py-2 text-sm text-ink"
                      id="transition-migration-plan"
                      value={transitionMigrationPlan}
                      onChange={(event) => setTransitionMigrationPlan(targetValue(event))}
                    />
                  </div>
                ) : null}
                {transitionError ? (
                  <p
                    className="m-0 rounded-[4px] border border-[#d6aeb0] bg-[#fff7f7] px-4 py-3 text-sm text-[#7a3036]"
                    role="alert"
                  >
                    {transitionError}
                  </p>
                ) : null}
              </form>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <button
                  className="min-h-11 rounded-[3px] px-4 text-sm font-[650] text-muted hover:bg-canvas disabled:pointer-events-none disabled:opacity-50"
                  type="button"
                  disabled={transitionSubmitting}
                >
                  Cancel
                </button>
              </DialogClose>
              <button
                className="min-h-11 rounded-[3px] bg-cobalt px-4 text-sm font-[650] text-white hover:bg-[#365f96] disabled:pointer-events-none disabled:opacity-50"
                type="submit"
                form="organization-transition-form"
                disabled={transitionSubmitting}
              >
                {transitionSubmitting ? 'Saving…' : `Record ${transitionTarget.toLowerCase()}`}
              </button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
