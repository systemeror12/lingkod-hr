// PROTOTYPE fixture data. In-memory only; shapes loosely follow the real session,
// navigation, and employee contracts so the variants feel populated.

export const agency = {
  name: 'Reference Agency — Central Office',
  acronym: 'RA-CO',
};

export const viewer = {
  displayName: 'Maria Teresa Dizon',
  roles: ['HR Administrator', 'Leave Administrator'],
};

export type Stage =
  'Structure' | 'Merit selection' | 'Personnel' | 'Time & attendance' | 'Leave' | 'Oversight';

export interface NavItem {
  href: string;
  label: string;
  stage: Stage;
  count?: number;
}

// Same destinations as lib/navigation.ts, grouped by lifecycle stage.
export const nav: NavItem[] = [
  { href: '/organization', label: 'Organization', stage: 'Structure' },
  { href: '/staffing-authorities', label: 'Staffing Authorities', stage: 'Structure' },
  { href: '/qualification-standards', label: 'Qualification Standards', stage: 'Structure' },
  { href: '/plantilla-positions', label: 'Plantilla Positions', stage: 'Structure' },
  { href: '/recruitment', label: 'Recruitment', stage: 'Merit selection', count: 3 },
  { href: '/appointments', label: 'Appointments', stage: 'Merit selection', count: 1 },
  { href: '/employees', label: 'Employees', stage: 'Personnel' },
  { href: '/personnel-baselines', label: 'Personnel Baselines', stage: 'Personnel' },
  { href: '/personnel-actions', label: 'Personnel Actions', stage: 'Personnel', count: 2 },
  { href: '/service-records', label: 'Service Records', stage: 'Personnel' },
  { href: '/attendance', label: 'Attendance', stage: 'Time & attendance' },
  {
    href: '/attendance-configuration',
    label: 'Attendance Configuration',
    stage: 'Time & attendance',
  },
  { href: '/attendance-contexts', label: 'Attendance Contexts', stage: 'Time & attendance' },
  { href: '/attendance-days', label: 'Attendance Days', stage: 'Time & attendance' },
  {
    href: '/attendance-corrections',
    label: 'Attendance Corrections',
    stage: 'Time & attendance',
    count: 4,
  },
  { href: '/attendance-dtrs', label: 'Daily Time Records', stage: 'Time & attendance' },
  {
    href: '/attendance-periods',
    label: 'Attendance Periods',
    stage: 'Time & attendance',
    count: 1,
  },
  { href: '/leave-policies', label: 'Leave Policies', stage: 'Leave' },
  { href: '/leave-accounts', label: 'Leave Accounts', stage: 'Leave' },
  { href: '/leave-applications', label: 'Leave Applications', stage: 'Leave', count: 5 },
  { href: '/leave-monetization', label: 'Leave Monetization', stage: 'Leave' },
  { href: '/terminal-leave-inputs', label: 'Terminal Leave Inputs', stage: 'Leave' },
  { href: '/users-access', label: 'Users & Access', stage: 'Oversight' },
  { href: '/audit', label: 'Audit Log', stage: 'Oversight' },
];

export const stages: Stage[] = [
  'Structure',
  'Merit selection',
  'Personnel',
  'Time & attendance',
  'Leave',
  'Oversight',
];

export type Tone = 'waiting' | 'action' | 'returned' | 'done';

export interface WorkItem {
  id: string;
  kind: string;
  subject: string;
  employee: string;
  state: string;
  tone: Tone;
  action: string;
  age: string;
  /** Documented status path for this record type; `state` marks the current step. */
  route: string[];
  detail: { label: string; value: string }[];
}

