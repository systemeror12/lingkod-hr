'use client';

// Throwaway: standard Tree/Form/Kanban on /leave-prototype?view=tree|form|kanban.
// All records and transitions are synthetic. No domain calculation or persistence.
import { useState } from 'react';
import { useRecordNavigation } from './record-navigation';
import { Button } from './ui/button';

type ApplicationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'FOR_CERTIFICATION'
  | 'FOR_RECOMMENDATION'
  | 'FOR_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'NEEDS_INFORMATION'
  | 'CANCEL_REQUESTED'
  | 'POSTED';

type Application = {
  id: string;
  employee: string;
  position: string;
  type: string;
  policy: string;
  dates: string;
  days: string;
  reason: string;
  status: ApplicationStatus;
  evidence: { label: string; state: 'Attached' | 'Required' | 'Not required' }[];
  certification: string;
  recommendation: string;
  decision: string;
  history: string[];
};

const applications: Application[] = [
  {
    id: 'LV-2026-021',
    employee: 'Mara Santos',
    position: 'Administrative Officer II',
    type: 'Vacation leave',
    policy: 'Policy version 3 · effective 1 January 2026 (sample)',
    dates: '10 September 2026',
    days: '1.000 day',
    reason: 'Personal matters',
    status: 'POSTED',
    evidence: [
      { label: 'Leave application form', state: 'Attached' },
      { label: 'Clearance', state: 'Not required' },
    ],
    certification:
      'Credits certified 8 September 2026 · Leave Administrator J. Cruz (sample) · USED entry posted 11 September 2026',
    recommendation: 'Recommended 8 September 2026 · Supervisor R. Bautista (sample)',
    decision: 'Approved 9 September 2026 · Approving official A. Lim (sample)',
    history: [
      'Application prepared · 4 September 2026',
      'Submitted · 4 September 2026',
      'Credits certified · 8 September 2026',
      'Supervisor recommendation · 8 September 2026',
      'Approved · 9 September 2026',
      'Posted to leave ledger · 11 September 2026 · USED −1.000 day',
    ],
  },
  {
    id: 'LV-2026-022',
    employee: 'Mara Santos',
    position: 'Administrative Officer II',
    type: 'Sick leave',
    policy: 'Policy version 2 · effective 1 January 2026 (sample)',
    dates: '22–23 September 2026',
    days: '2.000 days',
    reason: 'Medical consultation and recovery',
    status: 'DRAFT',
    evidence: [
      { label: 'Leave application form', state: 'Attached' },
      { label: 'Medical certificate', state: 'Required' },
    ],
    certification: 'Not requested. The application is still a draft.',
    recommendation: 'Not reached.',
    decision: 'Not reached.',
    history: ['Application prepared · 15 September 2026 · draft only, no routing'],
  },
  {
    id: 'LV-2026-023',
    employee: 'Mara Santos',
    position: 'Administrative Officer II',
    type: 'Special privilege leave',
    policy: 'Policy version 1 · effective 1 January 2026 (sample)',
    dates: '29 September 2026',
    days: '1.000 day',
    reason: 'Family milestone',
    status: 'FOR_CERTIFICATION',
    evidence: [
      { label: 'Leave application form', state: 'Attached' },
      { label: 'Supporting invitation or certification', state: 'Attached' },
    ],
    certification: 'Awaiting credit and eligibility certification.',
    recommendation: 'Not reached.',
    decision: 'Not reached.',
    history: [
      'Application prepared · 14 September 2026',
      'Submitted · 14 September 2026 · routed to Leave Administrator',
    ],
  },
  {
    id: 'LV-2026-030',
    employee: 'Rowena Dela Cruz',
    position: 'Planning Officer III',
    type: 'Vacation leave',
    policy: 'Policy version 3 · effective 1 January 2026 (sample)',
    dates: '15 October 2026',
    days: '1.000 day',
    reason: 'Personal matters',
    status: 'SUBMITTED',
    evidence: [{ label: 'Leave application form', state: 'Attached' }],
    certification: 'Awaiting routing to credit certification.',
    recommendation: 'Not reached.',
    decision: 'Not reached.',
    history: [
      'Application prepared · 15 September 2026',
      'Submitted · 15 September 2026 · awaiting certification queue',
    ],
  },
  {
    id: 'LV-2026-024',
    employee: 'Paolo Reyes',
    position: 'Administrative Aide VI',
    type: 'Vacation leave',
    policy: 'Policy version 3 · effective 1 January 2026 (sample)',
    dates: '5–7 October 2026',
    days: '3.000 days',
    reason: 'Personal matters',
    status: 'FOR_RECOMMENDATION',
    evidence: [{ label: 'Leave application form', state: 'Attached' }],
    certification: 'Credits certified 12 September 2026 · Leave Administrator J. Cruz (sample)',
    recommendation: 'Awaiting supervisor recommendation.',
    decision: 'Not reached.',
    history: [
      'Application prepared · 9 September 2026',
      'Submitted · 9 September 2026',
      'Credits certified · 12 September 2026 · routed to Supervisor',
    ],
  },
  {
    id: 'LV-2026-025',
    employee: 'Rowena Dela Cruz',
    position: 'Planning Officer III',
    type: 'Sick leave',
    policy: 'Policy version 2 · effective 1 January 2026 (sample)',
    dates: '12 October 2026',
    days: '1.000 day',
    reason: 'Medical consultation',
    status: 'FOR_APPROVAL',
    evidence: [
      { label: 'Leave application form', state: 'Attached' },
      { label: 'Medical certificate', state: 'Attached' },
    ],
    certification: 'Credits certified 13 September 2026 · Leave Administrator J. Cruz (sample)',
    recommendation: 'Recommended 14 September 2026 · Supervisor R. Bautista (sample)',
    decision: 'Awaiting approving official.',
    history: [
      'Application prepared · 10 September 2026',
      'Submitted · 10 September 2026',
      'Credits certified · 13 September 2026',
      'Supervisor recommendation · 14 September 2026 · routed to Approving official',
    ],
  },
  {
    id: 'LV-2026-029',
    employee: 'Paolo Reyes',
    position: 'Administrative Aide VI',
    type: 'Sick leave',
    policy: 'Policy version 2 · effective 1 January 2026 (sample)',
    dates: '27 October 2026',
    days: '1.000 day',
    reason: 'Medical consultation',
    status: 'APPROVED',
    evidence: [{ label: 'Medical certificate', state: 'Attached' }],
    certification: 'Credits certified 14 September 2026 · Leave Administrator J. Cruz (sample)',
    recommendation: 'Recommended 14 September 2026 · Supervisor R. Bautista (sample)',
    decision: 'Approved 15 September 2026 · Approving official A. Lim (sample)',
    history: [
      'Application prepared · 11 September 2026',
      'Submitted · 11 September 2026',
      'Credits certified · 14 September 2026',
      'Supervisor recommendation · 14 September 2026',
      'Approved · 15 September 2026 · awaiting posting to the leave ledger',
    ],
  },
  {
    id: 'LV-2026-026',
    employee: 'Mara Santos',
    position: 'Administrative Officer II',
    type: 'Sick leave',
    policy: 'Policy version 2 · effective 1 January 2026 (sample)',
    dates: '20–21 October 2026',
    days: '2.000 days',
    reason: 'Medical consultation and recovery',
    status: 'NEEDS_INFORMATION',
    evidence: [
      { label: 'Leave application form', state: 'Attached' },
      { label: 'Medical certificate', state: 'Required' },
    ],
    certification: 'Not completed. Returned before certification for missing evidence.',
    recommendation: 'Not reached.',
    decision: 'Not reached.',
    history: [
      'Application prepared · 12 September 2026',
      'Submitted · 12 September 2026',
      'Returned for information · 13 September 2026 · attach the medical certificate',
    ],
  },
  {
    id: 'LV-2026-027',
    employee: 'Paolo Reyes',
    position: 'Administrative Aide VI',
    type: 'Leave without pay',
    policy: 'Policy version 1 · effective 1 January 2026 (sample)',
    dates: '3–4 November 2026',
    days: '2.000 days',
    reason: 'Personal matters beyond available credit',
    status: 'REJECTED',
    evidence: [{ label: 'Leave application form', state: 'Attached' }],
    certification: 'Certified no available credit · Leave Administrator J. Cruz (sample)',
    recommendation: 'Recommended 15 September 2026 · Supervisor R. Bautista (sample)',
    decision: 'Rejected 15 September 2026 · service needs during the period',
    history: [
      'Application prepared · 12 September 2026',
      'Submitted · 12 September 2026',
      'Credits certified · 14 September 2026',
      'Supervisor recommendation · 15 September 2026',
      'Rejected · 15 September 2026 · no ledger effect',
    ],
  },
];

