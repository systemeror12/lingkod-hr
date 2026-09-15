'use client';

// Throwaway: standard Tree/Form/Kanban on /attendance-prototype?view=tree|form|kanban.
// All records and transitions are synthetic. No domain calculation or persistence.
import { useState } from 'react';
import { useRecordNavigation } from './record-navigation';
import { Button } from './ui/button';

const days = [
  {
    date: '2026-09-07',
    label: 'Mon 7',
    context: 'Office · Schedule v2',
    events: '08:01 in · 12:00 out · 13:00 in · 17:01 out',
    state: 'CALCULATED',
    result: 'Illustrative result awaiting approval',
  },
  {
    date: '2026-09-08',
    label: 'Tue 8',
    context: 'Office · Schedule v2',
    events: '08:00 in · 12:00 out · 13:00 in',
    state: 'EXCEPTION',
    result: 'Missing time-out',
  },
  {
    date: '2026-09-09',
    label: 'Wed 9',
    context: 'Official business · OB-014',
    events: 'No web-clock events',
    state: 'FOR_REVIEW',
    result: 'Certification requires review',
  },
  {
    date: '2026-09-10',
    label: 'Thu 10',
    context: 'Approved leave · LV-021',
    events: 'No web-clock events',
    state: 'APPROVED',
    result: 'Approved absence context',
  },
  {
    date: '2026-09-11',
    label: 'Fri 11',
    context: 'Hybrid · Schedule v2',
    events: '08:00 in · 12:00 out · 13:00 in · 17:00 out',
    state: 'APPROVED',
    result: 'Approved result · version 1',
  },
];
const panel = 'rounded border border-line bg-paper p-5';
const field = 'mt-1 w-full rounded border border-line bg-paper p-2 text-sm';

function Status({ children }: { children: string }) {
  return (
    <span className="inline-block rounded border border-line bg-canvas px-2 py-1 font-mono text-[11px]">
      {children}
    </span>
  );
}

