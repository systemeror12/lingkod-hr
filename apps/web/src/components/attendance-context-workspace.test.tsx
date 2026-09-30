import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  AttendanceContextWorkspace,
  manilaInstant,
  type AttendanceContextItem,
} from './attendance-context-workspace';

let search = new URLSearchParams();
vi.mock('./record-navigation', () => ({
  useRecordNavigation: () => ({ search, href: () => '', navigate: () => undefined }),
}));

const record: AttendanceContextItem = {
  id: '11111111-1111-4111-8111-111111111111',
  agencyId: '22222222-2222-4222-8222-222222222222',
  employee: { id: 'e1', employeeNumber: 'E-1', legalName: 'Alex Rivera' },
  contextType: 'TRAINING',
  coverageMode: 'WHOLE_WORK_DATE',
  workDate: '2026-09-08',
  startsAt: null,
  endsAt: null,
  reason: 'Records seminar',
  sourceType: null,
  sourceId: null,
  evidence: null,
  recordedBy: { membershipId: 'm1', legalName: 'Records Officer' },
  recordedAt: '2026-09-08T01:00:00.000Z',
};

function render(query: string, canCreate: boolean): string {
  search = new URLSearchParams(query);
  return renderToStaticMarkup(
    <AttendanceContextWorkspace
      agencyId={record.agencyId}
      canCreate={canCreate}
      initial={{ contexts: [record] }}
    />,
  );
}

describe('manilaInstant', () => {
  it('reads a wall-clock entry as Asia/Manila regardless of the browser zone', () => {
    expect(manilaInstant('2026-09-09T09:00')).toBe('2026-09-09T01:00:00.000Z');
    expect(manilaInstant('2026-09-09T11:30:15')).toBe('2026-09-09T03:30:15.000Z');
  });

  it('rejects entries that are not a date and time', () => {
    expect(() => manilaInstant('')).toThrow('Enter a valid exact start and end time.');
    expect(() => manilaInstant('2026-13-40T99:00')).toThrow();
  });
});

describe('AttendanceContextWorkspace', () => {
  it('does not say a reader cannot record merely for opening the Form view', () => {
    expect(render('view=form', false)).not.toContain('does not permit recording');
  });

  it('still refuses a reader who opens the record form', () => {
    expect(render('view=form&new=context', false)).toContain('does not permit recording');
  });

  it('shows the search and type filter that shape the Kanban board', () => {
    const html = render('view=kanban', true);
    expect(html).toContain('id="attendance-context-search"');
    expect(html).toContain('id="attendance-context-filter"');
  });
});