const accounts = [
  {
    employee: 'Mara Santos',
    type: 'Vacation leave',
    status: 'ACTIVE',
    posted: '+14.000',
    awaiting: 'No pending credit request',
    last: 'USED · 10 September 2026',
  },
  {
    employee: 'Mara Santos',
    type: 'Sick leave',
    status: 'ACTIVE',
    posted: '+14.000',
    awaiting: '2.000 days returned · not posted',
    last: 'USED · 2 September 2026',
  },
  {
    employee: 'Rowena Dela Cruz',
    type: 'Vacation leave',
    status: 'ACTIVE',
    posted: '+41.000',
    awaiting: '1.000 day awaiting certification',
    last: 'ADJUSTMENT · 1 September 2026',
  },
  {
    employee: 'Rowena Dela Cruz',
    type: 'Sick leave',
    status: 'ACTIVE',
    posted: '+9.250',
    awaiting: '1.000 day for approval',
    last: 'USED · 2 September 2026',
  },
  {
    employee: 'Paolo Reyes',
    type: 'Vacation leave',
    status: 'ACTIVE',
    posted: '+11.500',
    awaiting: '3.000 days recommended · not posted',
    last: 'EARNED · 1 September 2026',
  },
  {
    employee: 'Paolo Reyes',
    type: 'Sick leave',
    status: 'ACTIVE',
    posted: '+5.000',
    awaiting: '1.000 day approved · not posted',
    last: 'OPENING · 1 January 2026',
  },
];

const ledgerEntries: Record<
  string,
  { date: string; entry: string; days: string; source: string }[]
> = {
  'Mara Santos|Vacation leave': [
    { date: '1 January 2026', entry: 'OPENING', days: '+12.000', source: 'Sample carry-over' },
    { date: '1 September 2026', entry: 'EARNED', days: '+1.250', source: 'Sample earning entry' },
    { date: '1 September 2026', entry: 'EARNED', days: '+1.250', source: 'Sample earning entry' },
    { date: '2 September 2026', entry: 'ADJUSTMENT', days: '+0.500', source: 'Sample restoration' },
    { date: '11 September 2026', entry: 'USED', days: '−1.000', source: 'LV-2026-021 posted' },
  ],
  'Mara Santos|Sick leave': [
    { date: '1 January 2026', entry: 'OPENING', days: '+15.000', source: 'Sample carry-over' },
    { date: '1 September 2026', entry: 'EARNED', days: '+1.250', source: 'Sample earning entry' },
    { date: '2 September 2026', entry: 'USED', days: '−1.000', source: 'LV-2026-019 posted' },
    { date: '5 September 2026', entry: 'ADJUSTMENT', days: '−1.250', source: 'Sample adjustment' },
  ],
  'Paolo Reyes|Vacation leave': [
    { date: '1 January 2026', entry: 'OPENING', days: '+9.000', source: 'Sample carry-over' },
    { date: '1 September 2026', entry: 'EARNED', days: '+2.500', source: 'Sample earning entry' },
  ],
  'Paolo Reyes|Sick leave': [
    { date: '1 January 2026', entry: 'OPENING', days: '+3.000', source: 'Sample carry-over' },
    { date: '1 September 2026', entry: 'EARNED', days: '+1.250', source: 'Sample earning entry' },
    { date: '5 September 2026', entry: 'ADJUSTMENT', days: '+0.750', source: 'Sample adjustment' },
  ],
};

const monetization = [
  {
    id: 'MON-2026-004',
    employee: 'Mara Santos',
    type: 'Vacation leave',
    requested: '5.000 days',
    status: 'FOR_VALIDATION',
    detail: 'Balance, retention and annual-limit checks are sample placeholders.',
    effect: 'No ledger or payroll effect',
  },
  {
    id: 'MON-2026-005',
    employee: 'Paolo Reyes',
    type: 'Vacation leave',
    requested: '10.000 days',
    status: 'FOR_APPROVAL',
    detail: 'Validated sample. Funding and authority checks are pending.',
    effect: 'No ledger or payroll effect',
  },
  {
    id: 'MON-2026-006',
    employee: 'Rowena Dela Cruz',
    type: 'Vacation leave',
    requested: '15.000 days',
    status: 'POSTED_TO_PAYROLL',
    detail: 'Approved sample posted on 14 September 2026.',
    effect: 'Ledger USED −15.000 · payroll input PI-2026-0088',
  },
];

