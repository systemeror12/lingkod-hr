import type { ReactNode } from 'react';

/**
 * Identity block for a record page, placed inside `PageHeader`. `status` takes a `StatusTag`;
 * `facts` are the few key values a user checks before acting on the record.
 */
export function RecordHeader({
  name,
  description,
  status,
  facts,
  actions,
}: {
  name: string;
  description?: ReactNode;
  status?: ReactNode;
  facts: { label: string; value: ReactNode }[];
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 pt-2 pb-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="m-0 text-page-title text-ink">{name}</h1>
          {status}
        </div>
        {description ? <p className="m-0 mt-1 text-body text-ink-muted">{description}</p> : null}
        {facts.length > 0 ? (
          <dl className="m-0 mt-4 flex flex-wrap gap-x-10 gap-y-2">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt className="text-caption text-ink-muted">{fact.label}</dt>
                <dd className="m-0 text-body font-[600] text-ink">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
