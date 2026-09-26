import type { ReactNode } from 'react';

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

const toneClass: Record<Tone, string> = {
  success: 'border-success text-success',
  warning: 'border-warning text-warning',
  danger: 'border-danger text-danger',
  neutral: 'border-neutral text-neutral',
  info: 'border-info text-info',
};

/**
 * Outlined state label. Callers map their domain state to a tone, for example
 * `{ ACTIVE: 'success', SEPARATED: 'neutral' }`, and pass the readable state as children.
 */
export function StatusTag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-block rounded-tag border px-1.5 py-px text-caption font-[600] whitespace-nowrap ${toneClass[tone]}`}
    >
      {children}
    </span>
  );
}
