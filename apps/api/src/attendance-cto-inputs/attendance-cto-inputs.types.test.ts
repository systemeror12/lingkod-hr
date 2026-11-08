import { describe, expect, it } from 'vitest';
import {
  assertValidVoidCtoInput,
  ctoInputFacts,
  type RecordCtoInput,
} from './attendance-cto-inputs.types';

const whole: RecordCtoInput = {
  sourceKey: 'cto-request-1:2026-01-05',
  employeeId: '00000000-0000-4000-8000-000000000001',
  sourceType: 'CtoRequest',
  sourceId: '00000000-0000-4000-8000-000000000002',
  workDate: '2026-01-05',
  coverageMode: 'WHOLE_WORK_DATE',
};
const timed: RecordCtoInput = {
  ...whole,
  coverageMode: 'TIMED',
  startsAt: '2026-01-05T08:00:00+08:00',
  endsAt: '2026-01-05T12:00:00+08:00',
};

describe('ctoInputFacts', () => {
  it('accepts a whole Work Date and a timed interval', () => {
    expect(ctoInputFacts(whole)).toEqual({
      workDate: new Date('2026-01-05T00:00:00.000Z'),
      startsAt: null,
      endsAt: null,
    });
    expect(ctoInputFacts(timed)).toMatchObject({
      startsAt: new Date('2026-01-05T00:00:00.000Z'),
      endsAt: new Date('2026-01-05T04:00:00.000Z'),
    });
  });

  it.each([
    ['a blank source key', { ...whole, sourceKey: '  ' }, /source key/i],
    ['a blank source type', { ...whole, sourceType: '' }, /source reference/i],
    ['an unknown coverage mode', { ...whole, coverageMode: 'NONE' as never }, /coverage mode/i],
    ['an invalid Work Date', { ...whole, workDate: '2026-02-30' }, /calendar date/i],
    ['an unparseable instant', { ...timed, startsAt: 'not-a-time' }, /interval/i],
    ['whole-day CTO with an interval', { ...whole, startsAt: timed.startsAt }, /no interval/i],
    ['timed CTO without an end', { ...timed, endsAt: undefined }, /ends after/i],
    ['timed CTO without a start', { ...timed, startsAt: undefined }, /ends after/i],
    ['timed CTO ending at its start', { ...timed, endsAt: timed.startsAt }, /ends after/i],
  ])('rejects %s', (_label, input, message) => {
    expect(() => ctoInputFacts(input)).toThrow(message);
    expect(() => ctoInputFacts(input)).toThrow(
      expect.objectContaining({ code: 'CTO_INPUT_INVALID' }),
    );
  });
});

describe('assertValidVoidCtoInput', () => {
  const voidInput = {
    sourceKey: 'cto-cancellation-1:2026-01-05',
    employeeId: whole.employeeId,
    predecessorInputId: '00000000-0000-4000-8000-000000000003',
    sourceType: 'CtoCancellation',
    sourceId: '00000000-0000-4000-8000-000000000004',
  };

  it('accepts a void naming its effect key and source', () => {
    expect(() => assertValidVoidCtoInput(voidInput)).not.toThrow();
  });

  it.each([
    ['a blank effect key', { ...voidInput, sourceKey: '  ' }],
    ['a blank source type', { ...voidInput, sourceType: '' }],
  ])('rejects %s', (_label, input) => {
    expect(() => assertValidVoidCtoInput(input)).toThrow(
      expect.objectContaining({ code: 'CTO_INPUT_INVALID' }),
    );
  });
});
