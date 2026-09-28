'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { cn } from '../lib/class-names';
import { manilaToday } from '../lib/manila-date';
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
import { PageHeader, type Breadcrumb } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag, type StatusTone } from './ui/status-tag';
import { RowHeader, Table, Td, Th, Tr } from './ui/table';

const ACTION_TYPES = [
  'REASSIGNMENT',
  'DETAIL',
  'DESIGNATION',
  'SECONDMENT',
  'SAME_ITEM_REINSTATEMENT',
  'SEPARATION_RESIGNATION',
  'SEPARATION_DISMISSAL',
  'SEPARATION_DROPPING_FROM_ROLLS',
  'SEPARATION_EXPIRATION',
  'SEPARATION_TERMINATION',
  'SEPARATION_RETIREMENT',
  'SEPARATION_DEATH',
  'SALARY_ADJUSTMENT',
  'STEP_INCREMENT',
  'PROMOTION',
  'TRANSFER',
  'DEMOTION',
  'RECLASSIFICATION',
  'COMPARABLE_REINSTATEMENT',
] as const;

type ActionType = (typeof ACTION_TYPES)[number];

const MOVEMENT_ACTION_TYPES = [
  'PROMOTION',
  'TRANSFER',
  'DEMOTION',
  'RECLASSIFICATION',
  'COMPARABLE_REINSTATEMENT',
] as const;

function isMovementAction(actionType: ActionType): boolean {
  return (MOVEMENT_ACTION_TYPES as readonly ActionType[]).includes(actionType);
}
type ActionStatus =
  | 'DRAFT'
  | 'FOR_REVIEW'
  | 'FOR_APPROVAL'
  | 'APPROVED'
  | 'EFFECTIVE'
  | 'RETURNED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'SUPERSEDED';

interface PersonnelAction {
  id: string;
  actionType: ActionType;
  status: ActionStatus;
  effectuationAvailable: boolean;
  employee: { id: string; employeeNumber: string; legalName: string; serviceStatus: string };
  currentVersion: {
    id: string;
    versionNo: number;
    proposedEffectivity: string;
    fromServiceSegment: {
      id: string;
      organizationUnitId: string;
      appointmentStatus: string;
      salaryGrade: number | null;
      salaryStep: number | null;
    };
    targetFacts: Record<string, unknown>;
    targetPositionId: string | null;
    targetOrganizationUnitId: string | null;
    reason: string;
    evidence: Array<{
      id: string;
      evidenceType: string;
      sourceDate: string;
      document: {
        id: string;
        documentNo: string | null;
        documentType: string;
        status: string;
        versionId: string;
        versionNo: number;
      };
    }>;
    createdAt: string;
  };
  preparedBy: { id: string; displayName: string };
  approvedBy: { id: string; displayName: string } | null;
  approvalDelegationId: string | null;
  approvedAt: string | null;
  effectuatedAt: string | null;
  effect: {
    serviceSegmentId: string;
    salaryGrade: number | null;
    salaryStep: number | null;
  } | null;
  supersedesActionId: string | null;
  rowVersion: number;
}

export interface PersonnelActionListResponse {
  actions: PersonnelAction[];
  nextCursor: string | null;
}

interface EmployeeOption {
  id: string;
  employeeNumber: string;
  legalName: string;
  serviceStatus: string;
}

interface DocumentOption {
  id: string;
  documentNo: string | null;
  documentType: string;
  status: string;
  currentVersion: { id: string; versionNo: number; issuedAt: string | null } | null;
}

interface UnitOption {
  id: string;
  code: string;
  officialName: string;
  lifecycleStatus: string;
}

interface PositionOption {
  id: string;
  itemNumber: string;
  status: string;
  currentVersion: { title: string } | null;
}

interface AppointmentCandidate {
  appointmentId: string;
  appointmentVersionId: string;
  applicationNo: string;
  appointee: { personKey: string; fullName: string };
  natureOfAppointment: string;
  employmentStatus: string;
  effectivityDate: string;
  issuedAt: string | null;
  actualAssumptionDate: string;
  position: {
    id: string;
    itemNumber: string;
    title: string | null;
    salaryGrade: number | null;
    organizationUnitId: string | null;
  };
  compensation: { salaryGrade: number; salaryStep: number };
}

type FieldKind =
  'text' | 'date' | 'number' | 'boolean' | 'select' | 'unit' | 'position' | 'appointment';
interface FieldSpec {
  name: string;
  label: string;
  kind: FieldKind;
  options?: readonly string[];
  nullable?: boolean;
}
interface Contract {
  label: string;
  fields: readonly FieldSpec[];
  evidence: readonly string[];
}

