import type { DtrManifest, DtrManifestDay, DtrPresentationEntry, DtrPreview } from './dtrs.types';

/** The calendar date and wall-clock time of one instant in an IANA time zone. */
export function zonedDateTimeParts(
  instant: Date,
  timezone: string,
): { localDate: string; localTime: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  const hour = value('hour') === '24' ? '00' : value('hour');
  return {
    localDate: `${value('year')}-${value('month')}-${value('day')}`,
    localTime: `${hour}:${value('minute')}:${value('second')}`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function minutesLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}:${String(remainder).padStart(2, '0')}`;
}

function presentationLabel(entry: DtrPresentationEntry): string {
  const time = entry.slot === null ? `${entry.localDate} ${entry.localTime}` : entry.localTime;
  return `${escapeHtml(entry.label)} <strong>${escapeHtml(time)}</strong>`;
}

function dayPresentation(day: DtrManifestDay): string {
  if (day.presentation.length === 0) {
    return '<span class="dtr-muted">No recorded event presentation.</span>';
  }
  return `<ul class="dtr-presentation">${day.presentation
    .map(
      (entry) =>
        `<li${entry.slot === null ? ' class="dtr-presentation-duty"' : ''}>${presentationLabel(entry)}</li>`,
    )
    .join('')}</ul>`;
}

function dayExceptionNote(day: DtrManifestDay): string {
  if (day.exceptions.length === 0) return '';
  const open = day.exceptions.filter((exception) => exception.status === 'OPEN');
  if (open.length === 0) return '';
  return `<p class="dtr-exception">${open.length} unresolved Attendance Exception${
    open.length === 1 ? '' : 's'
  }: ${escapeHtml(open.map((exception) => exception.exceptionType).join(', '))}</p>`;
}

function daysTable(days: readonly DtrManifestDay[]): string {
  const rows = days
    .map(
      (day) => `<tr>
      <td><strong>${escapeHtml(day.workDate)}</strong><br /><span class="dtr-muted">${escapeHtml(
        day.dayClassification.replaceAll('_', ' '),
      )} · v${day.calculationVersion}</span></td>
      <td>${dayPresentation(day)}${dayExceptionNote(day)}</td>
      <td class="dtr-number">${minutesLabel(day.totals.expectedMinutes)}</td>
      <td class="dtr-number">${minutesLabel(day.totals.workedMinutes)}</td>
      <td class="dtr-number">${minutesLabel(day.totals.coverageMinutes)}</td>
      <td class="dtr-number">${minutesLabel(day.totals.lateMinutes)}</td>
      <td class="dtr-number">${minutesLabel(day.totals.undertimeMinutes)}</td>
      <td class="dtr-number">${minutesLabel(day.totals.absenceMinutes)}</td>
    </tr>`,
    )
    .join('');
  return `<table class="dtr-table">
    <thead>
      <tr>
        <th scope="col">Work date</th>
        <th scope="col">DTR presentation</th>
        <th scope="col">Expected</th>
        <th scope="col">Worked</th>
        <th scope="col">Coverage</th>
        <th scope="col">Tardiness</th>
        <th scope="col">Undertime</th>
        <th scope="col">Absence</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function definitionList(entries: ReadonlyArray<[string, string]>): string {
  return `<dl class="dtr-facts">${entries
    .map(
      ([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
    )
    .join('')}</dl>`;
}

function documentShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; background: #ffffff; color: #101820; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; }
  .dtr { max-width: 1040px; margin: 0 auto; }
  .dtr-kicker { margin: 0; font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #475569; }
  h1 { margin: 4px 0 2px; font-size: 22px; }
  .dtr-unfinalized { margin: 6px 0 0; padding: 6px 10px; border: 1px solid #b45309; background: #fef3c7; color: #7c2d12; font-weight: 700; letter-spacing: .08em; }
  .dtr-facts { display: grid; gap: 6px 24px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin: 16px 0; padding: 12px 0; border-top: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1; }
  .dtr-facts div { display: flex; gap: 8px; }
  .dtr-facts dt { min-width: 120px; font-weight: 600; color: #475569; }
  .dtr-facts dd { margin: 0; }
  .dtr-disclaimer { margin: 0 0 18px; color: #475569; font-size: 12px; }
  .dtr-table { width: 100%; border-collapse: collapse; }
  .dtr-table th, .dtr-table td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; vertical-align: top; }
  .dtr-table th { background: #f1f5f9; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .dtr-number { text-align: right; font-variant-numeric: tabular-nums; }
  .dtr-presentation { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 4px 14px; }
  .dtr-presentation-duty { flex-basis: 100%; }
  .dtr-muted { color: #64748b; }
  .dtr-exception { margin: 6px 0 0; color: #b91c1c; font-weight: 600; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function renderDtrSystemViewDocument(
  manifest: DtrManifest,
  options: { agencyName: string },
): string {
  const facts: Array<[string, string]> = [
    ['Agency', options.agencyName],
    ['Employee', `${manifest.employee.legalName} (${manifest.employee.employeeNumber})`],
    [
      'Attendance Period',
      `${manifest.period.code} · ${manifest.period.dateFrom} to ${manifest.period.dateTo}`,
    ],
    ['Version', `Version ${manifest.version.versionNo} · ${manifest.classification}`],
    ['Output', manifest.outputType.replaceAll('_', ' ')],
    ['Locked at', manifest.version.lockedAt ?? '—'],
    ['Generated at', manifest.generatedAt],
  ];
  if (manifest.predecessorDtrDocumentId) {
    facts.push(['Corrects DTR', manifest.predecessorDtrDocumentId]);
  }
  const body = `<article class="dtr">
  <p class="dtr-kicker">LingkodHR · Printable System View</p>
  <h1>Daily Time Record</h1>
  ${definitionList(facts)}
  <p class="dtr-disclaimer">This Printable System View is a system-generated rendering of HRIS attendance records. It is not a nationally prescribed or agency-approved official form and it carries no signature block, certification, QR code, or official-form claim.</p>
  ${daysTable(manifest.days)}
</article>`;
  return documentShell(
    `Daily Time Record ${manifest.period.code} v${manifest.version.versionNo}`,
    body,
  );
}

export function renderDtrPreviewDocument(
  preview: DtrPreview,
  options: { agencyName: string },
): string {
  const facts: Array<[string, string]> = [
    ['Agency', options.agencyName],
    ['Employee', `${preview.employee.legalName} (${preview.employee.employeeNumber})`],
    [
      'Attendance Period',
      `${preview.period.code} · ${preview.period.dateFrom} to ${preview.period.dateTo}`,
    ],
  ];
  const body = `<article class="dtr">
  <p class="dtr-kicker">LingkodHR · Printable System View</p>
  <h1>Daily Time Record</h1>
  <p class="dtr-unfinalized">UNFINALIZED PREVIEW</p>
  ${definitionList(facts)}
  <p class="dtr-disclaimer">This preview is derived from the current Attendance Day versions of the Attendance Period. It is explicitly unfinalized and is neither an approved nor a Finalized Daily Time Record. It is not a nationally prescribed or agency-approved official form.</p>
  ${daysTable(preview.days)}
</article>`;
  return documentShell(`Daily Time Record Preview ${preview.period.code}`, body);
}
