import { describe, expect, it } from 'vitest';
import {
  renderDtrPreviewDocument,
  renderDtrSystemViewDocument,
  zonedDateTimeParts,
} from './dtrs.render';
import {
  DTR_MANIFEST_FORMAT,
  type DtrManifest,
  type DtrManifestDay,
  type DtrPreview,
} from './dtrs.types';

const totals = {
  expectedMinutes: 480,
  workedMinutes: 480,
  coverageMinutes: 480,
  lateMinutes: 0,
  undertimeMinutes: 0,
  absenceMinutes: 0,
  officialBusinessMinutes: 0,
  officialTravelMinutes: 0,
  trainingMinutes: 0,
  approvedAbsenceMinutes: 0,
  postedLeaveMinutes: 0,
  outsideScheduleMinutes: 0,
  statutoryNightWindowMinutes: 0,
};

const ordinaryDay: DtrManifestDay = {
  attendanceDayId: 'day-1',
  calculationVersion: 2,
  workDate: '2026-06-01',
  dayClassification: 'SCHEDULED',
  status: 'APPROVED',
  totals,
  schedule: {
    dayRuleId: 'rule-1',
    ruleType: 'FIXED',
    timezone: 'Asia/Manila',
    dutyStartTime: '08:00',
    dutyEndTime: '17:00',
    endNextCalendarDay: false,
    eventPattern: 'WITH_BREAK_EVENTS',
  },
  sources: {
    fingerprint: 'f'.repeat(64),
    scheduleAssignmentId: 'assignment-1',
    workScheduleVersionId: 'schedule-version-1',
    workArrangementVersionId: 'arrangement-version-1',
    holidayCalendarVersionId: 'calendar-version-1',
  },
  presentation: [
    {
      slot: 'AM_IN',
      label: 'AM In',
      eventId: 'event-1',
      sourceType: 'ATTENDANCE_EVENT',
      eventType: 'TIME_IN',
      eventTime: '2026-06-01T00:00:00.000Z',
      localDate: '2026-06-01',
      localTime: '08:00:00',
    },
    {
      slot: 'AM_OUT',
      label: 'AM Out',
      eventId: 'event-2',
      sourceType: 'ATTENDANCE_EVENT',
      eventType: 'BREAK_OUT',
      eventTime: '2026-06-01T04:00:00.000Z',
      localDate: '2026-06-01',
      localTime: '12:00:00',
    },
  ],
  segments: [],
  exceptions: [],
};

const overnightDay: DtrManifestDay = {
  ...ordinaryDay,
  attendanceDayId: 'day-2',
  calculationVersion: 1,
  workDate: '2026-06-02',
  status: 'CALCULATED',
  presentation: [
    {
      slot: null,
      label: 'Duty start',
      eventId: 'effect-1',
      sourceType: 'ATTENDANCE_CORRECTION_EFFECT',
      eventType: 'TIME_IN',
      eventTime: '2026-06-02T14:00:00.000Z',
      localDate: '2026-06-02',
      localTime: '22:00:00',
    },
    {
      slot: null,
      label: 'Duty end',
      eventId: 'event-4',
      sourceType: 'ATTENDANCE_EVENT',
      eventType: 'TIME_OUT',
      eventTime: '2026-06-02T22:00:00.000Z',
      localDate: '2026-06-03',
      localTime: '06:00:00',
    },
  ],
};

const manifest: DtrManifest = {
  format: DTR_MANIFEST_FORMAT,
  classification: 'ORIGINAL',
  outputType: 'PRINTABLE_SYSTEM_VIEW',
  predecessorDtrDocumentId: null,
  period: {
    id: 'period-1',
    code: '2026-06-1',
    dateFrom: '2026-06-01',
    dateTo: '2026-06-15',
    status: 'FINALIZED',
  },
  version: {
    id: 'version-1',
    versionNo: 1,
    predecessorVersionId: null,
    lockedAt: '2026-06-16T01:30:00.000Z',
    lockedByMembershipId: 'membership-1',
    reviewedAt: '2026-06-16T01:00:00.000Z',
    reviewedByMembershipId: 'membership-2',
  },
  employee: { id: 'employee-1', employeeNumber: 'E2E-0001', legalName: 'Alex Rivera' },
  generatedAt: '2026-06-16T01:30:05.000Z',
  days: [ordinaryDay, overnightDay],
};

describe('zonedDateTimeParts', () => {
  it('renders the wall-clock date and time in the requested time zone', () => {
    expect(zonedDateTimeParts(new Date('2026-06-01T00:00:00.000Z'), 'Asia/Manila')).toEqual({
      localDate: '2026-06-01',
      localTime: '08:00:00',
    });
    expect(zonedDateTimeParts(new Date('2026-06-02T22:00:00.000Z'), 'Asia/Manila')).toEqual({
      localDate: '2026-06-03',
      localTime: '06:00:00',
    });
  });
});

describe('renderDtrSystemViewDocument', () => {
  it('identifies the period, version, classification, lock and output type', () => {
    const html = renderDtrSystemViewDocument(manifest, { agencyName: 'National Archives Office' });
    expect(html).toContain('Daily Time Record');
    expect(html).toContain('Printable System View');
    expect(html).toContain('National Archives Office');
    expect(html).toContain('Alex Rivera (E2E-0001)');
    expect(html).toContain('2026-06-1');
    expect(html).toContain('Version 1 · ORIGINAL');
    expect(html).toContain('2026-06-16T01:30:00.000Z');
  });

  it('projects daytime events onto the AM/PM slots and overnight duty onto dated labels', () => {
    const html = renderDtrSystemViewDocument(manifest, { agencyName: 'Agency' });
    expect(html).toContain('AM In');
    expect(html).toContain('AM Out');
    expect(html).toContain('08:00:00');
    expect(html).toContain('Duty start');
    expect(html).toContain('Duty end');
    expect(html).toContain('2026-06-03 06:00:00');
  });

  it('makes no official-form, signature, certification, or QR claim', () => {
    const html = renderDtrSystemViewDocument(manifest, { agencyName: 'Agency' });
    const withoutDisclaimer = html.replace(/<p class="dtr-disclaimer">[\s\S]*?<\/p>/, '');
    expect(withoutDisclaimer).not.toMatch(/signature/i);
    expect(withoutDisclaimer).not.toMatch(/certif/i);
    expect(withoutDisclaimer).not.toMatch(/\bQR\b/);
    expect(withoutDisclaimer).not.toMatch(/official form/i);
    expect(html).toContain('not a nationally prescribed or agency-approved official form');
  });

  it('escapes source values', () => {
    const html = renderDtrSystemViewDocument(
      {
        ...manifest,
        employee: { ...manifest.employee, legalName: '<script>alert(1)</script>' },
      },
      { agencyName: 'Agency' },
    );
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

describe('renderDtrPreviewDocument', () => {
  it('marks the preview unfinalized and omits version and lock facts', () => {
    const preview: DtrPreview = {
      unfinalized: true,
      period: manifest.period,
      employee: manifest.employee,
      days: manifest.days,
    };
    const html = renderDtrPreviewDocument(preview, { agencyName: 'Agency' });
    expect(html).toContain('UNFINALIZED PREVIEW');
    expect(html).toContain('explicitly unfinalized');
    expect(html).not.toContain('Locked at');
    expect(html).not.toContain('Version 1');
  });
});