const CONTRACTS: Record<ActionType, Contract> = {
  REASSIGNMENT: {
    label: 'Reassignment',
    fields: [
      { name: 'organizationUnitId', label: 'Receiving Organization Unit', kind: 'unit' },
      { name: 'receivingDuties', label: 'Receiving duties', kind: 'text' },
      { name: 'stationSpecific', label: 'Appointment is station-specific', kind: 'boolean' },
      { name: 'endDate', label: 'End date, if temporary', kind: 'date', nullable: true },
      {
        name: 'appealState',
        label: 'Appeal state',
        kind: 'select',
        options: ['NONE', 'PENDING', 'STAYED', 'RESOLVED'],
      },
    ],
    evidence: [
      'OFFICE_ORDER',
      'AUTHORITY',
      'CURRENT_APPOINTMENT_STATION',
      'RECEIVING_DUTIES',
      'APPEAL_STATE',
    ],
  },
  DETAIL: {
    label: 'Detail',
    fields: [
      { name: 'recipientAgencyName', label: 'Recipient Agency', kind: 'text' },
      { name: 'receivingDuties', label: 'Receiving duties', kind: 'text' },
      { name: 'consented', label: 'Employee consent recorded', kind: 'boolean' },
      { name: 'endDate', label: 'End date', kind: 'date' },
      { name: 'noDiminutionConfirmed', label: 'No diminution confirmed', kind: 'boolean' },
    ],
    evidence: ['DETAIL_ORDER', 'INTER_AGENCY_AGREEMENT', 'AUTHORITY', 'LEAVE_CERTIFICATION'],
  },
  DESIGNATION: {
    label: 'Designation',
    fields: [
      { name: 'targetPositionId', label: 'Target Plantilla Position', kind: 'position' },
      {
        name: 'basis',
        label: 'Basis',
        kind: 'select',
        options: ['ABSENT_INCUMBENT', 'VACANCY_OR_EXIGENCY'],
      },
      { name: 'endDate', label: 'End date', kind: 'date' },
      { name: 'renewalCount', label: 'Renewal count', kind: 'number' },
    ],
    evidence: ['OFFICE_ORDER', 'AUTHORITY', 'PERMANENT_APPOINTMENT', 'QUALIFICATION'],
  },
  SECONDMENT: {
    label: 'Secondment',
    fields: [
      { name: 'recipientOrganization', label: 'Recipient organization', kind: 'text' },
      { name: 'consented', label: 'Employee consent recorded', kind: 'boolean' },
      { name: 'endDate', label: 'End date', kind: 'date' },
      { name: 'compensationTerms', label: 'Compensation terms', kind: 'text' },
      {
        name: 'cscSubmissionState',
        label: 'CSC submission state',
        kind: 'select',
        options: ['PENDING', 'SUBMITTED', 'ACCEPTED'],
      },
    ],
    evidence: [
      'SIGNED_MOA',
      'AUTHORITY',
      'ELIGIBILITY',
      'PERFORMANCE_RATING',
      'EXPERIENCE',
      'CSC_SUBMISSION',
    ],
  },
  SAME_ITEM_REINSTATEMENT: {
    label: 'Same-item reinstatement',
    fields: [
      { name: 'originalPositionId', label: 'Original Plantilla Position', kind: 'position' },
      { name: 'backPayDetermination', label: 'Back-pay determination', kind: 'text' },
    ],
    evidence: [
      'EXECUTORY_DECISION',
      'PRIOR_SEPARATION',
      'NO_MISCONDUCT',
      'ORIGINAL_ITEM',
      'BACK_PAY_DETERMINATION',
    ],
  },
  SEPARATION_RESIGNATION: {
    label: 'Separation: resignation',
    fields: [
      { name: 'acceptanceDate', label: 'Acceptance date', kind: 'date' },
      { name: 'noticeDate', label: 'Notice date', kind: 'date' },
      {
        name: 'withdrawalState',
        label: 'Withdrawal state',
        kind: 'select',
        options: ['NONE', 'PENDING', 'DENIED'],
      },
      {
        name: 'mutuallyAgreedEarlier',
        label: 'Earlier date mutually agreed in writing',
        kind: 'boolean',
      },
    ],
    evidence: ['WRITTEN_RESIGNATION', 'ACCEPTANCE', 'NOTICE', 'WITHDRAWAL_STATE'],
  },
  SEPARATION_DISMISSAL: {
    label: 'Separation: dismissal',
    fields: [
      { name: 'decisionFinalityDate', label: 'Decision finality date', kind: 'date' },
      { name: 'appealState', label: 'Appeal state', kind: 'select', options: ['NONE', 'FINAL'] },
    ],
    evidence: ['EXECUTORY_DECISION', 'CSC_SUBMISSION', 'APPEAL_STATE'],
  },
  SEPARATION_DROPPING_FROM_ROLLS: {
    label: 'Separation: dropping from the rolls',
    fields: [{ name: 'orderDate', label: 'Order date', kind: 'date' }],
    evidence: ['DROPPING_ORDER', 'ABSENCE_RECORD', 'NOTICE', 'DUE_PROCESS'],
  },
  SEPARATION_EXPIRATION: {
    label: 'Separation: appointment expiration',
    fields: [{ name: 'appointmentEndDate', label: 'Appointment end date', kind: 'date' }],
    evidence: ['APPOINTMENT_TERM', 'CSC_SUBMISSION'],
  },
  SEPARATION_TERMINATION: {
    label: 'Separation: termination',
    fields: [{ name: 'terminationOrderDate', label: 'Termination order date', kind: 'date' }],
    evidence: ['APPOINTMENT_TERM', 'TERMINATION_ORDER', 'CSC_SUBMISSION'],
  },
  SEPARATION_RETIREMENT: {
    label: 'Separation: retirement',
    fields: [
      { name: 'gsisCoverageVerified', label: 'GSIS coverage verified', kind: 'boolean' },
      { name: 'eligibilityVerified', label: 'Retirement eligibility verified', kind: 'boolean' },
    ],
    evidence: ['GSIS_COVERAGE', 'ELIGIBILITY', 'RETIREMENT_NOTICE'],
  },
  SEPARATION_DEATH: {
    label: 'Separation: death',
    fields: [{ name: 'dateOfDeath', label: 'Documented date of death', kind: 'date' }],
    evidence: ['DEATH_CERTIFICATE', 'CSC_SUBMISSION'],
  },
  SALARY_ADJUSTMENT: {
    label: 'Salary adjustment',
    fields: [
      { name: 'newSalaryGrade', label: 'New salary grade', kind: 'number' },
      { name: 'newSalaryStep', label: 'New salary step', kind: 'number' },
      { name: 'payTableVersion', label: 'Pay table version', kind: 'text' },
    ],
    evidence: [
      'PAY_AUTHORITY',
      'SALARY_ADJUSTMENT_NOTICE',
      'CURRENT_COMPENSATION',
      'PAY_TABLE_VERSION',
    ],
  },
  STEP_INCREMENT: {
    label: 'Step increment',
    fields: [{ name: 'newSalaryStep', label: 'New salary step', kind: 'number' }],
    evidence: ['NOSI', 'CURRENT_COMPENSATION', 'PERFORMANCE_OR_SERVICE', 'SERVICE_CONTINUITY'],
  },
  PROMOTION: {
    label: 'Promotion',
    fields: [
      {
        name: 'appointmentVersionId',
        label: 'Assumed Appointment',
        kind: 'appointment',
        options: ['PROMOTION'],
      },
    ],
    evidence: ['AUTHORITY'],
  },
  TRANSFER: {
    label: 'Transfer',
    fields: [
      {
        name: 'appointmentVersionId',
        label: 'Assumed Appointment',
        kind: 'appointment',
        options: ['TRANSFER'],
      },
    ],
    evidence: ['AUTHORITY'],
  },
  DEMOTION: {
    label: 'Demotion',
    fields: [
      {
        name: 'appointmentVersionId',
        label: 'Assumed Appointment',
        kind: 'appointment',
        options: ['DEMOTION'],
      },
    ],
    evidence: ['AUTHORITY'],
  },
  RECLASSIFICATION: {
    label: 'Reclassification',
    fields: [
      {
        name: 'appointmentVersionId',
        label: 'Assumed Appointment',
        kind: 'appointment',
        options: ['RECLASSIFICATION'],
      },
    ],
    evidence: ['AUTHORITY'],
  },
  COMPARABLE_REINSTATEMENT: {
    label: 'Comparable reinstatement',
    fields: [
      {
        name: 'appointmentVersionId',
        label: 'Assumed Appointment',
        kind: 'appointment',
        options: ['REINSTATEMENT'],
      },
    ],
    evidence: ['EXECUTORY_DECISION', 'PRIOR_SEPARATION', 'NO_MISCONDUCT', 'AUTHORITY'],
  },
};

function dateLabel(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' });
}

