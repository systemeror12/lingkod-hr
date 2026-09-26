import { describe, expect, it } from 'vitest';
import { cn } from './class-names';

describe('cn', () => {
  it('keeps a type-scale size beside a text colour', () => {
    expect(cn('text-body', 'text-ink')).toBe('text-body text-ink');
    expect(cn('text-page-title', 'text-ink-muted')).toBe('text-page-title text-ink-muted');
  });

  it('lets a later type-scale size replace an earlier size', () => {
    expect(cn('text-caption', 'text-body')).toBe('text-body');
    expect(cn('text-sm', 'text-small')).toBe('text-small');
  });

  it('lets a later radius replace a shape token', () => {
    expect(cn('rounded-control', 'rounded-full')).toBe('rounded-full');
    expect(cn('rounded-[3px]', 'rounded-panel')).toBe('rounded-panel');
  });
});
