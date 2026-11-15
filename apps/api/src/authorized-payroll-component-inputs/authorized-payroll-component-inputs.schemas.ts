import { z } from 'zod';

export const AUTHORIZED_INPUT_SCOPES = ['AGENCY', 'EMPLOYEE'] as const;
export const AUTHORIZED_INPUT_VALUE_KINDS = ['AMOUNT', 'RATE', 'QUANTITY'] as const;
export const AUTHORIZED_INPUT_PAYMENT_SCHEDULES = ['ONCE', 'EACH_REGULAR_PERIOD'] as const;
export const AUTHORIZED_INPUT_STATUSES = ['RECORDED', 'APPROVED', 'CANCELLED'] as const;

export type AuthorizedInputScope = (typeof AUTHORIZED_INPUT_SCOPES)[number];
export type AuthorizedInputValueKind = (typeof AUTHORIZED_INPUT_VALUE_KINDS)[number];
export type AuthorizedInputPaymentSchedule = (typeof AUTHORIZED_INPUT_PAYMENT_SCHEDULES)[number];
export type AuthorizedInputStatus = (typeof AUTHORIZED_INPUT_STATUSES)[number];

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Enter a valid calendar date.');

// A positive value that fits numeric(19,8).
const value = z
  .string()
  .regex(/^\d{1,11}(\.\d{1,8})?$/, 'Enter a value with up to eight decimal places.')
  .refine((text) => /[1-9]/.test(text), 'The value must be greater than zero.');

/**
 * What the recorder enters. Every field is required: the authority, its
 * source, the effective period, the scope, one value, and the payment
 * schedule. There is no formula and no free-form pay item.
 */
export const recordAuthorizedInputSchema = z
  .object({
    payComponentId: z.uuid(),
    scope: z.enum(AUTHORIZED_INPUT_SCOPES),
    /** The named Employee for `EMPLOYEE` scope; `null` for the whole Agency. */
    employeeId: z.uuid().nullable(),
    valueKind: z.enum(AUTHORIZED_INPUT_VALUE_KINDS),
    value,
    paymentSchedule: z.enum(AUTHORIZED_INPUT_PAYMENT_SCHEDULES),
    authorityDocumentVersionId: z.uuid(),
    sourceReference: z.string().trim().min(1).max(500),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullable(),
  })
  .strict()
  .refine((input) => (input.scope === 'EMPLOYEE') === (input.employeeId !== null), {
    message: 'Name an Employee for EMPLOYEE scope, and none for the whole Agency.',
    path: ['employeeId'],
  })
  .refine((input) => input.effectiveTo === null || input.effectiveTo >= input.effectiveFrom, {
    message: 'effectiveTo is on or after effectiveFrom.',
    path: ['effectiveTo'],
  });

export type RecordAuthorizedInput = z.input<typeof recordAuthorizedInputSchema>;