function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error) return value.message;
  if (typeof value !== 'object' || value === null) return fallback;
  const error = (value as { error?: { message?: unknown } }).error;
  return typeof error?.message === 'string' ? error.message : fallback;
}

const STATUS_TONE: Record<ActionStatus, StatusTone> = {
  DRAFT: 'warning',
  FOR_REVIEW: 'warning',
  RETURNED: 'warning',
  FOR_APPROVAL: 'info',
  APPROVED: 'success',
  EFFECTIVE: 'success',
  REJECTED: 'neutral',
  CANCELLED: 'neutral',
  SUPERSEDED: 'neutral',
};

function ActionStatusTag({ status }: { status: ActionStatus }) {
  return <StatusTag tone={STATUS_TONE[status]}>{status.replaceAll('_', ' ')}</StatusTag>;
}

function targetValues(action?: PersonnelAction): Record<string, string> {
  if (!action) return {};
  return Object.fromEntries(
    Object.entries(action.currentVersion.targetFacts).map(([key, value]) => [
      key,
      value === null ? '' : String(value),
    ]),
  );
}

function evidenceValues(
  action?: PersonnelAction,
): Record<string, { documentId: string; sourceDate: string }> {
  if (!action) return {};
  return Object.fromEntries(
    action.currentVersion.evidence.map((item) => [
      item.evidenceType,
      { documentId: item.document.id, sourceDate: item.sourceDate },
    ]),
  );
}

