import type { ComponentProps, ReactNode } from 'react';
import { Panel } from './ui/panel';
import { StatusTag, type StatusTone } from './ui/status-tag';

/** Padded `Panel` that opens with a line of guidance on what the panel records. */
export function GuidedPanel({
  description,
  children,
  ...props
}: Omit<ComponentProps<typeof Panel>, 'flush'> & { description?: string }) {
  return (
    <Panel {...props}>
      <div className="grid gap-4">
        {description ? <p className="m-0 text-small text-ink-muted">{description}</p> : null}
        {children}
      </div>
    </Panel>
  );
}

/** One labelled fact inside a `dl`. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 border-b border-border-subtle py-2.5 last:border-b-0">
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="m-0 text-body text-ink">{children}</dd>
    </div>
  );
}

const statusTone: Record<string, StatusTone> = {
  APPROVED: 'success',
  PUBLISHED: 'success',
  COMPLETED: 'success',
  FOR_REVIEW: 'warning',
  FOR_APPROVAL: 'warning',
  SCHEDULED: 'warning',
  REJECTED: 'danger',
  CANCELLED: 'danger',
  NO_SHOW: 'danger',
  CLOSED: 'neutral',
  REPUBLISHED: 'neutral',
};

/** A Recruitment state such as `FOR_REVIEW`, shown as `FOR REVIEW`. */
export function RecordStatus({ status }: { status: string }) {
  return <StatusTag tone={statusTone[status] ?? 'info'}>{status.replaceAll('_', ' ')}</StatusTag>;
}