const mandatory = [
  {
    employee: 'Rowena Dela Cruz',
    balance: '+41.000',
    last: '2021 (sample)',
    flag: 'Candidate — above the sample threshold',
  },
  {
    employee: 'Mara Santos',
    balance: '+14.000',
    last: '2023 (sample)',
    flag: 'Candidate — above the sample threshold',
  },
  {
    employee: 'Paolo Reyes',
    balance: '+11.500',
    last: '2025 (sample)',
    flag: 'No sample flag',
  },
];

const policies = [
  {
    code: 'VL',
    name: 'Vacation leave',
    creditBased: 'Yes',
    version: 'Version 3 · ACTIVE',
    effective: '1 January 2026',
  },
  {
    code: 'SL',
    name: 'Sick leave',
    creditBased: 'Yes',
    version: 'Version 2 · ACTIVE',
    effective: '1 January 2026',
  },
  {
    code: 'SPL',
    name: 'Special privilege leave',
    creditBased: 'No',
    version: 'Version 1 · ACTIVE',
    effective: '1 January 2026',
  },
  {
    code: 'ML',
    name: 'Maternity leave',
    creditBased: 'No',
    version: 'Version 1 · DRAFT',
    effective: 'Pending approval',
  },
  {
    code: 'LWOP',
    name: 'Leave without pay',
    creditBased: 'No',
    version: 'Version 1 · ACTIVE',
    effective: '1 January 2026',
  },
];

const statusOrder: ApplicationStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'FOR_CERTIFICATION',
  'FOR_RECOMMENDATION',
  'FOR_APPROVAL',
  'APPROVED',
  'POSTED',
  'NEEDS_INFORMATION',
  'REJECTED',
  'CANCEL_REQUESTED',
];

const routeSteps = [
  'Application prepared',
  'Submitted',
  'Credits certified',
  'Supervisor recommendation',
  'Approving decision',
  'Posted to ledger',
];

const rank: Record<ApplicationStatus, number> = {
  DRAFT: 0,
  SUBMITTED: 1,
  FOR_CERTIFICATION: 1,
  NEEDS_INFORMATION: 1,
  FOR_RECOMMENDATION: 2,
  FOR_APPROVAL: 3,
  REJECTED: 3,
  APPROVED: 4,
  POSTED: 5,
  CANCEL_REQUESTED: 5,
};

const panel = 'rounded border border-line bg-paper p-5';
const field = 'mt-1 w-full rounded border border-line bg-paper p-2 text-sm';

function Status({ children }: { children: string }) {
  return (
    <span className="inline-block rounded border border-line bg-canvas px-2 py-1 font-mono text-[11px]">
      {children}
    </span>
  );
}