export const queue: WorkItem[] = [
  {
    id: 'LA-2026-0412',
    route: [
      'SUBMITTED',
      'FOR_CERTIFICATION',
      'FOR_RECOMMENDATION',
      'FOR_APPROVAL',
      'APPROVED',
      'POSTED',
    ],
    kind: 'Leave application',
    subject: 'Vacation leave, 5 days (Oct 6–10)',
    employee: 'Ramon C. Villanueva',
    state: 'FOR_CERTIFICATION',
    tone: 'action',
    action: 'Certify credits',
    age: '2 days',
    detail: [
      { label: 'Posted VL balance', value: '14.625 days' },
      { label: 'Active commitments', value: '0.000 days' },
      { label: 'Requested', value: '5.000 days' },
      { label: 'Eligibility', value: 'ELIGIBLE' },
      { label: 'Ledger cutoff', value: 'Sep 30, 2026' },
    ],
  },
  {
    id: 'LA-2026-0409',
    route: [
      'SUBMITTED',
      'FOR_CERTIFICATION',
      'FOR_RECOMMENDATION',
      'FOR_APPROVAL',
      'APPROVED',
      'POSTED',
    ],
    kind: 'Leave application',
    subject: 'Sick leave, 2 days (Sep 22–23)',
    employee: 'Liza M. Santos',
    state: 'FOR_CERTIFICATION',
    tone: 'action',
    action: 'Certify credits',
    age: '4 days',
    detail: [
      { label: 'Posted SL balance', value: '31.250 days' },
      { label: 'Requested', value: '2.000 days' },
      { label: 'Medical certificate', value: 'Attached, version 1' },
      { label: 'Eligibility', value: 'ELIGIBLE' },
    ],
  },
  {
    id: 'AP-2026-09A',
    route: ['FOR_REVIEW', 'APPROVED', 'LOCKED'],
    kind: 'Attendance period',
    subject: 'September 1–15, 2026 · 142 employees',
    employee: 'Central Office',
    state: 'APPROVED',
    tone: 'action',
    action: 'Lock period',
    age: '1 day',
    detail: [
      { label: 'Approved by', value: 'Jose P. Ramirez' },
      { label: 'Submissions', value: '142 of 142 approved' },
      { label: 'Open exceptions', value: 'None' },
      { label: 'Reconciliation', value: 'Not yet run' },
    ],
  },
  {
    id: 'PA-2026-0077',
    route: ['DRAFT', 'FOR_REVIEW', 'FOR_APPROVAL', 'APPROVED', 'EFFECTIVE'],
    kind: 'Personnel action',
    subject: 'Step increment, SG 15 step 2 → 3',
    employee: 'Andrea L. Bautista',
    state: 'FOR_REVIEW',
    tone: 'waiting',
    action: 'Review',
    age: '6 days',
    detail: [
      { label: 'Effective date', value: 'Oct 1, 2026' },
      { label: 'Authority', value: 'Length of service, 3 years' },
      { label: 'Salary', value: '₱38,413 → ₱38,839 monthly' },
    ],
  },
  {
    id: 'AC-2026-0231',
    route: ['SUBMITTED', 'NEEDS_INFORMATION', 'APPROVED', 'APPLIED'],
    kind: 'Attendance correction',
    subject: 'Missing time-out, Sep 18',
    employee: 'Carlo D. Mendoza',
    state: 'NEEDS_INFORMATION',
    tone: 'returned',
    action: 'Awaiting employee',
    age: '3 days',
    detail: [
      { label: 'Information requested', value: 'Attach the guard logbook entry.' },
      { label: 'Requested by', value: 'Maria Teresa Dizon' },
    ],
  },
  {
    id: 'RQ-2026-0019',
    route: [
      'RECEIVED',
      'QUALIFIED',
      'FOR_ASSESSMENT',
      'FOR_INTERVIEW',
      'FOR_DELIBERATION',
      'RECOMMENDED',
      'SELECTED',
    ],
    kind: 'Recruitment',
    subject: 'Administrative Officer IV · Item ADOF4-8-2019',
    employee: 'HRMPSB',
    state: 'FOR_ASSESSMENT',
    tone: 'waiting',
    action: 'Open assessment',
    age: '9 days',
    detail: [
      { label: 'Applicants', value: '11 received, 7 qualified' },
      { label: 'Publication closed', value: 'Sep 17, 2026' },
    ],
  },
];

export interface Employee {
  id: string;
  employeeNumber: string;
  legalName: string;
  position: string;
  salaryGrade: string;
  unit: string;
  itemNumber: string;
  status: 'ACTIVE' | 'ON_LEAVE' | 'SUSPENDED' | 'SEPARATED';
  appointment: string;
  since: string;
}

export const employees: Employee[] = [
  {
    id: 'e1',
    employeeNumber: '2014-0031',
    legalName: 'Andrea L. Bautista',
    position: 'Administrative Officer IV',
    salaryGrade: 'SG 15-2',
    unit: 'Human Resource Management Division',
    itemNumber: 'ADOF4-3-2014',
    status: 'ACTIVE',
    appointment: 'Permanent',
    since: 'Mar 3, 2014',
  },
  {
    id: 'e2',
    employeeNumber: '2019-0114',
    legalName: 'Ramon C. Villanueva',
    position: 'Information Systems Analyst II',
    salaryGrade: 'SG 15-1',
    unit: 'Management Information Systems Division',
    itemNumber: 'INFOSA2-1-2019',
    status: 'ACTIVE',
    appointment: 'Permanent',
    since: 'Jul 15, 2019',
  },
  {
    id: 'e3',
    employeeNumber: '2011-0008',
    legalName: 'Liza M. Santos',
    position: 'Accountant III',
    salaryGrade: 'SG 19-4',
    unit: 'Accounting Division',
    itemNumber: 'A3-2-2011',
    status: 'ON_LEAVE',
    appointment: 'Permanent',
    since: 'Jan 10, 2011',
  },
  {
    id: 'e4',
    employeeNumber: '2022-0203',
    legalName: 'Carlo D. Mendoza',
    position: 'Administrative Assistant II',
    salaryGrade: 'SG 8-1',
    unit: 'General Services Division',
    itemNumber: 'ADAS2-7-2022',
    status: 'ACTIVE',
    appointment: 'Temporary',
    since: 'Feb 1, 2022',
  },
  {
    id: 'e5',
    employeeNumber: '2008-0002',
    legalName: 'Jose P. Ramirez',
    position: 'Supervising Administrative Officer',
    salaryGrade: 'SG 22-6',
    unit: 'Human Resource Management Division',
    itemNumber: 'SADOF-1-2008',
    status: 'ACTIVE',
    appointment: 'Permanent',
    since: 'Jun 2, 2008',
  },
  {
    id: 'e6',
    employeeNumber: '2017-0090',
    legalName: 'Grace A. Pascual',
    position: 'Records Officer II',
    salaryGrade: 'SG 14-2',
    unit: 'Records Section',
    itemNumber: 'RO2-1-2017',
    status: 'SUSPENDED',
    appointment: 'Permanent',
    since: 'Sep 4, 2017',
  },
  {
    id: 'e7',
    employeeNumber: '2020-0141',
    legalName: 'Nestor R. Aquino',
    position: 'Driver II',
    salaryGrade: 'SG 4-2',
    unit: 'General Services Division',
    itemNumber: 'DRV2-4-2020',
    status: 'ACTIVE',
    appointment: 'Permanent',
    since: 'Nov 16, 2020',
  },
  {
    id: 'e8',
    employeeNumber: '2005-0019',
    legalName: 'Estela V. Navarro',
    position: 'Chief Administrative Officer',
    salaryGrade: 'SG 24-8',
    unit: 'Administrative Division',
    itemNumber: 'CADOF-1-2005',
    status: 'SEPARATED',
    appointment: 'Permanent',
    since: 'Aug 1, 2005',
  },
];

