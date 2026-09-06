'use client';

// Throwaway Tree, Form and Kanban views of one Recruitment Case at ?variant=A|B|C.
import { useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { PrototypeSwitcher } from '../../../../components/prototype-switcher';
import styles from './prototype.module.css';

const variants = { A: 'Tree view', B: 'Form view', C: 'Kanban' };
const menus = {
  requests: 'Requests to Fill',
  publications: 'Publications',
  applications: 'Applications',
  sessions: 'HRMPSB Sessions',
  decisions: 'Selection Decisions',
};
type Menu = keyof typeof menus;
const stages = [
  'Request to Fill',
  'Publication',
  'Applicant evaluation',
  'HRMPSB deliberation',
  'Selection Decision',
] as const;
const scenarios = {
  review: {
    label: 'Request under review',
    stage: 0,
    status: 'For review',
    note: 'HRMO review is pending. Publication is not yet available.',
  },
  returned: {
    label: 'Request returned',
    stage: 0,
    status: 'Returned',
    note: 'Return R-02: attach the vacancy authority evidence. The original submission remains in history.',
  },
  rejected: {
    label: 'Request rejected',
    stage: 0,
    status: 'Rejected',
    note: 'Decision AD-02: the vacancy authority could not be established. This request cannot proceed.',
  },
  blocked: {
    label: 'Agency configuration missing',
    stage: 0,
    status: 'Blocked',
    note: 'No active Agency Merit Selection Plan, criteria, Board Appointments, or Approval Routes have been evidenced. Publication is blocked.',
  },
  publication: {
    label: 'Publication open',
    stage: 1,
    status: 'Accepting applications',
    note: 'Publication PUB-026-01 is open. Deliberation is unavailable while publication and screening are incomplete.',
  },
  evaluation: {
    label: 'Applicant evaluation',
    stage: 2,
    status: 'Evaluation in progress',
    note: 'Screening is complete. Assessments and interviews are being recorded against the bound criteria.',
  },
  board: {
    label: 'Board deliberation',
    stage: 3,
    status: 'For deliberation',
    note: 'Review applicant-specific participation and conflicts before recording the Board Recommendation.',
  },
  decision: {
    label: 'Authority review',
    stage: 4,
    status: 'Awaiting Selection Decision',
    note: 'The Board Recommendation is advisory. The appointing authority has not selected an applicant.',
  },
  selectionReturned: {
    label: 'Selection returned for review',
    stage: 3,
    status: 'Returned for further review',
    note: 'SR-01: the appointing authority requests clarification of assessment evidence. Prior board output is retained.',
  },
  selected: {
    label: 'Candidate selected',
    stage: 4,
    status: 'Selected',
    note: 'SD-026-01 selects Ana Reyes. Appointment preparation is a separate handoff; no Appointment has been issued.',
  },
  noSelection: {
    label: 'No selection',
    stage: 4,
    status: 'No selection',
    note: 'SD-026-02 records no selection with an evidenced reason. A new recruitment attempt must retain this decision.',
  },
  cancelled: {
    label: 'Publication cancelled',
    stage: 1,
    status: 'Cancelled',
    note: 'PUB-026-01 was cancelled because its qualification information was materially incorrect. Applications and evidence remain retained.',
  },
  republished: {
    label: 'Vacancy republished',
    stage: 1,
    status: 'Republished',
    note: 'PUB-026-02 replaces cancelled PUB-026-01. The corrected publication has new dates and explicit lineage.',
  },
};
type Scenario = keyof typeof scenarios;
const applicants = [
  {
    id: 'APP-001',
    name: 'Ana Reyes',
    source: 'External applicant',
    screening: 'Qualified',
    evidence: 'Complete',
    assessment: 'Recorded · v1',
    interview: '04 Sep · completed',
    note: 'Education, training, experience and eligibility evidence satisfy the bound Qualification Standard in this mock.',
  },
  {
    id: 'APP-002',
    name: 'Miguel Santos',
    source: 'Internal applicant',
    screening: 'Qualified',
    evidence: 'Complete',
    assessment: 'Recorded · v2',
    interview: '04 Sep · completed',
    note: 'Assessment v2 replaces v1 with a recorded correction reason and evidence. Both versions are retained.',
  },
  {
    id: 'APP-003',
    name: 'Bea Cruz',
    source: 'External applicant',
    screening: 'Qualified',
    evidence: 'Complete',
    assessment: 'Recorded · v1',
    interview: '04 Sep · completed',
    note: 'One board member declared a conflict for this applicant and is excluded from her deliberation and quorum.',
  },
  {
    id: 'APP-004',
    name: 'Paolo Mendoza',
    source: 'External applicant',
    screening: 'Qualified',
    evidence: 'Complete',
    assessment: 'Recorded · v1',
    interview: '04 Sep · completed',
    note: 'Qualification and assessment evidence are ready for board review.',
  },
  {
    id: 'APP-005',
    name: 'Liza Navarro',
    source: 'Internal applicant',
    screening: 'Qualified',
    evidence: 'Complete',
    assessment: 'Recorded · v1',
    interview: '04 Sep · completed',
    note: 'Qualification and assessment evidence are ready for board review.',
  },
  {
    id: 'APP-006',
    name: 'Carlo Garcia',
    source: 'External applicant',
    screening: 'Not qualified',
    evidence: 'Experience insufficient',
    assessment: 'Not applicable',
    interview: 'Not applicable',
    note: 'Screening SC-006 records insufficient relevant experience under the bound Qualification Standard. Notice and review history are retained.',
  },
];
const members = [
  ['Elena Ramos', 'Chair', 'Present', 'None declared'],
  ['Jose Lim', 'HRMO representative', 'Present', 'None declared'],
  ['Rosa Diaz', 'Requesting office', 'Present', 'Recused for Bea Cruz'],
  ['Luis Torres', 'Employee representative', 'Present', 'None declared'],
  ['Nina Flores', 'Board member', 'Absent', 'Declaration pending'],
];
const bindings = {
  plan: 'Mock MSP v2',
  criteria: 'Mock criteria v3',
  board: 'Mock Board Definition v1',
  appointments: 'Mock Office Order 2026-014',
  route: 'Mock Approval Route v1',
  qualification: 'Mock QS-AO2 v1',
  position: 'Mock position version v3',
};
const documents = [
  [
    'Request to Fill',
    'RTF-026-014 · v1',
    'Submitted 17 Aug 2026; Requesting Office. Vacancy authority and position version attached.',
  ],
  [
    'Publication',
    'CS Form No. 9, Revised 2025 · document v1',
    'Mock publication package, posting evidence, channel timestamps, and HRMO certification. This preview does not reproduce the official form.',
  ],
  [
    'Qualification evidence',
    'Application evidence bundle · v1',
    'Mock diploma, training certificates, service certificates, eligibility evidence and screening reasons.',
  ],
  [
    'Board output',
    'CCER-026-01 · v1',
    'Mock Comprehensive Candidate Evaluation Report and Board Recommendation. Advisory output only.',
  ],
  [
    'Selection Decision',
    'SD-026-01 · v1',
    'Mock appointing-authority decision, reason, authority reference, selected Application and exact evidence-version links.',
  ],
] as const;

export function RecruitmentCasePrototype() {
  const router = useRouter();
  const params = useSearchParams();
  const query = params.get('variant');
  const requestedMenu = params.get('section') ?? 'applications';
  const menu: Menu = Object.hasOwn(menus, requestedMenu) ? (requestedMenu as Menu) : 'applications';
  const availableViews = menu === 'applications' ? variants : { A: 'Tree view', B: 'Form view' };
  const variant = query === 'B' ? 'B' : query === 'C' && menu === 'applications' ? 'C' : 'A';
  const [scenario, setScenario] = useState<Scenario>('board');
  const [stage, setStage] = useState(3);
  const applicantId = applicants.some((person) => person.id === params.get('record'))
    ? params.get('record')!
    : 'APP-001';
  const [document, setDocument] = useState<number | null>(null);
  const evidenceInvoker = useRef<{ focus(): void } | null>(null);
  const [handoff, setHandoff] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const inspectApplicant = menu === 'applications';
  const [search, setSearch] = useState('');
  const [notes, setNotes] = useState<Record<string, { draft: string; saved: string }>>({});
  const recordId = inspectApplicant
    ? applicantId
    : menu === 'requests'
      ? 'RTF-026-014'
      : menu === 'publications'
        ? scenario === 'republished'
          ? 'PUB-026-02'
          : 'PUB-026-01'
        : menu === 'sessions'
          ? 'BS-026-04'
          : scenario === 'noSelection'
            ? 'SD-026-02'
            : scenario === 'selectionReturned'
              ? 'SR-01'
              : 'SD-026-01';
  const workingNote = notes[recordId]?.draft ?? '';
  const savedNote = notes[recordId]?.saved ?? '';
  function setWorkingNote(draft: string) {
    setNotes((current) => ({
      ...current,
      [recordId]: { draft, saved: current[recordId]?.saved ?? '' },
    }));
  }
  function setSavedNote(saved: string) {
    setNotes((current) => ({ ...current, [recordId]: { draft: saved, saved } }));
  }
  const applicantForm = variant === 'B' && inspectApplicant;
  const snapshot = scenarios[scenario];
  const applicant = applicants.find((person) => person.id === applicantId)!;
  const published = !['review', 'returned', 'rejected', 'blocked'].includes(scenario);
  const evaluated = snapshot.stage >= 2;
  const boardOutput = snapshot.stage === 4 || scenario === 'selectionReturned';
  const selected = scenario === 'selected';
  const republication = scenario === 'republished';

  function loadScenario(value: Scenario) {
    setScenario(value);
    if (!inspectApplicant) setStage(scenarios[value].stage === 2 ? 0 : scenarios[value].stage);
    setDocument(null);
    setHandoff(false);
  }

  function changeView(view: string) {
    const next = new URLSearchParams(params.toString());
    next.set('variant', view);
    router.replace(`/prototype/recruitment-case?${next}`, { scroll: false });
  }

  function navigate(menuKey: Menu, view = 'A', record?: string) {
    const next = new URLSearchParams(params.toString());
    next.set('section', menuKey);
    next.set('variant', view);
    if (record) next.set('record', record);
    else next.delete('record');
    setStage(2);
    setDocument(null);
    router.replace(`/prototype/recruitment-case?${next}`, { scroll: false });
  }

  function openApplicant(id: string) {
    navigate('applications', 'B', id);
  }

  const visibleApplicants = published
    ? applicants.filter((person) =>
        `${person.name} ${person.id}`.toLowerCase().includes(search.toLowerCase()),
      )
    : [];
  const lanes = [
    'Screening',
    'Assessment & interview',
    'Board review',
    'Selection',
    'Not qualified',
  ];
  function applicantLane(person: (typeof applicants)[number]) {
    if (!evaluated) return 0;
    if (person.screening === 'Not qualified') return 4;
    if (snapshot.stage === 4) return 3;
    return snapshot.stage === 3 ? 2 : 1;
  }
  function applicationStanding(person: (typeof applicants)[number]) {
    const lane = applicantLane(person);
    if (lane !== 3) return lanes[lane];
    if (scenario === 'noSelection') return 'No selection';
    if (selected) return person.id === 'APP-001' ? 'Selected' : 'Not selected';
    return 'Awaiting Selection Decision';
  }
  const menuStage = { requests: 0, publications: 1, applications: 2, sessions: 3, decisions: 4 }[
    menu
  ];
  const hasRecord =
    menu === 'requests' ||
    (menu === 'applications' && published) ||
    (menu === 'publications' && published) ||
    (menu === 'sessions' && snapshot.stage >= 3) ||
    (menu === 'decisions' &&
      (selected || scenario === 'noSelection' || scenario === 'selectionReturned'));
  const recordStatus =
    menu === 'requests'
      ? published
        ? 'Approved'
        : snapshot.status
      : menu === 'publications'
        ? scenario === 'cancelled'
          ? 'Cancelled'
          : scenario === 'publication' || republication
            ? 'Open'
            : 'Application period elapsed'
        : menu === 'sessions'
          ? boardOutput
            ? 'Board output recorded'
            : 'For deliberation'
          : snapshot.status;

  const context = (
    <dl className={styles.facts}>
      <div>
        <dt>Plantilla Position</dt>
        <dd>OSEC-REF-ADOF2-014-2026</dd>
      </div>
      <div>
        <dt>Requesting Office</dt>
        <dd>Administrative Service / HR Division</dd>
      </div>
      <div>
        <dt>Position context</dt>
        <dd>SG 11 · Permanent · One vacancy</dd>
      </div>
      <div>
        <dt>Recruitable Vacancy</dt>
        <dd>
          {scenario === 'rejected'
            ? 'Authority not established'
            : selected
              ? 'Reserved for selected Application'
              : 'Verified in mock snapshot'}
        </dd>
      </div>
    </dl>
  );

  function evidence(index: number) {
    return (
      <Button
        variant="secondary"
        size="default"
        onClick={(event) => {
          evidenceInvoker.current = event.currentTarget as unknown as { focus(): void };
          setDocument(index);
        }}
      >
        Inspect {documents[index]![0].toLowerCase()}
      </Button>
    );
  }

  const candidateDetail = (
    <section className={styles.dossier} aria-label="Applicant dossier">
      <p className={styles.eyebrow}>
        {applicant.id} · {applicant.source}
      </p>
      <h3>{applicant.name}</h3>
      <p>
        {evaluated
          ? applicant.note
          : 'Application evidence and screening outcomes are not finalized in this scenario.'}
      </p>
      <dl className={styles.facts}>
        <div>
          <dt>Qualification screening</dt>
          <dd>{evaluated ? applicant.screening : 'Pending'}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>{evaluated ? applicant.evidence : 'Awaiting review'}</dd>
        </div>
        <div>
          <dt>Assessment Result Version</dt>
          <dd>{evaluated ? applicant.assessment : 'Not started'}</dd>
        </div>
        <div>
          <dt>Interview</dt>
          <dd>{evaluated ? applicant.interview : 'Not scheduled'}</dd>
        </div>
      </dl>
      <p className={styles.caption}>
        Criteria and scores require an evidenced Agency configuration. This prototype does not
        invent weights, cutoffs or ranking formulas.
      </p>
      {evidence(2)}
    </section>
  );

  function panel(index: number) {
    if (index === 0)
      return (
        <section className={styles.panel}>
          <h2>Request to Fill</h2>
          {context}
          <div className={styles.notice}>
            <strong>Administrative approval</strong>
            <p>
              {published
                ? 'AD-026-01 · Approved 18 Aug 2026 by the mock HRMO reviewer.'
                : `${snapshot.status} · requesting-office submission retained.`}
            </p>
          </div>
          <p>RTF-026-014 · submitted 17 Aug 2026 · prepared by Marisol Santos</p>
          <details>
            <summary>
              Governing versions {published ? '(frozen at publication)' : '(pending publication)'}
            </summary>
            <dl className={styles.facts}>
              {Object.entries(bindings).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>
                    {scenario === 'blocked' ? 'Configurable Placeholder · unresolved' : value}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
          <p className={styles.caption}>
            Agency-specific configuration is illustrative. The Reference Agency Profile has no
            active invented MSP or approval hierarchy.
          </p>
          {evidence(0)}
        </section>
      );
    if (index === 1)
      return (
        <section className={styles.panel}>
          <h2>Vacancy publication</h2>
          <p className={styles.eyebrow}>
            {republication ? 'PUB-026-02 · successor to PUB-026-01' : 'PUB-026-01'}
          </p>
          <dl className={styles.facts}>
            <div>
              <dt>Status</dt>
              <dd>
                {!published
                  ? 'Not published'
                  : scenario === 'cancelled'
                    ? 'Cancelled · retained'
                    : scenario === 'publication' || republication
                      ? 'Open'
                      : 'Application period elapsed'}
              </dd>
            </div>
            <div>
              <dt>Publication / closing dates</dt>
              <dd>
                {!published
                  ? 'Not scheduled'
                  : republication
                    ? '07 Sep – 21 Sep 2026'
                    : '19 Aug – 02 Sep 2026'}
              </dd>
            </div>
            <div>
              <dt>Form</dt>
              <dd>CS Form No. 9, Revised 2025</dd>
            </div>
            <div>
              <dt>Certification</dt>
              <dd>{published ? 'Mock HRMO certification · document v1' : 'Pending'}</dd>
            </div>
          </dl>
          <ul className={styles.rows}>
            {[
              'CSC Field Office submission',
              'CSC Job Portal publication',
              'Agency lobby posting',
              'HR Division noticeboard posting',
              'Regional office noticeboard posting',
              'Agency website (supplemental)',
            ].map((channel) => (
              <li key={channel}>
                <span>{channel}</span>
                <span>{published ? 'Evidence v1 retained' : 'Pending'}</span>
              </li>
            ))}
          </ul>
          <p className={styles.caption}>
            Material changes require cancellation and republication. Exact publication versions,
            timestamps and channel evidence stay with each attempt.
          </p>
          {evidence(1)}
        </section>
      );
    if (index === 3 && !inspectApplicant)
      return (
        <section className={styles.panel}>
          <h2>HRMPSB session · BS-026-04</h2>
          <p>05 Sep 2026 · Mock Board Definition v1 · Roster snapshot v1</p>
          <h3>Session roster and attendance</h3>
          <div className={styles.scroll}>
            <table>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Seat</th>
                  <th>Attendance</th>
                </tr>
              </thead>
              <tbody>
                {members.map(([name, seat, attendance]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{seat}</td>
                    <td>{attendance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.caption}>
            Marisol Santos is non-voting secretariat. Attendance does not establish
            applicant-specific quorum.
          </p>
          <h3>Applicant deliberations</h3>
          <div className={styles.scroll}>
            <table>
              <thead>
                <tr>
                  <th>Application</th>
                  <th>Eligible participation</th>
                  <th>Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {applicants
                  .filter((person) => person.screening === 'Qualified')
                  .map((person) => (
                    <tr key={person.id}>
                      <td>
                        <button
                          className={styles.recordButton}
                          onClick={() => {
                            navigate('applications', 'B', person.id);
                            setStage(3);
                          }}
                        >
                          {person.name}
                        </button>
                        <small>{person.id}</small>
                      </td>
                      <td>{person.id === 'APP-003' ? '3 of 5 · one recusal' : '4 of 5'}</td>
                      <td>
                        {boardOutput && person.id === 'APP-001'
                          ? 'Recommended'
                          : 'No individual recommendation recorded'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      );
    if (index === 3)
      return (
        <section className={styles.panel}>
          <h2>HRMPSB deliberation</h2>
          <p>
            Session BS-026-04 ·{' '}
            {snapshot.stage >= 3 ? '05 Sep 2026 · roster snapshot v1' : 'Not started'}
          </p>
          <p>
            Deliberation for <strong>{applicant.name}</strong> · {applicant.id}
          </p>
          <div className={styles.notice}>
            <strong>
              {snapshot.stage < 3
                ? 'Deliberation unavailable'
                : applicant.screening === 'Not qualified'
                  ? 'Applicant not qualified for deliberation'
                  : `${applicantId === 'APP-003' ? '3' : '4'} eligible participants / 5 board seats`}
            </strong>
            <p>
              {snapshot.stage < 3
                ? 'Publication, screening and required evaluations must be complete.'
                : applicant.screening === 'Not qualified'
                  ? applicant.note
                  : 'Mock quorum requires 3. Attendance and applicant-specific recusals are counted separately.'}
            </p>
          </div>
          <div className={styles.scroll}>
            <table>
              <caption>Board participation for {applicant.name} · mock snapshot</caption>
              <thead>
                <tr>
                  <th>Member / seat</th>
                  <th>Participation</th>
                  <th>Conflict declaration</th>
                </tr>
              </thead>
              <tbody>
                {members.map(([name, seat, attendance, conflict]) => (
                  <tr key={name}>
                    <td>
                      {name}
                      <small>{seat}</small>
                    </td>
                    <td>
                      {snapshot.stage < 3 || applicant.screening === 'Not qualified'
                        ? 'Not recorded for this Application'
                        : name === 'Rosa Diaz' && applicantId === 'APP-003'
                          ? 'Recused · excluded from quorum'
                          : attendance}
                    </td>
                    <td>
                      {snapshot.stage < 3 || applicant.screening === 'Not qualified'
                        ? 'Not recorded'
                        : name === 'Rosa Diaz'
                          ? applicantId === 'APP-003'
                            ? 'Conflict declared for this applicant'
                            : 'None declared for this applicant'
                          : conflict}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.caption}>
            Secretariat: Marisol Santos, non-voting. Mock designations reference Office Order
            2026-014. No person occupies two voting seats.
          </p>
          <h3>Board Recommendation</h3>
          <p>
            {evaluated && applicant.screening === 'Not qualified'
              ? 'Not applicable. This Application did not qualify for deliberation.'
              : boardOutput && applicantId === 'APP-001'
                ? 'BR-026-01 · Recommended for this Application. Advisory only; the Selection Decision is separate.'
                : 'No individual recommendation recorded for this Application in this mock snapshot.'}
          </p>
          {boardOutput && applicantId === 'APP-001' && evidence(3)}
        </section>
      );
    return (
      <section className={styles.panel}>
        <h2>Selection Decision</h2>
        <div className={styles.decision}>
          <p className={styles.eyebrow}>Appointing authority</p>
          <h3>
            {selected
              ? 'Ana Reyes selected'
              : scenario === 'noSelection'
                ? 'No selection recorded'
                : scenario === 'selectionReturned'
                  ? 'Returned for further review'
                  : 'No selection recorded yet'}
          </h3>
          <p>
            {selected
              ? 'SD-026-01 · 06 Sep 2026 · Mock authorized signatory. Decision, reason and authority evidence retained.'
              : scenario === 'noSelection'
                ? 'SD-026-02 · Reason: appointing authority declines to select from this slate. Mock signed decision v1 retained.'
                : scenario === 'selectionReturned'
                  ? snapshot.note
                  : 'The Board Recommendation supports a human decision. It does not appoint anyone.'}
          </p>
        </div>
        <h3>Handoff to Appointment</h3>
        <p>
          {handoff
            ? 'Mock handoff preview opened. No Appointment record was created.'
            : selected
              ? 'The selected-candidate package is ready for separate Appointment preparation.'
              : 'Available only after a Selection Decision identifies an applicant.'}
        </p>
        <Button
          variant="primary"
          size="default"
          disabled={!selected}
          onClick={() => setHandoff(true)}
        >
          Preview selected-candidate package
        </Button>
        {handoff && (
          <dl className={styles.facts}>
            <div>
              <dt>Selection / Application</dt>
              <dd>SD-026-01 / APP-001 · Ana Reyes</dd>
            </div>
            <div>
              <dt>Reserved Plantilla Position</dt>
              <dd>OSEC-REF-ADOF2-014-2026</dd>
            </div>
            <div>
              <dt>Bound evidence</dt>
              <dd>MSP v2 · criteria v3 · QS v1 · publication v1 · CCER v1</dd>
            </div>
            <div>
              <dt>Next owner</dt>
              <dd>Appointment · preparation not yet started</dd>
            </div>
          </dl>
        )}
        <p className={styles.caption}>
          Selection does not establish Appointment, assumption, Employee service or Position
          Incumbency. Recruitment closure follows successful service activation.
        </p>
        {selected && evidence(4)}
      </section>
    );
  }

  return (
    <div className={styles.prototype}>
      <div className={styles.lab}>
        <span>
          <strong>Throwaway UI prototype</strong> · Reference Agency · all people, records and
          agency configuration are mock.
        </span>
        <label>
          Scenario
          <select
            value={scenario}
            onChange={(event) =>
              loadScenario((event.currentTarget as unknown as { value: string }).value as Scenario)
            }
          >
            {Object.entries(scenarios).map(([key, value]) => (
              <option key={key} value={key}>
                {value.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Human resources / Merit selection</p>
          <h1>
            Recruitment <span className={styles.sectionTitle}>/ {menus[menu]}</span>
          </h1>
          <p>Administrative Service · Reference Agency</p>
        </div>
        <nav className={styles.viewSwitch} aria-label="Recruitment views">
          {Object.entries(availableViews).map(([key, name]) => (
            <button key={key} aria-pressed={variant === key} onClick={() => changeView(key)}>
              <span aria-hidden="true">{key === 'A' ? '☷' : key === 'B' ? '▤' : '▥'}</span>
              {name}
            </button>
          ))}
        </nav>
      </header>
      <nav className={styles.submenus} aria-label="Recruitment submenus">
        {Object.entries(menus).map(([key, title]) => (
          <button
            key={key}
            aria-current={menu === key ? 'page' : undefined}
            onClick={() => navigate(key as Menu)}
          >
            {title}
          </button>
        ))}
      </nav>
      <div className={styles.caseBar}>
        <div>
          <span className={styles.recordIcon} aria-hidden="true">
            R
          </span>
          <div>
            <strong>
              {variant === 'B' ? (inspectApplicant ? applicant.name : menus[menu]) : menus[menu]}
            </strong>
            <small>
              {variant === 'B'
                ? recordId
                : 'Administrative Officer II · RTF-026-014 · Reference Agency'}
            </small>
          </div>
        </div>
        <span className={styles.badge}>
          {inspectApplicant
            ? variant === 'B'
              ? evaluated
                ? applicant.screening
                : 'Pending screening'
              : `${published ? 6 : 0} Applications`
            : hasRecord
              ? recordStatus
              : 'No records yet'}
        </span>
      </div>
      <div className={styles.toolbar}>
        <span>
          {menus[menu]} /{' '}
          {variant === 'B'
            ? 'Selected record'
            : variant === 'C'
              ? 'Grouped by progress'
              : inspectApplicant
                ? 'Grouped by position'
                : 'All records'}
        </span>
        {inspectApplicant && variant !== 'B' && (
          <label className={styles.search}>
            Find applicant
            <input
              type="search"
              placeholder="Name or application number"
              value={search}
              onChange={(event) =>
                setSearch((event.currentTarget as unknown as { value: string }).value)
              }
            />
          </label>
        )}
        {variant === 'B' && (
          <Button variant="secondary" size="default" onClick={() => changeView('A')}>
            ← Back to {menus[menu]}
          </Button>
        )}
      </div>
      {variant === 'A' && (
        <section className={styles.treeSheet} aria-label={`${menus[menu]} tree`}>
          <div className={styles.sheetHeading}>
            <h2>{menus[menu]}</h2>
            <span>{inspectApplicant ? visibleApplicants.length : hasRecord ? 1 : 0} records</span>
          </div>
          <div className={styles.scroll}>
            <table className={styles.treeTable}>
              <thead>
                <tr>
                  <th>{inspectApplicant ? 'Applicant' : 'Record'}</th>
                  <th>Reference</th>
                  <th>{inspectApplicant ? 'Source' : 'Position'}</th>
                  <th>{inspectApplicant ? 'Evidence' : 'Related Request to Fill'}</th>
                  <th>{inspectApplicant ? 'Progress' : 'Standing'}</th>
                </tr>
              </thead>
              <tbody>
                {inspectApplicant ? (
                  <>
                    <tr className={styles.rootRow}>
                      <td colSpan={5}>
                        <button
                          className={styles.expand}
                          aria-expanded={expanded}
                          aria-label="Toggle position group"
                          onClick={() => setExpanded(!expanded)}
                        >
                          {expanded ? '▾' : '▸'}
                        </button>
                        <strong>Administrative Officer II</strong>
                        <span className={styles.groupMeta}>
                          {visibleApplicants.length} Applications
                        </span>
                      </td>
                    </tr>
                    {expanded &&
                      visibleApplicants.map((person) => (
                        <tr key={person.id}>
                          <td>
                            <button
                              className={styles.recordButton}
                              onClick={() => openApplicant(person.id)}
                            >
                              {person.name}
                            </button>
                          </td>
                          <td className={styles.reference}>{person.id}</td>
                          <td>{person.source}</td>
                          <td>{evaluated ? person.evidence : 'Awaiting review'}</td>
                          <td>
                            <span className={styles.tableStatus}>
                              {applicationStanding(person)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    {visibleApplicants.length === 0 && (
                      <tr>
                        <td colSpan={5} className={styles.empty}>
                          {published
                            ? 'No applicants match your search.'
                            : 'No Applications received yet.'}
                        </td>
                      </tr>
                    )}
                  </>
                ) : hasRecord ? (
                  <tr>
                    <td>
                      <button className={styles.recordButton} onClick={() => changeView('B')}>
                        {menu === 'requests'
                          ? 'Request to Fill'
                          : menu === 'publications'
                            ? 'Vacancy publication'
                            : menu === 'sessions'
                              ? 'HRMPSB · 05 Sep 2026'
                              : 'Appointing-authority decision'}
                      </button>
                    </td>
                    <td className={styles.reference}>{recordId}</td>
                    <td>Administrative Officer II</td>
                    <td>RTF-026-014</td>
                    <td>
                      <span className={styles.tableStatus}>{recordStatus}</span>
                    </td>
                  </tr>
                ) : (
                  <tr>
                    <td colSpan={5} className={styles.empty}>
                      No {menus[menu].toLowerCase()} recorded in this scenario.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className={styles.tableFooter}>
            {inspectApplicant
              ? 'Tree and Kanban show the same Applications and progress. Open a record to view its form.'
              : 'Open a record to view its form. Related records remain in their own Recruitment submenu.'}
          </div>
        </section>
      )}

      {variant === 'B' && !hasRecord && (
        <section className={styles.panel}>
          <h2>No record available</h2>
          <p>
            This scenario has no {menus[menu].toLowerCase()} record. Return to Tree or choose
            another scenario.
          </p>
        </section>
      )}
      {variant === 'B' && hasRecord && (
        <article
          className={styles.formSheet}
          aria-label={`${inspectApplicant ? 'Application' : menus[menu]} form`}
        >
          <div className={styles.formHeading}>
            <div>
              <p className={styles.eyebrow}>
                {inspectApplicant
                  ? `Application · ${applicant.id}`
                  : `${menus[menu]} · ${recordId}`}
              </p>
              <h2>{inspectApplicant ? applicant.name : 'Administrative Officer II'}</h2>
              <p>{inspectApplicant ? applicant.source : 'Human Resource Management Officer I'}</p>
            </div>
            <div className={styles.formStamp}>
              <span>Responsible officer</span>
              <strong>Marisol Santos</strong>
              <small>HR Division</small>
            </div>
          </div>
          {inspectApplicant ? (
            <>
              <div className={styles.formFields}>
                <label>
                  Applicant
                  <input readOnly value={applicant.name} />
                </label>
                <label>
                  Application reference
                  <input readOnly value={applicant.id} />
                </label>
                <label>
                  Position applied for
                  <input readOnly value="Administrative Officer II · SG 11" />
                </label>
                <label>
                  Recruitment Case
                  <input readOnly value="RTF-026-014" />
                </label>
              </div>
              <nav className={styles.formTabs} aria-label="Application form sections">
                <button aria-pressed={stage !== 3} onClick={() => setStage(2)}>
                  Application details
                </button>
                <button aria-pressed={stage === 3} onClick={() => setStage(3)}>
                  HRMPSB deliberation
                </button>
              </nav>
              <div className={styles.formBody}>{stage === 3 ? panel(3) : candidateDetail}</div>
            </>
          ) : (
            <>
              <div className={styles.formFields}>
                <label>
                  Requesting Office
                  <input readOnly value="Administrative Service / HR Division" />
                </label>
                <label>
                  Plantilla Position
                  <input readOnly value="OSEC-REF-ADOF2-014-2026" />
                </label>
                <label>
                  Position classification
                  <input readOnly value="SG 11 · Permanent" />
                </label>
                <label>
                  Recruitable Vacancy
                  <input
                    readOnly
                    value={
                      scenario === 'rejected'
                        ? 'Authority not established'
                        : selected
                          ? 'Reserved for selected Application'
                          : 'Verified in mock snapshot'
                    }
                  />
                </label>
              </div>
              <div className={styles.formBody}>{panel(menuStage)}</div>
              <nav className={styles.related} aria-label="Related Recruitment records">
                {Object.entries(menus)
                  .filter(([key]) => key !== menu)
                  .map(([key, name]) => (
                    <button
                      key={key}
                      className={styles.recordButton}
                      onClick={() => navigate(key as Menu)}
                    >
                      {name} ↗
                    </button>
                  ))}
              </nav>
            </>
          )}
          <footer className={styles.noteArea}>
            <div>
              <h3>Working note · {recordId}</h3>
              <p>Private mock note. Separate from approvals and official evidence.</p>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setSavedNote(workingNote);
              }}
            >
              <label className={styles.srOnly} htmlFor="recruitment-note">
                Working note
              </label>
              <textarea
                id="recruitment-note"
                rows={2}
                value={workingNote}
                onChange={(event) =>
                  setWorkingNote((event.currentTarget as unknown as { value: string }).value)
                }
              />
              <div>
                <span role="status">
                  {savedNote === workingNote ? 'Saved in this preview session' : 'Unsaved changes'}
                </span>
                <Button
                  variant="secondary"
                  size="default"
                  type="submit"
                  disabled={savedNote === workingNote}
                >
                  Save note
                </Button>
              </div>
            </form>
          </footer>
        </article>
      )}

      {variant === 'C' && (
        <section aria-label="Applicant kanban">
          <div className={styles.boardIntro}>
            <span>
              {visibleApplicants.length} Applications {search && 'matching search'}
            </span>
            <p>Open a card to review its file. Progress follows recorded decisions.</p>
          </div>
          <div
            className={styles.kanban}
            tabIndex={0}
            role="region"
            aria-label="Applicant progress columns"
          >
            {lanes.map((name, index) => {
              const people = visibleApplicants.filter((person) => applicantLane(person) === index);
              return (
                <section key={name} className={styles.lane} data-lane={index}>
                  <header>
                    <h2>{name}</h2>
                    <span>{people.length}</span>
                  </header>
                  <div className={styles.laneCards}>
                    {people.map((person) => (
                      <button
                        key={person.id}
                        className={styles.applicantCard}
                        aria-pressed={inspectApplicant && applicantId === person.id}
                        onClick={() => openApplicant(person.id)}
                      >
                        <span className={styles.cardTop}>
                          <span>{person.id}</span>
                          <span>
                            {person.source === 'Internal applicant' ? 'Internal' : 'External'}
                          </span>
                        </span>
                        <strong>{person.name}</strong>
                        <span className={styles.cardRole}>Administrative Officer II</span>
                        <span className={styles.cardEvidence}>
                          {evaluated ? person.evidence : 'Screening pending'}
                        </span>
                        <span className={styles.cardBottom}>
                          <span className={styles.avatar}>
                            {person.name
                              .split(' ')
                              .map((part) => part[0])
                              .join('')}
                          </span>
                          <span>{applicationStanding(person)}</span>
                        </span>
                      </button>
                    ))}
                    {people.length === 0 && <p className={styles.empty}>No Applications</p>}
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      )}
      <div className={styles.status} role="status">
        <strong>{applicantForm ? 'Application standing' : 'Case standing'}</strong>
        <span>
          {applicantForm
            ? evaluated
              ? applicant.note
              : 'Qualification screening is pending.'
            : snapshot.note}
        </span>
      </div>

      <Dialog
        open={document !== null}
        onOpenChange={(open) => {
          if (!open) setDocument(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            evidenceInvoker.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Mock evidence preview</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {document !== null && (
              <>
                <h2>{documents[document]![0]}</h2>
                <strong>{documents[document]![1]}</strong>
                <DialogDescription>{documents[document]![2]}</DialogDescription>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" size="default">
                Close preview
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <details open className={styles.state}>
        <summary>
          Prototype state · {variant}: {variants[variant]} · {snapshot.label}
        </summary>
        <p>
          No changes are persisted. Scenario selection loads a mock snapshot, not a business
          transition.
        </p>
        <pre>
          {JSON.stringify(
            {
              menu,
              variant,
              scenario,
              snapshot,
              viewedStage: stages[stage],
              expanded,
              inspectApplicant,
              search,
              workingNote,
              savedNote,
              applicantProgress: (applicantForm
                ? [applicant]
                : variant === 'B'
                  ? []
                  : visibleApplicants
              ).map((person) => ({
                id: person.id,
                lane: lanes[applicantLane(person)],
              })),
              applicantId,
              evidencePreview: document === null ? null : documents[document],
              handoffPreview: handoff,
              bindings,
              published,
              evaluated,
              boardOutput,
              selected,
              republication,
              applicants: applicantForm ? [applicant] : variant === 'B' ? [] : applicants,
              boardMembers: members,
              documents,
            },
            null,
            2,
          )}
        </pre>
      </details>
      <PrototypeSwitcher variants={availableViews} />
    </div>
  );
}
