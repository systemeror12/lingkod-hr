'use client';

// Throwaway Appointment Tree/Form/Kanban at ?variant=A|B|C. Keep out of main.
// Follow the accepted Recruitment design: full-width lists, selected-record forms,
// direct card-to-form navigation. CSC standing never drives the workflow lanes.
import { Fragment, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PrototypeSwitcher } from '../../../../components/prototype-switcher';
import { Button } from '../../../../components/ui/button';
import styles from './prototype.module.css';

const views = { A: 'Tree view', B: 'Form view', C: 'Kanban' };
const menus = {
  appointments: 'Appointments',
  csc: 'CSC submissions & actions',
  assumption: 'Oath & Assumption to Duty',
};
type Menu = keyof typeof menus;
const snapshots = {
  preparation: {
    label: 'Preparation',
    workflow: 'Draft',
    csc: 'Not submitted',
    assumption: 'Not recorded',
    issued: false,
    ready: false,
    note: 'Proof of eligibility is missing. Complete the evidence before review.',
  },
  review: {
    label: 'Under review',
    workflow: 'For review',
    csc: 'Not submitted',
    assumption: 'Not recorded',
    issued: false,
    ready: false,
    note: 'Reviewed by a different authorized officer. Signature is still pending.',
  },
  returned: {
    label: 'Returned for correction',
    workflow: 'Draft',
    csc: 'Not submitted',
    assumption: 'Not recorded',
    issued: false,
    ready: false,
    note: 'Review return REV-02: correct the position title. Prior review and draft v1 remain in history.',
  },
  signature: {
    label: 'For signature',
    workflow: 'For signature',
    csc: 'Not submitted',
    assumption: 'Not recorded',
    issued: false,
    ready: false,
    note: 'Reviewed version v2 is ready for the authorized appointing officer. No signed instrument is recorded.',
  },
  issued: {
    label: 'Issued · CSC pending',
    workflow: 'Issued',
    csc: 'Submitted',
    assumption: 'Awaiting oath and assumption',
    issued: true,
    ready: false,
    note: 'Signed version v2 and receipt are recorded. Oath and assumption may proceed while CSC action is pending.',
  },
  cscReturn: {
    label: 'CSC return & resubmission',
    workflow: 'Issued',
    csc: 'Resubmitted',
    assumption: 'Awaiting oath and assumption',
    issued: true,
    ready: false,
    note: 'A return for compliance and its resubmission are separate retained events. The issued instrument is unchanged.',
  },
  assumed: {
    label: 'Assumed · CSC pending',
    workflow: 'Issued',
    csc: 'Submitted',
    assumption: 'Assumed',
    issued: true,
    ready: true,
    note: 'Certified assumption is complete. Service activation is ready even though CSC action is pending.',
  },
  validated: {
    label: 'CSC validated · assumed',
    workflow: 'Issued',
    csc: 'Validated',
    assumption: 'Assumed',
    issued: true,
    ready: true,
    note: 'Validation is recorded from official evidence for this mock accredited Agency. It does not supply the assumption date.',
  },
  invalidated: {
    label: 'Later CSC invalidation',
    workflow: 'Issued',
    csc: 'Invalidated',
    assumption: 'Assumed · service retained',
    issued: true,
    ready: false,
    note: 'Prior activation and service remain in history. Human resolution is required for the applicable personnel response; no automatic termination is modeled.',
  },
  didNotAssume: {
    label: 'Did not assume',
    workflow: 'Issued',
    csc: 'Submitted',
    assumption: 'Did not assume',
    issued: true,
    ready: false,
    note: 'Evidenced notice and authority record failure to assume. Plantilla reservation release is recorded; Selection Decision remains unchanged.',
  },
  cancelled: {
    label: 'Pre-assumption cancellation',
    workflow: 'Cancelled',
    csc: 'Not submitted',
    assumption: 'Not assumed',
    issued: false,
    ready: false,
    note: 'Authorized cancellation CAN-01 retains reason and evidence. The reservation is released without reopening the Selection Decision.',
  },
  blocked: {
    label: 'Agency configuration missing',
    workflow: 'Draft',
    csc: 'Not submitted',
    assumption: 'Not recorded',
    issued: false,
    ready: false,
    note: 'Agency accreditation evidence and signature authority are unresolved. Issuance and submission are unavailable.',
  },
} as const;
type Snapshot = keyof typeof snapshots;
const records: {
  id: string;
  name: string;
  role: string;
  office: string;
  position: string;
  scenario: Snapshot;
}[] = [
  {
    id: 'APT-026-01',
    name: 'Ana Reyes',
    role: 'Administrative Officer II',
    office: 'Administrative Division',
    position: 'OSEC-ADM-014',
    scenario: 'issued',
  },
  {
    id: 'APT-026-02',
    name: 'Miguel Santos',
    role: 'Planning Officer II',
    office: 'Planning Division',
    position: 'OSEC-PLN-008',
    scenario: 'review',
  },
  {
    id: 'APT-026-03',
    name: 'Bea Cruz',
    role: 'Human Resource Management Officer I',
    office: 'Administrative Division',
    position: 'OSEC-HRM-012',
    scenario: 'signature',
  },
  {
    id: 'APT-026-04',
    name: 'Paolo Mendoza',
    role: 'Administrative Assistant II',
    office: 'Administrative Division',
    position: 'OSEC-ADM-023',
    scenario: 'preparation',
  },
  {
    id: 'APT-026-05',
    name: 'Liza Navarro',
    role: 'Information Officer I',
    office: 'Planning Division',
    position: 'OSEC-INF-004',
    scenario: 'assumed',
  },
  {
    id: 'APT-026-06',
    name: 'Carlo Ramos',
    role: 'Records Officer I',
    office: 'Administrative Division',
    position: 'OSEC-REC-003',
    scenario: 'cancelled',
  },
];
const evidence = [
  'PDS and Work Experience Sheet',
  'Proof of eligibility',
  'Position Description Form',
  'Selection Decision and publication certifications',
  'Appointment authority and signature evidence',
  'Appointment form · CS Form No. 33-B, Revised 2025',
];