export function AttendancePrototype() {
  const navigation = useRecordNavigation();
  const requestedView = navigation.search.get('view');
  const view = requestedView === 'form' || requestedView === 'kanban' ? requestedView : 'tree';
  const selected = Math.max(
    0,
    days.findIndex((day) => day.date === navigation.search.get('selected')),
  );
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All statuses');
  const [formTab, setFormTab] = useState('Attendance day');
  function openRecord(index: number) {
    setFormTab('Attendance day');
    navigation.navigate({ view: 'form', selected: days[index]!.date, variant: null });
  }
  const [role, setRole] = useState('Attendance Administrator');
  const [scenario, setScenario] = useState('Active');
  const [section, setSection] = useState('Attendance');
  const [correction, setCorrection] = useState('SUBMITTED');
  const [reason, setReason] = useState('Forgot to record departure after the records inventory.');
  const [requestedTime, setRequestedTime] = useState('17:00');
  const [reviewNote, setReviewNote] = useState('');
  const [notice, setNotice] = useState('');
  const [clockEnabled, setClockEnabled] = useState(false);
  const [clocked, setClocked] = useState(false);
  const [manual, setManual] = useState(false);
  const [locked, setLocked] = useState(false);
  const employee = role === 'Employee';
  const admin = role === 'Attendance Administrator';
  const completed = scenario === 'Completed';
  const periodLocked = locked || completed;
  const allApproved = periodLocked || scenario === 'Ready to lock';
  const day = days[selected]!;
  const correctionState =
    scenario === 'Returned' ? 'NEEDS_INFORMATION' : allApproved ? 'APPLIED' : correction;
  const selectScenario = (value: string) => {
    setScenario(value);
    setCorrection('SUBMITTED');
    setLocked(false);
    setNotice('');
  };

  function displayStatus(record: (typeof days)[number]) {
    return periodLocked ? 'LOCKED' : allApproved ? 'APPROVED' : record.state;
  }
  const records = days
    .map((record, index) => ({ ...record, index }))
    .filter(
      (record) =>
        (statusFilter === 'All statuses' || displayStatus(record) === statusFilter) &&
        `${record.date} Mara Santos Administrative Officer II ${record.context} ${record.result}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );

  const detail = (
    <section className={panel} aria-label="Attendance day detail">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <button
          className="cursor-pointer text-sm font-semibold text-cobalt hover:underline"
          onClick={() => navigation.navigate({ view: 'tree', variant: null })}
        >
          Attendance / Attendance days
        </button>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span>
            {selected + 1} / {days.length}
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
            disabled={selected === days.length - 1}
            onClick={() => openRecord(selected + 1)}
          >
            Next
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{day.label} September</h2>
        <Status>{periodLocked ? 'LOCKED' : allApproved ? 'APPROVED' : day.state}</Status>
      </div>
      <p className="mt-1 text-sm text-muted">Mara Santos · Administrative Officer II</p>
      <div className="mt-5 flex flex-wrap gap-2" aria-label="Attendance form sections">
        {['Attendance day', 'Correction', 'History'].map((tab) => (
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
      {formTab === 'Attendance day' && (
        <dl className="mt-5 grid gap-6 text-sm md:grid-cols-2">
          <div className="border-l-2 border-cobalt pl-3">
            <dt className="font-semibold">Raw Attendance Events</dt>
            <dd className="mt-1 font-mono text-xs leading-6">{day.events}</dd>
            <dd className="text-muted">
              Source: synthetic web clock. Original events remain unchanged.
            </dd>
          </div>
          <div className="border-l-2 border-line pl-3">
            <dt className="font-semibold">Context used</dt>
            <dd>{day.context}</dd>
            <dd className="text-muted">Effective from 1 September · Asia/Manila</dd>
          </div>
          <div className="border-l-2 border-line pl-3">
            <dt className="font-semibold">Calculated Attendance Day</dt>
            <dd>{day.result}</dd>
            <dd className="text-muted">
              Hours, tardiness and undertime withheld pending calculation contracts.
            </dd>
          </div>
          <div className="border-l-2 border-line pl-3">
            <dt className="font-semibold">DTR inclusion</dt>
            <dd>
              {allApproved || day.state === 'APPROVED'
                ? 'Approved sample result available in DTR preview.'
                : 'Pending approval. This day is not part of the approved DTR.'}
            </dd>
          </div>
        </dl>
      )}
      {formTab === 'Correction' && selected !== 1 && (
        <p className="mt-5 text-sm text-muted">No correction request for this day.</p>
      )}
      {formTab === 'Correction' && selected === 1 && (
        <div className="mt-5 border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Correction request</h3>
            <Status>{correctionState}</Status>
          </div>
          <p className="mt-2 text-sm">
            Requested time-out: {requestedTime}. Evidence: inventory certification (synthetic).
          </p>
          {correctionState === 'NEEDS_INFORMATION' && (
            <p className="mt-2 rounded bg-pale-blue p-3 text-sm">
              Returned for information: attach the supervisor certification covering your departure
              time.
            </p>
          )}
          {employee && !periodLocked && (
            <div className="mt-3 space-y-3">
              <label className="block text-sm">
                Requested time-out
                <input
                  className={field}
                  type="time"
                  value={requestedTime}
                  onChange={(e) =>
                    setRequestedTime((e.target as unknown as { value: string }).value)
                  }
                />
              </label>
              <label className="block text-sm">
                Reason
                <textarea
                  className={field}
                  value={reason}
                  onChange={(e) => setReason((e.target as unknown as { value: string }).value)}
                />
              </label>
              <Button
                variant="primary"
                size="default"
                disabled={!reason.trim() || !requestedTime}
                onClick={() => {
                  setScenario('Active');
                  setCorrection('SUBMITTED');
                  setNotice('Sample correction submitted. Raw events remain unchanged.');
                }}
              >
                {' '}
                {correctionState === 'NEEDS_INFORMATION'
                  ? 'Resubmit correction'
                  : 'Submit correction'}{' '}
              </Button>
            </div>
          )}
          {!employee && !periodLocked && correctionState === 'SUBMITTED' && (
            <div className="mt-3 space-y-3">
              <label className="block text-sm">
                Review comment
                <textarea
                  className={field}
                  placeholder="Explain the decision or information needed"
                  value={reviewNote}
                  onChange={(e) => setReviewNote((e.target as unknown as { value: string }).value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  size="default"
                  onClick={() => {
                    setCorrection('APPROVED');
                    setNotice(
                      'Sample correction approved. Application and recalculation are separate steps; the DTR is unchanged.',
                    );
                  }}
                >
                  Approve correction
                </Button>
                <Button
                  variant="secondary"
                  size="default"
                  disabled={!reviewNote.trim()}
                  onClick={() => {
                    setCorrection('NEEDS_INFORMATION');
                    setNotice(`Returned with comment: ${reviewNote}`);
                  }}
                >
                  Request information
                </Button>
                <Button
                  variant="secondary"
                  size="default"
                  disabled={!reviewNote.trim()}
                  onClick={() => {
                    setCorrection('REJECTED');
                    setNotice(`Rejected with comment: ${reviewNote}`);
                  }}
                >
                  Reject
                </Button>
              </div>
            </div>
          )}
          {periodLocked && (
            <p className="mt-3 text-sm text-muted">
              This period is locked. Further changes require a linked authorized adjustment; the
              approved history remains available.
            </p>
          )}
        </div>
      )}
      {formTab === 'History' && (
        <details open className="mt-5 border-t border-line pt-3 text-sm">
          <summary className="cursor-pointer font-semibold">Record history</summary>
          <ol className="mt-3 space-y-2">
            <li>Original events received · version 1 retained</li>
            <li>Calculation created · sample rule snapshot</li>
            {selected === 1 && (
              <li>
                Correction · {correctionState} · {employee ? 'Employee view' : 'Reviewer view'}
              </li>
            )}
            {periodLocked && <li>Certified result locked · prior versions retained</li>}
          </ol>
        </details>
      )}
    </section>
  );

  const dtr = (
    <section className={panel}>
      <div className="flex flex-wrap justify-between gap-2">
        <h2 className="text-lg font-semibold">Daily Time Record</h2>
        <Status>{periodLocked ? 'LOCKED SAMPLE' : 'PARTIAL PREVIEW'}</Status>
      </div>
      <p className="mt-2 text-sm text-muted">Mara Santos · 1–15 September 2026 · Example Agency</p>
      <p className="my-4 border-l-2 border-cobalt pl-3 text-sm">
        {allApproved
          ? 'Completed fixture: all five sample days are approved and certified.'
          : 'Only Thursday and Friday have approved sample results. Three days still need approval.'}{' '}
        This is a worksheet preview, not an official printable form.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-muted">
              <th scope="col">Date</th>
              <th scope="col">Basis</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {days
              .filter((d) => allApproved || d.state === 'APPROVED')
              .map((d) => (
                <tr key={d.date} className="border-b border-line">
                  <td className="py-3">{d.label}</td>
                  <td>{d.context}</td>
                  <td>Approved sample</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {admin && (
        <div className="mt-5">
          <Button
            variant="primary"
            size="default"
            disabled={periodLocked || scenario !== 'Ready to lock'}
            onClick={() => {
              setLocked(true);
              setNotice('Sample period locked. No payroll data was published.');
            }}
          >
            Lock certified period
          </Button>
          <p className="mt-2 text-xs text-muted">
            Use the “Ready to lock” fixture to preview a period whose approval and certification
            checks are complete. Exact gates remain a contract decision.
          </p>
        </div>
      )}
    </section>
  );

  return (
    <div className="workspace space-y-5 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-cobalt">
            {employee
              ? 'My attendance'
              : role === 'Supervisor'
                ? 'My direct reports'
                : 'Agency attendance'}{' '}
            · Example Agency
          </p>
          <h1 className="mt-2 text-[28px] font-[760] tracking-[-0.035em] text-midnight">
            Attendance
          </h1>
          <p className="mt-2 text-sm text-muted">
            1–15 September 2026 · Asia/Manila · {periodLocked ? 'Locked period' : 'Open period'}
          </p>
        </div>
        {employee && (
          <div>
            <Button
              variant="primary"
              size="default"
              disabled={
                !clockEnabled ||
                periodLocked ||
                scenario === 'Permission denied' ||
                scenario === 'Loading'
              }
              onClick={() => {
                setClocked(!clocked);
                setNotice(
                  `Synthetic ${clocked ? 'time-out' : 'time-in'} recorded for today, 15 September. Historical sample days are unchanged.`,
                );
              }}
            >
              {clocked ? 'Clock out' : 'Clock in'}
            </Button>
            <p className="mt-2 text-xs text-muted">
              {clockEnabled
                ? 'Today: 15 September · Web source only'
                : 'Web clock is disabled by the Agency'}
            </p>
          </div>
        )}
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <nav className="flex flex-wrap gap-1" aria-label="Attendance records">
          {['Attendance', 'DTR', ...(admin ? ['Schedule and context', 'Manual entry'] : [])].map(
            (s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSection(s)}
                aria-current={section === s ? 'page' : undefined}
                className={`cursor-pointer rounded-[3px] px-3 py-2 text-xs font-[680] ${section === s ? 'bg-midnight text-paper' : 'text-muted hover:bg-canvas hover:text-ink'}`}
              >
                {s === 'Attendance' ? 'Attendance days' : s}
              </button>
            ),
          )}
        </nav>
        {section === 'Attendance' && (
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
                  navigation.navigate({ view: mode, selected: day.date, variant: null })
                }
                className={`cursor-pointer rounded-[2px] px-3 py-1.5 text-xs font-[650] ${view === mode ? 'bg-canvas text-ink' : 'text-muted'}`}
              >
                {mode[0]!.toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>
      {section === 'Attendance' && view !== 'form' && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap gap-3">
            <label className="text-xs text-muted">
              Search
              <input
                className={field}
                value={query}
                placeholder="Employee, date or context"
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
                {[
                  'All statuses',
                  'CALCULATED',
                  'EXCEPTION',
                  'FOR_REVIEW',
                  'APPROVED',
                  'LOCKED',
                ].map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
          </div>
          <span className="text-xs text-muted">
            {scenario === 'Empty' ? 0 : records.length} records · 1–15 September 2026
          </span>
        </div>
      )}
      <p role="status" className="text-sm text-cobalt">
        {notice}
      </p>
      {scenario === 'Permission denied' ? (
        <section className={panel}>
          <h2 className="font-semibold">You cannot view these attendance records</h2>
          <p className="mt-2 text-sm">
            Your active Agency Membership does not include access to this scope. Contact your Agency
            administrator.
          </p>
        </section>
      ) : scenario === 'Loading' ? (
        <section className={panel} aria-busy="true">
          <p>Loading attendance records…</p>
          <p className="mt-2 text-sm text-muted">
            Simulated loading state. Change the sample state above to continue.
          </p>
        </section>
      ) : scenario === 'Empty' ? (
        <section className={panel}>
          <h2 className="font-semibold">No attendance records in this period</h2>
          <p className="mt-2 text-sm">
            {admin
              ? 'Confirm the schedule assignment, then record an authorized manual event or enable the Agency web clock.'
              : 'Check the selected period. Contact your Attendance Administrator if expected records are missing.'}
          </p>
        </section>
      ) : section === 'Schedule and context' ? (
        <section className={panel}>
          <h2 className="text-lg font-semibold">Schedule and context</h2>
          <p className="mt-2 text-sm text-muted">
            Mara Santos · Effective-dated assignment history
          </p>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <div>
              <label className="block text-sm">
                Schedule
                <select className={field}>
                  <option>Regular · version 2</option>
                  <option>Flexible · illustrative</option>
                  <option>Shift · illustrative</option>
                  <option>Compressed · illustrative</option>
                </select>
              </label>
              <label className="mt-3 block text-sm">
                Work arrangement
                <select className={field}>
                  <option>Office</option>
                  <option>Hybrid</option>
                  <option>Field work</option>
                </select>
              </label>
              <label className="mt-3 block text-sm">
                Effective from
                <input className={field} type="date" defaultValue="2026-09-01" />
              </label>
              <Button
                className="mt-3"
                variant="primary"
                size="default"
                onClick={() =>
                  setNotice(
                    'Sample assignment draft reviewed. No schedule version was persisted or used to recalculate days.',
                  )
                }
              >
                Preview assignment draft
              </Button>
            </div>
            <div className="space-y-4 text-sm">
              <p>
                <strong>Holiday assignment</strong>
                <br />
                Agency calendar · no holiday in this sample week. Holiday authority and
                applicability await the input contract.
              </p>
              <p>
                <strong>Official business</strong>
                <br />9 September · OB-014 · certification for review
              </p>
              <p>
                <strong>Approved absence</strong>
                <br />
                10 September · LV-021 · linked leave record
              </p>
              <p>
                <strong>History</strong>
                <br />
                Version 1 ends 31 August. Version 2 starts 1 September. Past assignments remain
                visible.
              </p>
            </div>
          </div>
        </section>
      ) : section === 'Manual entry' ? (
        <section className={panel}>
          <h2 className="text-lg font-semibold">Authorized manual Attendance Event</h2>
          <p className="mt-2 text-sm text-muted">
            Mara Santos · New raw event, with actor and reason retained.
          </p>
          <form
            className="mt-5 max-w-lg space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setManual(true);
              setNotice(
                'Synthetic manual event captured. Historical events and calculated days are unchanged.',
              );
            }}
          >
            <label className="block text-sm">
              Event type
              <select className={field}>
                <option>Time in</option>
                <option>Break out</option>
                <option>Break in</option>
                <option>Time out</option>
              </select>
            </label>
            <label className="block text-sm">
              Event time · Asia/Manila
              <input
                required
                type="datetime-local"
                className={field}
                defaultValue="2026-09-15T08:00"
              />
            </label>
            <label className="block text-sm">
              Reason
              <textarea required className={field} />
            </label>
            <Button variant="primary" size="default" disabled={periodLocked}>
              Record sample event
            </Button>
          </form>
          {manual && (
            <p className="mt-3 text-sm">
              Manual event receipt · Actor: sample Attendance Administrator · Source: MANUAL
            </p>
          )}
        </section>
      ) : section === 'DTR' ? (
        dtr
      ) : view === 'form' ? (
        detail
      ) : (
        <section className={panel}>
          <div className="mb-4 grid gap-1">
            <h2 className="m-0 text-[17px] font-[720] tracking-[-0.02em] text-midnight">
              Attendance days
            </h2>
            <p className="m-0 text-[13px] leading-[1.55] text-muted">
              {view === 'tree'
                ? 'Open a record to review its events, calculation, correction and history.'
                : 'The same attendance records grouped by status. Open a card to review its Form.'}
            </p>
          </div>
          {view === 'tree' ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line text-[10px] font-bold uppercase tracking-[0.07em] text-muted">
                    {[
                      'Work date',
                      'Employee',
                      'Schedule / context',
                      'Status',
                      'Exception',
                      'DTR',
                    ].map((heading) => (
                      <th key={heading} scope="col" className="px-3 py-2">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr
                      key={record.date}
                      className={`border-b border-line/70 align-top ${selected === record.index ? 'bg-[#f1f5fb]' : ''}`}
                    >
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="cursor-pointer rounded-[2px] text-left text-sm font-[680] text-cobalt underline-offset-2 hover:underline"
                          onClick={() => openRecord(record.index)}
                        >
                          {record.date}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-sm">
                        Mara Santos
                        <span className="block text-xs text-muted">Administrative Officer II</span>
                      </td>
                      <td className="px-3 py-2 text-[13px]">{record.context}</td>
                      <td className="px-3 py-2">
                        <Status>{displayStatus(record)}</Status>
                      </td>
                      <td className="px-3 py-2 text-[13px]">
                        {!allApproved && record.state === 'EXCEPTION'
                          ? 'Missing time-out'
                          : !allApproved && record.state === 'FOR_REVIEW'
                            ? 'Certification for review'
                            : 'None'}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {allApproved || record.state === 'APPROVED'
                          ? 'Included'
                          : 'Pending approval'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {records.length === 0 && (
                <p className="py-6 text-center text-sm text-muted">
                  No attendance days match these filters.
                </p>
              )}
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2" aria-label="Attendance board">
              {(periodLocked
                ? ['LOCKED']
                : ['CALCULATED', 'EXCEPTION', 'FOR_REVIEW', 'APPROVED']
              ).map((status) => {
                const cards = records.filter((record) => displayStatus(record) === status);
                return (
                  <section
                    key={status}
                    className="grid min-w-[230px] flex-1 content-start gap-2 rounded-[3px] border border-line bg-canvas/60 p-3"
                  >
                    <h3 className="m-0 flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
                      {status.replaceAll('_', ' ')}
                      <span className="rounded-full border border-line bg-paper px-2 py-0.5 text-[10px] text-ink">
                        {cards.length}
                      </span>
                    </h3>
                    {cards.length === 0 ? (
                      <p className="m-0 rounded-[3px] border border-dashed border-line px-3 py-4 text-center text-xs text-muted">
                        No attendance days
                      </p>
                    ) : (
                      cards.map((record) => (
                        <button
                          key={record.date}
                          type="button"
                          onClick={() => openRecord(record.index)}
                          className={`grid cursor-pointer gap-1.5 rounded-[3px] border bg-paper px-3 py-3 text-left transition-colors ${selected === record.index ? 'border-cobalt bg-[#f1f5fb]' : 'border-line hover:border-[#aebed3]'}`}
                        >
                          <span className="text-xs font-bold text-cobalt">{record.date}</span>
                          <strong className="text-sm font-[680] text-midnight">Mara Santos</strong>
                          <span className="text-xs text-muted">{record.context}</span>
                          {!allApproved && record.state === 'EXCEPTION' && (
                            <span className="text-xs text-[#755421]">Missing time-out</span>
                          )}
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
          Attendance/DTR prototype · Synthetic records · No changes are saved
        </summary>
        <div className="mt-3 flex flex-wrap gap-4">
          <label>
            Preview role
            <select
              className={field}
              value={role}
              onChange={(e) => {
                setRole((e.target as unknown as { value: string }).value);
                setSection('Attendance');
                setNotice('');
              }}
            >
              <option>Employee</option>
              <option>Supervisor</option>
              <option>Attendance Administrator</option>
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
                'Ready to lock',
                'Completed',
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={clockEnabled}
              onChange={(e) =>
                setClockEnabled((e.target as unknown as { checked: boolean }).checked)
              }
            />
            Agency enables web clock
          </label>
        </div>
      </details>
      <details className={`${panel} text-sm`}>
        <summary className="cursor-pointer font-semibold">Review notes and visible state</summary>
        <p className="mt-3">
          Review: does the standard Tree/Form/Kanban pattern clearly distinguish raw events,
          calculated days, correction review and approved DTR records easiest to distinguish?
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            Role selection previews synthetic scopes only. Real authentication and the existing
            Agency shell remain in place.
          </li>
          <li>
            Calculation inputs, tolerances, holiday authority and absence precedence belong to
            “Define attendance calculation inputs”. No government rule is established here.
          </li>
          <li>
            Period certification, correction application, form authority and locked adjustments
            belong to “Define attendance finalization and correction contracts”.
          </li>
          <li>
            Reviewing a correction does not apply it or approve the Attendance Day. The completed
            fixture shows that later result separately.
          </li>
          <li>
            JO/COS self-service, biometric inputs, location tracking and payroll computation are
            outside this prototype.
          </li>
        </ul>
        <pre className="mt-4 overflow-auto rounded bg-canvas p-3 text-xs">
          {JSON.stringify(
            {
              view,
              role,
              scenario,
              section,
              employee: 'Mara Santos (synthetic)',
              selectedDate: day.date,
              correction: correctionState,
              periodLocked,
              clockEnabled,
              clocked,
              manualEventCaptured: manual,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
}
