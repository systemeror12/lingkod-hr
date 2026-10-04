import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../lib/class-names';

/** `numeric` right-aligns and keeps figures on one line; `date` keeps dates on one line. */
type CellKind = 'text' | 'numeric' | 'date';

const kindClass: Record<CellKind, string> = {
  text: '',
  numeric: 'text-right whitespace-nowrap',
  date: 'whitespace-nowrap',
};

/** Full-width data table that scrolls sideways when the container is narrow. */
export function Table({ className, ...props }: ComponentPropsWithoutRef<'table'>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full border-collapse text-small', className)} {...props} />
    </div>
  );
}

/** Column header cell; `scope="col"` unless the caller overrides it. */
export function Th({
  kind = 'text',
  className,
  ...props
}: ComponentPropsWithoutRef<'th'> & { kind?: CellKind }) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-border bg-canvas px-4 py-2 text-left text-caption font-[650] text-ink',
        kindClass[kind],
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  kind = 'text',
  className,
  ...props
}: ComponentPropsWithoutRef<'td'> & { kind?: CellKind }) {
  return (
    <td
      className={cn(
        'border-b border-border-subtle px-4 py-2.5 align-top',
        kindClass[kind],
        className,
      )}
      {...props}
    />
  );
}

/** Body cell that names its row, such as a record's official name. */
export function RowHeader({ className, ...props }: ComponentPropsWithoutRef<'th'>) {
  return (
    <th
      scope="row"
      className={cn(
        'border-b border-border-subtle px-4 py-2.5 text-left align-top font-[600] text-ink',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Body row with a hover tint. `selected` marks the row whose record is open elsewhere on the
 * page and exposes it as the current item.
 */
export function Tr({
  selected = false,
  className,
  ...props
}: ComponentPropsWithoutRef<'tr'> & { selected?: boolean }) {
  return (
    <tr
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'hover:bg-canvas',
        selected && 'bg-primary/8 shadow-[inset_3px_0_0_var(--color-primary)] hover:bg-primary/8',
        className,
      )}
      {...props}
    />
  );
}

/** Result count under a table, from the rows actually shown and the matching total. */
export function TableFooter({
  shown,
  total,
  children,
}: {
  shown: number;
  total: number;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-2 px-4 py-2.5 text-caption text-ink-muted">
      <span>
        Showing {shown} of {total}
      </span>
      {children}
    </div>
  );
}
