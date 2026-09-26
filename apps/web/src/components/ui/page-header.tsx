import Link from 'next/link';
import type { ReactNode } from 'react';

export type Breadcrumb = { label: string; href?: string };

/**
 * White band at the top of a screen. Give it a `title` for a register or queue, or pass a
 * `RecordHeader` as `children` for a record page. `actions` sit beside the title; record pages
 * pass theirs to `RecordHeader`. `tabs` takes a `SectionTabList`. Render it first in a page:
 * negative margins cancel the shell's workspace padding so the band spans the full width.
 */
export function PageHeader({
  breadcrumbs,
  title,
  actions,
  tabs,
  children,
}: {
  breadcrumbs: Breadcrumb[];
  title?: string;
  /** Rendered only with `title`. */
  actions?: ReactNode;
  tabs?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="-mx-4 -mt-6 mb-6 border-b border-border bg-surface px-4 pt-5 min-[621px]:-mx-6 min-[621px]:px-6 min-[980px]:-mx-8 min-[980px]:px-8">
      <nav aria-label="Breadcrumb">
        <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0 text-caption text-ink-muted">
          {breadcrumbs.map((crumb, index) => (
            <li key={index} className="flex gap-1.5">
              {index > 0 ? <span aria-hidden="true">/</span> : null}
              {crumb.href ? (
                <Link className="text-ink-muted hover:text-ink" href={crumb.href}>
                  {crumb.label}
                </Link>
              ) : (
                crumb.label
              )}
            </li>
          ))}
        </ol>
      </nav>
      {title ? (
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 pt-1 pb-5">
          <h1 className="m-0 text-page-title text-ink">{title}</h1>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
      {tabs}
    </header>
  );
}
