import { expect, it } from 'vitest';
import { obligationStatus, remainingQuantity } from './mandatory-leave';

const subject = { result: 'SUBJECT', requiredQuantity: '5.0000', fulfilledQuantity: '2.0000' };

it('labels an Employee without an assessment as not yet evaluated', () => {
  expect(obligationStatus(null)).toEqual({ label: 'Not yet evaluated', tone: 'neutral' });
});

it('labels each stored result as recorded, and a fulfilled SUBJECT obligation as Met', () => {
  expect(obligationStatus(subject)).toEqual({ label: 'SUBJECT', tone: 'warning' });
  expect(obligationStatus({ ...subject, fulfilledQuantity: '5.0000' })).toEqual({
    label: 'Met',
    tone: 'success',
  });
  expect(obligationStatus({ ...subject, fulfilledQuantity: '6.5000' }).label).toBe('Met');
  expect(
    obligationStatus({
      result: 'NOT_SUBJECT',
      requiredQuantity: null,
      fulfilledQuantity: '0.0000',
    }),
  ).toEqual({ label: 'NOT_SUBJECT', tone: 'neutral' });
  expect(
    obligationStatus({ result: 'INDETERMINATE', requiredQuantity: null, fulfilledQuantity: null }),
  ).toEqual({ label: 'INDETERMINATE', tone: 'danger' });
});

it('reports the remaining quantity only for a SUBJECT obligation, never below zero', () => {
  expect(remainingQuantity(subject)).toBe('3');
  expect(remainingQuantity({ ...subject, fulfilledQuantity: '0.5000' })).toBe('4.5');
  expect(remainingQuantity({ ...subject, fulfilledQuantity: '7.0000' })).toBe('0');
  expect(
    remainingQuantity({ result: 'NOT_SUBJECT', requiredQuantity: null, fulfilledQuantity: '0' }),
  ).toBeNull();
});
