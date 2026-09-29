import type { ReactNode } from 'react';
import { cn } from '../../lib/class-names';

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

/** Readable label and tone for one domain state; callers keep a `Record<State, StatusDisplay>`. */
export type StatusDisplay = { label: string; tone: StatusTone };

const toneClass: Record<StatusTone, string> = {
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
export function StatusTag({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-block rounded-tag border px-1.5 py-px text-caption font-[600] whitespace-nowrap',
        toneClass[tone],
      )}
    >
      {children}
    </span>
  );
}
