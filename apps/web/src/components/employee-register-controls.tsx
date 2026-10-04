'use client';

import { useRouter } from 'next/navigation';
import { useOptimistic, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import {
  EMPLOYEE_SERVICE_STATUSES,
  employeeRegisterHref,
  type EmployeeRegisterParams,
} from '../lib/employee-register';
import { serviceStatusLabel } from './employee-directory';
import { Button } from './ui/button';
import { FilterPanel, type FilterSelection } from './ui/filter-panel';
import { inputClass } from './ui/field';

export interface EmployeeRegisterFacets {
  serviceStatus: Record<string, number>;
  membership: { LINKED: number; UNLINKED: number };
}

/**
 * Search box and filter panel for the Employee register. Every change navigates to a new
 * `/employees` URL on page 1, so the server component fetches the matching records. Key it by
 * the search text so browser history resets the search box.
 */
export function EmployeeRegisterControls({
  params,
  facets,
  children,
}: {
  params: EmployeeRegisterParams;
  facets: EmployeeRegisterFacets;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(params);
  const [query, setQuery] = useState(params.q);

  function navigate(next: EmployeeRegisterParams) {
    startTransition(() => {
      setShown(next);
      router.push(employeeRegisterHref(next));
    });
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate({ ...shown, q: query.trim(), page: 1 });
  }

  function filter(selection: FilterSelection) {
    navigate({
      ...shown,
      serviceStatus: selection.serviceStatus ?? [],
      membership: selection.membership ?? [],
      page: 1,
    });
  }

  return (
    <div className="grid items-start gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
      <FilterPanel
        groups={[
          {
            key: 'serviceStatus',
            label: 'Service status',
            options: EMPLOYEE_SERVICE_STATUSES.map((status) => ({
              value: status,
              label: serviceStatusLabel(status),
              count: facets.serviceStatus[status] ?? 0,
            })),
          },
          {
            key: 'membership',
            label: 'Membership',
            options: [
              { value: 'LINKED', label: 'Linked', count: facets.membership.LINKED },
              { value: 'UNLINKED', label: 'Needs link', count: facets.membership.UNLINKED },
            ],
          },
        ]}
        selected={{ serviceStatus: shown.serviceStatus, membership: shown.membership }}
        onChange={filter}
      />
      <div className="grid min-w-0 gap-3">
        <form role="search" className="flex flex-wrap items-center gap-2" onSubmit={search}>
          <input
            type="search"
            name="q"
            aria-label="Search employees"
            placeholder="Search by employee number or name"
            value={query}
            onChange={(event: { target: unknown }) =>
              setQuery((event.target as { value: string }).value)
            }
            maxLength={100}
            className={`${inputClass} max-w-[360px] flex-1`}
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
          <span role="status" className="text-caption text-ink-muted">
            {pending ? 'Updating results…' : ''}
          </span>
        </form>
        {children}
      </div>
    </div>
  );
}