export interface ServiceEvent {
  from: string;
  to: string | null;
  designation: string;
  status: string;
  salary: string;
  action: string;
}

// Effective-dated history for the featured employee (Andrea L. Bautista).
export const serviceRecord: ServiceEvent[] = [
  {
    from: 'Oct 1, 2026',
    to: null,
    designation: 'Administrative Officer IV',
    status: 'Permanent',
    salary: '₱38,839',
    action: 'Step increment (pending approval)',
  },
  {
    from: 'Oct 1, 2023',
    to: 'Sep 30, 2026',
    designation: 'Administrative Officer IV',
    status: 'Permanent',
    salary: '₱38,413',
    action: 'Step increment',
  },
  {
    from: 'Jan 16, 2020',
    to: 'Sep 30, 2023',
    designation: 'Administrative Officer IV',
    status: 'Permanent',
    salary: '₱36,628',
    action: 'Promotion',
  },
  {
    from: 'Mar 3, 2014',
    to: 'Jan 15, 2020',
    designation: 'Administrative Officer II',
    status: 'Permanent',
    salary: '₱24,316',
    action: 'Original appointment',
  },
];

export const leaveBalances = [
  { type: 'Vacation leave', posted: '18.250', committed: '0.000' },
  { type: 'Sick leave', posted: '42.500', committed: '0.000' },
  { type: 'Special privilege leave', posted: '2.000', committed: '1.000' },
];

export const recordSections = [
  'Summary',
  'Personal Data Sheet',
  'Service record',
  'Leave card',
  'Daily time records',
  'Documents',
  'Government IDs',
  'SALN',
];

export interface Activity {
  at: string;
  actor: string;
  summary: string;
  note?: string;
}

// Audit-style history for the featured employee, newest first.
export const activity: Activity[] = [
  {
    at: 'Sep 20, 2026, 10:42',
    actor: 'Jose P. Ramirez',
    summary: 'Submitted personnel action PA-2026-0077 for review',
    note: 'Step increment, SG 15 step 2 to 3, effective Oct 1, 2026.',
  },
  {
    at: 'Sep 2, 2026, 15:08',
    actor: 'Andrea L. Bautista',
    summary: 'Uploaded a new version of the Personal Data Sheet',
  },
  {
    at: 'Jul 31, 2026, 09:15',
    actor: 'Maria Teresa Dizon',
    summary: 'Posted leave ledger entry: vacation leave, 3.000 days',
  },
  {
    at: 'Apr 30, 2026, 16:20',
    actor: 'Records Section',
    summary: 'Recorded SALN filing for calendar year 2025',
  },
  {
    at: 'Oct 1, 2023, 08:00',
    actor: 'System',
    summary: 'Personnel action PA-2023-0112 became effective',
    note: 'Step increment, SG 15 step 1 to 2.',
  },
];

export const documents = [
  { name: 'Personal Data Sheet (CS Form 212)', version: 'Version 4', date: 'Sep 2, 2026' },
  { name: 'Appointment, Administrative Officer IV', version: 'Issued', date: 'Jan 16, 2020' },
  { name: 'Oath of Office', version: 'Issued', date: 'Jan 16, 2020' },
  { name: 'Certificate of Assumption to Duty', version: 'Issued', date: 'Jan 16, 2020' },
  { name: 'SALN, calendar year 2025', version: 'Filed', date: 'Apr 30, 2026' },
];
