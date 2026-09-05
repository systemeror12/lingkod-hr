'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { manilaToday } from '../lib/manila-date';
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
] as const;

type ActionType = (typeof ACTION_TYPES)[number];
type ActionStatus =
  | 'DRAFT'
  | 'FOR_REVIEW'
  | 'FOR_APPROVAL'
  | 'APPROVED'
  | 'RETURNED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'SUPERSEDED'
  | 'EFFECTIVE';

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
  currentVersion: { id: string; versionNo: number } | null;
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

type FieldKind = 'text' | 'date' | 'number' | 'boolean' | 'select' | 'unit' | 'position';
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
};

const inputClass =
  'min-h-11 w-full rounded-[3px] border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/15';
const labelClass = 'grid gap-1.5 text-xs font-[650] text-ink';

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label className={labelClass} htmlFor={htmlFor}>
      <span>{label}</span>
      {children}
    </label>
  );
}

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

function statusClass(status: ActionStatus): string {
  if (status === 'APPROVED' || status === 'EFFECTIVE') return 'bg-[#e8f3ed] text-[#316647]';
  if (status === 'REJECTED' || status === 'CANCELLED' || status === 'SUPERSEDED')
    return 'bg-[#f0f2f5] text-muted';
  if (status === 'FOR_APPROVAL') return 'bg-[#e8edf8] text-[#315f99]';
  return 'bg-[#fff3d6] text-[#79531c]';
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
  canApprove,
  canReject,
  canCancel,
  canCancelApproved,
  canCorrect,
  canEffectuate,
  canAudit,
}: {
  agencyId: string;
  membershipId: string;
  initial: PersonnelActionListResponse;
  canPrepare: boolean;
  canSubmit: boolean;
  canReturn: boolean;
  canEndorse: boolean;
  canApprove: boolean;
  canReject: boolean;
  canCancel: boolean;
  canCancelApproved: boolean;
  canCorrect: boolean;
  canEffectuate: boolean;
  canAudit: boolean;
}) {
  const [actions, setActions] = useState(initial.actions);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const selected = actions.find(({ id }) => id === selectedId) ?? null;

  useEffect(() => {
    if (!canPrepare && !canCorrect) return;
    let active = true;
    setReferenceLoading(true);
    Promise.all([
      request(agencyId, '/employees'),
      request(agencyId, '/documents'),
      request(agencyId, '/organization-units'),
      request(agencyId, '/plantilla-positions'),
    ])
      .then(([employeeValue, documentValue, unitValue, positionValue]) => {
        if (!active) return;
        setEmployees((employeeValue as { employees: EmployeeOption[] }).employees);
        setDocuments((documentValue as { documents: DocumentOption[] }).documents);
        setUnits((unitValue as { units: UnitOption[] }).units);
        setPositions((positionValue as { positions: PositionOption[] }).positions);
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
  }, [agencyId, canCorrect, canPrepare]);

  function replaceAction(next: PersonnelAction): void {
    setActions((current) => {
      const found = current.some(({ id }) => id === next.id);
      return found
        ? current.map((item) => (item.id === next.id ? next : item))
        : [next, ...current];
    });
    setSelectedId(next.id);
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

  async function openDetail(action: PersonnelAction): Promise<void> {
    setSelectedId(action.id);
    setAuthority({ canApprove: false, canReject: false, canCancelApproved: false });
    setError('');
    setDialog('detail');
    try {
      setAuthority(
        (await request(agencyId, `/personnel-actions/${action.id}/authority`)) as typeof authority,
      );
    } catch (cause: unknown) {
      setError(errorMessage(cause, 'Decision authority could not be checked.'));
    }
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
    if (!selected) return;
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
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const value = (await request(agencyId, `/personnel-actions/${selected.id}/history`)) as {
        entries: typeof history;
      };
      setHistory(value.entries);
      setDialog('history');
    } catch (cause: unknown) {
      setError(errorMessage(cause, 'Personnel Action history could not be loaded.'));
    } finally {
      setBusy(false);
    }
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

  return (
    <div className="grid min-w-0 gap-7">
      <header className="flex flex-col gap-5 min-[700px]:flex-row min-[700px]:items-end min-[700px]:justify-between">
        <div>
          <p className="mb-2 text-[10px] font-bold tracking-[.12em] text-cobalt uppercase">
            Personnel records / Phase 5
          </p>
          <h1 className="m-0 text-[30px] font-[700] tracking-[-.035em] text-midnight">
            Personnel actions
          </h1>
          <p className="mt-2 max-w-[680px] text-sm leading-6 text-muted">
            Prepare evidence-backed actions, resolve deficiencies, and record the applicable
            authority’s decision without changing service facts before effectuation.
          </p>
        </div>
        {canPrepare ? (
          <Button
            disabled={referenceLoading}
            onClick={(event) => {
              const trigger = event.currentTarget as unknown as { focus(): void };
              openPrepare('create', undefined, () => trigger.focus());
            }}
            size="default"
            type="button"
            variant="primary"
          >
            {referenceLoading ? 'Loading references…' : 'Prepare action'}
          </Button>
        ) : null}
      </header>

      <section
        className="grid grid-cols-2 border-y border-line bg-paper min-[700px]:grid-cols-4"
        aria-label="Personnel Action authority chain"
      >
        {['Prepare', 'Review', 'Authority', 'Effectuation'].map((label, index) => (
          <div className="border-r border-line px-4 py-4 last:border-r-0" key={label}>
            <span className="font-mono text-[10px] font-bold text-cobalt">0{index + 1}</span>
            <strong className="mt-1 block text-xs text-midnight">{label}</strong>
            <span className="mt-1 block text-[11px] leading-4 text-muted">
              {index === 0
                ? 'Typed facts + evidence'
                : index === 1
                  ? 'Return or endorse'
                  : index === 2
                    ? 'Approve or reject'
                    : 'Owned by effect service'}
            </span>
          </div>
        ))}
      </section>

      {success ? (
        <p
          className="m-0 border border-[#b8d8c0] bg-[#f1faf3] px-4 py-3 text-sm text-[#316647]"
          role="status"
        >
          {success}
        </p>
      ) : null}
      {error && dialog === null ? <ErrorMessage message={error} /> : null}

      <section className="overflow-hidden rounded-[4px] border border-line bg-paper">
        {actions.length === 0 ? (
          <div className="px-5 py-10">
            <strong className="block text-sm text-midnight">No Personnel Actions yet</strong>
            <p className="m-0 mt-2 max-w-[560px] text-sm leading-6 text-muted">
              Start when the Employee has a current Service Segment and the exact authority and
              supporting evidence are available.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead className="border-b border-line bg-[#f9fafc] text-[10px] tracking-[.08em] text-muted uppercase">
                <tr>
                  <th className="px-5 py-3">Employee</th>
                  <th className="px-5 py-3">Action</th>
                  <th className="px-5 py-3">Effectivity</th>
                  <th className="px-5 py-3">State</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {actions.map((action) => (
                  <tr
                    className="border-b border-line last:border-0 hover:bg-[#f8fafd]"
                    key={action.id}
                  >
                    <td className="px-5 py-4">
                      <button
                        className="text-left"
                        onClick={() => void openDetail(action)}
                        type="button"
                      >
                        <strong className="block text-sm text-ink">
                          {action.employee.legalName}
                        </strong>
                        <span className="font-mono text-xs text-muted">
                          {action.employee.employeeNumber}
                        </span>
                      </button>
                    </td>
                    <td className="px-5 py-4 text-sm text-ink">
                      {CONTRACTS[action.actionType].label}
                      <span className="mt-1 block font-mono text-[11px] text-muted">
                        v{action.currentVersion.versionNo}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-xs text-muted">
                      {dateLabel(action.currentVersion.proposedEffectivity)}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[.06em] ${statusClass(action.status)}`}
                      >
                        {action.status.replaceAll('_', ' ')}
                      </span>
                    </td>
                    <td className="px-5">
                      <button
                        aria-label={`Open action for ${action.employee.legalName}`}
                        className="text-lg text-cobalt"
                        onClick={() => void openDetail(action)}
                        type="button"
                      >
                        →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {nextCursor ? (
        <div className="flex justify-center">
          <Button disabled={busy} onClick={() => void loadMore()} type="button" variant="secondary">
            {busy ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}

      <Dialog
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDialog(null);
            setError('');
          }
        }}
        open={dialog !== null}
      >
        {dialog === 'prepare' ? (
          <DialogContent
            aria-describedby="personnel-action-prepare-description"
            className="max-w-[920px]"
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
              <div>
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
            <form onSubmit={save}>
              <DialogBody className="grid gap-6">
                <ErrorMessage message={error} />
                <section className="grid gap-4">
                  <SectionTitle>Action identity</SectionTitle>
                  <div className="grid gap-4 min-[700px]:grid-cols-3">
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
                        {ACTION_TYPES.map((type) => (
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
                  <SectionTitle>Action-specific target facts</SectionTitle>
                  <div className="grid gap-4 min-[700px]:grid-cols-2">
                    {CONTRACTS[actionType].fields.map((field) => (
                      <TargetField
                        field={field}
                        facts={facts}
                        key={field.name}
                        positions={positions}
                        setFacts={setFacts}
                        units={units}
                      />
                    ))}
                  </div>
                </section>
                <section className="grid gap-4">
                  <SectionTitle>Exact authority and supporting evidence</SectionTitle>
                  <div className="grid gap-3">
                    {evidenceRows(actionType).map(({ type, required }) => (
                      <div
                        className="grid gap-3 rounded-[3px] border border-line p-3 min-[700px]:grid-cols-[170px_1fr_170px] min-[700px]:items-end"
                        key={type}
                      >
                        <strong className="font-mono text-[11px] text-midnight">
                          {type.replaceAll('_', ' ')}
                          {required ? '' : ' (optional)'}
                        </strong>
                        <Field htmlFor={`evidence-${type}`} label="External Evidence Document">
                          <select
                            className={inputClass}
                            id={`evidence-${type}`}
                            onChange={(event) =>
                              setEvidence((current) => ({
                                ...current,
                                [type]: {
                                  documentId: targetValue(event),
                                  sourceDate: current[type]?.sourceDate ?? effectivity,
                                },
                              }))
                            }
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
                            onChange={(event) =>
                              setEvidence((current) => ({
                                ...current,
                                [type]: {
                                  documentId: current[type]?.documentId ?? '',
                                  sourceDate: targetValue(event),
                                },
                              }))
                            }
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
                    className={`${inputClass} min-h-24 py-3`}
                    id="action-reason"
                    onChange={(event) => setReason(targetValue(event))}
                    required
                    value={reason}
                  />
                </Field>
                <p className="m-0 border-l-[3px] border-cobalt bg-[#edf3fb] px-4 py-3 text-[13px] leading-6 text-muted">
                  Approval preserves this exact version as pending effectuation. It does not update
                  Employee, Service Segment, Position, or compensation facts.
                </p>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} size="default" type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  disabled={busy || referenceLoading}
                  size="default"
                  type="submit"
                  variant="primary"
                >
                  {busy ? 'Saving…' : mode === 'replace' ? 'Prepare replacement' : 'Save draft'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        ) : null}

        {dialog === 'detail' && selected ? (
          <DialogContent
            aria-describedby="personnel-action-detail-description"
            className="max-w-[840px]"
          >
            <DialogHeader>
              <div>
                <DialogTitle>{selected.employee.legalName}</DialogTitle>
                <DialogDescription id="personnel-action-detail-description">
                  {CONTRACTS[selected.actionType].label} · {selected.employee.employeeNumber}
                </DialogDescription>
              </div>
              <CloseButton busy={busy} label="Close Personnel Action details" />
            </DialogHeader>
            <DialogBody className="grid gap-6">
              <ErrorMessage message={error} />
              <div className="grid grid-cols-4 border-y border-line">
                {['Prepare', 'Review', 'Authority', 'Effectuation'].map((label, index) => (
                  <div
                    className={`border-r border-line px-3 py-3 last:border-r-0 ${index <= stage ? 'bg-[#edf3fb]' : ''}`}
                    key={label}
                  >
                    <span className="block font-mono text-[10px] text-cobalt">0{index + 1}</span>
                    <strong className="text-[11px] text-midnight">{label}</strong>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClass(selected.status)}`}
                >
                  {selected.status.replaceAll('_', ' ')}
                </span>
                <span className="font-mono text-xs text-muted">
                  Version {selected.currentVersion.versionNo}
                </span>
              </div>
              <div className="grid gap-5 min-[700px]:grid-cols-2">
                <DetailGroup title="Source and effectivity">
                  <DetailRow
                    label="Service Segment"
                    value={selected.currentVersion.fromServiceSegment.id}
                  />
                  <DetailRow
                    label="Current salary"
                    value={`SG ${selected.currentVersion.fromServiceSegment.salaryGrade ?? '—'}, Step ${selected.currentVersion.fromServiceSegment.salaryStep ?? '—'}`}
                  />
                  <DetailRow
                    label="Effectivity"
                    value={dateLabel(selected.currentVersion.proposedEffectivity)}
                  />
                </DetailGroup>
                <DetailGroup title="Workflow authority">
                  <DetailRow label="Prepared by" value={selected.preparedBy.displayName} />
                  <DetailRow
                    label="Approved by"
                    value={selected.approvedBy?.displayName ?? 'Pending'}
                  />
                  <DetailRow
                    label="Delegation"
                    value={selected.approvalDelegationId ?? 'Direct or pending'}
                  />
                </DetailGroup>
                <DetailGroup title="Target facts">
                  {Object.entries(selected.currentVersion.targetFacts).map(([key, value]) => (
                    <DetailRow
                      key={key}
                      label={key.replaceAll(/([A-Z])/g, ' $1')}
                      value={value === null ? 'Not applicable' : String(value)}
                    />
                  ))}
                </DetailGroup>
                <DetailGroup title="Exact evidence">
                  {selected.currentVersion.evidence.map((item) => (
                    <DetailRow
                      key={item.id}
                      label={item.evidenceType.replaceAll('_', ' ')}
                      value={`${item.document.documentNo ?? item.document.documentType} · v${item.document.versionNo}`}
                    />
                  ))}
                </DetailGroup>
              </div>
              <div className="rounded-[3px] bg-canvas px-4 py-3 text-sm leading-6 text-ink">
                <strong className="mr-2 text-xs text-muted">Reason</strong>
                {selected.currentVersion.reason}
              </div>
              <div className="flex flex-wrap gap-2">
                {canPrepare &&
                preparedByMe &&
                (selected.status === 'DRAFT' || selected.status === 'RETURNED') ? (
                  <Button
                    onClick={() => openPrepare('edit', selected)}
                    size="default"
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
                    size="default"
                    type="button"
                    variant="primary"
                  >
                    Submit for review
                  </Button>
                ) : null}
                {canReturn && selected.status === 'FOR_REVIEW' ? (
                  <Button
                    onClick={() => openTransition('RETURN')}
                    size="default"
                    type="button"
                    variant="secondary"
                  >
                    Return
                  </Button>
                ) : null}
                {canEndorse && selected.status === 'FOR_REVIEW' ? (
                  <Button
                    onClick={() => openTransition('ENDORSE')}
                    size="default"
                    type="button"
                    variant="primary"
                  >
                    Endorse
                  </Button>
                ) : null}
                {!preparedByMe &&
                (canApprove || authority.canApprove) &&
                selected.status === 'FOR_APPROVAL' ? (
                  <Button
                    onClick={() => openTransition('APPROVE')}
                    size="default"
                    type="button"
                    variant="primary"
                  >
                    Approve
                  </Button>
                ) : null}
                {!preparedByMe &&
                (canReject || authority.canReject) &&
                selected.status === 'FOR_APPROVAL' ? (
                  <Button
                    onClick={() => openTransition('REJECT')}
                    size="default"
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
                    size="default"
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
                    size="default"
                    type="button"
                    variant="primary"
                  >
                    Effectuate action
                  </Button>
                ) : null}
                {canCorrect && ['APPROVED', 'EFFECTIVE'].includes(selected.status) ? (
                  <Button
                    onClick={() => openPrepare('replace', selected)}
                    size="default"
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
                    size="default"
                    type="button"
                    variant="secondary"
                  >
                    View history
                  </Button>
                ) : null}
              </div>
            </DialogBody>
          </DialogContent>
        ) : null}

        {dialog === 'transition' && selected ? (
          <DialogContent aria-describedby="personnel-action-transition-description" size="compact">
            <DialogHeader>
              <div>
                <DialogTitle>{transitionLabel(transition)} Personnel Action</DialogTitle>
                <DialogDescription id="personnel-action-transition-description">
                  {transition === 'EFFECTUATE'
                    ? `Apply exact version ${selected.currentVersion.versionNo} to service and Plantilla records on its stated date.`
                    : `Record the accountable reason against exact version ${selected.currentVersion.versionNo}.`}
                </DialogDescription>
              </div>
              <CloseButton busy={busy} label="Close Personnel Action transition" />
            </DialogHeader>
            <form onSubmit={recordTransition}>
              <DialogBody className="grid gap-5">
                <ErrorMessage message={error} />
                {transition === 'EFFECTUATE' ? (
                  <p className="m-0 text-sm leading-6 text-ink">
                    This closes or restores the Employee’s preserved service history and updates the
                    occupied Plantilla Position atomically. The approved version remains immutable.
                  </p>
                ) : (
                  <Field htmlFor="action-transition-reason" label="Reason">
                    <textarea
                      autoFocus
                      className={`${inputClass} min-h-24 py-3`}
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
                  <Button disabled={busy} size="default" type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} size="default" type="submit" variant="primary">
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
          <DialogContent
            aria-describedby="personnel-action-history-description"
            className="max-w-[760px]"
          >
            <DialogHeader>
              <div>
                <DialogTitle>Personnel Action history</DialogTitle>
                <DialogDescription id="personnel-action-history-description">
                  Immutable versions and material transitions for {selected.employee.legalName}.
                </DialogDescription>
              </div>
              <CloseButton busy={busy} label="Close Personnel Action history" />
            </DialogHeader>
            <DialogBody className="grid gap-3">
              {history.map((entry) => (
                <article className="grid gap-1 border-l-2 border-line px-4 py-3" key={entry.id}>
                  <div className="flex justify-between gap-2">
                    <strong className="text-sm text-midnight">
                      {entry.action.replaceAll('_', ' ')}
                    </strong>
                    <time className="text-xs text-muted">
                      {new Date(entry.occurredAt).toLocaleString('en-PH')}
                    </time>
                  </div>
                  <span className="text-xs text-muted">
                    {entry.previousStatus ?? '—'} → {entry.newStatus ?? '—'} ·{' '}
                    {entry.actor.displayName ?? 'System'}
                  </span>
                  {entry.reason ? (
                    <p className="m-0 text-sm leading-6 text-ink">{entry.reason}</p>
                  ) : null}
                </article>
              ))}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button size="default" type="button" variant="secondary">
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
}: {
  field: FieldSpec;
  facts: Record<string, string>;
  setFacts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  units: UnitOption[];
  positions: PositionOption[];
}) {
  const id = `target-${field.name}`;
  const value = facts[field.name] ?? '';
  const update = (next: string) => setFacts((current) => ({ ...current, [field.name]: next }));
  if (
    field.kind === 'select' ||
    field.kind === 'boolean' ||
    field.kind === 'unit' ||
    field.kind === 'position'
  ) {
    const options = field.kind === 'boolean' ? ['true', 'false'] : (field.options ?? []);
    return (
      <Field htmlFor={id} label={field.label}>
        <select
          className={inputClass}
          id={id}
          onChange={(event) => update(targetValue(event))}
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

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="m-0 text-[11px] font-bold tracking-[.1em] text-cobalt uppercase">{children}</h2>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <p
      className="m-0 rounded-[3px] border border-[#e8b6b6] bg-[#fff4f4] px-3 py-3 text-[13px] text-[#9a3030]"
      role="alert"
    >
      {message}
    </p>
  ) : null;
}

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

function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-line pt-3">
      <SectionTitle>{title}</SectionTitle>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 min-[520px]:grid-cols-[130px_1fr]">
      <span className="text-xs text-muted">{label}</span>
      <span className="break-all text-sm text-ink">{value}</span>
    </div>
  );
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