export function PersonnelActionWorkspace({
  agencyId,
  membershipId,
  initial,
  canPrepare,
  canSubmit,
  canReturn,
  canEndorse,
  canEffectuate,
  canApprove,
  canReject,
  canCancel,
  canCancelApproved,
  canCorrect,
  canAudit,
  canLinkAppointments,
}: {
  agencyId: string;
  membershipId: string;
  initial: PersonnelActionListResponse;
  canPrepare: boolean;
  canSubmit: boolean;
  canReturn: boolean;
  canEndorse: boolean;
  canEffectuate: boolean;
  canApprove: boolean;
  canReject: boolean;
  canCancel: boolean;
  canCancelApproved: boolean;
  canCorrect: boolean;
  canAudit: boolean;
  canLinkAppointments: boolean;
}) {
  const [actions, setActions] = useState(initial.actions);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const navigation = useRecordNavigation();
  const recordId = navigation.search.get('record');
  const historyView = navigation.search.get('section') === 'history';

  useEffect(() => {
    let active = true;
    setSelectedId(null);
    setAuthority({ canApprove: false, canReject: false, canCancelApproved: false });
    setError('');
    if (!recordId) {
      setDialog(null);
      return;
    }
    setDialog(null);
    void (async () => {
      const next = (await request(
        agencyId,
        `/personnel-actions/${encodeURIComponent(recordId)}`,
      )) as PersonnelAction;
      if (!active) return;
      setActions((current) => [next, ...current.filter((item) => item.id !== next.id)]);
      setSelectedId(next.id);
      if (historyView) {
        if (!canAudit) throw new Error('History is outside your permitted scope.');
        const historyValue = (await request(
          agencyId,
          `/personnel-actions/${encodeURIComponent(recordId)}/history`,
        )) as { entries: typeof history };
        if (!active) return;
        setHistory(historyValue.entries);
        setDialog('history');
      } else setDialog('detail');
      const decision = (await request(
        agencyId,
        `/personnel-actions/${recordId}/authority`,
      )) as typeof authority;
      if (active) setAuthority(decision);
    })().catch((cause: unknown) => {
      if (active) setError(errorMessage(cause, 'This record is unavailable.'));
    });
    return () => {
      active = false;
    };
  }, [recordId, historyView, canAudit]);

  const [dialog, setDialog] = useState<'prepare' | 'detail' | 'transition' | 'history' | null>(
    null,
  );
  const [mode, setMode] = useState<'create' | 'edit' | 'replace'>('create');
  const [actionType, setActionType] = useState<ActionType>('STEP_INCREMENT');
  const [employeeId, setEmployeeId] = useState('');
  const [effectivity, setEffectivity] = useState(manilaToday());
  const [reason, setReason] = useState('');
  const [facts, setFacts] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState<
    Record<string, { documentId: string; sourceDate: string }>
  >({});
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [documents, setDocuments] = useState<DocumentOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [positions, setPositions] = useState<PositionOption[]>([]);
  const [appointmentCandidates, setAppointmentCandidates] = useState<AppointmentCandidate[]>([]);
  const [transition, setTransition] = useState<
    'RETURN' | 'ENDORSE' | 'APPROVE' | 'REJECT' | 'CANCEL' | 'EFFECTUATE'
  >('RETURN');
  const [transitionReason, setTransitionReason] = useState('');
  const [history, setHistory] = useState<
    Array<{
      id: string;
      action: string;
      previousStatus: string | null;
      newStatus: string | null;
      reason: string | null;
      actor: { displayName: string | null };
      occurredAt: string;
    }>
  >([]);
  const [authority, setAuthority] = useState({
    canApprove: false,
    canReject: false,
    canCancelApproved: false,
  });
  const [referenceLoading, setReferenceLoading] = useState(canPrepare || canCorrect);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const returnFocusRef = useRef<(() => void) | null>(null);
  const employeeRef = useRef<{ focus(): void } | null>(null);
  const selected =
    actions.find(({ id }) => id === selectedId && (!recordId || id === recordId)) ?? null;

  useEffect(() => {
    if (!canPrepare && !canCorrect) return;
    let active = true;
    setReferenceLoading(true);
    Promise.all([
      request(agencyId, '/employees'),
      request(agencyId, '/documents'),
      request(agencyId, '/organization-units'),
      request(agencyId, '/plantilla-positions'),
      canLinkAppointments
        ? request(agencyId, '/appointments/movement-candidates')
        : Promise.resolve({ candidates: [] }),
    ])
      .then(([employeeValue, documentValue, unitValue, positionValue, appointmentValue]) => {
        if (!active) return;
        setEmployees((employeeValue as { employees: EmployeeOption[] }).employees);
        setDocuments((documentValue as { documents: DocumentOption[] }).documents);
        setUnits((unitValue as { units: UnitOption[] }).units);
        setPositions((positionValue as { positions: PositionOption[] }).positions);
        setAppointmentCandidates(
          (appointmentValue as { candidates: AppointmentCandidate[] }).candidates,
        );
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause, 'Reference values could not be loaded.'));
      })
      .finally(() => {
        if (active) setReferenceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agencyId, canCorrect, canPrepare, canLinkAppointments]);

  function replaceAction(next: PersonnelAction): void {
    setActions((current) => {
      const found = current.some(({ id }) => id === next.id);
      return found
        ? current.map((item) => (item.id === next.id ? next : item))
        : [next, ...current];
    });
    setSelectedId(next.id);
    navigation.navigate({ record: next.id, view: 'form', section: null });
  }

  function openPrepare(nextMode: typeof mode, action?: PersonnelAction, restoreFocus?: () => void) {
    if (restoreFocus) returnFocusRef.current = restoreFocus;
    setMode(nextMode);
    setSelectedId(action?.id ?? null);
    setActionType(action?.actionType ?? 'STEP_INCREMENT');
    setEmployeeId(action?.employee.id ?? '');
    setEffectivity(action?.currentVersion.proposedEffectivity ?? manilaToday());
    setReason(action?.currentVersion.reason ?? '');
    setFacts(targetValues(action));
    setEvidence(evidenceValues(action));
    setError('');
    setDialog('prepare');
  }

  function openTransition(kind: typeof transition): void {
    setTransition(kind);
    setTransitionReason('');
    setError('');
    setDialog('transition');
  }

  function openDetail(record: PersonnelAction): void {
    navigation.navigate({ record: record.id, view: 'form', section: null });
  }

  function targetPayload(): Record<string, unknown> {
    return Object.fromEntries(
      CONTRACTS[actionType].fields.map((field) => {
        const value = facts[field.name] ?? '';
        if (field.kind === 'number') return [field.name, Number(value)];
        if (field.kind === 'boolean') return [field.name, value === 'true'];
        return [field.name, field.nullable && !value ? null : value];
      }),
    );
  }

  function evidencePayload() {
    return evidenceRows(actionType)
      .map(({ type }) => {
        const value = evidence[type];
        const document = documents.find(({ id }) => id === value?.documentId);
        if (!value?.documentId || !document?.currentVersion) return null;
        return {
          evidenceType: type,
          documentId: document.id,
          documentVersionId: document.currentVersion.id,
          sourceDate: value.sourceDate,
        };
      })
      .filter((item) => item !== null);
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const payload = {
        employeeId,
        actionType,
        proposedEffectivity: effectivity,
        targetFacts: targetPayload(),
        reason,
        evidence: evidencePayload(),
        ...(mode === 'edit' && selected ? { rowVersion: selected.rowVersion } : {}),
      };
      const path =
        mode === 'create'
          ? '/personnel-actions'
          : `/personnel-actions/${selected?.id}${mode === 'replace' ? '/replace' : ''}`;
      const next = (await request(agencyId, path, {
        method: mode === 'edit' ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })) as PersonnelAction;
      replaceAction(next);
      setDialog('detail');
      setSuccess(
        mode === 'replace'
          ? 'Replacement prepared as a new Draft.'
          : 'Personnel Action draft saved.',
      );
    } catch (cause: unknown) {
      setError(errorMessage(cause, 'The Personnel Action could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  async function run(path: string, body: unknown, message: string): Promise<void> {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = (await request(agencyId, `/personnel-actions/${selected.id}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(path === '/effectuate' ? { 'idempotency-key': `web-${selected.id}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })) as PersonnelAction;
      replaceAction(next);
      setDialog('detail');
      setSuccess(message);
    } catch (cause: unknown) {
      setError(errorMessage(cause, 'The Personnel Action transition failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function submit(): Promise<void> {
    await run('/submit', undefined, 'Personnel Action submitted for review.');
  }

  async function recordTransition(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (transition === 'EFFECTUATE') {
      await run('/effectuate', undefined, 'Personnel Action effectuated.');
      return;
    }
    if (transition === 'RETURN' || transition === 'ENDORSE') {
      await run(
        '/review',
        { decision: transition, reason: transitionReason },
        'Review decision recorded.',
      );
      return;
    }
    if (transition === 'APPROVE' || transition === 'REJECT') {
      await run(
        '/decision',
        { decision: transition, reason: transitionReason },
        'Authority decision recorded.',
      );
      return;
    }
    await run('/cancel', { reason: transitionReason }, 'Personnel Action cancelled.');
  }

  async function openHistory(): Promise<void> {
    if (selected) navigation.navigate({ record: selected.id, view: 'form', section: 'history' });
  }

  async function loadMore(): Promise<void> {
    if (!nextCursor) return;
    setBusy(true);
    setError('');
    try {
      const page = (await request(
        agencyId,
        `/personnel-actions?cursor=${encodeURIComponent(nextCursor)}`,
      )) as PersonnelActionListResponse;
      setActions((current) => [
        ...current,
        ...page.actions.filter((action) => !current.some(({ id }) => id === action.id)),
      ]);
      setNextCursor(page.nextCursor);
    } catch (cause: unknown) {
      setError(errorMessage(cause, 'More Personnel Actions could not be loaded.'));
    } finally {
      setBusy(false);
    }
  }

  const preparedByMe = selected?.preparedBy.id === membershipId;
  const stage = selected
    ? selected.status === 'DRAFT' || selected.status === 'RETURNED'
      ? 0
      : selected.status === 'FOR_REVIEW'
        ? 1
        : selected.status === 'FOR_APPROVAL'
          ? 2
          : 3
    : 0;

  const inline = Boolean(recordId) || dialog === 'prepare';
  const breadcrumbs: Breadcrumb[] = [{ label: 'Personnel' }];
  if (recordId) {
    breadcrumbs.push(
      {
        label: 'Personnel Actions',
        href: navigation.href({ record: null, view: null, section: null }),
      },
      { label: selected?.employee.legalName ?? 'Personnel Action' },
    );
  } else if (dialog === 'prepare') {
    // Preparing a new action leaves the URL alone, so there is no register link to follow.
    breadcrumbs.push({ label: 'Personnel Actions' }, { label: 'Prepare' });
  }

  return (
    <div className="grid min-w-0 gap-5">
      <PageHeader
        breadcrumbs={breadcrumbs}
        title="Personnel Actions"
        actions={
          canPrepare ? (
            <Button
              disabled={referenceLoading}
              // Hidden rather than unmounted, so focus can return here when the form closes.
              hidden={inline}
              onClick={(event) => {
                const trigger = event.currentTarget as unknown as { focus(): void };
                openPrepare('create', undefined, () => trigger.focus());
              }}
              type="button"
              variant="primary"
            >
              {referenceLoading ? 'Loading references…' : 'Prepare action'}
            </Button>
          ) : null
        }
      />

      {recordId && dialog === null ? (
        error ? (
          <StateSurface label="Personnel Action unavailable">
            <StateCode>Unavailable</StateCode>
            <p className="m-0 max-w-[500px] text-body text-ink" role="alert">
              {error}
            </p>
          </StateSurface>
        ) : !selected ? (
          <StateSurface busy label="Loading the Personnel Action">
            <StateCode>Loading</StateCode>
            <p className="m-0 text-body text-ink-muted">Loading the Personnel Action…</p>
          </StateSurface>
        ) : null
      ) : null}

      <div hidden={inline} className="grid gap-5">
        <p className="m-0 max-w-[80ch] text-small text-ink-muted">
          Prepare evidence-backed actions, resolve deficiencies, and record the applicable
          authority’s decision. Each action moves through preparation, review, and the authority’s
          decision; service facts change only at effectuation.
        </p>
        {dialog === null ? <FormError message={error} /> : null}
        {success ? (
          <p
            className="m-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-success"
            role="status"
          >
            {success}
          </p>
        ) : null}

        <Panel title="Personnel Action register" flush>
          {actions.length === 0 ? (
            <StateSurface compact label="Personnel Action register">
              <strong className="text-body font-[650] text-ink">No Personnel Actions yet.</strong>
              <p className="m-0 max-w-[560px]">
                Start when the Employee has a current Service Segment and the exact authority and
                supporting evidence are available.
              </p>
            </StateSurface>
          ) : (
            <Table className="min-w-[760px]">
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Action</Th>
                  <Th kind="date">Effectivity</Th>
                  <Th>State</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {actions.map((action) => (
                  <Tr key={action.id}>
                    <RowHeader>
                      {action.employee.legalName}
                      <span className="block text-caption font-normal text-ink-muted">
                        {action.employee.employeeNumber}
                      </span>
                    </RowHeader>
                    <Td>
                      {CONTRACTS[action.actionType].label}
                      <span className="block text-caption text-ink-muted">
                        Version {action.currentVersion.versionNo}
                      </span>
                    </Td>
                    <Td kind="date">{dateLabel(action.currentVersion.proposedEffectivity)}</Td>
                    <Td>
                      <ActionStatusTag status={action.status} />
                    </Td>
                    <Td className="text-right">
                      <Button
                        aria-label={`Open action for ${action.employee.legalName}`}
                        onClick={() => openDetail(action)}
                        type="button"
                        variant="secondary"
                      >
                        Open
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          {nextCursor ? (
            <div className="flex justify-center px-4 py-2.5">
              <Button
                disabled={busy}
                onClick={() => void loadMore()}
                type="button"
                variant="secondary"
              >
                {busy ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          ) : null}
        </Panel>
      </div>

      <Dialog
        presentation={
          dialog === 'detail' || dialog === 'prepare' || dialog === 'history' ? 'form' : 'dialog'
        }
        onOpenChange={(open) => {
          if (!open && !busy) {
            navigation.navigate({ record: null, view: null, section: null });
            setDialog(null);
            setError('');
          }
        }}
        open={dialog !== null}
      >
        {dialog === 'prepare' ? (
          <DialogContent
            aria-describedby="personnel-action-prepare-description"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              returnFocusRef.current?.();
            }}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              employeeRef.current?.focus();
            }}
          >
            <DialogHeader>
              <div className="grid min-w-0 gap-1.5">
                <DialogTitle>
                  {mode === 'replace'
                    ? 'Prepare replacement action'
                    : mode === 'edit'
                      ? 'Edit Personnel Action draft'
                      : 'Prepare Personnel Action'}
                </DialogTitle>
                <DialogDescription id="personnel-action-prepare-description">
                  Record the Employee, proposed effectivity, exact evidence versions, and
                  action-specific facts.
                </DialogDescription>
              </div>
              <CloseButton busy={busy} label="Close Personnel Action preparation" />
            </DialogHeader>
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={save}>
              <DialogBody className="grid gap-6">
                <FormError message={error} />
                <section className="grid gap-4">
                  <h3 className={sectionTitleClass}>Action identity</h3>
                  <div className="grid gap-4 min-[621px]:grid-cols-3">
                    <Field htmlFor="action-employee" label="Employee">
                      <select
                        className={inputClass}
                        disabled={referenceLoading || mode !== 'create'}
                        id="action-employee"
                        onChange={(event) => setEmployeeId(targetValue(event))}
                        ref={employeeRef}
                        required
                        value={employeeId}
                      >
                        <option value="">Select an eligible Employee</option>
                        {employees.map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.employeeNumber} · {employee.legalName} ·{' '}
                            {employee.serviceStatus}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field htmlFor="action-type" label="Canonical action type">
                      <select
                        className={inputClass}
                        disabled={mode === 'edit'}
                        id="action-type"
                        onChange={(event) => {
                          setActionType(targetValue(event) as ActionType);
                          setFacts({});
                          setEvidence({});
                        }}
                        value={actionType}
                      >
                        {ACTION_TYPES.filter(
                          (type) => canLinkAppointments || !isMovementAction(type),
                        ).map((type) => (
                          <option key={type} value={type}>
                            {CONTRACTS[type].label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field htmlFor="action-effectivity" label="Proposed effectivity">
                      <input
                        className={inputClass}
                        id="action-effectivity"
                        onChange={(event) => setEffectivity(targetValue(event))}
                        required
                        type="date"
                        value={effectivity}
                      />
                    </Field>
                  </div>
                </section>
                <section className="grid gap-4">
                  <h3 className={sectionTitleClass}>Action-specific target facts</h3>
                  <div className="grid gap-4 min-[621px]:grid-cols-2">
                    {CONTRACTS[actionType].fields.map((field) => (
                      <TargetField
                        appointments={appointmentCandidates}
                        field={field}
                        facts={facts}
                        key={field.name}
                        onAppointmentSelect={(candidate) =>
                          setEffectivity(candidate.actualAssumptionDate)
                        }
                        positions={positions}
                        setFacts={setFacts}
                        units={units}
                      />
                    ))}
                  </div>
                </section>
                <section className="grid gap-4">
                  <h3 className={sectionTitleClass}>Exact authority and supporting evidence</h3>
                  <div className="grid gap-3">
                    {evidenceRows(actionType).map(({ type, required }) => (
                      <div
                        className="grid gap-3 rounded-control border border-border p-3 min-[621px]:grid-cols-[170px_1fr_170px] min-[621px]:items-end"
                        key={type}
                      >
                        <strong className="text-caption font-[650] text-ink">
                          {type.replaceAll('_', ' ')}
                          {required ? '' : ' (optional)'}
                        </strong>
                        <Field htmlFor={`evidence-${type}`} label="External Evidence Document">
                          <select
                            className={inputClass}
                            id={`evidence-${type}`}
                            onChange={(event) => {
                              const documentId = targetValue(event);
                              const document = documents.find(({ id }) => id === documentId);
                              const sourceDate =
                                document?.currentVersion?.issuedAt?.slice(0, 10) ?? effectivity;
                              setEvidence((current) => ({
                                ...current,
                                [type]: { documentId, sourceDate },
                              }));
                            }}
                            required={required}
                            value={evidence[type]?.documentId ?? ''}
                          >
                            <option value="">Select approved evidence</option>
                            {documents
                              .filter(
                                (document) =>
                                  document.currentVersion && document.status !== 'VOIDED',
                              )
                              .map((document) => (
                                <option key={document.id} value={document.id}>
                                  {document.documentNo ?? document.documentType} · v
                                  {document.currentVersion?.versionNo}
                                </option>
                              ))}
                          </select>
                        </Field>
                        <Field htmlFor={`evidence-date-${type}`} label="Source date">
                          <input
                            className={inputClass}
                            id={`evidence-date-${type}`}
                            onChange={(event) => {
                              const sourceDate = targetValue(event);
                              setEvidence((current) => ({
                                ...current,
                                [type]: {
                                  documentId: current[type]?.documentId ?? '',
                                  sourceDate,
                                },
                              }));
                            }}
                            required={required || Boolean(evidence[type]?.documentId)}
                            type="date"
                            value={evidence[type]?.sourceDate ?? effectivity}
                          />
                        </Field>
                      </div>
                    ))}
                  </div>
                </section>
                <Field htmlFor="action-reason" label="Preparation reason">
                  <textarea
                    className={`${inputClass} min-h-24 py-2`}
                    id="action-reason"
                    onChange={(event) => setReason(targetValue(event))}
                    required
                    value={reason}
                  />
                </Field>
                <p className="m-0 rounded-control border border-info/40 bg-info/5 px-3 py-2.5 text-small text-ink">
                  Approval preserves this exact version as pending effectuation. It does not update
                  Employee, Service Segment, Position, or compensation facts.
                </p>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy || referenceLoading} type="submit" variant="primary">
                  {busy ? 'Saving…' : mode === 'replace' ? 'Prepare replacement' : 'Save draft'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        ) : null}

        {dialog === 'detail' && selected ? (
          <DialogContent aria-describedby="personnel-action-detail-description">
            <DialogHeader>
              <div className="grid min-w-0 gap-1.5">
                <div className="flex flex-wrap items-center gap-3">
                  <DialogTitle>{selected.employee.legalName}</DialogTitle>
                  <ActionStatusTag status={selected.status} />
                </div>
                <DialogDescription id="personnel-action-detail-description">
                  {CONTRACTS[selected.actionType].label} · {selected.employee.employeeNumber}
                </DialogDescription>
              </div>
              <CloseButton busy={busy} label="Close Personnel Action details" />
            </DialogHeader>
            <DialogBody className="grid gap-6">
              <FormError message={error} />
              <AuthorityChain stage={stage} />
              <div className="flex flex-wrap gap-2">
                {canPrepare &&
                preparedByMe &&
                (selected.status === 'DRAFT' || selected.status === 'RETURNED') ? (
                  <Button
                    onClick={() => openPrepare('edit', selected)}
                    type="button"
                    variant="secondary"
                  >
                    Edit draft
                  </Button>
                ) : null}
                {canSubmit &&
                preparedByMe &&
                (selected.status === 'DRAFT' || selected.status === 'RETURNED') ? (
                  <Button
                    disabled={busy}
                    onClick={() => void submit()}
                    type="button"
                    variant="primary"
                  >
                    Submit for review
                  </Button>
                ) : null}
                {canReturn && selected.status === 'FOR_REVIEW' ? (
                  <Button
                    onClick={() => openTransition('RETURN')}
                    type="button"
                    variant="secondary"
                  >
                    Return
                  </Button>
                ) : null}
                {canEndorse && selected.status === 'FOR_REVIEW' ? (
                  <Button onClick={() => openTransition('ENDORSE')} type="button" variant="primary">
                    Endorse
                  </Button>
                ) : null}
                {!preparedByMe &&
                (canApprove || authority.canApprove) &&
                selected.status === 'FOR_APPROVAL' ? (
                  <Button onClick={() => openTransition('APPROVE')} type="button" variant="primary">
                    Approve
                  </Button>
                ) : null}
                {!preparedByMe &&
                (canReject || authority.canReject) &&
                selected.status === 'FOR_APPROVAL' ? (
                  <Button
                    onClick={() => openTransition('REJECT')}
                    type="button"
                    variant="secondary"
                  >
                    Reject
                  </Button>
                ) : null}
                {(canCancel && preparedByMe && ['DRAFT', 'RETURNED'].includes(selected.status)) ||
                ((canCancelApproved || authority.canCancelApproved) &&
                  selected.status === 'APPROVED') ? (
                  <Button
                    onClick={() => openTransition('CANCEL')}
                    type="button"
                    variant="secondary"
                  >
                    Cancel action
                  </Button>
                ) : null}
                {canEffectuate &&
                selected.status === 'APPROVED' &&
                selected.effectuationAvailable ? (
                  <Button
                    onClick={() => openTransition('EFFECTUATE')}
                    type="button"
                    variant="primary"
                  >
                    Effectuate action
                  </Button>
                ) : null}
                {canCorrect && ['APPROVED', 'EFFECTIVE'].includes(selected.status) ? (
                  <Button
                    onClick={() => openPrepare('replace', selected)}
                    type="button"
                    variant="secondary"
                  >
                    Prepare replacement
                  </Button>
                ) : null}
                {canAudit ? (
                  <Button
                    disabled={busy}
                    onClick={() => void openHistory()}
                    type="button"
                    variant="secondary"
                  >
                    View history
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-x-10 gap-y-6 min-[621px]:grid-cols-2">
                <DetailGroup title="Source and effectivity">
                  <DetailRow label="Version">{selected.currentVersion.versionNo}</DetailRow>
                  <DetailRow label="Service Segment">
                    {selected.currentVersion.fromServiceSegment.id}
                  </DetailRow>
                  <DetailRow label="Current salary">
                    SG {selected.currentVersion.fromServiceSegment.salaryGrade ?? '—'}, Step{' '}
                    {selected.currentVersion.fromServiceSegment.salaryStep ?? '—'}
                  </DetailRow>
                  <DetailRow label="Effectivity">
                    {dateLabel(selected.currentVersion.proposedEffectivity)}
                  </DetailRow>
                </DetailGroup>
                <DetailGroup title="Workflow authority">
                  <DetailRow label="Prepared by">{selected.preparedBy.displayName}</DetailRow>
                  <DetailRow label="Approved by">
                    {selected.approvedBy?.displayName ?? 'Pending'}
                  </DetailRow>
                  <DetailRow label="Delegation">
                    {selected.approvalDelegationId ?? 'Direct or pending'}
                  </DetailRow>
                  {selected.effect ? (
                    <DetailRow label="Effective result">
                      {`SG ${selected.effect.salaryGrade ?? '—'}, Step ${selected.effect.salaryStep ?? '—'}`}
                    </DetailRow>
                  ) : null}
                </DetailGroup>
                <DetailGroup title="Target facts">
                  {selected.currentVersion.targetPositionId ? (
                    <DetailRow label="Target Plantilla Position">
                      {selected.currentVersion.targetPositionId}
                    </DetailRow>
                  ) : null}
                  {selected.currentVersion.targetOrganizationUnitId ? (
                    <DetailRow label="Target Organization Unit">
                      {selected.currentVersion.targetOrganizationUnitId}
                    </DetailRow>
                  ) : null}
                  {Object.entries(selected.currentVersion.targetFacts).map(([key, value]) => {
                    const candidate =
                      key === 'appointmentVersionId' && typeof value === 'string'
                        ? appointmentCandidates.find(
                            ({ appointmentVersionId }) => appointmentVersionId === value,
                          )
                        : undefined;
                    return (
                      <DetailRow
                        key={key}
                        label={
                          key === 'appointmentVersionId' ? 'Assumed Appointment' : factLabel(key)
                        }
                      >
                        {candidate
                          ? `${candidate.appointee.fullName} · ${candidate.applicationNo} · ${candidate.natureOfAppointment.replaceAll('_', ' ')}`
                          : value === null
                            ? 'Not applicable'
                            : String(value)}
                      </DetailRow>
                    );
                  })}
                </DetailGroup>
                <DetailGroup title="Reason">
                  <DetailRow label="Preparation reason">{selected.currentVersion.reason}</DetailRow>
                </DetailGroup>
              </div>
              <section className="grid gap-3">
                <h3 className={sectionTitleClass}>Exact evidence</h3>
                {selected.currentVersion.evidence.length === 0 ? (
                  <p className="m-0 text-small text-ink-muted">No evidence linked.</p>
                ) : (
                  <div className="rounded-control border border-border">
                    <Table aria-label="Exact evidence">
                      <thead>
                        <tr>
                          <Th>Evidence</Th>
                          <Th>Document</Th>
                          <Th kind="numeric">Version</Th>
                          <Th kind="date">Source date</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.currentVersion.evidence.map((item) => (
                          <Tr key={item.id}>
                            <Td className="font-[600] text-ink">
                              {item.evidenceType.replaceAll('_', ' ')}
                            </Td>
                            <Td>{item.document.documentNo ?? item.document.documentType}</Td>
                            <Td kind="numeric">v{item.document.versionNo}</Td>
                            <Td kind="date">{dateLabel(item.sourceDate)}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                )}
              </section>
            </DialogBody>
          </DialogContent>
        ) : null}

        {dialog === 'transition' && selected ? (
          <DialogContent aria-describedby="personnel-action-transition-description" size="compact">
            <DialogHeader>
              <div className="grid min-w-0 gap-1.5">
                <DialogTitle>{transitionLabel(transition)} Personnel Action</DialogTitle>
                <DialogDescription id="personnel-action-transition-description">
                  {transition === 'EFFECTUATE'
                    ? isMovementAction(selected.actionType)
                      ? `Consume exact version ${selected.currentVersion.versionNo}'s assumed Appointment to move the Employee into the reserved Plantilla item.`
                      : selected.actionType === 'SALARY_ADJUSTMENT' ||
                          selected.actionType === 'STEP_INCREMENT'
                        ? `Confirm the effective-dated compensation facts for exact version ${selected.currentVersion.versionNo}.`
                        : `Apply exact version ${selected.currentVersion.versionNo} to service and Plantilla records on its stated date.`
                    : `Record the accountable reason against exact version ${selected.currentVersion.versionNo}.`}
                </DialogDescription>
              </div>
              <CloseButton busy={busy} label="Close Personnel Action transition" />
            </DialogHeader>
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={recordTransition}>
              <DialogBody className="grid gap-5">
                <FormError message={error} />
                {transition === 'EFFECTUATE' ? (
                  selected.actionType === 'SALARY_ADJUSTMENT' ||
                  selected.actionType === 'STEP_INCREMENT' ? (
                    <dl className="m-0 grid gap-2">
                      <DetailRow label="Effectivity">
                        {dateLabel(selected.currentVersion.proposedEffectivity)}
                      </DetailRow>
                      <DetailRow label="New compensation">
                        {`SG ${selected.actionType === 'SALARY_ADJUSTMENT' ? String(selected.currentVersion.targetFacts.newSalaryGrade) : (selected.currentVersion.fromServiceSegment.salaryGrade ?? '—')}, Step ${String(selected.currentVersion.targetFacts.newSalaryStep)}`}
                      </DetailRow>
                    </dl>
                  ) : isMovementAction(selected.actionType) ? (
                    <div className="grid gap-3">
                      <dl className="m-0 grid gap-2">
                        <DetailRow label="Effectivity">
                          {dateLabel(selected.currentVersion.proposedEffectivity)}
                        </DetailRow>
                        <DetailRow label="Source Service Segment">
                          {selected.currentVersion.fromServiceSegment.id}
                        </DetailRow>
                        <DetailRow label="Target Plantilla Position">
                          {selected.currentVersion.targetPositionId ?? '—'}
                        </DetailRow>
                      </dl>
                      <p className="m-0 text-body text-ink">
                        {selected.actionType === 'COMPARABLE_REINSTATEMENT'
                          ? 'This creates the successor Service Segment and Position Incumbency from the assumed Appointment and occupies the reserved target item. The preserved closed source Segment is not modified.'
                          : 'This closes the source Service Segment and Position Incumbency on the day before effectivity, releases the source item, and occupies the reserved target item from the assumed Appointment.'}{' '}
                        The approved version remains immutable.
                      </p>
                    </div>
                  ) : (
                    <p className="m-0 text-body text-ink">
                      This closes or restores the Employee’s preserved service history and updates
                      the occupied Plantilla Position atomically. The approved version remains
                      immutable.
                    </p>
                  )
                ) : (
                  <Field htmlFor="action-transition-reason" label="Reason">
                    <textarea
                      autoFocus
                      className={`${inputClass} min-h-24 py-2`}
                      id="action-transition-reason"
                      onChange={(event) => setTransitionReason(targetValue(event))}
                      required
                      value={transitionReason}
                    />
                  </Field>
                )}
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} type="submit" variant="primary">
                  {busy
                    ? transition === 'EFFECTUATE'
                      ? 'Effectuating…'
                      : 'Recording…'
                    : transition === 'EFFECTUATE'
                      ? 'Confirm effectuation'
                      : 'Record decision'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        ) : null}

        {dialog === 'history' && selected ? (
          <DialogContent aria-describedby="personnel-action-history-description">
            <DialogHeader>
              <div className="grid min-w-0 gap-1.5">
                <DialogTitle>Personnel Action history</DialogTitle>
                <DialogDescription id="personnel-action-history-description">
                  Immutable versions and material transitions for {selected.employee.legalName}.
                </DialogDescription>
              </div>
              <CloseButton busy={busy} label="Close Personnel Action history" />
            </DialogHeader>
            <DialogBody className="grid gap-3">
              {history.length === 0 ? (
                <StateSurface compact label="Personnel Action history">
                  <p className="m-0">No history recorded.</p>
                </StateSurface>
              ) : (
                <div className="rounded-control border border-border">
                  <Table aria-label="Transitions" className="min-w-[640px]">
                    <thead>
                      <tr>
                        <Th>Event</Th>
                        <Th>Status change</Th>
                        <Th>Actor</Th>
                        <Th kind="date">Recorded</Th>
                        <Th>Reason</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((entry) => (
                        <Tr key={entry.id}>
                          <Td className="font-[600] text-ink">
                            {entry.action.replaceAll('_', ' ')}
                          </Td>
                          <Td className="whitespace-nowrap">
                            {entry.previousStatus ?? '—'} → {entry.newStatus ?? '—'}
                          </Td>
                          <Td>{entry.actor.displayName ?? 'System'}</Td>
                          <Td kind="date">
                            <time dateTime={entry.occurredAt}>
                              {new Date(entry.occurredAt).toLocaleString('en-PH')}
                            </time>
                          </Td>
                          <Td className="text-ink-muted">{entry.reason ?? '—'}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Close
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function evidenceRows(actionType: ActionType): Array<{ type: string; required: boolean }> {
  const required = CONTRACTS[actionType].evidence.map((type) => ({ type, required: true }));
  return required.some(({ type }) => type === 'AUTHORITY')
    ? required
    : [...required, { type: 'AUTHORITY', required: false }];
}

function TargetField({
  field,
  facts,
  setFacts,
  units,
  positions,
  appointments,
  onAppointmentSelect,
}: {
  field: FieldSpec;
  facts: Record<string, string>;
  setFacts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  units: UnitOption[];
  positions: PositionOption[];
  appointments: AppointmentCandidate[];
  onAppointmentSelect?: (candidate: AppointmentCandidate) => void;
}) {
  const id = `target-${field.name}`;
  const value = facts[field.name] ?? '';
  const update = (next: string) => setFacts((current) => ({ ...current, [field.name]: next }));
  if (
    field.kind === 'select' ||
    field.kind === 'boolean' ||
    field.kind === 'unit' ||
    field.kind === 'position' ||
    field.kind === 'appointment'
  ) {
    const options = field.kind === 'boolean' ? ['true', 'false'] : (field.options ?? []);
    return (
      <Field htmlFor={id} label={field.label}>
        <select
          className={inputClass}
          id={id}
          onChange={(event) => {
            const next = targetValue(event);
            update(next);
            if (field.kind === 'appointment') {
              const candidate = appointments.find(
                ({ appointmentVersionId }) => appointmentVersionId === next,
              );
              if (candidate) onAppointmentSelect?.(candidate);
            }
          }}
          required
          value={value}
        >
          <option value="">Select</option>
          {field.kind === 'unit'
            ? units
                .filter(({ lifecycleStatus }) => lifecycleStatus === 'ACTIVE')
                .map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.code} · {unit.officialName}
                  </option>
                ))
            : field.kind === 'position'
              ? positions.map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.itemNumber} · {position.currentVersion?.title ?? position.status}
                  </option>
                ))
              : field.kind === 'appointment'
                ? appointments
                    .filter(
                      ({ natureOfAppointment }) =>
                        !field.options || field.options.includes(natureOfAppointment),
                    )
                    .map((candidate) => (
                      <option
                        key={candidate.appointmentVersionId}
                        value={candidate.appointmentVersionId}
                      >
                        {candidate.appointee.fullName} · {candidate.applicationNo} ·{' '}
                        {candidate.natureOfAppointment.replaceAll('_', ' ')} ·{' '}
                        {candidate.position.itemNumber} · assumed{' '}
                        {dateLabel(candidate.actualAssumptionDate)}
                      </option>
                    ))
                : options.map((option) => (
                    <option key={option} value={option}>
                      {field.kind === 'boolean'
                        ? option === 'true'
                          ? 'Yes'
                          : 'No'
                        : option.replaceAll('_', ' ')}
                    </option>
                  ))}
        </select>
      </Field>
    );
  }
  return (
    <Field htmlFor={id} label={field.label}>
      <input
        className={inputClass}
        id={id}
        min={field.kind === 'number' ? 0 : undefined}
        onChange={(event) => update(targetValue(event))}
        required={!field.nullable}
        type={field.kind}
        value={value}
      />
    </Field>
  );
}

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

const sectionTitleClass = 'm-0 text-panel-title text-ink';

function CloseButton({ busy, label }: { busy: boolean; label: string }) {
  return (
    <DialogClose asChild>
      <Button aria-label={label} disabled={busy} type="button">
        <span aria-hidden="true" className="text-xl leading-none">
          ×
        </span>
      </Button>
    </DialogClose>
  );
}

const STAGES = ['Prepare', 'Review', 'Authority', 'Effectuation'] as const;

/** The four workflow stages, with every stage up to `stage` marked as reached. */
function AuthorityChain({ stage }: { stage: number }) {
  return (
    <ol
      aria-label="Authority chain"
      className="m-0 grid list-none grid-cols-2 gap-px overflow-hidden rounded-control border border-border bg-border p-0 min-[621px]:grid-cols-4"
    >
      {STAGES.map((label, index) => (
        <li
          className={cn(
            'bg-surface px-3 py-2 text-caption',
            index <= stage
              ? 'font-[650] text-ink shadow-[inset_0_3px_0_var(--color-primary)]'
              : 'text-ink-muted',
          )}
          key={label}
        >
          <span className="block font-normal text-ink-muted">Step {index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid content-start gap-3">
      <h3 className={sectionTitleClass}>{title}</h3>
      <dl className="m-0 grid gap-2">{children}</dl>
    </section>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 min-[621px]:grid-cols-[150px_1fr]">
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="m-0 text-body [overflow-wrap:anywhere] text-ink">{children}</dd>
    </div>
  );
}

/** `newSalaryStep` → `New salary step`. */
function factLabel(key: string): string {
  const words = key.replaceAll(/([A-Z])/g, ' $1').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function transitionLabel(value: string): string {
  return value === 'RETURN'
    ? 'Return'
    : value === 'ENDORSE'
      ? 'Endorse'
      : value === 'APPROVE'
        ? 'Approve'
        : value === 'REJECT'
          ? 'Reject'
          : value === 'CANCEL'
            ? 'Cancel'
            : value === 'EFFECTUATE'
              ? 'Effectuate'
              : 'Check';
}

async function request(agencyId: string, path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api/v1/agencies/${agencyId}${path}`, init);
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw value ?? new Error(`Request failed with status ${response.status}.`);
  return value;
}
