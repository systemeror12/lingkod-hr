'use client';

// Throwaway: three Attendance/DTR layouts on /attendance-prototype?variant=A|B|C.
// All records and transitions are synthetic. No domain calculation or persistence.
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from './ui/button';

const variants = ['A', 'B', 'C'] as const;
const variantNames = { A: 'Exception review queue', B: 'Attendance calendar', C: 'DTR worksheet' };
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
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get('variant');
  const variant = raw === 'B' || raw === 'C' ? raw : 'A';
  const [role, setRole] = useState('Attendance Administrator');
  const [scenario, setScenario] = useState('Active');
  const [selected, setSelected] = useState(1);
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

  useEffect(() => {
    type PreviewKey = {
      key: string;
      altKey: boolean;
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
      target: { closest?: (selector: string) => unknown } | null;
      preventDefault(): void;
    };
    const browser = globalThis as unknown as {
      addEventListener(type: string, handler: (event: PreviewKey) => void): void;
      removeEventListener(type: string, handler: (event: PreviewKey) => void): void;
    };
    function key(event: PreviewKey) {
      if (
        !event.target?.closest ||
        event.target.closest('input, textarea, select, [contenteditable], [role="slider"]')
      )
        return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const next = new URLSearchParams(params.toString());
      next.set(
        'variant',
        variants[(variants.indexOf(variant) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]!,
      );
      router.replace(`${pathname}?${next}`, { scroll: false });
    }
    browser.addEventListener('keydown', key);
    return () => browser.removeEventListener('keydown', key);
  }, [params, pathname, router, variant]);

  function cycle(offset: number) {
    const next = new URLSearchParams(params.toString());
    next.set('variant', variants[(variants.indexOf(variant) + offset + 3) % 3]!);
    router.replace(`${pathname}?${next}`, { scroll: false });
  }

  const detail = (
    <section className={panel} aria-label="Attendance day detail">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{day.label} September</h2>
        <Status>{periodLocked ? 'LOCKED' : allApproved ? 'APPROVED' : day.state}</Status>
      </div>
      <p className="mt-1 text-sm text-muted">Mara Santos · Administrative Officer II</p>
      <dl className="mt-5 space-y-4 text-sm">
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
      {selected === 1 && (
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
      <details className="mt-5 border-t border-line pt-3 text-sm">
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
    <div className="workspace space-y-5 pb-28">
      <aside
        aria-label="Prototype review controls"
        className="rounded border border-cobalt bg-pale-blue p-4 text-sm"
      >
        <p className="font-semibold">
          Attendance/DTR prototype · Synthetic records · No changes are saved
        </p>
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
      </aside>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            {employee
              ? 'My attendance'
              : role === 'Supervisor'
                ? 'My direct reports'
                : 'Agency attendance'}{' '}
            · Example Agency
          </p>
          <h1 className="mt-2 font-semibold">Attendance and DTR</h1>
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
      <nav
        aria-label="Attendance sections"
        className="flex flex-wrap gap-2 border-b border-line pb-3"
      >
        {['Attendance', 'DTR', ...(admin ? ['Schedule and context', 'Manual entry'] : [])].map(
          (s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              aria-current={section === s ? 'page' : undefined}
              className={`cursor-pointer rounded px-4 py-2 text-sm font-semibold ${section === s ? 'bg-midnight text-paper' : 'bg-paper text-ink'}`}
            >
              {s}
            </button>
          ),
        )}
      </nav>
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
      ) : variant === 'A' ? (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]">
          <section className={panel}>
            <h2 className="text-lg font-semibold">
              {employee ? 'Days needing attention' : 'Review queue'}
            </h2>
            <p className="mt-2 text-sm text-muted">
              {employee ? 'Your records' : 'Mara Santos · selected Employee'} · exceptions first
            </p>
            <div className="mt-4 space-y-2">
              {[1, 2, 0, 3, 4].map((i) => (
                <button
                  key={i}
                  onClick={() => setSelected(i)}
                  className={`block w-full cursor-pointer rounded border p-4 text-left ${selected === i ? 'border-cobalt bg-pale-blue' : 'border-line bg-paper'}`}
                >
                  <span className="flex flex-wrap justify-between gap-2">
                    <strong>{days[i]!.label}</strong>
                    <Status>
                      {periodLocked ? 'LOCKED' : allApproved ? 'APPROVED' : days[i]!.state}
                    </Status>
                  </span>
                  <span className="mt-2 block text-sm">{days[i]!.result}</span>
                </button>
              ))}
            </div>
          </section>
          {detail}
        </div>
      ) : variant === 'B' ? (
        <div className="space-y-5">
          <section className={panel}>
            <h2 className="text-lg font-semibold">Mara Santos · Week of 7 September</h2>
            <p className="mt-2 text-sm text-muted">
              Read each day alongside its schedule, official business and leave context.
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              {days.map((d, i) => (
                <button
                  key={d.date}
                  onClick={() => setSelected(i)}
                  className={`min-h-44 cursor-pointer rounded border p-3 text-left ${i === selected ? 'border-cobalt bg-pale-blue' : 'border-line'}`}
                >
                  <strong className="block text-xl">{d.label}</strong>
                  <span className="my-3 block text-sm">{d.context}</span>
                  <Status>{periodLocked ? 'LOCKED' : allApproved ? 'APPROVED' : d.state}</Status>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              Showing one synthetic workweek; period boundaries and holiday assignment remain
              visible above.
            </p>
          </section>
          {detail}
        </div>
      ) : (
        <div className="space-y-5">
          <section className={panel}>
            <h2 className="text-lg font-semibold">Attendance worksheet · Mara Santos</h2>
            <p className="mt-2 text-sm text-muted">
              Review source, calculated result and approval side by side before DTR inclusion.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th scope="col">Date</th>
                    <th scope="col">Raw events / context</th>
                    <th scope="col">Calculated day</th>
                    <th scope="col">DTR</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d, i) => (
                    <tr
                      key={d.date}
                      className={`border-b border-line ${selected === i ? 'bg-pale-blue' : ''}`}
                    >
                      <td>
                        <button
                          className="cursor-pointer p-2 font-semibold text-cobalt underline"
                          onClick={() => setSelected(i)}
                        >
                          {d.label}
                        </button>
                      </td>
                      <td className="max-w-64 py-3">
                        <span className="block font-mono text-xs">{d.events}</span>
                        <span className="text-muted">{d.context}</span>
                      </td>
                      <td>
                        <Status>
                          {periodLocked ? 'LOCKED' : allApproved ? 'APPROVED' : d.state}
                        </Status>
                      </td>
                      <td>
                        {allApproved || d.state === 'APPROVED' ? 'Included' : 'Pending approval'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="grid items-start gap-5 xl:grid-cols-2">
            {detail}
            {dtr}
          </div>
        </div>
      )}
      <details className={`${panel} text-sm`}>
        <summary className="cursor-pointer font-semibold">Review notes and visible state</summary>
        <p className="mt-3">
          Question: which layout makes raw events, calculated days, correction review and approved
          DTR records easiest to distinguish?
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
              variant,
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
      {process.env.NODE_ENV !== 'production' && (
        <div
          aria-label="Prototype variant switcher"
          className="fixed bottom-5 left-1/2 z-50 flex max-w-[95vw] -translate-x-1/2 items-center gap-4 rounded-full bg-midnight px-4 py-3 text-paper shadow-lg"
        >
          <button
            aria-label="Previous variant"
            className="cursor-pointer px-2 py-1"
            onClick={() => cycle(-1)}
          >
            ←
          </button>
          <span className="text-center text-xs sm:text-sm">
            {variant} · {variantNames[variant]}
          </span>
          <button
            aria-label="Next variant"
            className="cursor-pointer px-2 py-1"
            onClick={() => cycle(1)}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
