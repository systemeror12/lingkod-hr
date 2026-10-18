import type { FormEvent } from 'react';
import { AttendanceRequestError, type ActivationValues, type EvidenceOption } from './types';

export function dateLabel(value: string): string {
  const date = new Date(value.includes('T') ? value : value.slice(0, 10) + 'T00:00:00.000Z');
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

export function errorMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const error = (value as { error?: { message?: unknown } }).error;
  return typeof error?.message === 'string' ? error.message : fallback;
}

export function describeRequestError(error: unknown, fallback: string): string {
  if (error instanceof AttendanceRequestError && error.exceptionType) {
    return error.message + ' · Cause: ' + label(error.exceptionType);
  }
  return error instanceof Error ? error.message : fallback;
}

export function label(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function parseEvidenceOptions(value: unknown): EvidenceOption[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as { documents?: unknown }).documents)
  ) {
    throw new Error('The Agency Document response was invalid.');
  }
  return (value as { documents: EvidenceOption[] }).documents;
}

export function emptyActivation(): ActivationValues {
  return { authorityDocumentVersionId: '', approvingAuthority: '', reason: '' };
}

export function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

export function targetChecked(event: { currentTarget: EventTarget }): boolean {
  return (event.currentTarget as unknown as { checked: boolean }).checked;
}

export function validForm(event: FormEvent<HTMLFormElement>): boolean {
  return (event.currentTarget as unknown as { reportValidity(): boolean }).reportValidity();
}

export const sectionTitleClass = 'm-0 text-panel-title text-ink';
export const noteClass =
  'm-0 border-l-2 border-primary bg-canvas px-3 py-2.5 text-small text-ink-muted';
export const rowBoxClass = 'rounded-control border border-border bg-canvas p-3';
export const recordLinkClass =
  'w-fit cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-primary hover:underline';

export function countLabel(count: number, noun: string): string {
  return count === 1 ? '1 ' + noun : count + ' ' + noun + 's';
}
