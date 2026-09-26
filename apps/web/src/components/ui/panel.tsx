import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/class-names';

/**
 * Titled content block. The body is padded; set `flush` when the body is a `Table` so rows
 * reach the panel edges.
 */
export function Panel({
  title,
  actions,
  flush = false,
  className,
  children,
}: {
  title: string;
  actions?: ReactNode;
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn('min-w-0 rounded-panel border border-border bg-surface', className)}
    >
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-2">
        <h2 id={titleId} className="m-0 text-panel-title text-ink">
          {title}
        </h2>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {flush ? children : <div className="p-4">{children}</div>}
    </section>
  );
}