export function AppointmentCasePrototype() {
  const router = useRouter();
  const params = useSearchParams();
  const menu = (
    Object.keys(menus).includes(params.get('section') ?? '')
      ? params.get('section')
      : 'appointments'
  ) as Menu;
  const variants = menu === 'appointments' ? views : { A: views.A, B: views.B };
  const view =
    params.get('variant') === 'B'
      ? 'B'
      : params.get('variant') === 'C' && menu === 'appointments'
        ? 'C'
        : 'A';
  const selected = records.find((record) => record.id === params.get('record')) ?? records[0]!;
  const [overrides, setOverrides] = useState<Record<string, Snapshot>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [tab, setTab] = useState('Preparation & evidence');
  const [preview, setPreview] = useState<string | null>(null);
  const scenario = overrides[selected.id] ?? selected.scenario;
  const state = snapshots[scenario];
  const rows = records.filter((record) =>
    `${record.id} ${record.name} ${record.role} ${record.position}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const external = state.issued
    ? [
        {
          ref: 'CSC-01',
          date: '07 Sep 2026',
          action: 'Submitted',
          detail:
            'Report on Appointments Issued · CS Form No. 2, Revised 2025 · receiving CSC Field Office (mock)',
          document: 'DOC-CSC-01 · v1',
        },
        {
          ref: 'CSC-02',
          date: '08 Sep 2026',
          action: 'Acknowledged',
          detail: 'CSC receipt reference ACK-026. Recorded by Personnel Records Officer.',
          document: 'DOC-CSC-02 · v1',
        },
        ...(['cscReturn', 'validated', 'invalidated'].includes(scenario)
          ? [
              {
                ref: 'CSC-03',
                date: '10 Sep 2026',
                action: 'Returned for compliance',
                detail: 'Deficiency: eligibility copy is incomplete. Original submission retained.',
                document: 'DOC-CSC-03 · v1',
              },
              {
                ref: 'CSC-04',
                date: '11 Sep 2026',
                action: 'Resubmitted',
                detail: 'Complete eligibility copy attached. Links return CSC-03.',
                document: 'DOC-CSC-04 · v1',
              },
            ]
          : []),
        ...(['validated', 'invalidated'].includes(scenario)
          ? [
              {
                ref: 'CSC-05',
                date: '15 Sep 2026',
                action: 'Validated',
                detail: 'Official action recorded from the exact evidence version.',
                document: 'DOC-CSC-05 · v1',
              },
            ]
          : []),
        ...(scenario === 'invalidated'
          ? [
              {
                ref: 'CSC-06',
                date: '21 Sep 2026',
                action: 'Invalidated',
                detail:
                  'Later official action retained. Personnel response awaits supported authority; existing service is preserved.',
                document: 'DOC-CSC-06 · v1',
              },
            ]
          : []),
      ]
    : [];
  const hasAssumed = ['assumed', 'validated', 'invalidated'].includes(scenario);
  const assumptionRecords = hasAssumed
    ? [
        {
          ref: 'OATH-01',
          date: '08 Sep 2026',
          action: 'Oath recorded',
          detail:
            'SS Porma Blg. 32, Narebisa 2025 · administering officer Maria Dela Cruz · authority AUTH-02 · Reference Agency office · signed in person',
          document: 'DOC-OATH-01 · v1',
        },
        {
          ref: 'ASMP-01',
          date: '09 Sep 2026',
          action: 'Assumption certified',
          detail:
            'CS Form No. 4, Revised 2025 · actual assumption 09 Sep 2026 · certifier Jose Garcia · authority AUTH-03 · certified 09 Sep 2026, 09:00 PHT · linked oath OATH-01',
          document: 'DOC-ASMP-01 · v1',
        },
      ]
    : scenario === 'didNotAssume'
      ? [
          {
            ref: 'DNA-01',
            date: '08 Oct 2026',
            action: 'Did not assume',
            detail:
              'Receipt 07 Sep 2026 · notice NOTICE-01 · authorized outcome AUTH-04 · reservation release REL-01. Dates are an illustrative snapshot, not a deadline calculator.',
            document: 'DOC-DNA-01 · v1',
          },
        ]
      : [];
  const childRows = menu === 'csc' ? external : assumptionRecords;
  const child = childRows.find((row) => row.ref === params.get('entry')) ?? childRows[0];
  function navigate(changes: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    Object.entries(changes).forEach(([key, value]) => next.set(key, value));
    router.replace(`/prototype/appointment-case?${next}`, { scroll: false });
    setPreview(null);
  }
  function open(id: string) {
    navigate({ record: id, variant: 'B', section: 'appointments', entry: '' });
  }
  function facts(items: [string, string][]) {
    return (
      <dl className={styles.facts}>
        {items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    );
  }
  function documentLink(document: string) {
    return (
      <button className={styles.recordButton} onClick={() => setPreview(document)}>
        {document}
      </button>
    );
  }

  return (
    <div className={styles.prototype}>
      <div className={styles.lab}>
        <span>Throwaway prototype · Reference Agency · fictional records and authority</span>
        <label>
          Scenario for {selected.name}
          <select
            value={scenario}
            onChange={(event) => {
              setOverrides({
                ...overrides,
                [selected.id]: (event.target as unknown as { value: string }).value as Snapshot,
              });
              setPreview(null);
            }}
          >
            {Object.entries(snapshots).map(([key, value]) => (
              <option key={key} value={key}>
                {value.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Personnel administration</p>
          <h1>
            Appointment <span className={styles.sectionTitle}>/ {menus[menu]}</span>
          </h1>
          <p>Selected candidates, issued instruments and the start of service.</p>
        </div>
        <div className={styles.viewSwitch}>
          {Object.entries(variants).map(([key, name]) => (
            <button
              key={key}
              aria-pressed={view === key}
              onClick={() => navigate({ variant: key })}
            >
              {name}
            </button>
          ))}
        </div>
      </header>
      <nav className={styles.submenus} aria-label="Appointment records">
        {Object.entries(menus).map(([key, label]) => (
          <button
            key={key}
            aria-current={menu === key ? 'page' : undefined}
            onClick={() => navigate({ section: key, variant: 'A', record: selected.id, entry: '' })}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className={styles.toolbar}>
        <span>
          {menu === 'appointments'
            ? `${rows.length} Appointment records`
            : `${selected.name} · ${selected.id} · ${childRows.length} records`}
        </span>
        {menu === 'appointments' && view !== 'B' && (
          <label className={styles.search}>
            Search
            <input
              value={query}
              onChange={(event) => setQuery((event.target as unknown as { value: string }).value)}
              placeholder="Name, reference or position"
            />
          </label>
        )}
        {view === 'B' && (
          <button className={styles.recordButton} onClick={() => navigate({ variant: 'A' })}>
            ← Back to Tree
          </button>
        )}
      </div>
      {view === 'A' && menu === 'appointments' && (
        <div className={styles.treeSheet}>
          <div className={styles.scroll}>
            <table className={styles.treeTable}>
              <thead>
                <tr>
                  <th scope="col">Appointee / position</th>
                  <th scope="col">Reference</th>
                  <th scope="col">Workflow</th>
                  <th scope="col">CSC standing</th>
                  <th scope="col">Assumption</th>
                </tr>
              </thead>
              <tbody>
                {['Administrative Division', 'Planning Division'].map((office) => {
                  const group = rows.filter((record) => record.office === office);
                  return (
                    <Fragment key={office}>
                      <tr className={styles.rootRow}>
                        <td colSpan={5}>
                          <button
                            className={styles.expand}
                            aria-label={`Toggle ${office}`}
                            aria-expanded={!collapsed.includes(office)}
                            onClick={() =>
                              setCollapsed(
                                collapsed.includes(office)
                                  ? collapsed.filter((item) => item !== office)
                                  : [...collapsed, office],
                              )
                            }
                          >
                            {collapsed.includes(office) ? '▸' : '▾'}
                          </button>
                          <strong>{office}</strong>
                          <span className={styles.groupMeta}>{group.length} records</span>
                        </td>
                      </tr>
                      {!collapsed.includes(office) &&
                        group.map((record) => {
                          const standing = snapshots[overrides[record.id] ?? record.scenario];
                          return (
                            <tr key={record.id}>
                              <td>
                                <button
                                  className={styles.recordButton}
                                  onClick={() => open(record.id)}
                                >
                                  {record.name}
                                  <small>
                                    {record.role} · {record.position}
                                  </small>
                                </button>
                              </td>
                              <td className={styles.reference}>{record.id}</td>
                              <td>{standing.workflow}</td>
                              <td>{standing.csc}</td>
                              <td>{standing.assumption}</td>
                            </tr>
                          );
                        })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && (
            <p className={styles.empty}>
              No matching Appointments. Change the search to find a record.
            </p>
          )}
        </div>
      )}
      {view === 'C' && (
        <div className={styles.kanban}>
          {['Draft', 'For review', 'For signature', 'Issued', 'Cancelled'].map((lane) => {
            const cards = rows.filter(
              (record) => snapshots[overrides[record.id] ?? record.scenario].workflow === lane,
            );
            return (
              <section className={styles.lane} key={lane}>
                <header>
                  <h2>{lane}</h2>
                  <span>{cards.length}</span>
                </header>
                <div className={styles.laneCards}>
                  {cards.map((record) => {
                    const standing = snapshots[overrides[record.id] ?? record.scenario];
                    return (
                      <button
                        className={styles.applicantCard}
                        key={record.id}
                        onClick={() => open(record.id)}
                      >
                        <span className={styles.cardTop}>{record.id}</span>
                        <strong>{record.name}</strong>
                        <span className={styles.cardRole}>
                          {record.role}
                          <br />
                          {record.position}
                        </span>
                        <span className={styles.cardEvidence}>CSC · {standing.csc}</span>
                        <span className={styles.cardBottom}>{standing.assumption}</span>
                      </button>
                    );
                  })}
                  {cards.length === 0 && <p className={styles.empty}>No Appointments</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {view === 'A' && menu !== 'appointments' && (
        <div className={styles.treeSheet}>
          <div className={styles.scroll}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Record</th>
                  <th scope="col">Reference</th>
                  <th scope="col">Date</th>
                  <th scope="col">Evidence version</th>
                </tr>
              </thead>
              <tbody>
                {childRows.map((row) => (
                  <tr key={row.ref}>
                    <td>
                      <button
                        className={styles.recordButton}
                        onClick={() => navigate({ variant: 'B', entry: row.ref })}
                      >
                        {row.action}
                      </button>
                    </td>
                    <td>{row.ref}</td>
                    <td>{row.date}</td>
                    <td>{documentLink(`${selected.id} / ${row.document}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {childRows.length === 0 && (
            <p className={styles.empty}>
              No {menu === 'csc' ? 'CSC events' : 'oath or assumption records'} for {selected.name}.
              Open the Appointment form to inspect readiness.
            </p>
          )}
          <div className={styles.related}>
            <button className={styles.recordButton} onClick={() => open(selected.id)}>
              Open {selected.name}&apos;s Appointment
            </button>
          </div>
        </div>
      )}
      {view === 'B' && (
        <article className={styles.formSheet}>
          <header className={styles.formHeading}>
            <div>
              <p className={styles.eyebrow}>
                {menu === 'appointments' ? selected.id : (child?.ref ?? 'No record')}
              </p>
              <h2>
                {menu === 'appointments' ? selected.name : (child?.action ?? 'No record available')}
              </h2>
              <p>
                {selected.role} · {selected.position}
              </p>
            </div>
            <div className={styles.formStamp}>
              <span>Appointment workflow</span>
              <strong>{state.workflow}</strong>
              <span>CSC standing</span>
              <strong>{state.csc}</strong>
            </div>
          </header>
          {menu === 'appointments' ? (
            <>
              <div className={styles.formFields}>
                {[
                  ['Selected candidate', selected.name],
                  ['Reserved Plantilla Position', `${selected.position} · ${selected.office}`],
                  ['Employment Status', 'Permanent'],
                  ['Nature of Appointment', 'Original'],
                ].map(([label, value]) => (
                  <label key={label}>
                    {label}
                    <input readOnly value={value} />
                  </label>
                ))}
              </div>
              <nav className={styles.formTabs} aria-label="Appointment form sections">
                {[
                  'Preparation & evidence',
                  'Review & issuance',
                  'CSC history',
                  'Oath & assumption',
                  'Activation & outcomes',
                ].map((name) => (
                  <button
                    key={name}
                    aria-pressed={tab === name}
                    onClick={() => {
                      setTab(name);
                      setPreview(null);
                    }}
                  >
                    {name}
                  </button>
                ))}
              </nav>
              <div className={styles.panel}>
                <p className={styles.notice}>{state.note}</p>
                {tab === 'Preparation & evidence' && (
                  <>
                    <h3>Selected-candidate package</h3>
                    {facts([
                      ['Selection Decision', `${selected.id} / SD-01 · final · retained`],
                      [
                        'Selected Application',
                        `${selected.id} / APP-01 · immutable selection package`,
                      ],
                      [
                        'Plantilla reservation',
                        ['cancelled', 'didNotAssume'].includes(scenario)
                          ? 'Released · REL-01'
                          : scenario === 'invalidated'
                            ? 'Consumed by recorded service activation'
                            : 'Reserved · RES-01',
                      ],
                      [
                        'Agency form path',
                        scenario === 'blocked'
                          ? 'Unresolved · issuance blocked'
                          : 'Accredited Agency · mock accreditation ACC-01 · CS Form No. 33-B, Revised 2025',
                      ],
                    ])}
                    <h3>Exact evidence versions</h3>
                    <ul className={styles.rows}>
                      {evidence.map((name, index) => (
                        <li key={name}>
                          <span>{name}</span>
                          <span>
                            {scenario === 'preparation' && index === 1
                              ? 'Missing · attach eligibility evidence'
                              : index === 5 && !state.issued
                                ? 'Draft v2 · not signed'
                                : documentLink(
                                    `${selected.id} / DOC-${index + 1} · ${index === 5 ? 'v2 · signed' : 'v1'}`,
                                  )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {tab === 'Review & issuance' && (
                  <>
                    <h3>Preparation, review and signature</h3>
                    {facts([
                      ['Preparer', 'Elena Ramos · Personnel Records Officer (mock)'],
                      ['Reviewer', 'Jose Garcia · HRMO reviewer (mock)'],
                      [
                        'Appointing authority',
                        scenario === 'blocked'
                          ? 'Missing evidenced authority'
                          : 'Maria Dela Cruz · AUTH-01 (mock)',
                      ],
                      [
                        'Signature',
                        state.issued ? 'Handwritten · signed document v2' : 'Not recorded',
                      ],
                      ['Issued on', state.issued ? '07 Sep 2026 · signed v2 frozen' : 'Not issued'],
                      [
                        'Acknowledged receipt',
                        state.issued ? '07 Sep 2026 · ACK-01 · v1' : 'Not recorded',
                      ],
                    ])}
                    <ul className={styles.rows}>
                      <li>
                        Draft v1 prepared<span>04 Sep 2026 · PREP-01</span>
                      </li>
                      {scenario !== 'preparation' && (
                        <li>
                          Returned for title correction
                          <span>05 Sep 2026 · REV-02 · prior version retained</span>
                        </li>
                      )}
                      {!['preparation', 'returned', 'blocked'].includes(scenario) && (
                        <li>
                          Corrected version v2 submitted
                          <span>06 Sep 2026 · separate review record</span>
                        </li>
                      )}
                      {state.issued && (
                        <li>
                          Reviewed and issued by separate authorized officers
                          <span>07 Sep 2026 · signed v2 retained</span>
                        </li>
                      )}
                    </ul>
                    <p className={styles.caption}>
                      Issued corrections require a linked successor, reason, authority and evidence.
                      Issuance alone creates no Employee service.
                    </p>
                  </>
                )}
                {tab === 'CSC history' && (
                  <>
                    <h3>External submissions and official actions</h3>
                    <p>
                      Accredited Agency example uses validation / invalidation. Regulated Agencies
                      use approval / disapproval with their configured form package.
                    </p>
                    <ul className={styles.rows}>
                      {external.map((row) => (
                        <li key={row.ref}>
                          <button
                            className={styles.recordButton}
                            onClick={() =>
                              navigate({ section: 'csc', variant: 'B', entry: row.ref })
                            }
                          >
                            {row.action} · {row.ref}
                          </button>
                          <span>
                            {row.date} · {row.document}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {external.length === 0 && (
                      <p>
                        No external event recorded. Evidence must establish an actual submission or
                        official action.
                      </p>
                    )}
                    <p className={styles.caption}>
                      History is appended. Return, resubmission and adverse action never overwrite
                      the issued Appointment.
                    </p>
                  </>
                )}
                {tab === 'Oath & assumption' && (
                  <>
                    <h3>{state.assumption}</h3>
                    <p>
                      Oath and assumption may proceed after acknowledged receipt of the signed
                      Appointment while CSC action is pending.
                    </p>
                    {facts([
                      [
                        'Appointment received',
                        state.issued ? '07 Sep 2026 · ACK-01 · v1' : 'Not recorded',
                      ],
                      ['Oath', hasAssumed ? '08 Sep 2026 · OATH-01 · v1' : 'Not recorded'],
                      ['Actual assumption date', hasAssumed ? '09 Sep 2026' : 'Not recorded'],
                      [
                        'Certification',
                        hasAssumed
                          ? '09 Sep 2026, 09:00 PHT · Jose Garcia · AUTH-03'
                          : 'Not recorded',
                      ],
                    ])}
                    <ul className={styles.rows}>
                      {assumptionRecords.map((row) => (
                        <li key={row.ref}>
                          <button
                            className={styles.recordButton}
                            onClick={() =>
                              navigate({ section: 'assumption', variant: 'B', entry: row.ref })
                            }
                          >
                            {row.action}
                          </button>
                          <span>{row.document}</span>
                        </li>
                      ))}
                    </ul>
                    <p className={styles.caption}>
                      Oath-copy submission deadline remains an Agency configuration question.
                      Corrections preserve former facts and require the owning service and payroll
                      correction contracts.
                    </p>
                  </>
                )}
                {tab === 'Activation & outcomes' && (
                  <>
                    <h3>
                      {scenario === 'invalidated'
                        ? 'Service retained · personnel response pending'
                        : state.ready
                          ? 'Ready for Employee activation'
                          : 'Employee activation unavailable'}
                    </h3>
                    {facts([
                      [
                        'Assumption evidence',
                        hasAssumed ? 'Complete · oath and certification linked' : 'Incomplete',
                      ],
                      [
                        'Service start basis',
                        hasAssumed
                          ? '09 Sep 2026 · actual assumption'
                          : 'No actual assumption date',
                      ],
                      [
                        'Employee / Service Segment',
                        scenario === 'invalidated'
                          ? 'EMP-026 / SVC-01 · existing service retained'
                          : 'Not created in this snapshot',
                      ],
                      [
                        'Position Incumbency',
                        scenario === 'invalidated'
                          ? 'INC-026 · recorded history retained'
                          : 'Not created in this snapshot',
                      ],
                    ])}
                    <p>
                      Activation links Employee service and Plantilla occupancy to the same
                      certified assumption. Successful activation also closes the Recruitment
                      records.
                    </p>
                    {['cancelled', 'didNotAssume'].includes(scenario) && (
                      <p className={styles.notice}>
                        {scenario === 'cancelled'
                          ? 'CAN-01 · authority AUTH-04 · reason: appointee withdrew before assumption · evidence DOC-CAN-01 v1.'
                          : 'DNA-01 · evidenced receipt, notice and authorized failure-to-assume record.'}{' '}
                        Reservation release REL-01 is recorded. The Selection Decision is retained.
                      </p>
                    )}
                    <p className={styles.caption}>
                      This is a readiness preview. Scenario selection does not issue an Appointment,
                      activate service or change any real record.
                    </p>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className={styles.panel}>
              {child ? (
                <>
                  {facts([
                    ['Appointee', selected.name],
                    ['Appointment Version', `${selected.id} · v2`],
                    ['Event date', child.date],
                    ['Record', child.ref],
                  ])}
                  <p>{child.detail}</p>
                  {documentLink(`${selected.id} / ${child.document}`)}
                  <p className={styles.caption}>
                    Recorded history is retained. Any correction requires a linked, evidenced
                    record.
                  </p>
                </>
              ) : (
                <p>
                  No record exists in this scenario. Choose an Appointment scenario with recorded
                  evidence.
                </p>
              )}
              <button className={styles.recordButton} onClick={() => open(selected.id)}>
                ← Open {selected.name}&apos;s Appointment
              </button>
            </div>
          )}
          <div className={styles.noteArea}>
            <div>
              <h3>Working note</h3>
              <p>Only for this selected record. Kept in memory until reload.</p>
            </div>
            <label>
              Note
              <textarea
                rows={3}
                value={
                  notes[
                    `${selected.id}/${menu}/${menu === 'appointments' ? '' : (child?.ref ?? '')}`
                  ] ?? ''
                }
                onChange={(event) =>
                  setNotes({
                    ...notes,
                    [`${selected.id}/${menu}/${menu === 'appointments' ? '' : (child?.ref ?? '')}`]:
                      (event.target as unknown as { value: string }).value,
                  })
                }
              />
            </label>
          </div>
        </article>
      )}
      {preview && (
        <section className={styles.notice} aria-label="Evidence preview" aria-live="polite">
          <h3>{preview}</h3>
          <p>
            Illustrative evidence reference for {selected.name}. This prototype contains no actual
            official document.
          </p>
          <Button variant="secondary" size="default" onClick={() => setPreview(null)}>
            Close preview
          </Button>
        </section>
      )}
      <details className={styles.state} open>
        <summary>Prototype state · {views[view]}</summary>
        <pre>
          {JSON.stringify(
            {
              menu,
              view,
              selected: selected.id,
              scenario,
              state,
              tab,
              records: records.map((record) => ({
                ...record,
                state: snapshots[overrides[record.id] ?? record.scenario],
              })),
              external,
              assumptionRecords,
              selectedEntry: child?.ref,
              notes,
              query,
              collapsed,
              preview,
            },
            null,
            2,
          )}
        </pre>
      </details>
      <PrototypeSwitcher variants={variants} />
    </div>
  );
}