export function LeavePrototype() {
  const navigation = useRecordNavigation();
  const requestedView = navigation.search.get('view');
  const view = requestedView === 'form' || requestedView === 'kanban' ? requestedView : 'tree';
  const selected = Math.max(
    0,
    applications.findIndex((record) => record.id === navigation.search.get('selected')),
  );
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All statuses');
  const [formTab, setFormTab] = useState('Application');
  const [section, setSection] = useState('Leave applications');
  const [role, setRole] = useState('Employee');
  const [scenario, setScenario] = useState('Active');
  const [notice, setNotice] = useState('');
  const [decision, setDecision] = useState<ApplicationStatus | 'PENDING'>('PENDING');
  const [reason, setReason] = useState('');
  const [certificateNote, setCertificateNote] = useState('');
  const [draftEvidence, setDraftEvidence] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const employee = role === 'Employee';
  const supervisor = role === 'Supervisor';
  const administrator = role === 'Leave Administrator';
  const official = role === 'Approving Official';
  const record = applications[selected]!;
  const scopeEmployees = employee
    ? ['Mara Santos']
    : supervisor
      ? ['Mara Santos', 'Paolo Reyes']
      : ['Mara Santos', 'Rowena Dela Cruz', 'Paolo Reyes'];
  const sections = [
    'Leave applications',
    'Leave credits',
    ...(official ? ['Monetization'] : []),
    ...(administrator ? ['Monetization', 'Mandatory leave', 'Leave policy'] : []),
  ];
  const activeSection = sections.includes(section) ? section : 'Leave applications';
  const completed = scenario === 'Completed';
  const selectScenario = (value: string) => {
    setScenario(value);
    setDecision('PENDING');
    setNotice('');
  };

  function displayStatus(candidate: (typeof applications)[number]): ApplicationStatus {
    const base = completed
      ? 'POSTED'
      : scenario === 'Cancellation requested' && candidate.status === 'POSTED'
        ? 'CANCEL_REQUESTED'
        : scenario === 'Returned' && candidate.status === 'DRAFT'
          ? 'NEEDS_INFORMATION'
          : candidate.status;
    return candidate.id === record.id && decision !== 'PENDING' ? decision : base;
  }

  const status = displayStatus(record);

  function ledgerEffect(candidate: (typeof applications)[number]) {
    const shown = displayStatus(candidate);
    if (shown === 'POSTED') return `Posted · USED −${candidate.days.replace(' days', '')}`;
    if (shown === 'CANCEL_REQUESTED') return 'Posted · reversal pending';
    return 'None — not posted';
  }

  function pendingWith(candidate: (typeof applications)[number]) {
    switch (displayStatus(candidate)) {
      case 'DRAFT':
        return 'Employee';
      case 'SUBMITTED':
      case 'FOR_CERTIFICATION':
        return 'Leave Administrator';
      case 'FOR_RECOMMENDATION':
        return 'Supervisor';
      case 'FOR_APPROVAL':
        return 'Approving official';
      case 'APPROVED':
        return 'Leave Administrator · posting';
      case 'NEEDS_INFORMATION':
        return 'Employee';
      case 'CANCEL_REQUESTED':
        return 'Approving official';
      default:
        return 'None';
    }
  }

  function routeState(index: number) {
    if (status === 'NEEDS_INFORMATION' && index > 1) return 'Waiting';
    if (status === 'REJECTED' && index === 3) return 'Stopped — recommended rejection';
    if (status === 'REJECTED' && index === 4) return 'Stopped — rejected';
    const value = rank[status];
    if (value > index) return 'Done';
    if (value === index) return 'Current';
    return 'Waiting';
  }

  function checkEligibility() {
    setNotice(
      'Sample eligibility check only. Requested units, document requirements and routing are contract decisions; no rule is applied.',
    );
  }

  function openRecord(index: number) {
    setFormTab('Application');
    setDecision('PENDING');
    setReason('');
    setNotice('');
    navigation.navigate({ view: 'form', selected: applications[index]!.id, variant: null });
  }

  const records = applications
    .map((candidate, index) => ({ ...candidate, index }))
    .filter((candidate) => scopeEmployees.includes(candidate.employee))
    .filter(
      (candidate) =>
        (statusFilter === 'All statuses' || displayStatus(candidate) === statusFilter) &&
        `${candidate.id} ${candidate.employee} ${candidate.type} ${candidate.dates} ${candidate.reason}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );

  const recordAccountKey = `${record.employee}|${record.type}`;
  const ledgerForRecord = ledgerEntries[recordAccountKey] ?? [];

  const application = (
    <section className={panel} aria-label="Leave application detail">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <button
          className="cursor-pointer text-sm font-semibold text-cobalt hover:underline"
          onClick={() => navigation.navigate({ view: 'tree', variant: null })}
        >
          Leave / Applications
        </button>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span>
            {selected + 1} / {applications.length}
          </span>
          <Button
            variant="secondary"
            size="default"
            disabled={selected === 0}
            onClick={() => openRecord(selected - 1)}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            size="default"
            disabled={selected === applications.length - 1}
            onClick={() => openRecord(selected + 1)}
          >
            Next
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {record.id} · {record.type}
        </h2>
        <Status>{status}</Status>
      </div>
      <p className="mt-1 text-sm text-muted">
        {record.employee} · {record.position}
      </p>
      <div className="mt-5 flex flex-wrap gap-2" aria-label="Leave application form sections">
        {['Application', 'Credits', 'Decisions', 'History'].map((tab) => (
          <Button
            key={tab}
            variant="secondary"
            size="default"
            aria-pressed={formTab === tab}
            className={`min-h-9 border px-3 ${formTab === tab ? 'border-cobalt bg-[#edf2f9] text-cobalt' : 'border-line bg-paper text-muted'}`}
            onClick={() => setFormTab(tab)}
          >
            {tab}
          </Button>
        ))}
      </div>
      {formTab === 'Application' && (
        <div className="mt-5 space-y-5">
          <dl className="grid gap-6 text-sm md:grid-cols-2">
            <div className="border-l-2 border-cobalt pl-3">
              <dt className="font-semibold">Requested leave</dt>
              <dd>
                {record.type} · {record.days}
              </dd>
              <dd className="text-muted">{record.dates}</dd>
            </div>
            <div className="border-l-2 border-line pl-3">
              <dt className="font-semibold">Policy version applied</dt>
              <dd>{record.policy}</dd>
              <dd className="text-muted">
                Eligibility, accrual and document rules live in the policy contract.
              </dd>
            </div>
            <div className="border-l-2 border-line pl-3">
              <dt className="font-semibold">Reason and details</dt>
              <dd>{record.reason}</dd>
              <dd className="text-muted">
                Government form mapping follows the prior official-form decision; not restated here.
              </dd>
            </div>
            <div className="border-l-2 border-line pl-3">
              <dt className="font-semibold">Scheduling context</dt>
              <dd>
                Schedule version 2 · no holiday in range · no overlapping posted leave (sample
                check)
              </dd>
              <dd className="text-muted">
                Hours, unit calculation and holiday authority await the leave contract.
              </dd>
            </div>
          </dl>
          {status === 'NEEDS_INFORMATION' && (
            <p className="rounded bg-pale-blue p-3 text-sm">
              Returned for information: attach the medical certificate covering the consultation
              dates before resubmitting.
            </p>
          )}
          <div className="border-t border-line pt-4">
            <h3 className="font-semibold">Evidence and deficiencies</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {record.evidence.map((item) => (
                <li key={item.label} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{item.label}</span>
                  <Status>
                    {item.label === 'Medical certificate' && draftEvidence
                      ? 'Attached'
                      : item.state}
                  </Status>
                </li>
              ))}
            </ul>
            {(status === 'DRAFT' || status === 'NEEDS_INFORMATION') && employee && (
              <div className="mt-4 space-y-3">
                {record.evidence.some((item) => item.state === 'Required') && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draftEvidence}
                      onChange={(e) =>
                        setDraftEvidence((e.target as unknown as { checked: boolean }).checked)
                      }
                    />
                    Attach sample medical certificate
                  </label>
                )}
                <label className="block text-sm">
                  Reason and details
                  <textarea
                    className={field}
                    value={reason}
                    placeholder="State the purpose of the leave"
                    onChange={(e) => setReason((e.target as unknown as { value: string }).value)}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="default"
                    onClick={() => {
                      setDraftSaved(true);
                      setNotice('Sample draft saved locally. Nothing is persisted.');
                    }}
                  >
                    Save draft
                  </Button>
                  <Button variant="secondary" size="default" onClick={checkEligibility}>
                    Check eligibility and details
                  </Button>
                  <Button
                    variant="primary"
                    size="default"
                    disabled={!draftSaved && !draftEvidence}
                    onClick={() => {
                      setDecision('SUBMITTED');
                      setNotice(
                        'Sample application submitted. No credits are deducted until approval and posting.',
                      );
                    }}
                  >
                    {status === 'NEEDS_INFORMATION' ? 'Resubmit application' : 'Submit application'}
                  </Button>
                </div>
                <p className="text-xs text-muted">
                  Submitting a draft creates no leave-ledger entry. Only a posted application
                  changes credit balances.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
      {formTab === 'Credits' && (
        <div className="mt-5 space-y-5">
          <p
            className={`border-l-2 pl-3 text-sm ${status === 'POSTED' ? 'border-cobalt' : 'border-line'}`}
          >
            {status === 'POSTED'
              ? `Posted to the leave ledger. This is an effective credit change: ${ledgerEffect(record)}.`
              : status === 'CANCEL_REQUESTED'
                ? 'The original USED entry remains posted. Reversal is prospective and requires the financial handoff contract.'
                : 'No leave-ledger effect. An unapproved or unposted request does not deduct credits; the account below shows posted entries only.'}
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.06em] text-muted">Account</p>
              <p className="mt-1 text-sm">
                {record.employee} · {record.type}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.06em] text-muted">
                Posted balance (sample)
              </p>
              <p className="mt-1 text-sm">
                {accounts.find(
                  (account) => account.employee === record.employee && account.type === record.type,
                )?.posted ?? 'No credit account for this leave type'}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.06em] text-muted">
                This request
              </p>
              <p className="mt-1 text-sm">
                {status === 'POSTED'
                  ? `Deducted ${record.days}`
                  : 'Not deducted — awaiting approval and posting'}
              </p>
            </div>
          </div>
          <div className="border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Credit certification</h3>
              <Status>
                {status === 'FOR_CERTIFICATION' || status === 'SUBMITTED'
                  ? 'PENDING'
                  : status === 'NEEDS_INFORMATION' || status === 'DRAFT'
                    ? 'NOT REQUESTED'
                    : 'CERTIFIED · SAMPLE'}
              </Status>
            </div>
            <p className="mt-2 text-sm">{record.certification}</p>
            {administrator && status === 'FOR_CERTIFICATION' && (
              <div className="mt-3 space-y-3">
                <label className="block text-sm">
                  Certification note · as of 15 September 2026
                  <textarea
                    className={field}
                    placeholder="Record the eligibility and available-credit finding"
                    value={certificateNote}
                    onChange={(e) =>
                      setCertificateNote((e.target as unknown as { value: string }).value)
                    }
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="default"
                    disabled={!certificateNote.trim()}
                    onClick={() => {
                      setDecision('FOR_RECOMMENDATION');
                      setNotice(
                        'Sample certification recorded. Certification alone does not change the ledger.',
                      );
                    }}
                  >
                    Certify available credits
                  </Button>
                  <Button
                    variant="secondary"
                    size="default"
                    disabled={!certificateNote.trim()}
                    onClick={() => {
                      setDecision('NEEDS_INFORMATION');
                      setNotice(`Returned with comment: ${certificateNote}`);
                    }}
                  >
                    Request information
                  </Button>
                </div>
              </div>
            )}
          </div>
          <div className="border-t border-line pt-4">
            <h3 className="font-semibold">
              Credit history · {record.employee} · {record.type}
            </h3>
            {ledgerForRecord.length === 0 ? (
              <p className="mt-2 text-sm text-muted">
                No sample ledger entries for this account. This leave type may not be credit-based.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-[10px] font-bold uppercase tracking-[0.07em] text-muted">
                      {['Effective date', 'Entry', 'Days', 'Source'].map((heading) => (
                        <th key={heading} scope="col" className="px-3 py-2">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerForRecord.map((entry) => (
                      <tr
                        key={`${entry.date}-${entry.entry}-${entry.days}`}
                        className="border-b border-line/70"
                      >
                        <td className="px-3 py-2">{entry.date}</td>
                        <td className="px-3 py-2 font-mono text-xs">{entry.entry}</td>
                        <td className="px-3 py-2 font-mono text-xs">{entry.days}</td>
                        <td className="px-3 py-2 text-xs text-muted">{entry.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-muted">
              Posted entries are immutable. Corrections use reversing entries. Reservation or
              available-balance arithmetic awaits the credit contract.
            </p>
          </div>
        </div>
      )}
      {formTab === 'Decisions' && (
        <div className="mt-5 space-y-5">
          <ol className="space-y-2 text-sm">
            {routeSteps.map((step, index) => (
              <li key={step} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {index + 1}. {step}
                </span>
                <Status>{routeState(index)}</Status>
              </li>
            ))}
          </ol>
          <div className="border-t border-line pt-4">
            <h3 className="font-semibold">Current decision</h3>
            <p className="mt-2 text-sm">
              {record.certification}
              <br />
              {record.recommendation}
              <br />
              {record.decision}
            </p>
          </div>
          <div className="border-t border-line pt-4">
            <h3 className="font-semibold">Permitted action</h3>
            {status === 'FOR_RECOMMENDATION' && supervisor && (
              <div className="mt-3 space-y-3">
                <label className="block text-sm">
                  Recommendation comment
                  <textarea
                    className={field}
                    value={reason}
                    onChange={(e) => setReason((e.target as unknown as { value: string }).value)}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="default"
                    onClick={() => {
                      setDecision('FOR_APPROVAL');
                      setNotice(
                        'Sample recommendation recorded · routed to the Approving official.',
                      );
                    }}
                  >
                    Recommend approval
                  </Button>
                  <Button
                    variant="secondary"
                    size="default"
                    disabled={!reason.trim()}
                    onClick={() => {
                      setDecision('FOR_APPROVAL');
                      setNotice(`Sample rejection recommendation recorded: ${reason}`);
                    }}
                  >
                    Recommend rejection
                  </Button>
                </div>
              </div>
            )}
            {status === 'FOR_APPROVAL' && official && (
              <div className="mt-3 space-y-3">
                <label className="block text-sm">
                  Decision comment
                  <textarea
                    className={field}
                    value={reason}
                    onChange={(e) => setReason((e.target as unknown as { value: string }).value)}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="default"
                    onClick={() => {
                      setDecision('APPROVED');
                      setNotice(
                        'Sample approval recorded. Posting to the ledger is a separate step.',
                      );
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="secondary"
                    size="default"
                    disabled={!reason.trim()}
                    onClick={() => {
                      setDecision('REJECTED');
                      setNotice(`Sample rejection recorded: ${reason}`);
                    }}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            )}
            {status === 'APPROVED' && administrator && (
              <div className="mt-3 space-y-3">
                <p className="text-sm text-muted">
                  Posting creates the leave-ledger deduction and notifies attendance and payroll.
                  Financial handoffs await the financial handoff contract.
                </p>
                <Button
                  variant="primary"
                  size="default"
                  onClick={() => {
                    setDecision('POSTED');
                    setNotice(
                      'Sample posted. Ledger deduction created; payroll handoff is a separate contract.',
                    );
                  }}
                >
                  Post approved leave
                </Button>
              </div>
            )}
            {(status === 'SUBMITTED' ||
              status === 'FOR_RECOMMENDATION' ||
              status === 'FOR_APPROVAL') &&
              administrator && (
                <div className="mt-3 space-y-3">
                  <label className="block text-sm">
                    Request information comment
                    <textarea
                      className={field}
                      value={reason}
                      onChange={(e) => setReason((e.target as unknown as { value: string }).value)}
                    />
                  </label>
                  <Button
                    variant="secondary"
                    size="default"
                    disabled={!reason.trim()}
                    onClick={() => {
                      setDecision('NEEDS_INFORMATION');
                      setNotice(`Returned with comment: ${reason}`);
                    }}
                  >
                    Request information
                  </Button>
                </div>
              )}
            {(status === 'APPROVED' || status === 'POSTED') && (employee || administrator) && (
              <div className="mt-3 space-y-3">
                <label className="block text-sm">
                  Cancellation reason
                  <textarea
                    className={field}
                    value={reason}
                    onChange={(e) => setReason((e.target as unknown as { value: string }).value)}
                  />
                </label>
                <Button
                  variant="secondary"
                  size="default"
                  disabled={!reason.trim()}
                  onClick={() => {
                    setDecision('CANCEL_REQUESTED');
                    setNotice(
                      status === 'POSTED'
                        ? 'Sample cancellation requested. The posted entry remains until a reversal is approved.'
                        : 'Sample cancellation requested. No ledger entry exists yet.',
                    );
                  }}
                >
                  Request cancellation
                </Button>
              </div>
            )}
            {status === 'CANCEL_REQUESTED' && official && (
              <div className="mt-3 space-y-3">
                <label className="block text-sm">
                  Cancellation decision comment
                  <textarea
                    className={field}
                    value={reason}
                    onChange={(e) => setReason((e.target as unknown as { value: string }).value)}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="default"
                    onClick={() => {
                      setNotice(
                        'Sample cancellation approved. Reversal and payroll effects belong to the financial handoff contract.',
                      );
                    }}
                  >
                    Approve cancellation
                  </Button>
                  <Button
                    variant="secondary"
                    size="default"
                    disabled={!reason.trim()}
                    onClick={() => {
                      setDecision('POSTED');
                      setNotice('Sample cancellation rejected. The posted leave is preserved.');
                    }}
                  >
                    Reject cancellation
                  </Button>
                </div>
              </div>
            )}
            {!(
              (status === 'FOR_RECOMMENDATION' && supervisor) ||
              (status === 'FOR_APPROVAL' && official) ||
              (status === 'APPROVED' && administrator) ||
              ((status === 'SUBMITTED' ||
                status === 'FOR_RECOMMENDATION' ||
                status === 'FOR_APPROVAL') &&
                administrator) ||
              ((status === 'APPROVED' || status === 'POSTED') && (employee || administrator)) ||
              (status === 'CANCEL_REQUESTED' && official)
            ) && (
              <p className="mt-2 text-sm text-muted">
                No permitted action for this role at this status. Transitions remain explicit
                permitted actions; the prototype does not invent a rule.
              </p>
            )}
          </div>
        </div>
      )}
      {formTab === 'History' && (
        <details open className="mt-5 border-t border-line pt-3 text-sm">
          <summary className="cursor-pointer font-semibold">Record history</summary>
          <ol className="mt-3 space-y-2">
            {record.history.map((event) => (
              <li key={event}>{event}</li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );

  const credits = (
    <section className={panel}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Leave credits</h2>
        <Status>POSTED LEDGER · SAMPLE</Status>
      </div>
      <p className="mt-2 border-l-2 border-cobalt pl-3 text-sm">
        A request is not a credit deduction. Pending applications are listed separately and do not
        change the posted balance. Reservation or available-balance arithmetic awaits the credit
        contract.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-[10px] font-bold uppercase tracking-[0.07em] text-muted">
              {[
                'Employee',
                'Leave type',
                'Account',
                'Posted balance',
                'Pending · no ledger effect',
                'Last posted entry',
              ].map((heading) => (
                <th key={heading} scope="col" className="px-3 py-2">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {accounts
              .filter((account) => scopeEmployees.includes(account.employee))
              .map((account) => (
                <tr key={`${account.employee}-${account.type}`} className="border-b border-line/70">
                  <td className="px-3 py-2">{account.employee}</td>
                  <td className="px-3 py-2">{account.type}</td>
                  <td className="px-3 py-2 font-mono text-xs">{account.status}</td>
                  <td className="px-3 py-2 font-mono text-xs">{account.posted}</td>
                  <td className="px-3 py-2 text-xs">{account.awaiting}</td>
                  <td className="px-3 py-2 text-xs text-muted">{account.last}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="mt-6 border-t border-line pt-4">
        <h3 className="font-semibold">Terminal leave inputs · preserved, not computed</h3>
        <p className="mt-2 text-sm">
          Aurora Villanueva · Chief Administrative Officer · retiring 31 December 2026 (sample).
          Unused VL +42.500 and SL +30.000 at separation; service start 1998.
        </p>
        <p className="mt-2 text-xs text-muted">
          MVP preserves the data required for a later terminal-leave computation. Full
          retirement-benefit computation stays outside MVP, and the preserved inputs are delivery
          work, not a policy rule.
        </p>
      </div>
    </section>
  );

  const monetizationView = (
    <section className={panel}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Leave monetization</h2>
        <Status>SAMPLE REQUESTS</Status>
      </div>
      <p className="mt-2 border-l-2 border-line pl-3 text-sm">
        Validation checks balance, retention and limits; funding and authority checks precede
        approval. A posted request creates the ledger deduction and the payroll input together.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-[10px] font-bold uppercase tracking-[0.07em] text-muted">
              {['Reference', 'Employee', 'Leave type', 'Requested', 'Status', 'Effect'].map(
                (heading) => (
                  <th key={heading} scope="col" className="px-3 py-2">
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {monetization.map((request) => (
              <tr key={request.id} className="border-b border-line/70">
                <td className="px-3 py-2 font-mono text-xs">{request.id}</td>
                <td className="px-3 py-2">{request.employee}</td>
                <td className="px-3 py-2">{request.type}</td>
                <td className="px-3 py-2 font-mono text-xs">{request.requested}</td>
                <td className="px-3 py-2">
                  <Status>{request.status}</Status>
                </td>
                <td className="px-3 py-2 text-xs">{request.effect}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-3 text-sm">
        {monetization.map((request) => (
          <div key={request.id} className="rounded border border-line bg-canvas/60 p-3">
            <p className="font-mono text-xs text-muted">{request.id}</p>
            <p className="mt-1 font-semibold">{request.status}</p>
            <p className="mt-1 text-xs">{request.detail}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">
        The ledger deduction and payroll earning input are one atomic posting. Their financial
        handoff contract is a separate decision.
      </p>
    </section>
  );

  const mandatoryView = (
    <section className={panel}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Mandatory leave</h2>
        <Status>POLICY PLACEHOLDER</Status>
      </div>
      <p className="mt-2 border-l-2 border-line pl-3 text-sm">
        Sample flags only. The balances, thresholds and conditions that identify employees subject
        to mandatory leave are policy decisions, not prototype choices.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-[10px] font-bold uppercase tracking-[0.07em] text-muted">
              {['Employee', 'Vacation leave balance', 'Last mandatory leave', 'Sample flag'].map(
                (heading) => (
                  <th key={heading} scope="col" className="px-3 py-2">
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {mandatory.map((row) => (
              <tr key={row.employee} className="border-b border-line/70">
                <td className="px-3 py-2">{row.employee}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.balance}</td>
                <td className="px-3 py-2 text-xs text-muted">{row.last}</td>
                <td className="px-3 py-2 text-xs">{row.flag}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );

  const policyView = (
    <section className={panel}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Leave types and policy versions</h2>
        <Status>EFFECTIVE-DATED SCHEMA</Status>
      </div>
      <p className="mt-2 border-l-2 border-line pl-3 text-sm">
        This is the schema shape, not the rule content. Eligibility, accrual, document requirements
        and the approval route code live inside each policy version and await the leave policy
        contract.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-[10px] font-bold uppercase tracking-[0.07em] text-muted">
              {['Code', 'Leave type', 'Credit-based', 'Policy version', 'Effective from'].map(
                (heading) => (
                  <th key={heading} scope="col" className="px-3 py-2">
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {policies.map((policy) => (
              <tr key={policy.code} className="border-b border-line/70">
                <td className="px-3 py-2 font-mono text-xs">{policy.code}</td>
                <td className="px-3 py-2">{policy.name}</td>
                <td className="px-3 py-2 text-xs">{policy.creditBased}</td>
                <td className="px-3 py-2 text-xs">{policy.version}</td>
                <td className="px-3 py-2 text-xs text-muted">{policy.effective}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-muted">
        New versions are added, not edited; superseded versions remain readable for posted records.
      </p>
    </section>
  );

  return (
    <div className="workspace space-y-5 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-cobalt">
            {employee ? 'My leave' : supervisor ? 'My direct reports' : 'Agency leave'} · Example
            Agency
          </p>
          <h1 className="mt-2 text-[28px] font-[760] tracking-[-0.035em] text-midnight">Leave</h1>
          <p className="mt-2 text-sm text-muted">
            Leave year 2026 · Asia/Manila · {completed ? 'Posted sample set' : 'Open period'}
          </p>
        </div>
        <p className="text-xs text-muted">Signed in as {role} · synthetic scope</p>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <nav className="flex flex-wrap gap-1" aria-label="Leave records">
          {sections.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setSection(item)}
              aria-current={activeSection === item ? 'page' : undefined}
              className={`cursor-pointer rounded-[3px] px-3 py-2 text-xs font-[680] ${activeSection === item ? 'bg-midnight text-paper' : 'text-muted hover:bg-canvas hover:text-ink'}`}
            >
              {item === 'Leave applications' ? 'Applications' : item}
            </button>
          ))}
        </nav>
        {activeSection === 'Leave applications' && (
          <div
            className="flex items-center gap-1 rounded-[3px] border border-line bg-paper p-1"
            aria-label="Record view"
          >
            {(['tree', 'form', 'kanban'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={view === mode}
                onClick={() =>
                  navigation.navigate({ view: mode, selected: record.id, variant: null })
                }
                className={`cursor-pointer rounded-[2px] px-3 py-1.5 text-xs font-[650] ${view === mode ? 'bg-canvas text-ink' : 'text-muted'}`}
              >
                {mode[0]!.toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>
      {activeSection === 'Leave applications' && view !== 'form' && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap gap-3">
            <label className="text-xs text-muted">
              Search
              <input
                className={field}
                value={query}
                placeholder="Reference, employee, leave type or date"
                onChange={(e) => setQuery((e.target as unknown as { value: string }).value)}
              />
            </label>
            <label className="text-xs text-muted">
              Status
              <select
                className={field}
                value={statusFilter}
                onChange={(e) => setStatusFilter((e.target as unknown as { value: string }).value)}
              >
                {['All statuses', ...statusOrder].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          <span className="text-xs text-muted">
            {scenario === 'Empty' ? 0 : records.length} applications · leave year 2026
          </span>
        </div>
      )}
      <p role="status" className="text-sm text-cobalt">
        {notice}
      </p>
      {scenario === 'Permission denied' ? (
        <section className={panel}>
          <h2 className="font-semibold">You cannot view these leave records</h2>
          <p className="mt-2 text-sm">
            Your active Agency Membership does not include access to this scope. Contact your Agency
            administrator.
          </p>
        </section>
      ) : scenario === 'Loading' ? (
        <section className={panel} aria-busy="true">
          <p>Loading leave records…</p>
          <p className="mt-2 text-sm text-muted">
            Simulated loading state. Change the sample state below to continue.
          </p>
        </section>
      ) : scenario === 'Empty' ? (
        <section className={panel}>
          <h2 className="font-semibold">No leave records in this scope</h2>
          <p className="mt-2 text-sm">
            {employee
              ? 'Start an application to prepare leave. Nothing is posted until the route is complete.'
              : 'Confirm the leave year and scope, then check the certification and posting queues.'}
          </p>
        </section>
      ) : activeSection === 'Leave credits' ? (
        credits
      ) : activeSection === 'Monetization' ? (
        monetizationView
      ) : activeSection === 'Mandatory leave' ? (
        mandatoryView
      ) : activeSection === 'Leave policy' ? (
        policyView
      ) : view === 'form' ? (
        application
      ) : (
        <section className={panel}>
          <div className="mb-4 grid gap-1">
            <h2 className="m-0 text-[17px] font-[720] tracking-[-0.02em] text-midnight">
              Leave applications
            </h2>
            <p className="m-0 text-[13px] leading-[1.55] text-muted">
              {view === 'tree'
                ? 'Open an application to prepare it or to inspect credits, evidence, certification and decisions.'
                : 'The same applications grouped by status. Open a card to review its Form.'}
            </p>
          </div>
          {view === 'tree' ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1020px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line text-[10px] font-bold uppercase tracking-[0.07em] text-muted">
                    {[
                      'Reference',
                      'Employee',
                      'Leave type',
                      'Dates',
                      'Days',
                      'Status',
                      'Pending with',
                      'Ledger',
                    ].map((heading) => (
                      <th key={heading} scope="col" className="px-3 py-2">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.map((candidate) => (
                    <tr
                      key={candidate.id}
                      className={`border-b border-line/70 align-top ${selected === candidate.index ? 'bg-[#f1f5fb]' : ''}`}
                    >
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="cursor-pointer rounded-[2px] text-left font-mono text-xs font-[680] text-cobalt underline-offset-2 hover:underline"
                          onClick={() => openRecord(candidate.index)}
                        >
                          {candidate.id}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-sm">
                        {candidate.employee}
                        <span className="block text-xs text-muted">{candidate.position}</span>
                      </td>
                      <td className="px-3 py-2 text-[13px]">{candidate.type}</td>
                      <td className="px-3 py-2 text-[13px]">{candidate.dates}</td>
                      <td className="px-3 py-2 font-mono text-xs">{candidate.days}</td>
                      <td className="px-3 py-2">
                        <Status>{displayStatus(candidate)}</Status>
                      </td>
                      <td className="px-3 py-2 text-[13px]">{pendingWith(candidate)}</td>
                      <td className="px-3 py-2 text-xs">{ledgerEffect(candidate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {records.length === 0 && (
                <p className="py-6 text-center text-sm text-muted">
                  No leave applications match these filters.
                </p>
              )}
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2" aria-label="Leave board">
              {statusOrder
                .filter(
                  (value) =>
                    value !== 'CANCEL_REQUESTED' ||
                    records.some((candidate) => displayStatus(candidate) === 'CANCEL_REQUESTED'),
                )
                .map((value) => {
                  const cards = records.filter((candidate) => displayStatus(candidate) === value);
                  return (
                    <section
                      key={value}
                      className="grid min-w-[230px] flex-1 content-start gap-2 rounded-[3px] border border-line bg-canvas/60 p-3"
                    >
                      <h3 className="m-0 flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
                        {value.replaceAll('_', ' ')}
                        <span className="rounded-full border border-line bg-paper px-2 py-0.5 text-[10px] text-ink">
                          {cards.length}
                        </span>
                      </h3>
                      {cards.length === 0 ? (
                        <p className="m-0 rounded-[3px] border border-dashed border-line px-3 py-4 text-center text-xs text-muted">
                          No applications
                        </p>
                      ) : (
                        cards.map((candidate) => (
                          <button
                            key={candidate.id}
                            type="button"
                            onClick={() => openRecord(candidate.index)}
                            className={`grid cursor-pointer gap-1.5 rounded-[3px] border bg-paper px-3 py-3 text-left transition-colors ${selected === candidate.index ? 'border-cobalt bg-[#f1f5fb]' : 'border-line hover:border-[#aebed3]'}`}
                          >
                            <span className="font-mono text-xs font-bold text-cobalt">
                              {candidate.id}
                            </span>
                            <strong className="text-sm font-[680] text-midnight">
                              {candidate.employee}
                            </strong>
                            <span className="text-xs text-muted">
                              {candidate.type} · {candidate.dates}
                            </span>
                            <span className="text-xs">{pendingWith(candidate)}</span>
                            <span className="text-xs text-muted">{ledgerEffect(candidate)}</span>
                          </button>
                        ))
                      )}
                    </section>
                  );
                })}
            </div>
          )}
        </section>
      )}
      <details
        aria-label="Prototype review controls"
        className="rounded border border-line bg-paper p-4 text-sm"
      >
        <summary className="cursor-pointer font-semibold">
          Leave prototype · Synthetic records · No changes are saved
        </summary>
        <div className="mt-3 flex flex-wrap gap-4">
          <label>
            Preview role
            <select
              className={field}
              value={role}
              onChange={(e) => {
                setRole((e.target as unknown as { value: string }).value);
                setSection('Leave applications');
                setDecision('PENDING');
                setNotice('');
              }}
            >
              <option>Employee</option>
              <option>Supervisor</option>
              <option>Leave Administrator</option>
              <option>Approving Official</option>
            </select>
          </label>
          <label>
            Sample state
            <select
              className={field}
              value={scenario}
              onChange={(e) => selectScenario((e.target as unknown as { value: string }).value)}
            >
              {[
                'Active',
                'Empty',
                'Loading',
                'Permission denied',
                'Returned',
                'Cancellation requested',
                'Completed',
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
      </details>
      <details className={`${panel} text-sm`}>
        <summary className="cursor-pointer font-semibold">Review notes and visible state</summary>
        <p className="mt-3">
          Review: does the standard Tree/Form/Kanban pattern keep the application lifecycle separate
          from the effective credit ledger, while letting an Employee prepare leave and HR and
          approvers inspect credits, evidence, certification and decisions?
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            Role selection previews synthetic scopes only. Real authentication and the existing
            Agency shell remain in place.
          </li>
          <li>
            Leave types, eligibility, accrual, retention and mandatory-leave conditions belong to
            “Define leave policy and credit contracts”. No government rule is established here.
          </li>
          <li>
            Routing, evidence requirements, certification meaning, cancellation and posting
            prerequisites belong to “Define leave application and approval contracts”.
          </li>
          <li>
            Posting effects on payroll, monetization payout and terminal-leave inputs belong to
            “Define leave financial handoffs”.
          </li>
          <li>
            Unapproved and unposted applications never change the posted balance. Approved but
            unposted leave is shown separately.
          </li>
          <li>
            JO/COS self-service and full retirement-benefit computation are outside this prototype.
          </li>
        </ul>
        <pre className="mt-4 overflow-auto rounded bg-canvas p-3 text-xs">
          {JSON.stringify(
            {
              view,
              role,
              scenario,
              section: activeSection,
              selected: record.id,
              employee: record.employee,
              displayedStatus: status,
              decision,
              draftSaved,
              evidenceAttached: draftEvidence,
              postedBalance: accounts
                .filter((account) => account.employee === record.employee)
                .map((account) => `${account.type}: ${account.posted}`),
              ledgerEffect: ledgerEffect(record),
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
}
